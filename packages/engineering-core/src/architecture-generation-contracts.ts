import type { CapabilityType, PortDirection } from './component-library.js';
import type { PassportAssumption } from './engineering-passport-contracts.js';
import type { InstalledElectricalDomain } from './installed-power-topology.js';

/** End-system intent, without product IDs, installed ports, corpus, or commercial policy. */
export interface ArchitectureRequirements {
  readonly id: string;
  readonly fixed_house_voltage_v?: number;
  readonly loads: readonly {
    readonly id: string;
    readonly domain: Omit<InstalledElectricalDomain, 'id'>;
    /** Individual delivered demand, not a simultaneity assertion. */
    readonly required_power_w?: number;
    readonly schedule?: readonly {
      readonly state: 'active' | 'idle' | 'standby' | 'off';
      readonly duration_hours?: number;
      readonly power_w?: number;
    }[];
    readonly requires_isolation?: boolean;
  }[];
  readonly charging_sources: readonly {
    readonly id: string;
    readonly kind: 'vehicle' | 'solar' | 'shore';
    readonly domain: Omit<InstalledElectricalDomain, 'id'>;
    /** House-side delivered charge power, never inferred alternator/PV/shore capacity. */
    readonly required_output_power_w?: number;
    readonly requires_isolation?: boolean;
  }[];
  readonly storage?: {
    readonly required: boolean;
    readonly minimum_nominal_energy_wh?: number;
    readonly desired_autonomy_hours?: number;
  };
  readonly unsupported_requirements?: readonly {
    readonly id: string;
    readonly kind:
      | 'bonding'
      | 'protection'
      | 'distribution'
      | 'switching'
      | 'environment'
      | 'installation'
      | 'source_availability';
    readonly statement: string;
  }[];
}

export interface ArchitectureGenerationInput {
  readonly schema_version: '2.0.0';
  readonly requirements: ArchitectureRequirements;
  readonly assumptions: readonly PassportAssumption[];
}

export interface ArchitectureGenerationPolicy {
  readonly id: string;
  readonly version: string;
  readonly status: 'draft' | 'reviewed' | 'approved' | 'deprecated';
  readonly kind: 'constraint';
  readonly description: string;
  readonly source_refs: readonly {
    readonly type: 'project-rationale';
    readonly title: string;
    readonly path: string;
  }[];
  readonly candidate_house_voltages_v: readonly number[];
  readonly ac_function_arrangements: readonly ('separate' | 'combined')[];
  readonly allow_dc_load_conversion: boolean;
  readonly load_supply_arrangement: 'shared_compatible_domains';
  readonly bounds: {
    readonly max_candidates: number;
    readonly max_loads: number;
    readonly max_charging_sources: number;
  };
  readonly rationale: string;
}

export type ArchitectureProvenance =
  | { readonly kind: 'requirement'; readonly pointer: string }
  | { readonly kind: 'generation_decision'; readonly decision_id: string };

/** Every gate is an independent required predicate. Phase 5 must retain all gate outcomes. */
export type RoleConstraintPredicate =
  | { readonly kind: 'capability'; readonly capability: CapabilityType }
  | {
      readonly kind: 'interface';
      readonly interface_id: string;
      readonly domain_id: string;
      readonly direction: PortDirection;
    }
  | { readonly kind: 'nominal_voltage'; readonly interface_id: string; readonly voltage_v: number }
  | { readonly kind: 'ac_frequency'; readonly interface_id: string; readonly frequency_hz: number }
  | {
      readonly kind: 'minimum_output_power';
      readonly interface_id: string;
      readonly power_w: number;
    }
  | { readonly kind: 'minimum_nominal_storage_energy'; readonly energy_wh: number }
  | {
      readonly kind: 'directed_power_path';
      readonly path_id: string;
      readonly from_interface: string;
      readonly to_interface: string;
      readonly capability: CapabilityType;
    }
  | { readonly kind: 'distinct_interfaces'; readonly interface_ids: readonly string[] }
  | { readonly kind: 'isolation'; readonly path_id: string; readonly required: true };

export type RequiredRoleConstraint = RoleConstraintPredicate & {
  readonly id: string;
  readonly provenance: readonly ArchitectureProvenance[];
};

