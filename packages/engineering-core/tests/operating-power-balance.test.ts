import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  evaluateBatteryChargeAcceptance,
  evaluateChargingSourceScenario,
  evaluateLoadDemandScenario,
  evaluateOperatingPowerBalance,
  type BatteryEngineeringInput,
  type BatteryChargeAcceptanceResult,
  type LoadDemandScenarioResult,
} from '../src/index.js';
import { loadComponentLibraryFile } from '../src/component-library-loader.js';

const demand = (
  powerW: number | undefined,
  overrides: Partial<LoadDemandScenarioResult> = {},
): LoadDemandScenarioResult => ({
  scenarioId: 'demand-case',
  severity: powerW === undefined ? 'CONDITIONAL' : 'PASS',
  code: 'load_demand.pass',
  message: 'resolved',
  totalLoadSidePowerW: powerW ?? 0,
  totalBatterySidePowerW: powerW,
  contributingLoads: [],
  unresolvedInputs: powerW === undefined ? ['battery-side power unresolved'] : [],
  assumptions: [],
  ...overrides,
});

const acceptance = (
  powerW: number | undefined,
  overrides: Partial<BatteryChargeAcceptanceResult> = {},
): BatteryChargeAcceptanceResult => ({
  severity: powerW === undefined ? 'CONDITIONAL' : 'PASS',
  code: 'battery.charge_acceptance.pass',
  message: 'resolved',
  batteryId: 'battery',
  sourceScenarioId: 'charging-case',
  selectedTopology: { seriesCount: 1, parallelCount: 1 },
  sourceAvailableCapability: {
    powerW: powerW ?? 0,
    currentA: powerW === undefined ? undefined : powerW / 24,
    totalResolved: powerW !== undefined,
    sourceIds: ['source'],
  },
  sourceAvailableA: powerW === undefined ? undefined : powerW / 24,
  sourceAvailablePowerW: powerW,
  usableContinuousChargeA: powerW === undefined ? undefined : powerW / 24,
  usableContinuousChargePowerW: powerW,
  selectedBankVoltageV: 24,
  hardAcceptanceResolved: powerW !== undefined,
  guidanceExceeded: false,
  limitingBasis: 'source',
  unresolvedFacts: powerW === undefined ? ['accepted charging power unresolved'] : [],
  issues: [],
  ...overrides,
});

const evaluate = (
  demandPowerW: number | undefined,
  acceptedPowerW: number | undefined,
  overrides: {
    demand?: Partial<LoadDemandScenarioResult>;
    acceptance?: Partial<BatteryChargeAcceptanceResult>;
    operatingCaseId?: string;
  } = {},
) =>
  evaluateOperatingPowerBalance({
    operatingCaseId: overrides.operatingCaseId,
    demandScenario: demand(demandPowerW, overrides.demand),
    chargeAcceptance: acceptance(acceptedPowerW, overrides.acceptance),
  });

