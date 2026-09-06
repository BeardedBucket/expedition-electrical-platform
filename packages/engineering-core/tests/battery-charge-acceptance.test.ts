import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateBatteryChargeAcceptance,
  evaluateChargingSourceScenario,
  type BatteryEngineeringInput,
  type ChargingSourceScenarioResult,
} from '../src/index.js';
import { loadComponentLibraryFile } from '../src/component-library-loader.js';

const battery: BatteryEngineeringInput = {
  id: 'synthetic-battery',
  nominalVoltageV: 24,
  nominalCapacityAh: 100,
  allowedSeriesCount: { min: 1, max: 2 },
  allowedParallelCount: { min: 1, max: 4 },
  chargeCurrent: { recommendedA: 50 },
};

const scenario = (
  currentA: number | undefined,
  overrides: Partial<ChargingSourceScenarioResult> = {},
): ChargingSourceScenarioResult => ({
  scenarioId: 'synthetic-source',
  batteryVoltageV: 24,
  severity: 'PASS',
  code: 'charging_sources.pass',
  message: 'resolved',
  installedCapability: {
    currentA,
    powerW: currentA === undefined ? 0 : currentA * 24,
    totalResolved: true,
    sourceIds: ['source'],
  },
  activeConfiguredCapability: {
    currentA,
    powerW: currentA === undefined ? 0 : currentA * 24,
    totalResolved: true,
    sourceIds: ['source'],
  },
  availableCapability: {
    currentA,
    powerW: currentA === undefined ? 0 : currentA * 24,
    totalResolved: true,
    sourceIds: ['source'],
  },
  contributingSources: [],
  inactiveSources: [],
  unresolvedSources: [],
  invalidSources: [],
  issues: [],
  ...overrides,
});

