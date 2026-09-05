import type { ProductFact, ProductSource } from './contracts.js';
import { convertUnit, parseExactUnitValue, resolveUnit } from './units.js';

export type MeasurementBasis = 'source' | 'normalized' | 'derived_display';
export type DisplayPreference = 'source' | 'metric' | 'imperial';

export interface PresentedMeasurement {
  readonly value: number;
  readonly unit: string;
  readonly basis: MeasurementBasis;
}

export interface SourceAwareMeasurement {
  readonly source: PresentedMeasurement;
  readonly normalized: PresentedMeasurement;
  readonly dimension: string;
}

export interface MeasurementInput {
  readonly value: number;
  readonly unit: string;
  readonly dimension: string;
}

export interface MeasurementPresentation {
  readonly source: PresentedMeasurement;
  readonly normalized: PresentedMeasurement;
  readonly primary: PresentedMeasurement;
  readonly secondary?: PresentedMeasurement;
}

export const buildSourceAwareMeasurement = (
  fact: ProductFact,
  normalized: MeasurementInput,
  source: ProductSource,
): SourceAwareMeasurement => {
  if (fact.source_id !== source.id)
    throw new Error(`Fact '${fact.id}' is not from source '${source.id}'.`);
  if (!Number.isFinite(normalized.value)) throw new Error('Normalized value must be finite.');
  const normalizedDefinition = resolveUnit(normalized.unit);
  if (!normalizedDefinition) {
    throw new Error(`Unsupported normalized unit '${normalized.unit}'.`);
  }
  if (normalizedDefinition.dimension !== normalized.dimension) {
    throw new Error(
      `Normalized unit '${normalized.unit}' does not match dimension '${normalized.dimension}'.`,
    );
  }
  const parsed = parseExactUnitValue(fact.raw_value, fact.raw_unit);
  if (!parsed) throw new Error(`Fact '${fact.id}' does not contain an exact numeric measurement.`);
  const sourceUnit = fact.raw_unit?.trim() ?? parsed.unit.symbol;
  const sourceDefinition = resolveUnit(sourceUnit);
  if (!sourceDefinition || sourceDefinition.dimension !== normalized.dimension) {
    throw new Error(
      `Source unit '${sourceUnit}' does not match dimension '${normalized.dimension}'.`,
    );
  }
  return {
    source: { value: parsed.value, unit: sourceUnit, basis: 'source' },
    normalized: { value: normalized.value, unit: normalized.unit, basis: 'normalized' },
    dimension: normalized.dimension,
  };
};

const roundSignificant = (value: number, digits = 3): number => {
  if (value === 0) return 0;
  const places = digits - Math.floor(Math.log10(Math.abs(value))) - 1;
  return Number(value.toFixed(Math.max(0, places)));
};

type RegionalUnitSystem = 'metric' | 'imperial';

const regionalUnitSystem = (unit: string): RegionalUnitSystem | undefined => {
  const definition = resolveUnit(unit);
  const normalized = unit.trim().toLowerCase();
  if (definition?.dimension === 'mass') {
    return normalized === 'g' || normalized === 'kg' ? 'metric' : 'imperial';
  }
  if (definition?.dimension === 'length') {
    return ['mm', 'cm', 'm'].includes(normalized) ? 'metric' : 'imperial';
  }
  return undefined;
};

const preferredUnit = (dimension: string, preference: 'metric' | 'imperial'): string => {
  if (dimension === 'mass') return preference === 'metric' ? 'kg' : 'lb';
  if (dimension === 'length') return preference === 'metric' ? 'mm' : 'in';
  throw new Error(`No regional display unit is defined for dimension '${dimension}'.`);
};

const derived = (measurement: SourceAwareMeasurement, unit: string): PresentedMeasurement => ({
  value: roundSignificant(
    convertUnit(measurement.normalized.value, measurement.normalized.unit, unit),
  ),
  unit,
  basis: 'derived_display',
});

export const presentMeasurement = (
  measurement: SourceAwareMeasurement,
  preference: DisplayPreference,
): MeasurementPresentation => {
  const source = measurement.source;
  const normalized = measurement.normalized;
  const sourceSystem = regionalUnitSystem(source.unit);
  if (!sourceSystem) return { source, normalized, primary: source };
  const sourceIsMetric = sourceSystem === 'metric';
  if (preference === 'source') {
    const companion = derived(
      measurement,
      preferredUnit(measurement.dimension, sourceIsMetric ? 'imperial' : 'metric'),
    );
    return { source, normalized, primary: source, secondary: companion };
  }
  const target = preferredUnit(measurement.dimension, preference);
  if ((preference === 'metric') === sourceIsMetric) {
    return { source, normalized, primary: source };
  }
  return { source, normalized, primary: derived(measurement, target), secondary: source };
};
