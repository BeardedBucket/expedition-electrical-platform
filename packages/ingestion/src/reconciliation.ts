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
import {
  artifactDigest,
  deterministicSerialize,
  type ApplicabilityBinding,
  type ApplicabilityKind,
  type QualifiedFactArtifact,
  type SourceAcquisitionArtifact,
} from './production-contracts.js';
import { parseExactUnitValue } from './units.js';

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

/**
 * The identity-bearing subset of `ApplicabilityBinding` used for
 * reconciliation grouping. `kind` and `value` identify which product/variant/
 * statement target the fact applies to and remain identity-bearing. `reason`
 * is explanatory/provenance metadata describing *why* the applicability was
 * bound (e.g. how it was inferred) — it never changes what the fact applies
 * to, so it must not split two otherwise identical facts into different
 * comparison groups.
 */
export interface QualifiedFactApplicabilityIdentity {
  readonly kind: ApplicabilityKind;
  readonly value?: string;
}

const qualifiedFactApplicabilityIdentity = (
  applicability: ApplicabilityBinding,
): QualifiedFactApplicabilityIdentity => ({
  kind: applicability.kind,
  ...(applicability.value !== undefined ? { value: applicability.value } : {}),
});

export interface QualifiedFactComparisonGroupKey {
  readonly reconciliation_scope: QualifiedFactReconciliationScope;
  readonly applicability: QualifiedFactApplicabilityIdentity;
  readonly source_wording: string;
}

export type QualifiedFactReconciliationScope =
  | { readonly kind: 'acquisition_candidate'; readonly intake_digest: string; readonly id: string }
  | { readonly kind: 'product_intake'; readonly digest: string };

export interface QualifiedFactComparisonGroup {
  readonly id: string;
  readonly key: QualifiedFactComparisonGroupKey;
  readonly qualified_fact_ids: readonly string[];
}

export interface QualifiedFactGroupingResult {
  readonly groups: readonly QualifiedFactComparisonGroup[];
  readonly unscoped_qualified_fact_ids: readonly string[];
  readonly scope_inconsistent_qualified_fact_ids: readonly string[];
  /**
   * Qualified facts that otherwise have a comparable reconciliation scope but
   * lack an explicit value-independent `metadata.source_label`. These facts
   * are never heuristically labeled from `source_wording` (which may contain
   * the asserted value itself); they are preserved here rather than grouped.
   */
  readonly label_unavailable_qualified_fact_ids: readonly string[];
}

export interface QualifiedFactGroupingInput {
  readonly facts: readonly QualifiedFactArtifact[];
  readonly source_acquisitions: readonly SourceAcquisitionArtifact[];
}

export type QualifiedFactScalarComparisonOutcome = 'equal' | 'different' | 'unresolved';

export interface QualifiedFactScalarComparisonMember {
  readonly qualified_fact_id: string;
  readonly raw_value: QualifiedFactArtifact['metadata']['raw_value'];
  readonly source_unit?: string;
}

export interface QualifiedFactScalarComparisonResult {
  readonly id: string;
  readonly outcome: QualifiedFactScalarComparisonOutcome;
  readonly members: readonly [
    QualifiedFactScalarComparisonMember,
    QualifiedFactScalarComparisonMember,
  ];
}

export type QualifiedFactGroupReconciliationOutcome = 'agreement' | 'conflict' | 'unresolved';

export interface QualifiedFactGroupReconciliationResult {
  readonly id: string;
  readonly comparison_group_id: string;
  readonly qualified_fact_ids: readonly string[];
  readonly comparisons: readonly QualifiedFactScalarComparisonResult[];
  readonly unresolved_qualified_fact_ids: readonly string[];
  readonly has_unresolved_comparisons: boolean;
  readonly outcome: QualifiedFactGroupReconciliationOutcome;
}

export interface QualifiedFactWholeIntakeReconciliationInput {
  readonly facts: readonly QualifiedFactArtifact[];
  readonly source_acquisitions: readonly SourceAcquisitionArtifact[];
}