describe('battery charge acceptance coordination', () => {
  it('scales recommended current by parallel count, not series count', () => {
    expect(
      evaluateBatteryChargeAcceptance({
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 2 },
        chargingScenario: scenario(30),
      }),
    ).toMatchObject({ bankRecommendedChargeA: 100 });
    expect(
      evaluateBatteryChargeAcceptance({
        battery,
        selectedTopology: { seriesCount: 2, parallelCount: 1 },
        chargingScenario: scenario(30),
      }),
    ).toMatchObject({ bankRecommendedChargeA: 50 });
  });

  it('accepts source current below a recommendation when no hard maximum is published', () => {
    expect(
      evaluateBatteryChargeAcceptance({
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
        chargingScenario: scenario(30),
      }),
    ).toMatchObject({
      severity: 'PASS',
      guidanceExceeded: false,
      usableContinuousChargeA: 30,
    });
  });

  it('leaves acceptance unresolved when recommendation and maximum are both absent', () => {
    const result = evaluateBatteryChargeAcceptance({
      battery: { ...battery, chargeCurrent: undefined },
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: scenario(30),
    });
    expect(result).toMatchObject({ severity: 'CONDITIONAL', usableContinuousChargeA: undefined });
  });

  it('makes recommendation exceedance conditional when maximum acceptance is unknown', () => {
    expect(
      evaluateBatteryChargeAcceptance({
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
        chargingScenario: scenario(80),
      }),
    ).toMatchObject({
      severity: 'CONDITIONAL',
      guidanceExceeded: true,
      hardAcceptanceResolved: false,
      usableContinuousChargeA: undefined,
    });
  });

  it('limits coordinated capability to known maximum continuous acceptance', () => {
    const result = evaluateBatteryChargeAcceptance({
      battery: { ...battery, chargeCurrent: { recommendedA: 50, maximumContinuousA: 60 } },
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: scenario(80),
    });
    expect(result).toMatchObject({
      severity: 'FAIL',
      usableContinuousChargeA: 60,
      limitingBasis: 'battery.maximum_continuous',
    });
  });

  it('does not use protection limit as normal maximum', () => {
    const result = evaluateBatteryChargeAcceptance({
      battery: {
        ...battery,
        chargeCurrent: { recommendedA: 50, maximumContinuousA: 60, protectionLimitA: 100 },
      },
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: scenario(80),
    });
    expect(result).toMatchObject({ bankProtectionLimitA: 100, usableContinuousChargeA: 60 });
  });

  it('propagates invalid topology and source scenario failures', () => {
    expect(
      evaluateBatteryChargeAcceptance({
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 5 },
        chargingScenario: scenario(30),
      }).severity,
    ).toBe('FAIL');
    expect(
      evaluateBatteryChargeAcceptance({
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
        chargingScenario: scenario(30, { severity: 'FAIL' }),
      }).severity,
    ).toBe('FAIL');
  });

  it('preserves known facts while propagating conditional source status', () => {
    const result = evaluateBatteryChargeAcceptance({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: scenario(40, {
        severity: 'CONDITIONAL',
        availableCapability: {
          currentA: 40,
          powerW: 960,
          totalResolved: false,
          sourceIds: ['source'],
        },
      }),
    });
    expect(result).toMatchObject({
      severity: 'CONDITIONAL',
      sourceAvailableA: 40,
      bankRecommendedChargeA: 50,
    });
  });

  it('requires a proven voltage basis when only source power is available', () => {
    const result = evaluateBatteryChargeAcceptance({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: scenario(undefined, {
        batteryVoltageV: undefined,
        availableCapability: { powerW: 1200, totalResolved: true, sourceIds: ['source'] },
      }),
    });
    expect(result.severity).toBe('CONDITIONAL');
  });

  it('rejects an explicitly incompatible voltage basis', () => {
    const result = evaluateBatteryChargeAcceptance({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: scenario(30, { batteryVoltageV: 48 }),
    });
    expect(result.severity).toBe('FAIL');
  });

  it('uses the evaluated source capability after a configured source limit', () => {
    const sourceResult = evaluateChargingSourceScenario({
      scenarioId: 'limited-source',
      batteryVoltageV: 24,
      sources: [
        {
          id: 'source',
          sourceType: 'shore_charger',
          active: true,
          availability: 'available',
          installedCurrentA: 80,
          configuredCurrentLimitA: 50,
        },
      ],
    });
    const result = evaluateBatteryChargeAcceptance({
      battery: { ...battery, chargeCurrent: { recommendedA: 50, maximumContinuousA: 60 } },
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: sourceResult,
    });
    expect(result).toMatchObject({
      sourceAvailableA: 50,
      usableContinuousChargeA: 50,
      severity: 'PASS',
    });
  });

  it('coordinates the canonical Epoch battery through the component loader', async () => {
    const loaded = await loadComponentLibraryFile(
      path.resolve('data/components/epoch-batteries.b24100a-c.yaml'),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const component = loaded.value;
    const epoch: BatteryEngineeringInput = {
      id: component.id,
      nominalVoltageV: component.electrical?.nominal_voltage_v as number,
      nominalCapacityAh: component.battery?.nominal_capacity_ah as number,
      nominalEnergyWh: component.battery?.nominal_energy_wh ?? undefined,
      allowedSeriesCount: component.battery?.allowed_series_count ?? undefined,
      allowedParallelCount: component.battery?.allowed_parallel_count ?? undefined,
      chargeCurrent: {
        recommendedA: component.battery?.charge_current?.recommended_a ?? undefined,
        maximumContinuousA: component.battery?.charge_current?.maximum_continuous_a ?? undefined,
        protectionLimitA: component.battery?.charge_current?.protection_limit_a ?? undefined,
      },
    };
    const source30 = scenario(30, { batteryVoltageV: 25.6, scenarioId: 'epoch-30a' });
    const source80 = scenario(80, { batteryVoltageV: 25.6, scenarioId: 'epoch-80a' });
    expect(
      evaluateBatteryChargeAcceptance({
        battery: epoch,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
        chargingScenario: source30,
      }),
    ).toMatchObject({ bankRecommendedChargeA: 50, severity: 'PASS' });
    expect(
      evaluateBatteryChargeAcceptance({
        battery: epoch,
        selectedTopology: { seriesCount: 1, parallelCount: 2 },
        chargingScenario: source80,
      }),
    ).toMatchObject({ bankRecommendedChargeA: 100, severity: 'PASS' });
    expect(
      evaluateBatteryChargeAcceptance({
        battery: epoch,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
        chargingScenario: source80,
      }),
    ).toMatchObject({
      severity: 'CONDITIONAL',
      guidanceExceeded: true,
      bankMaximumContinuousChargeA: undefined,
      usableContinuousChargeA: undefined,
    });
  });
});
