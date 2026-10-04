import { deriveBatteryBank } from './battery-power.js';
import { directPowerToCurrent } from './calculations.js';
import { evaluateLoadStateEnergy } from './load-state-energy.js';
import type {
  PassportEnergyResult,
  PassportStatus,
  UnresolvedEnergyContribution,
} from './engineering-passport-contracts.js';
import type { InstalledSystemContext } from './installed-system-context.js';
import { statusOf, dcKind } from './installed-system-context.js';
import { serializePassportValue } from './passport-integrity.js';
import { evaluateProjectOwnedDemand } from './project-demand-evaluation.js';

/** Exclusive device-state schedules. Device-side demand is distinct from battery-side energy/losses. */
export const evaluateInstalledScheduledDemand = (
  context: InstalledSystemContext,
  bindingStates: ReadonlyMap<string, PassportStatus>,
) => {
  const {
    request,
    instances,
    bindings,
    assumptions,
    decide,
    derive,
    consume,
    banksByInstance,
    componentFor,
    endpointDomain,
  } = context;
  const stateResults = request.requirements.load_states.map((state) => {
    const binding = bindings.get(state.binding_id);
    if (!binding) throw new TypeError(`Load state '${state.id}' references missing binding.`);
    const component = componentFor(binding.instance_id);
    const domain = endpointDomain(binding.id);
    const factIds: string[] = [];
    const assumptionIds: string[] = [];
    let powerW: number | undefined;
    if (state.power.kind === 'requirement') {
      if (!assumptions.has(state.power.assumption_id))
        throw new TypeError('Load power references a missing assumption.');
      assumptionIds.push(state.power.assumption_id);
      // An explicit demand assumption can model an active load, never manufacture
      // idle/off/quiescent evidence for an installed product.
      if (state.state === 'active' && component.product_role === 'load') powerW = state.power.watts;
    } else if (state.power.qualified_value_id !== undefined) {
      const qualifiedId = state.power.qualified_value_id;
      const observation = component.qualified_values?.find((entry) => entry.id === qualifiedId);
      const observed = consume(
        component,
        `qualified_values.${qualifiedId}`,
        observation,
        factIds,
        'W',
      );
      if (observed?.target === 'electrical.power_consumption_w') {
        const qualifiers = observed.qualifiers;
        const stateMatches =
          state.state === 'quiescent'
            ? qualifiers.measurement_basis === 'quiescent'
            : qualifiers.operating_state === state.state;
        const contextMatches =
          state.power.context !== undefined &&
          serializePassportValue(qualifiers) === serializePassportValue(state.power.context);
        const bank = banksByInstance.get(binding.instance_id);
        const unitSupplyVoltage =
          bank && domain.nominal_voltage_v !== undefined
            ? domain.nominal_voltage_v / bank.series_count
            : domain.nominal_voltage_v;
        if (
          stateMatches &&
          contextMatches &&
          qualifiers.supply_voltage_v === unitSupplyVoltage &&
          qualifiers.electrical_domain === dcKind(domain) &&
          (!bank || bindingStates.get(binding.id) === 'satisfied')
        )
          powerW = observed.value;
      }
    } else if (state.state === 'active') {
      powerW = consume(
        component,
        'electrical.power_consumption_w',
        component.electrical?.power_consumption_w,
        factIds,
        'W',
      );
    }
    const bank = banksByInstance.get(binding.instance_id);
    if (bank && bank.series_count * bank.parallel_count > 1) {
      // A bank instance's source consumption remains a unit observation; never
      // undercount baseline power by forgetting the installed unit multiplicity.
      if (state.power.kind === 'component' && powerW !== undefined) {
        const unitPower = powerW;
        powerW *= bank.series_count * bank.parallel_count;
        derive(
          `bank-baseline:${state.id}`,
          'bankPowerW = unitPowerW * seriesCount * parallelCount',
          {
            unit_power_w: unitPower,
            series_count: bank.series_count,
            parallel_count: bank.parallel_count,
          },
          powerW,
          'W',
          factIds,
        );
      }
    }
    const result = evaluateLoadStateEnergy({
      contributionId: state.id,
      loadId: state.id,
      instanceId: binding.instance_id,
      productId: component.id,
      stateId: state.state,
      stateClassification: state.state,
      ...(powerW === undefined ? {} : { powerW }),
      ...(state.duration_hours === undefined ? {} : { durationHours: state.duration_hours }),
      powerBasis: 'device-side',
    });
    const localStatus = result.severity === 'PASS' ? 'satisfied' : 'unresolved';
    // The legacy primitive also emits signed battery observations even for
    // device-side inputs. This composition cannot assert battery-side demand
    // without conversion losses, so only the scoped device result is published.
    const {
      netBatteryPowerW: _batteryPower,
      netBatteryEnergyWh: _batteryEnergy,
      ...deviceResult
    } = result;
    decide(
      `load-state:${state.id}`,
      localStatus,
      powerW === undefined ? 'state_power_unresolved' : 'state_energy',
      powerW === undefined
        ? 'State power lacks applicable reviewed evidence; missing consumption is not zero.'
        : 'State energy uses explicit duration and power.',
      state,
      factIds,
      assumptionIds,
      {
        ...deviceResult,
        power_origin:
          powerW === undefined
            ? 'unresolved'
            : state.power.kind === 'requirement'
              ? 'project_requirement'
              : 'canonical_observation',
      },
    );
    if (result.energyWh !== undefined)
      derive(
        `energy:state:${state.id}`,
        'energyWh = powerW * durationHours',
        { powerW, durationHours: state.duration_hours },
        result.energyWh,
        'Wh',
        factIds,
        assumptionIds,
      );
    // I=P/V is a DC nominal design observation, not AC current without PF or
    // a converter input-current claim without explicit efficiency.
    if (powerW !== undefined && domain.nominal_voltage_v !== undefined && dcKind(domain) === 'dc') {
      const current = directPowerToCurrent({ powerW, voltageV: domain.nominal_voltage_v });
      if (current.ok)
        derive(
          `current:state:${state.id}`,
          'currentA = powerW / voltageV (DC nominal design point)',
          current.value,
          current.value.currentA,
          'A',
          factIds,
          assumptionIds,
        );
    }
    return { state, binding, result };
  });
  // Incompleteness belongs inside the portable energy summary: consumers must
  // not reconstruct omitted demand by searching unrelated schedule decisions.
  const unresolvedContributions: UnresolvedEnergyContribution[] = [];
  for (const { state, binding, result } of stateResults) {
    if (result.energyWh !== undefined) continue;
    const reasons: Extract<UnresolvedEnergyContribution, { kind: 'state' }>['reasons'][number][] =
      [];
    if (result.powerW === undefined) reasons.push('power_unknown');
    if (state.duration_hours === undefined) reasons.push('duration_unknown');
    if (reasons.length === 0) reasons.push('energy_not_resolved');
    unresolvedContributions.push({
      kind: 'state',
      instance_id: binding.instance_id,
      state_id: state.id,
      reasons,
    });
  }
  const projectDemand = evaluateProjectOwnedDemand(context);
  unresolvedContributions.push(...projectDemand.unresolved);
  if (stateResults.length === 0 && projectDemand.stateCount === 0)
    unresolvedContributions.push({ kind: 'evaluation', reason: 'no_states' });
  const resolvedSubtotalEnergyWh = stateResults.reduce(
    (sum, { result }) => sum + (result.energyWh === undefined ? 0 : result.energyWh),
    projectDemand.subtotal,
  );
  const coverageStates: PassportStatus[] = [];
  for (const instance of instances.values()) {
    const schedules = stateResults.filter(({ binding }) => binding.instance_id === instance.id);
    const hours = schedules.reduce(
      (sum, { state }) => sum + (state.duration_hours === undefined ? 0 : state.duration_hours),
      0,
    );
    const complete =
      request.requirements.evaluation_hours !== undefined &&
      schedules.length > 0 &&
      schedules.every(({ state }) => state.duration_hours !== undefined) &&
      hours === request.requirements.evaluation_hours;
    if (!complete) {
      const reasons: Extract<
        UnresolvedEnergyContribution,
        { kind: 'schedule' }
      >['reasons'][number][] = [];
      if (schedules.length === 0) reasons.push('schedule_missing');
      if (schedules.some(({ state }) => state.duration_hours === undefined))
        reasons.push('duration_unknown');
      if (request.requirements.evaluation_hours === undefined) reasons.push('horizon_unknown');
      else if (hours !== request.requirements.evaluation_hours) reasons.push('horizon_mismatch');
      unresolvedContributions.push({ kind: 'schedule', instance_id: instance.id, reasons });
    }
    coverageStates.push(
      decide(
        `schedule:${instance.id}`,
        complete ? 'satisfied' : 'unresolved',
        'schedule_coverage',
        'Every installed instance requires an explicit full-duration schedule; unmodeled baseline demand cannot disappear.',
        {
          instance_id: instance.id,
          ...(request.requirements.evaluation_hours === undefined
            ? {}
            : { evaluation_hours: request.requirements.evaluation_hours }),
          scheduled_hours: hours,
          state_ids: schedules.map(({ state }) => state.id),
        },
      ),
    );
  }
  const energyStatus = statusOf([
    ...coverageStates,
    ...stateResults.map(({ result }) =>
      result.energyWh === undefined ? ('unresolved' as const) : ('satisfied' as const),
    ),
    ...(stateResults.length === 0 && projectDemand.stateCount === 0 ? ['unresolved' as const] : []),
    ...(projectDemand.unresolved.length ? ['unresolved' as const] : []),
  ]);
  if (!Number.isFinite(resolvedSubtotalEnergyWh))
    throw new TypeError('Energy arithmetic overflow; no finite portable result can be produced.');
  const subtotal = {
    basis: 'device-side' as const,
    resolved_subtotal_energy_wh: resolvedSubtotalEnergyWh,
  };
  const energy: PassportEnergyResult =
    energyStatus === 'satisfied'
      ? {
          ...subtotal,
          status: 'satisfied',
          completeness: 'complete',
          total_energy_wh: resolvedSubtotalEnergyWh,
          unresolved_contributions: [],
        }
      : {
          ...subtotal,
          status: 'unresolved',
          completeness: 'incomplete',
          unresolved_contributions: unresolvedContributions,
        };
  derive(
    'energy:resolved-device-subtotal',
    'resolvedSubtotalEnergyWh = sum(resolved explicit device-state energies); unresolved contributions are excluded, not assigned zero',
    {
      resolved_state_energy_wh: stateResults
        .filter(({ result }) => result.energyWh !== undefined)
        .map(({ state, result }) => ({ state_id: state.id, energy_wh: result.energyWh })),
      unresolved_contributions: unresolvedContributions,
      ...(context.projectDemands.size
        ? { resolved_project_demand_energy_wh: projectDemand.subtotal }
        : {}),
      complete_schedule: energyStatus === 'satisfied',
    },
    resolvedSubtotalEnergyWh,
    'Wh',
  );
  if (energyStatus === 'satisfied')
    derive(
      'energy:system',
      'totalEnergyWh = sum(explicit full-duration device-side state energies)',
      {
        state_ids: stateResults.map(({ state }) => state.id),
        energy_wh: stateResults.map(({ result }) => result.energyWh),
        ...(context.projectDemands.size
          ? { resolved_project_demand_energy_wh: projectDemand.subtotal }
          : {}),
      },
      resolvedSubtotalEnergyWh,
      'Wh',
    );

  return energy;
};

