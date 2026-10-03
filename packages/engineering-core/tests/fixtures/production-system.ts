import type { ComponentLibraryRecord } from '../../src/component-library.js';
import type { WholeSystemEvaluationInput } from '../../src/engineering-passport-contracts.js';

// Explicit acceptance membership, not a directory scan or production product
// preference. Local-only material must never enter this evidence boundary.
export const productionAcceptanceComponentIds = [
  'victron-energy.ori122436120',
  'victron-energy.ori241236120',
  'epoch-batteries.b24100a-c',
  'victron-energy.pmp242200100',
  'victron-energy.scc075015060r',
  'blue-sea-systems.6006',
  'victron-energy.shu050150050',
] as const;

export const productionInstalledSystemFixture = (
  catalog: readonly ComponentLibraryRecord[],
): WholeSystemEvaluationInput => ({
  assumptions: [
    {
      id: 'acceptance.nominal-domains',
      origin: 'project',
      statement:
        'Nominal installation design points only; no product verification or recommended design.',
    },
  ],
  requirements: {
    id: 'production.readiness',
    house_domain_id: 'house',
    evaluation_hours: 10,
    supplies: [
      {
        id: 'vehicle-house',
        from: 'vehicle',
        to: 'house',
        edge_ids: ['vehicle-boost', 'boost-path', 'boost-house'],
        required_power_w: 100,
      },
      {
        id: 'house-low',
        from: 'house',
        to: 'low',
        edge_ids: ['house-reduce', 'reduce-path', 'reduce-low'],
        required_power_w: 24,
      },
      {
        id: 'solar-house',
        from: 'pv',
        to: 'house',
        edge_ids: ['pv-controller', 'solar-path', 'solar-house'],
      },
      {
        id: 'inversion',
        from: 'house',
        to: 'ac-loads',
        edge_ids: ['house-inverter', 'inversion-path', 'inverter-loads'],
      },
      {
        id: 'charging',
        from: 'shore',
        to: 'house',
        edge_ids: ['shore-charger', 'charging-path', 'charger-house'],
      },
    ],
    load_states: [
      'boost.input',
      'reduce.input',
      'battery.dc',
      'multifunction.dc',
      'solar.input',
    ].map((binding_id) => ({
      id: `${binding_id}.idle`,
      binding_id,
      state: 'idle',
      duration_hours: 10,
      power: { kind: 'component' },
    })),
    battery_banks: [
      {
        id: 'house-bank',
        instance_id: 'battery',
        domain_id: 'house',
        series_count: 1,
        parallel_count: 1,
      },
    ],
  },
  architecture: {
    installation: {
      schema_version: '1.0.0',
      id: 'acceptance.production-readiness',
      name: 'Current tracked production data readiness, not a recommended design',
      status: 'selected',
      component_instances: [
        'boost',
        'reduce',
        'battery',
        'multifunction',
        'solar',
        'switch',
        'monitor',
      ].map((id, index) => ({ id, component_id: catalog[index]!.id, status: 'selected' })),
    },
    power_topology: {
      domains: [
        { id: 'vehicle', kind: 'dc', nominal_voltage_v: 12 },
        { id: 'house', kind: 'dc', nominal_voltage_v: 24 },
        { id: 'low', kind: 'dc', nominal_voltage_v: 12 },
        { id: 'pv', kind: 'pv_dc', nominal_voltage_v: 36 },
        { id: 'shore', kind: 'ac', nominal_voltage_v: 120, frequency_hz: 60 },
        { id: 'ac-loads', kind: 'ac', nominal_voltage_v: 120, frequency_hz: 60 },
      ],
      bindings: [
        { id: 'boost.input', instance_id: 'boost', port_id: 'orion.input', domain_id: 'vehicle' },
        { id: 'boost.output', instance_id: 'boost', port_id: 'orion.output', domain_id: 'house' },
        { id: 'reduce.input', instance_id: 'reduce', port_id: 'orion.input', domain_id: 'house' },
        { id: 'reduce.output', instance_id: 'reduce', port_id: 'orion.output', domain_id: 'low' },
        { id: 'battery.dc', instance_id: 'battery', port_id: 'dc_port', domain_id: 'house' },
        {
          id: 'multifunction.dc',
          instance_id: 'multifunction',
          port_id: 'dc_port',
          domain_id: 'house',
        },
        {
          id: 'multifunction.ac-in',
          instance_id: 'multifunction',
          port_id: 'ac_input',
          domain_id: 'shore',
        },
        {
          id: 'multifunction.ac-out',
          instance_id: 'multifunction',
          port_id: 'ac_output',
          domain_id: 'ac-loads',
        },
        {
          id: 'solar.input',
          instance_id: 'solar',
          port_id: 'smartsolar.pv-input',
          domain_id: 'pv',
        },
        {
          id: 'solar.output',
          instance_id: 'solar',
          port_id: 'smartsolar.battery-output',
          domain_id: 'house',
        },
      ],
      edges: [
        { id: 'vehicle-boost', kind: 'wire', from: 'vehicle', to: 'boost.input' },
        {
          id: 'boost-path',
          kind: 'power_path',
          from: 'boost.input',
          to: 'boost.output',
          instance_id: 'boost',
          power_path_id: 'orion.input-to-output',
        },
        { id: 'boost-house', kind: 'wire', from: 'boost.output', to: 'house' },
        { id: 'house-reduce', kind: 'wire', from: 'house', to: 'reduce.input' },
        {
          id: 'reduce-path',
          kind: 'power_path',
          from: 'reduce.input',
          to: 'reduce.output',
          instance_id: 'reduce',
          power_path_id: 'orion.input-to-output',
        },
        { id: 'reduce-low', kind: 'wire', from: 'reduce.output', to: 'low' },
        { id: 'pv-controller', kind: 'wire', from: 'pv', to: 'solar.input' },
        {
          id: 'solar-path',
          kind: 'power_path',
          from: 'solar.input',
          to: 'solar.output',
          instance_id: 'solar',
          power_path_id: 'smartsolar.pv-to-battery-charge',
        },
        { id: 'solar-house', kind: 'wire', from: 'solar.output', to: 'house' },
        { id: 'house-inverter', kind: 'wire', from: 'house', to: 'multifunction.dc' },
        {
          id: 'inversion-path',
          kind: 'power_path',
          from: 'multifunction.dc',
          to: 'multifunction.ac-out',
          instance_id: 'multifunction',
          power_path_id: 'inversion_path',
        },
        { id: 'inverter-loads', kind: 'wire', from: 'multifunction.ac-out', to: 'ac-loads' },
        { id: 'shore-charger', kind: 'wire', from: 'shore', to: 'multifunction.ac-in' },
        {
          id: 'charging-path',
          kind: 'power_path',
          from: 'multifunction.ac-in',
          to: 'multifunction.dc',
          instance_id: 'multifunction',
          power_path_id: 'charging_path',
        },
        { id: 'charger-house', kind: 'wire', from: 'multifunction.dc', to: 'house' },
      ],
    },
  },
});