export interface QualifiedFactWholeIntakeReconciliationResult {
  readonly id: string;
  readonly qualified_fact_ids: readonly string[];
  readonly groups: readonly QualifiedFactComparisonGroup[];
  readonly group_reconciliations: readonly QualifiedFactGroupReconciliationResult[];
  readonly unscoped_qualified_fact_ids: readonly string[];
  readonly scope_inconsistent_qualified_fact_ids: readonly string[];
  readonly label_unavailable_qualified_fact_ids: readonly string[];
  readonly agreement_count: number;
  readonly conflict_count: number;
  readonly unresolved_count: number;
  readonly has_conflicts: boolean;
  readonly has_unresolved: boolean;
}

const normalizeQualifiedFactWording = (wording: string): string =>
  wording.trim().replace(/\s+/g, ' ');

const stableQualifiedFactComparisonMembers = (
  left: QualifiedFactArtifact,
  right: QualifiedFactArtifact,
): [QualifiedFactScalarComparisonMember, QualifiedFactScalarComparisonMember] =>
  [left, right]
    .map((fact) => ({
      qualified_fact_id: fact.id,
      raw_value: fact.metadata.raw_value,
      ...(fact.metadata.source_unit ? { source_unit: fact.metadata.source_unit } : {}),
    }))
    .sort((first, second) => first.qualified_fact_id.localeCompare(second.qualified_fact_id)) as [
    QualifiedFactScalarComparisonMember,
    QualifiedFactScalarComparisonMember,
  ];

const hasUnsafeScalarContext = (fact: QualifiedFactArtifact): boolean =>
  fact.qualification_state === 'ambiguous' ||
  fact.qualification_state === 'unresolved' ||
  fact.qualification_state === 'rejected' ||
  fact.metadata.conditions !== undefined ||
  fact.metadata.duration !== undefined ||
  fact.metadata.temperature_context !== undefined ||
  fact.metadata.revision_context !== undefined ||
  fact.metadata.derived_value !== undefined ||
  fact.metadata.derivation !== undefined ||
  fact.metadata.alternative_interpretations !== undefined;

const explicitElectricalDomain = (fact: QualifiedFactArtifact): string | undefined => {
  const embeddedUnit =
    typeof fact.metadata.raw_value === 'string'
      ? fact.metadata.raw_value.match(
          /^\s*[-+]?(?:(?:\d{1,3}(?:,\d{3})+)|(?:\d+(?:\.\d+)?)|(?:\.\d+))\s*(vac|vdc)\s*$/i,
        )?.[1]
      : undefined;
  const unit = (fact.metadata.source_unit ?? embeddedUnit)?.trim().toLocaleLowerCase();
  return unit === 'vac' || unit === 'vdc' ? unit : undefined;
};

/**
 * Bounds how far two canonical values may differ and still be considered the
 * mechanical result of the SAME lexical source value after unit conversion.
 *
 * This is strictly a computational-equivalence allowance for floating-point
 * rounding introduced by `toCanonical` arithmetic (each side performs a
 * bounded number of IEEE-754 double multiplications). It is NOT a
 * manufacturer measurement tolerance, significant-figure inference, or
 * engineering margin: at 8 * Number.EPSILON relative magnitude it is many
 * orders of magnitude narrower than any genuinely distinct manufacturer value
 * (e.g. 24 V vs 24.0001 V differs by ~4.2e-6 relative, roughly nine orders of
 * magnitude larger than this bound).
 */
const FLOATING_POINT_COMPUTATION_RELATIVE_EPSILON = 8 * Number.EPSILON;

const canonicalValuesMechanicallyEqual = (left: number, right: number): boolean => {
  if (left === right) return true;
  const magnitude = Math.max(Math.abs(left), Math.abs(right));
  if (magnitude === 0) return false;
  return Math.abs(left - right) <= FLOATING_POINT_COMPUTATION_RELATIVE_EPSILON * magnitude;
};

/**
 * Compares only exact scalar qualified-fact values. It intentionally leaves
 * qualified, contextual, and domain-specific statements unresolved for later stages.
 */
