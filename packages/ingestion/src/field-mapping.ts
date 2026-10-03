import type { CanonicalQualifiedValue, JsonObject, JsonValue } from './contracts.js';
import type { ReviewedSemanticContext } from './semantic-context.js';
import Ajv2020 from 'ajv/dist/2020.js';
import componentSchema from '../../../data/schemas/component.schema.json' with { type: 'json' };
import {
  parseContextualMeasurement,
  parsePowerDisplayCondition,
  parseSourceObservations,
  type SourceObservation,
} from './qualified-values.js';
import { parseExactUnitValue, resolveUnit } from './units.js';

type SchemaValidator = ((_value: unknown) => boolean) & { errors?: unknown };
const AjvCtor = Ajv2020 as unknown as new (options?: Record<string, unknown>) => {
  compile: (_schema: unknown) => SchemaValidator;
};

export interface CanonicalFieldMapping {
  readonly canonical_field: string;
  readonly dimension: string;
  readonly unit: string;
  readonly aliases: readonly string[];
  readonly target_kind?: 'canonical' | 'evidence';
  readonly value_kind?: 'measurement' | 'structured' | 'observations';
  readonly normalize_observations?: (
    label: string,
    value: string,
    sourceUnit?: string,
  ) => readonly SourceObservation[] | undefined;
  readonly normalize_value?: (value: string, sourceUnit?: string) => JsonValue | undefined;
}

const normalizeOrderedMeasurements = (
  value: string,
  sourceUnit: string | undefined,
  kind: 'supply_range' | 'output_range' | 'body_dimensions',
): JsonObject | undefined =>
  parseContextualMeasurement(
    kind === 'supply_range'
      ? 'electrical.input_voltage_range_v'
      : kind === 'output_range'
        ? 'electrical.output_voltage_range_v'
        : 'dimensions_mm',
    value,
    sourceUnit,
  )?.value;

const mountingEvidence = (
  concept: 'allowed_orientation' | 'prohibited_orientation' | 'method',
  value: string,
): JsonObject | undefined => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    concept === 'allowed_orientation' &&
    (normalized === 'vertical mounting only' || normalized === 'mount vertically')
  ) {
    return { vocabulary: 'vertical' };
  }
  if (
    concept === 'prohibited_orientation' &&
    (normalized === 'do not mount upside down' || normalized === 'upside-down prohibited')
  ) {
    return { vocabulary: 'upside_down' };
  }
  if (concept === 'method' && (normalized === 'wall mounting' || normalized === 'wall mount')) {
    return { vocabulary: 'wall_mount' };
  }
  return undefined;
};

const normalizeChemistryValue = (value: string): string | undefined => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    normalized.includes('lithium iron phosphate') ||
    normalized.includes('lifepo4') ||
    normalized === 'lifepo4'
  ) {
    return 'lifepo4';
  }
  return undefined;
};

const normalizeRangeValue = (
  value: string,
  kind: 'series' | 'parallel',
): JsonObject | undefined => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const match = normalized.match(
    new RegExp(`(?:up to\\s+)?(\\d+)\\s*(?:batteries?\\s*)?(?:in\\s+)?${kind}(?:\\s+.*)?$`),
  );
  if (!match) return undefined;
  return { min: 1, max: Number(match[1]) };
};

