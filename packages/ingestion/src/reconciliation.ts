import {
  isSourceApplicable,
  type JsonValue,
  type ProductIdentity,
  type ProductSource,
} from './contracts.js';
import type {
  ProductReconciliationInput,
  ProductReconciliationResult,
  ReconciledField,
  ReconciliationIssue,
  NormalizedProductFact,
} from './normalization-types.js';

export const SOURCE_AUTHORITY_POLICY = {
  order: {
    manufacturer_technical: 0,
    manufacturer_product: 1,
    manufacturer_support: 2,
    authorized_distributor: 3,
    secondary_distributor: 4,
    community_or_social: 5,
    unknown: 6,
  } as const,
  description:
    'manufacturer technical documentation > manufacturer product page > manufacturer support > authorized distributor > secondary reseller > community/social',
  normalizeCase: true,
  trimWhitespace: true,
  collapseInternalWhitespace: true,
  stripPunctuation: false,
  stripSuffixes: false,
} as const;

export const sourceAuthorityOrder = (authority: ProductSource['authority']): number =>
  SOURCE_AUTHORITY_POLICY.order[authority];

export const normalizeIdentityValueForComparison = (
  field: keyof ProductIdentity | string | undefined,
  value: string | undefined,
): string | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  const shouldLowerCase =
    field === undefined ||
    field === 'manufacturer' ||
    field === 'product_family' ||
    field === 'model' ||
    field === 'manufacturer_part_number' ||
    field === 'regional_variant' ||
    field === 'voltage_variant' ||
    field === 'hardware_revision' ||
    field === 'lifecycle_status';
  return shouldLowerCase ? normalized.toLocaleLowerCase() : normalized;
};

const canonicalNumericValue = (value: JsonValue): JsonValue => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(12));
  }
  return value;
};

const stableJson = (value: JsonValue): string => JSON.stringify(canonicalNumericValue(value));
const identityFields: readonly (keyof ProductIdentity)[] = [
  'manufacturer',
  'product_family',
  'model',
  'manufacturer_part_number',
  'regional_variant',
  'voltage_variant',
  'hardware_revision',
  'lifecycle_status',
];
const identitiesCompatible = (left: ProductIdentity, right: ProductIdentity): boolean =>
  identityFields.every((field) => {
    const leftValue = left[field];
    const rightValue = right[field];
    if (leftValue === undefined || rightValue === undefined) return true;
    return (
      normalizeIdentityValueForComparison(field, String(leftValue)) ===
      normalizeIdentityValueForComparison(field, String(rightValue))
    );
  });

const sortNormalized = (facts: readonly NormalizedProductFact[]): NormalizedProductFact[] =>
  [...new Map(facts.map((fact) => [fact.fact.id, fact])).values()].sort((left, right) => {
    const authorityDifference =
      sourceAuthorityOrder(left.source_authority) - sourceAuthorityOrder(right.source_authority);
    return authorityDifference || left.fact.id.localeCompare(right.fact.id);
  });

const issue = (
  code: ReconciliationIssue['code'],
  message: string,
  facts: readonly NormalizedProductFact[] = [],
  field?: string,
  values?: readonly JsonValue[],
  sourceIds?: readonly string[],
): ReconciliationIssue => ({
  code,
  message,
  ...(field ? { field } : {}),
  fact_ids: facts.map((item) => item.fact.id).sort(),
  source_ids: [...new Set(sourceIds ?? facts.map((item) => item.source.id))].sort(),
  ...(values ? { values } : {}),
});

const identityStatus = (
  identity: ProductIdentity,
  sources: readonly ProductSource[],
): 'verified' | 'provisional' | 'unresolved' | 'conflicting' => {
  const claims = sources
    .map((source) => source.product_identity_claim)
    .filter((claim): claim is NonNullable<ProductSource['product_identity_claim']> =>
      Boolean(claim),
    );
  if (
    !claims.length ||
    !claims.every((claim) => identitiesCompatible(identity, claim)) ||
    !claims.every((claim, index) =>
      claims.slice(index + 1).every((otherClaim) => identitiesCompatible(claim, otherClaim)),
    )
  )
    return 'unresolved';
  const requiredIdentityFields = ['manufacturer', 'model', 'manufacturer_part_number'] as const;
  return requiredIdentityFields.every((field) => identity[field] !== undefined)
    ? 'verified'
    : 'provisional';
};