export const compareQualifiedFactExactScalars = (
  left: QualifiedFactArtifact,
  right: QualifiedFactArtifact,
): QualifiedFactScalarComparisonResult => {
  const members = stableQualifiedFactComparisonMembers(left, right);
  const result = (
    outcome: QualifiedFactScalarComparisonOutcome,
  ): QualifiedFactScalarComparisonResult => ({
    id: `qualified-fact-scalar-comparison.${artifactDigest(members).slice(
      'sha256:'.length,
      'sha256:'.length + 24,
    )}`,
    outcome,
    members,
  });

  const leftDomain = explicitElectricalDomain(left);
  const rightDomain = explicitElectricalDomain(right);
  if (hasUnsafeScalarContext(left) || hasUnsafeScalarContext(right) || leftDomain !== rightDomain) {
    return result('unresolved');
  }
  const leftValue = parseExactUnitValue(left.metadata.raw_value, left.metadata.source_unit);
  const rightValue = parseExactUnitValue(right.metadata.raw_value, right.metadata.source_unit);
  if (!leftValue || !rightValue) return result('unresolved');
  if (leftValue.unit.dimension !== rightValue.unit.dimension) return result('different');
  const leftCanonical = leftValue.unit.toCanonical(leftValue.value);
  const rightCanonical = rightValue.unit.toCanonical(rightValue.value);
  if (!Number.isFinite(leftCanonical) || !Number.isFinite(rightCanonical))
    return result('unresolved');
  return result(
    canonicalValuesMechanicallyEqual(leftCanonical, rightCanonical) ? 'equal' : 'different',
  );
};

/**
 * Reports every qualified-fact ID that appears more than once, in stable
 * sorted order (never "first encountered" order, so reporting is independent
 * of input ordering).
 */
