import { createHash } from 'node:crypto';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { DEFAULT_DOCUMENT_EXTRACTION_LIMITS } from './document-extraction.js';
import { qualifiedContext } from './qualified-context.js';
import {
  artifactDigest,
  artifactReference,
  buildDocumentExtractionArtifact,
  buildQualifiedFactArtifact,
  type ProductIntake,
  type SourceCaptureArtifact,
  type SourceAcquisitionArtifact,
  type DocumentExtractionArtifact,
  type DocumentQualificationResult,
  type DocumentSourceLocation,
  type QualifiedFactEvidence,
  type ApplicabilityBinding,
} from './production-contracts.js';
import type { CapturedSource, ExtractedBlock } from './capture-types.js';

type Node = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const excluded = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'nav',
  'footer',
  'header',
  'aside',
  'form',
]);
const inlineTags = new Set(['span', 'strong', 'b', 'em', 'i', 'a']);
const content = (node: Node): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(content).join('') : '';
const elements = (node: Element) => node.childNodes.filter((n): n is Element => 'tagName' in n);
const inline = (node: Node): boolean =>
  !('tagName' in node) || (inlineTags.has(node.tagName) && node.childNodes.every(inline));
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A source-owned Product record and its exact visible primary heading establish one page
 * owner. Neither URL, manufacturer, category, partial name nor a sibling product
 * supplies identity. This is qualification mechanics, never engineering meaning.
 * All observations share the complete HTML parser's byte/item/text bounds; a
 * partial ordinary extraction cannot obtain a complete scope through this path.
 */
