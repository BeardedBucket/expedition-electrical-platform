import { describe, expect, it } from 'vitest';
import { evaluateEnergyStorageRequirement } from '../src/index.js';

describe('energy storage requirement evaluation', () => {
  it('computes nominal storage requirement for explicit period energy and usable fraction', () => {
    const result = evaluateEnergyStorageRequirement({
      requirementId: 'case-a',
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 1,
      usableFractionOfNominal: 1,
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      code: 'energy.storage_requirement.pass',
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 1,
      autonomyAdjustedUsableEnergyWh: 3000,
      usableFractionOfNominal: 1,
      reserveFractionDerived: 0,
      requiredNominalEnergyWh: 3000,
      status: 'PASS',
    });
  });

  it('multiplies usable energy by autonomy and divides by usable fraction', () => {
    const result = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      autonomyAdjustedUsableEnergyWh: 6000,
      reserveFractionDerived: 0.2,
      requiredNominalEnergyWh: 7500,
    });
  });

  it('supports fractional autonomy periods', () => {
    const result = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 1.5,
      usableFractionOfNominal: 0.75,
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      autonomyAdjustedUsableEnergyWh: 4500,
      requiredNominalEnergyWh: 6000,
    });
  });

  it('allows zero usable energy when explicitly requested', () => {
    const result = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 0,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      requiredUsableEnergyWh: 0,
      autonomyAdjustedUsableEnergyWh: 0,
      requiredNominalEnergyWh: 0,
    });
  });

  it('changes only because caller policy changes, not chemistry defaults', () => {
    const a = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 1,
    });
    const b = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
    });
    const c = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.5,
    });

    expect(a.requiredNominalEnergyWh).toBe(6000);
    expect(b.requiredNominalEnergyWh).toBe(7500);
    expect(c.requiredNominalEnergyWh).toBe(12000);
    expect(a.requiredNominalEnergyWh).not.toBe(b.requiredNominalEnergyWh);
    expect(b.requiredNominalEnergyWh).not.toBe(c.requiredNominalEnergyWh);
  });

  it('changes only because autonomy period count changes', () => {
    const one = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 1,
      usableFractionOfNominal: 0.8,
    });
    const two = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
    });
    const three = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 3,
      usableFractionOfNominal: 0.8,
    });

    expect(one.requiredNominalEnergyWh).toBe(3750);
    expect(two.requiredNominalEnergyWh).toBe(7500);
    expect(three.requiredNominalEnergyWh).toBe(11250);
  });

  it('consumes an explicitly supplied requirement basis rather than hidden net-energy selection', () => {
    const result = evaluateEnergyStorageRequirement({
      requirementId: 'phase-3a-bridge',
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 1,
      usableFractionOfNominal: 0.8,
      basis: {
        kind: 'usage-profile-discharge',
        sourceId: 'profile-a',
      },
    });

    expect(result).toMatchObject({
      requiredUsableEnergyWh: 3000,
      basis: { kind: 'usage-profile-discharge', sourceId: 'profile-a' },
      provenance: { basis: { kind: 'usage-profile-discharge', sourceId: 'profile-a' } },
      requiredNominalEnergyWh: 3750,
    });
  });

  it('uses required usable energy as the sole numeric requirement for every basis kind', () => {
    const explicit = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
      basis: { kind: 'explicit' },
    });
    const profileDischarge = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
      basis: { kind: 'usage-profile-discharge', sourceId: 'profile-a' },
    });
    const otherDerived = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
      basis: { kind: 'other-derived', sourceId: 'calculation-a' },
    });

    expect(explicit.requiredNominalEnergyWh).toBe(7500);
    expect(profileDischarge.requiredNominalEnergyWh).toBe(7500);
    expect(otherDerived.requiredNominalEnergyWh).toBe(7500);
    expect(explicit.provenance.basis).toEqual({ kind: 'explicit' });
    expect(profileDischarge.provenance.basis).toEqual({
      kind: 'usage-profile-discharge',
      sourceId: 'profile-a',
    });
    expect(otherDerived.provenance.basis).toEqual({
      kind: 'other-derived',
      sourceId: 'calculation-a',
    });
  });

  it('does not silently convert a charging/discharging net-energy example into usable storage', () => {
    const result = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
      basis: { kind: 'explicit', sourceId: 'caller-selected-requirement' },
    });

    expect(result.requiredNominalEnergyWh).toBe(7500);
    expect(result.requiredNominalEnergyWh).not.toBe(1250);
    expect(result.requiredNominalEnergyWh).not.toBe(2500);
  });

  it('preserves provenance for derived values and the operating formula', () => {
    const result = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
    });

    expect(result.provenance).toMatchObject({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
      autonomyAdjustedUsableEnergyWh: 6000,
      requiredNominalEnergyWh: 7500,
      reserveFractionDerived: 0.2,
    });
  });

  it('fails on negative, NaN, and infinite required energy inputs', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = evaluateEnergyStorageRequirement({
        requiredUsableEnergyWh: value,
        autonomyPeriodCount: 1,
        usableFractionOfNominal: 0.8,
      });

      expect(result.severity).toBe('FAIL');
      expect(result.status).toBe('FAIL');
    }
  });

  it('fails on invalid autonomy and usable fraction inputs', () => {
    const invalidAutonomy = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const invalidUsable = [
      0,
      -0.5,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];

    for (const autonomy of invalidAutonomy) {
      const result = evaluateEnergyStorageRequirement({
        requiredUsableEnergyWh: 3000,
        autonomyPeriodCount: autonomy,
        usableFractionOfNominal: 0.8,
      });
      expect(result.severity).toBe('FAIL');
    }

    for (const usable of invalidUsable) {
      const result = evaluateEnergyStorageRequirement({
        requiredUsableEnergyWh: 3000,
        autonomyPeriodCount: 2,
        usableFractionOfNominal: usable,
      });
      expect(result.severity).toBe('FAIL');
    }
  });

  it('does not inspect chemistry or battery context', () => {
    const a = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
    });
    const b = evaluateEnergyStorageRequirement({
      requiredUsableEnergyWh: 3000,
      autonomyPeriodCount: 2,
      usableFractionOfNominal: 0.8,
      basis: { kind: 'other-derived', sourceId: 'chemistry-irrelevant' },
    });

    expect(a.requiredNominalEnergyWh).toBe(b.requiredNominalEnergyWh);
  });
});
