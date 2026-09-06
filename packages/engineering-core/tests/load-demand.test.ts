import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateBatteryBankConfiguration, type BatteryEngineeringInput } from '../src/index.js';
import { loadComponentLibraryFile } from '../src/component-library-loader.js';
import {
  deriveBatteryRequirementsFromLoadDemand,
  evaluateLoadDemandScenario,
} from '../src/index.js';

describe('load demand aggregation', () => {
  it('aggregates DC continuous power and current', () => {
    const result = evaluateLoadDemandScenario({
      designVoltageV: 24,
      loads: [
        { id: 'fridge', supplyType: 'dc', powerW: 60, active: true },
        { id: 'lights', supplyType: 'dc', powerW: 40, active: true },
      ],
    });

    expect(result.severity).toBe('PASS');
    expect(result.totalLoadSidePowerW).toBe(100);
    expect(result.totalBatterySidePowerW).toBe(100);
    expect(result.continuousBatteryCurrentA).toBeCloseTo(4.1666666667, 10);
  });

  it('excludes inactive loads and computes explicit load and battery energy', () => {
    const scenario = evaluateLoadDemandScenario({
      designVoltageV: 24,
      loads: [
        { id: 'fridge', supplyType: 'dc', powerW: 60, active: true },
        { id: 'unused', supplyType: 'dc', powerW: 500, active: false },
      ],
    });
    expect(scenario.totalLoadSidePowerW).toBe(60);

    const dcEnergy = evaluateLoadDemandScenario({
      designVoltageV: 24,
      loads: [{ id: 'heater', supplyType: 'dc', powerW: 100, runtimeHours: 2, active: true }],
    });
    expect(dcEnergy.totalLoadEnergyWh).toBe(200);
    expect(dcEnergy.totalBatteryEnergyWh).toBe(200);

    const acLoss = evaluateLoadDemandScenario({
      batteryVoltageV: 24,
      loads: [
        { id: 'cooktop', supplyType: 'ac', powerW: 1200, runtimeHours: 1, inverterEfficiency: 0.9 },
      ],
    });
    expect(acLoss.totalLoadEnergyWh).toBe(1200);
    expect(acLoss.totalBatteryEnergyWh).toBeCloseTo(1333.3333333333, 8);

    const dcLoss = evaluateLoadDemandScenario({
      batteryVoltageV: 24,
      loads: [
        {
          id: 'converter-load',
          supplyType: 'dc',
          powerW: 100,
          runtimeHours: 2,
          dcDcEfficiency: 0.8,
        },
      ],
    });
    expect(dcLoss.totalLoadEnergyWh).toBe(200);
    expect(dcLoss.totalBatteryEnergyWh).toBe(250);
  });

  it('keeps missing runtime unresolved without discarding continuous values', () => {
    const result = evaluateLoadDemandScenario({
      batteryVoltageV: 24,
      loads: [{ id: 'pump', supplyType: 'dc', powerW: 100, active: true }],
    });

    expect(result.totalLoadSidePowerW).toBe(100);
    expect(result.continuousBatteryCurrentA).toBeCloseTo(4.1666666667, 8);
    expect(result.totalLoadEnergyWh).toBeUndefined();
    expect(result.totalBatteryEnergyWh).toBeUndefined();
    expect(result.unresolvedInputs).toEqual(
      expect.arrayContaining([expect.stringContaining('runtime')]),
    );

    const requirements = deriveBatteryRequirementsFromLoadDemand(result);
    expect(requirements.continuousDischargeCurrentA).toBeCloseTo(4.1666666667, 8);
    expect(requirements.nominalEnergyWh).toBeUndefined();
  });

  it('treats conflicting voltage bases as unresolved and enforces a single battery-side voltage semantic', () => {
    const result = evaluateLoadDemandScenario({
      designVoltageV: 24,
      batteryVoltageV: 48,
      loads: [{ id: 'device', supplyType: 'dc', powerW: 100, active: true }],
    });

    expect(result.continuousBatteryCurrentA).toBeUndefined();
    expect(result.unresolvedInputs).toEqual(
      expect.arrayContaining([expect.stringContaining('batteryVoltageV and designVoltageV')]),
    );
  });

  it('supports explicit surge aggregation policy and missing duration behavior', () => {
    const surge = evaluateLoadDemandScenario({
      batteryVoltageV: 24,
      loads: [
        { id: 'pump-a', supplyType: 'dc', powerW: 200, startupPowerW: 600, startupDurationS: 5 },
        { id: 'pump-b', supplyType: 'dc', powerW: 150, startupPowerW: 500, startupDurationS: 3 },
      ],
    });
    expect(surge.surgeRequirement).toBeUndefined();
    expect(surge.surgeContributions).toHaveLength(2);
    expect(surge.unresolvedInputs).toEqual(
      expect.arrayContaining([expect.stringContaining('multiple active surge loads')]),
    );

    const missingDuration = evaluateLoadDemandScenario({
      batteryVoltageV: 24,
      loads: [{ id: 'pump', supplyType: 'dc', powerW: 200, startupPowerW: 600, active: true }],
    });
    expect(missingDuration.severity).toBe('CONDITIONAL');
    expect(missingDuration.unresolvedInputs).toEqual(
      expect.arrayContaining([expect.stringContaining('startup duration')]),
    );
  });

  it('uses battery-side energy in the adapter and rejects redundant efficiency aliases', () => {
    const scenario = evaluateLoadDemandScenario({
      batteryVoltageV: 24,
      loads: [
        { id: 'ac-load', supplyType: 'ac', powerW: 1200, runtimeHours: 1, inverterEfficiency: 0.9 },
      ],
    });
    const requirements = deriveBatteryRequirementsFromLoadDemand(scenario);
    expect(requirements.nominalEnergyWh).toBeCloseTo(1333.3333333333, 8);

    const aliasInput = {
      batteryVoltageV: 24,
      loads: [
        { id: 'dc-load', supplyType: 'dc', powerW: 100, runtimeHours: 2, dcDcEfficiency: 0.8 },
      ],
    } as const;
    const aliasResult = evaluateLoadDemandScenario(aliasInput);
    expect(aliasResult.totalBatteryEnergyWh).toBe(250);
    expect(aliasResult.totalLoadEnergyWh).toBe(200);
  });

  it('passes a real Epoch battery-bank feasibility scenario through the full backend chain', async () => {
    const result = await loadComponentLibraryFile(
      path.resolve('data/components/epoch-batteries.b24100a-c.yaml'),
    );
    expect(result.ok).toBe(true);

    const component = result.value;
    const battery: BatteryEngineeringInput = {
      id: component.id,
      nominalVoltageV: component.electrical?.nominal_voltage_v as number,
      nominalCapacityAh: component.battery?.nominal_capacity_ah as number,
      nominalEnergyWh: component.battery?.nominal_energy_wh as number,
      continuousDischargeCurrentA: component.electrical?.continuous_discharge_current_a as number,
      peakDischargeCurrentA: component.electrical?.peak_discharge_current_a as number,
      peakDischargeDurationS: component.electrical?.peak_discharge_duration_s as number,
      allowedSeriesCount: component.battery?.allowed_series_count ?? undefined,
      allowedParallelCount: component.battery?.allowed_parallel_count ?? undefined,
    };

    const scenario = evaluateLoadDemandScenario({
      batteryVoltageV: 25.6,
      loads: [
        { id: 'fridge', supplyType: 'dc', powerW: 60, active: true },
        { id: 'lights', supplyType: 'dc', powerW: 40, active: true },
        {
          id: 'appliance',
          supplyType: 'ac',
          powerW: 3200,
          inverterEfficiency: 0.9,
          runtimeHours: 1,
        },
      ],
    });

    const requirements = deriveBatteryRequirementsFromLoadDemand(scenario);
    const bankEvaluation = evaluateBatteryBankConfiguration({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      requirements,
    });

    expect(requirements.nominalVoltageV).toBe(25.6);
    expect(requirements.continuousDischargeCurrentA).toBeCloseTo(142.7951388889, 8);
    expect(requirements.nominalEnergyWh).toBeCloseTo(3655.5555555556, 8);
    expect(bankEvaluation.requirementResults.nominalVoltage?.severity).toBe('PASS');
    expect(bankEvaluation.requirementResults.continuousDischarge?.severity).toBe('FAIL');
    expect(bankEvaluation.feasibleAlternatives).toEqual(
      expect.arrayContaining([expect.objectContaining({ seriesCount: 1, parallelCount: 2 })]),
    );
  });
});
