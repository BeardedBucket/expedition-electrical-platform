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

const toSourceLocator = (
  locator: ExtractedDocument['blocks'][number]['locator'] | undefined,
  row?: string,
) => {
  if (!locator) return undefined;
  const filtered = {
    ...(locator.fragment !== undefined ? { fragment: locator.fragment } : {}),
    ...(locator.section !== undefined ? { section: locator.section } : {}),
    ...(locator.table !== undefined ? { table: locator.table } : {}),
    ...(locator.paragraph !== undefined ? { paragraph: locator.paragraph } : {}),
    ...(locator.page !== undefined ? { page: locator.page } : {}),
    ...(row !== undefined ? { row } : {}),
  };
  return Object.keys(filtered).length ? filtered : undefined;
};

export const extractProductFacts = (
  document: ExtractedDocument,
  context: ProductFactExtractionContext,
): FactExtractionResult => {
  const unsupportedWarnings = new Set([
    'pdf_unsupported',
    'unsupported_media_type',
    'source_empty',
    'missing_text_body',
  ]);
  if (
    document.status === 'unsupported' ||
    document.warnings.some((warning) => unsupportedWarnings.has(warning.code)) ||
    (document.source.media_type !== 'text/html' && !document.blocks.length)
  ) {
    return { status: 'unsupported', facts: [], warnings: document.warnings };
  }
  const facts: ProductFact[] = [];
  document.blocks.forEach((block) => {
    if (block.rows) {
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
          ...(toSourceLocator(block.locator, String(rowIndex + 1))
            ? { source_locator: toSourceLocator(block.locator, String(rowIndex + 1)) }
            : {}),
          extraction_method:
            context.extraction_method ?? (block.kind === 'table' ? 'table' : 'structured'),
          review_required: true,
          transformation_notes: 'Raw claim only; no semantic mapping or unit conversion performed.',
          fact_state: 'provisional',
        });
      });
    }
    if (
      context.include_text_blocks &&
      (block.kind === 'paragraph' || block.kind === 'list') &&
      block.text
    ) {
      facts.push({
        schema_version: context.schema_version ?? '1.0',
        id: stableId(context.source_id, facts.length, block.kind, block.text),
        source_id: context.source_id,
        field: 'unmapped',
        raw_label: block.kind,
        raw_value: block.text,
        ...(toSourceLocator(block.locator)
          ? { source_locator: toSourceLocator(block.locator) }
          : {}),
        extraction_method: 'text',
        review_required: true,
        transformation_notes:
          'Raw text claim only; no semantic mapping, interpretation, or compatibility conclusion.',
        fact_state: 'provisional',
      });
    }
  });
  return { status: facts.length ? 'success' : 'partial', facts, warnings: document.warnings };
};
