import componentSchema from '../../../data/schemas/component.schema.json';

// This bounded, versioned presentation index reads the existing component schema only.
// It is not a field registry: labels/aliases never authorize normalization or mapping.
export const ENGINEERING_EXPLORER_VERSION = 'component-explorer.v2';
interface SchemaNode {
  description?: string;
  properties?: Record<string, SchemaNode>;
  oneOf?: SchemaNode[];
  const?: string;
  enum?: unknown[];
}
export interface EngineeringConcept {
  id: string;
  path: string;
  label: string;
  description: string;
  distinction: string;
  terms: string;
  category: string;
  representation: 'direct' | 'canonical' | 'qualified';
  contractFields?: string[];
}
export function engineeringConcepts(
  presentation: Record<
    string,
    { label: string; description: string; distinction: string; terms: string }
  >,
): EngineeringConcept[] {
  const schema = componentSchema as unknown as {
    properties: Record<string, SchemaNode>;
    $defs: Record<string, SchemaNode>;
  };
  const category = (field: string) =>
    field.startsWith('battery.') || /charge|discharge/.test(field)
      ? 'Charging / batteries'
      : /dimensions|weight/.test(field)
        ? 'Physical dimensions'
        : /clearance|mounting|orientation/.test(field)
          ? 'Installation / clearance'
          : /measurement/.test(field)
            ? 'Measurements'
            : /consumption|idle|standby|efficiency/.test(field)
              ? 'Consumption / conditions'
              : /input|pv_/.test(field)
                ? 'Electrical input'
                : /output/.test(field)
                  ? 'Electrical output'
                  : /interfaces/.test(field)
                    ? 'Interfaces / connectivity'
                    : /ports|power_paths/.test(field)
                      ? 'Connectivity / topology'
                      : /protection/.test(field)
                        ? 'Protection'
                        : 'Electrical ratings';
  const readable = (field: string) =>
    field
      .split('.')
      .at(-1)!
      .replace(/_(a|v|w|ah|wh|va|hz|mm|kg)$/, '')
      .replace(/_/g, ' ')
      .replace(/\b(ah|wh|va|hz|mm|kg)\b/g, (unit) => unit.toUpperCase())
      .replace(/^./, (first) => first.toUpperCase());
  const concepts: EngineeringConcept[] = Object.entries(presentation).map(([field, metadata]) => ({
    id: field,
    path: field,
    ...metadata,
    category: category(field),
    representation: 'direct',
  }));
  const add = (field: string, node: SchemaNode, representation: 'canonical' | 'qualified') => {
    if (
      representation === 'canonical' &&
      concepts.some((entry) => entry.path === field && entry.representation === 'direct')
    )
      return;
    concepts.push({
      id: representation + ':' + field,
      path: field,
      label: readable(field) + (representation === 'qualified' ? ' · qualified source rating' : ''),
      description:
        (representation === 'qualified' ? qualifiedPropertyDescriptions[field] : undefined) ??
        node.description ??
        'Detailed description is not documented in the component schema. Inspect the contract details; do not infer source meaning.',
      distinction:
        representation === 'qualified'
          ? 'A source-backed qualified interpretation preserves applicable duration, temperature, direction, measurement basis and operating conditions. Availability depends on current server validation; the catalog grants no mapping authority.'
          : 'Existing canonical concept; this workflow has no direct manual mapping contract for it.',
      contractFields: Object.keys(
        representation === 'qualified'
          ? (node.properties?.qualifiers?.properties ?? {})
          : (node.properties ?? {}),
      ),
      terms:
        field.replace(/_/g, ' ') +
        ' ' +
        (field.endsWith('_a') ? 'amps amperes current' : '') +
        ' ' +
        (field.includes('consumption') ? 'standby no-load quiescent' : ''),
      category: category(field),
      representation,
    });
  };
  // Only engineering sections with defined keys are indexed. Open-ended mounting, topology,
  // interfaces and protection are shown as structures, not fabricated leaf properties.
  for (const root of [
    'electrical',
    'battery',
    'efficiency_fraction',
    'weight_kg',
    'dimensions_mm',
    'mounting',
    'service_clearances_mm',
    'orientation_constraint',
    'measurement',
    'protection',
    'ports',
    'power_paths',
    'interfaces',
  ]) {
    const node = schema.properties[root];
    if (!node) continue;
    if (root === 'electrical' || root === 'battery') {
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        const field = root + '.' + key;
        if (key === 'charge_current')
          for (const [nested, definition] of Object.entries(child.properties ?? {}))
            add(field + '.' + nested, definition, 'canonical');
        else add(field, child, 'canonical');
      }
    } else add(root, node, 'canonical');
  }
  for (const variant of schema.$defs.canonicalQualifiedValue.oneOf ?? []) {
    const target = variant.properties?.target;
    const paths = target?.const
      ? [target.const]
      : (target?.enum ?? []).filter((entry): entry is string => typeof entry === 'string');
    for (const field of paths) add(field, variant, 'qualified');
  }
  return concepts;
}

// Presentation only, versioned separately from canonical eligibility. These
// descriptions follow the existing target/qualifier union; axes are not inferred
// from a vendor's width/height labels and subsystem state is not device state.
export const qualifiedPropertyDescriptions: Record<string, string> = {
  'electrical.input_voltage_range_v':
    'Minimum and maximum source-stated input voltage in V, with an explicit AC or DC domain. A measured voltage or another battery input is a different assertion.',
  'electrical.power_consumption_w':
    'Source-stated consumption in W under retained operating, display, supply-voltage or measurement conditions. Display off does not establish that the whole device is off.',
  dimensions_mm:
    'Physical body coordinates in mm with retained connector or mounting-accessory exclusions. Source coordinate order must remain explicit; installation envelopes and clearances are separate.',
  'electrical.input_current_a':
    'Current at the input, in A, under the retained source rating basis and conditions. Keep continuous, maximum and time-limited ratings distinct.',
  'electrical.output_current_a':
    'Current delivered at the output, in A, under the retained rating basis and conditions. A surge or duration-limited value is not an unconditional continuous output rating.',
  'electrical.charge_current_a':
    'Source-stated charging current in A under its retained rating and operating conditions; discharge current is a separate meaning.',
  'electrical.discharge_current_a':
    'Source-stated discharge current in A under its retained rating and operating conditions; preserve duration and temperature when stated.',
  'electrical.input_voltage_v':
    'Source-stated input voltage in V with preserved electrical domain and rating conditions; do not substitute output voltage or an unrelated battery voltage.',
  'electrical.output_voltage_v':
    'Source-stated output voltage in V with preserved domain, rating basis and measurement context. RMS and peak voltage are distinct.',
  'electrical.idle_current_a':
    'Source-stated idle current in A with retained operating conditions. Idle is not automatically standby, sleep or whole-device off.',
  'electrical.standby_current_a':
    'Source-stated standby current in A under retained conditions. A disabled display alone does not establish device standby.',
  'electrical.conditioned_consumption_w':
    'Consumption in W bound to retained source operating conditions; preserve the specified state and measurement context.',
  'electrical.peak_power_w':
    'Source-stated peak or surge power in W, retaining the stated duration and conditions. It does not establish continuous capacity.',
  'electrical.continuous_power_w':
    'Source-stated continuous power in W, retaining material domain, temperature and operating conditions.',
  'electrical.rated_power_w':
    'Source-stated rated power in W under retained conditions. Rated, maximum and continuous meanings require source support.',
};
