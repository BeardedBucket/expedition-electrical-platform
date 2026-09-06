import { describe, expect, it } from 'vitest';
import {
  composeVariableSourceAndLoadEnergy,
  evaluateVariableSourceEnergySequence,
  evaluateStoredEnergyStateTrajectory,
} from '../src/index.js';

describe('variable source energy', () => {
  it('evaluates direct positive battery-side energy', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [{ intervalId: 'a', contributions: [{ sourceId: 'roof', energyWh: 450 }] }],
    });
    expect(result).toMatchObject({
      severity: 'PASS',
      totalSourceEnergyWh: 450,
      intervals: [{ intervalId: 'a', totalSourceEnergyWh: 450 }],
    });
  });

  it('accepts explicit zero energy', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [{ intervalId: 'zero', contributions: [{ sourceId: 'roof', energyWh: 0 }] }],
    });
    expect(result.intervals[0]).toMatchObject({
      energyStatus: 'resolved',
      totalSourceEnergyWh: 0,
    });
  });

  it('keeps unknown contribution distinct from zero', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [{ intervalId: 'unknown', contributions: [{ sourceId: 'roof' }] }],
    });
    expect(result.severity).toBe('CONDITIONAL');
    expect(result.totalSourceEnergyWh).toBeUndefined();
    expect(result.intervals[0]).toMatchObject({
      energyStatus: 'unresolved',
      knownSourceEnergyWh: 0,
    });
  });

  it.each([
    [-1, 'negative'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
  ])('rejects %s energy', (energyWh, label) => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [{ intervalId: label, contributions: [{ sourceId: 'roof', energyWh }] }],
    });
    expect(result.severity).toBe('FAIL');
  });

  it('evaluates power and explicit irregular durations, including zero duration', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [
        {
          intervalId: 'a',
          contributions: [{ sourceId: 'roof', batterySidePowerW: 200, durationHours: 0.5 }],
        },
        {
          intervalId: 'b',
          contributions: [{ sourceId: 'roof', batterySidePowerW: 550, durationHours: 1.25 }],
        },
        {
          intervalId: 'c',
          contributions: [{ sourceId: 'roof', batterySidePowerW: 125, durationHours: 0 }],
        },
      ],
    });
    expect(result.intervals.map((interval) => interval.totalSourceEnergyWh)).toEqual([
      100, 687.5, 0,
    ]);
  });

  it('rejects negative power and duration', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [
        {
          intervalId: 'bad',
          contributions: [{ sourceId: 'roof', batterySidePowerW: -1, durationHours: -1 }],
        },
      ],
    });
    expect(result.severity).toBe('FAIL');
  });

  it('preserves variable contributions and caller order', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [100, 700, 250, 0, 900].map((energyWh, index) => ({
        intervalId: `interval-${index}`,
        contributions: [{ sourceId: 'roof-source', energyWh }],
      })),
    });
    expect(result.intervals.map((interval) => interval.totalSourceEnergyWh)).toEqual([
      100, 700, 250, 0, 900,
    ]);
    expect(result.totalSourceEnergyWh).toBe(1950);
  });

  it('fails duplicate interval IDs without sorting the sequence', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [
        { intervalId: 'second', contributions: [{ sourceId: 'roof', energyWh: 1 }] },
        { intervalId: 'first', contributions: [{ sourceId: 'roof', energyWh: 2 }] },
        { intervalId: 'second', contributions: [{ sourceId: 'roof', energyWh: 3 }] },
      ],
    });
    expect(result.severity).toBe('FAIL');
    expect(result.intervals.map((interval) => interval.intervalId)).toEqual([
      'second',
      'first',
      'second',
    ]);
  });

  it('sums explicitly concurrent source contributions and preserves source IDs', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [
        {
          intervalId: 'same-window',
          contributions: [
            { sourceId: 'roof', energyWh: 500 },
            { sourceId: 'portable', energyWh: 300 },
          ],
        },
      ],
    });
    expect(result.intervals[0]).toMatchObject({
      totalSourceEnergyWh: 800,
      sourceContributions: [
        { sourceId: 'roof', energyWh: 500 },
        { sourceId: 'portable', energyWh: 300 },
      ],
    });
  });

  it('retains a known subtotal while leaving an unresolved concurrent total unresolved', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [
        {
          intervalId: 'partial',
          contributions: [{ sourceId: 'roof', energyWh: 500 }, { sourceId: 'portable' }],
        },
      ],
    });
    expect(result.intervals[0]).toMatchObject({
      knownSourceEnergyWh: 500,
      energyStatus: 'unresolved',
    });
    expect(result.intervals[0].totalSourceEnergyWh).toBeUndefined();
  });

  it('composes a resolved source with a load using positive charging sign', () => {
    const source = evaluateVariableSourceEnergySequence({
      intervals: [
        { intervalId: 'load-window', contributions: [{ sourceId: 'roof', energyWh: 600 }] },
      ],
    });
    expect(
      composeVariableSourceAndLoadEnergy({
        sourceInterval: source.intervals[0],
        loadEnergyWh: -1000,
      }),
    ).toMatchObject({ severity: 'PASS', netBatteryEnergyWh: -400 });
  });

  it('leaves net energy unresolved when source or load is unknown', () => {
    const unknownSource = evaluateVariableSourceEnergySequence({
      intervals: [{ intervalId: 'unknown', contributions: [{ sourceId: 'roof' }] }],
    });
    expect(
      composeVariableSourceAndLoadEnergy({
        sourceInterval: unknownSource.intervals[0],
        loadEnergyWh: -1000,
      }).netBatteryEnergyWh,
    ).toBeUndefined();
  });

  it('uses explicit zero source energy in load composition', () => {
    const source = evaluateVariableSourceEnergySequence({
      intervals: [{ intervalId: 'zero', contributions: [{ sourceId: 'roof', energyWh: 0 }] }],
    });
    expect(
      composeVariableSourceAndLoadEnergy({
        sourceInterval: source.intervals[0],
        loadEnergyWh: -1000,
      }),
    ).toMatchObject({ severity: 'PASS', netBatteryEnergyWh: -1000 });
  });

  it('supports an explicitly modeled source-only interval with zero load', () => {
    const source = evaluateVariableSourceEnergySequence({
      intervals: [
        { intervalId: 'source-only', contributions: [{ sourceId: 'roof', energyWh: 600 }] },
      ],
    });
    expect(
      composeVariableSourceAndLoadEnergy({
        sourceInterval: source.intervals[0],
        loadEnergyWh: 0,
      }),
    ).toMatchObject({ severity: 'PASS', netBatteryEnergyWh: 600 });
  });

  it('composes with bounded storage without changing the modeled source contribution', () => {
    const source = evaluateVariableSourceEnergySequence({
      intervals: [
        { intervalId: 'saturating', contributions: [{ sourceId: 'source', energyWh: 1500 }] },
      ],
    });
    const composed = composeVariableSourceAndLoadEnergy({
      sourceInterval: source.intervals[0],
      loadEnergyWh: 0,
    });
    const storage = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 4500,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [{ intervalId: 'saturating', requestedNetEnergyWh: composed.netBatteryEnergyWh }],
    });
    expect(source.intervals[0].totalSourceEnergyWh).toBe(1500);
    expect(storage).toMatchObject({
      endingStoredEnergyWh: 5000,
      totalStoredChargingEnergyWh: 500,
      totalCurtailedEnergyWh: 1000,
    });
  });

  it('composes source and load before storage for deficit and excess cases', () => {
    const source = evaluateVariableSourceEnergySequence({
      intervals: [
        { intervalId: 'deficit', contributions: [{ sourceId: 'source', energyWh: 600 }] },
        { intervalId: 'excess', contributions: [{ sourceId: 'source', energyWh: 3000 }] },
      ],
    });
    const deficit = composeVariableSourceAndLoadEnergy({
      sourceInterval: source.intervals[0],
      loadEnergyWh: -1000,
    });
    const excess = composeVariableSourceAndLoadEnergy({
      sourceInterval: source.intervals[1],
      loadEnergyWh: -500,
    });
    const storage = evaluateStoredEnergyStateTrajectory({
      startingStoredEnergyWh: 3000,
      lowerStoredEnergyBoundWh: 0,
      upperStoredEnergyBoundWh: 5000,
      intervals: [
        { intervalId: 'deficit', requestedNetEnergyWh: deficit.netBatteryEnergyWh },
        { intervalId: 'excess', requestedNetEnergyWh: excess.netBatteryEnergyWh },
      ],
    });
    expect(deficit.netBatteryEnergyWh).toBe(-400);
    expect(excess.netBatteryEnergyWh).toBe(2500);
    expect(storage).toMatchObject({
      endingStoredEnergyWh: 5000,
      totalStoredChargingEnergyWh: 2400,
      totalCurtailedEnergyWh: 100,
    });
  });

  it('calculates the required multi-period total without day semantics', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [300, 900, 1400, 250].map((energyWh, index) => ({
        intervalId: `period-${index + 1}`,
        contributions: [{ sourceId: 'source', energyWh }],
      })),
    });
    expect(result.totalSourceEnergyWh).toBe(2850);
  });

  it('does not infer source type, voltage, efficiency, rating, priority, or recommendations', () => {
    const result = evaluateVariableSourceEnergySequence({
      intervals: [
        { intervalId: 'explicit', contributions: [{ sourceId: 'generator', energyWh: 1 }] },
      ],
    });
    expect(result).not.toHaveProperty('voltageV');
    expect(result).not.toHaveProperty('efficiency');
    expect(result).not.toHaveProperty('recommendation');
    expect(result.intervals[0].sourceContributions[0]).not.toHaveProperty('sourceType');
  });
});
