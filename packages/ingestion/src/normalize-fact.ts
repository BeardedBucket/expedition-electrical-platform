import type { ProductFact, ProductSource } from './contracts.js';
import { resolveCanonicalField, isSupportedCanonicalField } from './field-mapping.js';
import { parseExactUnitValue, resolveUnit } from './units.js';
import type { NormalizationIssue, ProductFactNormalizationResult } from './normalization-types.js';

const issue = (code: NormalizationIssue['code'], message: string): NormalizationIssue => ({
  code,
  message,
});

export const normalizeProductFact = (
  fact: ProductFact,
  source: ProductSource,
): ProductFactNormalizationResult => {
  const mapping = resolveCanonicalField(fact.raw_label);
  if (!mapping) {
    return {
      status: 'unresolved',
      issues: [
        issue(
          'normalization_unmapped_field',
          `No explicit mapping exists for '${fact.raw_label}'.`,
        ),
      ],
    };
  }
  if (!isSupportedCanonicalField(mapping.canonical_field)) {
    return {
      status: 'invalid',
      issues: [
        issue(
          'normalization_canonical_field_unsupported',
          `Canonical field '${mapping.canonical_field}' is not supported.`,
        ),
      ],
    };
  }
  const parsed = parseExactUnitValue(fact.raw_value, fact.raw_unit);
  if (!parsed) {
    const invalidNumber =
      (typeof fact.raw_value === 'number' && !Number.isFinite(fact.raw_value)) ||
      (typeof fact.raw_value === 'string' && /(?:NaN|Infinity)/i.test(fact.raw_value.trim()));
    const embeddedUnit =
      typeof fact.raw_value === 'string'
        ? fact.raw_value.match(/^\s*[-+]?(?:\d+(?:\.\d+)?|\.\d+)\s*([A-Za-z°Ωω]+)\s*$/)?.[1]
        : undefined;
    const unitText = fact.raw_unit ?? embeddedUnit;
    const unsupported = unitText !== undefined && !resolveUnit(unitText);
    return {
      status: 'unresolved',
      issues: [
        issue(
          invalidNumber
            ? 'normalization_invalid_number'
            : unsupported
              ? 'normalization_unsupported_unit'
              : 'normalization_ambiguous_value',
          unsupported
            ? `Unit '${unitText}' is not supported.`
            : invalidNumber
              ? `Value '${String(fact.raw_value)}' is not a finite number.`
              : `Value '${String(fact.raw_value)}' is not an exact, unqualified measurement.`,
        ),
      ],
    };
  }
  if (parsed.unit.dimension !== mapping.dimension) {
    return {
      status: 'unresolved',
      issues: [
        issue(
          'normalization_dimension_mismatch',
          `Unit '${parsed.unit.symbol}' has dimension '${parsed.unit.dimension}', expected '${mapping.dimension}'.`,
        ),
      ],
    };
  }
  const value = parsed.unit.toCanonical(parsed.value);
  if (!Number.isFinite(value)) {
    return {
      status: 'invalid',
      issues: [issue('normalization_invalid_number', 'Normalized number is not finite.')],
    };
  }
  const normalizedFact: ProductFact = {
    ...fact,
    field: mapping.canonical_field,
    normalized_value: value,
    normalized_unit: mapping.unit,
    transformation_notes: [
      fact.transformation_notes,
      `Explicit mapping '${fact.raw_label}' -> '${mapping.canonical_field}'.`,
      parsed.unit.symbol === mapping.unit
        ? undefined
        : `Converted ${parsed.unit.symbol} to ${mapping.unit}.`,
    ]
      .filter(Boolean)
      .join(' '),
  };
  return {
    status: 'normalized',
    fact: {
      fact: normalizedFact,
      source,
      canonical_field: mapping.canonical_field,
      normalized_value: value,
      normalized_unit: mapping.unit,
      dimension: mapping.dimension,
      source_authority: source.authority,
    },
    issues: [],
  };
};
