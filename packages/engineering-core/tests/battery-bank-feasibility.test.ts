import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateBatteryBankFeasibility,
  evaluateEnergyStorageRequirement,
  type BatteryEngineeringInput,
} from '../src/index.js';
import { loadComponentLibraryFile } from '../src/component-library-loader.js';

const loadEpochBattery = async (): Promise<BatteryEngineeringInput> => {
  const result = await loadComponentLibraryFile(
    path.resolve('data/components/epoch-batteries.b24100a-c.yaml'),
  );
  if (!result.ok) throw new Error(result.errors.join('; '));
  const component = result.value;
  const scalar = (value: number | number[] | null | undefined): number => {
    if (typeof value !== 'number') throw new Error('Expected a scalar numeric component field.');
    return value;
  };
  return {
    id: component.id,
    nominalVoltageV: scalar(component.electrical?.nominal_voltage_v),
    nominalCapacityAh: scalar(component.battery?.nominal_capacity_ah),
    nominalEnergyWh: scalar(component.battery?.nominal_energy_wh),
    continuousDischargeCurrentA: scalar(component.electrical?.continuous_discharge_current_a),
    peakDischargeCurrentA: scalar(component.electrical?.peak_discharge_current_a),
    peakDischargeDurationS: scalar(component.electrical?.peak_discharge_duration_s),
    allowedSeriesCount: component.battery?.allowed_series_count ?? undefined,
    allowedParallelCount: component.battery?.allowed_parallel_count ?? undefined,
  };
};

const storageRequirement = (requiredUsableEnergyWh = 3000) =>
  evaluateEnergyStorageRequirement({
    requirementId: 'storage-3c',
    requiredUsableEnergyWh,
    autonomyPeriodCount: 2,
    usableFractionOfNominal: 0.8,
    basis: { kind: 'explicit', sourceId: 'test' },
  });

describe('battery bank feasibility integration', () => {
  it('bridges Phase 3B energy and keeps the selected topology separate', async () => {
    const battery = await loadEpochBattery();
    const result = evaluateBatteryBankFeasibility({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      storageRequirement: storageRequirement(),
      electricalRequirements: { nominalVoltageV: 25.6 },
    });

    expect(result.status).toBe('FAIL');
    expect(result.requirements.nominalEnergyWh).toBe(7500);
    expect(result.selected.requestedTopology).toEqual({ seriesCount: 1, parallelCount: 1 });
    expect(result.selected.requirementResults.nominalEnergy?.severity).toBe('FAIL');
    expect(result.feasibleAlternatives).toEqual([
      { seriesCount: 1, parallelCount: 3 },
      { seriesCount: 1, parallelCount: 4 },
    ]);
  });

  it('enforces voltage, continuous current, and peak duration through the kernel', async () => {
    const battery = await loadEpochBattery();
    const input = {
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      storageRequirement: storageRequirement(),
      electricalRequirements: {
        nominalVoltageV: 25.6,
        continuousDischargeCurrentA: 145,
        peakDischarge: { currentA: 180, durationSeconds: 30 },
      },
    };

    const result = evaluateBatteryBankFeasibility(input);
    expect(result.feasibleAlternatives).toEqual([
      { seriesCount: 1, parallelCount: 3 },
      { seriesCount: 1, parallelCount: 4 },
    ]);
    expect(
      evaluateBatteryBankFeasibility({
        ...input,
        electricalRequirements: {
          ...input.electricalRequirements,
          peakDischarge: { currentA: 180, durationSeconds: 90 },
        },
      }).selected.requirementResults.peakDischarge?.code,
    ).toBe('battery.bank.surge_duration_insufficient');
  });

  it('supports exact series voltage constraints and zero energy without creating 0S0P', async () => {
    const battery = await loadEpochBattery();
    const result = evaluateBatteryBankFeasibility({
      battery,
      selectedTopology: { seriesCount: 2, parallelCount: 1 },
      storageRequirement: storageRequirement(),
      electricalRequirements: { nominalVoltageV: 51.2 },
    });
    expect(result.feasibleAlternatives).toEqual([
      { seriesCount: 2, parallelCount: 2 },
      { seriesCount: 2, parallelCount: 3 },
      { seriesCount: 2, parallelCount: 4 },
    ]);

    const zero = evaluateBatteryBankFeasibility({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      storageRequirement: storageRequirement(0),
    });
    expect(zero.status).toBe('PASS');
    expect(zero.selected.bank).toMatchObject({ seriesCount: 1, parallelCount: 1 });
    expect(zero.feasibleAlternatives).not.toContainEqual({ seriesCount: 0, parallelCount: 0 });
  });

  it('propagates failed storage requirements and excludes unresolved or illegal alternatives', async () => {
    const battery = await loadEpochBattery();
    const failed = evaluateBatteryBankFeasibility({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      storageRequirement: evaluateEnergyStorageRequirement({
        requiredUsableEnergyWh: 3000,
        autonomyPeriodCount: 2,
        usableFractionOfNominal: 0,
      }),
    });
    expect(failed.status).toBe('FAIL');
    expect(failed.feasibleAlternatives).toEqual([]);
    expect(
      failed.issues.some(
        (issue) => issue.code === 'energy.storage_requirement.invalid_usable_fraction_of_nominal',
      ),
    ).toBe(true);

    const unresolved = evaluateBatteryBankFeasibility({
      battery: { ...battery, continuousDischargeCurrentA: undefined },
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      storageRequirement: storageRequirement(0),
      electricalRequirements: { continuousDischargeCurrentA: 145 },
    });
    expect(unresolved.status).toBe('CONDITIONAL');
    expect(unresolved.feasibleAlternatives).toEqual([]);

    const illegal = evaluateBatteryBankFeasibility({
      battery,
      selectedTopology: { seriesCount: 3, parallelCount: 1 },
      storageRequirement: storageRequirement(),
    });
    expect(illegal.status).toBe('FAIL');
    expect(illegal.selected.topologyLegal).toBe(false);
    expect(illegal.feasibleAlternatives).not.toContainEqual({ seriesCount: 3, parallelCount: 1 });
  });

  it('does not accept a second nominal energy source', () => {
    const battery = {
      nominalVoltageV: 24,
      nominalCapacityAh: 100,
      allowedSeriesCount: { min: 1, max: 1 },
      allowedParallelCount: { min: 1, max: 1 },
    };
    const result = evaluateBatteryBankFeasibility({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      storageRequirement: storageRequirement(),
      electricalRequirements: { nominalVoltageV: 24 },
    });
    expect(result.requirements.nominalEnergyWh).toBe(7500);
    expect(result.requirements.nominalVoltageV).toBe(24);
  });
});
