import type { JsonValue } from './contracts.js';
import { awgIndexToAreaMm2, parseAwg } from './conductor-size.js';

export type UnitSystem = 'metric' | 'imperial' | 'customary' | 'discrete' | 'si';

export interface UnitDefinition {
  readonly id: string;
  readonly symbol: string;
  readonly dimension: string;
  readonly aliases: readonly string[];
  readonly toCanonical: (value: number) => number;
  readonly fromCanonical: (value: number) => number;
  readonly system?: UnitSystem;
}

const linear = (
  id: string,
  symbol: string,
  dimension: string,
  aliases: readonly string[],
  factor: number,
  system?: UnitSystem,
): UnitDefinition => ({
  id,
  symbol,
  dimension,
  aliases,
  toCanonical: (value) => value * factor,
  fromCanonical: (value) => value / factor,
  system,
});

const affine = (
  id: string,
  symbol: string,
  dimension: string,
  aliases: readonly string[],
  toCanonical: (value: number) => number,
  fromCanonical: (value: number) => number,
  system?: UnitSystem,
): UnitDefinition => ({
  id,
  symbol,
  dimension,
  aliases,
  toCanonical,
  fromCanonical,
  system,
});

const awgUnit: UnitDefinition = {
  id: 'awg',
  symbol: 'AWG',
  dimension: 'conductor_size',
  aliases: ['awg', 'american wire gauge'],
  toCanonical: (gaugeIndex: number) => {
    const area = awgIndexToAreaMm2(gaugeIndex);
    if (!Number.isFinite(area)) {
      throw new Error(`Invalid AWG gauge index: ${gaugeIndex}.`);
    }
    return area;
  },
  fromCanonical: (_areaMm2: number) => {
    throw new Error(
      'Generic area-to-AWG conversion via convertUnit is not permitted. Use areaMm2ToNearestAwg() for discrete nearest AWG derivation.',
    );
  },
  system: 'discrete',
};

