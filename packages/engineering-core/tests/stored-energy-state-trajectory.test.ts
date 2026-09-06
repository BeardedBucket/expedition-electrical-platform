import { describe, expect, it } from 'vitest';
import { evaluateStoredEnergyStateTrajectory } from '../src/index.js';

const charge = (requestedNetEnergyWh: number, intervalId?: string) => ({
  intervalId,
  requestedNetEnergyWh,
});

describe('stored energy state trajectory', () => {
  it('A. basic charge', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 2000,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(1000, 'charge')],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      completeTrajectory: true,
      endingStoredEnergyWh: 3000,
      totalStoredChargingEnergyWh: 1000,
      totalCurtailedEnergyWh: 0,
      totalUnmetEnergyWh: 0,
    });
  });

  it('B. charge saturation', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 4500,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(1000, 'saturating-charge')],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      completeTrajectory: true,
      endingStoredEnergyWh: 5000,
      totalStoredChargingEnergyWh: 500,
      totalCurtailedEnergyWh: 500,
      totalUnmetEnergyWh: 0,
    });
    expect(result.intervals[0]).toMatchObject({
      storedGainWh: 500,
      curtailedEnergyWh: 500,
      endingStoredEnergyWh: 5000,
    });
  });

  it('C. basic discharge', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 3000,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(-1000, 'discharge')],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      completeTrajectory: true,
      endingStoredEnergyWh: 2000,
      totalRequestedDischargeEnergyWh: 1000,
      totalDeliveredDischargeEnergyWh: 1000,
      totalUnmetEnergyWh: 0,
    });
  });

  it('D. lower-bound shortfall', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 1000,
      lowerStoredEnergyBoundWh: 500,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(-1000, 'shortfall')],
    });

    expect(result).toMatchObject({
      severity: 'FAIL',
      completeTrajectory: false,
      endingStoredEnergyWh: 500,
      totalRequestedDischargeEnergyWh: 1000,
      totalDeliveredDischargeEnergyWh: 500,
      totalUnmetEnergyWh: 500,
    });
    expect(result.intervals[0]).toMatchObject({
      deliveredFromStorageWh: 500,
      unmetEnergyWh: 500,
      endingStoredEnergyWh: 500,
    });
  });

  it('E. explicit nonzero lower bound is honored', () => {
    const invalid = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 400,
      lowerStoredEnergyBoundWh: 500,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(100, 'lower-bound')],
    });

    expect(invalid.severity).toBe('FAIL');
    expect(invalid.issues.some((issue) => issue.includes('startingStoredEnergyWh'))).toBe(true);
  });

  it('F. mixed trajectory without residuals', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 3000,
      lowerStoredEnergyBoundWh: 500,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(-1000), charge(1500), charge(-500)],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      completeTrajectory: true,
      endingStoredEnergyWh: 3000,
      totalUnmetEnergyWh: 0,
      totalCurtailedEnergyWh: 0,
    });
    expect(result.intervals.map((entry) => entry.endingStoredEnergyWh)).toEqual([2000, 3500, 3000]);
  });

  it('G. upper curtailment is not available later', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 4500,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(1500, 'first'), charge(-1000, 'second')],
    });

    expect(result.intervals[0]).toMatchObject({
      endingStoredEnergyWh: 5000,
      storedGainWh: 500,
      curtailedEnergyWh: 1000,
    });
    expect(result.intervals[1]).toMatchObject({
      startingStoredEnergyWh: 5000,
      endingStoredEnergyWh: 4000,
      deliveredFromStorageWh: 1000,
    });
    expect(result.endingStoredEnergyWh).toBe(4000);
  });

  it('H. lower shortfall followed by later charge remains fail', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 500,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(-1000, 'first'), charge(1500, 'second')],
    });

    expect(result).toMatchObject({
      severity: 'FAIL',
      completeTrajectory: false,
      endingStoredEnergyWh: 1500,
      totalUnmetEnergyWh: 500,
      totalRequestedDischargeEnergyWh: 1000,
    });
    expect(result.intervals[0]).toMatchObject({
      deliveredFromStorageWh: 500,
      unmetEnergyWh: 500,
      endingStoredEnergyWh: 0,
    });
    expect(result.intervals[1]).toMatchObject({
      startingStoredEnergyWh: 0,
      endingStoredEnergyWh: 1500,
    });
  });

  it('I. zero energy request is a no-op', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 1200,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(0, 'zero')],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      completeTrajectory: true,
      endingStoredEnergyWh: 1200,
      totalStoredChargingEnergyWh: 0,
      totalCurtailedEnergyWh: 0,
      totalUnmetEnergyWh: 0,
    });
  });

  it('J. empty trajectory', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 2500,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      completeTrajectory: true,
      endingStoredEnergyWh: 2500,
      minimumStoredEnergyWh: 2500,
      maximumStoredEnergyWh: 2500,
      totalRequestedChargingEnergyWh: 0,
      totalRequestedDischargeEnergyWh: 0,
      totalCurtailedEnergyWh: 0,
      totalUnmetEnergyWh: 0,
    });
  });

  it('K. warning trajectory remains warning if otherwise feasible', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 2000,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [
        {
          intervalId: 'warning',
          requestedNetEnergyWh: 250,
          issues: ['warning: upstream guidance'],
        },
      ],
    });

    expect(result).toMatchObject({
      severity: 'WARNING',
      completeTrajectory: true,
      endingStoredEnergyWh: 2250,
      totalUnmetEnergyWh: 0,
    });
  });

  it('L. unresolved middle interval makes trajectory conditional', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 3000,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [
        { intervalId: 'first', requestedNetEnergyWh: -1000 },
        { intervalId: 'middle', energyStatus: 'unresolved' },
        { intervalId: 'third', requestedNetEnergyWh: 500 },
      ],
    });

    expect(result.severity).toBe('CONDITIONAL');
    expect(result.endingStoredEnergyWh).toBeUndefined();
    expect(result.minimumStoredEnergyWh).toBeUndefined();
    expect(result.maximumStoredEnergyWh).toBeUndefined();
    expect(result.intervals[0]).toMatchObject({
      endingStoredEnergyWh: 2000,
      energyStatus: 'resolved',
    });
    expect(result.intervals[1]).toMatchObject({ energyStatus: 'unresolved' });
    expect(result.intervals[2]).toMatchObject({
      requestedNetEnergyWh: 500,
      startingStoredEnergyWh: undefined,
      endingStoredEnergyWh: undefined,
    });
  });

  it('M. failed middle interval fails without fabricating state transition', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 3000,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [
        { intervalId: 'first', requestedNetEnergyWh: -1000 },
        { intervalId: 'failed-middle', energyStatus: 'failed' },
        { intervalId: 'third', requestedNetEnergyWh: 500 },
      ],
    });

    expect(result.severity).toBe('FAIL');
    expect(result.intervals[1].energyStatus).toBe('failed');
    expect(result.intervals[1].startingStoredEnergyWh).toBeUndefined();
    expect(result.intervals[2]).toMatchObject({
      requestedNetEnergyWh: 500,
      startingStoredEnergyWh: undefined,
      endingStoredEnergyWh: undefined,
    });
    expect(result.endingStoredEnergyWh).toBeUndefined();
  });

  it('N. invalid bounds and state are deterministically fail', () => {
    for (const lower of [NaN, Number.POSITIVE_INFINITY, -1]) {
      const result = evaluateStoredEnergyStateTrajectory({
        startingStoredEnergyWh: 1000,
        lowerStoredEnergyBoundWh: lower,
        upperStoredEnergyBoundWh: 5000,
        intervals: [{ requestedNetEnergyWh: 250 }],
      });
      expect(result.severity).toBe('FAIL');
    }

    const upperSmall = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 1000,
      lowerStoredEnergyBoundWh: 1500,
      upperStoredEnergyBoundWh: 1000,
      intervals: [{ requestedNetEnergyWh: 250 }],
    });
    expect(upperSmall.severity).toBe('FAIL');

    const belowLower = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 400,
      lowerStoredEnergyBoundWh: 500,
      upperStoredEnergyBoundWh: 5000,
      intervals: [{ requestedNetEnergyWh: 100 }],
    });
    expect(belowLower.severity).toBe('FAIL');

    const aboveUpper = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 6000,
      lowerStoredEnergyBoundWh: 500,
      upperStoredEnergyBoundWh: 5000,
      intervals: [{ requestedNetEnergyWh: -100 }],
    });
    expect(aboveUpper.severity).toBe('FAIL');
  });

  it('O. zero-width bounds accept exact state and treat requests as residuals', () => {
    const zeroWidth = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 500,
      lowerStoredEnergyBoundWh: 500,
      upperStoredEnergyBoundWh: 500,
      intervals: [{ requestedNetEnergyWh: 1000, intervalId: 'charge' }],
    });
    expect(zeroWidth).toMatchObject({
      severity: 'PASS',
      endingStoredEnergyWh: 500,
      totalStoredChargingEnergyWh: 0,
      totalCurtailedEnergyWh: 1000,
    });

    const discharge = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 500,
      lowerStoredEnergyBoundWh: 500,
      upperStoredEnergyBoundWh: 500,
      intervals: [{ requestedNetEnergyWh: -1000, intervalId: 'discharge' }],
    });
    expect(discharge).toMatchObject({
      severity: 'FAIL',
      endingStoredEnergyWh: 500,
      totalDeliveredDischargeEnergyWh: 0,
      totalUnmetEnergyWh: 1000,
    });

    const idle = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 500,
      lowerStoredEnergyBoundWh: 500,
      upperStoredEnergyBoundWh: 500,
      intervals: [{ requestedNetEnergyWh: 0, intervalId: 'idle' }],
    });
    expect(idle).toMatchObject({
      severity: 'PASS',
      endingStoredEnergyWh: 500,
      totalUnmetEnergyWh: 0,
      totalCurtailedEnergyWh: 0,
    });
  });

  it('models shore-supported recovery and neutral upper-bound curtailment', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 3500,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [
        charge(-1500, 'travel'),
        charge(2500, 'shore-recharge'),
        charge(1000, 'shore-support'),
      ],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      endingStoredEnergyWh: 5000,
      totalStoredChargingEnergyWh: 3000,
      totalCurtailedEnergyWh: 500,
      totalUnmetEnergyWh: 0,
    });
    expect(result.intervals.map((entry) => entry.endingStoredEnergyWh)).toEqual([2000, 4500, 5000]);
  });

  it('models irregular solar recovery without fixed-period assumptions', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 3000,
      lowerStoredEnergyBoundWh: 500,
      upperStoredEnergyBoundWh: 5000,
      intervals: [
        charge(200, 'weak-recovery'),
        charge(-900, 'continued-depletion'),
        charge(2100, 'strong-recovery'),
      ],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      endingStoredEnergyWh: 4400,
      totalCurtailedEnergyWh: 0,
      totalUnmetEnergyWh: 0,
    });
    expect(result.intervals.map((entry) => entry.endingStoredEnergyWh)).toEqual([3200, 2300, 4400]);
  });

  it('conserves requested and state-changing energy at interval and global boundaries', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 4500,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(1500, 'charge'), charge(-1000, 'discharge')],
    });

    for (const interval of result.intervals) {
      if (interval.energyStatus !== 'resolved') continue;
      expect(interval.requestedChargingEnergyWh ?? 0).toBeCloseTo(
        (interval.storedGainWh ?? 0) + (interval.curtailedEnergyWh ?? 0),
        9,
      );
      expect(interval.requestedDischargeEnergyWh ?? 0).toBeCloseTo(
        (interval.deliveredFromStorageWh ?? 0) + (interval.unmetEnergyWh ?? 0),
        9,
      );
      expect(interval.endingStoredEnergyWh).toBeCloseTo(
        (interval.startingStoredEnergyWh ?? 0) +
          (interval.storedGainWh ?? 0) -
          (interval.deliveredFromStorageWh ?? 0),
        9,
      );
    }

    expect(result.totalStoredChargingEnergyWh).toBeCloseTo(
      result.intervals.reduce((sum, interval) => sum + (interval.storedGainWh ?? 0), 0),
      9,
    );
    expect(result.totalCurtailedEnergyWh).toBeCloseTo(
      result.intervals.reduce((sum, interval) => sum + (interval.curtailedEnergyWh ?? 0), 0),
      9,
    );
    expect(result.totalDeliveredDischargeEnergyWh).toBeCloseTo(
      result.intervals.reduce((sum, interval) => sum + (interval.deliveredFromStorageWh ?? 0), 0),
      9,
    );
    expect(result.totalUnmetEnergyWh).toBeCloseTo(
      result.intervals.reduce((sum, interval) => sum + (interval.unmetEnergyWh ?? 0), 0),
      9,
    );
    expect(result.endingStoredEnergyWh).toBeCloseTo(
      (result.startingStoredEnergyWh ?? 0) +
        (result.totalStoredChargingEnergyWh ?? 0) -
        (result.totalDeliveredDischargeEnergyWh ?? 0),
      9,
    );
  });

  it('does not use Phase 3D unconstrained net energy as a bounded final state', () => {
    const result = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 4500,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [charge(1500, 'surplus'), charge(-1000, 'deficit')],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      endingStoredEnergyWh: 4000,
      totalStoredChargingEnergyWh: 500,
      totalCurtailedEnergyWh: 1000,
      totalDeliveredDischargeEnergyWh: 1000,
    });
  });
});
