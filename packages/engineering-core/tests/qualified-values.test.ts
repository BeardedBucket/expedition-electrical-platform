import { describe, expect, it } from 'vitest';
import {
  validateComponentLibraryRecord,
  parseComponentLibraryText,
  normalizeComponentLibraryRecord,
  evaluateComponentCompatibility,
  type CanonicalQualifiedValue,
} from '../src/component-library.js';
import { evaluateLoadStateEnergy } from '../src/load-state-energy.js';

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
  it.each([
    [{ operating_state: 'off', display: { state: 'off' } }, true],
    [{ operating_state: 'active', display: { state: 'off' } }, true],
    [{ operating_state: 'off', display: { state: 'on' } }, false],
    ...[0, 50, 100].map((brightness_percent) => [
      { operating_state: 'off', display: { state: 'on', brightness_percent } },
      false,
    ]),
    ...['idle', 'standby', 'sleep', 'active'].flatMap((operating_state) =>
      ['off', 'on'].map((state) => [{ operating_state, display: { state } }, true]),
    ),
    [{ measurement_basis: 'quiescent', display: { state: 'off' } }, true],
  ])('validates the narrow device/display state boundary: %j', (qualifiers, valid) => {
    expect(
      validateComponentLibraryRecord({
        ...base,
        qualified_values: [
          {
            id: 'power.states',
            target: 'electrical.power_consumption_w',
            value: 3,
            qualifiers,
          },
        ],
      }).ok,
    ).toBe(valid);
  });
  it('preserves discrete consumption points without choosing a baseline or device state', () => {
    const power: CanonicalQualifiedValue[] = [12, 24, 48].flatMap((voltage, index) => [
      {
        id: `power.off.${voltage}`,
        target: 'electrical.power_consumption_w',
        value: [2.6, 3, 3.7][index],
        qualifiers: { supply_voltage_v: voltage, display: { state: 'off' } },
      },
      {
        id: `power.on.${voltage}`,
        target: 'electrical.power_consumption_w',
        value: [6.2, 6.6, 7.4][index],
        qualifiers: {
          supply_voltage_v: voltage,
          display: { state: 'on', brightness_percent: 100 },
        },
      },
    ]);
    const result = parseComponentLibraryText(
      JSON.stringify({ ...base, qualified_values: [voltage, dimensions, ...power] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected preserved component');
    expect(result.value.qualified_values).toEqual([voltage, dimensions, ...power]);
    expect(result.value.electrical).toBeNull();
    expect(result.value.dimensions_mm).toBeUndefined();
    const energy = evaluateLoadStateEnergy({
      loadId: result.value.id,
      stateId: 'unknown',
      voltageV: 24,
      durationHours: 1,
    });
    expect(energy.powerW).toBeUndefined();
    expect(energy.energyWh).toBeUndefined();
    expect(energy.stateClassification).toBeUndefined();
    expect(energy.unresolvedFacts).toContain('powerW is unresolved; missing power is not zero.');
  });
  it.each([
    { value: Infinity },
    { value: NaN },
    { value: -1 },
    { qualifiers: {} },
    { qualifiers: { supply_voltage_v: Infinity } },
    { qualifiers: { display: { state: 'off', brightness_percent: 50 } } },
    { qualifiers: { display: { state: 'on', brightness_percent: -1 } } },
    { qualifiers: { operating_state: 'quiescent' } },
    { qualifiers: { extra: true } },
  ])('rejects invalid canonical power observations %j', (patch) => {
    expect(
      validateComponentLibraryRecord({
        ...base,
        qualified_values: [
          {
            id: 'power.invalid',
            target: 'electrical.power_consumption_w',
            value: 3,
            qualifiers: { supply_voltage_v: 24 },
            ...patch,
          },
        ],
      }).ok,
    ).toBe(false);
  });
  it('rejects power assertion ID collisions even when values differ', () => {
    expect(
      validateComponentLibraryRecord({
        ...base,
        qualified_values: [
          {
            id: 'power.same',
            target: 'electrical.power_consumption_w',
            value: 3,
            qualifiers: { supply_voltage_v: 24 },
          },
          {
            id: 'power.same',
            target: 'electrical.power_consumption_w',
            value: 4,
            qualifiers: { supply_voltage_v: 48 },
          },
        ],
      }).ok,
    ).toBe(false);
  });
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
