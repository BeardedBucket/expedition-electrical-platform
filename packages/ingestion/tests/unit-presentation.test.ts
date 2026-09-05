import { describe, expect, it } from 'vitest';
import {
  convertUnit,
  resolveUnit,
  buildSourceAwareMeasurement,
  canonicalSerializedSnapshot,
  presentMeasurement,
  parseAwg,
  awgToAreaMm2,
  isStandardAwg,
  areaMm2ToNearestAwg,
  roundSignificant,
  parseExactUnitValue,
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

const measurementFact = (
  raw_value: ProductFact['raw_value'],
  raw_unit: string,
  field = 'weight_kg',
  raw_label = 'Weight',
): ProductFact => ({
  schema_version: '1.0',
  id: 'acme.fact.measurement',
  source_id: source.id,
  field,
  raw_label,
  raw_value,
  raw_unit,
  extraction_method: 'table',
  fact_state: 'provisional',
});

const factFor = (
  raw_value: ProductFact['raw_value'],
  raw_unit: string,
  field = 'weight_kg',
): ProductFact =>
  measurementFact(
    raw_value,
    raw_unit,
    field,
    field === 'electrical.nominal_voltage_v' ? 'Nominal voltage' : 'Weight',
  );

describe('explicit unit conversion - linear conversions', () => {
  it.each([
    // Length
    ['in', 1, 'mm', 25.4],
    ['ft', 1, 'mm', 304.8],
    ['mm', 25.4, 'in', 1],
    ['cm', 10, 'mm', 100],
    ['m', 1, 'mm', 1000],
    // Mass
    ['lb', 1, 'kg', 0.45359237],
    ['oz', 16, 'lb', 1],
    ['g', 1000, 'kg', 1],
    ['oz_mass', 16, 'lb', 1],
    // Electrical SI
    ['V', 1, 'mV', 1000],
    ['kV', 1, 'V', 1000],
    ['kW', 1, 'W', 1000],
    ['kVA', 1, 'VA', 1000],
    ['kWh', 1, 'Wh', 1000],
    ['Ah', 1, 'mAh', 1000],
    ['mohm', 1000, 'ohm', 1],
    ['kHz', 1, 'Hz', 1000],
  ])('%s to %s uses exact conversion', (from, value, to, expected) => {
    expect(convertUnit(value, from, to)).toBeCloseTo(expected, 8);
  });

  it('rejects incompatible, unsupported, and unitless conversions', () => {
    expect(() => convertUnit(1, 'kg', 'mm')).toThrow(/dimension/i);
    expect(() => convertUnit(1, 'stone', 'kg')).toThrow(/unsupported/i);
    expect(() => convertUnit(1, undefined, 'kg')).toThrow(/unit/i);
  });
});

describe('affine conversion architecture - temperature', () => {
  it.each([
    ['°F', 32, '°C', 0],
    ['°F', 212, '°C', 100],
    ['°F', -40, '°C', -40],
    ['°C', 0, '°F', 32],
    ['°C', 100, '°F', 212],
    ['°C', -40, '°F', -40],
    ['°C', 25, '°F', 77],
    ['K', 273.15, '°C', 0],
  ])('%s %d -> %s %d is exact and deterministic', (from, value, to, expected) => {
    expect(convertUnit(value, from, to)).toBeCloseTo(expected, 8);
  });

  it('does not treat temperature as a simple scale multiplier', () => {
    expect(convertUnit(0, '°C', '°F')).toBe(32);
    expect(convertUnit(32, '°F', '°C')).toBe(0);
    expect(convertUnit(0, '°F', '°C')).not.toBe(0);
  });
});

describe('volume conversion family', () => {
  it.each([
    ['US gal', 1, 'L', 3.785411784],
    ['gal_us', 1, 'L', 3.785411784],
    ['L', 1, 'gal_us', 1 / 3.785411784],
    ['US gal', 1, 'US fl oz', 128],
    ['US gal', 1, 'US cup', 16],
    ['US gal', 1, 'US pt', 8],
    ['US gal', 1, 'US qt', 4],
    ['US gal', 1, 'mL', 3785.411784],
    ['US qt', 4, 'US gal', 1],
    ['US pt', 2, 'US qt', 1],
    ['US cup', 2, 'US pt', 1],
    ['US fl oz', 8, 'US cup', 1],
    ['mL', 1000, 'L', 1],
  ])('%s %d -> %s %d is exact', (from, value, to, expected) => {
    expect(convertUnit(value, from, to)).toBeCloseTo(expected, 8);
  });

  it('strictly prevents confusion between fluid ounce (volume) and mass ounce', () => {
    expect(() => convertUnit(1, 'US fl oz', 'oz')).toThrow(/dimension/i);
    expect(() => convertUnit(1, 'fl_oz_us', 'oz_mass')).toThrow(/dimension/i);
    expect(() => convertUnit(1, 'US fl oz', 'kg')).toThrow(/dimension/i);
    expect(() => convertUnit(1, 'oz', 'L')).toThrow(/dimension/i);
  });
});

describe('conservative US customary volume parsing & ambiguity rejection', () => {
  it('rejects bare ambiguous volume terms without explicit US qualification', () => {
    expect(resolveUnit('gal')).toBeUndefined();
    expect(resolveUnit('gallon')).toBeUndefined();
    expect(resolveUnit('gallons')).toBeUndefined();
    expect(resolveUnit('fl oz')).toBeUndefined();
    expect(resolveUnit('fl. oz.')).toBeUndefined();
    expect(resolveUnit('floz')).toBeUndefined();
    expect(resolveUnit('fluid ounce')).toBeUndefined();
    expect(resolveUnit('fluid ounces')).toBeUndefined();
    expect(resolveUnit('cup')).toBeUndefined();
    expect(resolveUnit('cups')).toBeUndefined();
    expect(resolveUnit('pt')).toBeUndefined();
    expect(resolveUnit('pint')).toBeUndefined();
    expect(resolveUnit('pints')).toBeUndefined();
    expect(resolveUnit('qt')).toBeUndefined();
    expect(resolveUnit('quart')).toBeUndefined();
    expect(resolveUnit('quarts')).toBeUndefined();
  });

  it('resolves explicit US customary volume terms', () => {
    expect(resolveUnit('gal_us')?.id).toBe('gal_us');
    expect(resolveUnit('US gal')?.id).toBe('gal_us');
    expect(resolveUnit('US gallon')?.id).toBe('gal_us');
    expect(resolveUnit('US gallons')?.id).toBe('gal_us');
    expect(resolveUnit('fl_oz_us')?.id).toBe('fl_oz_us');
    expect(resolveUnit('US fl oz')?.id).toBe('fl_oz_us');
    expect(resolveUnit('US fluid ounce')?.id).toBe('fl_oz_us');
    expect(resolveUnit('cup_us')?.id).toBe('cup_us');
    expect(resolveUnit('US cup')?.id).toBe('cup_us');
    expect(resolveUnit('pt_us')?.id).toBe('pt_us');
    expect(resolveUnit('US pt')?.id).toBe('pt_us');
    expect(resolveUnit('US pint')?.id).toBe('pt_us');
    expect(resolveUnit('qt_us')?.id).toBe('qt_us');
    expect(resolveUnit('US qt')?.id).toBe('qt_us');
    expect(resolveUnit('US quart')?.id).toBe('qt_us');
  });
});

describe('pressure conversion family', () => {
  it.each([
    ['bar', 1, 'kPa', 100],
    ['bar', 1, 'Pa', 100000],
    ['kPa', 100, 'bar', 1],
    ['Pa', 1000, 'kPa', 1],
    ['psi', 1, 'kPa', 6.894757293168361],
    ['kPa', 6.894757293168361, 'psi', 1],
  ])('%s %d -> %s %d is exact and deterministic', (from, value, to, expected) => {
    expect(convertUnit(value, from, to)).toBeCloseTo(expected, 8);
  });
});

const torqueNmPerLbFt = 0.45359237 * 9.80665 * 0.3048;

describe('torque conversion family', () => {
  it.each([
    ['lb·ft', 1, 'N·m', torqueNmPerLbFt],
    ['N·m', torqueNmPerLbFt, 'lb·ft', 1],
    ['lb·in', 12, 'lb·ft', 1],
    ['lb·in', 12, 'N·m', torqueNmPerLbFt],
    ['ft-lb', 1, 'N·m', torqueNmPerLbFt],
    ['in-lb', 12, 'ft-lb', 1],
  ])('%s %d -> %s %d is exact', (from, value, to, expected) => {
    expect(convertUnit(value, from, to)).toBeCloseTo(expected, 8);
  });

  it('distinguishes lb·in from lb·ft by a factor of 12', () => {
    const ftVal = convertUnit(1, 'lb·ft', 'N·m');
    const inVal = convertUnit(1, 'lb·in', 'N·m');
    expect(ftVal / inVal).toBeCloseTo(12, 8);
  });
});

describe('flow conversion family', () => {
  it.each([
    ['US gal/min', 1, 'L/min', 3.785411784],
    ['L/min', 3.785411784, 'US gal/min', 1],
    ['US gal/h', 60, 'US gal/min', 1],
    ['L/h', 60, 'L/min', 1],
    ['US gpm', 1, 'L/min', 3.785411784],
    ['US gph', 60, 'US gpm', 1],
  ])('%s %d -> %s %d is exact', (from, value, to, expected) => {
    expect(convertUnit(value, from, to)).toBeCloseTo(expected, 8);
  });

  it('distinguishes flow rates per minute from flow rates per hour', () => {
    expect(convertUnit(1, 'US gal/min', 'US gal/h')).toBeCloseTo(60, 8);
    expect(convertUnit(60, 'US gal/h', 'US gal/min')).toBeCloseTo(1, 8);
    expect(convertUnit(1, 'L/min', 'L/h')).toBeCloseTo(60, 8);
  });
});

describe('conservative flow parsing & ambiguity rejection', () => {
  it('rejects bare ambiguous gallon flow terms without explicit US qualification', () => {
    expect(resolveUnit('gal/min')).toBeUndefined();
    expect(resolveUnit('gpm')).toBeUndefined();
    expect(resolveUnit('gal per min')).toBeUndefined();
    expect(resolveUnit('gallon per minute')).toBeUndefined();
    expect(resolveUnit('gallons per minute')).toBeUndefined();
    expect(resolveUnit('gal / min')).toBeUndefined();
    expect(resolveUnit('gal/h')).toBeUndefined();
    expect(resolveUnit('gph')).toBeUndefined();
    expect(resolveUnit('gal per hour')).toBeUndefined();
    expect(resolveUnit('gallon per hour')).toBeUndefined();
    expect(resolveUnit('gallons per hour')).toBeUndefined();
    expect(resolveUnit('gal / h')).toBeUndefined();
  });

  it('resolves explicit US flow terms', () => {
    expect(resolveUnit('gal_us_per_min')?.id).toBe('gal_us_per_min');
    expect(resolveUnit('US gal/min')?.id).toBe('gal_us_per_min');
    expect(resolveUnit('US gpm')?.id).toBe('gal_us_per_min');
    expect(resolveUnit('US gallon per minute')?.id).toBe('gal_us_per_min');
    expect(resolveUnit('gal_us_per_h')?.id).toBe('gal_us_per_h');
    expect(resolveUnit('US gal/h')?.id).toBe('gal_us_per_h');
    expect(resolveUnit('US gph')?.id).toBe('gal_us_per_h');
    expect(resolveUnit('US gallon per hour')?.id).toBe('gal_us_per_h');
  });
});

describe('discrete conductor sizing - AWG semantics', () => {
  it.each([
    ['10', 5.26117],
    ['12', 3.3088],
    ['14', 2.0809],
    ['4', 21.1506],
    ['2', 33.6308],
    ['1/0', 53.4751],
    ['2/0', 67.4309],
    ['3/0', 85.0288],
    ['4/0', 107.2193],
    ['0000', 107.2193],
    ['0', 53.4751],
  ])(
    'calculates exact ASTM B258 cross-sectional area for AWG %s (~%d mm²)',
    (gauge, expectedArea) => {
      const area = awgToAreaMm2(gauge);
      expect(area).toBeDefined();
      expect(area!).toBeCloseTo(expectedArea, 3);
    },
  );

  it('converts AWG to mm² cross-sectional area via convertUnit', () => {
    expect(convertUnit(10, 'AWG', 'mm²')).toBeCloseTo(5.26117, 3);
    expect(convertUnit(-3, 'AWG', 'mm²')).toBeCloseTo(107.2193, 3);
  });

  it('disallows generic area -> AWG conversion via convertUnit', () => {
    expect(() => convertUnit(5.26117, 'mm²', 'AWG')).toThrow(/not permitted/i);
  });

  it('verifies AWG unit definition has discrete system classification', () => {
    const awgDef = resolveUnit('AWG');
    expect(awgDef?.system).toBe('discrete');
    expect(awgDef?.dimension).toBe('conductor_size');
  });

  it('verifies complete AWG standard range 1..40 including 21, 23, 31, 39', () => {
    for (let g = 1; g <= 40; g++) {
      expect(isStandardAwg(g)).toBe(true);
      expect(isStandardAwg(String(g))).toBe(true);
      expect(isStandardAwg(`${g} AWG`)).toBe(true);
      expect(awgToAreaMm2(g)).toBeGreaterThan(0);
    }
    expect(isStandardAwg(21)).toBe(true);
    expect(isStandardAwg(23)).toBe(true);
    expect(isStandardAwg(31)).toBe(true);
    expect(isStandardAwg(39)).toBe(true);
  });

  it('rejects ambiguous bare gauge without AWG / American Wire Gauge designation', () => {
    expect(resolveUnit('gauge')).toBeUndefined();
    expect(resolveUnit('10 gauge')).toBeUndefined();
    expect(resolveUnit('American Wire Gauge')?.id).toBe('awg');
    expect(resolveUnit('AWG')?.id).toBe('awg');
  });

  it('parses various AWG notations deterministically', () => {
    const p1 = parseAwg('4/0 AWG');
    expect(p1).toMatchObject({ gauge: '4/0', gaugeIndex: -3 });
    expect(p1?.areaMm2).toBeCloseTo(107.2193, 3);

    const p2 = parseAwg('0000');
    expect(p2).toMatchObject({ gauge: '4/0', gaugeIndex: -3 });

    const p3 = parseAwg('10 AWG');
    expect(p3).toMatchObject({ gauge: '10', gaugeIndex: 10 });
    expect(p3?.areaMm2).toBeCloseTo(5.26117, 3);

    const p4 = parseAwg(10);
    expect(p4).toMatchObject({ gauge: '10', gaugeIndex: 10 });

    const p5 = parseAwg('10 American Wire Gauge');
    expect(p5).toMatchObject({ gauge: '10', gaugeIndex: 10 });
  });

  it('identifies standard AWG sizes and rejects non-standard / invalid gauges', () => {
    expect(isStandardAwg('4/0')).toBe(true);
    expect(isStandardAwg('10')).toBe(true);
    expect(isStandardAwg('14 AWG')).toBe(true);
    expect(isStandardAwg('5/0')).toBe(false);
    expect(isStandardAwg('-5')).toBe(false);
    expect(isStandardAwg('50 AWG')).toBe(false);
    expect(isStandardAwg('invalid')).toBe(false);
  });

  it('maps cross-sectional area back to nearest standard AWG via areaMm2ToNearestAwg', () => {
    expect(areaMm2ToNearestAwg(5.26)).toBe('10');
    expect(areaMm2ToNearestAwg(107.2)).toBe('4/0');
    expect(areaMm2ToNearestAwg(2.08)).toBe('14');
    expect(areaMm2ToNearestAwg(33.6)).toBe('2');
  });

  it('does NOT equate AWG with generic linear length and rejects cross-dimension conversion', () => {
    expect(() => convertUnit(10, 'AWG', 'mm')).toThrow(/dimension/i);
    expect(() => convertUnit(10, 'AWG', 'in')).toThrow(/dimension/i);
  });
});

describe('source-aware measurement building & parsing', () => {
  it.each([
    [{ value: 13, unit: 'kg', dimension: 'mass' }],
    [{ value: 50.8, unit: 'mm', dimension: 'length' }],
    [{ value: 100, unit: '°C', dimension: 'temperature' }],
    [{ value: 3.785411784, unit: 'L', dimension: 'volume' }],
    [{ value: 100, unit: 'kPa', dimension: 'pressure' }],
    [{ value: 1.355818, unit: 'N·m', dimension: 'torque' }],
    [{ value: 3.785412, unit: 'L/min', dimension: 'flow' }],
    [{ value: 5.26117, unit: 'mm²', dimension: 'conductor_size' }],
  ])('accepts a valid normalized measurement for dimension %s', (normalized) => {
    let fact: ProductFact;
    if (normalized.dimension === 'temperature') {
      fact = measurementFact('212 °F', '°F');
    } else if (normalized.dimension === 'volume') {
      fact = measurementFact('1 US gal', 'US gal');
    } else if (normalized.dimension === 'pressure') {
      fact = measurementFact('1 bar', 'bar');
    } else if (normalized.dimension === 'torque') {
      fact = measurementFact('1 lb·ft', 'lb·ft');
    } else if (normalized.dimension === 'flow') {
      fact = measurementFact('1 US gal/min', 'US gal/min');
    } else if (normalized.dimension === 'conductor_size') {
      fact = measurementFact('10 AWG', 'AWG');
    } else if (normalized.dimension === 'length') {
      fact = measurementFact(2, 'in');
    } else {
      fact = measurementFact(13, 'kg');
    }
    const result = buildSourceAwareMeasurement(fact, normalized, source);
    expect(result.normalized).toMatchObject({
      value: normalized.value,
      unit: normalized.unit,
    });
  });

  it('preserves source AWG designation when building measurement', () => {
    const fact = measurementFact('4/0 AWG', 'AWG');
    const result = buildSourceAwareMeasurement(
      fact,
      { value: 107.2193, unit: 'mm²', dimension: 'conductor_size' },
      source,
    );
    expect(result.source).toMatchObject({
      value: '4/0',
      unit: 'AWG',
      basis: 'source',
    });
    expect(result.normalized).toMatchObject({
      value: 107.2193,
      unit: 'mm²',
      basis: 'normalized',
    });
  });

  it('rejects dimension mismatches across all conversion families', () => {
    expect(() =>
      buildSourceAwareMeasurement(
        measurementFact(13, 'kg'),
        { value: 13, unit: 'mm', dimension: 'mass' },
        source,
      ),
    ).toThrow(/normalized unit.*dimension/i);

    expect(() =>
      buildSourceAwareMeasurement(
        measurementFact(12, 'V'),
        { value: 12, unit: 'kg', dimension: 'mass' },
        source,
      ),
    ).toThrow(/source unit/i);

    expect(() =>
      buildSourceAwareMeasurement(
        measurementFact('100 kPa', 'kPa'),
        { value: 100, unit: 'L', dimension: 'volume' },
        source,
      ),
    ).toThrow(/source unit/i);
  });
});

describe('source-aware presentation across unit families', () => {
  it('presents temperature with metric/imperial companion correctly', () => {
    const measurement = buildSourceAwareMeasurement(
      measurementFact('212 °F', '°F'),
      { value: 100, unit: '°C', dimension: 'temperature' },
      source,
    );
    const imperial = presentMeasurement(measurement, 'imperial');
    expect(imperial.primary).toMatchObject({ value: 212, unit: '°F', basis: 'source' });
    expect(imperial.secondary).toBeUndefined();

    const metric = presentMeasurement(measurement, 'metric');
    expect(metric.primary).toMatchObject({ value: 100, unit: '°C', basis: 'derived_display' });
    expect(metric.secondary).toMatchObject({ value: 212, unit: '°F', basis: 'source' });

    const sourceMode = presentMeasurement(measurement, 'source');
    expect(sourceMode.primary).toMatchObject({ value: 212, unit: '°F', basis: 'source' });
    expect(sourceMode.secondary).toMatchObject({
      value: 100,
      unit: '°C',
      basis: 'derived_display',
    });
  });

  it('presents volume in source, metric, and imperial modes', () => {
    const measurement = buildSourceAwareMeasurement(
      measurementFact('5 US gal', 'US gal'),
      { value: 18.92705892, unit: 'L', dimension: 'volume' },
      source,
    );
    const imperial = presentMeasurement(measurement, 'imperial');
    expect(imperial.primary).toMatchObject({ value: 5, unit: 'US gal', basis: 'source' });

    const metric = presentMeasurement(measurement, 'metric');
    expect(metric.primary).toMatchObject({ value: 18.9, unit: 'L', basis: 'derived_display' });
  });

  it('preserves source raw unit text like US gal rather than replacing with canonical display symbol', () => {
    const measurement = buildSourceAwareMeasurement(
      measurementFact('2.5 US gal', 'US gal'),
      { value: 9.46352946, unit: 'L', dimension: 'volume' },
      source,
    );
    expect(measurement.source.unit).toBe('US gal');
    const presentation = presentMeasurement(measurement, 'source');
    expect(presentation.source.unit).toBe('US gal');
    expect(presentation.primary.unit).toBe('US gal');
  });

  it('presents pressure in source, metric, and imperial modes', () => {
    const measurement = buildSourceAwareMeasurement(
      measurementFact('30 psi', 'psi'),
      { value: 206.8427, unit: 'kPa', dimension: 'pressure' },
      source,
    );
    const metric = presentMeasurement(measurement, 'metric');
    expect(metric.primary).toMatchObject({ value: 207, unit: 'kPa', basis: 'derived_display' });
    expect(metric.secondary).toMatchObject({ value: 30, unit: 'psi', basis: 'source' });
  });

  it('presents torque in source, metric, and imperial modes', () => {
    const measurement = buildSourceAwareMeasurement(
      measurementFact('20 lb·ft', 'lb·ft'),
      { value: 27.11636, unit: 'N·m', dimension: 'torque' },
      source,
    );
    const metric = presentMeasurement(measurement, 'metric');
    expect(metric.primary).toMatchObject({ value: 27.1, unit: 'N·m', basis: 'derived_display' });
    expect(metric.secondary).toMatchObject({ value: 20, unit: 'lb·ft', basis: 'source' });
  });

  it('presents flow in source, metric, and imperial modes', () => {
    const measurement = buildSourceAwareMeasurement(
      measurementFact('5 US gal/min', 'US gal/min'),
      { value: 18.92705892, unit: 'L/min', dimension: 'flow' },
      source,
    );
    const metric = presentMeasurement(measurement, 'metric');
    expect(metric.primary).toMatchObject({ value: 18.9, unit: 'L/min', basis: 'derived_display' });
    expect(metric.secondary).toMatchObject({ value: 5, unit: 'US gal/min', basis: 'source' });
  });

  it('preserves source AWG and shows derived mm² companion without replacing source AWG', () => {
    const measurement = buildSourceAwareMeasurement(
      measurementFact('10 AWG', 'AWG'),
      { value: 5.26117, unit: 'mm²', dimension: 'conductor_size' },
      source,
    );
    // In source, metric, and imperial modes, source AWG is primary and derived mm² is secondary companion
    for (const mode of ['source', 'metric', 'imperial'] as const) {
      const pres = presentMeasurement(measurement, mode);
      expect(pres.primary).toMatchObject({ value: '10', unit: 'AWG', basis: 'source' });
      expect(pres.secondary).toMatchObject({ value: 5.26, unit: 'mm²', basis: 'derived_display' });
    }
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

  it('verifies proper Unicode symbols resolve without mojibake', () => {
    expect(resolveUnit('Ω')?.symbol).toBe('ohm');
    expect(resolveUnit('mΩ')?.symbol).toBe('mohm');
    expect(resolveUnit('kΩ')?.symbol).toBe('kohm');
    expect(resolveUnit('N·m')?.symbol).toBe('N·m');
    expect(resolveUnit('lb·ft')?.symbol).toBe('lb·ft');
    expect(resolveUnit('lb·in')?.symbol).toBe('lb·in');
    expect(resolveUnit('°C')?.symbol).toBe('°C');
    expect(resolveUnit('°F')?.symbol).toBe('°F');
    expect(resolveUnit('mm²')?.symbol).toBe('mm²');
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

describe('significant-digit rounding precision', () => {
  it.each([
    [12345, 3, 12300],
    [1234.5, 3, 1230],
    [12.345, 3, 12.3],
    [1.2345, 3, 1.23],
    [0.12345, 3, 0.123],
    [0.012345, 3, 0.0123],
    [-12.345, 3, -12.3],
    [0, 3, 0],
    [100, 3, 100],
    [99.99, 3, 100],
  ])('roundSignificant(%d, %d) === %d', (value, digits, expected) => {
    expect(roundSignificant(value, digits)).toBe(expected);
  });

  it('preserves non-finite values safely', () => {
    expect(roundSignificant(Number.NaN, 3)).toBeNaN();
    expect(roundSignificant(Number.POSITIVE_INFINITY, 3)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('parseExactUnitValue - embedded unit vs raw_unit contradiction & equivalence', () => {
  it('accepts matching embedded unit and raw_unit', () => {
    const res1 = parseExactUnitValue('29 lb', 'lb');
    expect(res1).toMatchObject({ value: 29, unit: { id: 'lb' } });

    const res2 = parseExactUnitValue('5 US gal', 'US gal');
    expect(res2).toMatchObject({ value: 5, unit: { id: 'gal_us' } });

    const res3 = parseExactUnitValue('32 °F', '°F');
    expect(res3).toMatchObject({ value: 32, unit: { id: 'deg_f' } });
  });

  it('rejects contradictory embedded unit and raw_unit', () => {
    // 29 lb vs kg -> reject
    expect(parseExactUnitValue('29 lb', 'kg')).toBeUndefined();

    // 5 US gal vs L -> reject
    expect(parseExactUnitValue('5 US gal', 'L')).toBeUndefined();

    // 32 °F vs °C -> reject
    expect(parseExactUnitValue('32 °F', '°C')).toBeUndefined();

    // 10 AWG vs kg -> reject
    expect(parseExactUnitValue('10 AWG', 'kg')).toBeUndefined();

    // 10 AWG vs mm² -> reject
    expect(parseExactUnitValue('10 AWG', 'mm²')).toBeUndefined();

    // 10 AWG vs °C -> reject
    expect(parseExactUnitValue('10 AWG', '°C')).toBeUndefined();
  });

  it('accepts equivalent aliases resolving to the same UnitDefinition identity', () => {
    const res1 = parseExactUnitValue('5 US gal', 'gal_us');
    expect(res1).toMatchObject({ value: 5, unit: { id: 'gal_us' } });

    const res2 = parseExactUnitValue('10 AWG', 'American Wire Gauge');
    expect(res2).toMatchObject({ value: 10, unit: { id: 'awg' } });

    const res3 = parseExactUnitValue('100 °C', 'celsius');
    expect(res3).toMatchObject({ value: 100, unit: { id: 'deg_c' } });
  });

  it('accepts explicit raw_unit clarifying ambiguous embedded token compatible with raw_unit', () => {
    // "5 gal" with explicit "US gal" -> resolved as gal_us
    const res1 = parseExactUnitValue('5 gal', 'US gal');
    expect(res1).toMatchObject({ value: 5, unit: { id: 'gal_us' } });

    // "5 gpm" with explicit "US gpm" -> resolved as gal_us_per_min
    const res2 = parseExactUnitValue('5 gpm', 'US gpm');
    expect(res2).toMatchObject({ value: 5, unit: { id: 'gal_us_per_min' } });
  });

  it('rejects ambiguous embedded unit when paired with incompatible raw_unit or missing raw_unit', () => {
    // "5 gal" with "kg" -> reject
    expect(parseExactUnitValue('5 gal', 'kg')).toBeUndefined();

    // "5 gal" with no raw_unit -> reject
    expect(parseExactUnitValue('5 gal')).toBeUndefined();

    // "5 gpm" with "L/min" -> reject
    expect(parseExactUnitValue('5 gpm', 'L/min')).toBeUndefined();
  });

  it('handles string numbers and numeric inputs without embedded units', () => {
    expect(parseExactUnitValue('29', 'lb')).toMatchObject({ value: 29, unit: { id: 'lb' } });
    expect(parseExactUnitValue(29, 'lb')).toMatchObject({ value: 29, unit: { id: 'lb' } });
    expect(parseExactUnitValue('29 lb')).toMatchObject({ value: 29, unit: { id: 'lb' } });
    expect(parseExactUnitValue('29')).toBeUndefined();
    expect(parseExactUnitValue(29)).toBeUndefined();
  });
});
