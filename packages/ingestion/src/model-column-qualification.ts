import { qualifiedContext } from './qualified-context.js';
import type {
  ApplicabilityBinding,
  DocumentBlock,
  DocumentExtractionArtifact,
  DocumentQualificationTarget,
  QualifiedFactEvidence,
} from './production-contracts.js';

type Cell = NonNullable<DocumentBlock['cells']>[number];

/** A two-cell source header explicitly names a device class and exact model.
 * Full-span section rows change forward context; they never become ratings or
 * apply backward. This differs from a multi-model column matrix: the sole value
 * column belongs to the named product, with no span expansion or MPN inference.
 */
export const modelHeaderPairObservations = (
  document: DocumentExtractionArtifact,
  block: DocumentBlock,
  target: DocumentQualificationTarget,
) => {
  if (
    document.status !== 'extracted' ||
    !document.source_acquisition ||
    !block.cells?.length ||
    block.locator.kind !== 'html' ||
    !block.locator.path ||
    !block.locator.table ||
    document.diagnostics?.some((d) => /limit_reached|partial|snapshot/.test(d.code)) ||
    document.blocks.some(
      (b) =>
        b !== block && b.kind === 'table' && b.locator.path?.startsWith(`${block.locator.path}/`),
    )
  )
    return undefined;
  const rows = new Map<number, Cell[]>();
  for (const cell of block.cells) {
    if (
      !Number.isSafeInteger(cell.row) ||
      cell.row < 1 ||
      ![1, 2].includes(cell.column) ||
      (cell.rowspan ?? 1) !== 1 ||
      ![1, 2].includes(cell.colspan ?? 1) ||
      cell.label !== cell.value ||
      cell.source_location.kind !== 'html' ||
      cell.source_location.table !== block.locator.table ||
      cell.source_location.row !== cell.row ||
      cell.source_location.column !== cell.column ||
      cell.source_location.path !== `${block.locator.path}/tr[${cell.row}]/cell[${cell.column}]`
    )
      return undefined;
    const row = rows.get(cell.row) ?? [];
    if (row.some((c) => c.column === cell.column)) return undefined;
    rows.set(cell.row, [...row, cell]);
  }
  const ordered = [...rows].sort(([a], [b]) => a - b);
  if (ordered.some(([number], index) => number !== index + 1)) return undefined;
  const header = ordered[0]?.[1].sort((a, b) => a.column - b.column);
  if (
    !header ||
    header.length !== 2 ||
    header.some((c) => c.kind !== 'header' || (c.colspan ?? 1) !== 1) ||
    !/^(?:model|product|(?:battery )?monitor|inverter(?:[ /-]charger)?|(?:solar )?charge controller|charger|converter|battery|power station)$/i.test(
      header[0].value.trim(),
    ) ||
    header[1].value.trim() !== target.product_model?.trim() ||
    target.target_identifier
  )
    return undefined;
  const identity = header[1];
  const applicability: ApplicabilityBinding = {
    kind: 'exact_product',
    value: identity.value.trim(),
    reason:
      'model-header-pair-scope.v1: unique two-cell device/model header; source section context retained; MPN not independently established',
  };
  let context: Cell[] = [];
  const observations: { label: Cell; value: Cell; context: readonly Cell[] }[] = [];
  for (const [, row] of ordered.slice(1)) {
    row.sort((a, b) => a.column - b.column);
    if (row.length === 1 && row[0].column === 1 && row[0].kind === 'data' && row[0].colspan === 2) {
      context = [row[0]];
      continue;
    }
    if (
      row.length !== 2 ||
      row[0].column !== 1 ||
      row[1].column !== 2 ||
      row.some((c) => c.kind !== 'data' || (c.colspan ?? 1) !== 1) ||
      /^(?:models?|variants?|sku|mpn|part number)$/i.test(row[0].value.trim())
    )
      return undefined;
    if (row[0].value.trim() && row[1].value.trim())
      observations.push({ label: row[0], value: row[1], context: [...context] });
  }
  const evidence = (role: QualifiedFactEvidence['role'], cell: Cell): QualifiedFactEvidence => ({
    role,
    text: cell.value,
    locator: cell.source_location,
    source_reference: document.source_capture,
    ...(role === 'qualifier'
      ? { context: qualifiedContext('source_semantic', 'model-column-qualification') }
      : {}),
  });
  return observations.map(({ label, value, context }) => ({
    label,
    value,
    identity,
    applicability,
    evidence: [
      evidence('subject', identity),
      evidence('applicability', identity),
      evidence('label', label),
      evidence('value', value),
      {
        ...evidence('context', header[0]),
        context: qualifiedContext('qualification_provenance', 'model-column-qualification'),
      },
      ...context.map((c) => evidence('qualifier', c)),
    ],
  }));
};

