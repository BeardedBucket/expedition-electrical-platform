import { qualifiedContext } from './qualified-context.js';
import {
  PDF_VECTOR_STRUCTURE,
  pdfGridCells,
  pdfModelHeaders,
  type PdfGrid,
  type PdfCell,
} from './pdf-vector-structure.js';
import {
  artifactReference,
  buildQualifiedFactArtifact,
  type DocumentBlock,
  type DocumentExtractionArtifact,
  type DocumentQualificationTarget,
  type QualifiedFactArtifact,
  type QualifiedFactEvidence,
} from './production-contracts.js';

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(v).length === expected.length && Object.keys(v).every((k) => expected.includes(k));

/** Validate the versioned structural payload independently of JSON schema's
 * generic structured-content string. Every item is linked back to the ordinary
 * retained text item; malformed geometry cannot bypass qualification by claiming
 * a producer marker. The artifact's capture/acquisition digest owns provenance.
 */
function readGrid(document: DocumentExtractionArtifact, block: DocumentBlock): PdfGrid | undefined {
  if (
    document.status !== 'extracted' ||
    block.kind !== 'structured' ||
    block.locator.section !== PDF_VECTOR_STRUCTURE ||
    block.locator.kind !== 'pdf'
  )
    return undefined;
  try {
    const data: unknown = JSON.parse(block.content ?? '');
    if (
      !object(data) ||
      !keys(data, ['version', 'items', 'rules']) ||
      data.version !== PDF_VECTOR_STRUCTURE ||
      !Array.isArray(data.items) ||
      !Array.isArray(data.rules)
    )
      return undefined;
    const raw = document.blocks.filter(
      (b) => b.kind === 'text_block' && b.locator.page === block.locator.page,
    );
    const ordinals = new Set<number>();
    for (const i of data.items) {
      if (
        !object(i) ||
        !keys(i, ['text', 'x', 'y', 'width', 'height', 'upright', 'location']) ||
        typeof i.text !== 'string' ||
        typeof i.upright !== 'boolean' ||
        !['x', 'y', 'width', 'height'].every(
          (k) => typeof i[k] === 'number' && Number.isFinite(i[k]),
        ) ||
        Number(i.width) < 0 ||
        Number(i.height) <= 0 ||
        !object(i.location)
      )
        return undefined;
      const loc = i.location;
      if (
        loc.kind !== 'pdf' ||
        loc.page !== block.locator.page ||
        !Number.isSafeInteger(loc.ordinal) ||
        ordinals.has(Number(loc.ordinal))
      )
        return undefined;
      ordinals.add(Number(loc.ordinal));
      const source = raw.find((b) => b.locator.ordinal === loc.ordinal);
      if (
        !source ||
        source.content !== i.text ||
        source.locator.path !== loc.path ||
        source.locator.fragment !== loc.fragment
      )
        return undefined;
    }
    if (ordinals.size !== raw.length) return undefined;
    for (const r of data.rules) {
      if (
        !object(r) ||
        !keys(r, ['a', 'b', 'ink', 'operator']) ||
        ![r.a, r.b].every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ||
        typeof r.ink !== 'number' ||
        !Number.isFinite(r.ink) ||
        r.ink < 0 ||
        !Number.isSafeInteger(r.operator) ||
        Number(r.operator) < 1
      )
        return undefined;
    }
    return data as unknown as PdfGrid;
  } catch {
    return undefined;
  }
}

const wording = (cell: PdfCell) => cell.items.map((i) => i.text).join(' ');
const boundaryInk = (grid: PdfGrid, cell: PdfCell, coordinate: number) =>
  Math.max(
    0,
    ...grid.rules
      .filter(
        (r) => cell.operators.includes(r.operator) && r.a[1] === r.b[1] && r.a[1] === coordinate,
      )
      .map((r) => r.ink),
  );
const sameRow = (grid: PdfGrid, a: PdfCell, b: PdfCell) =>
  Math.abs(a.bottom - b.bottom) <=
    boundaryInk(grid, a, a.bottom) + boundaryInk(grid, b, b.bottom) &&
  Math.abs(a.top - b.top) <= boundaryInk(grid, a, a.top) + boundaryInk(grid, b, b.top);

/** Exact literal model selection, with closed source-grid rows. A source model
 * identifier establishes exact_product, never an unprinted sales SKU. Shared
 * cells must actually enclose the selected model column. Source labels, wrapped
 * values, footnotes and section text stay evidence; context is not discarded to
 * obtain an unconditional rating. No engineering meaning is introduced here.
 */
