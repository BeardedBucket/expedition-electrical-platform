import { describe, expect, it } from 'vitest';
import {
  evaluateInstalledInteraction,
  type ComponentLibraryRecord,
  type InstalledInteractionParticipantMapping,
  type InstalledInteractionEvaluationContext,
  type ReferenceSystem,
  type ReviewedInteractionRelationship,
} from '../src/index.js';

const catalog: ComponentLibraryRecord[] = [
  {
    id: 'synthetic.source',
    manufacturer: 'Synthetic',
    model: 'Source',
    category: 'monitor',
    verification_status: 'unverified',
    interaction_endpoints: [{ id: 'bus', kind: 'communication' }],
  },
  {
    id: 'synthetic.sink',
    manufacturer: 'Synthetic',
    model: 'Sink',
    category: 'gateway',
    verification_status: 'unverified',
    interaction_endpoints: [{ id: 'bus', kind: 'communication' }],
  },
];

const endpoint = (instance_id: string, endpoint_id = 'bus') => ({ instance_id, endpoint_id });

const system = (overrides: Partial<ReferenceSystem> = {}): ReferenceSystem => ({
  schema_version: '0.1.0',
  id: 'synthetic.system',
  name: 'Synthetic system',
  status: 'installed',
  component_instances: [
    { id: 'source-1', component_id: 'synthetic.source', status: 'installed' },
    { id: 'source-2', component_id: 'synthetic.source', status: 'installed' },
    { id: 'sink-1', component_id: 'synthetic.sink', status: 'installed' },
  ],
  ...overrides,
});

const relationship = (
  overrides: Partial<ReviewedInteractionRelationship> = {},
): ReviewedInteractionRelationship => ({
  id: 'reviewed-link',
  assertion: 'positive',
  state: 'verified',
  normalized_participants: [
    { id: 'source', reference: { kind: 'component', component_id: 'synthetic.source' } },
    {
      id: 'sink',
      reference: {
        kind: 'interaction_endpoint',
        component_id: 'synthetic.sink',
        endpoint_id: 'bus',
      },
    },
  ],
  evidence: { source_ids: ['source.g7'], fact_ids: ['fact.g7'] },
  ...overrides,
});

const mappings: InstalledInteractionParticipantMapping[] = [
  { participant_id: 'source', target: { kind: 'component_instance', instance_id: 'source-1' } },
  {
    participant_id: 'sink',
    target: { kind: 'interaction_endpoint', endpoint: endpoint('sink-1') },
  },
];

const direct = (state: 'connected' | 'disconnected' = 'connected') => ({
  id: 'direct-link',
  kind: 'direct' as const,
  participants: [{ endpoint: endpoint('source-1') }, { endpoint: endpoint('sink-1') }],
  state,
});

const evaluate = (
  overrides: Partial<ReviewedInteractionRelationship> = {},
  systemOverrides: Partial<ReferenceSystem> = { interaction_relationships: [direct()] },
  extra: Partial<Parameters<typeof evaluateInstalledInteraction>[0]> = {},
) =>
  evaluateInstalledInteraction({
    relationship: relationship(overrides),
    reference_system: system(systemOverrides),
    catalog,
    mappings,
    selected_topology: { kind: 'direct', relationship_id: 'direct-link' },
    ...extra,
  });