/** Exact selected bank only; reuse arithmetic without enumerating or recommending alternatives. */
export const evaluateInstalledBatteryBanks = (context: InstalledSystemContext): void => {
  const { request, warnings, decide, derive, consume, componentFor, endpointDomain } = context;
  for (const bank of request.requirements.battery_banks) {
    const component = componentFor(bank.instance_id);
    const domain = endpointDomain(bank.domain_id);
    const factIds: string[] = [];
    const voltage = consume(
      component,
      'electrical.nominal_voltage_v',
      component.electrical?.nominal_voltage_v,
      factIds,
      'V',
    );
    const capacity = consume(
      component,
      'battery.nominal_capacity_ah',
      component.battery?.nominal_capacity_ah,
      factIds,
      'Ah',
    );
    const series = consume(
      component,
      'battery.allowed_series_count',
      component.battery?.allowed_series_count,
      factIds,
    );
    const parallel = consume(
      component,
      'battery.allowed_parallel_count',
      component.battery?.allowed_parallel_count,
      factIds,
    );
    const energyWh = consume(
      component,
      'battery.nominal_energy_wh',
      component.battery?.nominal_energy_wh,
      factIds,
      'Wh',
    );
    const batteryCapability = consume(
      component,
      'capabilities.energy_storage',
      component.capabilities?.find((entry) => entry.type === 'energy_storage'),
      factIds,
    );
    if (
      typeof voltage !== 'number' ||
      capacity === undefined ||
      !series ||
      !parallel ||
      !batteryCapability
    ) {
      decide(
        `bank:${bank.id}`,
        'unresolved',
        'bank_evidence_missing',
        'Bank voltage/capacity and explicit manufacturer series/parallel permission require reviewed evidence.',
        bank,
        factIds,
      );
      continue;
    }
    const result = deriveBatteryBank(
      {
        nominalVoltageV: voltage,
        nominalCapacityAh: capacity,
        allowedSeriesCount: series,
        allowedParallelCount: parallel,
        ...(energyWh === undefined ? {} : { nominalEnergyWh: energyWh }),
      },
      { seriesCount: bank.series_count, parallelCount: bank.parallel_count },
    );
    if (!result.ok) {
      decide(
        `bank:${bank.id}`,
        result.code === 'invalid_input' ? 'blocked' : 'unresolved',
        'bank_topology',
        result.reasons.join('; '),
        bank,
        factIds,
      );
      continue;
    }
    let status: PassportStatus =
      domain.nominal_voltage_v === undefined
        ? 'unresolved'
        : domain.kind === 'ac' || domain.nominal_voltage_v !== result.value.nominalVoltageV
          ? 'blocked'
          : 'satisfied';
    if (
      bank.required_nominal_energy_wh !== undefined &&
      result.value.nominalEnergyWh < bank.required_nominal_energy_wh
    )
      status = 'blocked';
    // Bank arithmetic does not prove the individual port wiring or balancing;
    // an instance in this view represents one separately selected identical-unit
    // bank. Permission is evidence, never a series recommendation.
    decide(
      `bank:${bank.id}`,
      status,
      'bank_topology',
      'Explicit identical-unit bank arithmetic and manufacturer count permissions; usable energy and balancing remain separate.',
      bank,
      factIds,
      [],
      // Legacy "manufacturer" labels describe availability of the unit input,
      // not its provenance. A canonical unit energy may itself be derived, and
      // every bank aggregate is derived. Never carry that label into passports.
      {
        seriesCount: result.value.seriesCount,
        parallelCount: result.value.parallelCount,
        totalUnitCount: result.value.totalUnitCount,
        nominalVoltageV: result.value.nominalVoltageV,
        nominalCapacityAh: result.value.nominalCapacityAh,
        nominalEnergyWh: result.value.nominalEnergyWh,
        energy_origin: 'derived_bank_aggregate',
      },
    );
    derive(
      `bank:${bank.id}`,
      energyWh === undefined
        ? 'nominalEnergyWh = unitVoltageV * unitCapacityAh * seriesCount * parallelCount'
        : 'nominalEnergyWh = canonicalUnitEnergyWh * seriesCount * parallelCount',
      {
        unit_voltage_v: voltage,
        unit_capacity_ah: capacity,
        ...(energyWh === undefined ? {} : { unit_energy_wh: energyWh }),
        series_count: bank.series_count,
        parallel_count: bank.parallel_count,
      },
      {
        nominal_energy_wh: result.value.nominalEnergyWh,
        nominal_voltage_v: result.value.nominalVoltageV,
        nominal_capacity_ah: result.value.nominalCapacityAh,
      },
      'Wh,V,Ah',
      factIds,
    );
    if (bank.series_count > 1)
      warnings.push({
        code: 'series_installation_review',
        instance_id: bank.instance_id,
        message:
          'Permitted count is distinct from balancing, maintenance and installation review; preserved product advisories remain applicable.',
      });
  }
};
