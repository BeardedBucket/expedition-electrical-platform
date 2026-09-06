import { describe, expect, it } from 'vitest';
import { evaluateUsageProfileEnergy, type OperatingPowerBalanceResult } from '../src/index.js';
import path from 'node:path';
import {
  evaluateBatteryChargeAcceptance,
  evaluateChargingSourceScenario,
  evaluateLoadDemandScenario,
  evaluateOperatingPowerBalance,
  type BatteryEngineeringInput,
} from '../src/index.js';
import { loadComponentLibraryFile } from '../src/component-library-loader.js';

const balance = (
  operatingCaseId: string,
  netBatteryPowerW: number | undefined,
  severity: OperatingPowerBalanceResult['severity'] = 'PASS',
  issues: readonly string[] = [],
): OperatingPowerBalanceResult => ({
  operatingCaseId,
  selectedTopology: { seriesCount: 1, parallelCount: 1 },
  severity,
  code: 'test.balance',
  message: 'test balance',
  netBatteryPowerW,
  chargingSurplusW: netBatteryPowerW === undefined ? undefined : Math.max(netBatteryPowerW, 0),
  dischargeDeficitW: netBatteryPowerW === undefined ? undefined : Math.max(-netBatteryPowerW, 0),
  unresolvedFacts: netBatteryPowerW === undefined ? ['net battery power unresolved'] : [],
  issues,
  provenance: {
    demandSeverity: severity,
    chargeAcceptanceSeverity: severity,
    sourceAvailableCapability: {
      totalResolved: netBatteryPowerW !== undefined,
      sourceIds: ['test-source'],
    },
    demandBatteryPowerW: netBatteryPowerW === undefined ? undefined : 0,
    acceptedChargingPowerW: netBatteryPowerW,
  },
});

it('derives negative discharge and balanced interval energy explicitly', () => {
  const discharge = evaluateUsageProfileEnergy({
    periodHours: 3,
    entries: [
      {
        usageId: 'discharge',
        operatingCase: balance('discharge-case', -400),
        activeDurationHours: 3,
      },
    ],
  });
  expect(discharge.entries[0]).toMatchObject({
    netBatteryEnergyWh: -1200,
    chargingEnergyWh: 0,
    dischargeEnergyWh: 1200,
  });

  const balanced = evaluateUsageProfileEnergy({
    periodHours: 5,
    entries: [
      { usageId: 'balanced', operatingCase: balance('balanced-case', 0), activeDurationHours: 5 },
    ],
  });
  expect(balanced).toMatchObject({
    severity: 'PASS',
    knownNetBatteryEnergyWh: 0,
    totalResolvedChargingEnergyWh: 0,
    totalResolvedDischargeEnergyWh: 0,
    profileNetBatteryEnergyWh: 0,
  });
});

it('exposes complete temporal coverage separately from engineering resolution', () => {
  const result = evaluateUsageProfileEnergy({
    periodHours: 24,
    entries: [
      {
        usageId: 'conditional',
        operatingCase: balance('conditional-case', undefined, 'CONDITIONAL'),
        activeDurationHours: 24,
      },
    ],
  });

  expect(result).toMatchObject({
    severity: 'CONDITIONAL',
    modeledDurationHours: 24,
    unmodeledDurationHours: 0,
    temporalCoverage: 'complete',
  });
  expect(result.profileNetBatteryEnergyWh).toBeUndefined();
});