describe('operating power balance', () => {
  it.each([
    [500, 800, 300, 300, 0, 'charging'],
    [900, 500, -400, 0, 400, 'discharging'],
    [500, 500, 0, 0, 0, 'balanced'],
    [500, 0, -500, 0, 500, 'discharging'],
    [0, 800, 800, 800, 0, 'charging'],
  ])(
    'balances demand %s W and accepted charging %s W',
    (demandW, acceptedW, netW, surplusW, deficitW, state) => {
      const result = evaluate(demandW, acceptedW);

      expect(result).toMatchObject({
        severity: 'PASS',
        demandBatteryPowerW: demandW,
        acceptedChargingPowerW: acceptedW,
        netBatteryPowerW: netW,
        chargingSurplusW: surplusW,
        dischargeDeficitW: deficitW,
        balanceState: state,
      });
    },
  );

  it('uses accepted coordinated supply rather than raw source capability', () => {
    const result = evaluate(1000, 1500, {
      acceptance: {
        sourceAvailablePowerW: 2000,
      },
    });

    expect(result.netBatteryPowerW).toBe(500);
    expect(result.acceptedChargingPowerW).toBe(1500);
  });

  it('retains resolved charging when demand is unresolved', () => {
    const result = evaluate(undefined, 500);

    expect(result).toMatchObject({
      severity: 'CONDITIONAL',
      acceptedChargingPowerW: 500,
      netBatteryPowerW: undefined,
      chargingSurplusW: undefined,
      dischargeDeficitW: undefined,
    });
  });

  it('retains resolved demand when accepted charging is unresolved', () => {
    const result = evaluate(600, undefined);

    expect(result).toMatchObject({
      severity: 'CONDITIONAL',
      demandBatteryPowerW: 600,
      acceptedChargingPowerW: undefined,
      netBatteryPowerW: undefined,
    });
  });

  it('propagates upstream failures and preserves warning provenance', () => {
    expect(evaluate(500, 800, { demand: { severity: 'FAIL' } }).severity).toBe('FAIL');
    expect(evaluate(500, 800, { acceptance: { severity: 'FAIL' } }).severity).toBe('FAIL');

    const warning = evaluate(500, 800, {
      acceptance: {
        severity: 'WARNING',
        code: 'battery.charge_acceptance.recommended_exceeded',
        issues: ['Source exceeds recommended charge target.'],
        guidanceExceeded: true,
      },
    });
    expect(warning.severity).toBe('WARNING');
    expect(warning.issues).toContain('Source exceeds recommended charge target.');
  });

  it('requires an explicit voltage when converting accepted current to power', () => {
    const result = evaluate(500, undefined, {
      acceptance: {
        usableContinuousChargeA: 50,
        usableContinuousChargePowerW: undefined,
        selectedBankVoltageV: undefined,
      },
    });

    expect(result.severity).toBe('CONDITIONAL');
    expect(result.acceptedChargingPowerW).toBeUndefined();
    expect(result.unresolvedFacts).toEqual(
      expect.arrayContaining([expect.stringContaining('voltage')]),
    );
  });

  it('does not expose energy netting or runtime calculations', () => {
    const result = evaluate(500, 800);

    expect(result).not.toHaveProperty('netEnergyWh');
    expect(result).not.toHaveProperty('runtimeHours');
  });

  it('evaluates an explicitly paired Epoch operating case and keeps 80 A conditional', async () => {
    const loaded = await loadComponentLibraryFile(
      path.resolve('data/components/epoch-batteries.b24100a-c.yaml'),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const component = loaded.value;
    const battery: BatteryEngineeringInput = {
      id: component.id,
      nominalVoltageV: component.electrical?.nominal_voltage_v as number,
      nominalCapacityAh: component.battery?.nominal_capacity_ah as number,
      allowedSeriesCount: component.battery?.allowed_series_count ?? undefined,
      allowedParallelCount: component.battery?.allowed_parallel_count ?? undefined,
      chargeCurrent: {
        recommendedA: component.battery?.charge_current?.recommended_a ?? undefined,
        maximumContinuousA: component.battery?.charge_current?.maximum_continuous_a ?? undefined,
      },
    };
    const demandScenario = evaluateLoadDemandScenario({
      scenarioId: 'driving-loads',
      batteryVoltageV: 25.6,
      loads: [
        { id: 'refrigerator', supplyType: 'dc', powerW: 60 },
        { id: 'lights', supplyType: 'dc', powerW: 40 },
      ],
    });
    const sourceScenario = (currentA: number, scenarioId: string) =>
      evaluateChargingSourceScenario({
        scenarioId,
        batteryVoltageV: 25.6,
        sources: [
          {
            id: 'alternator',
            sourceType: 'alternator_dc_dc',
            active: true,
            availability: 'available',
            installedCurrentA: currentA,
          },
        ],
      });
    const accepted30 = evaluateBatteryChargeAcceptance({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: sourceScenario(30, 'driving-charging'),
    });
    const balance30 = evaluateOperatingPowerBalance({
      operatingCaseId: 'driving-daylight',
      demandScenario,
      chargeAcceptance: accepted30,
    });

    expect(accepted30).toMatchObject({
      severity: 'PASS',
      usableContinuousChargeA: 30,
      usableContinuousChargePowerW: 768,
      selectedBankVoltageV: 25.6,
    });
    expect(balance30).toMatchObject({
      severity: 'PASS',
      demandBatteryPowerW: 100,
      acceptedChargingPowerW: 768,
      netBatteryPowerW: 668,
    });

    const accepted80 = evaluateBatteryChargeAcceptance({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: sourceScenario(80, 'driving-charging-80a'),
    });
    const balance80 = evaluateOperatingPowerBalance({
      operatingCaseId: 'driving-daylight-80a',
      demandScenario,
      chargeAcceptance: accepted80,
    });

    expect(accepted80.severity).toBe('CONDITIONAL');
    expect(accepted80.usableContinuousChargeA).toBeUndefined();
    expect(balance80.severity).toBe('CONDITIONAL');
    expect(balance80.acceptedChargingPowerW).toBeUndefined();
    expect(balance80.netBatteryPowerW).toBeUndefined();
  });

  it('evaluates camper operating cases only when each pair is explicitly selected', () => {
    const driving = evaluate(100, 1792, { operatingCaseId: 'driving-daylight' });
    const campground = evaluate(1300, 1280, { operatingCaseId: 'campground-cooking' });
    const parkedNight = evaluate(200, 0, { operatingCaseId: 'parked-night' });

    expect(driving.netBatteryPowerW).toBe(1692);
    expect(campground.netBatteryPowerW).toBe(-20);
    expect(parkedNight).toMatchObject({
      operatingCaseId: 'parked-night',
      acceptedChargingPowerW: 0,
      netBatteryPowerW: -200,
      dischargeDeficitW: 200,
    });
  });
});