describe('installed interaction evaluation', () => {
  it('satisfies a positive assertion with exact mapping and connected direct topology', () => {
    expect(evaluate().status).toBe('satisfied');
  });

  it('reports explicit disconnected matching topology as not satisfied', () => {
    expect(evaluate({}, { interaction_relationships: [direct('disconnected')] }).status).toBe(
      'not_satisfied',
    );
  });

  it('reports an applicable negative assertion as not satisfied', () => {
    expect(evaluate({ assertion: 'negative' }).status).toBe('not_satisfied');
  });

  it.each(['unresolved', 'provisional', 'conflicting'] as const)(
    'reports %s reviewed state as unknown',
    (state) => {
      expect(evaluate({ state }).status).toBe('unknown');
    },
  );

  it('reports missing, duplicate, incompatible, and mismatched mappings as unknown', () => {
    expect(evaluate({}, undefined, { mappings: [mappings[0]!] }).status).toBe('unknown');
    expect(evaluate({}, undefined, { mappings: [...mappings, mappings[0]!] }).status).toBe(
      'unknown',
    );
    expect(
      evaluate({}, undefined, {
        mappings: [
          {
            participant_id: 'source',
            target: { kind: 'interaction_endpoint', endpoint: endpoint('source-1') },
          },
          mappings[1]!,
        ],
      }).status,
    ).toBe('unknown');
    expect(
      evaluate({}, undefined, {
        mappings: [
          mappings[0]!,
          {
            participant_id: 'sink',
            target: { kind: 'interaction_endpoint', endpoint: endpoint('source-1') },
          },
        ],
      }).status,
    ).toBe('unknown');
  });

  it('does not turn topology failure into incompatibility when applicability is unknown or mismatched', () => {
    const applicability = {
      id: 'firmware',
      target_participant_id: 'source',
      kind: 'firmware' as const,
      operator: 'equals' as const,
      value: '3.0',
    };
    expect(
      evaluate(
        { applicability: [applicability] },
        { interaction_relationships: [direct('disconnected')] },
      ).status,
    ).toBe('unknown');
    const context: InstalledInteractionEvaluationContext = {
      qualifiers: [
        {
          target: { kind: 'component_instance', instance_id: 'source-1' },
          kind: 'firmware',
          value: '2.0',
          source_refs: [{ id: 'source.firmware', title: 'Firmware record' }],
        },
      ],
    };
    expect(
      evaluate(
        {
          applicability: [applicability],
          prerequisites: [
            {
              id: 'mode',
              kind: 'configuration',
              target: { kind: 'relationship' },
              key: 'mode',
              operator: 'equals',
              value: 'required',
            },
          ],
        },
        { interaction_relationships: [direct()] },
        { context },
      ).status,
    ).toBe('unknown');
  });

  it('keeps an applicable negative decisive when a configuration prerequisite is missing', () => {
    const result = evaluate({
      assertion: 'negative',
      prerequisites: [
        {
          id: 'mode',
          kind: 'configuration',
          target: { kind: 'relationship' },
          key: 'mode',
          operator: 'equals',
          value: 'required',
        },
      ],
    });
    expect(result.status).toBe('not_satisfied');
    expect(result.reasons.some((item) => item.code === 'configuration_unknown')).toBe(true);
  });

  it('keeps two instances of one canonical component distinct', () => {
    const result = evaluate(
      {},
      { interaction_relationships: [direct()] },
      {
        mappings: [
          {
            participant_id: 'source',
            target: { kind: 'component_instance', instance_id: 'source-2' },
          },
          mappings[1]!,
        ],
      },
    );
    expect(result.status).toBe('unknown');
    expect(result.provenance.participant_mappings[0]?.target).toEqual({
      kind: 'component_instance',
      instance_id: 'source-2',
    });
  });

  it('requires the canonical component owner for repeated product-local endpoint IDs', () => {
    const endpointRelationship = {
      ...relationship(),
      normalized_participants: [
        relationship().normalized_participants[0]!,
        {
          id: 'sink',
          reference: {
            kind: 'interaction_endpoint' as const,
            component_id: 'synthetic.source',
            endpoint_id: 'bus',
          },
        },
      ],
    };
    expect(
      evaluate(
        endpointRelationship,
        { interaction_relationships: [direct()] },
        {
          mappings: [
            mappings[0]!,
            {
              participant_id: 'sink',
              target: { kind: 'interaction_endpoint', endpoint: endpoint('sink-1') },
            },
          ],
        },
      ).status,
    ).toBe('unknown');
    expect(
      evaluate(
        endpointRelationship,
        { interaction_relationships: [direct()] },
        {
          mappings: [
            mappings[0]!,
            {
              participant_id: 'sink',
              target: { kind: 'interaction_endpoint', endpoint: endpoint('source-1') },
            },
          ],
        },
      ).status,
    ).toBe('satisfied');
  });

  it('does not canonicalize unresolved external participants', () => {
    const result = evaluate({
      normalized_participants: [
        { id: 'source', reference: { kind: 'unresolved_external', reference: 'unknown-device' } },
        relationship().normalized_participants[1]!,
      ],
    });
    expect(result.status).toBe('unknown');
    expect(result.reasons.some((item) => item.code === 'unresolved_participant')).toBe(true);
  });

  it('does not treat the wrong topology form as an explicit failure', () => {
    const result = evaluate(
      {
        prerequisites: [
          {
            id: 'connection',
            kind: 'connection',
            participant_ids: ['source', 'sink'],
            topology: 'direct',
          },
        ],
      },
      {
        interaction_networks: [
          {
            id: 'network-link',
            participants: [{ endpoint: endpoint('source-1') }, { endpoint: endpoint('sink-1') }],
            state: 'connected',
          },
        ],
      },
      {
        selected_topology: { kind: 'network', network_id: 'network-link' },
        prerequisite_topology_selections: [
          {
            prerequisite_id: 'connection',
            topology: { kind: 'network', network_id: 'network-link' },
          },
        ],
      },
    );
    expect(result.status).toBe('unknown');
  });

  it('evaluates direct, shared-network, and direct-or-shared prerequisites explicitly', () => {
    const network = {
      id: 'network-link',
      participants: [{ endpoint: endpoint('source-1') }, { endpoint: endpoint('sink-1') }],
      state: 'connected' as const,
    };
    const directPrerequisite = {
      id: 'connection',
      kind: 'connection' as const,
      participant_ids: ['source', 'sink'] as [string, string],
      topology: 'direct' as const,
    };
    expect(
      evaluate(
        { prerequisites: [directPrerequisite] },
        { interaction_relationships: [direct()] },
        {
          prerequisite_topology_selections: [
            {
              prerequisite_id: 'connection',
              topology: { kind: 'direct', relationship_id: 'direct-link' },
            },
          ],
        },
      ).status,
    ).toBe('satisfied');
    expect(
      evaluate(
        { prerequisites: [{ ...directPrerequisite, topology: 'shared_network' }] },
        { interaction_networks: [network] },
        {
          selected_topology: { kind: 'network', network_id: 'network-link' },
          prerequisite_topology_selections: [
            {
              prerequisite_id: 'connection',
              topology: { kind: 'network', network_id: 'network-link' },
            },
          ],
        },
      ).status,
    ).toBe('satisfied');
    expect(
      evaluate(
        { prerequisites: [{ ...directPrerequisite, topology: 'direct_or_shared_network' }] },
        { interaction_networks: [network] },
        {
          selected_topology: { kind: 'network', network_id: 'network-link' },
          prerequisite_topology_selections: [
            {
              prerequisite_id: 'connection',
              topology: { kind: 'network', network_id: 'network-link' },
            },
          ],
        },
      ).status,
    ).toBe('satisfied');
  });

  it('does not treat absent topology as disconnected', () => {
    expect(evaluate({}, {}, { selected_topology: undefined }).status).toBe('unknown');
  });

  it('matches typed configuration values without coercion and supports present null', () => {
    const prerequisite = {
      id: 'mode',
      kind: 'configuration' as const,
      target: { kind: 'relationship' as const },
      key: 'mode',
      operator: 'equals' as const,
      value: 1,
    };
    expect(
      evaluate({ prerequisites: [prerequisite] }, {
        ...system(),
        interaction_relationships: [direct()],
        interaction_configurations: [
          { id: 'mode-1', target: { relationship_id: 'direct-link' }, key: 'mode', value: 1 },
        ],
      } as Partial<ReferenceSystem>),
    ).toBeDefined();
    expect(
      evaluate(
        { prerequisites: [prerequisite] },
        {
          interaction_relationships: [direct()],
          interaction_configurations: [
            { id: 'mode-1', target: { relationship_id: 'direct-link' }, key: 'mode', value: '1' },
          ],
        },
      ).status,
    ).toBe('not_satisfied');
    expect(
      evaluate(
        { prerequisites: [{ ...prerequisite, operator: 'present', value: undefined }] },
        {
          interaction_relationships: [direct()],
          interaction_configurations: [
            { id: 'mode-1', target: { relationship_id: 'direct-link' }, key: 'mode', value: null },
          ],
        },
      ).status,
    ).toBe('satisfied');
  });

  it('treats missing optional intermediate lists as unknown', () => {
    const prerequisite = { id: 'gateway', kind: 'intermediate' as const, participant_id: 'source' };
    const result = evaluate(
      { prerequisites: [prerequisite] },
      { interaction_relationships: [direct()] },
      {
        prerequisite_topology_selections: [
          {
            prerequisite_id: 'gateway',
            topology: { kind: 'direct', relationship_id: 'direct-link' },
          },
        ],
      },
    );
    expect(result.status).toBe('unknown');
    expect(result.reasons.some((item) => item.code === 'required_intermediate_unknown')).toBe(true);
  });

  it('satisfies an explicitly listed intermediate and keeps an incomplete list unknown', () => {
    const prerequisite = { id: 'gateway', kind: 'intermediate' as const, participant_id: 'source' };
    const listed = evaluate(
      { prerequisites: [prerequisite] },
      { interaction_relationships: [{ ...direct(), intermediate_object_ids: ['source-1'] }] },
      {
        prerequisite_topology_selections: [
          {
            prerequisite_id: 'gateway',
            topology: { kind: 'direct', relationship_id: 'direct-link' },
          },
        ],
      },
    );
    expect(listed.status).toBe('satisfied');
    const incomplete = evaluate(
      { prerequisites: [prerequisite] },
      { interaction_relationships: [{ ...direct(), intermediate_object_ids: ['other-object'] }] },
      {
        prerequisite_topology_selections: [
          {
            prerequisite_id: 'gateway',
            topology: { kind: 'direct', relationship_id: 'direct-link' },
          },
        ],
      },
    );
    expect(incomplete.status).toBe('unknown');
  });

  it('evaluates hardware revision match, mismatch, missing, and conflict explicitly', () => {
    const applicability = {
      id: 'revision',
      target_participant_id: 'source',
      kind: 'hardware_revision' as const,
      operator: 'equals' as const,
      value: 'rev-b',
    };
    const qualifier = (value: string) => ({
      target: { kind: 'component_instance' as const, instance_id: 'source-1' },
      kind: 'hardware_revision' as const,
      value,
      source_refs: [{ id: `source.${value}`, title: 'Revision record' }],
    });
    expect(
      evaluate({ applicability: [applicability] }, undefined, {
        context: { qualifiers: [qualifier('rev-b')] },
      }).status,
    ).toBe('satisfied');
    expect(
      evaluate({ applicability: [applicability] }, undefined, {
        context: { qualifiers: [qualifier('rev-a')] },
      }).status,
    ).toBe('unknown');
    expect(evaluate({ applicability: [applicability] }).status).toBe('unknown');
    expect(
      evaluate({ applicability: [applicability] }, undefined, {
        context: { qualifiers: [qualifier('rev-a'), qualifier('rev-b')] },
      }).status,
    ).toBe('unknown');
  });

  it('composes multiple satisfied, failed, and unknown prerequisites deterministically', () => {
    const connection = {
      id: 'connection',
      kind: 'connection' as const,
      participant_ids: ['source', 'sink'] as [string, string],
      topology: 'direct' as const,
    };
    const configuration = {
      id: 'mode',
      kind: 'configuration' as const,
      target: { kind: 'relationship' as const },
      key: 'mode',
      operator: 'equals' as const,
      value: 'required',
    };
    const selection = [
      {
        prerequisite_id: 'connection',
        topology: { kind: 'direct' as const, relationship_id: 'direct-link' },
      },
    ];
    const configuredSystem = {
      interaction_relationships: [direct()],
      interaction_configurations: [
        {
          id: 'mode-1',
          target: { relationship_id: 'direct-link' },
          key: 'mode',
          value: 'required' as const,
        },
      ],
    };
    expect(
      evaluate({ prerequisites: [connection, configuration] }, configuredSystem, {
        prerequisite_topology_selections: selection,
      }).status,
    ).toBe('satisfied');
    expect(
      evaluate(
        { prerequisites: [connection, { ...configuration, value: 'wrong' }] },
        configuredSystem,
        { prerequisite_topology_selections: selection },
      ).status,
    ).toBe('not_satisfied');
    expect(
      evaluate(
        { prerequisites: [connection, { id: 'unknown', kind: 'other', raw_value: 'unresolved' }] },
        configuredSystem,
        { prerequisite_topology_selections: selection },
      ).status,
    ).toBe('unknown');
    expect(
      evaluate(
        {
          prerequisites: [
            { ...configuration, value: 'wrong' },
            { id: 'unknown', kind: 'other', raw_value: 'unresolved' },
          ],
        },
        configuredSystem,
        { prerequisite_topology_selections: selection },
      ).status,
    ).toBe('not_satisfied');
  });

  it('treats explicit applicability mismatch and missing qualifiers as unknown', () => {
    const applicability = {
      id: 'firmware',
      target_participant_id: 'source',
      kind: 'firmware' as const,
      operator: 'equals' as const,
      value: '3.0',
    };
    expect(evaluate({ applicability: [applicability] }).status).toBe('unknown');
    const context: InstalledInteractionEvaluationContext = {
      qualifiers: [
        {
          target: { kind: 'component_instance', instance_id: 'source-1' },
          kind: 'firmware',
          value: '2.0',
          source_refs: [{ id: 'source.firmware', title: 'Firmware record' }],
        },
      ],
    };
    expect(evaluate({ applicability: [applicability] }, undefined, { context }).status).toBe(
      'unknown',
    );
  });

  it('returns not satisfied for an explicit prerequisite failure despite another unknown prerequisite', () => {
    const result = evaluate(
      {
        prerequisites: [
          {
            id: 'mode',
            kind: 'configuration',
            target: { kind: 'relationship' },
            key: 'mode',
            operator: 'equals',
            value: 'required',
          },
          { id: 'unknown', kind: 'other', raw_value: 'unresolved condition' },
        ],
      },
      {
        interaction_relationships: [direct()],
        interaction_configurations: [
          {
            id: 'mode-1',
            target: { relationship_id: 'direct-link' },
            key: 'mode',
            value: 'different',
          },
        ],
      },
    );
    expect(result.status).toBe('not_satisfied');
  });

  it('does not let evidence scope or marketing metadata alter canonical evaluation', () => {
    const result = evaluate();
    const changedEvidence = evaluate({
      ...relationship(),
      evidence_scopes: [
        {
          id: 'family-scope',
          kind: 'family',
          resolution: 'resolved',
          resolved_component_ids: ['other'],
          source_reference: 'other-family',
          source_ids: ['source.other'],
          fact_ids: ['fact.other'],
        },
      ],
    });
    const changedCatalog = evaluate({}, undefined, {
      catalog: catalog.map((component) => ({
        ...component,
        manufacturer: 'Different',
        model: 'Different display',
        category: 'other',
      })),
    });
    expect(changedEvidence.status).toBe(result.status);
    expect(changedCatalog.status).toBe(result.status);
  });

  it('preserves G5 information direction without inventing G6 topology direction', () => {
    const result = evaluate({
      normalized_information: [{ direction: 'exposes', participant_id: 'source', term: 'state' }],
    });
    expect(result).not.toHaveProperty('availability');
    expect(result).not.toHaveProperty('direction');
    expect(result.status).toBe('satisfied');
  });

  it('is deterministic and preserves provenance', () => {
    const first = evaluate();
    const second = evaluate();
    expect(second).toEqual(first);
    expect(first.provenance.reviewed_relationship_id).toBe('reviewed-link');
    expect(first.provenance.selected_relationship_id).toBe('direct-link');
    expect(first.reasons.map((item) => item.code)).toEqual(second.reasons.map((item) => item.code));
    expect(first.provenance.participant_mappings.map((item) => item.participant_id)).toEqual([
      'source',
      'sink',
    ]);
  });

  it('is unaffected by relationship grouping metadata', () => {
    const plain = evaluate();
    const grouped = evaluate(
      {},
      {
        ...system({ interaction_relationships: [direct()] }),
        interaction_relationship_groups: [{ id: 'group-1', relationship_ids: ['direct-link'] }],
      },
    );
    expect(grouped.status).toBe(plain.status);
    expect(grouped.provenance).toEqual(plain.provenance);
  });
});
