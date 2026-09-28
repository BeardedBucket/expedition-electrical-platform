import { describe, expect, it } from 'vitest';
import {
  validateComponentLibraryRecord,
  parseComponentLibraryText,
  normalizeComponentLibraryRecord,
  evaluateComponentCompatibility,
  type CanonicalQualifiedValue,
} from '../src/component-library.js';

const base = {
  id: 'synthetic.qualified',
  manufacturer: 'Synthetic',
  model: 'Model',
  category: 'monitor',
  verification_status: 'unverified',
};
const voltage: CanonicalQualifiedValue = {
  id: 'qualified-value.voltage',
  target: 'electrical.input_voltage_range_v',
  value: { min: 8, max: 70 },
  qualifiers: { electrical_domain: 'dc' },
};
const dimensions: CanonicalQualifiedValue = {
  id: 'qualified-value.dimensions',
  target: 'dimensions_mm',
  value: { x: 187, y: 29.8, z: 124 },
  qualifiers: {
    physical_scope: { kind: 'physical_body', exclusions: ['connectors', 'mounting_accessories'] },
  },
};

describe('qualified canonical component values', () => {
  it('keeps legacy fields valid and does not insert empty qualified collections', () => {
    const legacy = {
      ...base,
      electrical: { input_voltage_range_v: { min: 8, max: 70 } },
      dimensions_mm: { x: 180, y: 30, z: 120 },
    };
    expect(validateComponentLibraryRecord(legacy).ok).toBe(true);
    const normalized = normalizeComponentLibraryRecord(legacy);
    expect(normalized.qualified_values).toBeUndefined();
    expect(normalized.dimensions_mm).toEqual(legacy.dimensions_mm);
    expect(normalized.electrical?.input_voltage_range_v).toEqual(
      legacy.electrical.input_voltage_range_v,
    );
  });
  it('preserves complete qualified values through parsing/loading without direct projection', () => {
    const parsed = parseComponentLibraryText(
      JSON.stringify({ ...base, qualified_values: [voltage, dimensions] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Expected valid component');
    expect(parsed.value.qualified_values).toEqual([voltage, dimensions]);
    expect(parsed.value.electrical).toBeNull();
    expect(parsed.value.dimensions_mm).toBeUndefined();
    const result = evaluateComponentCompatibility(parsed.value, {
      systemVoltageV: 24,
      installationEnvelopeMm: { x: 1000, y: 1000, z: 1000 },
      requiredChecks: ['voltage', 'fit'],
    });
    expect(result.checks.voltage?.status).toBe('unknown');
    expect(result.checks.fit?.status).toBe('unknown');
    expect(result.status).toBe('unknown');
  });
  it('supports same-target entries under distinct IDs', () => {
    expect(
      validateComponentLibraryRecord({
        ...base,
        qualified_values: [
          voltage,
          { ...voltage, id: 'qualified-value.ac', qualifiers: { electrical_domain: 'ac' } },
        ],
      }).ok,
    ).toBe(true);
  });
  it.each([
    [voltage, { ...voltage }],
    [{ ...voltage, value: { min: 70, max: 8 } }],
    [{ ...voltage, target: 'unsupported' }],
    [{ ...voltage, qualifiers: { physical_scope: dimensions.qualifiers } }],
    [{ ...dimensions, qualifiers: { electrical_domain: 'dc' } }],
    [{ ...dimensions, value: { x: 0, y: 29.8, z: 124 } }],
    [{ ...voltage, qualifiers: {} }],
    [
      {
        ...dimensions,
        qualifiers: { physical_scope: { kind: 'installed_envelope', exclusions: ['connectors'] } },
      },
    ],
  ])('rejects malformed, duplicate, or incompatible assertions: %j', (...entries) => {
    expect(validateComponentLibraryRecord({ ...base, qualified_values: entries }).ok).toBe(false);
  });
});
