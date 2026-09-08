import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  validateReferenceSystem,
  type ComponentLibraryRecord,
  type ConnectionEndpoint,
  type ComponentPhysicalConnector,
  type InstalledTerminalRef,
  type ReferenceSystem,
} from '../src/index.js';
import referenceSystemSchema from '../../../data/schemas/reference-system.schema.json' with { type: 'json' };

const components: ComponentLibraryRecord[] = [
  {
    id: 'synthetic.device',
    manufacturer: 'Synthetic',
    model: 'Device',
    category: 'monitor',
    verification_status: 'unverified',
    terminals: [{ id: 'connector', function: 'communication' }],
    physical_connectors: [
      { id: 'bus-1', type: 'RJ45', notes: 'Equivalent bus socket' },
      { id: 'bus-2', type: 'RJ45', notes: 'Equivalent bus socket' },
    ],
    interaction_endpoints: [
      { id: 'bus', kind: 'communication' },
      { id: 'control', kind: 'control' },
    ],
  },
  {
    id: 'synthetic.gateway',
    manufacturer: 'Synthetic',
    model: 'Gateway',
    category: 'gateway',
    verification_status: 'unverified',
    terminals: [{ id: 'connector', function: 'communication' }],
    interaction_endpoints: [{ id: 'bus', kind: 'communication' }],
  },
];

const baseSystem = (overrides: Partial<ReferenceSystem> = {}): ReferenceSystem => ({
  schema_version: '0.1.0',
  id: 'synthetic.installed',
  name: 'Synthetic installed interaction system',
  status: 'installed',
  component_instances: [
    { id: 'device-a', component_id: 'synthetic.device', status: 'installed' },
    { id: 'device-b', component_id: 'synthetic.device', status: 'installed' },
    { id: 'gateway-1', component_id: 'synthetic.gateway', status: 'installed' },
  ],
  ...overrides,
});

const endpoint = (instance_id: string, endpoint_id = 'bus') => ({
  instance_id,
  endpoint_id,
});
const schemaAjv = new Ajv2020({ allErrors: true, strict: false });
addFormats(schemaAjv);
const validateSchema = schemaAjv.compile(referenceSystemSchema);

