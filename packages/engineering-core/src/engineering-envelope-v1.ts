import {
  ENGINEERING_ENVELOPE_RULE,
  parseEngineeringProfile,
  type EngineeringProfile,
  type EngineeringStatus,
  type EngineeringValue,
  type PvQuantity,
} from './engineering-profile-v1.js';

export interface EngineeringCheck {
  code: string;
  subject: string;
  status: EngineeringStatus;
  explanation: string;
  evidence_ids: string[];
  actual?: number;
  limit?: number;
  unit?: string;
}
export interface EngineeringCalculation {
  id: string;
  formula: string;
  inputs: Record<string, number>;
  value: number;
  unit: string;
  evidence_ids: string[];
  assumptions: string[];
}
export interface PvInstallation {
  strings: {
    id: string;
    module_id: string;
    series_count: number;
    tracker_id: string;
    terminal_id: string;
  }[];
  controller_id: string;
  cell_min_c?: number;
  cell_max_c?: number;
  start_cell_c?: number;
  restart_cell_c?: number;
  irradiance_w_m2?: number;
  spectrum?: string;
  battery_max_v?: number;
  battery_nominal_v?: number;
  /** Upper bounds justified by the installation author, independently of battery
   * current. They include irradiance/temperature/tolerance effects on PV current;
   * omission is unresolved, never a multiplier of one. */
  current_upper_factors?: { isc: number; imp: number; rationale: string };
  cell_temperature_rationale?: string;
  protection_and_connector_evidence_ids?: string[];
}
export interface OperatingScenario {
  component_id: string;
  mode?: string;
  battery_count?: number;
  temperature_c?: number;
  demands: { path_id: string; value: number; unit: 'W' | 'VA' | 'A' }[];
  /** Every simultaneous path must be inventoried. Missing inventory abstains. */
  required_capacity_group_ids?: string[];
  ac_loads?: {
    connection: 'line_neutral' | 'line_line';
    voltage_v: number;
    relationship: 'single_phase' | 'split_phase' | 'same_phase_legs';
    leg?: 'L1' | 'L2';
    current_a: number;
  }[];
  source_present?: boolean;
  source_relationship?: 'single_phase' | 'split_phase' | 'same_phase_legs';
  source_line_neutral_v?: number;
  source_line_line_v?: number;
  neutral_current_a?: number;
  installed_modules?: {
    component_id: string;
    model: string;
    revision: string | null;
    count: number;
    protocol?: string;
  }[];
}
export interface EngineeringEnvelopeInput {
  schema_version: 'engineering-envelope-input.v1';
  profiles: EngineeringProfile[];
  pv?: PvInstallation;
  operating?: OperatingScenario;
}
export interface EngineeringEnvelopeResult {
  schema_version: 'engineering-envelope-result.v1';
  rule_version: typeof ENGINEERING_ENVELOPE_RULE;
  status: EngineeringStatus;
  envelope_status: EngineeringStatus;
  authority: 'controlled_synthetic' | 'provisional';
  assertion_scope: 'pv-and-selected-operating-envelope';
  installation_safety: 'not_evaluated';
  checks: EngineeringCheck[];
  calculations: EngineeringCalculation[];
}

const aggregate = (checks: EngineeringCheck[]): EngineeringStatus =>
  checks.some((c) => c.status === 'BLOCKED')
    ? 'BLOCKED'
    : checks.some((c) => c.status === 'UNRESOLVED') || !checks.length
      ? 'UNRESOLVED'
      : 'ELIGIBLE';
const defined = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Model policy v1 supports homogeneous equal-length strings per independently
 * evidenced tracker. IEEE-754 comparisons are exact/inclusive; there is no
 * rounding epsilon or invented safety margin. Published uncertainty and explicit
 * cell/current bounds are applied before comparison. See ENGINEERING_CORPUS_WAVE1. */
