import type { ComponentLibraryRecord } from '../../src/component-library.js';
import type { WholeSystemEvaluationInput } from '../../src/engineering-passport-contracts.js';
import type { InstalledPowerTopology } from '../../src/installed-power-topology.js';

export const singleDeviceSystem = (
  record: ComponentLibraryRecord,
  topology: InstalledPowerTopology,
  requirements: WholeSystemEvaluationInput['requirements'],
): WholeSystemEvaluationInput => ({
  architecture: {
    installation: {
      schema_version: '1.0.0',
      id: 'fixture.single-device',
      name: 'Project-authored boundary fixture',
      status: 'selected',
      component_instances: [{ id: 'device', component_id: record.id, status: 'selected' }],
    },
    power_topology: topology,
  },
  requirements,
  assumptions: [],
});

export const passiveDeviceFixture = () => {
  const record: ComponentLibraryRecord = {
    id: 'fixture.passive',
    manufacturer: 'Project-authored',
    model: 'Passive fixture',
    category: 'distribution',
    product_role: 'busbar',
    verification_status: 'verified',
    source_refs: [{ id: 'fixture.source', title: 'Synthetic boundary inputs' }],
    ports: [
      { id: 'one', domain: 'dc', direction: 'bidirectional', voltage_v: 12 },
      { id: 'two', domain: 'dc', direction: 'bidirectional', voltage_v: 12 },
    ],
    conductive_relationships: [
      {
        id: 'continuity',
        participants: [
          { kind: 'port', id: 'one' },
          { kind: 'port', id: 'two' },
        ],
      },
    ],
    qualified_values: [
      {
        id: 'baseline',
        target: 'electrical.power_consumption_w',
        value: 0,
        qualifiers: {
          measurement_basis: 'quiescent',
          electrical_domain: 'dc',
          supply_voltage_v: 12,
        },
      },
    ],
  };
  const input = singleDeviceSystem(
    record,
    {
      domains: [
        { id: 'source', kind: 'dc', nominal_voltage_v: 12 },
        { id: 'destination', kind: 'dc', nominal_voltage_v: 12 },
      ],
      bindings: [
        { id: 'one', instance_id: 'device', port_id: 'one', domain_id: 'source' },
        { id: 'two', instance_id: 'device', port_id: 'two', domain_id: 'destination' },
      ],
      edges: [
        { id: 'in-wire', kind: 'wire', from: 'source', to: 'one' },
        {
          id: 'contact',
          kind: 'conductive',
          from: 'one',
          to: 'two',
          instance_id: 'device',
          relationship_id: 'continuity',
        },
        { id: 'out-wire', kind: 'wire', from: 'two', to: 'destination' },
      ],
    },
    {
      id: 'fixture.passive-requirements',
      evaluation_hours: 1,
      supplies: [
        {
          id: 'supply',
          from: 'source',
          to: 'destination',
          edge_ids: ['in-wire', 'contact', 'out-wire'],
        },
      ],
      load_states: [
        {
          id: 'baseline',
          binding_id: 'one',
          state: 'quiescent',
          duration_hours: 1,
          power: {
            kind: 'component',
            qualified_value_id: 'baseline',
            context: {
              measurement_basis: 'quiescent',
              electrical_domain: 'dc',
              supply_voltage_v: 12,
            },
          },
        },
      ],
      battery_banks: [],
    },
  );
  return { record, input };
};

export const multifunctionDeviceFixture = () => {
  const record: ComponentLibraryRecord = {
    id: 'fixture.multifunction',
    manufacturer: 'Project-authored',
    model: 'Multi-port fixture',
    category: 'synthetic',
    product_role: 'inverter_charger',
    verification_status: 'verified',
    source_refs: [{ id: 'fixture.source', title: 'Synthetic boundary inputs' }],
    electrical: { nominal_voltage_v: 12, frequency_hz: 99 },
    capabilities: [
      { id: 'inversion', type: 'inversion' },
      { id: 'charging', type: 'charging' },
    ],
    ports: [
      { id: 'battery', domain: 'dc', direction: 'bidirectional', voltage_v: 24 },
      { id: 'ac-in', domain: 'ac', direction: 'input', voltage_v: 120, frequency_hz: 60 },
      { id: 'ac-out', domain: 'ac', direction: 'output', voltage_v: 230, frequency_hz: 50 },
    ],
    power_paths: [
      { id: 'invert', capability_id: 'inversion', from_port: 'battery', to_port: 'ac-out' },
      { id: 'charge', capability_id: 'charging', from_port: 'ac-in', to_port: 'battery' },
    ],
    qualified_values: [
      {
        id: 'idle',
        target: 'electrical.power_consumption_w',
        value: 3,
        qualifiers: { operating_state: 'idle', electrical_domain: 'dc', supply_voltage_v: 24 },
      },
    ],
  };
  const input = singleDeviceSystem(
    record,
    {
      domains: [
        { id: 'house', kind: 'dc', nominal_voltage_v: 24 },
        { id: 'shore', kind: 'ac', nominal_voltage_v: 120, frequency_hz: 60 },
        { id: 'ac-loads', kind: 'ac', nominal_voltage_v: 230, frequency_hz: 50 },
      ],
      bindings: [
        { id: 'battery', instance_id: 'device', port_id: 'battery', domain_id: 'house' },
        { id: 'ac-in', instance_id: 'device', port_id: 'ac-in', domain_id: 'shore' },
        { id: 'ac-out', instance_id: 'device', port_id: 'ac-out', domain_id: 'ac-loads' },
      ],
      edges: [
        { id: 'shore-wire', kind: 'wire', from: 'shore', to: 'ac-in' },
        {
          id: 'charge',
          kind: 'power_path',
          from: 'ac-in',
          to: 'battery',
          instance_id: 'device',
          power_path_id: 'charge',
        },
        { id: 'dc-out', kind: 'wire', from: 'battery', to: 'house' },
        { id: 'dc-in', kind: 'wire', from: 'house', to: 'battery' },
        {
          id: 'invert',
          kind: 'power_path',
          from: 'battery',
          to: 'ac-out',
          instance_id: 'device',
          power_path_id: 'invert',
        },
        { id: 'load-wire', kind: 'wire', from: 'ac-out', to: 'ac-loads' },
      ],
    },
    {
      id: 'fixture.multifunction-requirements',
      evaluation_hours: 1,
      supplies: [
        {
          id: 'charging',
          from: 'shore',
          to: 'house',
          edge_ids: ['shore-wire', 'charge', 'dc-out'],
        },
        {
          id: 'inversion',
          from: 'house',
          to: 'ac-loads',
          edge_ids: ['dc-in', 'invert', 'load-wire'],
        },
      ],
      load_states: [
        {
          id: 'idle',
          binding_id: 'battery',
          state: 'idle',
          duration_hours: 1,
          power: {
            kind: 'component',
            qualified_value_id: 'idle',
            context: { operating_state: 'idle', electrical_domain: 'dc', supply_voltage_v: 24 },
          },
        },
      ],
      battery_banks: [],
    },
  );
  return { record, input };
};
