import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import referenceSystemSchema from '../../../data/schemas/reference-system.schema.json' with { type: 'json' };
import {
  validateReferenceSystem,
  type ComponentLibraryRecord,
  type ReferenceSystem,
} from '../src/index.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(referenceSystemSchema);

const catalog: ComponentLibraryRecord[] = [
  {
    id: 'synthetic.battery',
    manufacturer: 'Synthetic',
    model: 'Battery',
    category: 'battery',
    verification_status: 'unverified',
    terminals: [
      { id: 'positive', function: 'battery', polarity: 'positive' },
      { id: 'negative', function: 'battery', polarity: 'negative' },
    ],
  },
  {
    id: 'synthetic.protection',
    manufacturer: 'Synthetic',
    model: 'Protection',
    category: 'fuse',
    verification_status: 'unverified',
    terminals: [{ id: 'line', function: 'dc_input' }],
  },
  {
    id: 'synthetic.disconnect',
    manufacturer: 'Synthetic',
    model: 'Disconnect',
    category: 'disconnect',
    verification_status: 'unverified',
    terminals: [
      { id: 'line', function: 'dc_input' },
      { id: 'load', function: 'dc_output' },
    ],
  },
  {
    id: 'synthetic.converter',
    manufacturer: 'Synthetic',
    model: 'Converter',
    category: 'converter',
    verification_status: 'unverified',
    terminals: [
      { id: 'input', function: 'dc_input' },
      { id: 'output', function: 'dc_output' },
    ],
  },
];

const fixture: ReferenceSystem = {
  schema_version: '0.1.0',
  id: 'synthetic.reference',
  name: 'Synthetic reference system',
  status: 'selected',
  nominal_system_voltage_v: 24,
  locations: [
    { id: 'vehicle', label: 'Vehicle', status: 'selected' },
    { id: 'electrical', parent_id: 'vehicle', label: 'Electrical zone', status: 'selected' },
  ],
  component_instances: [
    {
      id: 'battery-1',
      component_id: 'synthetic.battery',
      status: 'selected',
      installation_location_id: 'electrical',
    },
    {
      id: 'fuse-1',
      component_id: 'synthetic.protection',
      status: 'candidate',
      installation_location_id: 'electrical',
    },
    {
      id: 'disconnect-1',
      component_id: 'synthetic.disconnect',
      status: 'candidate',
      installation_location_id: 'electrical',
    },
    {
      id: 'converter-1',
      component_id: 'synthetic.converter',
      status: 'candidate',
      installation_location_id: 'electrical',
    },
  ],
  nodes: [
    { id: 'house-bus', kind: 'bus', domain: 'dc', nominal_voltage_v: 24, status: 'selected' },
    {
      id: 'converted-bus',
      kind: 'distribution',
      domain: 'dc',
      nominal_voltage_v: 12,
      status: 'candidate',
    },
    { id: 'pv-input', kind: 'source', domain: 'pv_dc', status: 'requirement' },
    {
      id: 'ac-output',
      kind: 'source',
      domain: 'ac',
      nominal_voltage_v: 120,
      phase: 'single',
      status: 'deferred',
    },
  ],
  conductors: [
    {
      id: 'battery-main',
      one_way_length_m: null,
      gauge: null,
      expected_current_a: null,
      nominal_voltage_v: 24,
      status: 'requirement',
      fact_basis: 'unknown',
    },
  ],
  connections: [
    {
      id: 'battery-to-bus',
      from: { instance_id: 'battery-1', terminal_id: 'positive' },
      to: { node_id: 'house-bus' },
      conductor_id: 'battery-main',
      domain: 'dc',
      nominal_voltage_v: 24,
      status: 'selected',
    },
    {
      id: 'converter-output',
      from: { instance_id: 'converter-1', terminal_id: 'output' },
      to: { node_id: 'converted-bus' },
      domain: 'dc',
      nominal_voltage_v: 12,
      status: 'candidate',
    },
  ],
  paths: [
    {
      id: 'synthetic-solar',
      kind: 'solar',
      label: 'Synthetic solar path',
      source_instance_ids: ['converter-1'],
      destination_node_ids: ['house-bus'],
      status: 'candidate',
    },
  ],
  open_questions: [
    { id: 'conductor-length', question: 'What is the measured conductor length?', status: 'open' },
  ],
};

