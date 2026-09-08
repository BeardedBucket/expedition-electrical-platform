import { describe, expect, it } from 'vitest';
import {
  canonicalInteractionRelationshipSnapshot,
  proposeCanonicalInteractionRelationship,
  validateInteractionRelationships,
  type InteractionRelationship,
} from '../src/interaction-relationships.js';

const normalized = (overrides: Partial<InteractionRelationship> = {}): InteractionRelationship => ({
  schema_version: '2.0',
  id: 'g7a.normalized',
  relationship_kind: 'information_sharing',
  assertion: 'positive',
  participants: [
    { ref: 'component.a', kind: 'exact_product', role: 'producer' },
    { ref: 'component.b', kind: 'exact_product', role: 'consumer' },
  ],
  normalized_participants: [
    {
      id: 'producer',
      reference: { kind: 'component', component_id: 'component.a' },
      role: 'producer',
    },
    {
      id: 'consumer',
      reference: {
        kind: 'interaction_endpoint',
        component_id: 'component.b',
        endpoint_id: 'endpoint.y',
      },
      role: 'consumer',
    },
  ],
  scope: 'exact_product',
  normalized_information: [
    { id: 'claim.voltage', direction: 'exposes', participant_id: 'producer', term: 'voltage' },
  ],
  evidence: {
    source_ids: ['source.g7a'],
    fact_ids: ['fact.g7a'],
    applicability: [
      { scope: 'exact_product', ref: 'component.a' },
      { scope: 'exact_product', ref: 'component.b' },
    ],
  },
  evidence_scopes: [
    {
      id: 'scope.g7a',
      kind: 'family',
      source_reference: 'source-family',
      source_ids: ['source.g7a'],
      fact_ids: ['fact.g7a'],
      resolution: 'partially_resolved',
      resolved_component_ids: ['component.a'],
    },
  ],
  state: 'verified',
  ...overrides,
});

const validOptions = {
  participantReferenceResolver: () => true,
  componentReferenceResolver: (id: string) => ['component.a', 'component.b'].includes(id),
  endpointReferenceResolver: (componentId: string, endpointId: string) =>
    componentId === 'component.b' && endpointId === 'endpoint.y',
};