const duplicateQualifiedFactIds = (facts: readonly QualifiedFactArtifact[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  facts.forEach((fact) => {
    if (seen.has(fact.id)) {
      duplicates.add(fact.id);
    } else {
      seen.add(fact.id);
    }
  });
  return [...duplicates].sort();
};

/**
 * Enforces that `QualifiedFactArtifact.id` is unique within one production
 * reconciliation operation. Qualified-fact IDs are artifact identities; two
 * distinct artifact objects sharing an ID must never be silently
 * deduplicated, kept-first, kept-last, or reinterpreted as unresolved
 * evidence. This must run before any map keyed by fact ID (which would
 * otherwise silently overwrite one artifact with another) or any grouping
 * logic that could allow a duplicate ID to reach a group's member list.
 */
const assertUniqueQualifiedFactIds = (
  facts: readonly QualifiedFactArtifact[],
  context: string,
): void => {
  const duplicates = duplicateQualifiedFactIds(facts);
  if (duplicates.length > 0) {
    throw new Error(`${context} received duplicate qualified fact ids: ${duplicates.join(', ')}.`);
  }
};

/**
 * Reconciles one pre-established comparison group using all available scalar
 * comparisons. It never selects a source or replaces qualified-fact evidence.
 */
export const reconcileQualifiedFactComparisonGroup = (
  group: QualifiedFactComparisonGroup,
  facts: readonly QualifiedFactArtifact[],
): QualifiedFactGroupReconciliationResult => {
  assertUniqueQualifiedFactIds(facts, 'Qualified fact group reconciliation');
  const qualifiedFactIds = [...group.qualified_fact_ids].sort();
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const groupFacts = qualifiedFactIds
    .map((id) => factById.get(id))
    .filter((fact): fact is QualifiedFactArtifact => fact !== undefined);
  const unresolvedQualifiedFactIds = qualifiedFactIds.filter((id) => !factById.has(id));
  const comparisons: QualifiedFactScalarComparisonResult[] = [];

  for (let index = 0; index < groupFacts.length; index += 1) {
    for (const other of groupFacts.slice(index + 1)) {
      comparisons.push(compareQualifiedFactExactScalars(groupFacts[index], other));
    }
  }
  comparisons.sort((left, right) => left.id.localeCompare(right.id));
  const hasUnresolvedComparisons =
    unresolvedQualifiedFactIds.length > 0 ||
    comparisons.some((comparison) => comparison.outcome === 'unresolved');
  const hasConflict = comparisons.some((comparison) => comparison.outcome === 'different');
  const outcome = hasConflict
    ? 'conflict'
    : qualifiedFactIds.length >= 2 &&
        groupFacts.length === qualifiedFactIds.length &&
        comparisons.length > 0 &&
        !hasUnresolvedComparisons
      ? 'agreement'
      : 'unresolved';

  return {
    id: `qualified-fact-group-reconciliation.${artifactDigest({
      comparison_group_id: group.id,
      qualified_fact_ids: qualifiedFactIds,
      comparisons: comparisons.map((comparison) => comparison.id),
      unresolved_qualified_fact_ids: unresolvedQualifiedFactIds,
      outcome,
    }).slice('sha256:'.length, 'sha256:'.length + 24)}`,
    comparison_group_id: group.id,
    qualified_fact_ids: qualifiedFactIds,
    comparisons,
    unresolved_qualified_fact_ids: unresolvedQualifiedFactIds,
    has_unresolved_comparisons: hasUnresolvedComparisons,
    outcome,
  };
};

const provenIntakeDigestForScope = (scope: QualifiedFactReconciliationScope): string =>
  scope.kind === 'product_intake' ? scope.digest : scope.intake_digest;

/**
 * Reconciles every safely established group for one production intake input.
 * Scope failures remain outside group reconciliation and retain their IDs.
 *
 * A "whole-intake" call must itself be proven to concern exactly one
 * `ProductIntakeReference`. Two independent sources of proof are considered:
 *
 *   1. Every supplied `SourceAcquisitionArtifact` carries its own proven
 *      `intake` reference directly, regardless of whether any qualified
 *      fact's comparison group happens to reference it.
 *   2. Every established comparison group's reconciliation scope also
 *      resolves to a proven intake digest (always derived from one of the
 *      supplied source acquisitions).
 *
 * All digests from (1) must agree with each other, all digests from (2) must
 * agree with each other, and if both are present they must agree with one
 * another. If no intake digest can be proven from either source, the call has
 * no proven intake scope at all and must fail rather than silently proceeding
 * as an unscoped no-op. Unscoped facts never contribute or fabricate an
 * intake identity. Multiple proven intakes (whether from acquisitions or
 * groups) are an orchestration/input-scope violation, not a manufacturer fact
 * disagreement, so they fail deterministically rather than being silently
 * merged or downgraded to unresolved value evidence.
 */
export const reconcileQualifiedFactsForWholeIntake = (
  input: QualifiedFactWholeIntakeReconciliationInput,
): QualifiedFactWholeIntakeReconciliationResult => {
  assertUniqueQualifiedFactIds(input.facts, 'Whole-intake reconciliation');
  const grouping = groupQualifiedFactsForReconciliation(input);
  const acquisitionIntakeDigests = [
    ...new Set(input.source_acquisitions.map((acquisition) => acquisition.intake.digest)),
  ].sort();
  if (acquisitionIntakeDigests.length > 1) {
    throw new Error(
      `Whole-intake reconciliation received source acquisitions spanning multiple proven product intakes: ${acquisitionIntakeDigests.join(', ')}.`,
    );
  }
  const groupIntakeDigests = [
    ...new Set(
      grouping.groups.map((group) => provenIntakeDigestForScope(group.key.reconciliation_scope)),
    ),
  ].sort();
  if (groupIntakeDigests.length > 1) {
    throw new Error(
      `Whole-intake reconciliation received facts spanning multiple proven product intakes: ${groupIntakeDigests.join(', ')}.`,
    );
  }
  if (
    acquisitionIntakeDigests.length === 1 &&
    groupIntakeDigests.length === 1 &&
    acquisitionIntakeDigests[0] !== groupIntakeDigests[0]
  ) {
    throw new Error(
      `Whole-intake reconciliation received a group-derived product intake ('${groupIntakeDigests[0]}') inconsistent with the supplied source acquisitions' proven product intake ('${acquisitionIntakeDigests[0]}').`,
    );
  }
  if (acquisitionIntakeDigests.length === 0 && groupIntakeDigests.length === 0) {
    throw new Error(
      'Whole-intake reconciliation requires at least one proven product intake identity from a supplied source acquisition or an established comparison group.',
    );
  }
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const groupReconciliations = grouping.groups
    .map((comparisonGroup) => {
      const groupFacts = comparisonGroup.qualified_fact_ids.map((factId) => {
        const fact = factsById.get(factId);
        if (!fact) {
          throw new Error(
            `Comparison group '${comparisonGroup.id}' references missing qualified fact '${factId}'.`,
          );
        }
        return fact;
      });
      return reconcileQualifiedFactComparisonGroup(comparisonGroup, groupFacts);
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const qualifiedFactIds = input.facts.map((fact) => fact.id).sort();
  const groupFactIds = grouping.groups.flatMap((group) => group.qualified_fact_ids);
  const accountedFactIds = [
    ...groupFactIds,
    ...grouping.unscoped_qualified_fact_ids,
    ...grouping.scope_inconsistent_qualified_fact_ids,
    ...grouping.label_unavailable_qualified_fact_ids,
  ].sort();
  if (
    accountedFactIds.length !== qualifiedFactIds.length ||
    accountedFactIds.some((factId, index) => factId !== qualifiedFactIds[index])
  ) {
    throw new Error('Whole-intake reconciliation fact accounting invariant failed.');
  }
  const agreementCount = groupReconciliations.filter(
    (result) => result.outcome === 'agreement',
  ).length;
  const conflictCount = groupReconciliations.filter(
    (result) => result.outcome === 'conflict',
  ).length;
  const unresolvedCount = groupReconciliations.filter(
    (result) => result.outcome === 'unresolved',
  ).length;
  return {
    id: `qualified-fact-whole-intake-reconciliation.${artifactDigest({
      qualified_fact_ids: qualifiedFactIds,
      groups: grouping.groups.map((group) => group.id),
      group_reconciliation_ids: groupReconciliations.map((result) => result.id),
      unscoped_qualified_fact_ids: grouping.unscoped_qualified_fact_ids,
      scope_inconsistent_qualified_fact_ids: grouping.scope_inconsistent_qualified_fact_ids,
      label_unavailable_qualified_fact_ids: grouping.label_unavailable_qualified_fact_ids,
    }).slice('sha256:'.length, 'sha256:'.length + 24)}`,
    qualified_fact_ids: qualifiedFactIds,
    groups: grouping.groups,
    group_reconciliations: groupReconciliations,
    unscoped_qualified_fact_ids: grouping.unscoped_qualified_fact_ids,
    scope_inconsistent_qualified_fact_ids: grouping.scope_inconsistent_qualified_fact_ids,
    label_unavailable_qualified_fact_ids: grouping.label_unavailable_qualified_fact_ids,
    agreement_count: agreementCount,
    conflict_count: conflictCount,
    unresolved_count: unresolvedCount,
    has_conflicts: conflictCount > 0,
    has_unresolved:
      unresolvedCount > 0 ||
      groupReconciliations.some((result) => result.has_unresolved_comparisons),
  };
};

/**
 * Resolves the reconciliation scope for one qualified fact. A candidate scope
 * is only ever derived once a product-intake identity for that candidate is
 * actually proven via a resolvable `SourceAcquisitionArtifact`; candidate ID
 * alone is not proven globally unique across intakes and must never become a
 * comparable scope on its own (see checkpoint-f-qualified-fact-grouping.test.ts).
 */
const qualifiedFactReconciliationScope = (
  fact: QualifiedFactArtifact,
  sourceAcquisitionByDigest: ReadonlyMap<string, SourceAcquisitionArtifact>,
):
  | { readonly status: 'comparable'; readonly scope: QualifiedFactReconciliationScope }
  | { readonly status: 'unscoped' }
  | { readonly status: 'inconsistent' } => {
  const sourceAcquisition = fact.source_acquisition
    ? sourceAcquisitionByDigest.get(fact.source_acquisition.digest)
    : undefined;
  if (fact.acquisition_candidate_id) {
    if (!fact.source_acquisition) {
      // No resolvable source acquisition means no proven product-intake
      // identity for this candidate ID. Candidate ID alone is not proven
      // globally unique, so this fact is conservatively left unscoped rather
      // than joining an ordinary candidate comparison group.
      return { status: 'unscoped' };
    }
    if (!sourceAcquisition) return { status: 'unscoped' };
    return sourceAcquisition.candidates.some(
      (candidate) => candidate.id === fact.acquisition_candidate_id,
    )
      ? {
          status: 'comparable',
          scope: {
            kind: 'acquisition_candidate',
            intake_digest: sourceAcquisition.intake.digest,
            id: fact.acquisition_candidate_id,
          },
        }
      : { status: 'inconsistent' };
  }
  if (sourceAcquisition) {
    return {
      status: 'comparable',
      scope: { kind: 'product_intake', digest: sourceAcquisition.intake.digest },
    };
  }
  return { status: 'unscoped' };
};

/**
 * The `source_wording` field on `QualifiedFactComparisonGroupKey` intentionally
 * holds the mechanically normalized value-independent comparison label
 * (`metadata.source_label`), not the potentially value-bearing
 * `metadata.source_wording` evidence field. The key field name is preserved
 * for API stability; only its source has changed.
 */
const qualifiedFactComparisonKey = (
  fact: QualifiedFactArtifact,
  reconciliation_scope: QualifiedFactReconciliationScope,
  comparisonLabel: string,
): QualifiedFactComparisonGroupKey => ({
  reconciliation_scope,
  applicability: qualifiedFactApplicabilityIdentity(fact.metadata.applicability),
  source_wording: normalizeQualifiedFactWording(comparisonLabel),
});

/**
 * Groups qualified manufacturer statements only when their pre-semantic evidence
 * identity matches. Values remain unexamined evidence for a later comparison pass.
 */
export const groupQualifiedFactsForReconciliation = (
  input: QualifiedFactGroupingInput,
): QualifiedFactGroupingResult => {
  assertUniqueQualifiedFactIds(input.facts, 'Qualified fact grouping');
  const groups = new Map<
    string,
    { readonly key: QualifiedFactComparisonGroupKey; readonly qualified_fact_ids: string[] }
  >();
  const unscopedQualifiedFactIds: string[] = [];
  const scopeInconsistentQualifiedFactIds: string[] = [];
  const labelUnavailableQualifiedFactIds: string[] = [];
  const sourceAcquisitionByDigest = new Map(
    input.source_acquisitions.map((acquisition) => [artifactDigest(acquisition), acquisition]),
  );

  input.facts.forEach((fact) => {
    const reconciliationScope = qualifiedFactReconciliationScope(fact, sourceAcquisitionByDigest);
    if (reconciliationScope.status === 'unscoped') {
      unscopedQualifiedFactIds.push(fact.id);
      return;
    }
    if (reconciliationScope.status === 'inconsistent') {
      scopeInconsistentQualifiedFactIds.push(fact.id);
      return;
    }
    const comparisonLabel = fact.metadata.source_label;
    if (!comparisonLabel || !comparisonLabel.trim()) {
      // Conservatively refuse ordinary label-based grouping rather than
      // heuristically deriving a label from potentially value-bearing
      // `source_wording`.
      labelUnavailableQualifiedFactIds.push(fact.id);
      return;
    }
    const key = qualifiedFactComparisonKey(fact, reconciliationScope.scope, comparisonLabel);
    const serializedKey = deterministicSerialize(key);
    const group = groups.get(serializedKey);
    if (group) {
      group.qualified_fact_ids.push(fact.id);
    } else {
      groups.set(serializedKey, { key, qualified_fact_ids: [fact.id] });
    }
  });

  return {
    groups: [...groups.entries()]
      .map(([serializedKey, group]) => ({
        id: `qualified-fact-group.${artifactDigest(serializedKey).slice('sha256:'.length, 'sha256:'.length + 24)}`,
        key: group.key,
        qualified_fact_ids: group.qualified_fact_ids.sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    unscoped_qualified_fact_ids: unscopedQualifiedFactIds.sort(),
    scope_inconsistent_qualified_fact_ids: scopeInconsistentQualifiedFactIds.sort(),
    label_unavailable_qualified_fact_ids: labelUnavailableQualifiedFactIds.sort(),
  };
};

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