export interface RequiredProductRole {
  readonly id: string;
  readonly function:
    | 'storage'
    | 'dc_conversion'
    | 'inverter'
    | 'charger'
    | 'solar_charge_control'
    | 'inverter_charger';
  /** Combined functions must bind one device; storage may bind an evidence-supported assembly later. */
  readonly binding_scope: 'single_device' | 'storage_assembly';
  readonly constraints: readonly RequiredRoleConstraint[];
  /** Individual gates do not establish a concurrent or final device rating.
   * Required output sizing participates in candidate status; storage dispatch is
   * a deferred scope because this input declares no discharge/dispatch authority.
   */
  readonly output_capacity: readonly {
    readonly interface_id: string;
    readonly scope: 'required_output_sizing' | 'storage_dispatch';
    readonly status: 'specified' | 'unresolved';
    readonly demand_endpoint_ids: readonly string[];
    readonly lower_bound_constraint_ids: readonly string[];
    readonly unresolved_reasons: readonly (
      'concurrency_not_asserted' | 'demand_power_unknown' | 'storage_dispatch_not_asserted'
    )[];
    readonly provenance: readonly ArchitectureProvenance[];
  }[];
}

/** An end-use requirement is a topology endpoint, never a mandatory catalog slot. */
export interface ArchitectureDemandEndpoint {
  readonly id: string;
  readonly kind: 'end_use_demand';
  readonly product_binding: 'not_required';
  readonly source_requirement_id: string;
  readonly domain_id: string;
  readonly required_power_w?: number;
  readonly schedule?: ArchitectureRequirements['loads'][number]['schedule'];
  readonly requires_isolation?: boolean;
  readonly provenance: readonly ArchitectureProvenance[];
}

export interface AbstractPowerTopology {
  readonly domains: readonly InstalledElectricalDomain[];
  readonly bindings: readonly {
    readonly id: string;
    readonly role_id: string;
    readonly interface_id: string;
    readonly domain_id: string;
  }[];
  readonly edges: readonly (
    | { readonly id: string; readonly kind: 'wire'; readonly from: string; readonly to: string }
    | {
        readonly id: string;
        readonly kind: 'required_power_path';
        readonly from: string;
        readonly to: string;
        readonly role_id: string;
        readonly path_id: string;
      }
  )[];
  readonly routes: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly edge_ids: readonly string[];
    readonly provenance: readonly ArchitectureProvenance[];
  }[];
}

export type ArchitectureStructuralStatus = 'structurally_viable' | 'blocked' | 'unresolved';
export interface ArchitectureDecision {
  readonly id: string;
  readonly code: string;
  readonly status: ArchitectureStructuralStatus;
  readonly policy_id: string;
  readonly policy_revision: string;
  readonly requirement_pointers: readonly string[];
  readonly subject_ids: readonly string[];
  readonly message: string;
}

export interface ArchitectureCandidate {
  readonly id: string;
  readonly candidate_digest: string;
  readonly input_digest: string;
  readonly policy_digest: string;
  readonly generator_revision: string;
  readonly choices: {
    readonly house_voltage_v: number;
    readonly ac_function_arrangement: 'separate' | 'combined';
  };
  readonly required_roles: readonly RequiredProductRole[];
  readonly demand_endpoints: readonly ArchitectureDemandEndpoint[];
  readonly topology: AbstractPowerTopology;
  /** Text assumptions are preserved at input; this revision performs no numeric interpretation of them. */
  readonly used_assumption_ids: readonly string[];
  readonly decisions: readonly ArchitectureDecision[];
  readonly structural_evaluation: {
    readonly status: ArchitectureStructuralStatus;
    readonly assertion_scope: 'abstract-nominal-topology-and-role-requirements';
    readonly product_binding: 'not_evaluated';
    readonly installation_safety: 'not_evaluated';
    readonly policy_lifecycle_status: ArchitectureGenerationPolicy['status'];
    readonly unresolved_decision_ids: readonly string[];
    readonly blocked_decision_ids: readonly string[];
    readonly deferred_checks: readonly string[];
  };
}

export interface ArchitectureGenerationResult {
  readonly schema_version: '2.0.0';
  readonly generator_revision: string;
  readonly input: ArchitectureGenerationInput;
  readonly input_digest: string;
  readonly policy: ArchitectureGenerationPolicy;
  readonly policy_digest: string;
  readonly candidates: readonly ArchitectureCandidate[];
  readonly expansion: {
    readonly explored: number;
    readonly deduplicated: number;
    readonly bound: number;
    readonly complete: true;
  };
  readonly filter_semantics: {
    readonly supported_outcomes: readonly ['eligible', 'blocked', 'unresolved'];
    readonly aggregation: 'any_blocked_else_any_unresolved_else_eligible';
    readonly order_affects_authority: false;
  };
  readonly warnings: readonly string[];
  readonly result_digest: string;
}
