import Ajv2020 from 'ajv/dist/2020.js';
import componentSchema from '../../../data/schemas/component.schema.json' with { type: 'json' };
import type { CanonicalQualifiedValue, JsonObject, JsonValue, ProductFact } from './contracts.js';
import { deterministicSerialize } from './production-contracts.js';
import { resolveUnit } from './units.js';

const Ajv = Ajv2020 as unknown as new (options: object) => {
  compile(schema: unknown): (value: unknown) => boolean;
};
const validate = new Ajv({ strict: false }).compile({
  $defs: componentSchema.$defs,
  $ref: '#/$defs/canonicalQualifiedValue',
});

export const isCanonicalQualifiedValue = (value: unknown): value is CanonicalQualifiedValue => {
  if (!validate(value)) return false;
  const assertion = value as CanonicalQualifiedValue;
  if (assertion.target === 'electrical.power_consumption_w')
    return (
      Number.isFinite(assertion.value) &&
      (assertion.qualifiers.supply_voltage_v === undefined ||
        Number.isFinite(assertion.qualifiers.supply_voltage_v)) &&
      (assertion.qualifiers.display?.state !== 'on' ||
        assertion.qualifiers.display.brightness_percent === undefined ||
        Number.isFinite(assertion.qualifiers.display.brightness_percent))
    );
  return (
    assertion.target !== 'electrical.input_voltage_range_v' ||
    assertion.value.min <= assertion.value.max
  );
};

export const qualifiedValueCollectionValid = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(isCanonicalQualifiedValue) &&
    new Set(value.map((entry) => entry.id)).size === value.length);

export interface ContextualMeasurement {
  readonly value: JsonObject;
  readonly qualifiers?: CanonicalQualifiedValue['qualifiers'];
}

export interface SourceObservation {
  readonly value: JsonValue;
  readonly qualifiers?: CanonicalQualifiedValue['qualifiers'];
}

/** Exact label grammar; subsystem state is not a whole-device operating state. */
export const parsePowerDisplayCondition = (
  label: string,
):
  | Extract<
      CanonicalQualifiedValue,
      { target: 'electrical.power_consumption_w' }
    >['qualifiers']['display']
  | undefined => {
  const clean = label.trim().toLowerCase().replace(/\s+/g, ' ');
  if (clean === 'power draw display off') return { state: 'off' };
  const match = clean.match(/^power draw display on \((\d+(?:\.\d+)?)\s*% brightness\)$/);
  if (!match) return undefined;
  const brightness = Number(match[1]);
  return brightness <= 100 ? { state: 'on', brightness_percent: brightness } : undefined;
};