const baseCanonicalFieldMappings: readonly CanonicalFieldMapping[] = [
  {
    canonical_field: 'electrical.input_voltage_range_v',
    dimension: 'voltage',
    unit: 'V',
    aliases: ['supply voltage'],
    value_kind: 'structured',
    normalize_value: (value, unit) => normalizeOrderedMeasurements(value, unit, 'supply_range'),
  },
  {
    canonical_field: 'dimensions_mm',
    dimension: 'length',
    unit: 'mm',
    aliases: ['outer dimensions (h x w x d)'],
    value_kind: 'structured',
    normalize_value: (value, unit) => normalizeOrderedMeasurements(value, unit, 'body_dimensions'),
  },
  {
    canonical_field: 'electrical.nominal_voltage_v',
    dimension: 'voltage',
    unit: 'V',
    aliases: ['nominal voltage', 'nominal battery voltage', 'battery voltage'],
  },
  {
    canonical_field: 'electrical.continuous_current_a',
    dimension: 'current',
    unit: 'A',
    aliases: ['continuous current'],
  },
  {
    canonical_field: 'electrical.continuous_discharge_current_a',
    dimension: 'current',
    unit: 'A',
    aliases: ['max continuous discharge'],
  },
  {
    canonical_field: 'electrical.peak_discharge_current_a',
    dimension: 'current',
    unit: 'A',
    aliases: ['max discharge peak current', 'peak discharge current'],
  },
  {
    canonical_field: 'electrical.peak_discharge_duration_s',
    dimension: 'time',
    unit: 's',
    aliases: ['max discharge duration', 'peak discharge duration', 'discharge duration'],
  },
  {
    canonical_field: 'electrical.continuous_output_current_a',
    dimension: 'current',
    unit: 'A',
    aliases: ['continuous output current'],
  },
  {
    canonical_field: 'electrical.continuous_charge_current_a',
    dimension: 'current',
    unit: 'A',
    aliases: [
      'continuous charge current',
      'maximum charge current',
      'maximum battery charge current',
      'maximum charge current (up to 25°c ambient)',
    ],
  },
  {
    canonical_field: 'electrical.nominal_voltage_v',
    dimension: 'voltage',
    unit: 'V',
    aliases: ['supported battery voltage'],
    value_kind: 'structured',
    normalize_value: (value) => {
      // A source-supported voltage set is atomic. Dropping malformed/missing
      // members would turn a partial observation into an invented complete set.
      const members = value.split(',').map((item) => item.trim());
      if (
        !members.length ||
        members.some((item) => !/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)\s*V$/i.test(item))
      )
        return undefined;
      const values = members.map((item) => Number(item.replace(/V$/i, '').trim()));
      return values.every(Number.isFinite) ? values : undefined;
    },
  },
  {
    canonical_field: 'electrical.max_pv_voltage_v',
    dimension: 'voltage',
    unit: 'V',
    aliases: ['maximum pv open-circuit voltage'],
    target_kind: 'evidence',
  },
  {
    canonical_field: 'electrical.continuous_power_w',
    dimension: 'power',
    unit: 'W',
    aliases: [
      'continuous power',
      'continuous output power',
      'continuous inverter ac output power at 25°c',
    ],
  },
  {
    canonical_field: 'electrical.apparent_power_va',
    dimension: 'apparent_power',
    unit: 'VA',
    aliases: [
      'apparent power',
      'continuous apparent power',
      'continuous power at 25°c (nonlinear load, crest factor 3:1)',
    ],
  },
  {
    canonical_field: 'electrical.ac_output_voltage_v',
    dimension: 'voltage',
    unit: 'V',
    aliases: ['ac output voltage', 'ac output voltage ±2% (adjustable)'],
  },
  {
    canonical_field: 'electrical.frequency_hz',
    dimension: 'frequency',
    unit: 'Hz',
    aliases: ['ac output frequency', 'ac output frequency ±0.1% (adjustable)'],
  },
  {
    canonical_field: 'battery.nominal_capacity_ah',
    dimension: 'capacity',
    unit: 'Ah',
    aliases: ['nominal capacity', 'nominal battery capacity'],
  },
  {
    canonical_field: 'battery.nominal_energy_wh',
    dimension: 'energy',
    unit: 'Wh',
    aliases: ['nominal energy', 'nominal battery energy'],
  },
  {
    canonical_field: 'battery.chemistry',
    dimension: 'chemistry',
    unit: 'string',
    aliases: ['chemistry', 'lifepo4', 'lithium iron phosphate'],
    target_kind: 'canonical',
    value_kind: 'structured',
    normalize_value: (value) => normalizeChemistryValue(value),
  },
  {
    canonical_field: 'battery.charge_current.recommended_a',
    dimension: 'current',
    unit: 'A',
    aliases: ['recommended charge current', 'recommended charge', 'recommended current'],
  },
  {
    canonical_field: 'battery.allowed_series_count',
    dimension: 'count',
    unit: 'structured',
    aliases: ['series connection', 'connection in series', 'maximum series count'],
    target_kind: 'canonical',
    value_kind: 'structured',
    normalize_value: (value) => normalizeRangeValue(value, 'series'),
  },
  {
    canonical_field: 'battery.allowed_parallel_count',
    dimension: 'count',
    unit: 'structured',
    aliases: ['parallel connection', 'connection in parallel', 'maximum parallel count'],
    target_kind: 'canonical',
    value_kind: 'structured',
    normalize_value: (value) => normalizeRangeValue(value, 'parallel'),
  },
  {
    canonical_field: 'weight_kg',
    dimension: 'mass',
    unit: 'kg',
    aliases: ['weight', 'mass'],
  },
  // Retained for the legacy ProductFact normalizer and persisted pilot replay.
  // Production semantic proposals separately require a reviewed body region.
  { canonical_field: 'dimensions_mm.x', dimension: 'length', unit: 'mm', aliases: ['width'] },
  { canonical_field: 'dimensions_mm.y', dimension: 'length', unit: 'mm', aliases: ['depth'] },
  { canonical_field: 'dimensions_mm.z', dimension: 'length', unit: 'mm', aliases: ['height'] },
  {
    canonical_field: 'mounting.allowed_orientation',
    dimension: 'mounting',
    unit: 'structured',
    aliases: ['allowed mounting orientation'],
    target_kind: 'evidence',
    value_kind: 'structured',
    normalize_value: (value) => mountingEvidence('allowed_orientation', value),
  },
  {
    canonical_field: 'mounting.prohibited_orientation',
    dimension: 'mounting',
    unit: 'structured',
    aliases: ['prohibited mounting orientation'],
    target_kind: 'evidence',
    value_kind: 'structured',
    normalize_value: (value) => mountingEvidence('prohibited_orientation', value),
  },
  {
    canonical_field: 'mounting.method',
    dimension: 'mounting',
    unit: 'structured',
    aliases: ['mounting method'],
    target_kind: 'evidence',
    value_kind: 'structured',
    normalize_value: (value) => mountingEvidence('method', value),
  },
];

