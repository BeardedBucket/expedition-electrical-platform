import type {
  ArchitectureCandidate,
  RequiredProductRole,
  RequiredRoleConstraint,
} from './architecture-generation-contracts.js';
import type { ComponentLibraryRecord, ComponentLogicalPort } from './component-library.js';
import { capabilityAllowsPathParticipants } from './component-library.js';
import type { ExaminedProductEvidence } from './engineering-passport-contracts.js';
import { includesValue, maximum } from './installed-system-context.js';
import { passportDigest } from './portable-json.js';
import type {
  CandidateBindingEvaluation,
  GateTruth,
  ProductBindingWitness,
  ProductFeasibility,
  ProductSelectionPolicy,
  SelectionCalculation,
  SelectionGate,
  SelectionReason,
  StorageAssemblyIntent,
} from './product-selection-contracts.js';

export const feasibility = (truths: readonly GateTruth[], upstream = false): ProductFeasibility =>
  truths.includes('NO')
    ? 'BLOCKED'
    : upstream || truths.includes('UNKNOWN')
      ? 'UNRESOLVED'
      : 'ELIGIBLE';

/** The Phase 3 canonical trust rule is record verification, not source presence or confidence.
 * Exact record-level references are retained without inventing field-level attribution.
 */
export const examineSelectionFact = (
  record: ComponentLibraryRecord,
  path: string,
  value: unknown,
  unit?: string,
): ExaminedProductEvidence[] => {
  if (value === undefined || value === null) return [];
  const derivation = (record.derived_fields as Record<string, unknown> | undefined)?.[path];
  return [
    {
      id: `evidence:${record.id}:${path}`,
      component_id: record.id,
      record_digest: passportDigest(record),
      path,
      canonical_value: value,
      verification_status: record.verification_status,
      origin: derivation === undefined ? 'canonical_assertion' : 'product_derivation',
      engineering_use:
        record.verification_status === 'verified'
          ? { state: 'accepted_input' }
          : { state: 'withheld', reason: 'record_not_verified' },
      source_refs: record.source_refs ?? [],
      source_native: { state: 'not_retained_in_canonical_record' },
      normalization: {
        kind: 'canonical_projection',
        value,
        ...(unit === undefined ? {} : { unit }),
      },
      ...(derivation === undefined ? {} : { product_derivation: derivation }),
    },
  ];
};

/** Exhaustive finite witnesses, including a null placeholder only when an interface/path is missing.
 * No category prefilter and no top-N. Bounds reject before extending a Cartesian frontier.
 */
export const enumerateProductWitnesses = (
  role: RequiredProductRole,
  record: ComponentLibraryRecord,
  policy: ProductSelectionPolicy,
): ProductBindingWitness[] => {
  let frontier: ProductBindingWitness[] = [{ interfaces: {}, paths: {} }];
  const extend = (choices: (w: ProductBindingWitness) => ProductBindingWitness[]) => {
    const next: ProductBindingWitness[] = [];
    for (const witness of frontier) {
      const additions = choices(witness);
      if (next.length + additions.length > policy.bounds.max_bindings_per_candidate)
        throw new TypeError(
          'Product binding expansion exceeds policy bound; nothing was truncated.',
        );
      next.push(...additions);
    }
    frontier = next;
  };
  const ids = [
    ...new Set(role.constraints.filter((c) => c.kind === 'interface').map((c) => c.interface_id)),
  ].sort();
  const portIds: (string | null)[] = record.ports?.length
    ? record.ports.map((p) => p.id).sort()
    : [null];
  if (ids.length && portIds.length > policy.bounds.max_bindings_per_candidate)
    throw new TypeError('Product port frontier exceeds policy bound; nothing was truncated.');
  for (const id of ids)
    extend((w) => portIds.map((port) => ({ ...w, interfaces: { ...w.interfaces, [id]: port } })));
  for (const c of [...role.constraints].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (c.kind !== 'directed_power_path') continue;
    extend((w) => {
      const paths = (record.power_paths ?? [])
        .filter(
          (p) =>
            p.from_port === w.interfaces[c.from_interface] &&
            p.to_port === w.interfaces[c.to_interface],
        )
        .map((p) => p.id)
        .sort();
      return (paths.length ? paths : [null]).map((path) => ({
        ...w,
        paths: { ...w.paths, [c.path_id]: path },
      }));
    });
  }
  return frontier;
};