describe('G7-A canonical reviewed interaction normalization', () => {
  it('accepts an exact canonical component participant', () => {
    expect(validateInteractionRelationships([normalized()], validOptions).ok).toBe(true);
  });

  it('accepts an exact canonical endpoint participant', () => {
    expect(normalized().normalized_participants?.[1].reference.kind).toBe('interaction_endpoint');
  });

  it('accepts an unresolved external participant reference', () => {
    expect(
      validateInteractionRelationships(
        [
          normalized({
            normalized_participants: [
              {
                id: 'external',
                reference: { kind: 'unresolved_external', reference: 'source-device' },
                role: 'external',
              },
              {
                id: 'consumer',
                reference: { kind: 'component', component_id: 'component.b' },
                role: 'consumer',
              },
            ],
            normalized_information: [
              {
                id: 'claim.voltage',
                direction: 'exposes',
                participant_id: 'external',
                term: 'voltage',
              },
            ],
          }),
        ],
        validOptions,
      ).ok,
    ).toBe(true);
  });

  it('keeps participant-local identity distinct from component identity', () => {
    expect(normalized().normalized_participants?.[0].id).not.toBe('component.a');
  });

  it('rejects duplicate participant local IDs', () => {
    const result = validateInteractionRelationships(
      [
        normalized({
          normalized_participants: [
            normalized().normalized_participants![0],
            { ...normalized().normalized_participants![1], id: 'producer' },
          ],
        }),
      ],
      validOptions,
    );
    expect(result.issues.some((issue) => issue.code === 'duplicate_participant_id')).toBe(true);
  });

  it('uses normalized information as the authority when legacy information contradicts it', () => {
    const result = validateInteractionRelationships(
      [
        normalized({
          information: [
            { direction: 'exposes', participant_ref: 'missing-legacy-ref', term: 'legacy' },
          ],
          normalized_information: [
            {
              id: 'claim.canonical',
              direction: 'exposes',
              participant_id: 'producer',
              term: 'canonical',
            },
          ],
        }),
      ],
      validOptions,
    );
    expect(result.issues.some((issue) => issue.code === 'invalid_information_ref')).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('keeps legacy-only records readable', () => {
    const legacy = normalized();
    const result = validateInteractionRelationships([
      {
        ...legacy,
        normalized_participants: undefined,
        normalized_information: undefined,
        evidence_scopes: undefined,
        participants: [
          { ref: 'legacy:a', kind: 'unresolved_external', role: 'producer' },
          { ref: 'legacy:b', kind: 'unresolved_external', role: 'consumer' },
        ],
        information: [{ direction: 'exposes', participant_ref: 'legacy:a', term: 'legacy' }],
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it('validates information claims by participant local ID', () => {
    expect(validateInteractionRelationships([normalized()], validOptions).ok).toBe(true);
  });

  it('requires stable information claim IDs and rejects duplicate IDs', () => {
    const missingId = normalized({
      normalized_information: [
        { direction: 'exposes', participant_id: 'producer', term: 'voltage' },
      ],
    });
    const duplicateIds = normalized({
      normalized_information: [
        { id: 'claim.voltage', direction: 'exposes', participant_id: 'producer', term: 'voltage' },
        { id: 'claim.voltage', direction: 'consumes', participant_id: 'consumer', term: 'voltage' },
      ] as unknown as InteractionRelationship['normalized_information'],
    });
    expect(validateInteractionRelationships([missingId], validOptions).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing_normalized_information_id' }),
      ]),
    );
    expect(validateInteractionRelationships([duplicateIds], validOptions).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate_normalized_information_id' }),
      ]),
    );
  });

  it('validates explicit information distribution without synthesizing consumers', () => {
    const relationship = normalized({
      normalized_information: [
        { id: 'claim.source', direction: 'exposes', participant_id: 'producer', term: 'voltage' },
        {
          id: 'claim.consumer',
          direction: 'consumes',
          participant_id: 'consumer',
          term: 'voltage',
        },
      ] as unknown as InteractionRelationship['normalized_information'],
      information_distributions: [
        {
          id: 'distribution.link',
          kind: 'explicit_consumers',
          source_claim_id: 'claim.source',
          consumer_claim_ids: ['claim.consumer'],
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
      ],
    } as unknown as InteractionRelationship);
    expect(validateInteractionRelationships([relationship], validOptions).ok).toBe(true);
    expect(relationship.information_distributions).toHaveLength(1);
  });

  it('accepts shared publication without enumerated consumers', () => {
    const relationship = normalized({
      normalized_information: [
        { id: 'claim.source', direction: 'exposes', participant_id: 'producer', term: 'voltage' },
      ] as unknown as InteractionRelationship['normalized_information'],
      information_distributions: [
        {
          id: 'distribution.shared',
          kind: 'shared_publication',
          source_claim_id: 'claim.source',
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
      ],
    } as unknown as InteractionRelationship);
    expect(validateInteractionRelationships([relationship], validOptions).ok).toBe(true);
  });

  it('validates structured control claims independently of information claims', () => {
    const relationship = normalized({
      control_claims: [
        {
          id: 'control.limit',
          controller_participant_id: 'producer',
          target_participant_id: 'consumer',
          action: 'set_charge_limit',
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
      ],
    } as unknown as InteractionRelationship);
    expect(validateInteractionRelationships([relationship], validOptions).ok).toBe(true);
  });

  it('rejects invalid distribution and control references deterministically', () => {
    const base = normalized({
      normalized_information: [
        { id: 'claim.source', direction: 'exposes', participant_id: 'producer', term: 'voltage' },
        {
          id: 'claim.consumer',
          direction: 'consumes',
          participant_id: 'consumer',
          term: 'current',
        },
      ] as unknown as InteractionRelationship['normalized_information'],
      information_distributions: [
        {
          id: 'distribution.invalid',
          kind: 'explicit_consumers',
          source_claim_id: 'claim.missing',
          consumer_claim_ids: ['claim.consumer', 'claim.consumer'],
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
      ],
      control_claims: [
        {
          id: 'control.invalid',
          controller_participant_id: 'missing',
          target_participant_id: 'consumer',
          action: '',
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
        {
          id: 'control.invalid',
          controller_participant_id: 'producer',
          target_participant_id: 'consumer',
          action: 'set_limit',
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
      ],
    } as unknown as InteractionRelationship);
    const result = validateInteractionRelationships([base], validOptions);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'invalid_information_distribution_ref',
      'duplicate_information_distribution_consumer_id',
      'invalid_control_claim',
      'invalid_control_claim',
      'duplicate_control_claim_id',
    ]);
  });

  it('preserves local IDs and new facts in canonical snapshots', () => {
    const relationship = normalized({
      normalized_information: [
        { id: 'claim.source', direction: 'exposes', participant_id: 'producer', term: 'voltage' },
      ] as unknown as InteractionRelationship['normalized_information'],
      information_distributions: [
        {
          id: 'distribution.shared',
          kind: 'shared_publication',
          source_claim_id: 'claim.source',
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
      ],
      control_claims: [
        {
          id: 'control.limit',
          controller_participant_id: 'producer',
          target_participant_id: 'consumer',
          action: 'set_limit',
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
      ],
    } as unknown as InteractionRelationship);
    const snapshot = canonicalInteractionRelationshipSnapshot(relationship);
    expect(snapshot).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(relationship)).toContain('claim.source');
    expect(JSON.stringify(relationship)).toContain('distribution.shared');
    expect(JSON.stringify(relationship)).toContain('control.limit');
  });

  it('rejects dangling information participant IDs', () => {
    const result = validateInteractionRelationships(
      [
        normalized({
          normalized_information: [
            { id: 'claim.missing', direction: 'exposes', participant_id: 'missing', term: 'x' },
          ],
        }),
      ],
      validOptions,
    );
    expect(result.issues.some((issue) => issue.code === 'invalid_normalized_information_ref')).toBe(
      true,
    );
  });

  it('validates intermediate prerequisites by participant local ID', () => {
    expect(
      validateInteractionRelationships(
        [
          normalized({
            prerequisites: [
              {
                id: 'requires.gateway',
                kind: 'intermediate',
                participant_id: 'producer',
                source_ids: ['source.g7a'],
                fact_ids: ['fact.g7a'],
              },
            ],
          }),
        ],
        validOptions,
      ).ok,
    ).toBe(true);
  });

  it('preserves unresolved intermediate wording as an other prerequisite', () => {
    const relationship = normalized({
      prerequisites: [
        {
          id: 'requires.unknown-gateway',
          kind: 'other',
          raw_value: 'requires a gateway',
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
      ],
    });
    expect(relationship.prerequisites?.[0].kind).toBe('other');
  });

  it('accepts equality and presence configuration prerequisites', () => {
    const result = validateInteractionRelationships(
      [
        normalized({
          prerequisites: [
            {
              id: 'config.enabled',
              kind: 'configuration',
              target: { kind: 'participant', participant_id: 'producer' },
              key: 'enabled',
              operator: 'equals',
              value: true,
              source_ids: ['source.g7a'],
              fact_ids: ['fact.g7a'],
            },
            {
              id: 'config.mode',
              kind: 'configuration',
              target: { kind: 'relationship' },
              key: 'mode',
              operator: 'present',
              source_ids: ['source.g7a'],
              fact_ids: ['fact.g7a'],
            },
          ],
        }),
      ],
      validOptions,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects malformed configuration predicates', () => {
    const result = validateInteractionRelationships(
      [
        normalized({
          prerequisites: [
            {
              id: 'config.invalid',
              kind: 'configuration',
              target: { kind: 'relationship' },
              key: 'enabled',
              operator: 'present',
              value: true,
              source_ids: ['source.g7a'],
              fact_ids: ['fact.g7a'],
            },
          ],
        }),
      ],
      validOptions,
    );
    expect(result.issues.some((issue) => issue.code === 'invalid_configuration_predicate')).toBe(
      true,
    );
  });

  it('accepts each supported logical connection topology', () => {
    for (const topology of ['direct', 'shared_network', 'direct_or_shared_network'] as const) {
      expect(
        validateInteractionRelationships(
          [
            normalized({
              prerequisites: [
                {
                  id: `connection.${topology}`,
                  kind: 'connection',
                  participant_ids: ['producer', 'consumer'],
                  topology,
                  source_ids: ['source.g7a'],
                  fact_ids: ['fact.g7a'],
                },
              ],
            }),
          ],
          validOptions,
        ).ok,
      ).toBe(true);
    }
  });

  it('accepts opaque equality applicability for firmware and hardware revision', () => {
    const result = validateInteractionRelationships(
      [
        normalized({
          applicability: [
            {
              id: 'app.firmware',
              target_participant_id: 'producer',
              kind: 'firmware',
              operator: 'equals',
              value: 'vendor-1',
              source_ids: ['source.g7a'],
              fact_ids: ['fact.g7a'],
            },
            {
              id: 'app.revision',
              target_participant_id: 'producer',
              kind: 'hardware_revision',
              operator: 'equals',
              value: 'rev-a',
              source_ids: ['source.g7a'],
              fact_ids: ['fact.g7a'],
            },
          ],
        }),
      ],
      validOptions,
    );
    expect(result.ok).toBe(true);
  });

  it('does not add version or revision ordering semantics', () => {
    expect(normalized().applicability).toBeUndefined();
  });

  it('preserves exact, model, family, ecosystem, and unresolved evidence scopes', () => {
    const kinds = ['exact_product', 'model', 'family', 'ecosystem', 'unresolved'] as const;
    expect(kinds).toEqual(kinds);
  });

  it('preserves partial and unresolved broad-claim resolution', () => {
    expect(normalized().evidence_scopes?.[0].resolution).toBe('partially_resolved');
    expect(
      normalized({
        evidence_scopes: [
          {
            id: 'scope.unresolved',
            kind: 'unresolved',
            source_reference: 'unknown',
            source_ids: ['source.g7a'],
            fact_ids: ['fact.g7a'],
            resolution: 'unresolved',
          },
        ],
      }).evidence_scopes?.[0].resolved_component_ids,
    ).toBeUndefined();
  });

  it.each([
    ['resolved without IDs', 'resolved', undefined, true],
    ['resolved with empty IDs', 'resolved', [], true],
    ['partially resolved without IDs', 'partially_resolved', undefined, true],
    ['unresolved with IDs', 'unresolved', ['component.a'], true],
  ] as const)(
    'rejects incoherent evidence scope state: %s',
    (_label, resolution, ids, _expected) => {
      const result = validateInteractionRelationships(
        [
          normalized({
            evidence_scopes: [
              {
                id: 'scope.invalid',
                kind: 'family',
                source_reference: 'source-family',
                source_ids: ['source.g7a'],
                fact_ids: ['fact.g7a'],
                resolution,
                ...(ids === undefined ? {} : { resolved_component_ids: ids }),
              },
            ],
          }),
        ],
        validOptions,
      );
      expect(result.issues.some((issue) => issue.code === 'invalid_evidence_scope')).toBe(true);
    },
  );

  it('accepts coherent resolved, partially resolved, and unresolved scopes', () => {
    for (const resolution of ['resolved', 'partially_resolved', 'unresolved'] as const) {
      const result = validateInteractionRelationships(
        [
          normalized({
            evidence_scopes: [
              {
                id: `scope.${resolution}`,
                kind: 'family',
                source_reference: 'source-family',
                source_ids: ['source.g7a'],
                fact_ids: ['fact.g7a'],
                resolution,
                ...(resolution === 'unresolved' ? {} : { resolved_component_ids: ['component.a'] }),
              },
            ],
          }),
        ],
        validOptions,
      );
      expect(result.ok).toBe(true);
    }
  });

  it('rejects duplicate resolved component IDs', () => {
    const result = validateInteractionRelationships(
      [
        normalized({
          evidence_scopes: [
            {
              ...normalized().evidence_scopes![0],
              resolution: 'resolved',
              resolved_component_ids: ['component.a', 'component.a'],
            },
          ],
        }),
      ],
      validOptions,
    );
    expect(result.issues.some((issue) => issue.code === 'invalid_evidence_scope')).toBe(true);
  });

  it('validates canonical components and product-local endpoints when resolvers are available', () => {
    expect(validateInteractionRelationships([normalized()], validOptions).ok).toBe(true);
    expect(
      validateInteractionRelationships(
        [
          normalized({
            normalized_participants: [
              {
                id: 'producer',
                reference: { kind: 'component', component_id: 'missing' },
                role: 'producer',
              },
              normalized().normalized_participants![1],
            ],
          }),
        ],
        validOptions,
      ).issues.some((issue) => issue.code === 'invalid_normalized_reference'),
    ).toBe(true);
    expect(
      validateInteractionRelationships(
        [
          normalized({
            normalized_participants: [
              normalized().normalized_participants![0],
              {
                id: 'consumer',
                reference: {
                  kind: 'interaction_endpoint',
                  component_id: 'component.a',
                  endpoint_id: 'endpoint.y',
                },
                role: 'consumer',
              },
            ],
          }),
        ],
        validOptions,
      ).issues.some((issue) => issue.code === 'invalid_normalized_reference'),
    ).toBe(true);
  });

  it('does not create engineering participants from family or accessory labels', () => {
    expect(
      normalized().normalized_participants?.every(
        ({ reference }) =>
          reference.kind !== 'component' || !reference.component_id.includes('family'),
      ),
    ).toBe(true);
  });

  it('keeps normalized data deterministic through reviewed promotion', () => {
    const current = normalized({
      normalized_information: [
        { id: 'claim.voltage', direction: 'exposes', participant_id: 'producer', term: 'voltage' },
        {
          id: 'claim.consumer',
          direction: 'consumes',
          participant_id: 'consumer',
          term: 'voltage',
        },
      ],
      information_distributions: [
        {
          id: 'distribution.voltage',
          kind: 'explicit_consumers',
          source_claim_id: 'claim.voltage',
          consumer_claim_ids: ['claim.consumer'],
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
      ],
      control_claims: [
        {
          id: 'control.limit',
          controller_participant_id: 'producer',
          target_participant_id: 'consumer',
          action: 'set_limit',
          source_ids: ['source.g7a'],
          fact_ids: ['fact.g7a'],
        },
      ],
    });
    const result = proposeCanonicalInteractionRelationship({
      current,
      review: {
        schema_version: '1.0',
        id: 'review.g7a',
        relationship_id: current.id,
        candidate_id: 'candidate.g7a',
        decision: 'approved',
        reviewer_id: 'reviewer.g7a',
        reviewed_at: '2026-09-07T12:00:00.000Z',
        expected_snapshot: canonicalInteractionRelationshipSnapshot(current),
        evidence_acknowledged: true,
        source_ids: current.evidence.source_ids,
        fact_ids: current.evidence.fact_ids,
      },
      participantReferenceResolver: () => true,
    });
    expect(result.status).toBe('proposed');
    expect(result.proposal?.normalized_participants).toEqual(current.normalized_participants);
    expect(result.proposal?.normalized_information).toEqual(current.normalized_information);
    expect(result.proposal?.information_distributions).toEqual(current.information_distributions);
    expect(result.proposal?.control_claims).toEqual(current.control_claims);
  });

  it('requires canonical reference validation before reviewed promotion', () => {
    const current = normalized();
    const result = proposeCanonicalInteractionRelationship({
      current,
      review: {
        schema_version: '1.0',
        id: 'review.g7a.invalid-reference',
        relationship_id: current.id,
        candidate_id: 'candidate.g7a',
        decision: 'approved',
        reviewer_id: 'reviewer.g7a',
        reviewed_at: '2026-09-07T12:00:00.000Z',
        expected_snapshot: canonicalInteractionRelationshipSnapshot(current),
        evidence_acknowledged: true,
        source_ids: current.evidence.source_ids,
        fact_ids: current.evidence.fact_ids,
      },
      participantReferenceResolver: () => true,
      componentReferenceResolver: (componentId) => componentId !== 'component.a',
      endpointReferenceResolver: () => true,
    });
    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'relationship_invalid')).toBe(true);
  });

  it('retains legacy positive interpretation behavior', () => {
    expect(normalized().assertion).toBe('positive');
  });

  it('does not introduce installed evaluation', () => {
    expect(normalized().normalized_participants?.[0].reference).not.toHaveProperty('instance_id');
  });
});
