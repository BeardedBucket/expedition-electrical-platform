import { describe, expect, it } from 'vitest';
import { evaluateRechargeWindowFeasibility } from '../src/index.js';

describe('recharge window feasibility', () => {
  it('zero recovery is valid for zero or positive duration', () => {
    expect(
      evaluateRechargeWindowFeasibility({
        requiredRecoveryEnergyWh: 0,
        recoveryDurationHours: 0,
      }),
    ).toMatchObject({
      severity: 'PASS',
      requiredAverageChargingPowerW: 0,
      recoverableEnergyWh: 0,
      energyShortfallWh: 0,
      recoveryFeasible: true,
    });

    const positiveDuration = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 0,
      recoveryDurationHours: 3,
    });
    expect(positiveDuration).toMatchObject({
      severity: 'PASS',
      requiredAverageChargingPowerW: 0,
      recoveryFeasible: true,
    });
    expect(positiveDuration.energyShortfallWh).toBeUndefined();
    expect(positiveDuration.recoverableEnergyWh).toBeUndefined();
  });

  it('positive required energy with zero duration fails', () => {
    const result = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 0,
    });

    expect(result.severity).toBe('FAIL');
    expect(result.requiredAverageChargingPowerW).toBeUndefined();
    expect(result.recoveryFeasible).toBe(false);
    expect(result.energyShortfallWh).toBe(1200);
  });

  it('exact match is feasible and passes', () => {
    const result = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 2,
      acceptedBatterySideChargingPowerW: 600,
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      requiredAverageChargingPowerW: 600,
      recoverableEnergyWh: 1200,
      energyShortfallWh: 0,
      recoveryFeasible: true,
    });
  });

  it('insufficient capability fails with shortfall', () => {
    const result = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 2,
      acceptedBatterySideChargingPowerW: 500,
    });

    expect(result).toMatchObject({
      severity: 'FAIL',
      requiredAverageChargingPowerW: 600,
      recoverableEnergyWh: 1000,
      energyShortfallWh: 200,
      recoveryFeasible: false,
    });
  });

  it('excess capability passes without warning or negative judgment', () => {
    const result = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 2,
      acceptedBatterySideChargingPowerW: 1000,
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      recoverableEnergyWh: 2000,
      energyShortfallWh: 0,
      energySurplusWh: 800,
      recoveryFeasible: true,
    });
    expect(result.issues.join(' ')).not.toMatch(/warning|oversized|wasted/i);
  });

  it('omitted accepted capability stays conditional and does not fabricate recoverable energy', () => {
    const result = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1800,
      recoveryDurationHours: 3,
    });

    expect(result.severity).toBe('CONDITIONAL');
    expect(result.requiredAverageChargingPowerW).toBe(600);
    expect(result.recoverableEnergyWh).toBeUndefined();
    expect(result.energyShortfallWh).toBeUndefined();
    expect(result.recoveryFeasible).toBeUndefined();
  });

  it('explicit zero accepted power is a fail for positive recovery', () => {
    const result = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 2,
      acceptedBatterySideChargingPowerW: 0,
    });

    expect(result.severity).toBe('FAIL');
    expect(result.recoverableEnergyWh).toBe(0);
    expect(result.energyShortfallWh).toBe(1200);
    expect(result.recoveryFeasible).toBe(false);
  });

  it('validates invalid energy, duration, and accepted-power inputs', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        evaluateRechargeWindowFeasibility({
          requiredRecoveryEnergyWh: value,
          recoveryDurationHours: 2,
        }).severity,
      ).toBe('FAIL');
    }

    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        evaluateRechargeWindowFeasibility({
          requiredRecoveryEnergyWh: 1000,
          recoveryDurationHours: value,
        }).severity,
      ).toBe('FAIL');
    }

    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        evaluateRechargeWindowFeasibility({
          requiredRecoveryEnergyWh: 1000,
          recoveryDurationHours: 2,
          acceptedChargingPowerW: value,
        }).severity,
      ).toBe('FAIL');
    }
  });

  it('uses a repository tolerance on exact boundary feasibility', () => {
    const nearExact = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 2,
      acceptedBatterySideChargingPowerW: 600 + 1e-10,
    });

    expect(nearExact.severity).toBe('PASS');
    expect(nearExact.recoverableEnergyWh).toBeCloseTo(1200.0000000002, 12);
    expect(nearExact.energyShortfallWh).toBe(0);
  });

  it('supports shore-style and solar-style recovery windows without day assumptions', () => {
    const shorePass = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 3,
      acceptedBatterySideChargingPowerW: 600,
    });
    expect(shorePass).toMatchObject({
      severity: 'PASS',
      recoverableEnergyWh: 1800,
      recoveryFeasible: true,
    });

    const shoreShort = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 1,
      acceptedBatterySideChargingPowerW: 600,
    });
    expect(shoreShort).toMatchObject({
      severity: 'FAIL',
      recoverableEnergyWh: 600,
      energyShortfallWh: 600,
      recoveryFeasible: false,
    });

    const solarPass = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 2400,
      recoveryDurationHours: 5,
      acceptedBatterySideChargingPowerW: 600,
    });
    expect(solarPass).toMatchObject({
      severity: 'PASS',
      recoverableEnergyWh: 3000,
      energyShortfallWh: 0,
      recoveryFeasible: true,
    });

    const solarShort = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 2400,
      recoveryDurationHours: 3,
      acceptedBatterySideChargingPowerW: 600,
    });
    expect(solarShort).toMatchObject({
      severity: 'FAIL',
      recoverableEnergyWh: 1800,
      energyShortfallWh: 600,
      recoveryFeasible: false,
    });
  });

  it('handles same requirement at different durations and larger explicit windows without fixed daily semantics', () => {
    const oneHour = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 1,
      acceptedBatterySideChargingPowerW: 600,
    });
    expect(oneHour).toMatchObject({
      severity: 'FAIL',
      recoverableEnergyWh: 600,
      energyShortfallWh: 600,
    });

    const twoHour = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 2,
      acceptedBatterySideChargingPowerW: 600,
    });
    expect(twoHour.severity).toBe('PASS');

    const threeHour = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 1200,
      recoveryDurationHours: 3,
      acceptedBatterySideChargingPowerW: 600,
    });
    expect(threeHour.severity).toBe('PASS');
    expect(threeHour.energySurplusWh).toBe(600);

    const largeWindow = evaluateRechargeWindowFeasibility({
      requiredRecoveryEnergyWh: 6000,
      recoveryDurationHours: 8,
      acceptedBatterySideChargingPowerW: 800,
    });
    expect(largeWindow).toMatchObject({
      severity: 'PASS',
      recoverableEnergyWh: 6400,
      energySurplusWh: 400,
      recoveryFeasible: true,
    });
    expect(largeWindow.provenance.formula).toContain(
      'requiredRecoveryEnergyWh / recoveryDurationHours',
    );
  });
});