export function qualifyPdfGrid(
  document: DocumentExtractionArtifact,
  block: DocumentBlock,
  target: DocumentQualificationTarget,
): readonly QualifiedFactArtifact[] {
  const grid = readGrid(document, block);
  if (!grid || !document.source_acquisition || document.source_capture.kind !== 'source_capture')
    return [];
  const cells = pdfGridCells(grid);
  const model = target.product_model?.trim();
  const requested = target.target_identifier?.trim() ?? target.manufacturer_part_number?.trim();
  const allHeaders = pdfModelHeaders(grid);
  const headers = allHeaders.filter(
    (c) => c.items[1].text === model || (!!requested && c.items[1].text === requested),
  );
  const unique = [...new Map(headers.map((c) => [c.items[1].location.ordinal, c])).values()];
  if (unique.length !== 1) return [];
  const header = unique[0],
    identity = header.items[1];
  const labelBoundary = Math.min(
    ...allHeaders.filter((c) => c.items[0] === header.items[0]).map((c) => c.left),
  );
  const owned = cells.filter(
    (c) => c.top <= identity.y && c.left <= identity.x && c.right >= identity.x + identity.width,
  );
  const facts: QualifiedFactArtifact[] = [];
  const ref = artifactReference('document_extraction', document);
  const evidence = (
    role: QualifiedFactEvidence['role'],
    item: PdfCell['items'][number],
    context = false,
  ): QualifiedFactEvidence => ({
    role,
    text: item.text,
    source_reference: document.source_capture,
    locator: item.location,
    ...(context ? { context: qualifiedContext('source_semantic', 'document-qualification') } : {}),
  });
  for (const value of owned) {
    const labels = cells.filter((c) => c.right <= labelBoundary && sameRow(grid, c, value));
    // More than one label column may represent group/quantity/condition. Until
    // that hierarchy is represented, do not choose a convenient nearest label.
    if (labels.length !== 1) continue;
    const label = labels[0];
    if (/^(?:models?|products?|versions?)\b/i.test(wording(label))) continue;
    const row = cells.filter((c) => sameRow(grid, c, value)).sort((a, b) => a.left - b.left);
    const notes = grid.items.filter(
      (i) => !cells.some((c) => c.items.includes(i)) && i.y < identity.y,
    );
    // The full retained non-cell page context is deliberately explicit. It can
    // include a rating note whose exact value scope has not been mechanically
    // established; downstream semantics must review unknown context, not ignore it.
    const context = notes;
    const spanningColumns = allHeaders.filter(
      (h) => h.items[0] === header.items[0] && h.left >= value.left && h.right <= value.right,
    );
    const unpartitioned =
      spanningColumns.length > 1 &&
      value.items.some((i) =>
        spanningColumns.some((h) => i.x >= h.left && i.x + i.width <= h.right),
      ) &&
      new Set(value.items.map((i) => i.text)).size > 1;
    facts.push(
      buildQualifiedFactArtifact({
        source_capture: document.source_capture,
        source_acquisition: document.source_acquisition,
        document_extraction: ref,
        acquisition_candidate_id: document.acquisition_candidate_id,
        metadata: {
          source_wording: wording(label),
          source_label: wording(label),
          raw_value: wording(value),
          raw_identifier: identity.text,
          applicability: unpartitioned
            ? {
                kind: 'unresolved',
                reason:
                  'undivided source cell contains multiple model-column values; no sibling value selection',
              }
            : {
                kind: 'exact_product',
                value: identity.text,
                reason:
                  'pdf-vector-grid.v1: literal model header and source-painted closed row/column boundaries; no SKU attestation',
              },
          ...(context.length
            ? {
                alternative_interpretations: [
                  'Unassigned source page context requires condition/section scope review.',
                ],
              }
            : {}),
        },
        evidence: [
          evidence('subject', identity),
          evidence('applicability', identity),
          ...label.items.map((i) => evidence('label', i)),
          ...value.items.map((i) => evidence('value', i)),
          ...context.map((i) => evidence('qualifier', i, true)),
          {
            role: 'context',
            text: PDF_VECTOR_STRUCTURE,
            source_reference: ref,
            locator: {
              ...value.items[0].location,
              table: block.locator.table,
              row:
                [...new Set(cells.map((c) => c.top))].sort((a, b) => b - a).indexOf(value.top) + 1,
              column: row.indexOf(value) + 1,
            },
            context: qualifiedContext('qualification_provenance', 'document-qualification'),
          },
        ],
        qualifier: PDF_VECTOR_STRUCTURE,
        qualifier_version: '1.0.0',
        qualification_state: unpartitioned ? 'ambiguous' : 'structurally_supported',
      }),
    );
  }
  return facts;
}
