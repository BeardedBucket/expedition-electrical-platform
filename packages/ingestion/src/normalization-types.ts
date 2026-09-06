import type {
  JsonValue,
  ProductFact,
  IdentityStatus,
  ProductIdentity,
  ProductSource,
} from './contracts.js';

export type NormalizationStatus = 'normalized' | 'unresolved' | 'invalid';

export type NormalizationIssueCode =
  | 'normalization_unmapped_field'
  | 'normalization_ambiguous_value'
  | 'normalization_unsupported_unit'
  | 'normalization_invalid_number'
  | 'normalization_dimension_mismatch'
  | 'normalization_canonical_field_unsupported'
  | 'normalization_ambiguous_mounting';

export interface NormalizationIssue {
  readonly code: NormalizationIssueCode;
  readonly message: string;
}

export interface NormalizedProductFact {
  readonly fact: ProductFact;
  readonly source: ProductSource;
  readonly canonical_field: string;
  readonly normalized_value: JsonValue;
  readonly normalized_unit: string;
  readonly dimension: string;
  readonly source_authority: ProductSource['authority'];
  readonly target_kind: 'canonical' | 'evidence';
}

export interface ProductFactNormalizationResult {
  readonly status: NormalizationStatus;
  readonly fact?: NormalizedProductFact;
  readonly issues: readonly NormalizationIssue[];
}

export type ReconciliationIssueCode =
  | 'reconciliation_identity_unresolved'
  | 'reconciliation_variant_mismatch'
  | 'reconciliation_value_conflict'
  | 'reconciliation_insufficient_evidence';

export interface ReconciliationIssue {
  readonly code: ReconciliationIssueCode;
  readonly field?: string;
  readonly fact_ids: readonly string[];
  readonly source_ids: readonly string[];
  readonly values?: readonly JsonValue[];
  readonly message: string;
}

export interface ReconciledField {
  readonly field: string;
  readonly value: JsonValue;
  readonly unit: string;
  readonly fact_ids: readonly string[];
  readonly source_ids: readonly string[];
  readonly states: readonly ProductFact['fact_state'][];
  readonly target_kind: 'canonical' | 'evidence';
}

export interface ProductReconciliationInput {
  readonly identity: ProductIdentity;
  readonly candidate_id: string;
  readonly sources: readonly ProductSource[];
  readonly facts: readonly ProductFact[];
  readonly normalized_facts: readonly NormalizedProductFact[];
  /**
   * Explicit legacy compatibility boundary. Strict by default: a source with
   * undefined applicability is NOT eligible for selection (source_id alone is
   * not proof of applicability). Only an intentionally identified legacy
   * replay/caller (e.g. a pre-applicability persisted artifact) should opt
   * into the old "undefined applicability is applicable" behavior by setting
   * this to `true`. Generic reconciliation must never enable this implicitly.
   */
  readonly legacy_undefined_applicability?: boolean;
}

export interface ProductReconciliationResult {
  readonly identity_status: IdentityStatus;
  readonly fields: readonly ReconciledField[];
  readonly conflicts: readonly ReconciliationIssue[];
  readonly issues: readonly ReconciliationIssue[];
  readonly review_required: boolean;
}
