import type {
  ComponentLibraryRecord,
  ComponentLibrarySourceRef,
  PowerConsumptionQualifiers,
} from './component-library.js';
import type { InstalledSystemArchitecture } from './installed-power-topology.js';
import type { SystemEvaluationResult } from './system-evaluation.js';

export type PassportStatus = 'satisfied' | 'blocked' | 'unresolved';
export interface PassportAssumption {
  readonly id: string;
  readonly origin: 'user' | 'project';
  readonly statement: string;
}

/** Schedule attribution is independent of the endpoint's identity/domain/W locator.
 * Evaluation input needs no invented document citation. Omission means unknown,
 * including legacy callers; origin labels establish no evidence authenticity.
 */
export type ProjectDemandScheduleProvenance =
  | {
      readonly origin: 'requirement';
      readonly requirement_id: string;
      readonly pointer: string;
    }
  | { readonly origin: 'evaluation_input' }
  | { readonly origin: 'unknown' };

export interface InstalledSystemRequirements {
  /** Requirement-owned endpoints have no component/instance identity or manufacturer facts. */
  readonly project_demands?: readonly {
    readonly id: string;
    readonly domain_id: string;
    readonly required_power_w?: number;
    readonly provenance: {
      readonly requirement_id: string;
      readonly pointer: string;
      /** Only genuine dependencies; these IDs must resolve in input.assumptions. */
      readonly assumption_ids?: readonly string[];
    };
    readonly schedule_provenance?: ProjectDemandScheduleProvenance;
    readonly schedule?: readonly {
      readonly state: 'active' | 'idle' | 'standby' | 'off';
      readonly duration_hours?: number;
      readonly power_w?: number;
    }[];
  }[];
  /** Inherited failures/unknowns can only weaken a proof; an upstream label cannot supply YES. */
  readonly mandatory_conditions?: readonly {
    readonly id: string;
    readonly status: 'blocked' | 'unresolved';
    readonly artifact_digest: string;
    readonly subject_id: string;
    readonly reason_codes: readonly string[];
  }[];
  readonly id: string;
  readonly house_domain_id?: string;
  readonly evaluation_hours?: number;
  readonly desired_autonomy_hours?: number;
  readonly environment?: { readonly temperature_c?: number; readonly notes?: string };
  readonly source_availability?: readonly {
    readonly domain_id: string;
    readonly available_hours?: number;
  }[];
  readonly supplies: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    /** Caller selects an ordered route. The evaluator never chooses a route or product. */
    readonly edge_ids: readonly string[];
    readonly required_power_w?: number;
    readonly requires_isolation?: boolean;
  }[];
  readonly load_states: readonly {
    readonly id: string;
    readonly binding_id: string;
    readonly state: 'active' | 'idle' | 'standby' | 'quiescent' | 'off';
    readonly duration_hours?: number;
    readonly power:
      | { readonly kind: 'requirement'; readonly watts: number; readonly assumption_id: string }
      | {
          readonly kind: 'component';
          readonly qualified_value_id?: string;
          readonly context?: PowerConsumptionQualifiers;
        };
  }[];
  readonly battery_banks: readonly {
    readonly id: string;
    readonly instance_id: string;
    readonly domain_id: string;
    readonly series_count: number;
    readonly parallel_count: number;
    readonly required_nominal_energy_wh?: number;
  }[];
}

export interface WholeSystemEvaluationInput {
  readonly requirements: InstalledSystemRequirements;
  readonly architecture: InstalledSystemArchitecture;
  readonly assumptions: readonly PassportAssumption[];
}

export type EvidenceEngineeringUse = 'accepted_input' | 'withheld';
export interface PassportEvidenceReference {
  readonly evidence_id: string;
  /** Accepted means supplied to interpretation, not necessarily compatible or sufficient. */
  readonly engineering_use: EvidenceEngineeringUse;
}

