import type { JsonValue } from './contracts.js';

export interface UnitDefinition {
  readonly symbol: string;
  readonly dimension: string;
  readonly aliases: readonly string[];
  readonly toCanonical: (value: number) => number;
}

const definitions: readonly UnitDefinition[] = [
  {
    symbol: 'V',
    dimension: 'voltage',
    aliases: ['v', 'volt', 'volts', 'vac', 'vdc'],
    toCanonical: (v) => v,
  },
  { symbol: 'V', dimension: 'voltage', aliases: ['mv'], toCanonical: (v) => v / 1000 },
  {
    symbol: 'A',
    dimension: 'current',
    aliases: ['a', 'amp', 'amps', 'ampere', 'amperes'],
    toCanonical: (v) => v,
  },
  { symbol: 'W', dimension: 'power', aliases: ['w', 'watt', 'watts'], toCanonical: (v) => v },
  { symbol: 'W', dimension: 'power', aliases: ['kw'], toCanonical: (v) => v * 1000 },
  { symbol: 'VA', dimension: 'apparent_power', aliases: ['va'], toCanonical: (v) => v },
  { symbol: 'VA', dimension: 'apparent_power', aliases: ['kva'], toCanonical: (v) => v * 1000 },
  { symbol: 'Wh', dimension: 'energy', aliases: ['wh'], toCanonical: (v) => v },
  { symbol: 'Wh', dimension: 'energy', aliases: ['kwh'], toCanonical: (v) => v * 1000 },
  { symbol: 'Ah', dimension: 'capacity', aliases: ['ah'], toCanonical: (v) => v },
  {
    symbol: 'ohm',
    dimension: 'resistance',
    aliases: ['ohm', 'ohms', 'ω', 'Ω'],
    toCanonical: (v) => v,
  },
  { symbol: 'Hz', dimension: 'frequency', aliases: ['hz'], toCanonical: (v) => v },
  {
    symbol: 'kg',
    dimension: 'mass',
    aliases: ['kg', 'kilogram', 'kilograms'],
    toCanonical: (v) => v,
  },
  {
    symbol: 'kg',
    dimension: 'mass',
    aliases: ['g', 'gram', 'grams'],
    toCanonical: (v) => v / 1000,
  },
  { symbol: 'mm', dimension: 'length', aliases: ['mm'], toCanonical: (v) => v },
  { symbol: 'mm', dimension: 'length', aliases: ['cm'], toCanonical: (v) => v * 10 },
  { symbol: 'mm', dimension: 'length', aliases: ['m'], toCanonical: (v) => v * 1000 },
  { symbol: '°C', dimension: 'temperature', aliases: ['c', '°c'], toCanonical: (v) => v },
];

const unitByAlias = new Map(
  definitions.flatMap((definition) =>
    definition.aliases.map((alias) => [alias.toLowerCase(), definition] as const),
  ),
);

export const resolveUnit = (unit: string): UnitDefinition | undefined =>
  unitByAlias.get(unit.trim().toLowerCase());

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
