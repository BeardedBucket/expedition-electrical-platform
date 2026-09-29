import { createHash } from 'node:crypto';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { CapturedSource, ExtractedBlock } from './capture-types.js';
import type { JsonObject, JsonValue } from './contracts.js';
import { DEFAULT_DOCUMENT_EXTRACTION_LIMITS } from './document-extraction.js';
import {
  acquireManufacturerRecord,
  isOfficialManufacturerUri,
  manufacturerAcquisitionProfileDigest,
  resolveManufacturerAcquisitionStrategy,
  validateManufacturerAcquisitionProfile,
  type HtmlNodeSelector,
  type ManufacturerAcquisitionProfile,
} from './manufacturer-acquisition.js';
import {
  artifactDigest,
  artifactReference,
  buildDocumentExtractionArtifact,
  buildQualifiedFactArtifact,
  type ApplicabilityBinding,
  type DocumentExtractionArtifact,
  type DocumentQualificationResult,
  type DocumentSourceLocation,
  type ProductIntake,
  type QualifiedFactEvidence,
  type QualificationDiagnostic,
  type SourceAcquisitionArtifact,
  type SourceCaptureArtifact,
} from './production-contracts.js';

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.ChildNode;
const attr = (node: Element, name: string) => node.attrs.find((a) => a.name === name)?.value;
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
const text = (node: Node): string =>
  'value' in node
    ? node.value
    : 'tagName' in node && excluded.has(node.tagName)
      ? ''
      : 'childNodes' in node
        ? node.childNodes.map(text).join(' ')
        : '';
const matches = (node: Element, selector: HtmlNodeSelector) =>
  (!selector.tag || node.tagName === selector.tag) &&
  (!selector.id || attr(node, 'id') === selector.id) &&
  (!selector.class_name || attr(node, 'class')?.split(/\s+/).includes(selector.class_name)) &&
  (!selector.attribute || attr(node, selector.attribute.name) === selector.attribute.value);

/** Selector chains are declarative descendant relationships, with all clauses
 * conjunctive on each element. No executable CSS, regex, fuzzy paths or guessed
 * properties. Paths use the same tag-local DOM ordinals as HTML extraction.
 */
const elements = (root: DefaultTreeAdapterTypes.Document) => {
  const output: { node: Element; path: string }[] = [];
  const visit = (parent: DefaultTreeAdapterTypes.ParentNode, path: string) => {
    const counts = new Map<string, number>();
    for (const child of parent.childNodes) {
      if (!('tagName' in child)) continue;
      const ordinal = (counts.get(child.tagName) ?? 0) + 1;
      counts.set(child.tagName, ordinal);
      const childPath = `${path}/${child.tagName}[${ordinal}]`;
      if (excluded.has(child.tagName)) continue;
      output.push({ node: child, path: childPath });
      visit(child, childPath);
    }
  };
  visit(root, 'root');
  return output;
};
const selected = (entries: ReturnType<typeof elements>, chain: readonly HtmlNodeSelector[]) =>
  entries.filter(({ node }) => {
    if (!matches(node, chain[chain.length - 1])) return false;
    let parent = node.parentNode;
    for (let i = chain.length - 2; i >= 0; i -= 1) {
      while (parent && (!('tagName' in parent) || !matches(parent, chain[i])))
        parent = 'parentNode' in parent ? parent.parentNode : null;
      if (!parent) return false;
      parent = parent.parentNode;
    }
    return true;
  });
const valueAtPath = (record: JsonObject, path: string): JsonValue | undefined => {
  let value: JsonValue = record;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, key))
      return undefined;
    value = value[key];
  }
  return value;
};

interface Observation {
  label: string;
  value: JsonValue;
  unit?: string;
  location: DocumentSourceLocation;
  label_location?: DocumentSourceLocation;
  subject: string;
  subject_location: DocumentSourceLocation;
  scope: ApplicabilityBinding;
  context: string;
  conditions?: readonly string[];
}

/** Recover reviewed source-shape extraction into production QualifiedFacts, not
 * legacy ProductFacts. Capture/acquisition authority and byte identity are checked
 * before parsing. The existing HTML input/item/text ceilings are intentionally
 * shared: supplementary evidence cannot evade a truncated caller extraction.
 * Missing/ambiguous selectors or records produce diagnostics, never a fallback
 * scrape. Profiles own source paths; semantic mapping still owns canonical fields.
 */