const batteryVoltageRange = (raw: string, sourceUnit?: string): JsonObject | undefined => {
  if (sourceUnit && sourceUnit.trim().toLowerCase() !== 'v') return undefined;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*V$/i);
  if (!match) return undefined;
  const min = Number(match[1]);
  const max = Number(match[2]);
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min
    ? { min, max }
    : undefined;
};
const depthOfDischarge = (raw: string, sourceUnit?: string): number | undefined => {
  if (sourceUnit && sourceUnit.trim() !== '%') return undefined;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (!match) return undefined;
  const percent = Number(match[1]);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent / 100 : undefined;
};

// Role and reviewed-region qualification is supplied by semantic-context.ts.
// These entries are a versioned vocabulary: exact aliases only, with no fallback
// from generic Voltage/Capacity/Length when the contextual attestation is absent.
export const contextualCanonicalFieldMappings: readonly (CanonicalFieldMapping & {
  readonly role: ReviewedSemanticContext['role'];
  readonly region: ReviewedSemanticContext['region'];
})[] = [
  {
    role: 'battery',
    region: 'battery_specs',
    canonical_field: 'electrical.nominal_voltage_v',
    dimension: 'voltage',
    unit: 'V',
    aliases: ['voltage'],
  },
  {
    role: 'battery',
    region: 'battery_specs',
    canonical_field: 'battery.nominal_capacity_ah',
    dimension: 'capacity',
    unit: 'Ah',
    aliases: ['capacity'],
  },
  {
    role: 'battery',
    region: 'battery_specs',
    canonical_field: 'battery.usable_capacity_ah',
    dimension: 'capacity',
    unit: 'Ah',
    aliases: ['usable capacity'],
  },
  {
    role: 'battery',
    region: 'battery_specs',
    canonical_field: 'battery.chemistry',
    dimension: 'chemistry',
    unit: 'string',
    aliases: ['battery type'],
    value_kind: 'structured',
    normalize_value: normalizeChemistryValue,
  },
  {
    role: 'battery',
    region: 'battery_specs',
    canonical_field: 'battery.usable_depth_of_discharge_fraction',
    dimension: 'ratio',
    unit: 'fraction',
    aliases: ['usable depth of discharge'],
    value_kind: 'structured',
    normalize_value: depthOfDischarge,
  },
  {
    role: 'battery',
    region: 'battery_specs',
    canonical_field: 'battery.maximum_series_voltage_v',
    dimension: 'voltage',
    unit: 'V',
    aliases: ['maximum series voltage'],
  },
  {
    role: 'battery',
    region: 'battery_charge',
    canonical_field: 'battery.charging_voltage_range_v',
    dimension: 'voltage',
    unit: 'V',
    aliases: ['charging voltage'],
    value_kind: 'structured',
    normalize_value: batteryVoltageRange,
  },
  {
    role: 'battery',
    region: 'battery_charge',
    canonical_field: 'battery.float_voltage_range_v',
    dimension: 'voltage',
    unit: 'V',
    aliases: ['float voltage'],
    value_kind: 'structured',
    normalize_value: batteryVoltageRange,
  },
  {
    role: 'battery',
    region: 'body_dimensions',
    canonical_field: 'dimensions_mm.x',
    dimension: 'length',
    unit: 'mm',
    aliases: ['width'],
  },
  {
    role: 'battery',
    region: 'body_dimensions',
    canonical_field: 'dimensions_mm.y',
    dimension: 'length',
    unit: 'mm',
    aliases: ['length', 'depth'],
  },
  {
    role: 'battery',
    region: 'body_dimensions',
    canonical_field: 'dimensions_mm.z',
    dimension: 'length',
    unit: 'mm',
    aliases: ['height'],
  },
];