export interface ExaminedProductEvidence {
  readonly id: string;
  readonly component_id: string;
  readonly record_digest: string;
  readonly path: string;
  readonly canonical_value: unknown;
  readonly origin: 'canonical_assertion' | 'product_derivation';
  readonly verification_status: ComponentLibraryRecord['verification_status'];
  readonly engineering_use:
    | { readonly state: 'accepted_input' }
    | { readonly state: 'withheld'; readonly reason: 'record_not_verified' };
  /** Record-level references retain locators; they do not fabricate field-level attribution. */
  readonly source_refs: readonly ComponentLibrarySourceRef[];
  readonly source_native: { readonly state: 'not_retained_in_canonical_record' };
  readonly normalization: {
    readonly kind: 'canonical_projection';
    readonly value: unknown;
    readonly unit?: string;
  };
  readonly product_derivation?: unknown;
}

export interface PassportDecision {
  readonly id: string;
  readonly rule_id: string;
  readonly rule_revision: string;
  readonly status: PassportStatus;
  readonly code: string;
  readonly message: string;
  readonly inputs: unknown;
  readonly evidence_refs: readonly PassportEvidenceReference[];
  readonly assumption_ids: readonly string[];
  readonly output?: unknown;
}

export interface PassportCalculation {
  readonly id: string;
  readonly kind: 'derived';
  readonly rule_id: string;
  readonly rule_revision: string;
  readonly formula: string;
  readonly inputs: unknown;
  readonly evidence_refs: readonly PassportEvidenceReference[];
  readonly assumption_ids: readonly string[];
  readonly output: unknown;
  readonly unit: string;
}

export interface PassportRuleData {
  readonly id: string;
  readonly version: string;
  readonly status: string;
  readonly kind: string;
  readonly description: string;
  readonly source_refs: readonly Record<string, unknown>[];
}

export type UnresolvedEnergyContribution =
  | {
      readonly kind: 'project_demand';
      readonly demand_id: string;
      readonly reasons: readonly string[];
    }
  | {
      readonly kind: 'state';
      readonly instance_id: string;
      readonly state_id: string;
      readonly reasons: readonly ('power_unknown' | 'duration_unknown' | 'energy_not_resolved')[];
    }
  | {
      readonly kind: 'schedule';
      readonly instance_id: string;
      readonly reasons: readonly (
        'schedule_missing' | 'duration_unknown' | 'horizon_unknown' | 'horizon_mismatch'
      )[];
    }
  | { readonly kind: 'evaluation'; readonly reason: 'no_states' };

export type PassportEnergyResult = {
  readonly basis: 'device-side';
  /** Only resolved contributions: zero never asserts zero total while completeness is incomplete. */
  readonly resolved_subtotal_energy_wh: number;
} & (
  | {
      readonly status: 'satisfied';
      readonly completeness: 'complete';
      readonly total_energy_wh: number;
      readonly unresolved_contributions: readonly [];
    }
  | {
      readonly status: 'unresolved';
      readonly completeness: 'incomplete';
      readonly total_energy_wh?: never;
      readonly unresolved_contributions: readonly UnresolvedEnergyContribution[];
    }
);

export interface EngineeringPassport {
  readonly schema_version: '2.0.0';
  readonly evaluator_revision: string;
  readonly input: WholeSystemEvaluationInput;
  readonly input_digest: string;
  readonly component_bindings: readonly {
    readonly component_id: string;
    readonly record_digest: string;
    readonly record: ComponentLibraryRecord;
    /** Project hashes never supply manufacturer revision; recorded assertions retain review status. */
    readonly manufacturer_revision:
      | { readonly state: 'unknown' }
      | {
          readonly state: 'recorded';
          readonly value: string;
          readonly verification_status: ComponentLibraryRecord['verification_status'];
        };
  }[];
  readonly corpus_digest: string;
  readonly rule_data: PassportRuleData;
  readonly rule_data_digest: string;
  readonly examined_evidence: readonly ExaminedProductEvidence[];
  readonly decisions: readonly PassportDecision[];
  readonly calculations: readonly PassportCalculation[];
  readonly result: {
    readonly status: PassportStatus;
    readonly assertion_scope: 'nominal-connectivity-and-device-demand';
    readonly installation_safety: 'not_evaluated';
    /** Existing rule lifecycle metadata is separate from nominal satisfaction and installation approval. */
    readonly rule_lifecycle_status: string;
    readonly energy: PassportEnergyResult;
    readonly system_evaluation: SystemEvaluationResult;
    readonly warnings: readonly {
      readonly code: string;
      readonly message: string;
      readonly instance_id?: string;
    }[];
    readonly limitations: readonly string[];
  };
  readonly passport_digest: string;
}
