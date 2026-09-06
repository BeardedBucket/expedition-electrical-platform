import { describe, expect, it } from 'vitest';
import {
  composeLoadStateEnergy,
  evaluateLoadStateEnergy,
  type LoadStateEnergyInput,
} from '../src/index.js';

const input = (overrides: Partial<LoadStateEnergyInput> = {}): LoadStateEnergyInput => ({
  loadId: 'inverter',
  instanceId: 'inverter-1',
  stateId: 'idle',
  powerW: 18,
  durationHours: 10,
  ...overrides,
});

describe('load state energy', () => {
  it('evaluates explicit idle, standby, zero, and 24-hour values without defaults', () => {
    expect(evaluateLoadStateEnergy(input())).toMatchObject({
      severity: 'PASS',
      stateId: 'idle',
      powerW: 18,
      durationHours: 10,
      energyWh: 180,
      netBatteryPowerW: -18,
      netBatteryEnergyWh: -180,
    });
    expect(
      evaluateLoadStateEnergy(input({ stateId: 'standby', powerW: 6, durationHours: 8 })).energyWh,
    ).toBe(48);
    expect(evaluateLoadStateEnergy(input({ powerW: 18, durationHours: 24 })).energyWh).toBe(432);
    expect(evaluateLoadStateEnergy(input({ powerW: 0 })).energyWh).toBe(0);
    expect(evaluateLoadStateEnergy(input({ durationHours: 0 })).energyWh).toBe(0);
  });

  it('keeps unknown facts unresolved and rejects invalid values', () => {
    expect(evaluateLoadStateEnergy(input({ powerW: undefined })).severity).toBe('CONDITIONAL');
    expect(evaluateLoadStateEnergy(input({ durationHours: undefined })).severity).toBe(
      'CONDITIONAL',
    );
    for (const powerW of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(evaluateLoadStateEnergy(input({ powerW })).severity).toBe('FAIL');
    }
    for (const durationHours of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(evaluateLoadStateEnergy(input({ durationHours })).severity).toBe('FAIL');
    }
  });

  it('preserves caller-defined state, instance, product, and provenance identity', () => {
    const result = evaluateLoadStateEnergy(
      input({
        loadId: 'controller',
        instanceId: 'controller-2',
        productId: 'controller-product',
        stateId: 'manufacturer-low-power',
        stateClassification: 'other',
        source: { id: 'datasheet-1', locator: 'page 4' },
      }),
    );
    expect(result).toMatchObject({
      loadId: 'controller',
      instanceId: 'controller-2',
      productId: 'controller-product',
      stateId: 'manufacturer-low-power',
      stateClassification: 'other',
      provenance: { source: { id: 'datasheet-1', locator: 'page 4' } },
    });
  });

  it('sums only explicitly concurrent contributions and preserves independent instances', () => {
    const result = composeLoadStateEnergy({
      contributions: [
        input({ loadId: 'inverter', instanceId: 'inverter-1', powerW: 18, durationHours: 5 }),
        input({ loadId: 'controller', instanceId: 'controller-1', powerW: 4, durationHours: 5 }),
        input({ loadId: 'monitor', instanceId: 'monitor-1', powerW: 2, durationHours: 5 }),
      ],
      concurrency: [['inverter-1', 'controller-1', 'monitor-1']],
    });
    expect(result).toMatchObject({
      severity: 'PASS',
      totalPowerW: 24,
      totalEnergyWh: 120,
      netBatteryEnergyWh: -120,
    });
    expect(result.contributions).toHaveLength(3);
  });

  it('supports exclusivity and explicit included-overhead suppression', () => {
    const result = composeLoadStateEnergy({
      contributions: [
        input({ contributionId: 'active', stateId: 'active', powerW: 500, durationHours: 2 }),
        input({
          contributionId: 'idle',
          stateId: 'idle',
          powerW: 18,
          durationHours: 6,
          exclusiveWith: ['active'],
        }),
        input({
          contributionId: 'included-idle',
          stateId: 'idle',
          powerW: 18,
          durationHours: 2,
          includedInContributionId: 'active',
        }),
      ],
    });
    expect(result).toMatchObject({
      severity: 'PASS',
      totalEnergyWh: 1108,
      netBatteryEnergyWh: -1108,
    });
    expect(result.issues).toEqual([]);
  });

  it('does not infer off consumption, duty cycles, voltage, efficiency, or calendar semantics', () => {
    const result = evaluateLoadStateEnergy(
      input({
        stateId: 'off',
        powerW: undefined,
        durationHours: 0,
        voltageV: undefined,
        dutyCycle: undefined,
      }),
    );
    expect(result.energyWh).toBeUndefined();
    expect(result.assumptions).toEqual([]);
  });
});