/** Whole-row parsing: no convenient-subset projection, interpolation, or inferred units. */
export const parseSourceObservations = (
  target: string,
  label: string,
  raw: string,
  sourceUnit?: string,
): readonly SourceObservation[] | undefined => {
  if (target !== 'electrical.power_consumption_w') {
    const context = parseContextualMeasurement(target, raw, sourceUnit);
    return context ? [context] : undefined;
  }
  const display = parsePowerDisplayCondition(label);
  if (!display || (sourceUnit !== undefined && sourceUnit.trim().toLowerCase() !== 'w'))
    return undefined;
  const number = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
  const pattern = new RegExp(`^\\s*${number}\\s*W\\s*@?\\s*${number}\\s*V\\s*(AC|DC)?\\s*$`, 'i');
  const byContext = new Map<string, SourceObservation>();
  for (const segment of raw.split('|')) {
    const match = segment.match(pattern);
    if (!match) return undefined;
    const value = Number(match[1]);
    const voltage = Number(match[2]);
    if (!Number.isFinite(value) || !Number.isFinite(voltage) || voltage <= 0) return undefined;
    const qualifiers = {
      supply_voltage_v: voltage,
      display,
      ...(match[3] ? { electrical_domain: match[3].toLowerCase() as 'ac' | 'dc' } : {}),
    };
    const key = deterministicSerialize(qualifiers);
    const previous = byContext.get(key);
    if (previous && previous.value !== value) return undefined;
    byContext.set(key, { value, qualifiers });
  }
  // Ordering of source segments does not choose winners or change observation identity.
  return [...byContext.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
};

export const sourceSupportsQualifiedValue = (
  fact: Pick<ProductFact, 'raw_label' | 'raw_value' | 'raw_unit'>,
  assertion: CanonicalQualifiedValue,
): boolean =>
  parseSourceObservations(
    assertion.target,
    fact.raw_label,
    String(fact.raw_value),
    fact.raw_unit,
  )?.some(
    (observation) =>
      deterministicSerialize(observation.value) === deterministicSerialize(assertion.value) &&
      deterministicSerialize(observation.qualifiers) ===
        deterministicSerialize(assertion.qualifiers),
  ) === true;

// Source-unit identity and electrical domain are checked independently.
const voltageUnit = (text: string): { unit: string; domain?: 'ac' | 'dc' } | undefined => {
  const match = text.trim().match(/^(mV|kV|V)\s*(AC|DC)?$/i);
  return match
    ? { unit: match[1], ...(match[2] ? { domain: match[2].toLowerCase() as 'ac' | 'dc' } : {}) }
    : undefined;
};

export const parseContextualMeasurement = (
  target: string,
  raw: string,
  sourceUnit?: string,
): ContextualMeasurement | undefined => {
  const numeric = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
  if (target === 'electrical.input_voltage_range_v') {
    const match = raw.match(
      new RegExp(
        `^\\s*${numeric}\\s*(?:-|–|to)\\s*${numeric}\\s*((?:mV|kV|V)\\s*(?:AC|DC)?|AC|DC)?\\s*$`,
        'i',
      ),
    );
    if (!match) return undefined;
    const embedded = match[3] ? voltageUnit(match[3]) : undefined;
    const external = sourceUnit === undefined ? undefined : voltageUnit(sourceUnit);
    if (sourceUnit !== undefined && !external) return undefined;
    // A domain-only suffix requires a separately asserted voltage unit.
    const domainOnly = /^(ac|dc)$/i.test(match[3] ?? '')
      ? (match[3].toLowerCase() as 'ac' | 'dc')
      : undefined;
    const chosen = embedded || external;
    if (
      !chosen ||
      (embedded && external && resolveUnit(embedded.unit)?.id !== resolveUnit(external.unit)?.id)
    )
      return undefined;
    const domains = [embedded?.domain, external?.domain, domainOnly].filter(Boolean);
    if (new Set(domains).size > 1) return undefined;
    const unit = resolveUnit(chosen.unit)!;
    const min = unit.toCanonical(Number(match[1]));
    const max = unit.toCanonical(Number(match[2]));
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return undefined;
    return {
      value: { min, max },
      ...(domains[0] ? { qualifiers: { electrical_domain: domains[0] as 'ac' | 'dc' } } : {}),
    };
  }
  if (target !== 'dimensions_mm') return undefined;
  const terms =
    '(connectors|mounting accessories|connectors and mounting accessories|mounting accessories and connectors)';
  const suffix = raw.match(
    new RegExp(
      `\\s+(?:\\((?:without|excluding) ${terms}\\)|(?:without|excluding) ${terms})\\s*$`,
      'i',
    ),
  );
  const body = suffix ? raw.slice(0, suffix.index).trim() : raw.trim();
  const parts = body.split('|').map((part) => part.trim());
  if (parts.length > 2) return undefined;
  const triples = parts.map((part) => {
    const match = part.match(
      new RegExp(`^${numeric}\\s*[x×]\\s*${numeric}\\s*[x×]\\s*${numeric}\\s*(mm|cm|m|in)?$`, 'i'),
    );
    if (!match) return undefined;
    const unit = resolveUnit(match[4] ?? sourceUnit ?? '');
    if (!unit || unit.dimension !== 'length') return undefined;
    if (sourceUnit !== undefined && parts.length === 1 && resolveUnit(sourceUnit)?.id !== unit.id)
      return undefined;
    return {
      lexical: match.slice(1, 4),
      unit,
      values: match.slice(1, 4).map((v) => unit.toCanonical(Number(v))),
    };
  });
  if (triples.some((triple) => !triple || triple.values.some((n) => !Number.isFinite(n) || n <= 0)))
    return undefined;
  const first = triples[0]!;
  if (sourceUnit !== undefined && resolveUnit(sourceUnit)?.id !== first.unit.id) return undefined;
  if (triples.length === 2) {
    const second = triples[1]!;
    // Published decimal precision defines rounding intervals, not engineering tolerance.
    // Both intervals must overlap after exact unit conversion. Canonical values are not rounded.
    const halfStep = (text: string, unit: typeof first.unit): number =>
      unit.toCanonical(0.5 * 10 ** -(text.split('.')[1]?.length ?? 0));
    if (
      first.values.some(
        (v, i) =>
          Math.abs(v - second.values[i]) >
          halfStep(first.lexical[i], first.unit) +
            halfStep(second.lexical[i], second.unit) +
            8 * Number.EPSILON * Math.max(v, second.values[i]),
      )
    )
      return undefined;
  }
  const exclusions = suffix
    ? (suffix[1] ?? suffix[2])
        .toLowerCase()
        .split(' and ')
        .map((v) => v.replace(' ', '_'))
        .sort()
    : undefined;
  return {
    value: { x: first.values[1], y: first.values[2], z: first.values[0] },
    ...(exclusions
      ? {
          qualifiers: {
            physical_scope: {
              kind: 'physical_body',
              exclusions: exclusions as ('connectors' | 'mounting_accessories')[],
            },
          },
        }
      : {}),
  };
};