const definitions: readonly UnitDefinition[] = [
  // Voltage (V)
  linear('v', 'V', 'voltage', ['v', 'volt', 'volts', 'vac', 'vdc'], 1, 'si'),
  linear('mv', 'mV', 'voltage', ['mv', 'millivolt', 'millivolts'], 0.001, 'si'),
  linear('kv', 'kV', 'voltage', ['kv', 'kilovolt', 'kilovolts'], 1000, 'si'),

  // Current (A)
  linear('a', 'A', 'current', ['a', 'amp', 'amps', 'ampere', 'amperes'], 1, 'si'),
  linear(
    'ma',
    'mA',
    'current',
    ['ma', 'milliamp', 'milliamps', 'milliampere', 'milliamperes'],
    0.001,
    'si',
  ),
  linear('ka', 'kA', 'current', ['ka', 'kiloamp', 'kiloamps'], 1000, 'si'),

  // Power (W)
  linear('w', 'W', 'power', ['w', 'watt', 'watts'], 1, 'si'),
  linear('mw', 'mW', 'power', ['mw', 'milliwatt', 'milliwatts'], 0.001, 'si'),
  linear('kw', 'kW', 'power', ['kw', 'kilowatt', 'kilowatts'], 1000, 'si'),

  // Apparent power (VA)
  linear('va', 'VA', 'apparent_power', ['va', 'volt-ampere', 'volt-amperes'], 1, 'si'),
  linear(
    'kva',
    'kVA',
    'apparent_power',
    ['kva', 'kilovolt-ampere', 'kilovolt-amperes'],
    1000,
    'si',
  ),

  // Energy (Wh)
  linear('wh', 'Wh', 'energy', ['wh', 'watt-hour', 'watt-hours'], 1, 'si'),
  linear('kwh', 'kWh', 'energy', ['kwh', 'kilowatt-hour', 'kilowatt-hours'], 1000, 'si'),

  // Capacity (Ah)
  linear(
    'ah',
    'Ah',
    'capacity',
    ['ah', 'amp-hour', 'amp-hours', 'ampere-hour', 'ampere-hours'],
    1,
    'si',
  ),
  linear('mah', 'mAh', 'capacity', ['mah', 'milliamp-hour', 'milliamp-hours'], 0.001, 'si'),

  // Resistance (ohm)
  linear('ohm', 'ohm', 'resistance', ['ohm', 'ohms', 'ω', 'Ω'], 1, 'si'),
  linear('mohm', 'mohm', 'resistance', ['mohm', 'mω', 'mΩ', 'milliohm', 'milliohms'], 0.001, 'si'),
  linear('kohm', 'kohm', 'resistance', ['kohm', 'kω', 'kΩ', 'kiloohm', 'kiloohms'], 1000, 'si'),

  // Frequency (Hz)
  linear('hz', 'Hz', 'frequency', ['hz', 'hertz'], 1, 'si'),
  linear('khz', 'kHz', 'frequency', ['khz', 'kilohertz'], 1000, 'si'),

  // Mass (kg)
  linear('kg', 'kg', 'mass', ['kg', 'kilogram', 'kilograms'], 1, 'metric'),
  linear('g', 'g', 'mass', ['g', 'gram', 'grams'], 0.001, 'metric'),
  linear(
    'oz_mass',
    'oz',
    'mass',
    ['oz', 'oz_mass', 'ounce', 'ounces', 'oz mass'],
    0.45359237 / 16,
    'imperial',
  ),
  linear('lb', 'lb', 'mass', ['lb', 'lbs', 'pound', 'pounds', 'lb_mass'], 0.45359237, 'imperial'),

  // Length (mm)
  linear('mm', 'mm', 'length', ['mm', 'millimeter', 'millimeters'], 1, 'metric'),
  linear('cm', 'cm', 'length', ['cm', 'centimeter', 'centimeters'], 10, 'metric'),
  linear('m', 'm', 'length', ['m', 'meter', 'meters', 'metre', 'metres'], 1000, 'metric'),
  linear('in', 'in', 'length', ['in', 'inch', 'inches', '"'], 25.4, 'imperial'),
  linear('ft', 'ft', 'length', ['ft', 'foot', 'feet', "'"], 304.8, 'imperial'),

  // Volume (L) - US liquid volume
  linear('l', 'L', 'volume', ['l', 'liter', 'liters', 'litre', 'litres'], 1, 'metric'),
  linear(
    'ml',
    'mL',
    'volume',
    ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
    0.001,
    'metric',
  ),
  linear(
    'fl_oz_us',
    'fl oz',
    'volume',
    [
      'fl_oz_us',
      'us fl oz',
      'us fl. oz.',
      'us fl_oz',
      'us floz',
      'us fluid ounce',
      'us fluid ounces',
    ],
    0.0295735295625,
    'imperial',
  ),
  linear('cup_us', 'cup', 'volume', ['cup_us', 'us cup', 'us cups'], 0.2365882365, 'imperial'),
  linear(
    'pt_us',
    'pt',
    'volume',
    ['pt_us', 'us pt', 'us pint', 'us pints'],
    0.473176473,
    'imperial',
  ),
  linear(
    'qt_us',
    'qt',
    'volume',
    ['qt_us', 'us qt', 'us quart', 'us quarts'],
    0.946352946,
    'imperial',
  ),
  linear(
    'gal_us',
    'gal',
    'volume',
    ['gal_us', 'us gal', 'us gallon', 'us gallons'],
    3.785411784,
    'imperial',
  ),

  // Pressure (kPa)
  linear('kpa', 'kPa', 'pressure', ['kpa', 'kilopascal', 'kilopascals'], 1, 'metric'),
  linear('pa', 'Pa', 'pressure', ['pa', 'pascal', 'pascals'], 0.001, 'metric'),
  linear('bar', 'bar', 'pressure', ['bar', 'bars'], 100, 'metric'),
  linear(
    'psi',
    'psi',
    'pressure',
    ['psi', 'lbf/in2', 'lb/in2', 'lbf/in^2', 'lb/in^2', 'pounds per square inch'],
    6.894757293168361,
    'imperial',
  ),

  // Torque (N·m)
  linear(
    'n_m',
    'N·m',
    'torque',
    [
      'n·m',
      'n-m',
      'n*m',
      'nm',
      'n m',
      'newton meter',
      'newton meters',
      'newton-meter',
      'newton-meters',
      'newton-metre',
      'newton metres',
    ],
    1,
    'metric',
  ),
  linear(
    'lb_ft',
    'lb·ft',
    'torque',
    [
      'lb·ft',
      'lb-ft',
      'lb*ft',
      'lb ft',
      'ft-lb',
      'ft*lb',
      'ft·lb',
      'ft lb',
      'foot-pound',
      'foot pounds',
      'ft-lbs',
      'ft lbs',
    ],
    0.45359237 * 9.80665 * 0.3048,
    'imperial',
  ),
  linear(
    'lb_in',
    'lb·in',
    'torque',
    [
      'lb·in',
      'lb-in',
      'lb*in',
      'lb in',
      'in-lb',
      'in*lb',
      'in·lb',
      'in lb',
      'inch-pound',
      'inch pounds',
      'in-lbs',
      'in lbs',
    ],
    (0.45359237 * 9.80665 * 0.3048) / 12,
    'imperial',
  ),

  // Flow (L/min)
  linear(
    'l_per_min',
    'L/min',
    'flow',
    ['l/min', 'l_per_min', 'lpm', 'liter per minute', 'liters per minute', 'l / min'],
    1,
    'metric',
  ),
  linear(
    'l_per_h',
    'L/h',
    'flow',
    ['l/h', 'l_per_h', 'lph', 'liter per hour', 'liters per hour', 'l / h'],
    1 / 60,
    'metric',
  ),
  linear(
    'gal_us_per_min',
    'gal/min',
    'flow',
    [
      'gal_us_per_min',
      'us gal/min',
      'us gal per min',
      'us gallon per minute',
      'us gallons per minute',
      'us gal / min',
      'us gpm',
    ],
    3.785411784,
    'imperial',
  ),
  linear(
    'gal_us_per_h',
    'gal/h',
    'flow',
    [
      'gal_us_per_h',
      'us gal/h',
      'us gal per hour',
      'us gallon per hour',
      'us gallons per hour',
      'us gal / h',
      'us gph',
    ],
    3.785411784 / 60,
    'imperial',
  ),

  // Temperature (°C) - Affine
  affine(
    'deg_c',
    '°C',
    'temperature',
    ['c', '°c', 'degc', 'deg c', 'deg_c', 'celsius', 'centigrade'],
    (value) => value,
    (value) => value,
    'metric',
  ),
  affine(
    'deg_f',
    '°F',
    'temperature',
    ['f', '°f', 'degf', 'deg f', 'deg_f', 'fahrenheit'],
    (value) => (value - 32) * (5 / 9),
    (value) => value * (9 / 5) + 32,
    'imperial',
  ),
  affine(
    'k',
    'K',
    'temperature',
    ['k', 'kelvin'],
    (value) => value - 273.15,
    (value) => value + 273.15,
    'metric',
  ),

  // Conductor size (mm²) - Discrete & standard cross-sectional area
  linear(
    'mm2',
    'mm²',
    'conductor_size',
    ['mm²', 'mm2', 'mm^2', 'sq mm', 'sqmm', 'square millimeter', 'square millimeters'],
    1,
    'metric',
  ),
  awgUnit,
];