describe('reference-system topology validation', () => {
  it('accepts a complete synthetic topology with unresolved conductor facts', () => {
    const result = validateReferenceSystem(fixture, { components: catalog });
    expect(result.status).toBe('valid');
    expect(result.issues).toEqual([]);
    expect(fixture.conductors?.[0]?.one_way_length_m).toBeNull();
  });

  it.each([
    [
      'duplicate instance IDs',
      { component_instances: [fixture.component_instances![0], fixture.component_instances![0]] },
    ],
    [
      'missing component_id',
      { component_instances: [{ id: 'bad', status: 'candidate' } as never] },
    ],
    [
      'invalid location parent',
      { locations: [{ id: 'bad', label: 'Bad', parent_id: 'missing', status: 'candidate' }] },
    ],
    ['missing node', { connections: [{ ...fixture.connections![0], to: { node_id: 'missing' } }] }],
    [
      'missing conductor',
      { connections: [{ ...fixture.connections![0], conductor_id: 'missing' }] },
    ],
    [
      'invalid protection reference',
      { connections: [{ ...fixture.connections![0], protection_instance_ids: ['missing'] }] },
    ],
    [
      'invalid path reference',
      { paths: [{ ...fixture.paths![0], destination_node_ids: ['missing'] }] },
    ],
  ])('rejects %s', (_label, changes) => {
    const result = validateReferenceSystem({ ...fixture, ...changes } as ReferenceSystem, {
      components: catalog,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects malformed endpoints with both or neither target', () => {
    const both = {
      ...fixture.connections![0],
      from: { instance_id: 'battery-1', terminal_id: 'positive', node_id: 'house-bus' },
    };
    const neither = { ...fixture.connections![0], from: {} };
    expect(
      validateReferenceSystem({ ...fixture, connections: [both] } as ReferenceSystem, {
        components: catalog,
      }).ok,
    ).toBe(false);
    expect(
      validateReferenceSystem({ ...fixture, connections: [neither] } as ReferenceSystem, {
        components: catalog,
      }).ok,
    ).toBe(false);
  });

  it('classifies unresolved catalog and terminal data separately from invalid topology', () => {
    const missingCatalog = validateReferenceSystem(fixture);
    expect(missingCatalog.status).toBe('unresolved');
    expect(missingCatalog.issues.map((item) => item.code)).toContain(
      'unresolved_catalog_component',
    );

    const legacy = { ...catalog[0], terminals: [{ function: 'battery' as const }] };
    const legacyResult = validateReferenceSystem(fixture, {
      components: [legacy, ...catalog.slice(1)],
    });
    expect(legacyResult.status).toBe('unresolved');
    expect(legacyResult.issues.map((item) => item.code)).toContain('unresolved_terminal_data');

    const invalid = validateReferenceSystem(
      {
        ...fixture,
        connections: [
          { ...fixture.connections![0], from: { instance_id: 'battery-1', terminal_id: 'bad' } },
        ],
      },
      { components: catalog },
    );
    expect(invalid.status).toBe('invalid');
    expect(invalid.issues.map((item) => item.code)).toContain('invalid_terminal_reference');
  });

  it('rejects location self-parenting and multi-node cycles', () => {
    const selfParent = validateReferenceSystem(
      { ...fixture, locations: [{ id: 'x', parent_id: 'x', label: 'X', status: 'selected' }] },
      { components: catalog },
    );
    const cycle = validateReferenceSystem(
      {
        ...fixture,
        locations: [
          { id: 'a', parent_id: 'b', label: 'A', status: 'selected' },
          { id: 'b', parent_id: 'c', label: 'B', status: 'selected' },
          { id: 'c', parent_id: 'a', label: 'C', status: 'selected' },
        ],
      },
      { components: catalog },
    );
    expect(selfParent.issues.map((item) => item.code)).toContain('location_cycle');
    expect(cycle.issues.map((item) => item.code)).toContain('location_cycle');
  });

  it('validates root and open-question runtime fields and catalog IDs', () => {
    const invalid = validateReferenceSystem(
      {
        ...fixture,
        status: 'bad' as never,
        open_questions: [
          { id: 'q', question: '', status: 'bad' as never },
          { id: 'q', question: 'duplicate', status: 'open' },
        ],
      },
      { components: catalog },
    );
    const duplicateCatalog = validateReferenceSystem(fixture, {
      components: [catalog[0], catalog[0]],
    });
    expect(invalid.status).toBe('invalid');
    expect(invalid.issues.map((item) => item.code)).toContain('invalid_status');
    expect(invalid.issues.map((item) => item.code)).toContain('duplicate_id');
    expect(duplicateCatalog.issues.map((item) => item.code)).toContain('duplicate_id');
  });

  it('validates synthetic documents through the reference-system JSON schema', () => {
    expect(validateSchema(fixture)).toBe(true);
    expect(validateSchema({ ...fixture, status: 'bad' })).toBe(false);
    expect(
      validateSchema({
        ...fixture,
        open_questions: [{ id: 'q', question: 'Q', status: 'bad' }],
      }),
    ).toBe(false);
    expect(
      validateSchema({
        ...fixture,
        connections: [
          {
            ...fixture.connections![0],
            from: { node_id: 'n', instance_id: 'i', terminal_id: 't' },
          },
        ],
      }),
    ).toBe(false);
    expect(
      validateSchema({
        ...fixture,
        conductors: [{ ...fixture.conductors![0], one_way_length_m: -1 }],
      }),
    ).toBe(false);
    expect(validateSchema({ ...fixture, unexpected: true })).toBe(false);
  });

  it('rejects invalid conductor values and unresolved terminal IDs', () => {
    const invalidConductor = {
      ...fixture.conductors![0],
      one_way_length_m: -1,
      parallel_count: 0,
    };
    const invalidTerminal = {
      ...fixture.connections![0],
      from: { instance_id: 'battery-1', terminal_id: 'not-a-terminal' },
    };
    expect(
      validateReferenceSystem({ ...fixture, conductors: [invalidConductor] } as ReferenceSystem, {
        components: catalog,
      }).ok,
    ).toBe(false);
    expect(
      validateReferenceSystem({ ...fixture, connections: [invalidTerminal] } as ReferenceSystem, {
        components: catalog,
      }).ok,
    ).toBe(false);
  });

  it('keeps multiple voltage domains explicit without calculating a voltage drop', () => {
    expect(fixture.nodes?.map((node) => [node.domain, node.nominal_voltage_v])).toEqual([
      ['dc', 24],
      ['dc', 12],
      ['pv_dc', undefined],
      ['ac', 120],
    ]);
    expect(fixture.conductors?.[0]).not.toHaveProperty('voltage_drop_v');
  });

  it('does not require terminal IDs on legacy catalog records', () => {
    const legacy = { ...catalog[0], terminals: [{ function: 'battery' as const }] };
    expect(validateReferenceSystem(fixture, { components: [legacy, ...catalog.slice(1)] }).ok).toBe(
      false,
    );
    const legacyWithoutTerminalReference = {
      ...fixture,
      connections: fixture.connections?.map((connection) =>
        connection.id === 'battery-to-bus'
          ? { ...connection, from: { node_id: 'house-bus' } }
          : connection,
      ),
    };
    expect(
      validateReferenceSystem(legacyWithoutTerminalReference, {
        components: [legacy, ...catalog.slice(1)],
      }).ok,
    ).toBe(true);
  });
});