export const prepareProfileQualifiedEvidence = (input: {
  source: CapturedSource;
  capture: SourceCaptureArtifact;
  acquisition: SourceAcquisitionArtifact;
  document: DocumentExtractionArtifact;
  intake: ProductIntake;
  profile?: ManufacturerAcquisitionProfile;
}):
  | { document: DocumentExtractionArtifact; qualification: DocumentQualificationResult }
  | undefined => {
  const { source, capture, acquisition, intake, profile } = input;
  if (
    !profile ||
    profile.profile_status !== 'reviewed' ||
    !validateManufacturerAcquisitionProfile(profile).ok
  )
    return undefined;
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
    source.final_uri !== capture.final_uri ||
    !isOfficialManufacturerUri(profile, source.requested_uri) ||
    !isOfficialManufacturerUri(profile, source.final_uri) ||
    !source.media_type?.includes('html') ||
    profile.manufacturer !== intake.manufacturer ||
    acquisition.profile_binding?.profile_id !== profile.id ||
    acquisition.profile_binding?.profile_digest !== manufacturerAcquisitionProfileDigest(profile)
  )
    return undefined;
  // Byte-backed decoding prevents callers supplying unrelated text with a valid
  // captured-byte digest. Neither transport success nor an intake URL grants scope.
  const html = new TextDecoder().decode(source.body.bytes);
  const captured = { ...source, body: { bytes: source.body.bytes, text: html } };
  const observations: Observation[] = [];
  const blocks: ExtractedBlock[] = [];
  const diagnostics: QualificationDiagnostic[] = [];
  const profileContext = `reviewed profile ${profile.id} ${manufacturerAcquisitionProfileDigest(profile)}`;
  const addBlock = (
    kind: ExtractedBlock['kind'],
    content: string,
    path: string,
    rows?: ExtractedBlock['rows'],
  ) => {
    blocks.push({
      kind,
      text: content,
      id: `profile-block.${artifactDigest({ kind, path, content }).slice(7, 31)}`,
      locator: { fragment: path, path },
      source_location: { kind: 'html', path },
      ...(rows ? { rows } : {}),
    });
  };
  const strategyResolution = resolveManufacturerAcquisitionStrategy(profile, source.final_uri);
  const strategy =
    strategyResolution.status === 'resolved' ? strategyResolution.strategy : undefined;
  if (strategy?.embedded_json.fact_mappings?.length) {
    const result = acquireManufacturerRecord({
      profile,
      source_id: capture.id,
      requested_identity: {
        manufacturer: intake.manufacturer,
        model: intake.product_model,
        manufacturer_part_number: intake.manufacturer_part_number,
      },
      captured_source: captured,
    });
    if (result.status === 'matched') {
      const raw = result.raw_structured_evidence;
      const path = `${raw.locator.script_id}:${raw.locator.json_path}:${raw.locator.record_collection_path}[${raw.locator.record_index}]`;
      // Retain the complete selected record and reviewed mapping configuration in
      // an ordinary extraction block. It is inert source evidence, not executable
      // JSON or canonical data; sibling records are never copied into this scope.
      addBlock(
        'structured',
        JSON.stringify({
          raw_record: raw.raw_record,
          record_locator: raw.locator,
          mappings: strategy.embedded_json.fact_mappings,
          profile: profileContext,
        }),
        path,
      );
      for (const mapping of strategy.embedded_json.fact_mappings) {
        const value = valueAtPath(raw.raw_record, mapping.source_path);
        if (
          value === undefined ||
          value === null ||
          value === '' ||
          (Array.isArray(value) && !value.length)
        ) {
          diagnostics.push({
            code: 'missing_value',
            message: `Reviewed structured property '${mapping.source_path}' is absent or empty.`,
          });
          continue;
        }
        observations.push({
          label: mapping.raw_label,
          value,
          unit: mapping.source_unit,
          location: { kind: 'html', path: `${path}.${mapping.source_path}` },
          subject: raw.matched_identity.raw_value,
          subject_location: { kind: 'html', path: `${path}.${raw.matched_identity.property}` },
          scope: {
            kind: 'exact_mpn_or_sku',
            value: raw.matched_identity.raw_value,
            reason: 'reviewed-structured-record.v1: unique exact raw SKU record',
          },
          context: profileContext,
        });
      }
    } else
      diagnostics.push({
        code: 'applicability_unresolved',
        message: `Reviewed structured record ${result.status}: ${result.issues.map((i) => i.code).join(', ')}`,
      });
  }
  // Page scope applies only to the exact official intake seed. Reviewed selectors
  // prove visible identity and limit regions; sibling pages/navigation never inherit
  // the target simply because they share a manufacturer or a template.
  const rules =
    source.requested_uri === intake.official_product_uri
      ? (profile.html_fact_rules ?? []).filter(
          (r) =>
            r.status === 'reviewed' && new URL(source.final_uri).pathname.startsWith(r.path_prefix),
        )
      : [];
  if (rules.length > 1)
    diagnostics.push({
      code: 'applicability_unresolved',
      message: 'Multiple reviewed HTML page-scope rules apply.',
    });
  if (rules.length === 1) {
    const rule = rules[0],
      entries = elements(parse(html));
    const identity = selected(entries, rule.identity_selector);
    const requested =
      rule.identity_kind === 'mpn' ? intake.manufacturer_part_number : intake.product_model;
    if (
      !requested ||
      !identity.length ||
      identity.some((e) => clean(text(e.node)) !== requested.trim())
    )
      diagnostics.push({
        code: 'identity_unresolved',
        message:
          'Reviewed page identity selector is missing, competing or does not exactly match the target.',
      });
    else {
      const subjectLocation: DocumentSourceLocation = { kind: 'html', path: identity[0].path };
      addBlock(
        'structured',
        JSON.stringify({
          rule: rule.id,
          profile: profileContext,
          identity: identity.map((e) => ({ value: clean(text(e.node)), path: e.path })),
        }),
        identity[0].path,
      );
      const scope: ApplicabilityBinding = {
        kind: rule.identity_kind === 'mpn' ? 'exact_mpn_or_sku' : 'exact_product',
        value: requested.trim(),
        reason: `reviewed-html-page-scope.v1: exact intake seed identity and reviewed regions (${rule.id})`,
      };
      const seen = new Set<string>();
      for (const region of rule.regions) {
        for (const entry of selected(entries, region.selector)) {
          if (seen.has(entry.path)) continue;
          if (region.heading) {
            const headings = selected(entries, region.heading.selector).filter((e) =>
              e.path.startsWith(`${entry.path}/`),
            );
            if (headings.length !== 1 || clean(text(headings[0].node)) !== region.heading.text)
              continue;
          }
          seen.add(entry.path);
          const pairs: {
            label: string;
            value: string;
            path: string;
            label_path?: string;
            conditions?: readonly string[];
          }[] = [];
          const native = input.document.blocks.find((b) => b.locator.path === entry.path);
          if (region.kind === 'table') {
            // Source-faithful tables reuse already retained cells. Spans, competing
            // identity axes, repeated/multiple headers and malformed rows reject
            // this region; empty cells are skipped without inventing a zero/false.
            if (
              entry.node.tagName !== 'table' ||
              !native?.cells?.length ||
              input.document.blocks.some(
                (b) =>
                  b !== native &&
                  b.kind === 'table' &&
                  b.locator.path?.startsWith(`${entry.path}/`),
              )
            )
              continue;
            const rows = new Map<number, NonNullable<typeof native.cells>[number][]>();
            let unsafe = false;
            for (const cell of native.cells) {
              if ((cell.rowspan ?? 1) !== 1 || cell.column > 2 || (cell.colspan ?? 1) > 2)
                unsafe = true;
              const row = rows.get(cell.row) ?? [];
              row.push(cell);
              rows.set(cell.row, row);
            }
            const captions: string[] = [];
            for (const [rowNumber, row] of [...rows.entries()].sort(([a], [b]) => a - b)) {
              row.sort((a, b) => a.column - b.column);
              if (
                row.length === 1 &&
                row[0].column === 1 &&
                row[0].colspan === 2 &&
                rowNumber === 1
              ) {
                captions.push(row[0].value);
                continue;
              }
              // The native extractor omits empty text cells. Verify the original
              // two-cell DOM row before treating an omitted value as unknown;
              // a malformed one-cell row must still reject the region.
              const domRow = entries.filter(
                (e) => e.node.tagName === 'tr' && e.path.startsWith(`${entry.path}/`),
              )[rowNumber - 1];
              const domCells = domRow?.node.childNodes.filter(
                (n): n is Element => 'tagName' in n && ['td', 'th'].includes(n.tagName),
              );
              if (
                row.length === 1 &&
                row[0].column === 1 &&
                domCells?.length === 2 &&
                !clean(text(domCells[1])) &&
                !attr(domCells[1], 'colspan') &&
                !attr(domCells[1], 'rowspan')
              ) {
                diagnostics.push({
                  code: 'missing_value',
                  message: 'Empty specification value remains unknown.',
                });
                continue;
              }
              if (
                row.length !== 2 ||
                row[0].column !== 1 ||
                row[1].column !== 2 ||
                (row[0].colspan ?? 1) !== 1 ||
                (row[1].colspan ?? 1) !== 1 ||
                row[1].kind !== 'data' ||
                /^(?:models?|variants?|sku|mpn|part\s*(?:number|no\.?))\b/i.test(row[0].value)
              ) {
                unsafe = true;
                break;
              }
              const contextual = captions.filter(
                (t) =>
                  !/^(?:technical\s+)?specifications$|^dimensions$|^accepted voltages$/i.test(
                    t.trim(),
                  ),
              );
              pairs.push({
                label: row[0].value,
                value: row[1].value,
                path: row[1].source_location.path!,
                label_path: row[0].source_location.path,
                conditions: contextual.length ? contextual : undefined,
              });
            }
            if (unsafe) {
              diagnostics.push({
                code: 'unsupported_structure',
                message: `Reviewed table region '${entry.path}' has ambiguous spans, identity axes or rows.`,
              });
              continue;
            }
          } else if (region.kind === 'definition') {
            if (entry.node.tagName !== 'dl' || !native?.rows?.length) continue;
            // A later DD cannot supply a missing intervening DT's value. Require
            // direct alternating source siblings and keep their actual DOM paths.
            const children = entries.filter((e) => e.node.parentNode === entry.node);
            if (
              children.length % 2 ||
              children.some((e, n) => e.node.tagName !== (n % 2 ? 'dd' : 'dt'))
            ) {
              diagnostics.push({
                code: 'unsupported_structure',
                message: `Non-paired definition region '${entry.path}'.`,
              });
              continue;
            }
            for (let n = 0; n < children.length; n += 2) {
              const label = clean(text(children[n].node)),
                value = clean(text(children[n + 1].node));
              if (!label || !value) {
                diagnostics.push({
                  code: 'missing_value',
                  message: 'Empty definition pair remains unknown.',
                });
                continue;
              }
              pairs.push({
                label,
                value,
                path: children[n + 1].path,
                label_path: children[n].path,
              });
            }
          } else {
            const nodes =
              region.kind === 'label_value_list'
                ? entries.filter(
                    (e) =>
                      e.node.tagName === 'li' &&
                      e.path.startsWith(`${entry.path}/`) &&
                      e.node.parentNode === entry.node,
                  )
                : entries.filter(
                    (e) => e.node.tagName === 'p' && e.path.startsWith(`${entry.path}/`),
                  );
            for (const node of nodes) {
              // Only explicit source delimiters (BR or separate LI) establish
              // label/value lines. Plain prose and colon-containing paragraphs
              // without structural line boundaries are intentionally not NLP.
              const chunks: string[] = [''];
              let malformed = false;
              for (const child of node.node.childNodes) {
                if ('tagName' in child && child.tagName === 'br') chunks.push('');
                else if (
                  'tagName' in child &&
                  !['strong', 'b', 'span', 'em', 'i'].includes(child.tagName)
                )
                  malformed = true;
                else chunks[chunks.length - 1] += text(child);
              }
              if (malformed || (region.kind === 'label_value_lines' && chunks.length < 2)) continue;
              const lines = chunks.map(clean).filter(Boolean);
              if (lines.some((line) => !/^([^:]+):\s*(.+)$/.test(line))) {
                diagnostics.push({
                  code: 'unsupported_structure',
                  message: `Incomplete label/value lines in '${node.path}'.`,
                });
                continue;
              }
              lines.forEach((line, n) => {
                const m = /^([^:]+):\s*(.+)$/.exec(line)!;
                pairs.push({
                  label: m[1].trim(),
                  value: m[2],
                  path: `${node.path}/line[${n + 1}]`,
                });
              });
            }
          }
          if (pairs.length)
            addBlock(
              'structured',
              JSON.stringify({
                rule: rule.id,
                profile: profileContext,
                region: region.kind,
                pairs,
              }),
              entry.path,
              pairs.map(({ label, value }) => ({ label, value })),
            );
          for (const pair of pairs)
            observations.push({
              label: pair.label,
              value: pair.value,
              location: { kind: 'html', path: pair.path },
              label_location: { kind: 'html', path: pair.label_path ?? pair.path },
              subject: requested.trim(),
              subject_location: subjectLocation,
              scope,
              context: profileContext,
              conditions: pair.conditions,
            });
        }
      }
    }
  }
  if (!strategy?.embedded_json.fact_mappings?.length && !rules.length) return undefined;
  // One item envelope counts retained supplementary blocks plus QualifiedFact
  // observations before fact artifact construction (not two independent caps). A
  // rejected over-limit supplement remains diagnostic; no complete-scope facts
  // survive truncation. Bounds are coupled to HTML extraction deliberately.
  const bounded =
    blocks.length + observations.length <= DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_items &&
    blocks.every((b) => b.text.length <= DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_text_length);
  if (!bounded)
    diagnostics.push({
      code: 'partial_source',
      message:
        'Profile evidence exceeded the shared HTML retained-output bounds; no facts qualified.',
    });
  const document = buildDocumentExtractionArtifact(
    {
      source: captured,
      status: bounded && blocks.length ? 'extracted' : 'partially_extracted',
      blocks: bounded ? blocks : [],
      warnings: [],
      extractor: 'reviewed-profile-evidence',
      extractor_version: '1.0.0',
      diagnostics: bounded
        ? []
        : [{ code: 'text_limit_reached', message: 'Profile evidence exceeds HTML output bounds.' }],
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
    value: string,
    locator: DocumentSourceLocation,
  ): QualifiedFactEvidence => ({ role, text: value, locator, source_reference: captureRef });
  // Conditions explicitly written in a label remain evidence even when a legacy
  // semantic alias recognizes that label. Recognition cannot erase a temperature,
  // mode or "only when" qualification. This is a conservative context guard,
  // not inference of a condition's engineering meaning.
  for (const observation of observations) {
    if (
      /\bat\s+[-+]?\d|\bwhen\b|\bonly\b|\bin\s+.+\bmode\b|\bup to\s+[-+]?\d.*ambient/i.test(
        observation.label,
      )
    ) {
      observation.conditions = [...(observation.conditions ?? []), observation.label];
    }
  }
  const facts = bounded
    ? observations.map((o) =>
        buildQualifiedFactArtifact({
          source_capture: captureRef,
          source_acquisition: acquisitionRef,
          document_extraction: documentRef,
          acquisition_candidate_id: input.document.acquisition_candidate_id,
          metadata: {
            source_wording: o.label,
            source_label: o.label,
            raw_value: o.value,
            ...(o.unit ? { source_unit: o.unit } : {}),
            applicability: o.scope,
            raw_identifier: o.subject,
            ...(o.conditions ? { conditions: o.conditions } : {}),
          },
          evidence: [
            evidence('subject', o.subject, o.subject_location),
            { ...evidence('applicability', o.subject, o.subject_location), note: o.scope.reason },
            evidence('label', o.label, o.label_location ?? o.location),
            evidence(
              'value',
              typeof o.value === 'string' ? o.value : JSON.stringify(o.value),
              o.location,
            ),
            {
              role: 'context',
              text: o.context,
              source_reference: documentRef,
              locator: o.location,
            },
            ...(o.conditions ?? []).map((c) => evidence('qualifier', c, o.location)),
          ],
          qualifier: o.scope.reason?.startsWith('reviewed-structured-record')
            ? 'reviewed-structured-record'
            : 'reviewed-html-page-scope',
          qualifier_version: '1.0.0',
          qualification_state: 'structurally_supported',
        }),
      )
    : [];
  return {
    document,
    qualification: {
      outcome: !bounded ? 'source_incomplete' : facts.length ? 'qualified' : 'no_qualifiable_facts',
      completeness: !bounded ? 'partial' : facts.length ? 'complete' : 'incomplete',
      facts,
      diagnostics,
    },
  };
};