const productionBatteryOnlyFields = new Set([
  'battery.nominal_capacity_ah',
  'battery.nominal_energy_wh',
  'battery.chemistry',
  'battery.charge_current.recommended_a',
  'battery.allowed_series_count',
  'battery.allowed_parallel_count',
  'battery.usable_capacity_ah',
  'battery.usable_depth_of_discharge_fraction',
  'battery.maximum_series_voltage_v',
  'battery.charging_voltage_range_v',
  'battery.float_voltage_range_v',
]);

export const resolveProductionCanonicalField = (
  rawLabel: string,
  context?: ReviewedSemanticContext,
): CanonicalFieldMapping | undefined => {
  const mapping = resolveCanonicalField(rawLabel, context);
  if (
    mapping &&
    productionBatteryOnlyFields.has(mapping.canonical_field) &&
    context?.role !== 'battery'
  )
    return undefined;
  return mapping;
};

const clearanceCategories = ['service', 'ventilation', 'cable_access', 'safety'] as const;
const localFaces = ['x_min', 'x_max', 'y_min', 'y_max', 'z_min', 'z_max'] as const;
const clearanceMappings: CanonicalFieldMapping[] = clearanceCategories.flatMap((category) =>
  localFaces.map((face) => ({
    canonical_field: `clearance.${category}.${face}`,
    dimension: 'length',
    unit: 'mm',
    aliases: [`${category.replace('_', ' ')} clearance ${face}`],
    target_kind: 'evidence' as const,
    value_kind: 'measurement' as const,
  })),
);

export const canonicalFieldMappings: readonly CanonicalFieldMapping[] = [
  ...baseCanonicalFieldMappings,
  ...clearanceMappings,
];

const cleanLabel = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase();
const mappingsByAlias = new Map(
  canonicalFieldMappings.flatMap((mapping) =>
    mapping.aliases.map((alias) => [cleanLabel(alias), mapping] as const),
  ),
);
interface SchemaNode {
  readonly properties?: Readonly<Record<string, SchemaNode>>;
}

const schemaPathExists = (path: string): boolean => {
  let node: SchemaNode | undefined = componentSchema as SchemaNode;
  for (const segment of path.split('.')) {
    node = node.properties?.[segment] as SchemaNode | undefined;
    if (!node) return false;
  }
  return true;
};

export const resolveCanonicalField = (
  rawLabel: string,
  context?: ReviewedSemanticContext,
): CanonicalFieldMapping | undefined => {
  const label = cleanLabel(rawLabel);
  if (context) {
    const applicable = contextualCanonicalFieldMappings.filter(
      (entry) =>
        entry.role === context.role &&
        entry.region === context.region &&
        entry.aliases.some((alias) => cleanLabel(alias) === label),
    );
    // Multiple competing reviewed meanings must not be settled by list order.
    if (applicable.length > 1) return undefined;
    if (applicable.length === 1) return applicable[0];
  }
  return (
    mappingsByAlias.get(label) ??
    (parsePowerDisplayCondition(rawLabel) ? powerConsumptionMapping : undefined)
  );
};

