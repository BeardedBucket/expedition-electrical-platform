import { createHash } from 'node:crypto';
import type { ProductFact } from './contracts.js';
import type {
  ExtractedDocument,
  FactExtractionResult,
  ProductFactExtractionContext,
} from './capture-types.js';

const stableId = (sourceId: string, index: number, label: string, value: string): string => {
  const digest = createHash('sha256')
    .update(`${sourceId}|${index}|${label}|${value}`)
    .digest('hex')
    .slice(0, 16);
  return `extracted.fact.${digest}`;
};

const rawUnit = (value: string): string | undefined => {
  const match = value.match(/^\s*[-+]?(?:\d+(?:\.\d+)?|\.\d+)\s+([A-Za-z%°Ω]+)\s*$/);
  return match?.[1];
};

export const extractProductFacts = (
  document: ExtractedDocument,
  context: ProductFactExtractionContext,
): FactExtractionResult => {
  if (
    document.warnings.some(
      (warning) => warning.code === 'pdf_unsupported' || warning.code === 'unsupported_media_type',
    )
  ) {
    return { status: 'unsupported', facts: [], warnings: document.warnings };
  }
  const facts: ProductFact[] = [];
  document.blocks.forEach((block) => {
    if (!block.rows) return;
    block.rows.forEach((row, rowIndex) => {
      const rawUnitValue = rawUnit(row.value);
      facts.push({
        schema_version: context.schema_version ?? '1.0',
        id: stableId(context.source_id, facts.length + rowIndex, row.label, row.value),
        source_id: context.source_id,
        field: 'unmapped',
        raw_label: row.label,
        raw_value: row.value,
        ...(rawUnitValue ? { raw_unit: rawUnitValue } : {}),
        source_locator: { ...block.locator, row: String(rowIndex + 1) },
        extraction_method:
          context.extraction_method ?? (block.kind === 'table' ? 'table' : 'structured'),
        review_required: true,
        transformation_notes: 'Raw claim only; no semantic mapping or unit conversion performed.',
        fact_state: 'provisional',
      });
    });
  });
  return { status: facts.length ? 'success' : 'partial', facts, warnings: document.warnings };
};
