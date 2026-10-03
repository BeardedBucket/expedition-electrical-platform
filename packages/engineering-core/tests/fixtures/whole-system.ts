import type { ComponentLibraryRecord } from '../../src/component-library.js';
import type { WholeSystemEvaluationInput } from '../../src/engineering-passport-contracts.js';

/** Project-authored numerical fixtures only; verified means complete fixture evidence, never real products. */
export const completeInstalledSystemFixture = (): {
  input: WholeSystemEvaluationInput;
  catalog: ComponentLibraryRecord[];
} => {
  const base = (id: string): ComponentLibraryRecord => ({
    id: `fixture.${id}`,
    manufacturer: 'Project-authored fixture',
    model: id,
    category: 'synthetic',
    verification_status: 'verified',
    source_type: 'synthetic',
    source_refs: [
      {
        id: 'fixture.evidence',
        title: 'Project-authored complete engineering inputs; not a real specification',
      },
    ],
    dimensions_mm: { x: 100, y: 80, z: 40 },
  });
  const idle = (voltage: number) => [
    {
      id: 'baseline',
      target: 'electrical.power_consumption_w' as const,
      value: 1,
      qualifiers: {
        supply_voltage_v: voltage,
        electrical_domain: 'dc' as const,
        measurement_basis: 'quiescent' as const,
      },
    },
  ];
  const converter = (id: string, from: number, to: number): ComponentLibraryRecord => ({
    ...base(id),
    product_role: 'dc_dc_converter',
    efficiency_fraction: 0.9,
    capabilities: [{ id: 'conversion', type: 'dc_to_dc_conversion' }],
    ports: [
      { id: 'input', domain: 'dc', direction: 'input', voltage_v: from, current_a: 100 },
      { id: 'output', domain: 'dc', direction: 'output', voltage_v: to, power_w: 500 },
    ],
    power_paths: [
      { id: 'conversion', capability_id: 'conversion', from_port: 'input', to_port: 'output' },
    ],
    qualified_values: idle(from),
  });
  const catalog: ComponentLibraryRecord[] = [
    converter('boost', 12, 24),
    converter('reduce', 24, 12),
    {
      ...base('battery'),
      product_role: 'battery',
      capabilities: [{ id: 'storage', type: 'energy_storage' }],
      electrical: { nominal_voltage_v: 24 },
      battery: {
        nominal_capacity_ah: 100,
        allowed_series_count: { min: 1, max: 2 },
        allowed_parallel_count: { min: 1, max: 2 },
      },
      ports: [{ id: 'battery', domain: 'dc', direction: 'bidirectional', voltage_v: 24 }],
      qualified_values: idle(24),
    },
    {
      ...base('load24'),
      product_role: 'load',
      ports: [{ id: 'input', domain: 'dc', direction: 'input', voltage_v: 24 }],
    },
    {
      ...base('load12'),
      product_role: 'load',
      ports: [{ id: 'input', domain: 'dc', direction: 'input', voltage_v: 12 }],
    },
  ];
  const input: WholeSystemEvaluationInput = {
    assumptions: [
      {
        id: 'demand',
        origin: 'project',
        statement:
          'Fixture-only active load demands and ten-hour exclusive state schedules; no design recommendation.',
      },
    ],
    requirements: {
      id: 'fixture.requirements',
      house_domain_id: 'house',
      evaluation_hours: 10,
      supplies: [
        {
          id: 'vehicle-house',
          from: 'vehicle',
          to: 'house',
          edge_ids: ['vehicle-boost', 'boost-conversion', 'boost-house'],
          required_power_w: 100,
        },
        {
          id: 'house-load12',
          from: 'house',
          to: 'load12.input',
          edge_ids: ['house-reduce', 'reduce-conversion', 'reduce-load'],
          required_power_w: 24,
        },
        {
          id: 'battery-load24',
          from: 'battery.port',
          to: 'load24.input',
          edge_ids: ['battery-house', 'house-load24'],
          required_power_w: 48,
        },
      ],
      load_states: [
        ...[
          { id: 'boost', binding: 'boost.input', voltage: 12 },
          { id: 'reduce', binding: 'reduce.input', voltage: 24 },
          { id: 'battery', binding: 'battery.port', voltage: 24 },
        ].map(({ id, binding, voltage }) => ({
          id: `${id}.baseline`,
          binding_id: binding,
          state: 'quiescent' as const,
          duration_hours: 10,
          power: {
            kind: 'component' as const,
            qualified_value_id: 'baseline',
            context: {
              supply_voltage_v: voltage,
              electrical_domain: 'dc' as const,
              measurement_basis: 'quiescent' as const,
            },
          },
        })),
        {
          id: 'load24.active',
          binding_id: 'load24.input',
          state: 'active',
          duration_hours: 10,
          power: { kind: 'requirement', watts: 48, assumption_id: 'demand' },
        },
        {
          id: 'load12.active',
          binding_id: 'load12.input',
          state: 'active',
          duration_hours: 10,
          power: { kind: 'requirement', watts: 24, assumption_id: 'demand' },
        },
      ],
      battery_banks: [
        {
          id: 'bank',
          instance_id: 'battery',
          domain_id: 'house',
          series_count: 1,
          parallel_count: 1,
          required_nominal_energy_wh: 1000,
        },
      ],
    },
    architecture: {
      installation: {
        schema_version: '1.0.0',
        id: 'fixture.installed-system',
        name: 'Mixed-domain backend acceptance (not a recommended design)',
        status: 'selected',
        component_instances: catalog.map((record) => ({
          id: record.id.replace('fixture.', ''),
          component_id: record.id,
          status: 'selected',
        })),
      },
      power_topology: {
        domains: [
          { id: 'vehicle', kind: 'dc', nominal_voltage_v: 12 },
          { id: 'house', kind: 'dc', nominal_voltage_v: 24 },
          { id: 'low-loads', kind: 'dc', nominal_voltage_v: 12 },
        ],
        bindings: [
          { id: 'boost.input', instance_id: 'boost', port_id: 'input', domain_id: 'vehicle' },
          { id: 'boost.output', instance_id: 'boost', port_id: 'output', domain_id: 'house' },
          { id: 'reduce.input', instance_id: 'reduce', port_id: 'input', domain_id: 'house' },
          { id: 'reduce.output', instance_id: 'reduce', port_id: 'output', domain_id: 'low-loads' },
          { id: 'battery.port', instance_id: 'battery', port_id: 'battery', domain_id: 'house' },
          { id: 'load24.input', instance_id: 'load24', port_id: 'input', domain_id: 'house' },
          { id: 'load12.input', instance_id: 'load12', port_id: 'input', domain_id: 'low-loads' },
        ],
        edges: [
          { id: 'vehicle-boost', kind: 'wire', from: 'vehicle', to: 'boost.input' },
          {
            id: 'boost-conversion',
            kind: 'power_path',
            from: 'boost.input',
            to: 'boost.output',
            instance_id: 'boost',
            power_path_id: 'conversion',
          },
          { id: 'boost-house', kind: 'wire', from: 'boost.output', to: 'house' },
          { id: 'house-reduce', kind: 'wire', from: 'house', to: 'reduce.input' },
          {
            id: 'reduce-conversion',
            kind: 'power_path',
            from: 'reduce.input',
            to: 'reduce.output',
            instance_id: 'reduce',
            power_path_id: 'conversion',
          },
          { id: 'reduce-load', kind: 'wire', from: 'reduce.output', to: 'load12.input' },
          { id: 'battery-house', kind: 'wire', from: 'battery.port', to: 'house' },
          { id: 'house-battery', kind: 'wire', from: 'house', to: 'battery.port' },
          { id: 'house-load24', kind: 'wire', from: 'house', to: 'load24.input' },
        ],
      },
    },
  };
  return { input, catalog };
};
