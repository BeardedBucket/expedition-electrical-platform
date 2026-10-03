import type { ReferenceSystem } from './reference-system.js';

/** Installation owns domain assignments, wiring and enabled paths, never product capabilities. */
export interface InstalledElectricalDomain {
  readonly id: string;
  readonly kind: 'dc' | 'pv_dc' | 'ac';
  readonly nominal_voltage_v?: number;
  readonly frequency_hz?: number;
}

export interface InstalledPowerBinding {
  readonly id: string;
  readonly instance_id: string;
  readonly port_id: string;
  readonly domain_id: string;
}

export type InstalledPowerEdge =
  | { readonly id: string; readonly kind: 'wire'; readonly from: string; readonly to: string }
  | {
      readonly id: string;
      readonly kind: 'power_path';
      readonly from: string;
      readonly to: string;
      readonly instance_id: string;
      readonly power_path_id: string;
    }
  | {
      readonly id: string;
      readonly kind: 'conductive';
      readonly from: string;
      readonly to: string;
      readonly instance_id: string;
      readonly relationship_id: string;
      readonly switching_configuration_id?: string;
    };

export interface InstalledPowerTopology {
  readonly domains: readonly InstalledElectricalDomain[];
  readonly bindings: readonly InstalledPowerBinding[];
  /** Directed edges are explicit; bidirectional operation needs two edges. Domain IDs are bus endpoints. */
  readonly edges: readonly InstalledPowerEdge[];
  readonly bonding_contexts?: readonly {
    readonly id: string;
    readonly instance_id: string;
    readonly terminal_id: string;
    readonly domain_id: string;
    readonly intended_role: 'dc_return' | 'ac_protective_earth' | 'chassis_bond' | 'unresolved';
    readonly source_ref_ids: readonly string[];
  }[];
}

/** Additive logical-power view of the existing installation, not a second component-instance model. */
export interface InstalledSystemArchitecture {
  readonly installation: ReferenceSystem;
  readonly power_topology: InstalledPowerTopology;
}
