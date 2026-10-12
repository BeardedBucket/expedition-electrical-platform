import type {
  DocumentExtractionArtifact,
  DocumentQualificationTarget,
  QualifiedFactEvidence,
} from './production-contracts.js';

/** Exact source-authored ordering matrix, never model-name similarity. It only
 * establishes a relation inside this complete extraction; another document must
 * supply its own linkage before using the relation. Spans are not expanded. */
export const exactModelPartRelation = (
  document: DocumentExtractionArtifact,
  target: DocumentQualificationTarget,
): readonly QualifiedFactEvidence[] | undefined => {
  if (document.status !== 'extracted' || !target.manufacturer_part_number || !target.product_model)
    return undefined;
  if (
    document.diagnostics?.some((d) =>
      /limit_reached|partial_table_extraction|snapshot_read_failure/.test(d.code),
    )
  )
    return undefined;
  const matches: QualifiedFactEvidence[][] = [];
  let modelRows = 0,
    partRows = 0;
  for (const block of document.blocks) {
    if (block.kind !== 'table' || !block.cells?.length) continue;
    const cells = block.cells;
    if (cells.some((c) => (c.colspan ?? 1) !== 1 || (c.rowspan ?? 1) !== 1)) continue;
    const positions = cells.map((c) => `${c.row}:${c.column}`);
    if (
      new Set(positions).size !== positions.length ||
      cells.some(
        (c) =>
          !Number.isInteger(c.row) ||
          !Number.isInteger(c.column) ||
          c.row < 1 ||
          c.column < 1 ||
          c.source_location.row !== c.row ||
          c.source_location.column !== c.column ||
          !c.source_location.path ||
          c.source_location.table !== block.locator.table ||
          c.source_location.path !== `${block.locator.path}/tr[${c.row}]/cell[${c.column}]`,
      )
    )
      continue;
    const headers = cells.filter((c) => c.row === 1 && c.kind === 'header');
    const models = headers.filter((c) => /^(?:model|model name)$/i.test(c.value.trim()));
    const parts = headers.filter((c) =>
      /^(?:part number|mpn|sku|ordering code)$/i.test(c.value.trim()),
    );
    if (models.length !== 1 || parts.length !== 1 || models[0].column === parts[0].column) continue;
    for (const row of [...new Set(cells.filter((c) => c.row > 1).map((c) => c.row))]) {
      const m = cells.filter(
        (c) => c.row === row && c.column === models[0].column && c.kind === 'data',
      );
      const p = cells.filter(
        (c) => c.row === row && c.column === parts[0].column && c.kind === 'data',
      );
      if (m.length === 1 && m[0].value.trim() === target.product_model.trim()) modelRows++;
      if (p.length === 1 && p[0].value.trim() === target.manufacturer_part_number.trim())
        partRows++;
      if (
        m.length !== 1 ||
        p.length !== 1 ||
        m[0].value.trim() !== target.product_model.trim() ||
        p[0].value.trim() !== target.manufacturer_part_number.trim()
      )
        continue;
      if (
        !m[0].source_location.path ||
        !p[0].source_location.path ||
        m[0].source_location.row !== row ||
        p[0].source_location.row !== row ||
        m[0].source_location.table !== p[0].source_location.table
      )
        continue;
      matches.push(
        [m[0], p[0]].map((c) => ({
          role: 'applicability',
          text: c.value,
          locator: c.source_location,
          source_reference: document.source_capture,
          note: 'exact-model-part-relation.v1: distinct explicit model and ordering identifier cells in one source row',
        })),
      );
    }
  }
  return matches.length === 1 && modelRows === 1 && partRows === 1 ? matches[0] : undefined;
};