const unitByAlias = new Map(
  definitions.flatMap((definition) =>
    definition.aliases.map((alias) => [alias.toLowerCase(), definition] as const),
  ),
);

export const resolveUnit = (unit: string): UnitDefinition | undefined =>
  unitByAlias.get(unit.trim().toLowerCase());

export const convertUnit = (value: number, fromUnit?: string, toUnit?: string): number => {
  if (!fromUnit || !toUnit) throw new Error('Both source and target units are required.');
  if (!Number.isFinite(value)) throw new Error('A finite numeric value is required.');
  const from = resolveUnit(fromUnit);
  const to = resolveUnit(toUnit);
  if (!from || !to) throw new Error(`Unsupported unit conversion: ${fromUnit} to ${toUnit}.`);
  if (from.dimension !== to.dimension) {
    throw new Error(`Cannot convert between dimensions '${from.dimension}' and '${to.dimension}'.`);
  }
  return to.fromCanonical(from.toCanonical(value));
};

export interface ParsedUnitValue {
  readonly value: number;
  readonly unit: UnitDefinition;
  readonly rawGauge?: string;
}

export const parseExactUnitValue = (
  rawValue: JsonValue,
  rawUnit?: string,
): ParsedUnitValue | undefined => {
  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue) || !rawUnit) return undefined;
    const unit = resolveUnit(rawUnit);
    if (!unit) return undefined;
    if (unit.dimension === 'conductor_size' && unit.id === 'awg') {
      const parsed = parseAwg(rawValue);
      return parsed ? { value: parsed.gaugeIndex, unit, rawGauge: parsed.gauge } : undefined;
    }
    return { value: rawValue, unit };
  }
  if (typeof rawValue !== 'string') return undefined;

  const trimmed = rawValue.trim();

  // Check AWG discrete formats (e.g. "4/0 AWG", "4/0", "0000", "10 AWG", "14AWG")
  const awgPattern =
    /^\s*(4\/0|3\/0|2\/0|1\/0|0000|000|00|0|\d+)\s*(?:(?:awg|american wire gauge)\b)?\s*$/i;
  const hasEmbeddedAwg = /(?:awg|american wire gauge)/i.test(trimmed);
  const rawUnitDef = rawUnit ? resolveUnit(rawUnit) : undefined;

  if (hasEmbeddedAwg) {
    const embeddedAwgDef = resolveUnit('AWG')!;
    if (rawUnit && (!rawUnitDef || rawUnitDef.id !== embeddedAwgDef.id)) {
      // Direct contradiction: raw_value has AWG but raw_unit specifies a different unit
      return undefined;
    }
    const awgMatch = trimmed.match(awgPattern);
    if (awgMatch) {
      const parsed = parseAwg(awgMatch[1]);
      if (parsed) {
        return { value: parsed.gaugeIndex, unit: embeddedAwgDef, rawGauge: parsed.gauge };
      }
    }
    return undefined;
  }

  if (rawUnitDef && rawUnitDef.id === 'awg') {
    const awgMatch = trimmed.match(awgPattern);
    if (awgMatch) {
      const parsed = parseAwg(awgMatch[1]);
      if (parsed) {
        return { value: parsed.gaugeIndex, unit: rawUnitDef, rawGauge: parsed.gauge };
      }
    }
    return undefined;
  }

  // General number + unit regex
  const numberRegex =
    /^([-+]?(?:(?:\d{1,3}(?:,\d{3})+)|(?:\d+(?:\.\d+)?)|(?:\.\d+)))(?:\s*(.+?))?\s*$/;
  const match = trimmed.match(numberRegex);
  if (!match) return undefined;

  const numVal = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(numVal)) return undefined;

  const embeddedUnitText = match[2]?.trim();

  if (embeddedUnitText) {
    const embeddedUnitDef = resolveUnit(embeddedUnitText);
    if (embeddedUnitDef) {
      if (rawUnit) {
        if (!rawUnitDef || rawUnitDef.id !== embeddedUnitDef.id) {
          // Contradiction between embedded unit and rawUnit
          return undefined;
        }
        return { value: numVal, unit: rawUnitDef };
      }
      return { value: numVal, unit: embeddedUnitDef };
    }

    // Embedded text is not a fully resolved unit (e.g. ambiguous 'gal' or unsupported string)
    if (rawUnit && rawUnitDef) {
      const embLower = embeddedUnitText.toLowerCase();
      const rawLower = rawUnit.trim().toLowerCase();
      const isCompatible =
        rawUnitDef.symbol.toLowerCase() === embLower ||
        rawLower.includes(embLower) ||
        rawUnitDef.aliases.some((alias) => alias.toLowerCase().includes(embLower));

      if (isCompatible) {
        return { value: numVal, unit: rawUnitDef };
      }
      return undefined;
    }

    return undefined;
  }

  if (rawUnitDef) {
    return { value: numVal, unit: rawUnitDef };
  }

  return undefined;
};
