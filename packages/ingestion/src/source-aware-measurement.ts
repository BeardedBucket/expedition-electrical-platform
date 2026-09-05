import type { ProductFact, ProductSource } from './contracts.js';
import { convertUnit, parseExactUnitValue, resolveUnit } from './units.js';
import { areaMm2ToNearestAwg, formatAwg } from './conductor-size.js';

export type MeasurementBasis = 'source' | 'normalized' | 'derived_display';
export type DisplayPreference = 'source' | 'metric' | 'imperial';

export interface PresentedMeasurement {
  readonly value: number | string;
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

  let sourceValue: number | string = parsed.value;
  if (sourceDefinition.dimension === 'conductor_size' && sourceDefinition.id === 'awg') {
    if (parsed.rawGauge) {
      sourceValue = parsed.rawGauge;
    } else if (typeof fact.raw_value === 'string') {
      const match = fact.raw_value.match(/(4\/0|3\/0|2\/0|1\/0|0000|000|00|0|\d+)/i);
      sourceValue = match ? match[1].toUpperCase() : formatAwg(parsed.value);
    } else {
      sourceValue = formatAwg(parsed.value);
    }
  }

  return {
    source: { value: sourceValue, unit: sourceUnit, basis: 'source' },
    normalized: { value: normalized.value, unit: normalized.unit, basis: 'normalized' },
    dimension: normalized.dimension,
  };
};

export const roundSignificant = (value: number, digits = 3): number => {
  if (value === 0) return 0;
  if (!Number.isFinite(value)) return value;
  const precision = Math.max(1, Math.min(100, Math.floor(digits)));
  return Number(value.toPrecision(precision));
};

type RegionalUnitSystem = 'metric' | 'imperial';

const regionalUnitSystem = (unit: string): RegionalUnitSystem | undefined => {
  const definition = resolveUnit(unit);
  if (!definition) return undefined;
  if (definition.system === 'metric') return 'metric';
  if (definition.system === 'imperial') return 'imperial';
  const normalized = unit.trim().toLowerCase();
  if (definition.dimension === 'mass') {
    return ['g', 'kg'].includes(normalized) ? 'metric' : 'imperial';
  }
  if (definition.dimension === 'length') {
    return ['mm', 'cm', 'm'].includes(normalized) ? 'metric' : 'imperial';
  }
  if (definition.dimension === 'volume') {
    return ['l', 'ml'].includes(normalized) ? 'metric' : 'imperial';
  }
  if (definition.dimension === 'pressure') {
    return ['kpa', 'pa', 'bar'].includes(normalized) ? 'metric' : 'imperial';
  }
  if (definition.dimension === 'torque') {
    return ['n·m', 'n-m', 'nm', 'n m', 'n*m'].includes(normalized) ? 'metric' : 'imperial';
  }
  if (definition.dimension === 'flow') {
    return ['l/min', 'l/h', 'lpm', 'lph'].includes(normalized) ? 'metric' : 'imperial';
  }
  if (definition.dimension === 'temperature') {
    return ['c', '°c', 'k'].includes(normalized) ? 'metric' : 'imperial';
  }
  return undefined;
};

const preferredUnit = (dimension: string, preference: 'metric' | 'imperial'): string => {
  if (dimension === 'mass') return preference === 'metric' ? 'kg' : 'lb';
  if (dimension === 'length') return preference === 'metric' ? 'mm' : 'in';
  if (dimension === 'volume') return preference === 'metric' ? 'L' : 'gal';
  if (dimension === 'pressure') return preference === 'metric' ? 'kPa' : 'psi';
  if (dimension === 'torque') return preference === 'metric' ? 'N·m' : 'lb·ft';
  if (dimension === 'flow') return preference === 'metric' ? 'L/min' : 'gal/min';
  if (dimension === 'temperature') return preference === 'metric' ? '°C' : '°F';
  if (dimension === 'conductor_size') return preference === 'metric' ? 'mm²' : 'AWG';
  throw new Error(`No regional display unit is defined for dimension '${dimension}'.`);
};

const derived = (measurement: SourceAwareMeasurement, unit: string): PresentedMeasurement => {
  const normalizedValue =
    typeof measurement.normalized.value === 'number'
      ? measurement.normalized.value
      : Number(measurement.normalized.value);
  return {
    value: roundSignificant(convertUnit(normalizedValue, measurement.normalized.unit, unit)),
    unit,
    basis: 'derived_display',
  };
};

export const presentMeasurement = (
  measurement: SourceAwareMeasurement,
  preference: DisplayPreference,
): MeasurementPresentation => {
  const source = measurement.source;
  const normalized = measurement.normalized;

  // Discrete conductor size handling
  if (measurement.dimension === 'conductor_size') {
    const isAwgSource = resolveUnit(source.unit)?.id === 'awg';
    if (isAwgSource) {
      // AWG source: mm² must NOT replace source AWG; companion shows derived mm²
      const normVal =
        typeof normalized.value === 'number' ? normalized.value : Number(normalized.value);
      const companion: PresentedMeasurement = {
        value: roundSignificant(normVal, 3),
        unit: 'mm²',
        basis: 'derived_display',
      };
      return { source, normalized, primary: source, secondary: companion };
    }
    // mm² source: if imperial preference, show nearest AWG companion
    if (preference === 'imperial') {
      const normVal =
        typeof normalized.value === 'number' ? normalized.value : Number(normalized.value);
      const nearestAwg = areaMm2ToNearestAwg(normVal);
      if (nearestAwg) {
        const companion: PresentedMeasurement = {
          value: nearestAwg,
          unit: 'AWG',
          basis: 'derived_display',
        };
        return { source, normalized, primary: source, secondary: companion };
      }
    }
    return { source, normalized, primary: source };
  }

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