const powerConsumptionMapping: CanonicalFieldMapping = {
  canonical_field: 'electrical.power_consumption_w',
  dimension: 'power',
  unit: 'W',
  aliases: [],
  value_kind: 'observations',
  normalize_observations: (label, value, unit) =>
    parseSourceObservations('electrical.power_consumption_w', label, value, unit),
};

export const isSupportedCanonicalField = (field: string): boolean => schemaPathExists(field);

export type SemanticValueShape = 'number' | 'string' | 'boolean' | 'object' | 'array' | 'null';

export interface ProductionSemanticFieldDescriptor {
  readonly canonical_field: string;
  readonly value_shapes: readonly SemanticValueShape[];
  readonly dimension: string;
  readonly unit: string;
  readonly allows_unit_conversion: boolean;
  readonly allowed_roles?: readonly ReviewedSemanticContext['role'][];
  readonly allowed_regions?: readonly ReviewedSemanticContext['region'][];
  readonly human_adjudication: 'source_fact' | 'qualified_only';
  readonly normalizer_version: string;
}

interface ProductionTargetNormalization {
  readonly value: JsonValue;
  readonly qualifiers?: CanonicalQualifiedValue['qualifiers'];
  readonly sourceUnit?: string;
}

type ProductionTargetNormalizer = (
  rawValue: JsonValue,
  sourceUnit?: string,
  context?: ReviewedSemanticContext,
  sourceLabel?: string,
) => ProductionTargetNormalization | undefined;

export interface ProductionSemanticTargetContract extends ProductionSemanticFieldDescriptor {
  readonly normalize: ProductionTargetNormalizer;
}

const schemaNodeAt = (
  path: string,
):
  | {
      properties?: Record<string, unknown>;
      type?: string | readonly string[];
      oneOf?: readonly { type?: string | readonly string[] }[];
      anyOf?: readonly { type?: string | readonly string[] }[];
    }
  | undefined => {
  let node = componentSchema as {
    properties?: Record<string, unknown>;
    type?: string | readonly string[];
    oneOf?: readonly { type?: string | readonly string[] }[];
    anyOf?: readonly { type?: string | readonly string[] }[];
  };
  for (const segment of path.split('.')) {
    const properties = node.properties;
    if (!properties || !(segment in properties)) return undefined;
    node = properties[segment] as typeof node;
  }
  return node;
};

const schemaShapesAt = (path: string): readonly SemanticValueShape[] | undefined => {
  const node = schemaNodeAt(path);
  if (!node) return undefined;
  const variants = [...(node.oneOf ?? []), ...(node.anyOf ?? [])];
  const types = [
    ...(Array.isArray(node.type) ? node.type : node.type ? [node.type] : []),
    ...variants.flatMap((variant) =>
      Array.isArray(variant.type) ? variant.type : variant.type ? [variant.type] : [],
    ),
  ];
  const supported = new Set<SemanticValueShape>([
    'number',
    'string',
    'boolean',
    'object',
    'array',
    'null',
  ]);
  const shapes = [
    ...new Set(
      types.filter((type): type is SemanticValueShape => supported.has(type as SemanticValueShape)),
    ),
  ];
  return shapes.length ? shapes.sort() : undefined;
};

const semanticTargetNormalizerVersion = 'production-semantic-targets.v1';

const normalizeMeasurementTarget = (
  dimension: string,
  unitName: string,
  rawValue: JsonValue,
  sourceUnit?: string,
): ProductionTargetNormalization | undefined => {
  const parsed = parseExactUnitValue(rawValue, sourceUnit);
  if (!parsed || parsed.unit.dimension !== dimension) return undefined;
  const targetUnit = resolveUnit(unitName);
  if (!targetUnit || targetUnit.dimension !== parsed.unit.dimension) return undefined;
  const normalized = targetUnit.fromCanonical(parsed.unit.toCanonical(parsed.value));
  return Number.isFinite(normalized)
    ? { value: normalized, sourceUnit: parsed.unit.symbol }
    : undefined;
};

