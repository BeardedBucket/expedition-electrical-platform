import type { EngineeringProfile, EngineeringValue } from '../../src/engineering-profile.js';
import type { EngineeringEnvelopeInput } from '../../src/engineering-envelope.js';

/** Entirely invented project fixtures. Numeric resemblance to a real source is
 * not product acceptance: coefficients, uncertainty, limits and installation
 * evidence here are synthetic controlled assumptions, not manufacturer facts. */
export function syntheticProfile(id: string): EngineeringProfile {
  return {
    schema_version: 'engineering-profile.v1',
    component_id: id,
    model: `Synthetic ${id}`,
    manufacturer_revision: 'invented-r1',
    evidence: [
      {
        id: `${id}.e`,
        source_url: 'urn:project:synthetic',
        publisher: 'Expedition test authors',
        model: `Synthetic ${id}`,
        manufacturer_revision: 'invented-r1',
        retrieved_at: '2026-01-01T00:00:00Z',
        locator: 'invented complete fixture',
        source_digest: null,
        statement: 'All values and permissions are invented controlled test assumptions.',
        conditions: [],
        origin: 'synthetic',
        rights: 'project_authored',
      },
    ],
  };
}
export function value<U extends string>(id: string, n: number, unit: U): EngineeringValue<U> {
  return { value: n, unit, evidence_ids: [`${id}.e`] };
}
export function solarFixture(ns = 1, np = 1, highVoltage = false): EngineeringEnvelopeInput {
  const m = syntheticProfile('module'),
    c = syntheticProfile('controller');
  c.evidence[0]!.statement +=
    ' Synthetic assumption: operating maximum voltage applies to Vmp envelope.';
  m.pv = {
    voc_v: value('module', highVoltage ? 48.68 : 24.34, 'V'),
    vmp_v: value('module', highVoltage ? 41.48 : 20.74, 'V'),
    isc_a: value('module', highVoltage ? 5.15 : 10.31, 'A'),
    imp_a: value('module', highVoltage ? 4.84 : 9.68, 'A'),
    pmax_w: value('module', 200, 'W'),
    reference_cell_c: value('module', 25, 'degC'),
    irradiance_w_m2: value('module', 1000, 'W/m2'),
    spectrum: { value: 'synthetic spectrum', evidence_ids: ['module.e'] },
    coefficients: {
      voc: {
        value: -0.36,
        unit: 'percent/K',
        cell_domain_c: { min: -40, max: 85 },
        evidence_ids: ['module.e'],
      },
      vmp: {
        value: -0.004,
        unit: 'fraction/K',
        cell_domain_c: { min: -40, max: 85 },
        evidence_ids: ['module.e'],
      },
    },
    uncertainty_fraction: {
      voc: value('module', 0, 'fraction'),
      vmp: value('module', 0, 'fraction'),
      pmax: value('module', 0, 'fraction'),
    },
    max_system_v: value('module', 1000, 'V'),
  };
  c.trackers = [
    {
      id: 'tracker',
      grouping_status: 'source_supported',
      terminal_ids: ['input'],
      evidence_ids: ['controller.e'],
      input_sharing: 'permitted',
      absolute_voc_v: value('controller', 150, 'V'),
      operating_max_v: value('controller', 150, 'V'),
      operating_max_basis: 'vmp_envelope',
      operating_min_v: value('controller', 0, 'V'),
      start_headroom_v: value('controller', 5, 'V'),
      run_headroom_v: value('controller', 1, 'V'),
      restart_headroom_v: value('controller', 5, 'V'),
      max_isc_a: value('controller', 45, 'A'),
      max_imp_a: value('controller', 45, 'A'),
      terminal_limits: [
        {
          id: 'input',
          max_isc_a: value('controller', 45, 'A'),
          max_imp_a: value('controller', 45, 'A'),
        },
      ],
      power_limits: [
        {
          battery_nominal_v: value('controller', 12, 'V'),
          max_pmax_w: value('controller', 650, 'W'),
          clipping: 'permitted',
          evidence_ids: ['controller.e'],
        },
      ],
    },
  ];
  return {
    schema_version: 'engineering-envelope-input.v1',
    profiles: [m, c],
    pv: {
      controller_id: 'controller',
      strings: Array.from({ length: np }, (_, i) => ({
        id: `s${i}`,
        module_id: 'module',
        series_count: ns,
        tracker_id: 'tracker',
        terminal_id: 'input',
      })),
      cell_min_c: -10,
      cell_max_c: 25,
      start_cell_c: 25,
      restart_cell_c: 25,
      irradiance_w_m2: 1000,
      spectrum: 'synthetic spectrum',
      battery_max_v: 15.5,
      battery_nominal_v: 12,
      current_upper_factors: {
        isc: 1,
        imp: 1,
        rationale: 'Controlled synthetic reference-current upper bound; no real irradiance claim',
      },
      cell_temperature_rationale:
        'Controlled synthetic cell temperatures, not assumed ambient weather',
      protection_and_connector_evidence_ids: ['controller.e'],
    },
  };
}
export function multifunctionFixture(): EngineeringEnvelopeInput {
  const p = syntheticProfile('hub');
  p.shared_capacity = [
    {
      id: 'total',
      mode: 'inversion',
      path_ids: ['ac', 'dc'],
      unit: 'W',
      limit: 6000,
      evidence_ids: ['hub.e'],
      battery_count: 2,
      temperature_c: { min: 0, max: 40 },
      accounting: 'boundary_demand_includes_losses',
      excluded_path_pairs: [['ac', 'dc']],
    },
  ];
  p.shared_capacity_inventory = [
    { mode: 'inversion', group_ids: ['total'], evidence_ids: ['hub.e'] },
  ];
  p.ac_modes = [
    {
      id: 'inversion',
      kind: 'inversion',
      relationship: 'split_phase',
      line_neutral_v: value('hub', 120, 'V'),
      line_line_v: value('hub', 240, 'V'),
      source_required: false,
      evidence_ids: ['hub.e'],
      leg_limits_a: { L1: value('hub', 25, 'A'), L2: value('hub', 25, 'A') },
      neutral_limit_a: value('hub', 25, 'A'),
      neutral_evidence_ids: ['hub.e'],
      grounding_evidence_ids: ['hub.e'],
    },
  ];
  p.assembly = [
    {
      component_id: 'battery',
      model: 'Synthetic pack',
      compatible_revision: 'kit-r1',
      relationship: 'included',
      min_count: 2,
      max_count: 2,
      protocol: 'invented-protocol.v1',
      evidence_ids: ['hub.e'],
    },
    {
      component_id: 'screen',
      model: 'Synthetic screen',
      compatible_revision: 'kit-r1',
      relationship: 'optional',
      min_count: 0,
      max_count: 1,
      protocol: 'invented-protocol.v1',
      evidence_ids: ['hub.e'],
    },
  ];
  return {
    schema_version: 'engineering-envelope-input.v1',
    profiles: [p],
    operating: {
      component_id: 'hub',
      mode: 'inversion',
      battery_count: 2,
      temperature_c: 25,
      required_capacity_group_ids: ['total'],
      demands: [{ path_id: 'ac', value: 5000, unit: 'W' }],
      ac_loads: [
        { connection: 'line_line', voltage_v: 240, relationship: 'split_phase', current_a: 20 },
      ],
      neutral_current_a: 0,
      installed_modules: [
        {
          component_id: 'battery',
          model: 'Synthetic pack',
          revision: 'kit-r1',
          count: 2,
          protocol: 'invented-protocol.v1',
        },
      ],
    },
  };
}
