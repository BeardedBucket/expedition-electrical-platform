import { describe, expect, it } from 'vitest';
import {
  evaluateOrderedEnergyTrajectory,
  evaluateUsageProfileEnergy,
  type OperatingPowerBalanceResult,
} from '../src/index.js';

const balance = (
  operatingCaseId: string,
  netBatteryPowerW: number | undefined,
  severity: OperatingPowerBalanceResult['severity'] = 'PASS',
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
  issues: [],
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

const interval = (
  operatingCaseId: string,
  netBatteryPowerW: number | undefined,
  durationHours: number,
  intervalId?: string,
  severity: OperatingPowerBalanceResult['severity'] = 'PASS',
) => ({
  intervalId,
  operatingCase: balance(operatingCaseId, netBatteryPowerW, severity),
  durationHours,
});

describe('ordered energy trajectory', () => {
  it('integrates pure discharge, charge, balanced, and mixed sequences', () => {
    expect(
      evaluateOrderedEnergyTrajectory({
        intervals: [interval('discharge', -500, 2)],
      }),
    ).toMatchObject({
      severity: 'PASS',
      status: 'PASS',
      endingNetEnergyWh: -1000,
      minimumCumulativeEnergyWh: -1000,
      maximumCumulativeEnergyWh: 0,
      maximumCumulativeDeficitWh: 1000,
      maximumCumulativeSurplusWh: 0,
    });
    expect(
      evaluateOrderedEnergyTrajectory({
        intervals: [interval('charge', 500, 2)],
      }),
    ).toMatchObject({
      endingNetEnergyWh: 1000,
      minimumCumulativeEnergyWh: 0,
      maximumCumulativeEnergyWh: 1000,
      maximumCumulativeDeficitWh: 0,
      maximumCumulativeSurplusWh: 1000,
    });
    expect(
      evaluateOrderedEnergyTrajectory({
        intervals: [interval('balanced', 0, 4)],
      }),
    ).toMatchObject({
      endingNetEnergyWh: 0,
      minimumCumulativeEnergyWh: 0,
      maximumCumulativeEnergyWh: 0,
    });

    const mixed = evaluateOrderedEnergyTrajectory({
      intervals: [interval('one', -500, 2), interval('two', 300, 1), interval('three', -400, 2)],
    });
    expect(mixed.intervals.map((entry) => entry.netEnergyWh)).toEqual([-1000, 300, -800]);
    expect(mixed.intervals.map((entry) => entry.cumulativeEnergyWh)).toEqual([-1000, -700, -1500]);
    expect(mixed).toMatchObject({
      endingNetEnergyWh: -1500,
      minimumCumulativeEnergyWh: -1500,
      maximumCumulativeEnergyWh: 0,
      maximumCumulativeDeficitWh: 1500,
    });
  });

  it('preserves caller order and exposes order-sensitive extrema', () => {
    const first = evaluateOrderedEnergyTrajectory({
      intervals: [interval('a', -1500, 2), interval('b', 1250, 2)],
    });
    const second = evaluateOrderedEnergyTrajectory({
      intervals: [interval('b', 1250, 2), interval('a', -1500, 2)],
    });

    expect(first.endingNetEnergyWh).toBe(-500);
    expect(first.maximumCumulativeDeficitWh).toBe(3000);
    expect(first.maximumCumulativeSurplusWh).toBe(0);
    expect(second.endingNetEnergyWh).toBe(-500);
    expect(second.maximumCumulativeDeficitWh).toBe(500);
    expect(second.maximumCumulativeSurplusWh).toBe(2500);
  });

  it('matches Phase 3A directional totals while adding camper sequence ordering', () => {
    const entries = [
      interval('driving-daylight', 620, 3),
      interval('parked-daylight', 100, 5),
      interval('cooking', -2200, 0.5),
      interval('parked-night', -200, 8),
      interval('other', -50, 7.5),
    ];
    const trajectory = evaluateOrderedEnergyTrajectory({ intervals: entries });
    const profile = evaluateUsageProfileEnergy({
      periodHours: 24,
      entries: entries.map(({ operatingCase, durationHours }, index) => ({
        usageId: `usage-${index}`,
        operatingCase,
        activeDurationHours: durationHours,
      })),
    });
    const reordered = evaluateOrderedEnergyTrajectory({
      intervals: [entries[2], entries[0], entries[3], entries[1], entries[4]],
    });

    expect(trajectory).toMatchObject({
      endingNetEnergyWh: -715,
      maximumCumulativeDeficitWh: 715,
      maximumCumulativeSurplusWh: 2360,
    });
    expect(
      trajectory.intervals.reduce((sum, entry) => sum + (entry.chargingEnergyWh ?? 0), 0),
    ).toBe(profile.totalResolvedChargingEnergyWh);
    expect(
      trajectory.intervals.reduce((sum, entry) => sum + (entry.dischargeEnergyWh ?? 0), 0),
    ).toBe(profile.totalResolvedDischargeEnergyWh);
    expect(reordered.endingNetEnergyWh).toBe(trajectory.endingNetEnergyWh);
    expect(reordered.maximumCumulativeDeficitWh).not.toBe(trajectory.maximumCumulativeDeficitWh);
  });

  it('tracks both extrema, repeated operating cases, and zero-duration intervals', () => {
    const result = evaluateOrderedEnergyTrajectory({
      intervals: [
        interval('parked', -250, 2, 'parked-1'),
        interval('driving', 600, 1),
        interval('parked', -250, 0, 'parked-2'),
        interval('charge', 100, 2),
      ],
    });

    expect(result.intervals[2]).toMatchObject({
      operatingCaseId: 'parked',
      durationHours: 0,
      netEnergyWh: 0,
      cumulativeEnergyWh: 100,
    });
    expect(result).toMatchObject({
      endingNetEnergyWh: 300,
      minimumCumulativeEnergyWh: -500,
      maximumCumulativeEnergyWh: 300,
      maximumCumulativeDeficitWh: 500,
      maximumCumulativeSurplusWh: 300,
    });
  });

  it('accepts an empty sequence with a zero trajectory', () => {
    expect(evaluateOrderedEnergyTrajectory({ intervals: [] })).toMatchObject({
      severity: 'PASS',
      completeTrajectory: true,
      endingNetEnergyWh: 0,
      minimumCumulativeEnergyWh: 0,
      maximumCumulativeEnergyWh: 0,
      maximumCumulativeDeficitWh: 0,
      maximumCumulativeSurplusWh: 0,
    });
  });

  it('fails invalid durations and duplicate interval IDs', () => {
    for (const durationHours of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        evaluateOrderedEnergyTrajectory({
          intervals: [interval('bad-duration', 100, durationHours)],
        }).severity,
      ).toBe('FAIL');
    }
    expect(
      evaluateOrderedEnergyTrajectory({
        intervals: [interval('one', 100, 1, 'same-id'), interval('two', 100, 1, 'same-id')],
      }).severity,
    ).toBe('FAIL');
  });

  it('preserves warning severity for a numerically complete trajectory', () => {
    const result = evaluateOrderedEnergyTrajectory({
      intervals: [interval('warning', 250, 1, undefined, 'WARNING')],
    });
    expect(result).toMatchObject({
      severity: 'WARNING',
      completeTrajectory: true,
      endingNetEnergyWh: 250,
    });
  });

  it('does not fabricate absolute continuity across an unresolved middle interval', () => {
    const result = evaluateOrderedEnergyTrajectory({
      intervals: [
        interval('known-before', -250, 2),
        interval('unknown', undefined, 1, undefined, 'CONDITIONAL'),
        interval('known-after', 300, 1),
      ],
    });

    expect(result).toMatchObject({ severity: 'CONDITIONAL', completeTrajectory: false });
    expect(result.endingNetEnergyWh).toBeUndefined();
    expect(result.minimumCumulativeEnergyWh).toBeUndefined();
    expect(result.maximumCumulativeEnergyWh).toBeUndefined();
    expect(result.maximumCumulativeDeficitWh).toBeUndefined();
    expect(result.maximumCumulativeSurplusWh).toBeUndefined();
    expect(result.intervals[0]).toMatchObject({
      energyStatus: 'resolved',
      netEnergyWh: -500,
      cumulativeEnergyWh: -500,
    });
    expect(result.intervals[1].energyStatus).toBe('unresolved');
    expect(result.intervals[1].cumulativeEnergyWh).toBeUndefined();
    expect(result.intervals[2]).toMatchObject({ energyStatus: 'resolved', netEnergyWh: 300 });
    expect(result.intervals[2].cumulativeEnergyWh).toBeUndefined();
  });

  it('fails a failed middle interval without omitting it', () => {
    const result = evaluateOrderedEnergyTrajectory({
      intervals: [
        interval('known-before', -250, 2),
        interval('failed', 300, 1, undefined, 'FAIL'),
        interval('known-after', 300, 1),
      ],
    });
    expect(result.severity).toBe('FAIL');
    expect(result.completeTrajectory).toBe(false);
    expect(result.failedIntervalIds).toEqual([]);
    expect(result.intervals[1].energyStatus).toBe('failed');
    expect(result.intervals[1].netEnergyWh).toBeUndefined();
    expect(result.intervals[1].cumulativeEnergyWh).toBeUndefined();
  });
});