const normalizeVoltageSet = (
  rawValue: JsonValue,
  sourceUnit?: string,
): ProductionTargetNormalization | undefined => {
  if (typeof rawValue !== 'string') return undefined;
  const members = rawValue.split(',').map((item) => item.trim());
  if (
    members.length < 2 ||
    members.some((item) => !/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)\s*V$/i.test(item)) ||
    (sourceUnit !== undefined && resolveUnit(sourceUnit)?.id !== resolveUnit('V')?.id)
  )
    return undefined;
  const values = members.map((item) => Number(item.replace(/V$/i, '').trim()));
  return values.every(Number.isFinite) ? { value: values, sourceUnit: 'V' } : undefined;
};

const normalizeVoltageRangeTarget = (
  canonicalField: 'electrical.input_voltage_range_v' | 'electrical.output_voltage_range_v',
  rawValue: JsonValue,
  sourceUnit?: string,
): ProductionTargetNormalization | undefined => {
  if (typeof rawValue !== 'string') return undefined;
  const parsed = parseContextualMeasurement(canonicalField, rawValue, sourceUnit);
  // Keep qualifiers available to automatic proposals; reviewed decisions reject
  // them until their contract can bind and preserve that additional meaning.
  return parsed
    ? {
        value: parsed.value,
        ...(parsed.qualifiers ? { qualifiers: parsed.qualifiers } : {}),
      }
    : undefined;
};

const targetContract = (
  canonical_field: string,
  dimension: string,
  unit: string,
  normalize: ProductionTargetNormalizer,
  options: {
    readonly allowed_roles?: readonly ReviewedSemanticContext['role'][];
    readonly allowed_regions?: readonly ReviewedSemanticContext['region'][];
    readonly human_adjudication?: 'source_fact' | 'qualified_only';
  } = {},
): ProductionSemanticTargetContract | undefined => {
  const value_shapes = schemaShapesAt(canonical_field);
  if (!value_shapes?.length) return undefined;
  return {
    canonical_field,
    value_shapes,
    dimension,
    unit,
    allows_unit_conversion:
      dimension !== 'chemistry' &&
      dimension !== 'mounting' &&
      unit !== 'structured' &&
      unit !== 'string',
    ...(options.allowed_roles ? { allowed_roles: options.allowed_roles } : {}),
    ...(options.allowed_regions ? { allowed_regions: options.allowed_regions } : {}),
    human_adjudication: options.human_adjudication ?? 'source_fact',
    normalizer_version: semanticTargetNormalizerVersion,
    normalize,
  };
};

const scalarTarget = (
  canonical_field: string,
  dimension: string,
  unit: string,
  options: {
    readonly allowed_roles?: readonly ReviewedSemanticContext['role'][];
  } = {},
): ProductionSemanticTargetContract | undefined =>
  targetContract(
    canonical_field,
    dimension,
    unit,
    (rawValue, sourceUnit) => normalizeMeasurementTarget(dimension, unit, rawValue, sourceUnit),
    options,
  );

const batteryRole = ['battery'] as const;

