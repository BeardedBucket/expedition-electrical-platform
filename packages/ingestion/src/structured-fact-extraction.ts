import { createHash } from 'node:crypto';
import type { JsonObject, JsonValue, ProductFact, ProductSource } from './contracts.js';
import type { StructuredFactMapping } from './manufacturer-acquisition.js';
import { normalizeProductFact } from './normalize-fact.js';
import type { NormalizedProductFact } from './normalization-types.js';

const valueAtPath = (record: JsonObject, path: string): JsonValue | undefined => {
  const segments = path.split('.');
  let value: JsonValue = record;
  for (const segment of segments) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !Object.hasOwn(value, segment)
    ) {
      return undefined;
    }
    value = value[segment];
  }
  return value;
};

const stableId = (sourceId: string, path: string, value: JsonValue): string =>
  `extracted.fact.${createHash('sha256')
    .update(`${sourceId}|${path}|${JSON.stringify(value)}`)
    .digest('hex')
    .slice(0, 16)}`;

export interface StructuredFactExtractionResult {
  readonly facts: readonly ProductFact[];
  readonly normalized_facts: readonly NormalizedProductFact[];
}

export const extractStructuredProductFacts = (input: {
  readonly source: ProductSource;
  readonly raw_record: JsonObject;
  readonly record_locator: {
    readonly script_id: string;
    readonly json_path: string;
    readonly record_collection_path: string;
    readonly record_index: number;
  };
  readonly mappings: readonly StructuredFactMapping[];
}): StructuredFactExtractionResult => {
  const facts: ProductFact[] = [];
  const normalized_facts: NormalizedProductFact[] = [];
  input.mappings.forEach((mapping) => {
    const rawValue = valueAtPath(input.raw_record, mapping.source_path);
    if (rawValue === undefined) return;
    const fact: ProductFact = {
      schema_version: '1.0',
      id: stableId(input.source.id, mapping.source_path, rawValue),
      source_id: input.source.id,
      field: 'unmapped',
      raw_label: mapping.raw_label,
      raw_value: rawValue,
      ...(mapping.source_unit ? { raw_unit: mapping.source_unit } : {}),
      source_locator: {
        fragment: `${input.record_locator.script_id}:${input.record_locator.json_path}:${input.record_locator.record_collection_path}[${input.record_locator.record_index}].${mapping.source_path}`,
      },
      extraction_method: 'structured',
      review_required: true,
      transformation_notes: `Reviewed structured mapping '${mapping.source_path}' -> '${mapping.raw_label}'.`,
      fact_state: 'provisional',
    };
    const normalized = normalizeProductFact(fact, input.source);
    facts.push(fact);
    if (normalized.status === 'normalized' && normalized.fact)
      normalized_facts.push(normalized.fact);
  });
  return { facts, normalized_facts };
};
