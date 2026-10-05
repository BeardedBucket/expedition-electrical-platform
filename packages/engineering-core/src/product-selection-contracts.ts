import type {
  ArchitectureGenerationResult,
  RequiredProductRole,
  RequiredRoleConstraint,
} from './architecture-generation-contracts.js';
import type { ComponentLibraryRecord } from './component-library.js';
import type { ExaminedProductEvidence } from './engineering-passport-contracts.js';

export type GateTruth = 'YES' | 'NO' | 'UNKNOWN';
export type ProductFeasibility = 'ELIGIBLE' | 'BLOCKED' | 'UNRESOLVED';
export type SelectionReason =
  | 'requirement_supported'
  | 'engineering_mismatch'
  | 'explicit_negative_capability'
  | 'fact_missing'
  | 'evidence_not_engineering_authoritative'
  | 'contextual_rating_unresolved'
  | 'binding_unresolved'
  | 'upstream_requirement_unresolved'
  | 'fixed_component_record_missing'
  | 'assembly_permission_unknown'
  | 'assembly_reduction_unresolved';

export interface StorageAssemblyIntent {
  readonly kind: 'homogeneous';
  readonly component_id: string;
  readonly series_count: number;
  readonly parallel_count: number;
}
export interface FixedExistingBinding {
  readonly role_id: string;
  readonly component_id: string;
  readonly assembly?: StorageAssemblyIntent;
}
export interface ProductSelectionInput {
  readonly schema_version: '1.0.0';
  /** Complete reconstructible Phase 4 authority, rather than a detached editable role list. */
  readonly generation: ArchitectureGenerationResult;
  readonly candidate_id: string;
  readonly corpus: readonly ComponentLibraryRecord[];
  readonly fixed_existing: readonly FixedExistingBinding[];
  /** Explicit assemblies may test contradictions; automatic generation uses a proven minimum only. */
  readonly assemblies: readonly (StorageAssemblyIntent & { readonly role_id: string })[];
}
export interface ProductSelectionPolicy {
  readonly id: string;
  readonly version: '1.0.0';
  readonly kind: 'constraint';
  readonly status: 'draft' | 'reviewed' | 'approved' | 'deprecated';
  readonly description: string;
  readonly source_refs: readonly {
    readonly type: 'project-rationale';
    readonly title: string;
    readonly path: string;
  }[];
  readonly rationale: string;
  readonly bounds: {
    readonly max_products: number;
    readonly max_bindings_per_candidate: number;
    readonly max_total_bindings: number;
    readonly max_assembly_units: number;
  };
}
export interface SelectionGate {
  readonly constraint: RequiredRoleConstraint;
  readonly truth: GateTruth;
  readonly reason: SelectionReason;
  readonly evidence: readonly ExaminedProductEvidence[];
}
export interface SelectionCalculation {
  readonly kind: 'derived';
  readonly formula: string;
  readonly inputs: Readonly<Record<string, number>>;
  readonly output: number;
  readonly unit: 'V' | 'Ah' | 'Wh';
  readonly evidence: readonly ExaminedProductEvidence[];
}
export interface ProductBindingWitness {
  readonly interfaces: Readonly<Record<string, string | null>>;
  readonly paths: Readonly<Record<string, string | null>>;
}
export interface CandidateBindingEvaluation {
  readonly id: string;
  readonly witness: ProductBindingWitness;
  readonly status: ProductFeasibility;
  readonly gates: readonly SelectionGate[];
  readonly assembly_gates: readonly {
    readonly axis: 'series' | 'parallel';
    readonly count: number;
    readonly truth: GateTruth;
    readonly reason: SelectionReason;
    readonly evidence: readonly ExaminedProductEvidence[];
  }[];
  readonly calculations: readonly SelectionCalculation[];
}
export interface ProductCandidateEvaluation {
  readonly component_id: string;
  readonly fixed_existing: boolean;
  readonly assembly?: StorageAssemblyIntent;
  readonly assembly_generation?: 'unresolved';
  readonly status: ProductFeasibility;
  readonly reasons: readonly SelectionReason[];
  readonly bindings: readonly CandidateBindingEvaluation[];
}
export interface RoleSelection {
  readonly role: RequiredProductRole;
  readonly upstream_unresolved: RequiredProductRole['output_capacity'];
  readonly deferred_scopes: RequiredProductRole['output_capacity'];
  /** Model alternatives: these are not installed instances and have no rank. */
  readonly candidates: readonly ProductCandidateEvaluation[];
}
export interface ProductSelectionResult {
  readonly schema_version: '1.0.0';
  readonly selector_revision: string;
  readonly input: ProductSelectionInput;
  readonly input_digest: string;
  readonly corpus_digest: string;
  readonly architecture_digest: string;
  readonly policy: ProductSelectionPolicy;
  readonly policy_digest: string;
  readonly roles: readonly RoleSelection[];
  readonly warnings: readonly string[];
  readonly result_digest: string;
}
