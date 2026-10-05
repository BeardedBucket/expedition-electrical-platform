import type { CapabilityType, ComponentLibrarySourceRef } from './component-library.js';
import type { EngineeringPassport } from './engineering-passport-contracts.js';
import type { ProductSelectionResult, SelectionReason } from './product-selection-contracts.js';
import type { SelectedRoleBinding, bindProductSelection } from './product-selection-handoff.js';
import type {
  AdvisoryRecord,
  EvidenceRecord,
  AdvisoryPolicyConfiguration,
  ComponentAdvisoryEvaluation,
} from './advisory.js';

export type SystemHandoffOptions = NonNullable<Parameters<typeof bindProductSelection>[2]>;
export interface SelectionOptionSource {
  readonly selection: ProductSelectionResult;
  readonly handoff: SystemHandoffOptions;
}
/** A choice is an exact complete witness set, never a product shortlist or a new topology. */
export interface SystemOptionChoice {
  readonly selection_digest: string;
  readonly bindings: readonly SelectedRoleBinding[];
}
export type FactState =
  | {
      readonly state: 'known';
      readonly value: number | string | boolean | Readonly<Record<string, unknown>>;
    }
  | { readonly state: 'absent' }
  | { readonly state: 'not_applicable'; readonly reason: string }
  | { readonly state: 'unknown'; readonly reason: string };
export interface ObservationSource {
  readonly owner: 'user' | 'commercial' | 'builder';
  readonly reference: string;
  readonly context: string;
  readonly observed_at?: string;
}
export interface PurchasePriceObservation {
  readonly component_id: string;
  /** Per physical unit, including each unit of a homogeneous bank. No package-price inference. */
  readonly amount: number;
  readonly currency: string;
  readonly source: ObservationSource;
}
export interface OwnedAcquisitionBasis {
  readonly selection_digest: string;
  readonly role_id: string;
  readonly basis: 'owned_no_incremental_acquisition_cost';
  readonly currency: string;
  readonly source: ObservationSource;
}
/** Extension seam for explicit optional nonengineering product attributes.
 * These cannot populate/override canonical capability, price, weight or engineering fields.
 */
export interface OptionalFeatureObservation {
  readonly component_id: string;
  readonly feature: string;
  readonly fact:
    | Exclude<FactState, { readonly state: 'known' }>
    | { readonly state: 'known'; readonly value: boolean };
  readonly source: ObservationSource;
}
export interface RecommendationContext {
  readonly prices: readonly PurchasePriceObservation[];
  readonly owned_acquisition: readonly OwnedAcquisitionBasis[];
  readonly features: readonly OptionalFeatureObservation[];
  readonly advisory?: {
    readonly evaluated_at: string;
    readonly records: readonly AdvisoryRecord[];
    readonly evidence: readonly EvidenceRecord[];
    readonly configuration: AdvisoryPolicyConfiguration;
  };
}
export type PreferenceCriterion =
  | {
      readonly kind:
        | 'purchase_cost'
        | 'weight'
        | 'component_count'
        | 'reuse_existing'
        | 'manufacturer_count'
        | 'selected_power_path_count';
      readonly direction: 'minimize' | 'maximize';
    }
  | {
      readonly kind: 'optional_capability';
      readonly capability: CapabilityType;
      readonly direction: 'prefer_present' | 'prefer_absent';
    }
  | {
      readonly kind: 'optional_feature';
      readonly feature: string;
      readonly direction: 'prefer_present' | 'prefer_absent';
    };