export function evaluateEngineeringEnvelope(
  raw: EngineeringEnvelopeInput,
): EngineeringEnvelopeResult {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.profiles))
    throw new Error('Invalid envelope input');
  if (Object.keys(raw).some((k) => !['schema_version', 'profiles', 'pv', 'operating'].includes(k)))
    throw new Error('Unmodeled input property');
  if (raw.schema_version !== 'engineering-envelope-input.v1')
    throw new Error('Unsupported input version');
  const profiles = raw.profiles.map(parseEngineeringProfile);
  if (new Set(profiles.map((p) => p.component_id)).size !== profiles.length)
    throw new Error('Duplicate profile owner');
  // Result traces use evidence IDs directly. Envelope-wide uniqueness prevents
  // two product-local observations from becoming indistinguishable in a trace.
  const evidenceIds = profiles.flatMap((p) => p.evidence.map((e) => e.id));
  if (new Set(evidenceIds).size !== evidenceIds.length)
    throw new Error('Ambiguous envelope evidence IDs');
  // Reject nonfinite numeric input before JSON serialization can silently turn it
  // into null. Counts are represented, not expanded into unbounded module loops.
  const validateNumbers = (v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Nonfinite scenario value');
    if (v && typeof v === 'object') Object.values(v).forEach(validateNumbers);
  };
  validateNumbers(raw);
  const checks: EngineeringCheck[] = [];
  const calculations: EngineeringCalculation[] = [];
  const check = (
    code: string,
    subject: string,
    status: EngineeringStatus,
    explanation: string,
    evidence_ids: string[] = [],
    actual?: number,
    limit?: number,
    unit?: string,
  ) => {
    checks.push({
      code,
      subject,
      status,
      explanation,
      evidence_ids: [...new Set(evidence_ids)].sort(),
      ...(actual === undefined ? {} : { actual }),
      ...(limit === undefined ? {} : { limit }),
      ...(unit ? { unit } : {}),
    });
  };
  const unknown = (code: string, subject: string, detail: string) =>
    check(code, subject, 'UNRESOLVED', detail);
  const bound = (
    code: string,
    subject: string,
    actual: number | undefined,
    value: EngineeringValue | undefined,
    direction: 'max' | 'min',
    ids: string[] = [],
  ) => {
    if (!defined(actual) || !value)
      return unknown(code, subject, 'Missing modeled quantity or independently evidenced limit');
    const pass = direction === 'max' ? actual <= value.value : actual >= value.value;
    check(
      code,
      subject,
      pass ? 'ELIGIBLE' : 'BLOCKED',
      `${actual} ${direction === 'max' ? '<=' : '>='} ${value.value} ${value.unit}`,
      [...ids, ...value.evidence_ids],
      actual,
      value.value,
      value.unit,
    );
  };
  const calc = (
    id: string,
    formula: string,
    inputs: Record<string, number>,
    value: number,
    unit: string,
    evidence_ids: string[],
    assumptions: string[],
  ) => {
    if (!Number.isFinite(value)) throw new Error('Calculation overflow');
    calculations.push({
      id,
      formula,
      inputs,
      value,
      unit,
      evidence_ids: [...new Set(evidence_ids)].sort(),
      assumptions,
    });
    return value;
  };
  const byId = new Map(profiles.map((p) => [p.component_id, p]));
  const pv = raw.pv;
  const keys = (v: object, allowed: string[]) => {
    if (Object.keys(v).some((k) => !allowed.includes(k)))
      throw new Error('Unmodeled scenario property');
  };
  if (pv) {
    keys(pv, [
      'strings',
      'controller_id',
      'cell_min_c',
      'cell_max_c',
      'start_cell_c',
      'restart_cell_c',
      'irradiance_w_m2',
      'spectrum',
      'battery_max_v',
      'battery_nominal_v',
      'current_upper_factors',
      'cell_temperature_rationale',
      'protection_and_connector_evidence_ids',
    ]);
    if (pv.current_upper_factors) keys(pv.current_upper_factors, ['isc', 'imp', 'rationale']);
    if (defined(pv.cell_min_c) && defined(pv.cell_max_c) && pv.cell_min_c > pv.cell_max_c)
      throw new Error('Reversed cell-temperature range');
    if (
      [pv.battery_max_v, pv.battery_nominal_v, pv.irradiance_w_m2].some((v) => defined(v) && v <= 0)
    )
      throw new Error('Battery voltage and irradiance must be positive');
    const controller = byId.get(pv.controller_id);
    if (!pv.strings.length) unknown('array_missing', pv.controller_id, 'No installed strings');
    if (new Set(pv.strings.map((s) => s.id)).size !== pv.strings.length)
      throw new Error('Duplicate string ID');
    for (const s of pv.strings) {
      keys(s, ['id', 'module_id', 'series_count', 'tracker_id', 'terminal_id']);
      if (!Number.isSafeInteger(s.series_count) || s.series_count <= 0)
        throw new Error('Series count must be a positive safe integer');
      if (
        !controller?.trackers?.some(
          (t) =>
            t.grouping_status === 'source_supported' &&
            t.id === s.tracker_id &&
            t.terminal_ids?.includes(s.terminal_id),
        )
      )
        unknown(
          'tracker_membership',
          s.id,
          'Exact source-backed tracker/terminal membership missing',
        );
    }
    if (!controller?.trackers?.length)
      unknown(
        'trackers_unknown',
        pv.controller_id,
        'Connectors do not establish independent trackers',
      );
    if (!pv.cell_temperature_rationale?.trim())
      unknown(
        'cell_temperature_basis',
        pv.controller_id,
        'Explicit cell-temperature justification required',
      );
    const installedEvidence = new Set(profiles.flatMap((p) => p.evidence.map((e) => e.id)));
    if (
      !pv.protection_and_connector_evidence_ids?.length ||
      pv.protection_and_connector_evidence_ids.some((id) => !installedEvidence.has(id))
    )
      unknown(
        'installation_constraints',
        pv.controller_id,
        'Connector, cable/protection and input-sharing review remains required',
      );
    for (const tracker of controller?.trackers ?? []) {
      const strings = pv.strings.filter((s) => s.tracker_id === tracker.id);
      if (!strings.length) continue;
      if (tracker.grouping_status !== 'source_supported') {
        unknown(
          'tracker_grouping_unknown',
          tracker.id,
          'Source-owned electrical tracker grouping not established',
        );
        continue;
      }
      const owner = byId.get(strings[0]!.module_id);
      const ref = owner?.pv;
      if (!owner || !ref) {
        unknown('module_reference_missing', tracker.id, 'Missing exact module PV reference');
        continue;
      }
      if (
        strings.some(
          (s) => s.module_id !== owner.component_id || s.series_count !== strings[0]!.series_count,
        )
      ) {
        unknown(
          'heterogeneous_tracker_unmodeled',
          tracker.id,
          'Mixed modules or unequal string lengths require an unsupported I-V model',
        );
        continue;
      }
      if (strings.length > 1 && tracker.input_sharing !== 'permitted') {
        check(
          'input_sharing',
          tracker.id,
          tracker.input_sharing === 'prohibited' ? 'BLOCKED' : 'UNRESOLVED',
          'Parallel input-sharing permission must be independently evidenced',
          tracker.evidence_ids,
        );
      }
      const ns = strings[0]!.series_count,
        np = strings.length;
      const ids = owner.evidence.map((e) => e.id);
      const temperature = (
        q: 'voc' | 'vmp',
        cell: number | undefined,
        upper: boolean,
        tag: string,
      ): number | undefined => {
        const v = q === 'voc' ? ref.voc_v : ref.vmp_v;
        const beta = ref.coefficients?.[q],
          u = ref.uncertainty_fraction?.[q];
        const t = ref.reference_cell_c;
        if (
          !v ||
          !beta ||
          !t ||
          !u ||
          !defined(cell) ||
          !pv.cell_temperature_rationale?.trim() ||
          !ref.irradiance_w_m2 ||
          ref.irradiance_w_m2.value !== pv.irradiance_w_m2 ||
          !ref.spectrum ||
          ref.spectrum.value !== pv.spectrum
        ) {
          unknown(
            `${tag}_prerequisites`,
            tracker.id,
            'Need quantity-specific coefficient, reference, uncertainty, cell temperature, irradiance and spectrum',
          );
          return;
        }
        if (!beta.cell_domain_c) {
          unknown(
            `${tag}_coefficient_domain`,
            tracker.id,
            'Coefficient application domain unknown',
          );
          return;
        }
        if (
          cell < beta.cell_domain_c.min ||
          cell > beta.cell_domain_c.max ||
          t.value < beta.cell_domain_c.min ||
          t.value > beta.cell_domain_c.max
        ) {
          unknown(
            `${tag}_coefficient_domain`,
            tracker.id,
            'Extrapolation outside evidenced coefficient cell-temperature domain',
          );
          return;
        }
        const fraction =
          beta.unit === 'percent/K'
            ? beta.value / 100
            : beta.unit === 'fraction/K'
              ? beta.value
              : beta.value / v.value;
        const result =
          ns * v.value * (1 + fraction * (cell - t.value)) * (1 + (upper ? u.value : -u.value));
        if (result <= 0) {
          unknown(
            `${tag}_physical_domain`,
            tracker.id,
            'Linear approximation produces nonpositive voltage',
          );
          return;
        }
        return calc(
          `${tracker.id}.${tag}`,
          'Ns * Vref * (1 + beta_fraction_per_K * (Tcell - Tref)) * (1 +/- uncertainty)',
          {
            Ns: ns,
            Vref: v.value,
            beta_fraction_per_K: fraction,
            Tcell: cell,
            Tref: t.value,
            uncertainty: u.value,
          },
          result,
          'V',
          [...v.evidence_ids, ...beta.evidence_ids, ...t.evidence_ids, ...u.evidence_ids],
          [pv.cell_temperature_rationale],
        );
      };
      const coldVocEndpoint = temperature('voc', pv.cell_min_c, true, 'cold_voc');
      const hotVocEndpoint = temperature('voc', pv.cell_max_c, true, 'hot_voc');
      const coldVmpEndpoint = temperature('vmp', pv.cell_min_c, false, 'cold_vmp');
      const hotVmpEndpoint = temperature('vmp', pv.cell_max_c, false, 'hot_vmp');
      // Signed coefficients need both endpoints: positive beta changes which
      // endpoint is the worst case. Names alone cannot establish monotonicity.
      const coldVoc =
        coldVocEndpoint === undefined || hotVocEndpoint === undefined
          ? undefined
          : Math.max(coldVocEndpoint, hotVocEndpoint);
      const hotVmp =
        coldVmpEndpoint === undefined || hotVmpEndpoint === undefined
          ? undefined
          : Math.min(coldVmpEndpoint, hotVmpEndpoint);
      const startVmp = temperature('vmp', pv.start_cell_c, false, 'start_vmp');
      const restartVmp = temperature('vmp', pv.restart_cell_c, false, 'restart_vmp');
      // Absolute prohibition is independent of permitted reference-power clipping.
      bound('absolute_cold_voc', tracker.id, coldVoc, tracker.absolute_voc_v, 'max', ids);
      bound('module_system_voltage', tracker.id, coldVoc, ref.max_system_v, 'max', ids);
      bound('operating_upper_voltage', tracker.id, coldVoc, tracker.operating_max_v, 'max', ids);
      bound('operating_lower_voltage', tracker.id, hotVmp, tracker.operating_min_v, 'min', ids);
      for (const [tag, actual, headroom] of [
        ['run_headroom', hotVmp, tracker.run_headroom_v],
        ['start_headroom', startVmp, tracker.start_headroom_v],
        ['restart_headroom', restartVmp, tracker.restart_headroom_v],
      ] as const) {
        bound(
          tag,
          tracker.id,
          actual,
          defined(pv.battery_max_v) && headroom
            ? { ...headroom, value: pv.battery_max_v + headroom.value }
            : undefined,
          'min',
          ids,
        );
      }
      const current = (q: 'isc' | 'imp', parallel: number, subject: string) => {
        const v = q === 'isc' ? ref.isc_a : ref.imp_a;
        const factor = pv.current_upper_factors?.[q];
        if (!v || !defined(factor) || factor < 1 || !pv.current_upper_factors?.rationale.trim()) {
          unknown(
            `${q}_conditions_unknown`,
            subject,
            'PV current requires explicit upper factor >=1 and rationale',
          );
          return;
        }
        return calc(
          `${subject}.${q}`,
          'Np * Iref * justified_upper_factor',
          { Np: parallel, Iref: v.value, upper_factor: factor },
          parallel * v.value * factor,
          'A',
          v.evidence_ids,
          [pv.current_upper_factors.rationale],
        );
      };
      bound(
        'pv_short_circuit_current',
        tracker.id,
        current('isc', np, tracker.id),
        tracker.max_isc_a,
        'max',
        ids,
      );
      bound(
        'pv_operating_current',
        tracker.id,
        current('imp', np, tracker.id),
        tracker.max_imp_a,
        'max',
        ids,
      );
      for (const terminal of new Set(strings.map((s) => s.terminal_id))) {
        const limits = tracker.terminal_limits?.find((t) => t.id === terminal);
        const count = strings.filter((s) => s.terminal_id === terminal).length;
        bound(
          'terminal_short_circuit_current',
          terminal,
          current('isc', count, terminal),
          limits?.max_isc_a,
          'max',
          ids,
        );
        bound(
          'terminal_operating_current',
          terminal,
          current('imp', count, terminal),
          limits?.max_imp_a,
          'max',
          ids,
        );
      }
      const p = ref.pmax_w,
        u = ref.uncertainty_fraction?.pmax;
      const power =
        p && u
          ? calc(
              `${tracker.id}.reference_power`,
              'Ns * Np * Pmax_ref * (1 + uncertainty)',
              { Ns: ns, Np: np, Pmax_ref: p.value, uncertainty: u.value },
              ns * np * p.value * (1 + u.value),
              'W',
              [...p.evidence_ids, ...u.evidence_ids],
              ['Reference-condition power only; no yield or irradiance model'],
            )
          : undefined;
      const powerLimits =
        tracker.power_limits?.filter((l) => l.battery_nominal_v.value === pv.battery_nominal_v) ??
        [];
      if (powerLimits.length !== 1 || power === undefined)
        unknown(
          'conditional_pv_power',
          tracker.id,
          'Missing or competing battery-specific power envelope',
        );
      else {
        const l = powerLimits[0]!;
        const clipped = power > l.max_pmax_w.value;
        check(
          'conditional_pv_power',
          tracker.id,
          clipped && l.clipping === 'prohibited' ? 'BLOCKED' : 'ELIGIBLE',
          clipped
            ? `Reference power exceeds envelope; clipping ${l.clipping}`
            : 'Reference power within selected battery envelope',
          [...l.evidence_ids, ...l.max_pmax_w.evidence_ids],
          power,
          l.max_pmax_w.value,
          'W',
        );
      }
    }
  }
  const op = raw.operating;
  if (op) {
    keys(op, [
      'component_id',
      'mode',
      'battery_count',
      'temperature_c',
      'demands',
      'required_capacity_group_ids',
      'ac_loads',
      'source_present',
      'source_relationship',
      'source_line_neutral_v',
      'source_line_line_v',
      'neutral_current_a',
      'installed_modules',
    ]);
    op.demands.forEach((d) => keys(d, ['path_id', 'value', 'unit']));
    const profile = byId.get(op.component_id);
    if (!profile) unknown('operating_profile_missing', op.component_id, 'Exact profile missing');
    if (!op.mode) unknown('mode_missing', op.component_id, 'No explicitly selected operating mode');
    if (new Set(op.demands.map((d) => d.path_id)).size !== op.demands.length)
      throw new Error('Duplicate demand path');
    if (
      op.battery_count !== undefined &&
      (!Number.isSafeInteger(op.battery_count) || op.battery_count < 1)
    )
      throw new Error('Invalid battery count');
    if (defined(op.neutral_current_a) && op.neutral_current_a < 0)
      throw new Error('Neutral current must be nonnegative');
    if (op.demands.some((d) => d.value < 0 || !['W', 'VA', 'A'].includes(d.unit)))
      throw new Error('Invalid boundary demand');
    if (!op.required_capacity_group_ids?.length)
      unknown(
        'shared_inventory_unknown',
        op.component_id,
        'Required shared-capacity inventory missing',
      );
    for (const id of op.required_capacity_group_ids ?? []) {
      const groups =
        profile?.shared_capacity?.filter(
          (g) =>
            g.id === id &&
            g.mode === op.mode &&
            (g.battery_count === undefined || g.battery_count === op.battery_count) &&
            (g.temperature_c === undefined ||
              (defined(op.temperature_c) &&
                op.temperature_c >= g.temperature_c.min &&
                op.temperature_c <= g.temperature_c.max)),
        ) ?? [];
      if (groups.length !== 1) {
        unknown(
          'capacity_condition_unknown',
          id,
          'No unique group for mode/battery count/temperature',
        );
        continue;
      }
      const g = groups[0]!;
      if (g.unresolved_conditions?.length) {
        unknown('capacity_condition_unknown', id, g.unresolved_conditions.join('; '));
        continue;
      }
      const demands = op.demands.filter((d) => g.path_ids.includes(d.path_id));
      if (demands.some((d) => d.unit !== g.unit)) {
        unknown(
          'capacity_unit_mismatch',
          id,
          'W, VA and A are distinct; PF or voltage conversions require explicit upstream evidence',
        );
        continue;
      }
      for (const pair of g.excluded_path_pairs ?? []) {
        const both = pair.every((p) => demands.some((d) => d.path_id === p && d.value > 0));
        check(
          'simultaneous_exclusion',
          id,
          both ? 'BLOCKED' : 'ELIGIBLE',
          'Explicit source exclusion pair',
          g.evidence_ids,
        );
      }
      const sum = calc(
        `${id}.shared_demand`,
        'sum(boundary demands including losses exactly once)',
        Object.fromEntries(demands.map((d) => [d.path_id, d.value])),
        demands.reduce((n, d) => n + d.value, 0),
        g.unit,
        g.evidence_ids,
        ['Demands are already referred to this capacity boundary; consumer adds no losses'],
      );
      bound(
        'combined_capacity',
        id,
        sum,
        { value: g.limit, unit: g.unit, evidence_ids: g.evidence_ids },
        'max',
      );
    }
    for (const d of op.demands)
      if (
        !profile?.shared_capacity?.some(
          (g) =>
            op.required_capacity_group_ids?.includes(g.id) &&
            g.mode === op.mode &&
            g.path_ids.includes(d.path_id),
        )
      )
        unknown(
          'demand_capacity_coverage',
          d.path_id,
          'Individual-path acceptance cannot establish aggregate coverage',
        );
    if (op.ac_loads) {
      const mode = profile?.ac_modes?.find((m) => m.id === op.mode);
      if (!mode) unknown('ac_mode_unknown', op.component_id, 'Mode-specific AC topology missing');
      else {
        if (mode.source_required === undefined)
          unknown('ac_source_dependency', mode.id, 'Source dependency not asserted');
        else if (mode.source_required && op.source_present !== true)
          check(
            'ac_source_dependency',
            mode.id,
            op.source_present === false ? 'BLOCKED' : 'UNRESOLVED',
            'Selected mode requires a source',
            mode.evidence_ids,
          );
        if (mode.kind === 'bypass') {
          if (
            !op.source_relationship ||
            !defined(op.source_line_neutral_v) ||
            !mode.relationship ||
            !mode.line_neutral_v
          )
            unknown(
              'bypass_source_context',
              mode.id,
              'Source phase/conductor voltage context missing',
            );
          else
            check(
              'bypass_source_context',
              mode.id,
              op.source_relationship === mode.relationship &&
                op.source_line_neutral_v === mode.line_neutral_v.value &&
                (mode.line_line_v === undefined || op.source_line_line_v === mode.line_line_v.value)
                ? 'ELIGIBLE'
                : 'BLOCKED',
              'Bypass source must match selected phase and conductor voltages',
              mode.evidence_ids,
            );
        }
        for (const [i, load] of op.ac_loads.entries()) {
          keys(load, ['connection', 'voltage_v', 'relationship', 'leg', 'current_a']);
          if (
            load.current_a < 0 ||
            load.voltage_v <= 0 ||
            !['line_line', 'line_neutral'].includes(load.connection) ||
            !['single_phase', 'split_phase', 'same_phase_legs'].includes(load.relationship) ||
            (load.leg !== undefined && !['L1', 'L2'].includes(load.leg))
          )
            throw new Error('Invalid AC load');
          const v = load.connection === 'line_line' ? mode.line_line_v : mode.line_neutral_v;
          if (!mode.relationship || !v)
            unknown(
              'ac_voltage_relationship',
              String(i),
              'Selected mode conductor/phase relationship unknown',
            );
          else
            check(
              'ac_voltage_relationship',
              String(i),
              load.voltage_v === v.value && load.relationship === mode.relationship
                ? 'ELIGIBLE'
                : 'BLOCKED',
              'Load conductor voltage and phase must match this mode',
              [...mode.evidence_ids, ...v.evidence_ids],
            );
          if (load.connection === 'line_neutral' && !load.leg)
            unknown('ac_leg_missing', String(i), 'Explicit line-to-neutral leg required');
        }
        for (const leg of ['L1', 'L2'] as const) {
          const loads = op.ac_loads.filter((l) => l.leg === leg || l.connection === 'line_line');
          if (loads.length)
            bound(
              'ac_leg_capacity',
              leg,
              loads.reduce((n, l) => n + l.current_a, 0),
              mode.leg_limits_a?.[leg],
              'max',
            );
        }
        bound('neutral_capacity', mode.id, op.neutral_current_a, mode.neutral_limit_a, 'max');
        if (!mode.neutral_evidence_ids?.length)
          unknown(
            'neutral_topology_unknown',
            mode.id,
            'Neutral transfer/topology evidence missing',
          );
        if (!mode.grounding_evidence_ids?.length)
          unknown(
            'grounding_context_unknown',
            mode.id,
            'Mode-specific grounding/bonding evidence missing',
          );
      }
    }
    if (op.installed_modules) {
      if (!profile?.assembly)
        unknown(
          'assembly_unknown',
          op.component_id,
          'No independently evidenced assembly manifest',
        );
      const modules = op.installed_modules;
      modules.forEach((m) => keys(m, ['component_id', 'model', 'revision', 'count', 'protocol']));
      if (new Set(modules.map((m) => m.component_id)).size !== modules.length)
        throw new Error('Duplicate assembly member');
      for (const m of modules)
        if (!Number.isSafeInteger(m.count) || m.count <= 0)
          throw new Error('Invalid installed module count');
      for (const req of profile?.assembly ?? []) {
        if (req.modes && (!op.mode || !req.modes.includes(op.mode))) continue;
        const installed = modules.find((m) => m.component_id === req.component_id);
        // Included describes packaging, never proof of installation. Optional
        // absent modules impose no requirement; present modules still need proof.
        if (!installed && req.relationship === 'optional') continue;
        if (!installed) {
          unknown(
            'assembly_member_missing',
            req.component_id,
            'Required/included module installation unresolved',
          );
          continue;
        }
        if (req.compatible_revision === null || installed.revision === null)
          unknown(
            'assembly_revision_unknown',
            req.component_id,
            'Compatible kit/module revision unestablished',
          );
        else
          check(
            'assembly_identity_count',
            req.component_id,
            installed.model === req.model &&
              installed.revision === req.compatible_revision &&
              installed.count >= req.min_count &&
              installed.count <= req.max_count
              ? 'ELIGIBLE'
              : 'BLOCKED',
            'Independent module identity/revision/count; parent ratings are not copied',
            req.evidence_ids,
          );
        if (!req.protocol || !installed.protocol)
          unknown(
            'assembly_protocol_unknown',
            req.component_id,
            'Endpoint existence does not establish communication interoperability',
          );
        else
          check(
            'assembly_protocol',
            req.component_id,
            req.protocol === installed.protocol ? 'ELIGIBLE' : 'BLOCKED',
            'Exact protocol required',
            req.evidence_ids,
          );
      }
      for (const m of modules)
        if (!profile?.assembly?.some((r) => r.component_id === m.component_id))
          unknown(
            'assembly_member_unmodeled',
            m.component_id,
            'Member not in source-backed manifest',
          );
    } else if (profile?.assembly?.length)
      unknown('installed_assembly_unknown', op.component_id, 'Assembly installation not supplied');
  }
  const authority =
    profiles.length &&
    profiles.every((p) => p.evidence.length && p.evidence.every((e) => e.origin === 'synthetic'))
      ? 'controlled_synthetic'
      : 'provisional';
  const envelope_status = aggregate(checks);
  return {
    schema_version: 'engineering-envelope-result.v1',
    rule_version: ENGINEERING_ENVELOPE_RULE,
    status:
      envelope_status === 'BLOCKED'
        ? 'BLOCKED'
        : authority === 'provisional'
          ? 'UNRESOLVED'
          : envelope_status,
    envelope_status,
    authority,
    assertion_scope: 'pv-and-selected-operating-envelope',
    installation_safety: 'not_evaluated',
    checks,
    calculations,
  };
}

export type { PvQuantity };
