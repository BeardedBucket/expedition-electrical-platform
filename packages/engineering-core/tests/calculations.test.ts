import { describe, expect, it } from 'vitest';
import {
  calculateConductor,
  compareSystemVoltageCandidates,
  conversionCurrentToPower,
  conversionPowerToCurrent,
  directCurrentToPower,
  directPowerToCurrent,
  evaluateEngineeringRules,
  evaluateWireCandidate,
  percentVoltageDrop,
  roundTripLength,
} from '../src/index.js';

const baseConstraints = {
  currentA: 10,
  systemVoltageV: 24,
  oneWayLengthM: 2,
  requiredAmpacityA: 15,
  maximumPercentVoltageDrop: 5,
};

describe('deterministic electrical calculations', () => {
  it('keeps direct relationships separate from conversion relationships', () => {
    expect(directPowerToCurrent({ powerW: 240, voltageV: 24 })).toMatchObject({
      ok: true,
      value: { currentA: 10, powerW: 240 },
    });
    expect(directCurrentToPower({ currentA: 10, voltageV: 24 })).toMatchObject({
      ok: true,
      value: { powerW: 240 },
    });
    expect(conversionPowerToCurrent({ powerW: 240, voltageV: 24, efficiency: 0.8 })).toMatchObject({
      ok: true,
      value: { currentA: 12.5, inputPowerW: 300 },
    });
    expect(conversionCurrentToPower({ currentA: 10, voltageV: 24, efficiency: 0.8 })).toMatchObject(
      {
        ok: true,
        value: { outputPowerW: 192 },
      },
    );
  });

  it('requires valid explicit conversion efficiency', () => {
    for (const efficiency of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.01]) {
      expect(conversionPowerToCurrent({ powerW: 240, voltageV: 24, efficiency })).toMatchObject({
        ok: false,
        code: 'invalid_input',
      });
    }
    expect(conversionPowerToCurrent({ powerW: 240, voltageV: 24, efficiency: 1 })).toMatchObject({
      ok: true,
    });
  });

  it('distinguishes valid zero values from invalid sizing inputs', () => {
    expect(directPowerToCurrent({ powerW: 0, voltageV: 24 })).toMatchObject({ ok: true });
    expect(directPowerToCurrent({ powerW: Number.NaN, voltageV: 24 })).toMatchObject({ ok: false });
    expect(directPowerToCurrent({ powerW: 240, voltageV: 0 })).toMatchObject({ ok: false });
    expect(directPowerToCurrent({ powerW: 240, voltageV: Number.POSITIVE_INFINITY })).toMatchObject(
      { ok: false },
    );
    expect(roundTripLength({ oneWayLengthM: 0 })).toMatchObject({ ok: true, value: 0 });
    expect(roundTripLength({ oneWayLengthM: -1 })).toMatchObject({ ok: false });
    expect(roundTripLength({ oneWayLengthM: Number.POSITIVE_INFINITY })).toMatchObject({
      ok: false,
    });
  });

  it('calculates conductor drop and loss at zero length and valid positive length', () => {
    expect(
      calculateConductor({
        currentA: 10,
        nominalVoltageV: 24,
        oneWayLengthM: 0,
        resistanceOhmPerM: 0.01,
      }),
    ).toMatchObject({
      ok: true,
      value: { effectiveLengthM: 0, voltageDropV: 0, powerLossW: 0, percentVoltageDrop: 0 },
    });
    expect(
      calculateConductor({
        currentA: 10,
        nominalVoltageV: 24,
        oneWayLengthM: 2,
        resistanceOhmPerM: 0.01,
      }),
    ).toMatchObject({
      ok: true,
      value: { effectiveLengthM: 4, voltageDropV: 0.4, powerLossW: 4 },
    });
  });

  it('accepts zero voltage drop but rejects negative, NaN, and infinite values', () => {
    expect(percentVoltageDrop(0, 24)).toMatchObject({ ok: true, value: 0 });
    for (const voltageDropV of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(percentVoltageDrop(voltageDropV, 24)).toMatchObject({
        ok: false,
        code: 'invalid_input',
      });
    }
    expect(percentVoltageDrop(1, 0)).toMatchObject({ ok: false });
  });

  it('compares direct-source and converted-load voltage candidates explicitly', () => {
    expect(
      compareSystemVoltageCandidates({ powerW: 240, powerBasis: 'direct-source' }, [
        { id: '24v', voltageV: 24 },
      ]),
    ).toMatchObject({ ok: true, value: [{ currentA: 10, sourcePowerW: 240 }] });
    expect(
      compareSystemVoltageCandidates({ powerW: 240, powerBasis: 'converted-load' }, [
        { id: '24v', voltageV: 24 },
      ]),
    ).toMatchObject({ ok: false, code: 'insufficient_data' });
    expect(
      compareSystemVoltageCandidates(
        { powerW: 240, powerBasis: 'converted-load', conversionEfficiency: 0.8 },
        [{ id: '24v', voltageV: 24 }],
      ),
    ).toMatchObject({ ok: true, value: [{ currentA: 12.5, sourcePowerW: 300 }] });
    expect(
      compareSystemVoltageCandidates({ powerW: 240, powerBasis: 'direct-source' }, []),
    ).toMatchObject({ ok: false, code: 'insufficient_data' });
  });

  it('requires installation-specific ampacity data rather than a universal gauge lookup', () => {
    expect(
      evaluateWireCandidate(
        { id: 'wire', gauge: 'synthetic', resistanceOhmPerM: 0.01 },
        { ...baseConstraints, installationConditionId: 'missing' },
      ),
    ).toMatchObject({ ok: false, code: 'insufficient_data' });
  });

  it('distinguishes missing, failing, passing, and malformed ampacity data', () => {
    const candidate = { id: 'wire', gauge: 'synthetic', resistanceOhmPerM: 0 };
    expect(evaluateWireCandidate(candidate, baseConstraints)).toMatchObject({
      ok: false,
      code: 'insufficient_data',
    });
    expect(evaluateWireCandidate(candidate, baseConstraints, 10)).toMatchObject({
      ok: true,
      value: { eligible: false, ampacity: { passes: false } },
    });
    expect(evaluateWireCandidate(candidate, baseConstraints, 15)).toMatchObject({
      ok: true,
      value: { eligible: true, ampacity: { passes: true, availableA: 15 } },
    });
    for (const ampacityA of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(evaluateWireCandidate(candidate, baseConstraints, ampacityA)).toMatchObject({
        ok: false,
        code: 'invalid_input',
      });
    }
  });

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    'requires every requested wire constraint: ampacity=%s, voltageDrop=%s, eligible=%s',
    (ampacityPasses, voltageDropPasses, eligible) => {
      const result = evaluateWireCandidate(
        { id: 'wire', gauge: 'synthetic', resistanceOhmPerM: voltageDropPasses ? 0 : 1 },
        baseConstraints,
        ampacityPasses ? 20 : 10,
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          eligible,
          ampacity: { passes: ampacityPasses },
          voltageDrop: { passes: voltageDropPasses },
        },
      });
    },
  );

  it('produces a repeatable trace with accurate system-voltage comparison IDs', () => {
    const input = {
      systemVoltageComparison: { powerW: 240, powerBasis: 'direct-source' as const },
      systemVoltageCandidates: [{ id: '24v', voltageV: 24 }],
      wireCandidates: [{ id: 'wire', gauge: 'synthetic', resistanceOhmPerM: 0.01 }],
      wireConstraints: { ...baseConstraints, installationConditionId: 'default' },
    };
    const profile = {
      id: 'synthetic',
      version: '1.0.0',
      status: 'synthetic' as const,
      sources: [{ id: 'fixture', title: 'Synthetic fixture' }],
      ampacityRecords: [
        {
          conductorGauge: 'synthetic',
          installationConditionId: 'default',
          baseAmpacityA: 20,
          deratingInputs: [],
          sourceReferences: [{ id: 'fixture', title: 'Synthetic fixture' }],
        },
      ],
    };
    const first = evaluateEngineeringRules(input, profile);
    expect(first).toEqual(evaluateEngineeringRules(input, profile));
    expect(first.calculationSteps[0]?.id).toBe('system-voltage-comparison');
    expect(first.ruleIds[0]?.id).toBe('electrical.system-voltage-comparison');
    expect(first.sourceReferences).toHaveLength(1);
    expect(first.calculationSteps.every((step) => step.status === 'complete')).toBe(true);
  });

  it('reports non-complete trace status for missing or malformed calculation data', () => {
    const input = {
      systemVoltageComparison: { powerW: 240, powerBasis: 'direct-source' as const },
      systemVoltageCandidates: [{ id: '24v', voltageV: 24 }],
      wireCandidates: [{ id: 'wire', gauge: 'missing', resistanceOhmPerM: 0.01 }],
      wireConstraints: { ...baseConstraints, installationConditionId: 'default' },
    };
    const profile = {
      id: 'synthetic',
      version: '1.0.0',
      status: 'synthetic' as const,
      sources: [],
      ampacityRecords: [],
    };
    const missingTrace = evaluateEngineeringRules(input, profile);
    expect(missingTrace.calculationSteps[1]?.status).toBe('empty');
    const malformedTrace = evaluateEngineeringRules(input, {
      ...profile,
      ampacityRecords: [
        {
          conductorGauge: 'missing',
          installationConditionId: 'default',
          baseAmpacityA: Number.NaN,
          deratingInputs: [],
          sourceReferences: [],
        },
      ],
    });
    expect(malformedTrace.calculationSteps[1]?.status).toBe('failed');
  });
});