/** model-column-scope.v1 does not expand spans or borrow adjacent values. Missing
 * cells stay missing. Context is retained in source order, without inferring
 * section boundaries or assigning a later note to an earlier observation.
 * Exact data-row and whole-table qualification retain precedence in the caller.
 */
export const modelColumnObservations = (
  document: DocumentExtractionArtifact,
  block: DocumentBlock,
  target: DocumentQualificationTarget,
):
  | readonly {
      label: Cell;
      value: Cell;
      identity: Cell;
      applicability: ApplicabilityBinding;
      evidence: readonly QualifiedFactEvidence[];
    }[]
  | undefined => {
  if (
    document.status !== 'extracted' ||
    document.source_acquisition?.kind !== 'source_acquisition' ||
    document.source_capture.kind !== 'source_capture' ||
    block.locator.kind !== 'html' ||
    !block.locator.path ||
    !block.locator.table ||
    !block.cells?.length ||
    document.diagnostics?.some((d) => /limit_reached|partial|snapshot/.test(d.code)) ||
    document.blocks.some(
      (b) =>
        b !== block && b.locator.path?.startsWith(`${block.locator.path}/`) && b.kind === 'table',
    )
  )
    return undefined;
  const rows = new Map<number, Cell[]>();
  for (const cell of block.cells) {
    if (
      !Number.isSafeInteger(cell.row) ||
      cell.row < 1 ||
      !Number.isSafeInteger(cell.column) ||
      cell.column < 1 ||
      !Number.isSafeInteger(cell.colspan ?? 1) ||
      (cell.colspan ?? 1) < 1 ||
      (cell.rowspan ?? 1) !== 1 ||
      cell.label !== cell.value ||
      cell.source_location.kind !== 'html' ||
      cell.source_location.table !== block.locator.table ||
      cell.source_location.row !== cell.row ||
      cell.source_location.column !== cell.column ||
      cell.source_location.path !== `${block.locator.path}/tr[${cell.row}]/cell[${cell.column}]`
    )
      return undefined;
    const row = rows.get(cell.row) ?? [];
    if (row.some((c) => c.column === cell.column)) return undefined;
    row.push(cell);
    rows.set(cell.row, row);
  }
  const header = rows.get(1)?.sort((a, b) => a.column - b.column);
  if (
    !header ||
    header.length < 3 ||
    header.some((c, n) => c.kind !== 'header' || c.column !== n + 1 || (c.colspan ?? 1) !== 1) ||
    !/^(?:models?|sku|variants?)$/i.test(header[0].value.trim())
  )
    return undefined;
  if (new Set(header.map((c) => c.value.trim())).size !== header.length) return undefined;
  const identifiers = target.target_identifier
    ? [target.target_identifier.trim()]
    : [target.manufacturer_part_number?.trim(), target.product_model?.trim()].filter(
        (v): v is string => Boolean(v),
      );
  const matches = header.slice(1).filter((c) => identifiers.includes(c.value.trim()));
  if (matches.length !== 1) return undefined;
  const identity = matches[0];
  if (identity.scope !== undefined && identity.scope !== 'col' && identity.scope !== 'colgroup')
    return undefined;
  const applicability: ApplicabilityBinding = {
    kind:
      identity.value.trim() === target.manufacturer_part_number?.trim() || target.target_identifier
        ? 'exact_mpn_or_sku'
        : 'exact_product',
    value: identity.value.trim(),
    reason:
      'model-column-scope.v1: unique exact header, source DOM column, no span expansion or sibling-value transfer',
  };
  const notes: Cell[] = [];
  const footnotes: Cell[] = [];
  // A merged footnote is context, never a specification value. Its source span
  // is retained; no sibling quantity is expanded or copied. Only the explicit
  // '*' marker can link it to a marked target value, and only within its columns.
  // Unknown merged text, repeated markers and merged rating cells still reject
  // the matrix. This deliberately supports one closed footnote syntax, not NLP.
  for (const [number, row] of rows) {
    if (number === 1 || !row.some((c) => (c.colspan ?? 1) > 1)) continue;
    if (
      row.length !== 1 ||
      row[0].kind !== 'data' ||
      row[0].column <= 1 ||
      row[0].column + (row[0].colspan ?? 1) - 1 > header.length ||
      !/^\*[^*]+$/.test(row[0].value.trim()) ||
      footnotes.length
    )
      return undefined;
    footnotes.push(row[0]);
  }
  const observations: { label: Cell; value: Cell; notes: readonly Cell[] }[] = [];
  for (const [number, row] of [...rows.entries()].sort(([a], [b]) => a - b)) {
    if (number === 1) continue;
    if (footnotes.includes(row[0])) continue;
    if (row.some((c) => c.column > header.length || (c.column > 1 && c.kind === 'header')))
      return undefined;
    const label = row.find((c) => c.column === 1);
    if (!label || !label.value.trim()) {
      notes.push(...row.filter((c) => c.value.trim()));
      continue;
    }
    // Identity-bearing labels would introduce a second axis/section. Reject the
    // whole matrix rather than silently reusing the first header after it.
    if (
      /^(?:models?|sku|variants?|part\s*number)$/i.test(label.value.trim()) ||
      header.slice(1).some((c) => c.value.trim() === label.value.trim())
    )
      return undefined;
    const value = row.find((c) => c.column === identity.column);
    // A source-declared separator/section with no variant values can change
    // the meaning of later rows. Preserve it as forward context. No source
    // structure here establishes global/backward scope or a section reset.
    if (row.length === 1) {
      notes.push(label);
      continue;
    }
    if (!value || !value.value.trim() || !label.value.trim()) continue;
    // Copy at the observation's source position: later notes cannot mutate its
    // evidence. Accumulated context remains conservative for subsequent rows.
    const marked = /\*$/.test(value.value.trim()) || /\*$/.test(label.value.trim());
    const linkedNotes = marked
      ? footnotes.filter(
          (note) =>
            identity.column >= note.column && identity.column < note.column + (note.colspan ?? 1),
        )
      : [];
    // A dangling marker is not silently treated as an unconditional quantity.
    if (marked && linkedNotes.length !== 1) return undefined;
    observations.push({ label, value, notes: [...notes, ...linkedNotes] });
  }
  const evidence = (role: QualifiedFactEvidence['role'], cell: Cell): QualifiedFactEvidence => ({
    role,
    ...(role === 'qualifier'
      ? { context: qualifiedContext('source_semantic', 'model-column-qualification') }
      : {}),
    text: cell.value,
    source_reference: document.source_capture,
    locator: cell.source_location,
  });
  return observations.map(({ label, value, notes: context }) => ({
    label,
    value,
    identity,
    applicability,
    evidence: [
      { ...evidence('applicability', identity), note: applicability.reason },
      evidence('subject', identity),
      evidence('label', label),
      evidence('value', value),
      ...context.map((note) => evidence('qualifier', note)),
    ],
  }));
};