export const reconcileProductFacts = (
  input: ProductReconciliationInput,
): ProductReconciliationResult => {
  const knownFactIds = new Set(input.facts.map((fact) => fact.id));
  const knownSourceIds = new Set(input.sources.map((source) => source.id));
  const normalized = sortNormalized(
    input.normalized_facts.filter(
      (item) =>
        knownFactIds.has(item.fact.id) &&
        knownSourceIds.has(item.source.id) &&
        isSourceApplicable(item.source, {
          legacy_undefined_applicability: input.legacy_undefined_applicability === true,
        }),
    ),
  );
  const issues: ReconciliationIssue[] = [];
  const identityIssues = input.sources
    .filter(
      (source) =>
        source.product_identity_claim &&
        !identitiesCompatible(input.identity, source.product_identity_claim),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((source) =>
      issue(
        'reconciliation_variant_mismatch',
        `Source '${source.id}' does not match the candidate identity.`,
        [],
        undefined,
        undefined,
        [source.id],
      ),
    );
  const claims = input.sources
    .filter((source) => source.product_identity_claim)
    .sort((left, right) => left.id.localeCompare(right.id));
  const variantIssues: ReconciliationIssue[] = [];
  for (let index = 0; index < claims.length; index += 1) {
    for (const other of claims.slice(index + 1)) {
      const leftClaim = claims[index].product_identity_claim;
      const rightClaim = other.product_identity_claim;
      if (leftClaim && rightClaim && !identitiesCompatible(leftClaim, rightClaim)) {
        variantIssues.push(
          issue(
            'reconciliation_variant_mismatch',
            `Sources '${claims[index].id}' and '${other.id}' contain incompatible identity claims.`,
            [],
            undefined,
            undefined,
            [claims[index].id, other.id],
          ),
        );
      }
    }
  }
  issues.push(...identityIssues, ...variantIssues);
  const status =
    identityIssues.length || variantIssues.length
      ? 'conflicting'
      : identityStatus(input.identity, input.sources);
  if (status === 'unresolved') {
    issues.push(
      issue(
        'reconciliation_identity_unresolved',
        'Product identity is not fully supported by compatible source claims.',
        [],
        undefined,
        undefined,
        input.sources.map((source) => source.id),
      ),
    );
  }

  const fields: ReconciledField[] = [];
  const targetKeys = [
    ...new Set(normalized.map((item) => `${item.target_kind}::${item.canonical_field}`)),
  ].sort();
  for (const targetKey of targetKeys) {
    const separator = targetKey.indexOf('::');
    const targetKind = targetKey.slice(0, separator) as NormalizedProductFact['target_kind'];
    const field = targetKey.slice(separator + 2);
    const facts = normalized.filter(
      (item) => item.target_kind === targetKind && item.canonical_field === field,
    );
    const values = [
      ...new Map(facts.map((item) => [stableJson(item.normalized_value), item])).values(),
    ];
    const hasUnresolvedState = facts.some((item) => item.fact.fact_state === 'unresolved');
    if (values.length !== 1 || hasUnresolvedState) {
      issues.push(
        issue(
          values.length !== 1
            ? 'reconciliation_value_conflict'
            : 'reconciliation_insufficient_evidence',
          values.length !== 1
            ? `Conflicting normalized values exist for '${field}'.`
            : `No usable evidence exists for '${field}'.`,
          facts,
          field,
          values.map((item) => canonicalNumericValue(item.normalized_value)),
        ),
      );
      continue;
    }
    const representative = values[0];
    fields.push({
      field,
      value: canonicalNumericValue(representative.normalized_value),
      unit: representative.normalized_unit,
      fact_ids: facts.map((item) => item.fact.id).sort(),
      source_ids: [...new Set(facts.map((item) => item.source.id))].sort(),
      states: [...new Set(facts.map((item) => item.fact.fact_state))].sort(),
      target_kind: targetKind,
    });
  }
  return {
    identity_status: status,
    fields,
    conflicts: issues.filter((item) =>
      ['reconciliation_value_conflict', 'reconciliation_variant_mismatch'].includes(item.code),
    ),
    issues,
    review_required:
      issues.length > 0 ||
      normalized.some(
        (item) => item.fact.fact_state === 'provisional' || item.fact.review_required === true,
      ),
  };
};
