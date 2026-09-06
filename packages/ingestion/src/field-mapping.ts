import type { JsonObject, JsonValue } from './contracts.js';

export interface CanonicalFieldMapping {
  readonly canonical_field: string;
  readonly dimension: string;
  readonly unit: string;
  readonly aliases: readonly string[];
  readonly target_kind?: 'canonical' | 'evidence';
  readonly value_kind?: 'measurement' | 'structured';
  readonly normalize_value?: (value: string) => JsonValue | undefined;
}

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
      'maximum charge current',
      'maximum battery charge current',
      'maximum charge current (up to 25°c ambient)',
    ],
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
  {
    canonical_field: 'dimensions_mm.x',
    dimension: 'length',
    unit: 'mm',
    aliases: ['width'],
  },
  {
    canonical_field: 'dimensions_mm.y',
    dimension: 'length',
    unit: 'mm',
    aliases: ['depth'],
  },
  {
    canonical_field: 'dimensions_mm.z',
    dimension: 'length',
    unit: 'mm',
    aliases: ['height'],
  },
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

export const resolveCanonicalField = (rawLabel: string): CanonicalFieldMapping | undefined =>
  mappingsByAlias.get(cleanLabel(rawLabel));

export const isSupportedCanonicalField = (field: string): boolean => schemaPathExists(field);
import componentSchema from '../../../data/schemas/component.schema.json' with { type: 'json' };