export const qualifyHtmlProduct = (input: {
  readonly source: CapturedSource;
  readonly capture: SourceCaptureArtifact;
  readonly acquisition: SourceAcquisitionArtifact;
  readonly document: DocumentExtractionArtifact;
  readonly intake: ProductIntake;
}):
  | { document: DocumentExtractionArtifact; qualification: DocumentQualificationResult }
  | undefined => {
  const { source, capture, acquisition, intake } = input;
  const captureRef = artifactReference('source_capture', capture);
  const acquisitionRef = artifactReference('source_acquisition', acquisition);
  const linked =
    acquisition.seed_capture.digest === captureRef.digest ||
    acquisition.candidates.some(
      (c) =>
        c.capture?.digest === captureRef.digest &&
        c.officiality === 'official' &&
        c.capture_outcome === 'authoritative',
    );
  if (
    !source.media_type?.includes('html') ||
    capture.disposition !== 'authoritative' ||
    acquisition.officiality !== 'official' ||
    !linked ||
    acquisition.intake.digest !== artifactDigest(intake) ||
    input.document.source_capture.digest !== captureRef.digest ||
    input.document.source_acquisition.digest !== acquisitionRef.digest ||
    input.document.status !== 'extracted' ||
    input.document.diagnostics?.some((d) => /limit_reached|partial|snapshot/.test(d.code)) ||
    source.body.bytes.length > DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_input_bytes ||
    source.content_hash !== capture.content_digest ||
    `sha256:${createHash('sha256').update(source.body.bytes).digest('hex')}` !==
      capture.content_digest ||
    source.requested_uri !== capture.requested_uri ||
    source.final_uri !== capture.final_uri
  )
    return undefined;

  const root = parse(new TextDecoder().decode(source.body.bytes));
  const entries: { node: Element; path: string }[] = [];
  const products: { value: Record<string, unknown>; path: string }[] = [];
  let malformedJson = false;
  const visit = (parent: DefaultTreeAdapterTypes.ParentNode, path: string) => {
    const counts = new Map<string, number>();
    for (const child of parent.childNodes) {
      if (!('tagName' in child)) continue;
      const ordinal = (counts.get(child.tagName) ?? 0) + 1;
      counts.set(child.tagName, ordinal);
      const next = `${path}/${child.tagName}[${ordinal}]`;
      if (
        child.tagName === 'script' &&
        child.attrs.some((a) => a.name === 'type' && a.value === 'application/ld+json')
      ) {
        try {
          const raw: unknown = JSON.parse(content(child));
          // Only explicit top-level records and @graph nodes. Arbitrary nested
          // offers/recommendations are not promoted into the owning Product.
          const records = Array.isArray(raw)
            ? raw
            : object(raw) && Array.isArray(raw['@graph'])
              ? raw['@graph']
              : [raw];
          records.forEach((record, index) => {
            if (
              object(record) &&
              (record['@type'] === 'Product' || record['@type'] === 'ProductGroup')
            )
              products.push({ value: record, path: `${next}/record[${index + 1}]` });
          });
        } catch {
          malformedJson = true;
        }
      }
      if (excluded.has(child.tagName)) continue;
      entries.push({ node: child, path: next });
      visit(child, next);
    }
  };
  visit(root, 'root');
  if (malformedJson || products.length !== 1) return undefined;
  const owner = products[0];
  const group = owner.value['@type'] === 'ProductGroup';
  let product = owner;
  if (group) {
    if (!Array.isArray(owner.value.hasVariant)) return undefined;
    const matches = owner.value.hasVariant.flatMap((v, index) =>
      object(v) &&
      v['@type'] === 'Product' &&
      ((!!intake.manufacturer_part_number &&
        [v.mpn, v.sku].includes(intake.manufacturer_part_number.trim())) ||
        [v.model, v.name].includes(intake.product_model.trim()))
        ? [{ value: v, path: `${owner.path}/hasVariant[${index + 1}]` }]
        : [],
    );
    // Selection is exclusively identity-based. Repeated exact order codes are
    // ambiguous even when their electrical properties happen to agree.
    if (matches.length !== 1) return undefined;
    product = matches[0];
  }
  const exactPart =
    !!intake.manufacturer_part_number &&
    [product.value.mpn, product.value.sku].includes(intake.manufacturer_part_number.trim());
  const exactModel = [product.value.model, product.value.name].includes(
    intake.product_model.trim(),
  );
  const identity = exactPart
    ? intake.manufacturer_part_number!.trim()
    : intake.product_model.trim();
  if (typeof product.value.name !== 'string') return undefined;
  // Exact model scope survives a missing/different source order code. It does
  // not attest that code: exact_product and exact_mpn_or_sku remain distinct.
  // No case folding, punctuation repair or partial-name comparison is used.
  const identityMatches = exactPart || exactModel;
  // A directly requested seed can preserve its unmatched owner for diagnosis.
  // Discovered related-product pages are not the requested subject; preserving
  // all their properties would create unrelated human engineering workload.
  if (!identityMatches && acquisition.seed_capture.digest !== captureRef.digest) return undefined;
  const mains = entries.filter((e) => e.node.tagName === 'main');
  if (mains.length !== 1) return undefined;
  const own = entries.filter((e) => e.path.startsWith(`${mains[0].path}/`));
  const primaryLevel = own.some((e) => e.node.tagName === 'h1') ? 'h1' : 'h2';
  const headings = own.filter(
    (e) =>
      e.node.tagName === primaryLevel && clean(content(e.node)) === clean(String(owner.value.name)),
  );
  if (
    headings.length !== 1 ||
    (primaryLevel === 'h1' && own.filter((e) => e.node.tagName === 'h1').length !== 1)
  )
    return undefined;
  const scope: ApplicabilityBinding = identityMatches
    ? {
        kind: exactPart ? ('exact_mpn_or_sku' as const) : ('exact_product' as const),
        value: identity,
        reason:
          'source-product-html.v2: unique literal Product identity and matching source owner primary heading; ProductGroup membership does not imply inherited properties',
      }
    : {
        kind: 'unresolved',
        reason:
          'source-product-html.v2: source Product owner established, but no exact intake model/MPN match; no alias or URL inference',
      };
  const observedIdentity = identityMatches ? identity : product.value.name;
  const pairs: {
    label: string;
    value: string;
    path: string;
    label_path: string;
    context: string[];
    unit?: string;
    applicability?: ApplicabilityBinding;
    identity_path?: string;
    identity?: string;
  }[] = [];
  // PropertyValue owns its literal name/value pair. Unknown sibling metadata
  // could contain conditions: do not erase it to obtain a simpler assertion.
  // Ownership of a source Product is distinct from applicability to the intake;
  // unmatched records remain unresolved evidence and cannot project.
  const propertyOwners = group ? [owner, product] : [product];
  for (const propertyOwner of propertyOwners) {
    if (Array.isArray(propertyOwner.value.additionalProperty)) {
      propertyOwner.value.additionalProperty.forEach((property, index) => {
        if (
          !object(property) ||
          property['@type'] !== 'PropertyValue' ||
          Object.keys(property).some(
            (key) => !['@type', 'name', 'value', 'unitText'].includes(key),
          ) ||
          (property.unitText !== undefined &&
            (typeof property.unitText !== 'string' || !clean(property.unitText))) ||
          typeof property.name !== 'string' ||
          !clean(property.name) ||
          !['string', 'number', 'boolean'].includes(typeof property.value) ||
          !clean(String(property.value))
        )
          return;
        const path = `${propertyOwner.path}/additionalProperty[${index + 1}]`;
        pairs.push({
          label: property.name,
          value: String(property.value),
          path,
          label_path: path,
          context: [],
          applicability: scope,
          identity_path: product.path,
          ...(typeof property.unitText === 'string' ? { unit: property.unitText } : {}),
          ...(propertyOwner === owner && group
            ? {
                applicability: {
                  kind: 'family' as const,
                  value: String(owner.value.name),
                  reason:
                    'source ProductGroup property; exact variant membership does not establish inheritance',
                },
                identity: String(owner.value.name),
                identity_path: owner.path,
              }
            : {}),
        });
      });
    }
  }
  // A repeated two-inline-child list is a source-authored key/value group. Only
  // the literal product's native Description/Specifications region owns it;
  // recommendations or other product headings terminate that region. No CSS
  // class names or engineering values establish identity or pair selection.
  for (const entry of own.filter((e) => ['ul', 'ol'].includes(e.node.tagName))) {
    const parent = entry.node.parentNode;
    const groupLists =
      parent &&
      'tagName' in parent &&
      elements(parent).every((n) => ['ul', 'ol'].includes(n.tagName))
        ? elements(parent)
        : [entry.node];
    const groupRows = groupLists.flatMap(elements);
    const identityCandidates = groupRows.filter(
      (row) =>
        elements(row).length === 2 &&
        /^(?:product code|model|manufacturer part number|sku|mpn|part number)$/i.test(
          clean(content(elements(row)[0])),
        ),
    );
    const identityRows = groupRows.filter((row) => {
      const children = elements(row);
      return (
        children.length === 2 &&
        /^(?:product code|model|manufacturer part number|sku|mpn|part number)$/i.test(
          clean(content(children[0])),
        ) &&
        clean(content(children[1])) === identity
      );
    });
    if (identityCandidates.some((row) => !identityRows.includes(row))) continue;
    const explicitGroup =
      identityMatches &&
      identityRows.length === 1 &&
      identityCandidates.length === 1 &&
      groupRows.every(
        (row) =>
          row.tagName === 'li' &&
          elements(row).length === 2 &&
          elements(row).every((n) => inlineTags.has(n.tagName) && n.childNodes.every(inline)) &&
          !row.childNodes.some((n) => 'value' in n && clean(n.value)),
      );
    const preceding = own
      .slice(0, own.indexOf(entry))
      .filter((e) => ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(e.node.tagName));
    const heading = preceding.at(-1);
    if (
      !explicitGroup &&
      (!heading ||
        !/^(?:description|key features|(?:technical )?specifications)$/i.test(
          clean(content(heading.node)),
        ))
    )
      continue;
    const rows = elements(entry.node);
    if (rows.length < 2 || rows.some((n) => n.tagName !== 'li')) continue;
    const pending: typeof pairs = [];
    for (const row of rows) {
      const children = elements(row);
      if (
        children.length !== 2 ||
        children.some((n) => !inlineTags.has(n.tagName) || !n.childNodes.every(inline)) ||
        row.childNodes.some((n) => 'value' in n && clean(n.value))
      ) {
        pending.length = 0;
        break;
      }
      const label = clean(content(children[0])),
        value = clean(content(children[1]));
      const rowEntry = own.find((e) => e.node === row);
      if (!label || !value || !rowEntry) {
        pending.length = 0;
        break;
      }
      pending.push({ label, value, path: rowEntry.path, label_path: rowEntry.path, context: [] });
    }
    pairs.push(...pending);
  }
  const regions = own.filter(
    (e) =>
      ['h2', 'h3'].includes(e.node.tagName) &&
      /^(?:technical )?specifications(?: (?:&|and) dimensions)?$|^(?:weights? (?:&|and) dimensions|dimensions (?:&|and) weight)$|^recommended charging settings$/i.test(
        clean(content(e.node)),
      ),
  );
  const seen = new Set<string>();
  for (const heading of regions) {
    // A semantic SECTION may wrap a heading in a presentation DIV. Its sole
    // heading still owns the grouped DL; arbitrary higher DIVs are not searched.
    let parent = heading.node.parentNode;
    let ancestor = parent;
    while (ancestor && 'tagName' in ancestor && ancestor.tagName !== 'main') {
      if (ancestor.tagName === 'section') {
        parent = ancestor;
        break;
      }
      ancestor = ancestor.parentNode;
    }
    if (!parent || !('tagName' in parent)) continue;
    const section = own.find((e) => e.node === parent);
    if (!section) continue;
    const regionEntries = own.filter(
      (e) => e.path.startsWith(`${section.path}/`) && e.node !== heading.node,
    );
    // Nested headings may establish a different mode, condition or product.
    // Until their sequencing is explicitly represented, reject this section.
    if (regionEntries.some((e) => ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(e.node.tagName)))
      continue;
    // Section conditions are retained verbatim, including charging settings.
    // A specification heading is provenance, not a fabricated electrical role.
    const context =
      /^(?:recommended charging settings|weights? (?:&|and) dimensions|dimensions (?:&|and) weight)$/i.test(
        clean(content(heading.node)),
      )
        ? [clean(content(heading.node))]
        : [];
    for (const entry of regionEntries) {
      if (seen.has(entry.path)) continue;
      const node = entry.node;
      const children = elements(node);
      if (node.tagName === 'table') {
        // The already proven source Product owns this native table. Each source
        // section header changes context forward. A span in a quantity row or
        // nested table rejects the whole supplemental table: no nearest-cell
        // reconstruction, CSS inference or borrowed adjacent quantity follows.
        const rows = regionEntries.filter(
          (e) => e.path.startsWith(`${entry.path}/`) && e.node.tagName === 'tr',
        );
        const pending: typeof pairs = [];
        let sectionContext = context;
        let unsupported = regionEntries.some(
          (e) => e !== entry && e.path.startsWith(`${entry.path}/`) && e.node.tagName === 'table',
        );
        for (const row of rows) {
          const cells = elements(row.node);
          const span = (cell: Element, name: string) =>
            cell.attrs.find((a) => a.name === name)?.value ?? '1';
          if (
            cells.length === 1 &&
            cells[0].tagName === 'th' &&
            span(cells[0], 'colspan') === '2' &&
            span(cells[0], 'rowspan') === '1' &&
            cells[0].childNodes.every(inline)
          ) {
            sectionContext = [clean(content(cells[0]))];
            continue;
          }
          if (
            cells.length !== 2 ||
            cells.some(
              (cell) =>
                !['td', 'th'].includes(cell.tagName) ||
                span(cell, 'colspan') !== '1' ||
                span(cell, 'rowspan') !== '1' ||
                !cell.childNodes.every(inline),
            )
          ) {
            unsupported = true;
            break;
          }
          const label = clean(content(cells[0])),
            value = clean(content(cells[1]));
          if (label && value)
            pending.push({
              label,
              value,
              path: `${row.path}/cell[2]`,
              label_path: `${row.path}/cell[1]`,
              context: sectionContext,
            });
        }
        if (!unsupported) pairs.push(...pending);
      }
      // Explicit inline label node followed by direct value text. Colon prose
      // with no separate label node is intentionally not this structural class.
      if (
        children.length === 1 &&
        inlineTags.has(children[0].tagName) &&
        node.childNodes.every(inline)
      ) {
        const label = clean(content(children[0]));
        const value = clean(
          node.childNodes
            .filter((n) => n !== children[0])
            .map(content)
            .join(''),
        );
        if (/^[^:]+:\s*$/.test(label) && value) {
          pairs.push({
            label: label.replace(/:\s*$/, ''),
            value,
            path: entry.path,
            label_path: entry.path,
            context,
          });
          seen.add(entry.path);
        }
      }
      // HTML permits DT/DD groups wrapped by a DIV inside DL. The two direct
      // children and no outside text establish arity, not a visual CSS guess.
      if (node.tagName === 'dl') {
        const groups = children.every((n) => n.tagName === 'div') ? children : [node];
        for (const group of groups) {
          const cells = elements(group);
          if (
            cells.length % 2 ||
            !cells.length ||
            group.childNodes.some((n) => 'value' in n && clean(n.value))
          )
            continue;
          if (
            cells.some(
              (c, index) => c.tagName !== (index % 2 ? 'dd' : 'dt') || !c.childNodes.every(inline),
            )
          )
            continue;
          for (let index = 0; index < cells.length; index += 2) {
            const label = clean(content(cells[index])),
              value = clean(content(cells[index + 1]));
            const valueEntry = own.find((e) => e.node === cells[index + 1]);
            const labelEntry = own.find((e) => e.node === cells[index]);
            if (label && value && valueEntry && labelEntry)
              pairs.push({
                label,
                value,
                path: valueEntry.path,
                label_path: labelEntry.path,
                context,
              });
          }
        }
      }
    }
  }
  if (!pairs.length) return undefined;
  const distinct = [...new Map(pairs.map((p) => [p.path + ':' + p.label, p])).values()];
  // Blocks plus facts intentionally share the ordinary HTML item envelope.
  if (
    distinct.length * 2 > DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_items ||
    distinct.some((p) =>
      [p.label, p.value, ...p.context].some(
        (s) => s.length > DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_text_length,
      ),
    )
  )
    return undefined;
  const blocks: ExtractedBlock[] = distinct.map((p) => ({
    id: `product-html.${artifactDigest(p).slice(7, 31)}`,
    kind: 'structured',
    text: JSON.stringify(p),
    locator: { fragment: p.path, path: p.path },
    source_location: { kind: 'html', path: p.path },
  }));
  const document = buildDocumentExtractionArtifact(
    {
      source,
      status: 'extracted',
      blocks,
      warnings: [],
      extractor: 'source-product-html',
      extractor_version: '2.0.0',
    },
    captureRef,
    {
      source_acquisition: acquisitionRef,
      acquisition_candidate_id: input.document.acquisition_candidate_id,
    },
  );
  const documentRef = artifactReference('document_extraction', document);
  const evidence = (
    role: QualifiedFactEvidence['role'],
    text: string,
    path: string,
  ): QualifiedFactEvidence => ({
    role: role === 'qualifier' && text === 'General' ? 'context' : role,
    text,
    source_reference: captureRef,
    locator: { kind: 'html', path } as DocumentSourceLocation,
    ...(role === 'qualifier'
      ? {
          context: {
            // The literal General table section only organizes already product-owned
            // rows; it adds no rating condition. Unknown section titles remain source
            // semantics. This classification is producer-owned, never mapper keywords.
            ...qualifiedContext(
              text === 'General' ? 'qualification_provenance' : 'source_semantic',
              'document-qualification',
            ),
            // The source Product owns this explicit dimension region. Package regions
            // are never admitted by the region grammar, and no installed fit follows.
            ...(/^(?:weights? (?:&|and) dimensions|dimensions (?:&|and) weight)$/i.test(text)
              ? { physical_scope: 'product_body' as const }
              : {}),
          },
        }
      : {}),
  });
  const facts = distinct.map((p) =>
    buildQualifiedFactArtifact({
      source_capture: captureRef,
      source_acquisition: acquisitionRef,
      document_extraction: documentRef,
      acquisition_candidate_id: input.document.acquisition_candidate_id,
      metadata: {
        source_wording: p.label,
        source_label: p.label,
        raw_value: p.value,
        applicability:
          p.applicability ??
          (group
            ? {
                kind: 'family',
                value: String(owner.value.name),
                reason: 'source-owned ProductGroup specification; no inferred variant inheritance',
              }
            : scope),
        raw_identifier: p.identity ?? observedIdentity,
        ...(p.unit ? { source_unit: p.unit } : {}),
        ...(p.context.some((c) => c !== 'General')
          ? { conditions: p.context.filter((c) => c !== 'General') }
          : {}),
      },
      evidence: [
        evidence('subject', p.identity ?? observedIdentity, p.identity_path ?? product.path),
        evidence('applicability', p.identity ?? observedIdentity, p.identity_path ?? product.path),
        evidence('label', p.label, p.label_path),
        evidence('value', p.value, p.path),
        ...(p.unit ? [evidence('value', p.unit, p.path)] : []),
        {
          role: 'context',
          text: scope.reason!,
          source_reference: documentRef,
          locator: { kind: 'html', path: headings[0].path },
          context: qualifiedContext('qualification_provenance', 'document-qualification'),
        },
        ...p.context.map((c) => evidence('qualifier', c, headingPath(regions, c) ?? p.path)),
      ],
      qualifier: 'source-product-html',
      qualifier_version: '2.0.0',
      qualification_state: identityMatches ? 'structurally_supported' : 'unresolved',
    }),
  );
  return {
    document,
    qualification: {
      outcome: identityMatches ? 'qualified' : 'identity_unresolved',
      completeness: 'complete',
      diagnostics: identityMatches ? [] : [{ code: 'identity_unresolved', message: scope.reason! }],
      facts,
    },
  };
};

const headingPath = (regions: readonly { node: Element; path: string }[], text: string) =>
  regions.find((e) => clean(content(e.node)) === text)?.path;
