import type { JsonValue } from './contracts.js';

export interface UnitDefinition {
  readonly symbol: string;
  readonly dimension: string;
  readonly aliases: readonly string[];
  readonly toCanonical: (value: number) => number;
  readonly fromCanonical: (value: number) => number;
}

const linear = (
  symbol: string,
  dimension: string,
  aliases: readonly string[],
  factor: number,
): UnitDefinition => ({
  symbol,
  dimension,
  aliases,
  toCanonical: (value) => value * factor,
  fromCanonical: (value) => value / factor,
});

const definitions: readonly UnitDefinition[] = [
  linear('V', 'voltage', ['v', 'volt', 'volts', 'vac', 'vdc'], 1),
  linear('V', 'voltage', ['mv'], 0.001),
  linear('A', 'current', ['a', 'amp', 'amps', 'ampere', 'amperes'], 1),
  linear('W', 'power', ['w', 'watt', 'watts'], 1),
  linear('W', 'power', ['kw'], 1000),
  linear('VA', 'apparent_power', ['va'], 1),
  linear('VA', 'apparent_power', ['kva'], 1000),
  linear('Wh', 'energy', ['wh'], 1),
  linear('Wh', 'energy', ['kwh'], 1000),
  linear('Ah', 'capacity', ['ah'], 1),
  linear('ohm', 'resistance', ['ohm', 'ohms', 'ω', 'Ω'], 1),
  linear('Hz', 'frequency', ['hz'], 1),
  linear('kg', 'mass', ['kg', 'kilogram', 'kilograms'], 1),
  linear('kg', 'mass', ['g', 'gram', 'grams'], 0.001),
  linear('kg', 'mass', ['oz', 'ounce', 'ounces'], 0.45359237 / 16),
  linear('kg', 'mass', ['lb', 'pound', 'pounds'], 0.45359237),
  linear('mm', 'length', ['mm'], 1),
  linear('mm', 'length', ['cm'], 10),
  linear('mm', 'length', ['m'], 1000),
  linear('mm', 'length', ['in', 'inch', 'inches'], 25.4),
  linear('mm', 'length', ['ft', 'foot', 'feet'], 304.8),
  linear('°C', 'temperature', ['c', '°c'], 1),
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
}

const numberPattern = '[-+]?(?:(?:\\d{1,3}(?:,\\d{3})+)|(?:\\d+(?:\\.\\d+)?)|(?:\\.\\d+))';

export const parseExactUnitValue = (
  rawValue: JsonValue,
  rawUnit?: string,
): ParsedUnitValue | undefined => {
  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue) || !rawUnit) return undefined;
    const unit = resolveUnit(rawUnit);
    return unit ? { value: rawValue, unit } : undefined;
  }
  if (typeof rawValue !== 'string') return undefined;
  const pattern = new RegExp(`^\\s*(${numberPattern})\\s*([A-Za-z°Ωω]+)\\s*$`);
  const match = rawValue.match(pattern);
  if (!match) return undefined;
  const unitText = rawUnit ?? match[2];
  const unit = resolveUnit(unitText);
  return unit ? { value: Number(match[1].replace(/,/g, '')), unit } : undefined;
};