const semanticTargetContracts: readonly ProductionSemanticTargetContract[] = [
  targetContract('electrical.input_voltage_range_v', 'voltage', 'V', (raw, unit) =>
    normalizeVoltageRangeTarget('electrical.input_voltage_range_v', raw, unit),
  ),
  targetContract('electrical.output_voltage_range_v', 'voltage', 'V', (raw, unit) =>
    normalizeVoltageRangeTarget('electrical.output_voltage_range_v', raw, unit),
  ),
  targetContract('dimensions_mm', 'length', 'mm', (raw, unit) => {
    if (typeof raw !== 'string') return undefined;
    const parsed = parseContextualMeasurement('dimensions_mm', raw, unit);
    return parsed
      ? {
          value: parsed.value,
          ...(parsed.qualifiers ? { qualifiers: parsed.qualifiers } : {}),
        }
      : undefined;
  }),
  targetContract('electrical.nominal_voltage_v', 'voltage', 'V', (raw, unit) => {
    const voltageSet = normalizeVoltageSet(raw, unit);
    return voltageSet ?? normalizeMeasurementTarget('voltage', 'V', raw, unit);
  }),
  scalarTarget('electrical.continuous_current_a', 'current', 'A'),
  scalarTarget('electrical.continuous_input_current_a', 'current', 'A'),
  scalarTarget('electrical.continuous_output_current_a', 'current', 'A'),
  scalarTarget('electrical.continuous_charge_current_a', 'current', 'A'),
  scalarTarget('electrical.continuous_discharge_current_a', 'current', 'A'),
  scalarTarget('electrical.peak_input_current_a', 'current', 'A'),
  scalarTarget('electrical.peak_output_current_a', 'current', 'A'),
  scalarTarget('electrical.peak_discharge_current_a', 'current', 'A'),
  scalarTarget('electrical.peak_discharge_duration_s', 'time', 's'),
  scalarTarget('electrical.continuous_power_w', 'power', 'W'),
  scalarTarget('electrical.apparent_power_va', 'apparent_power', 'VA'),
  scalarTarget('electrical.ac_output_voltage_v', 'voltage', 'V'),
  scalarTarget('electrical.frequency_hz', 'frequency', 'Hz'),
  scalarTarget('battery.nominal_capacity_ah', 'capacity', 'Ah', { allowed_roles: batteryRole }),
  scalarTarget('battery.nominal_energy_wh', 'energy', 'Wh', { allowed_roles: batteryRole }),
  targetContract(
    'battery.chemistry',
    'chemistry',
    'string',
    (raw) => {
      const value = typeof raw === 'string' ? normalizeChemistryValue(raw) : undefined;
      return value === undefined ? undefined : { value };
    },
    { allowed_roles: batteryRole },
  ),
  scalarTarget('battery.charge_current.recommended_a', 'current', 'A', {
    allowed_roles: batteryRole,
  }),
  scalarTarget('battery.charge_current.maximum_continuous_a', 'current', 'A', {
    allowed_roles: batteryRole,
  }),
  scalarTarget('battery.charge_current.protection_limit_a', 'current', 'A', {
    allowed_roles: batteryRole,
  }),
  targetContract(
    'battery.allowed_series_count',
    'count',
    'structured',
    (raw) => {
      const value = typeof raw === 'string' ? normalizeRangeValue(raw, 'series') : undefined;
      return value === undefined ? undefined : { value };
    },
    { allowed_roles: batteryRole },
  ),
  targetContract(
    'battery.allowed_parallel_count',
    'count',
    'structured',
    (raw) => {
      const value = typeof raw === 'string' ? normalizeRangeValue(raw, 'parallel') : undefined;
      return value === undefined ? undefined : { value };
    },
    { allowed_roles: batteryRole },
  ),
  scalarTarget('battery.usable_capacity_ah', 'capacity', 'Ah', { allowed_roles: batteryRole }),
  targetContract(
    'battery.usable_depth_of_discharge_fraction',
    'ratio',
    'fraction',
    (raw, unit) => {
      const value = typeof raw === 'string' ? depthOfDischarge(raw, unit) : undefined;
      return value === undefined ? undefined : { value };
    },
    { allowed_roles: batteryRole },
  ),
  scalarTarget('battery.maximum_series_voltage_v', 'voltage', 'V', {
    allowed_roles: batteryRole,
  }),
  targetContract(
    'battery.charging_voltage_range_v',
    'voltage',
    'V',
    (raw, unit) => {
      const value = typeof raw === 'string' ? batteryVoltageRange(raw, unit) : undefined;
      return value === undefined ? undefined : { value };
    },
    { allowed_roles: batteryRole },
  ),
  targetContract(
    'battery.float_voltage_range_v',
    'voltage',
    'V',
    (raw, unit) => {
      const value = typeof raw === 'string' ? batteryVoltageRange(raw, unit) : undefined;
      return value === undefined ? undefined : { value };
    },
    { allowed_roles: batteryRole },
  ),
  scalarTarget('weight_kg', 'mass', 'kg'),
  scalarTarget('dimensions_mm.x', 'length', 'mm'),
  scalarTarget('dimensions_mm.y', 'length', 'mm'),
  scalarTarget('dimensions_mm.z', 'length', 'mm'),
  targetContract('electrical.power_consumption_w', 'power', 'W', () => undefined, {
    human_adjudication: 'qualified_only',
  }),
].filter((contract): contract is ProductionSemanticTargetContract => !!contract);