export interface PreferenceProfile {
  readonly schema_version: '1.0.0';
  readonly id: string;
  /** Array order expresses priority. Criteria within a tier have equal priority. Empty is valid. */
  readonly tiers: readonly (readonly PreferenceCriterion[])[];
}
export interface RecommendationPolicy {
  readonly id: 'recommendation';
  readonly version: '1.0.0';
  readonly kind: 'preference';
  readonly status: 'draft' | 'reviewed' | 'approved' | 'deprecated';
  readonly description: string;
  readonly rationale: string;
  readonly source_refs: readonly {
    readonly type: 'project-rationale';
    readonly title: string;
    readonly path: string;
  }[];
  readonly bounds: {
    readonly max_selections: number;
    readonly max_options: number;
    readonly max_pairwise_comparisons: number;
    readonly max_criteria: number;
    readonly max_observations: number;
    readonly max_tradeoff_facts: number;
  };
}
export interface RecommendationInput {
  readonly schema_version: '1.0.0';
  readonly sources: readonly SelectionOptionSource[];
  readonly construction:
    | { readonly mode: 'automatic' }
    | { readonly mode: 'explicit'; readonly choices: readonly SystemOptionChoice[] };
  readonly preference: PreferenceProfile;
  readonly context: RecommendationContext;
}
export interface FactProvenance {
  readonly owner:
    'canonical_product' | 'engineering_derived' | 'user' | 'commercial' | 'builder' | 'advisory';
  readonly snapshot_digest: string;
  readonly pointer: string;
  readonly source_refs: readonly ComponentLibrarySourceRef[];
  readonly verification_status?: string;
  readonly source_native_representation?: 'not_retained_in_canonical_record';
  readonly product_derivation?: unknown;
}
export interface TradeoffFact {
  readonly id: string;
  readonly kind: string;
  readonly option_id: string;
  readonly subject:
    | { readonly kind: 'system' }
    | {
        readonly kind: 'component';
        readonly role_id: string;
        readonly component_id: string;
        readonly quantity: number;
      };
  readonly fact: FactState;
  readonly unit: string | null;
  readonly identity: 'direct' | 'derived';
  readonly completeness: 'complete' | 'incomplete' | 'not_applicable';
  readonly provenance: readonly FactProvenance[];
  readonly calculation?: {
    readonly formula: string;
    readonly inputs: readonly { readonly fact_id: string; readonly quantity: number }[];
    readonly source_inputs?: readonly {
      readonly snapshot_digest: string;
      readonly pointer: string;
      readonly value: unknown;
      readonly unit: string | null;
    }[];
    /** Per-unit subtotals never imply a total; currencies remain independent. */
    readonly known_subtotals: readonly { readonly value: number; readonly unit: string }[];
    readonly unresolved_contributors: readonly {
      readonly fact_id: string;
      readonly reason: string;
    }[];
  };
}
export interface SystemOption {
  readonly id: string;
  readonly option_digest: string;
  readonly choice: SystemOptionChoice;
  readonly passport: EngineeringPassport;
  /** Verbatim Phase 3 status, including all inherited mandatory Phase 5 conditions. */
  readonly engineering_status: EngineeringPassport['result']['status'];
  readonly facts: readonly TradeoffFact[];
  readonly preference_data: {
    readonly completeness: 'complete' | 'incomplete';
    readonly missing_fact_ids: readonly string[];
  };
  readonly advisory: readonly ComponentAdvisoryEvaluation[];
  readonly recommendation_exclusions: readonly {
    readonly owner: 'engineering' | 'advisory';
    readonly subject_id: string;
    readonly reason: string;
  }[];
}
export interface DeferredCandidate {
  readonly selection_digest: string;
  readonly role_id: string;
  readonly candidate: ProductSelectionResult['roles'][number]['candidates'][number];
  readonly binding_id: string | null;
  readonly reasons: readonly (
    | 'fixed_component_record_missing'
    | 'exact_witness_identity_missing'
    | 'assembly_reduction_unresolved'
  )[];
  readonly phase5_reasons: readonly SelectionReason[];
}
export type PreferenceRelation = 'preferred' | 'worse' | 'tied' | 'incomparable';
export interface CriterionComparison {
  readonly tier: number;
  readonly criterion: PreferenceCriterion;
  readonly left_fact_id: string;
  readonly right_fact_id: string;
  readonly relation: PreferenceRelation;
  readonly reason:
    | 'left_better'
    | 'right_better'
    | 'equal'
    | 'comparison_incomplete'
    | 'unit_mismatch'
    | 'not_applicable';
}
export interface PairwiseComparison {
  readonly left_option_id: string;
  readonly right_option_id: string;
  readonly engineering_status: 'satisfied' | 'unresolved';
  readonly relation: PreferenceRelation;
  readonly decisive_tier: number | null;
  readonly reason:
    | 'empty_profile'
    | 'all_tiers_tied'
    | 'tier_dominance'
    | 'tier_tradeoff'
    | 'comparison_incomplete';
  /** All dimensions retained; only the first non-tied tier is authoritative. */
  readonly criteria: readonly CriterionComparison[];
}
export interface RecommendationResult {
  readonly schema_version: '1.0.0';
  readonly engine_revision: 'recommendation/1.0.0';
  readonly input: RecommendationInput;
  readonly input_digest: string;
  readonly policy: RecommendationPolicy;
  readonly policy_digest: string;
  readonly construction: {
    readonly status: 'complete' | 'option_space_bound_exceeded';
    readonly scope: 'retained_exact_phase5_bindings' | 'explicit_choice_set';
    readonly option_count: string;
    readonly bound: number;
    readonly pairwise_bound: number;
    readonly role_choice_counts: readonly {
      readonly selection_digest: string;
      readonly role_id: string;
      readonly count: number;
    }[];
  };
  readonly options: readonly SystemOption[];
  readonly deferred: readonly DeferredCandidate[];
  readonly comparisons: readonly PairwiseComparison[];
  readonly fronts: {
    readonly satisfied: readonly (readonly string[])[];
    readonly unresolved: readonly (readonly string[])[];
  };
  readonly excluded_option_ids: readonly string[];
  readonly warnings: readonly string[];
  readonly result_digest: string;
}
