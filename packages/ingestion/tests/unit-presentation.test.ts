import { describe, expect, it } from 'vitest';
import {
  convertUnit,
  buildSourceAwareMeasurement,
  canonicalSerializedSnapshot,
  presentMeasurement,
  type ProductFact,
  type ProductSource,
} from '../src/index.js';

const source: ProductSource = {
  schema_version: '1.0',
  id: 'acme.manual',
  uri: 'https://example.invalid/manual',
  source_type: 'manufacturer_manual',
  authority: 'manufacturer_technical',
  publisher: 'Acme',
  retrieved_at: '2026-09-05T12:00:00Z',
};

const measurementFact = (raw_value: ProductFact['raw_value'], raw_unit: string): ProductFact => ({
  schema_version: '1.0',
  id: 'acme.fact.measurement',
  source_id: source.id,
  field: 'weight_kg',
  raw_label: 'Weight',
  raw_value,
  raw_unit,
  extraction_method: 'table',
  fact_state: 'provisional',
});

const factFor = (
  raw_value: ProductFact['raw_value'],
  raw_unit: string,
  field = 'weight_kg',
): ProductFact => ({
  ...measurementFact(raw_value, raw_unit),
  field,
  raw_label: field === 'electrical.nominal_voltage_v' ? 'Nominal voltage' : 'Weight',
});

describe('explicit unit conversion', () => {
  it.each([
    ['in', 1, 'mm', 25.4],
    ['ft', 1, 'mm', 304.8],
    ['mm', 25.4, 'in', 1],
    ['lb', 1, 'kg', 0.45359237],
    ['oz', 16, 'lb', 1],
  ])('%s to %s uses the exact conversion', (from, value, to, expected) => {
    expect(convertUnit(value, from, to)).toBe(expected);
  });

  it('rejects incompatible, unsupported, and unitless conversions', () => {
    expect(() => convertUnit(1, 'kg', 'mm')).toThrow(/dimension/i);
    expect(() => convertUnit(1, 'stone', 'kg')).toThrow(/unsupported/i);
    expect(() => convertUnit(1, undefined, 'kg')).toThrow(/unit/i);
  });
});

describe('source-aware presentation', () => {
  it.each([
    [{ value: 13, unit: 'kg', dimension: 'mass' }],
    [{ value: 50.8, unit: 'mm', dimension: 'length' }],
  ])('accepts a valid normalized %s measurement', (normalized) => {
    const fact =
      normalized.dimension === 'length' ? measurementFact(2, 'in') : measurementFact(13, 'kg');
    expect(buildSourceAwareMeasurement(fact, normalized, source).normalized).toMatchObject({
      value: normalized.value,
      unit: normalized.unit,
    });
  });

  it('rejects a normalized unit whose registry dimension disagrees', () => {
    expect(() =>
      buildSourceAwareMeasurement(
        measurementFact(13, 'kg'),
        { value: 13, unit: 'mm', dimension: 'mass' },
        source,
      ),
    ).toThrow(/normalized unit.*dimension/i);
  });

  it('rejects an unsupported normalized unit', () => {
    expect(() =>
      buildSourceAwareMeasurement(
        measurementFact(13, 'kg'),
        { value: 13, unit: 'stone', dimension: 'mass' },
        source,
      ),
    ).toThrow(/normalized unit/i);
  });

  it('rejects source and normalized dimension mismatches', () => {
    expect(() =>
      buildSourceAwareMeasurement(
        measurementFact(12, 'V'),
        { value: 12, unit: 'kg', dimension: 'mass' },
        source,
      ),
    ).toThrow(/source unit/i);
  });

  it('preserves source inches while exposing normalized millimeters', () => {
    const result = buildSourceAwareMeasurement(
      measurementFact('2 in', 'in'),
      { value: 50.8, unit: 'mm', dimension: 'length' },
      source,
    );
    expect(result).toMatchObject({
      source: { value: 2, unit: 'in', basis: 'source' },
      normalized: { value: 50.8, unit: 'mm', basis: 'normalized' },
    });
  });

  it('preserves source pounds while exposing normalized kilograms', () => {
    const result = buildSourceAwareMeasurement(
      measurementFact(29, 'lb'),
      { value: 13.15417873, unit: 'kg', dimension: 'mass' },
      source,
    );
    expect(result.source).toMatchObject({ value: 29, unit: 'lb', basis: 'source' });
    expect(result.normalized).toMatchObject({
      value: 13.15417873,
      unit: 'kg',
      basis: 'normalized',
    });
  });

  it.each(['source', 'metric', 'imperial'] as const)('supports %s mode', (mode) => {
    const measurement = buildSourceAwareMeasurement(
      measurementFact(29, 'lb'),
      { value: 13.15417873, unit: 'kg', dimension: 'mass' },
      source,
    );
    const result = presentMeasurement(measurement, mode);
    expect(result.source).toMatchObject({ value: 29, unit: 'lb', basis: 'source' });
    expect(result.normalized).toMatchObject({ value: 13.15417873, unit: 'kg' });
    expect(result.primary.basis).toBe(mode === 'metric' ? 'derived_display' : 'source');
  });

  it('rounds only derived display output and avoids a redundant companion', () => {
    const measurement = buildSourceAwareMeasurement(
      measurementFact(13, 'kg'),
      { value: 13, unit: 'kg', dimension: 'mass' },
      source,
    );
    const metric = presentMeasurement(measurement, 'metric');
    expect(metric.primary).toMatchObject({ value: 13, unit: 'kg', basis: 'source' });
    expect(metric.secondary).toBeUndefined();
    expect(measurement.normalized.value).toBe(13);
  });

  it('does not mutate the measurement or canonical-shaped input when mode changes', () => {
    const measurement = buildSourceAwareMeasurement(
      measurementFact(29, 'lb'),
      { value: 13.15417873, unit: 'kg', dimension: 'mass' },
      source,
    );
    const before = JSON.stringify(measurement);
    const canonical = { weight_kg: measurement.normalized.value };
    const canonicalBefore = JSON.stringify(canonical);
    const snapshotBefore = canonicalSerializedSnapshot(canonical);
    presentMeasurement(measurement, 'metric');
    presentMeasurement(measurement, 'imperial');
    expect(JSON.stringify(measurement)).toBe(before);
    expect(JSON.stringify(canonical)).toBe(canonicalBefore);
    expect(canonicalSerializedSnapshot(canonical)).toBe(snapshotBefore);
  });

  it.each(['source', 'metric', 'imperial'] as const)(
    'keeps electrical measurements source-only in %s mode',
    (mode) => {
      const measurement = buildSourceAwareMeasurement(
        factFor(12, 'V', 'electrical.nominal_voltage_v'),
        { value: 12, unit: 'V', dimension: 'voltage' },
        source,
      );
      const result = presentMeasurement(measurement, mode);
      expect(result.primary).toMatchObject({ value: 12, unit: 'V', basis: 'source' });
      expect(result.source).toMatchObject({ value: 12, unit: 'V', basis: 'source' });
      expect(result.secondary).toBeUndefined();
    },
  );
});