export const productionSemanticFieldDescriptors =
  (): readonly ProductionSemanticFieldDescriptor[] =>
    semanticTargetContracts.filter((contract) => contract.human_adjudication === 'source_fact');

export const productionSemanticTargetContract = (
  canonicalField: string,
): ProductionSemanticTargetContract | undefined =>
  semanticTargetContracts.find((item) => item.canonical_field === canonicalField);

export const productionSemanticTargetContractIssues = (): readonly string[] => {
  const mappings = [
    ...canonicalFieldMappings,
    ...contextualCanonicalFieldMappings,
    powerConsumptionMapping,
  ];
  const issues = new Set<string>();
  for (const mapping of mappings) {
    if (mapping.target_kind === 'evidence') continue;
    const target = productionSemanticTargetContract(mapping.canonical_field);
    if (!target) {
      issues.add(
        `Automatic mapping target '${mapping.canonical_field}' has no semantic target contract.`,
      );
      continue;
    }
    if (mapping.dimension !== target.dimension || mapping.unit !== target.unit)
      issues.add(
        `Automatic mapping '${mapping.canonical_field}' declares ${mapping.dimension}/${mapping.unit}, but its target contract declares ${target.dimension}/${target.unit}.`,
      );
  }
  return [...issues].sort();
};

export const validateProductionSemanticTargetContracts = (): void => {
  const issues = productionSemanticTargetContractIssues();
  if (issues.length) throw new Error(issues.join('; '));
};

export const productionSemanticFieldDescriptor = (
  canonicalField: string,
  role?: ReviewedSemanticContext['role'],
  region?: ReviewedSemanticContext['region'],
): ProductionSemanticFieldDescriptor | undefined => {
  const descriptor = productionSemanticTargetContract(canonicalField);
  if (
    !descriptor ||
    !isSupportedCanonicalField(canonicalField) ||
    descriptor.human_adjudication !== 'source_fact' ||
    (descriptor.allowed_roles && (!role || !descriptor.allowed_roles.includes(role))) ||
    (descriptor.allowed_regions && (!region || !descriptor.allowed_regions.includes(region)))
  )
    return undefined;
  return descriptor;
};

export const normalizeProductionSemanticTarget = (
  canonicalField: string,
  rawValue: JsonValue,
  sourceUnit: string | undefined,
  context?: ReviewedSemanticContext,
  sourceLabel?: string,
):
  | {
      readonly value: JsonValue;
      readonly qualifiers?: CanonicalQualifiedValue['qualifiers'];
      readonly sourceUnit?: string;
    }
  | undefined => {
  const contract = productionSemanticTargetContract(canonicalField);
  if (
    !contract ||
    !productionSemanticFieldDescriptor(canonicalField, context?.role, context?.region)
  )
    return undefined;
  const value = contract.normalize(rawValue, sourceUnit, context, sourceLabel);
  if (value === undefined) return undefined;
  const parsed = parseExactUnitValue(rawValue, sourceUnit);
  return {
    ...value,
    ...(value.sourceUnit
      ? {}
      : parsed?.unit.symbol
        ? { sourceUnit: parsed.unit.symbol }
        : sourceUnit && resolveUnit(sourceUnit)
          ? { sourceUnit: resolveUnit(sourceUnit)!.symbol }
          : {}),
  };
};

export const productionSemanticValueMatchesTarget = (
  canonicalField: string,
  value: JsonValue,
  role?: ReviewedSemanticContext['role'],
  region?: ReviewedSemanticContext['region'],
): boolean => {
  const descriptor = productionSemanticFieldDescriptor(canonicalField, role, region);
  if (!descriptor) return false;
  const schema = schemaNodeAt(canonicalField);
  if (!schema) return false;
  const wrappedSchema = {
    $schema: componentSchema.$schema,
    $defs: {
      ...componentSchema.$defs,
      reviewedSemanticValue: schema,
    },
    $ref: '#/$defs/reviewedSemanticValue',
  };
  const validator = new AjvCtor({ allErrors: true, strict: false }).compile(wrappedSchema);
  return validator(value) && matchesJsonValue(value);
};

const matchesJsonValue = (value: JsonValue): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(matchesJsonValue);
  if (value !== null && typeof value === 'object')
    return Object.values(value).every(matchesJsonValue);
  return true;
};