export const evaluateProductWitness = (
  architecture: ArchitectureCandidate,
  role: RequiredProductRole,
  record: ComponentLibraryRecord,
  witness: ProductBindingWitness,
  assembly?: StorageAssemblyIntent,
): CandidateBindingEvaluation => {
  const calculations: SelectionCalculation[] = [];
  const accepted = record.verification_status === 'verified';
  const fact = (path: string, value: unknown, unit?: string) =>
    examineSelectionFact(record, path, value, unit);
  const result = (
    c: RequiredRoleConstraint,
    evidence: ExaminedProductEvidence[],
    test: boolean | undefined,
    unknownReason: SelectionReason = 'fact_missing',
    negativeReason: SelectionReason = 'engineering_mismatch',
  ): SelectionGate => ({
    constraint: c,
    truth: !evidence.length || !accepted || test === undefined ? 'UNKNOWN' : test ? 'YES' : 'NO',
    reason: !evidence.length
      ? unknownReason
      : !accepted
        ? 'evidence_not_engineering_authoritative'
        : test === undefined
          ? unknownReason
          : test
            ? 'requirement_supported'
            : negativeReason,
    evidence,
  });
  const portFor = (id: string): ComponentLogicalPort | undefined =>
    record.ports?.find((p) => p.id === witness.interfaces[id]);
  const series = assembly?.series_count ?? 1;
  const parallel = assembly?.parallel_count ?? 1;
  const calculate = (
    formula: string,
    inputs: Record<string, number>,
    output: number,
    unit: SelectionCalculation['unit'],
    evidence: ExaminedProductEvidence[],
  ) => {
    if (!Number.isFinite(output)) throw new TypeError('Nonfinite assembly calculation.');
    const calculation = { kind: 'derived' as const, formula, inputs, output, unit, evidence };
    if (!calculations.some((c) => c.formula === formula)) calculations.push(calculation);
    return output;
  };
  const energy = () => {
    const energyWh = record.battery?.nominal_energy_wh;
    const voltage = record.electrical?.nominal_voltage_v;
    const ah = record.battery?.nominal_capacity_ah;
    const evidence =
      energyWh == null
        ? [
            ...fact('electrical.nominal_voltage_v', voltage, 'V'),
            ...fact('battery.nominal_capacity_ah', ah, 'Ah'),
          ]
        : fact('battery.nominal_energy_wh', energyWh, 'Wh');
    if (!accepted) return { value: undefined, evidence };
    let unitEnergy: number | undefined = energyWh ?? undefined;
    if (unitEnergy === undefined && typeof voltage === 'number' && typeof ah === 'number')
      unitEnergy = calculate(
        'unitEnergyWh = unitNominalVoltageV * unitNominalCapacityAh',
        { unitNominalVoltageV: voltage, unitNominalCapacityAh: ah },
        voltage * ah,
        'Wh',
        evidence,
      );
    // Same nominal identities as deriveBatteryBank. Arithmetic is independent of
    // permission; the separate assembly gates establish whether this count is allowed.
    const value =
      unitEnergy === undefined
        ? undefined
        : assembly
          ? calculate(
              'bankEnergyWh = unitEnergyWh * seriesCount * parallelCount',
              { unitEnergyWh: unitEnergy, seriesCount: series, parallelCount: parallel },
              unitEnergy * series * parallel,
              'Wh',
              evidence,
            )
          : unitEnergy;
    return { value, evidence };
  };
  type Evaluators = {
    [K in RequiredRoleConstraint['kind']]: (
      c: Extract<RequiredRoleConstraint, { kind: K }>,
    ) => SelectionGate;
  };
  const evaluators: Evaluators = {
    capability: (c) => {
      const linked = role.constraints.filter(
        (p): p is Extract<RequiredRoleConstraint, { kind: 'directed_power_path' }> =>
          p.kind === 'directed_power_path' && p.capability === c.capability,
      );
      const pathIds = linked.map((p) => witness.paths[p.path_id]);
      const capabilityIds =
        record.power_paths?.filter((p) => pathIds.includes(p.id)).map((p) => p.capability_id) ?? [];
      const positive = record.capabilities?.find(
        (p) => p.type === c.capability && (!linked.length || capabilityIds.includes(p.id)),
      );
      const negative = record.unsupported_capabilities?.includes(c.capability);
      const evidence = positive
        ? fact(`capabilities.${positive.id}`, positive)
        : negative
          ? fact('unsupported_capabilities', record.unsupported_capabilities)
          : [];
      if (positive && c.capability === 'energy_storage') {
        const ports = Object.values(witness.interfaces);
        return result(
          c,
          evidence,
          positive.port_ids === undefined || ports.some((p) => p === null)
            ? undefined
            : ports.every((p) => positive.port_ids!.includes(p!)),
          'binding_unresolved',
        );
      }
      return result(
        c,
        evidence,
        positive ? true : negative ? false : undefined,
        linked.length ? 'binding_unresolved' : 'fact_missing',
        'explicit_negative_capability',
      );
    },
    interface: (c) => {
      const port = portFor(c.interface_id);
      const domain = architecture.topology.domains.find((d) => d.id === c.domain_id)!;
      const upstreamUnknown =
        domain.nominal_voltage_v === undefined ||
        (domain.kind === 'ac' && domain.frequency_hz === undefined);
      const matches =
        port === undefined
          ? undefined
          : port.domain === (domain.kind === 'ac' ? 'ac' : 'dc') &&
            (port.direction === 'bidirectional' || port.direction === c.direction);
      // A missing design point does not eliminate its mandatory domain requirement.
      // Preserve known direction/type contradictions while withholding a domain YES.
      return result(
        c,
        fact(`ports.${port?.id ?? 'missing'}`, port),
        matches === false ? false : upstreamUnknown ? undefined : matches,
        upstreamUnknown ? 'upstream_requirement_unresolved' : 'binding_unresolved',
      );
    },
    nominal_voltage: (c) => {
      const port = portFor(c.interface_id);
      const evidence = fact(`ports.${port?.id ?? 'missing'}.voltage_v`, port?.voltage_v, 'V');
      let voltage = port?.voltage_v;
      if (assembly && accepted && typeof voltage === 'number')
        voltage = calculate(
          'bankPortVoltageV = unitPortVoltageV * seriesCount',
          { unitPortVoltageV: voltage, seriesCount: series },
          voltage * series,
          'V',
          evidence,
        );
      return result(
        c,
        evidence,
        port?.constraints?.length ? undefined : includesValue(voltage, c.voltage_v),
        port?.constraints?.length ? 'contextual_rating_unresolved' : 'fact_missing',
      );
    },
    ac_frequency: (c) => {
      const port = portFor(c.interface_id);
      return result(
        c,
        fact(`ports.${port?.id ?? 'missing'}.frequency_hz`, port?.frequency_hz, 'Hz'),
        port?.constraints?.length ? undefined : includesValue(port?.frequency_hz, c.frequency_hz),
        port?.constraints?.length ? 'contextual_rating_unresolved' : 'fact_missing',
      );
    },
    minimum_output_power: (c) => {
      const port = portFor(c.interface_id);
      const limit = maximum(port?.power_w);
      // Headline product W and other ports never fill this gate. Material contexts
      // remain unresolved until a typed interpreter can establish applicability.
      return result(
        c,
        fact(`ports.${port?.id ?? 'missing'}`, port, 'W'),
        limit === undefined || port?.constraints?.length || assembly
          ? undefined
          : limit >= c.power_w,
        port?.constraints?.length || assembly ? 'contextual_rating_unresolved' : 'fact_missing',
      );
    },
    minimum_nominal_storage_energy: (c) => {
      const e = energy();
      return result(c, e.evidence, e.value === undefined ? undefined : e.value >= c.energy_wh);
    },
    directed_power_path: (c) => {
      const path = record.power_paths?.find((p) => p.id === witness.paths[c.path_id]);
      const cap = record.capabilities?.find((p) => p.id === path?.capability_id);
      return result(
        c,
        [
          ...fact(`power_paths.${path?.id ?? 'missing'}`, path),
          ...fact(`capabilities.${cap?.id ?? 'missing'}`, cap),
        ],
        path && cap
          ? path.from_port === witness.interfaces[c.from_interface] &&
              path.to_port === witness.interfaces[c.to_interface] &&
              cap.type === c.capability &&
              capabilityAllowsPathParticipants(cap, path)
          : undefined,
        'binding_unresolved',
      );
    },
    distinct_interfaces: (c) => {
      const ports = c.interface_ids.map((id) => portFor(id));
      return result(
        c,
        ports.flatMap((port) => fact(`ports.${port?.id ?? 'missing'}`, port)),
        ports.some((p) => !p) ? undefined : new Set(ports.map((p) => p!.id)).size === ports.length,
        'binding_unresolved',
      );
    },
    isolation: (c) => {
      const path = record.power_paths?.find((p) => p.id === witness.paths[c.path_id]);
      return result(
        c,
        fact(`power_paths.${path?.id ?? 'missing'}.isolated`, path?.isolated),
        path?.isolated,
      );
    },
  };
  const gates = [...role.constraints]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => {
      // The discriminated registry requires every current predicate; extension is
      // localized here. Runtime malformed/unsupported predicates are rejected upstream.
      const evaluate = evaluators[c.kind] as (constraint: RequiredRoleConstraint) => SelectionGate;
      return evaluate(c);
    });
  const assemblyGates: CandidateBindingEvaluation['assembly_gates'][number][] = [];
  if (assembly) {
    for (const [axis, count] of [
      ['series', series],
      ['parallel', parallel],
    ] as const) {
      if (count === 1) continue; // One unit/string introduces no inter-unit connection on this axis.
      const permission =
        record.battery?.[axis === 'series' ? 'allowed_series_count' : 'allowed_parallel_count'];
      const evidence = fact(`battery.allowed_${axis}_count`, permission);
      const truth: GateTruth =
        !accepted || !permission
          ? 'UNKNOWN'
          : count >= permission.min && count <= permission.max
            ? 'YES'
            : 'NO';
      assemblyGates.push({
        axis,
        count,
        truth,
        reason: !permission
          ? 'assembly_permission_unknown'
          : !accepted
            ? 'evidence_not_engineering_authoritative'
            : truth === 'YES'
              ? 'requirement_supported'
              : 'engineering_mismatch',
        evidence,
      });
    }
    if (accepted && typeof record.battery?.nominal_capacity_ah === 'number')
      calculate(
        'bankCapacityAh = unitCapacityAh * parallelCount',
        { unitCapacityAh: record.battery.nominal_capacity_ah, parallelCount: parallel },
        record.battery.nominal_capacity_ah * parallel,
        'Ah',
        fact('battery.nominal_capacity_ah', record.battery.nominal_capacity_ah, 'Ah'),
      );
    energy();
  }
  const upstream = role.output_capacity.some(
    (c) => c.scope === 'required_output_sizing' && c.status === 'unresolved',
  );
  const body = {
    witness,
    status: feasibility(
      [...gates.map((g) => g.truth), ...assemblyGates.map((g) => g.truth)],
      upstream,
    ),
    gates,
    assembly_gates: assemblyGates,
    calculations,
  };
  return {
    id: `binding.${passportDigest({ component_id: record.id, witness, ...(assembly ? { assembly } : {}) }).slice(7)}`,
    ...body,
  };
};