describe('installed interaction architecture validation', () => {
  it('keeps identical products distinct and validates a direct wired relationship', () => {
    const system = baseSystem({
      interaction_relationships: [
        {
          id: 'device-link',
          kind: 'direct',
          participants: [{ endpoint: endpoint('device-a') }, { endpoint: endpoint('device-b') }],
          state: 'connected',
          medium: 'wired',
        },
      ],
    });
    expect(validateReferenceSystem(system, { components }).ok).toBe(true);
    expect(system.component_instances?.[0]?.component_id).toBe(
      system.component_instances?.[1]?.component_id,
    );
    expect(system.component_instances?.[0]?.id).not.toBe(system.component_instances?.[1]?.id);
  });

  it('supports wireless relationships without physical bindings and explicit disconnection', () => {
    const result = validateReferenceSystem(
      baseSystem({
        interaction_relationships: [
          {
            id: 'wireless-link',
            kind: 'direct',
            participants: [{ endpoint: endpoint('device-a') }, { endpoint: endpoint('device-b') }],
            state: 'connected',
            medium: 'wireless',
          },
          {
            id: 'disconnected-link',
            kind: 'direct',
            participants: [
              { endpoint: endpoint('device-a', 'control') },
              { endpoint: endpoint('device-b', 'control') },
            ],
            state: 'disconnected',
          },
        ],
      }),
      { components },
    );
    expect(result.ok).toBe(true);
  });

  it.each(['wired', 'wireless', 'other'] as const)(
    'accepts explicitly asserted %s medium',
    (medium) => {
      const result = validateReferenceSystem(
        baseSystem({
          interaction_relationships: [
            {
              id: `medium-${medium}`,
              kind: 'direct',
              participants: [
                { endpoint: endpoint('device-a') },
                { endpoint: endpoint('device-b') },
              ],
              state: 'connected',
              medium,
            },
          ],
        }),
        { components },
      );
      expect(result.ok).toBe(true);
    },
  );

  it('treats omitted medium as unknown/unmodeled without synthesizing a value', () => {
    const system = baseSystem({
      interaction_relationships: [
        {
          id: 'medium-omitted',
          kind: 'direct',
          participants: [{ endpoint: endpoint('device-a') }, { endpoint: endpoint('device-b') }],
          state: 'connected',
        },
      ],
    });
    expect(validateReferenceSystem(system, { components }).ok).toBe(true);
    expect(system.interaction_relationships?.[0]?.medium).toBeUndefined();
    expect(validateSchema(system)).toBe(true);
    expect(system.interaction_relationships?.[0]).not.toHaveProperty('mechanism');
  });

  it('rejects explicit unknown medium without inferring medium from bindings', () => {
    const unknownMedium = baseSystem({
      interaction_relationships: [
        {
          id: 'medium-unknown',
          kind: 'direct',
          participants: [{ endpoint: endpoint('device-a') }, { endpoint: endpoint('device-b') }],
          state: 'connected',
          medium: 'unknown' as never,
        },
      ],
    });
    expect(validateReferenceSystem(unknownMedium, { components }).ok).toBe(false);
    expect(validateSchema(unknownMedium)).toBe(false);

    const boundWithoutMedium = baseSystem({
      interaction_bindings: [
        {
          id: 'physical-binding',
          endpoint: endpoint('device-a'),
          target: {
            kind: 'terminal',
            terminal: { instance_id: 'device-a', terminal_id: 'connector' },
          },
        },
      ],
      interaction_relationships: [
        {
          id: 'no-inferred-medium',
          kind: 'direct',
          participants: [{ endpoint: endpoint('device-a') }, { endpoint: endpoint('device-b') }],
          state: 'connected',
        },
      ],
    });
    expect(validateReferenceSystem(boundWithoutMedium, { components }).ok).toBe(true);
    expect(boundWithoutMedium.interaction_relationships?.[0]?.medium).toBeUndefined();
  });

  it('represents a shared network without implying pairwise direct relationships', () => {
    const system = baseSystem({
      interaction_networks: [
        {
          id: 'shared-bus',
          participants: [
            { endpoint: endpoint('device-a') },
            { endpoint: endpoint('device-b') },
            { endpoint: endpoint('gateway-1') },
          ],
          state: 'connected',
          medium: 'wired',
        },
      ],
    });
    expect(validateReferenceSystem(system, { components }).ok).toBe(true);
    expect(system.interaction_relationships).toBeUndefined();
  });

  it('supports catalog and non-catalog intermediates, groups, and configuration declarations', () => {
    const system = baseSystem({
      artifacts: [{ id: 'field-cable-1', kind: 'cable', label: 'Field cable' }],
      interaction_relationships: [
        {
          id: 'a-to-gateway',
          kind: 'direct',
          participants: [{ endpoint: endpoint('device-a') }, { endpoint: endpoint('gateway-1') }],
          state: 'connected',
          intermediate_object_ids: ['field-cable-1'],
          configuration_ids: ['gateway-config'],
        },
        {
          id: 'gateway-to-b',
          kind: 'direct',
          participants: [{ endpoint: endpoint('gateway-1') }, { endpoint: endpoint('device-b') }],
          state: 'connected',
          intermediate_object_ids: ['gateway-1'],
        },
      ],
      interaction_relationship_groups: [
        { id: 'gateway-chain', relationship_ids: ['a-to-gateway', 'gateway-to-b'] },
      ],
      interaction_configurations: [
        {
          id: 'gateway-config',
          target: { relationship_id: 'a-to-gateway' },
          key: 'mode',
          value: 'enabled',
        },
      ],
    });
    expect(validateReferenceSystem(system, { components }).ok).toBe(true);
  });

  it('supports optional logical-to-physical bindings and shared physical connectors', () => {
    const sharedTerminal: InstalledTerminalRef = {
      instance_id: 'device-a',
      terminal_id: 'connector',
    };
    const electricalEndpoint: ConnectionEndpoint = sharedTerminal;
    const system = baseSystem({
      interaction_bindings: [
        {
          id: 'binding-a',
          endpoint: endpoint('device-a'),
          target: {
            kind: 'terminal',
            terminal: electricalEndpoint,
          },
        },
        {
          id: 'binding-b',
          endpoint: endpoint('device-b'),
          target: {
            kind: 'terminal',
            terminal: { instance_id: 'device-a', terminal_id: 'connector' },
          },
        },
      ],
    });
    expect(validateReferenceSystem(system, { components }).ok).toBe(true);
  });

  it('binds an interaction endpoint to an electrical connection without requiring binding', () => {
    const system = baseSystem({
      connections: [
        {
          id: 'physical-link',
          from: { instance_id: 'device-a', terminal_id: 'connector' },
          to: { instance_id: 'device-b', terminal_id: 'connector' },
          status: 'installed',
        },
      ],
      interaction_bindings: [
        {
          id: 'connection-binding',
          endpoint: endpoint('device-a'),
          target: { kind: 'connection', connection_id: 'physical-link' },
        },
      ],
    });
    expect(validateReferenceSystem(system, { components }).ok).toBe(true);
    expect(validateSchema(system)).toBe(true);
  });

  it('keeps whole-connection association distinct from terminal endpoint identity', () => {
    const system = baseSystem({
      connections: [
        {
          id: 'physical-link',
          from: { instance_id: 'device-a', terminal_id: 'connector' },
          to: { instance_id: 'device-b', terminal_id: 'connector' },
          status: 'installed',
        },
      ],
      interaction_bindings: [
        {
          id: 'whole-link-association',
          endpoint: endpoint('device-a'),
          target: { kind: 'connection', connection_id: 'physical-link' },
        },
      ],
    });
    expect(validateReferenceSystem(system, { components }).ok).toBe(true);
    expect(system.interaction_bindings?.[0]?.target).toEqual({
      kind: 'connection',
      connection_id: 'physical-link',
    });
  });

  it('rejects node and artifact binding targets because they have no G6 physical endpoint semantics', () => {
    const result = validateReferenceSystem(
      baseSystem({
        artifacts: [{ id: 'field-cable-1', kind: 'cable' }],
        interaction_bindings: [
          {
            id: 'node-binding',
            endpoint: endpoint('device-a'),
            target: { kind: 'node', node_id: 'bus' } as never,
          },
          {
            id: 'artifact-binding',
            endpoint: endpoint('device-b'),
            target: { kind: 'artifact', artifact_id: 'field-cable-1' } as never,
          },
        ],
      }),
      { components },
    );
    expect(
      result.issues.filter((issue) => issue.code === 'invalid_interaction_binding_target'),
    ).toHaveLength(2);
  });

  it('supports multiple physical terminal contacts without inventing contact identity', () => {
    const system = baseSystem({
      interaction_bindings: [
        {
          id: 'contact-a',
          endpoint: endpoint('device-a'),
          target: {
            kind: 'terminal',
            terminal: { instance_id: 'device-a', terminal_id: 'connector' },
          },
        },
        {
          id: 'contact-b',
          endpoint: endpoint('device-a'),
          target: {
            kind: 'terminal',
            terminal: { instance_id: 'device-b', terminal_id: 'connector' },
          },
        },
      ],
    });
    expect(validateReferenceSystem(system, { components }).ok).toBe(true);
  });

  it('allows one physical electrical identity to be shared by power and data layers', () => {
    const system = baseSystem({
      connections: [
        {
          id: 'power-and-data-link',
          from: { instance_id: 'device-a', terminal_id: 'connector' },
          to: { instance_id: 'device-b', terminal_id: 'connector' },
          domain: 'dc',
          status: 'installed',
        },
      ],
      interaction_relationships: [
        {
          id: 'data-over-link',
          kind: 'direct',
          participants: [{ endpoint: endpoint('device-a') }, { endpoint: endpoint('device-b') }],
          state: 'connected',
          medium: 'wired',
        },
      ],
      interaction_bindings: [
        {
          id: 'data-link-binding',
          endpoint: endpoint('device-a'),
          target: { kind: 'connection', connection_id: 'power-and-data-link' },
        },
      ],
    });
    expect(validateReferenceSystem(system, { components }).ok).toBe(true);
  });

  it('rejects cross-type ID collisions and dangling interaction references', () => {
    const result = validateReferenceSystem(
      baseSystem({
        artifacts: [{ id: 'device-a', kind: 'adapter' }],
        interaction_relationships: [
          {
            id: 'bad-link',
            kind: 'direct',
            participants: [{ endpoint: endpoint('missing') }, { endpoint: endpoint('device-b') }],
            state: 'connected',
            intermediate_object_ids: ['missing-artifact'],
          },
        ],
        interaction_relationship_groups: [{ id: 'bad-group', relationship_ids: ['missing-link'] }],
        interaction_configurations: [
          {
            id: 'bad-config',
            target: { network_id: 'missing-network' },
            key: 'mode',
            value: true,
          },
        ],
      }),
      { components },
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'duplicate_installed_object_id',
        'missing_interaction_reference',
        'missing_interaction_relationship',
        'missing_interaction_network',
      ]),
    );
  });

  it('keeps missing relationships unknown and does not require G5 evidence', () => {
    const result = validateReferenceSystem(baseSystem(), { components });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('distinguishes missing instances, missing product endpoints, and missing artifacts', () => {
    const result = validateReferenceSystem(
      baseSystem({
        artifacts: [{ id: 'artifact-1', kind: 'adapter' }],
        interaction_relationships: [
          {
            id: 'missing-endpoint',
            kind: 'direct',
            participants: [
              { endpoint: endpoint('missing-instance') },
              { endpoint: endpoint('device-a', 'missing-endpoint') },
            ],
            state: 'connected',
            intermediate_object_ids: ['missing-artifact'],
          },
        ],
      }),
      { components },
    );
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'missing_interaction_reference',
        'invalid_interaction_endpoint_reference',
      ]),
    );
  });

  it('keeps electrical and interaction topology independent on a stationary-shaped system', () => {
    const system = baseSystem({
      name: 'Stationary control cabinet',
      connections: [
        {
          id: 'data-power-independent',
          from: { instance_id: 'device-a', terminal_id: 'connector' },
          to: { instance_id: 'device-b', terminal_id: 'connector' },
          domain: 'dc',
          status: 'installed',
        },
      ],
      interaction_relationships: [
        {
          id: 'data-link',
          kind: 'direct',
          participants: [{ endpoint: endpoint('device-a') }, { endpoint: endpoint('device-b') }],
          state: 'connected',
          medium: 'wireless',
        },
      ],
    });
    expect(validateReferenceSystem(system, { components }).ok).toBe(true);
  });

  it('preserves deterministic issue ordering for equivalent invalid systems', () => {
    const system = baseSystem({
      interaction_relationships: [
        {
          id: 'bad',
          kind: 'direct',
          participants: [{ endpoint: endpoint('missing') }],
          state: 'connected',
        },
      ],
    });
    const first = validateReferenceSystem(system, { components });
    const second = validateReferenceSystem(structuredClone(system), { components });
    expect(first.issues).toEqual(second.issues);
  });

  it('models repeated equivalent physical connectors with stable product-local IDs', () => {
    const connector: ComponentPhysicalConnector = {
      id: 'hub-1',
      type: 'network-socket',
    };
    const repeatedComponent: ComponentLibraryRecord = {
      ...components[0],
      id: 'synthetic.hub',
      physical_connectors: [
        connector,
        { ...connector, id: 'hub-2' },
        { ...connector, id: 'hub-3' },
      ],
      physical_connector_associations: [
        {
          id: 'hub-1-bus',
          connector_id: 'hub-1',
          target: { kind: 'interaction_endpoint', id: 'bus' },
        },
        {
          id: 'hub-2-bus',
          connector_id: 'hub-2',
          target: { kind: 'interaction_endpoint', id: 'bus' },
        },
        {
          id: 'hub-3-bus',
          connector_id: 'hub-3',
          target: { kind: 'interaction_endpoint', id: 'bus' },
        },
      ],
    };
    const system = baseSystem({
      component_instances: [
        { id: 'hub-a', component_id: repeatedComponent.id, status: 'installed' },
        { id: 'hub-b', component_id: repeatedComponent.id, status: 'installed' },
      ],
      interaction_bindings: [
        {
          id: 'hub-a-connector-1',
          endpoint: endpoint('hub-a'),
          target: { kind: 'connector', connector: { instance_id: 'hub-a', connector_id: 'hub-1' } },
        },
        {
          id: 'hub-a-connector-2',
          endpoint: endpoint('hub-a'),
          target: { kind: 'connector', connector: { instance_id: 'hub-a', connector_id: 'hub-2' } },
        },
        {
          id: 'hub-b-connector-1',
          endpoint: endpoint('hub-b'),
          target: { kind: 'connector', connector: { instance_id: 'hub-b', connector_id: 'hub-1' } },
        },
      ],
    });
    expect(
      validateReferenceSystem(system, { components: [...components, repeatedComponent] }).ok,
    ).toBe(true);
    expect(system.interaction_bindings?.[0]?.target).not.toEqual(
      system.interaction_bindings?.[1]?.target,
    );
  });

  it('rejects duplicate and dangling physical connector references', () => {
    const malformed: ComponentLibraryRecord = {
      ...components[0],
      id: 'synthetic.malformed',
      physical_connectors: [{ id: 'duplicate' }, { id: 'duplicate' }],
      physical_connector_associations: [
        {
          id: 'dangling',
          connector_id: 'missing',
          target: { kind: 'interaction_endpoint', id: 'bus' },
        },
      ],
    };
    const system = baseSystem({
      component_instances: [{ id: 'malformed', component_id: malformed.id, status: 'installed' }],
      interaction_bindings: [
        {
          id: 'missing-connector',
          endpoint: endpoint('malformed'),
          target: {
            kind: 'connector',
            connector: { instance_id: 'malformed', connector_id: 'missing' },
          },
        },
      ],
    });
    const result = validateReferenceSystem(system, { components: [...components, malformed] });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'duplicate_physical_connector_id',
        'invalid_physical_connector_association',
        'invalid_physical_connector_reference',
      ]),
    );
  });
});
