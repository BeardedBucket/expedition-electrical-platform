export interface CanonicalFieldMapping {
  readonly canonical_field: string;
  readonly dimension: string;
  readonly unit: string;
  readonly aliases: readonly string[];
}

export const canonicalFieldMappings: readonly CanonicalFieldMapping[] = [
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
    canonical_field: 'weight_kg',
    dimension: 'mass',
    unit: 'kg',
    aliases: ['weight', 'mass'],
  },
  {
    canonical_field: 'dimensions_mm.x',
    dimension: 'length',
    unit: 'mm',
    aliases: ['length'],
  },
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