describe('usage profile energy', () => {
  it('derives directional energy from a positive resolved rate', () => {
    const result = evaluateUsageProfileEnergy({
      profileId: 'charging',
      periodHours: 2,
      entries: [
        { usageId: 'charge', operatingCase: balance('charge-case', 500), activeDurationHours: 2 },
      ],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      modeledDurationHours: 2,
      unmodeledDurationHours: 0,
      temporalCoverage: 'complete',
      totalResolvedChargingEnergyWh: 1000,
      totalResolvedDischargeEnergyWh: 0,
      knownNetBatteryEnergyWh: 1000,
      profileNetBatteryEnergyWh: 1000,
    });
    expect(result.entries[0]).toMatchObject({
      netBatteryEnergyWh: 1000,
      chargingEnergyWh: 1000,
      dischargeEnergyWh: 0,
      provenance: { sourceNetBatteryPowerW: 500, activeDurationHours: 2 },
    });
  });

  it('sums explicitly non-overlapping intervals without summing alternative power cases', () => {
    const result = evaluateUsageProfileEnergy({
      periodHours: 5,
      entries: [
        { usageId: 'charge', operatingCase: balance('charge-case', 500), activeDurationHours: 2 },
        { usageId: 'load', operatingCase: balance('load-case', -400), activeDurationHours: 3 },
      ],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      totalResolvedChargingEnergyWh: 1000,
      totalResolvedDischargeEnergyWh: 1200,
      knownNetBatteryEnergyWh: -200,
      profileNetBatteryEnergyWh: -200,
    });
  });

  it('retains a known subtotal and marks unmodeled time conditional', () => {
    const result = evaluateUsageProfileEnergy({
      periodHours: 24,
      entries: [
        { usageId: 'known', operatingCase: balance('known-case', -100), activeDurationHours: 18 },
      ],
    });

    expect(result).toMatchObject({
      severity: 'CONDITIONAL',
      modeledDurationHours: 18,
      unmodeledDurationHours: 6,
      temporalCoverage: 'partial',
      knownNetBatteryEnergyWh: -1800,
    });
    expect(result.profileNetBatteryEnergyWh).toBeUndefined();
  });

  it('requires explicit duration for a known idle contribution', () => {
    const fullPeriod = evaluateUsageProfileEnergy({
      periodHours: 24,
      entries: [
        { usageId: 'idle-24h', operatingCase: balance('idle-case', -10), activeDurationHours: 24 },
      ],
    });
    const partialPeriod = evaluateUsageProfileEnergy({
      periodHours: 24,
      entries: [
        { usageId: 'idle-4h', operatingCase: balance('idle-case', -10), activeDurationHours: 4 },
      ],
    });

    expect(fullPeriod).toMatchObject({
      profileNetBatteryEnergyWh: -240,
      totalResolvedDischargeEnergyWh: 240,
    });
    expect(partialPeriod).toMatchObject({
      knownNetBatteryEnergyWh: -40,
      totalResolvedDischargeEnergyWh: 40,
      unmodeledDurationHours: 20,
    });
  });

  it('supports materially different complete lifestyle profiles through duration inputs only', () => {
    const cases = {
      parked: balance('parked', -200),
      driving: balance('driving', 600),
      cooking: balance('cooking', -2200),
      shore: balance('shore', 300),
    };
    const evaluateProfile = (
      profileId: string,
      durations: { parked: number; driving: number; cooking: number; shore: number },
    ) =>
      evaluateUsageProfileEnergy({
        profileId,
        periodHours: 24,
        entries: (Object.keys(durations) as Array<keyof typeof durations>).map((key) => ({
          usageId: key,
          operatingCase: cases[key],
          activeDurationHours: durations[key],
        })),
      });

    const profileA = evaluateProfile('propane-heavy', {
      parked: 12.8,
      driving: 4,
      cooking: 0.2,
      shore: 7,
    });
    const profileB = evaluateProfile('electric-cooking', {
      parked: 13.5,
      driving: 0.5,
      cooking: 1,
      shore: 9,
    });
    const profileC = evaluateProfile('shore-heavy', {
      parked: 2,
      driving: 1,
      cooking: 1,
      shore: 20,
    });

    expect(profileA).toMatchObject({
      modeledDurationHours: 24,
      totalResolvedChargingEnergyWh: 4500,
      totalResolvedDischargeEnergyWh: 3000,
      profileNetBatteryEnergyWh: 1500,
    });
    expect(profileB).toMatchObject({
      modeledDurationHours: 24,
      totalResolvedChargingEnergyWh: 3000,
      totalResolvedDischargeEnergyWh: 4900,
      profileNetBatteryEnergyWh: -1900,
    });
    expect(profileC).toMatchObject({
      modeledDurationHours: 24,
      totalResolvedChargingEnergyWh: 6600,
      totalResolvedDischargeEnergyWh: 2600,
      profileNetBatteryEnergyWh: 4000,
    });
  });

  it('integrates a camper-style profile without summing instantaneous alternatives', () => {
    const result = evaluateUsageProfileEnergy({
      profileId: 'camper-regression',
      periodHours: 24,
      entries: [
        {
          usageId: 'driving-daylight',
          operatingCase: balance('driving-daylight', 620),
          activeDurationHours: 3,
        },
        {
          usageId: 'parked-daylight',
          operatingCase: balance('parked-daylight', 100),
          activeDurationHours: 5,
        },
        { usageId: 'cooking', operatingCase: balance('cooking', -2200), activeDurationHours: 0.5 },
        {
          usageId: 'parked-night',
          operatingCase: balance('parked-night', -200),
          activeDurationHours: 8,
        },
        { usageId: 'other', operatingCase: balance('other', -50), activeDurationHours: 7.5 },
      ],
    });

    expect(result).toMatchObject({
      modeledDurationHours: 24,
      totalResolvedChargingEnergyWh: 2360,
      totalResolvedDischargeEnergyWh: 3075,
      knownNetBatteryEnergyWh: -715,
      profileNetBatteryEnergyWh: -715,
    });
  });

  it('executes the complete evaluator chain through temporal energy', () => {
    const demand = evaluateLoadDemandScenario({
      scenarioId: 'chain-load',
      batteryVoltageV: 24,
      loads: [{ id: 'load', supplyType: 'dc', powerW: 100, runtimeHours: 1, active: true }],
    });
    const charging = evaluateChargingSourceScenario({
      scenarioId: 'chain-source',
      batteryVoltageV: 24,
      sources: [
        {
          id: 'source',
          sourceType: 'other',
          active: true,
          availability: 'available',
          installedCurrentA: 30,
        },
      ],
    });
    const battery: BatteryEngineeringInput = {
      id: 'chain-battery',
      nominalVoltageV: 24,
      nominalCapacityAh: 100,
      allowedSeriesCount: { min: 1, max: 1 },
      allowedParallelCount: { min: 1, max: 1 },
      chargeCurrent: { maximumContinuousA: 30 },
    };
    const acceptance = evaluateBatteryChargeAcceptance({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: charging,
    });
    const operatingCase = evaluateOperatingPowerBalance({
      operatingCaseId: 'chain-case',
      demandScenario: demand,
      chargeAcceptance: acceptance,
    });
    const result = evaluateUsageProfileEnergy({
      profileId: 'chain-profile',
      periodHours: 2,
      entries: [{ usageId: 'chain-usage', operatingCase, activeDurationHours: 2 }],
    });

    expect(operatingCase.netBatteryPowerW).toBe(620);
    expect(result).toMatchObject({
      severity: 'PASS',
      profileNetBatteryEnergyWh: 1240,
    });
  });

  it('integrates canonical Epoch 668 W and preserves conditional 80 A energy', async () => {
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
      scenarioId: 'epoch-temporal-load',
      batteryVoltageV: 25.6,
      loads: [{ id: 'demand', supplyType: 'dc', powerW: 100, runtimeHours: 1 }],
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
    const evaluateEpoch = (currentA: number, operatingCaseId: string) => {
      const acceptance = evaluateBatteryChargeAcceptance({
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
        chargingScenario: sourceScenario(currentA, `${operatingCaseId}-source`),
      });
      return evaluateUsageProfileEnergy({
        periodHours: 2,
        entries: [
          {
            usageId: operatingCaseId,
            operatingCase: evaluateOperatingPowerBalance({
              operatingCaseId,
              demandScenario,
              chargeAcceptance: acceptance,
            }),
            activeDurationHours: 2,
          },
        ],
      });
    };

    const resolved = evaluateEpoch(30, 'epoch-30a');
    expect(resolved.entries[0]).toMatchObject({
      netBatteryPowerW: 668,
      netBatteryEnergyWh: 1336,
      chargingEnergyWh: 1336,
      dischargeEnergyWh: 0,
    });
    expect(resolved.profileNetBatteryEnergyWh).toBe(1336);

    const conditional = evaluateEpoch(80, 'epoch-80a');
    expect(conditional.severity).toBe('CONDITIONAL');
    expect(conditional.entries[0].netBatteryEnergyWh).toBeUndefined();
    expect(conditional.profileNetBatteryEnergyWh).toBeUndefined();
  });

  it('keeps unresolved case energy unresolved while retaining other entries', () => {
    const result = evaluateUsageProfileEnergy({
      periodHours: 3,
      entries: [
        { usageId: 'known', operatingCase: balance('known-case', 100), activeDurationHours: 1 },
        {
          usageId: 'unknown',
          operatingCase: balance('unknown-case', undefined, 'CONDITIONAL'),
          activeDurationHours: 2,
        },
      ],
    });

    expect(result).toMatchObject({
      severity: 'CONDITIONAL',
      knownNetBatteryEnergyWh: 100,
      totalResolvedChargingEnergyWh: 100,
      unresolvedUsageIds: ['unknown'],
    });
    expect(result.entries[1]).toMatchObject({
      activeDurationHours: 2,
      energyStatus: 'unresolved',
    });
    expect(result.profileNetBatteryEnergyWh).toBeUndefined();
  });

  it('fails invalid durations, over-allocation, duplicate usage IDs, and failed cases', () => {
    expect(
      evaluateUsageProfileEnergy({
        periodHours: 24,
        entries: [
          { usageId: 'bad', operatingCase: balance('bad-case', 1), activeDurationHours: -1 },
        ],
      }).severity,
    ).toBe('FAIL');
    expect(
      evaluateUsageProfileEnergy({
        periodHours: 24,
        entries: [
          { usageId: 'a', operatingCase: balance('a-case', 1), activeDurationHours: 12 },
          { usageId: 'b', operatingCase: balance('b-case', 1), activeDurationHours: 13 },
        ],
      }).severity,
    ).toBe('FAIL');
    expect(
      evaluateUsageProfileEnergy({
        periodHours: 1,
        entries: [
          { usageId: 'same', operatingCase: balance('a-case', 1), activeDurationHours: 0.5 },
          { usageId: 'same', operatingCase: balance('b-case', 1), activeDurationHours: 0.5 },
        ],
      }).severity,
    ).toBe('FAIL');
    expect(
      evaluateUsageProfileEnergy({
        periodHours: 1,
        entries: [
          {
            usageId: 'failed',
            operatingCase: balance('failed-case', 1, 'FAIL'),
            activeDurationHours: 1,
          },
        ],
      }).severity,
    ).toBe('FAIL');
    for (const periodHours of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        evaluateUsageProfileEnergy({
          periodHours,
          entries: [],
        }).severity,
      ).toBe('FAIL');
    }
  });

  it('preserves warning cases when their energy is resolved', () => {
    const result = evaluateUsageProfileEnergy({
      periodHours: 1,
      entries: [
        {
          usageId: 'warning',
          operatingCase: balance('warning-case', 250, 'WARNING', ['guidance warning']),
          activeDurationHours: 1,
        },
      ],
    });

    expect(result).toMatchObject({
      severity: 'WARNING',
      profileNetBatteryEnergyWh: 250,
    });
    expect(result.issues).toContain('warning-case: guidance warning');
  });

  it('allows zero-duration entries without creating energy', () => {
    const result = evaluateUsageProfileEnergy({
      periodHours: 1,
      entries: [
        { usageId: 'zero', operatingCase: balance('zero-case', 500), activeDurationHours: 0 },
      ],
    });

    expect(result).toMatchObject({
      severity: 'CONDITIONAL',
      knownNetBatteryEnergyWh: 0,
      modeledDurationHours: 0,
    });
  });

  it('does not create an automatic idle baseline or double count upstream idle power', () => {
    const result = evaluateUsageProfileEnergy({
      periodHours: 24,
      entries: [
        {
          usageId: 'energized',
          operatingCase: balance('idle-inclusive', -10),
          activeDurationHours: 4,
        },
      ],
    });

    expect(result.knownNetBatteryEnergyWh).toBe(-40);
    expect(result.completeProfileNetBatteryEnergyWh).toBeUndefined();
  });
});
