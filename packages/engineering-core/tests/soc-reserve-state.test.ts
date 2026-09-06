import { describe, expect, it } from 'vitest';
import {
  evaluateStoredEnergySocObservation,
  evaluateStoredEnergyStateTrajectory,
  observeStoredEnergyTrajectorySoc,
} from '../src/index.js';

const state = (storedEnergyWh: number, desiredReserveSocPercent?: number) =>
  evaluateStoredEnergySocObservation({
    storedEnergyWh,
    lowerStoredEnergyBoundWh: 0,
    upperStoredEnergyBoundWh: 10000,
    desiredReserveSocPercent,
  });

describe('stored-energy SOC and reserve observations', () => {
  it.each([
    [0, 0],
    [5000, 50],
    [10000, 100],
  ])('normalizes %d Wh to %d%% of the usable window', (stored, percent) => {
    expect(state(stored)).toMatchObject({
      severity: 'PASS',
      usableWindowSocPercent: percent,
      usableWindowSocFraction: percent / 100,
    });
  });

  it('normalizes across a nonzero lower-bound offset', () => {
    expect(
      evaluateStoredEnergySocObservation({
        storedEnergyWh: 6000,
        lowerStoredEnergyBoundWh: 2000,
        upperStoredEnergyBoundWh: 10000,
      }),
    ).toMatchObject({ severity: 'PASS', usableWindowSocPercent: 50 });
  });

  it.each([
    [3500, 'above-reserve', 15, 1500],
    [2000, 'at-reserve', 0, 0],
    [1800, 'below-reserve', -2, -200],
  ])('reports reserve state for %d Wh', (stored, reserveState, marginPercent, marginWh) => {
    expect(state(stored, 20)).toMatchObject({
      severity: 'PASS',
      desiredReserveSocPercent: 20,
      desiredReserveStoredEnergyWh: 2000,
      reserveMarginPercentagePoints: marginPercent,
      reserveMarginWh: marginWh,
      reserveState,
    });
  });

  it('omits reserve observations when no reserve policy is supplied', () => {
    expect(state(5000)).toMatchObject({
      severity: 'PASS',
      usableWindowSocPercent: 50,
      desiredReserveSocPercent: undefined,
      desiredReserveStoredEnergyWh: undefined,
      reserveMarginPercentagePoints: undefined,
      reserveState: undefined,
    });
  });

  it.each([0, 100])('accepts an explicit %d%% reserve', (reserve) => {
    expect(state(reserve === 0 ? 0 : 9999, reserve).severity).toBe('PASS');
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'fails invalid reserve %s',
    (reserve) => {
      expect(state(5000, reserve).severity).toBe('FAIL');
    },
  );

  it.each([
    ['stored below lower bound', -1, 0, 10000],
    ['stored above upper bound', 10001, 0, 10000],
    ['invalid lower bound', 5000, Number.NaN, 10000],
    ['invalid upper bound', 5000, 0, Number.POSITIVE_INFINITY],
    ['upper below lower', 5000, 10000, 0],
  ])('%s fails validation', (_label, stored, lower, upper) => {
    expect(
      evaluateStoredEnergySocObservation({
        storedEnergyWh: stored,
        lowerStoredEnergyBoundWh: lower,
        upperStoredEnergyBoundWh: upper,
      }).severity,
    ).toBe('FAIL');
  });

  it('keeps a valid zero-width state unresolved rather than dividing by zero', () => {
    const result = evaluateStoredEnergySocObservation({
      storedEnergyWh: 500,
      lowerStoredEnergyBoundWh: 500,
      upperStoredEnergyBoundWh: 500,
    });
    expect(result).toMatchObject({
      severity: 'CONDITIONAL',
      usableWindowSocFraction: undefined,
      usableWindowSocPercent: undefined,
    });
  });

  it('uses tolerance for reserve equality and does not turn reserve breach into FAIL', () => {
    expect(state(2000 + 1e-10, 20).reserveState).toBe('at-reserve');
    expect(state(1500, 20).severity).toBe('PASS');
    expect(state(-100, 20).severity).toBe('FAIL');
  });

  it('converts reserve energy from the explicit usable window', () => {
    expect(
      evaluateStoredEnergySocObservation({
        storedEnergyWh: 3600,
        lowerStoredEnergyBoundWh: 2000,
        upperStoredEnergyBoundWh: 10000,
        desiredReserveSocPercent: 25,
      }),
    ).toMatchObject({
      usableWindowSocPercent: 20,
      desiredReserveStoredEnergyWh: 4000,
      reserveMarginPercentagePoints: -5,
      reserveMarginWh: -400,
      reserveState: 'below-reserve',
      severity: 'PASS',
    });
  });

  it('observes a complete bounded trajectory without re-integrating energy', () => {
    const trajectory = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 4500,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [
        { intervalId: 'charge', requestedNetEnergyWh: 1500 },
        { intervalId: 'draw', requestedNetEnergyWh: -1000 },
      ],
    });
    const result = observeStoredEnergyTrajectorySoc(trajectory, { desiredReserveSocPercent: 20 });
    expect(result).toMatchObject({
      severity: 'PASS',
      startingSoc: { usableWindowSocPercent: 90 },
      endingSoc: { usableWindowSocPercent: 80 },
      minimumSoc: { usableWindowSocPercent: 80 },
      maximumSoc: { usableWindowSocPercent: 100 },
      everBelowDesiredReserve: false,
    });
    expect(result.intervals.map((interval) => interval.endingSoc?.usableWindowSocPercent)).toEqual([
      100, 80,
    ]);
  });

  it('preserves unresolved and failed upstream state semantics', () => {
    const unresolved = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 3000,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [
        { intervalId: 'known', requestedNetEnergyWh: -1000 },
        { intervalId: 'unknown', energyStatus: 'unresolved' },
        { intervalId: 'later', requestedNetEnergyWh: 500 },
      ],
    });
    expect(observeStoredEnergyTrajectorySoc(unresolved)).toMatchObject({
      severity: 'CONDITIONAL',
      startingSoc: { usableWindowSocPercent: 60 },
      endingSoc: undefined,
      minimumSoc: undefined,
    });

    const failed = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 3000,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [
        { intervalId: 'known', requestedNetEnergyWh: -1000 },
        { intervalId: 'failed', energyStatus: 'failed' },
      ],
    });
    expect(observeStoredEnergyTrajectorySoc(failed)).toMatchObject({
      severity: 'FAIL',
      startingSoc: { usableWindowSocPercent: 60 },
    });
  });

  it('reports reserve crossing and minimum margin without policy bands', () => {
    const trajectory = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 8000,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 10000,
      intervals: [
        { intervalId: 'one', requestedNetEnergyWh: -1500 },
        { intervalId: 'two', requestedNetEnergyWh: -1800 },
        { intervalId: 'three', requestedNetEnergyWh: -2400 },
      ],
    });
    expect(
      observeStoredEnergyTrajectorySoc(trajectory, { desiredReserveSocPercent: 20 }),
    ).toMatchObject({
      minimumSoc: { usableWindowSocPercent: 23 },
      minimumReserveMarginPercentagePoints: 3,
      minimumReserveMarginWh: 300,
      everBelowDesiredReserve: false,
      belowReserveIntervalIds: [],
    });
  });

  it('supports empty trajectories and distinct usable windows', () => {
    const empty = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 2500,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [],
    });
    expect(observeStoredEnergyTrajectorySoc(empty)).toMatchObject({
      startingSoc: { usableWindowSocPercent: 50 },
      endingSoc: { usableWindowSocPercent: 50 },
      minimumSoc: { usableWindowSocPercent: 50 },
      maximumSoc: { usableWindowSocPercent: 50 },
    });

    const bankA = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 9000,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 10000,
      intervals: [{ requestedNetEnergyWh: -4000 }],
    });
    const bankB = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 9000,
      lowerStoredEnergyBoundWh: 2000,
      upperStoredEnergyBoundWh: 10000,
      intervals: [{ requestedNetEnergyWh: -4000 }],
    });
    expect(observeStoredEnergyTrajectorySoc(bankA).endingSoc?.usableWindowSocPercent).toBe(50);
    expect(observeStoredEnergyTrajectorySoc(bankB).endingSoc?.usableWindowSocPercent).toBe(37.5);
  });
});
