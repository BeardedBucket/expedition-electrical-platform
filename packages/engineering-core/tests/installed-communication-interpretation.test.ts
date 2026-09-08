import { describe, expect, it } from 'vitest';
import {
  interpretInstalledCommunicationSystem,
  type InstalledCommunicationInterpretationInput,
} from '../src/installed-communication-interpretation.js';
import type {
  InstalledInteractionEvaluationResult,
  InstalledInteractionParticipantMapping,
  ReviewedInteractionRelationship,
} from '../src/installed-interaction-evaluation.js';

const mappings: readonly InstalledInteractionParticipantMapping[] = [
  { participant_id: 'source', target: { kind: 'component_instance', instance_id: 'source-1' } },
  { participant_id: 'consumer', target: { kind: 'component_instance', instance_id: 'consumer-1' } },
];

const relationship = (
  overrides: Partial<ReviewedInteractionRelationship> = {},
): ReviewedInteractionRelationship => ({
  id: 'reviewed-link',
  assertion: 'positive',
  state: 'verified',
  normalized_participants: [
    { id: 'source', reference: { kind: 'component', component_id: 'component.source' } },
    { id: 'consumer', reference: { kind: 'component', component_id: 'component.consumer' } },
  ],
  normalized_information: [
    { id: 'claim.source', direction: 'exposes', participant_id: 'source', term: 'SOC' },
    { id: 'claim.consumer', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
  ],
  evidence: { source_ids: ['source.review'], fact_ids: ['fact.review'] },
  ...overrides,
});

const evaluation = (
  overrides: Partial<InstalledInteractionEvaluationResult> = {},
): InstalledInteractionEvaluationResult => ({
  status: 'satisfied',
  relationship_id: 'reviewed-link',
  assertion: 'positive',
  reasons: [],
  provenance: {
    reviewed_relationship_id: 'reviewed-link',
    reviewed_assertion: 'positive',
    reviewed_state: 'verified',
    reviewed_source_ids: ['source.review'],
    reviewed_fact_ids: ['fact.review'],
    participant_mappings: mappings,
    selected_relationship_id: 'installed-link',
    selected_prerequisite_topology_ids: ['installed-link'],
    applicability_ids: [],
    prerequisite_ids: [],
    configuration_ids: [],
    intermediate_object_ids: [],
    qualifier_source_refs: [],
  },
  ...overrides,
});

const input = (
  reviewed: ReviewedInteractionRelationship = relationship(),
  result: InstalledInteractionEvaluationResult = evaluation(),
): InstalledCommunicationInterpretationInput => ({
  interactions: [{ reviewed_relationship: reviewed, evaluation: result }],
});

const matchingInput = (
  reviewed: ReviewedInteractionRelationship,
  overrides: Partial<InstalledInteractionEvaluationResult> = {},
): InstalledCommunicationInterpretationInput =>
  input(
    reviewed,
    evaluation({
      relationship_id: reviewed.id,
      ...overrides,
      provenance: {
        ...evaluation().provenance,
        ...overrides.provenance,
        reviewed_relationship_id: reviewed.id,
      },
    }),
  );

const withMappings = (
  reviewed: ReviewedInteractionRelationship,
  result: InstalledInteractionEvaluationResult,
  extraMappings: readonly InstalledInteractionParticipantMapping[],
): InstalledCommunicationInterpretationInput => ({
  interactions: [
    {
      reviewed_relationship: reviewed,
      evaluation: evaluation({
        ...result,
        relationship_id: reviewed.id,
        provenance: {
          ...result.provenance,
          reviewed_relationship_id: reviewed.id,
          participant_mappings: [...result.provenance.participant_mappings, ...extraMappings],
        },
      }),
    },
  ],
});

const informationRelationship = (
  id: string,
  sourceClaims: readonly string[],
  consumerClaims: readonly string[],
  overrides: Partial<ReviewedInteractionRelationship> = {},
): ReviewedInteractionRelationship =>
  relationship({
    id,
    normalized_information: [
      ...sourceClaims.map((term, index) => ({
        id: `source.${index}`,
        direction: 'exposes' as const,
        participant_id: 'source',
        term,
      })),
      ...consumerClaims.map((term, index) => ({
        id: `consumer.${index}`,
        direction: 'consumes' as const,
        participant_id: 'consumer',
        term,
      })),
    ],
    ...overrides,
  });

describe('installed communication interpretation', () => {
  it('derives exact information availability from a satisfied simple interaction', () => {
    const result = interpretInstalledCommunicationSystem(input());
    expect(result.information_availability).toHaveLength(1);
    expect(result.information_availability[0]).toMatchObject({
      term: 'SOC',
      source: { target: mappings[0]!.target },
      consumer: { target: mappings[1]!.target },
    });
  });

  it('does not derive unmatched terms or use fuzzy matching', () => {
    const result = interpretInstalledCommunicationSystem(
      input(
        relationship({
          normalized_information: [
            { id: 'claim.source', direction: 'exposes', participant_id: 'source', term: 'SOC' },
            {
              id: 'claim.consumer',
              direction: 'consumes',
              participant_id: 'consumer',
              term: 'soc',
            },
          ],
        }),
      ),
    );
    expect(result.information_availability).toEqual([]);
  });

  it('handles explicit consumers and shared publication without network synthesis', () => {
    const reviewed = relationship({
      normalized_participants: [
        ...relationship().normalized_participants,
        { id: 'other', reference: { kind: 'component', component_id: 'component.other' } },
      ],
      normalized_information: [
        { id: 'claim.source', direction: 'exposes', participant_id: 'source', term: 'SOC' },
        { id: 'claim.b', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
        { id: 'claim.c', direction: 'consumes', participant_id: 'other', term: 'SOC' },
      ],
      information_distributions: [
        {
          id: 'distribution.shared',
          kind: 'shared_publication',
          source_claim_id: 'claim.source',
          source_ids: ['source.review'],
          fact_ids: ['fact.review'],
        },
      ],
    });
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: reviewed,
          evaluation: evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [
                ...mappings,
                {
                  participant_id: 'other',
                  target: { kind: 'component_instance', instance_id: 'other-1' },
                },
              ],
            },
          }),
        },
      ],
    });
    expect(result.information_availability.map((item) => item.consumer.target)).toEqual([
      mappings[1]!.target,
      { kind: 'component_instance', instance_id: 'other-1' },
    ]);
  });

  it('limits explicit consumer distribution to listed claims', () => {
    const reviewed = relationship({
      normalized_participants: [
        ...relationship().normalized_participants,
        { id: 'other', reference: { kind: 'component', component_id: 'component.other' } },
      ],
      normalized_information: [
        { id: 'claim.source', direction: 'exposes', participant_id: 'source', term: 'SOC' },
        { id: 'claim.b', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
        { id: 'claim.c', direction: 'consumes', participant_id: 'other', term: 'SOC' },
      ],
      information_distributions: [
        {
          id: 'distribution.explicit',
          kind: 'explicit_consumers',
          source_claim_id: 'claim.source',
          consumer_claim_ids: ['claim.b'],
          source_ids: ['source.review'],
          fact_ids: ['fact.review'],
        },
      ],
    });
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: reviewed,
          evaluation: evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [
                ...mappings,
                {
                  participant_id: 'other',
                  target: { kind: 'component_instance', instance_id: 'other-1' },
                },
              ],
            },
          }),
        },
      ],
    });
    expect(result.information_availability).toHaveLength(1);
    expect(result.information_availability[0]!.consumer.target).toEqual(mappings[1]!.target);
    expect(result.information_availability[0]!.support[0]!.distribution_id).toBe(
      'distribution.explicit',
    );
  });

  it('does not invent an ambiguous multi-source pairing', () => {
    const reviewed = relationship({
      normalized_participants: [
        ...relationship().normalized_participants,
        {
          id: 'source-two',
          reference: { kind: 'component', component_id: 'component.source-two' },
        },
      ],
      normalized_information: [
        { id: 'claim.a', direction: 'exposes', participant_id: 'source', term: 'SOC' },
        { id: 'claim.b', direction: 'exposes', participant_id: 'source-two', term: 'SOC' },
        { id: 'claim.c', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
      ],
    });
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: reviewed,
          evaluation: evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [
                ...mappings,
                {
                  participant_id: 'source-two',
                  target: { kind: 'component_instance', instance_id: 'source-2' },
                },
              ],
            },
          }),
        },
      ],
    });
    expect(result.information_availability).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === 'ambiguous_information_source')).toBe(
      true,
    );
  });

  it('derives control independently and gates unknown evaluations', () => {
    const reviewed = relationship({
      control_claims: [
        {
          id: 'control.limit',
          controller_participant_id: 'source',
          target_participant_id: 'consumer',
          action: 'set_limit',
          source_ids: ['source.review'],
          fact_ids: ['fact.review'],
        },
      ],
      normalized_information: undefined,
    });
    const result = interpretInstalledCommunicationSystem(matchingInput(reviewed));
    expect(result.control_availability[0]).toMatchObject({ action: 'set_limit' });
    expect(result.information_availability).toEqual([]);
    expect(
      interpretInstalledCommunicationSystem(input(reviewed, evaluation({ status: 'unknown' })))
        .control_availability,
    ).toEqual([]);
  });

  it('aggregates and deduplicates support paths deterministically', () => {
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        input().interactions[0]!,
        {
          reviewed_relationship: relationship({ id: 'reviewed-link-2' }),
          evaluation: evaluation({
            relationship_id: 'reviewed-link-2',
            provenance: { ...evaluation().provenance, reviewed_relationship_id: 'reviewed-link-2' },
          }),
        },
      ],
    });
    expect(result.information_availability).toHaveLength(1);
    expect(result.information_availability[0]!.support).toHaveLength(2);
  });

  it('does not infer transitive forwarding or positive facts from non-satisfied paths', () => {
    const first = input();
    const second = input(
      relationship({
        id: 'forwarding-link',
        normalized_participants: [
          { id: 'source', reference: { kind: 'component', component_id: 'component.consumer' } },
          { id: 'consumer', reference: { kind: 'component', component_id: 'component.third' } },
        ],
      }),
      evaluation({
        relationship_id: 'forwarding-link',
        provenance: { ...evaluation().provenance, reviewed_relationship_id: 'forwarding-link' },
        status: 'unknown',
      }),
    );
    const result = interpretInstalledCommunicationSystem({
      interactions: [first.interactions[0]!, second.interactions[0]!],
    });
    expect(result.information_availability).toHaveLength(1);
    expect(result.information_availability[0]!.source.target).toEqual(mappings[0]!.target);
    expect(result.information_availability[0]!.consumer.target).toEqual(mappings[1]!.target);
  });

  it('rejects mismatched evaluation identity', () => {
    expect(() =>
      interpretInstalledCommunicationSystem(
        input(relationship(), evaluation({ relationship_id: 'other' })),
      ),
    ).toThrow('relationship_id');
  });

  it('rejects a satisfied evaluation with a missing participant mapping', () => {
    expect(() =>
      interpretInstalledCommunicationSystem(
        input(
          relationship({
            normalized_participants: [
              ...relationship().normalized_participants,
              {
                id: 'missing',
                reference: { kind: 'component', component_id: 'component.missing' },
              },
            ],
          }),
        ),
      ),
    ).toThrow('missing participant mappings');
  });

  it('directly proves consumed-only and exposed-only terms are not end-to-end facts', () => {
    const consumedOnly = interpretInstalledCommunicationSystem(
      matchingInput(informationRelationship('consumed-only', [], ['Q'])),
    );
    const exposedOnly = interpretInstalledCommunicationSystem(
      matchingInput(informationRelationship('exposed-only', ['Z'], [])),
    );
    expect(consumedOnly.information_availability).toEqual([]);
    expect(exposedOnly.information_availability).toEqual([]);
  });

  it('preserves multiple installed instances and repeated endpoint IDs', () => {
    const reviewed = informationRelationship('instances', ['SOC'], ['SOC']);
    const result = interpretInstalledCommunicationSystem(
      withMappings(reviewed, evaluation(), [
        {
          participant_id: 'source-two',
          target: {
            kind: 'interaction_endpoint',
            endpoint: { instance_id: 'source-2', endpoint_id: 'status' },
          },
        },
      ]),
    );
    expect(result.information_availability).toHaveLength(1);
    expect(result.information_availability[0]!.source.target).toEqual(mappings[0]!.target);
    expect(result.information_availability[0]!.source.target).not.toEqual({
      kind: 'component_instance',
      instance_id: 'source-2',
    });

    const endpointRelationship = relationship({
      normalized_participants: [
        {
          id: 'source',
          reference: { kind: 'interaction_endpoint', component_id: 'a', endpoint_id: 'status' },
        },
        {
          id: 'consumer',
          reference: { kind: 'interaction_endpoint', component_id: 'b', endpoint_id: 'status' },
        },
      ],
    });
    const endpointResult = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: endpointRelationship,
          evaluation: evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [
                {
                  participant_id: 'source',
                  target: {
                    kind: 'interaction_endpoint',
                    endpoint: { instance_id: 'a-1', endpoint_id: 'status' },
                  },
                },
                {
                  participant_id: 'consumer',
                  target: {
                    kind: 'interaction_endpoint',
                    endpoint: { instance_id: 'b-1', endpoint_id: 'status' },
                  },
                },
              ],
            },
          }),
        },
      ],
    });
    expect(endpointResult.information_availability[0]!.source.target).toEqual({
      kind: 'interaction_endpoint',
      endpoint: { instance_id: 'a-1', endpoint_id: 'status' },
    });
    expect(endpointResult.information_availability[0]!.consumer.target).toEqual({
      kind: 'interaction_endpoint',
      endpoint: { instance_id: 'b-1', endpoint_id: 'status' },
    });
  });

  it('is independent of participant, claim, mapping, and interaction array order', () => {
    const reviewed = informationRelationship('ordering', ['X', 'Y'], ['X', 'Y']);
    const result = interpretInstalledCommunicationSystem(matchingInput(reviewed));
    const reordered = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: {
            ...reviewed,
            normalized_participants: [...reviewed.normalized_participants].reverse(),
            normalized_information: [...reviewed.normalized_information!].reverse(),
          },
          evaluation: evaluation({
            relationship_id: reviewed.id,
            provenance: {
              ...evaluation().provenance,
              reviewed_relationship_id: reviewed.id,
              participant_mappings: [...mappings].reverse(),
            },
          }),
        },
      ],
    });
    expect(reordered).toEqual(result);
  });

  it('does not over-infer one source to multiple consumers without distribution', () => {
    const reviewed = relationship({
      normalized_participants: [
        ...relationship().normalized_participants,
        {
          id: 'consumer-two',
          reference: { kind: 'component', component_id: 'component.consumer-two' },
        },
      ],
      normalized_information: [
        { id: 'source', direction: 'exposes', participant_id: 'source', term: 'SOC' },
        { id: 'consumer-one', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
        { id: 'consumer-two', direction: 'consumes', participant_id: 'consumer-two', term: 'SOC' },
      ],
    });
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: reviewed,
          evaluation: evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [
                ...mappings,
                {
                  participant_id: 'consumer-two',
                  target: { kind: 'component_instance', instance_id: 'consumer-2' },
                },
              ],
            },
          }),
        },
      ],
    });
    expect(result.information_availability).toEqual([]);
  });

  it('preserves explicit source identity and consumer ordering semantics', () => {
    const reviewed = relationship({
      normalized_participants: [
        ...relationship().normalized_participants,
        {
          id: 'consumer-two',
          reference: { kind: 'component', component_id: 'component.consumer-two' },
        },
      ],
      normalized_information: [
        { id: 'source-one', direction: 'exposes', participant_id: 'source', term: 'SOC' },
        { id: 'source-two', direction: 'exposes', participant_id: 'consumer', term: 'SOC' },
        { id: 'consumer-one', direction: 'consumes', participant_id: 'consumer-two', term: 'SOC' },
        { id: 'consumer-two', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
      ],
      information_distributions: [
        {
          id: 'distribution.one',
          kind: 'explicit_consumers',
          source_claim_id: 'source-one',
          consumer_claim_ids: ['consumer-one'],
          source_ids: ['source.review'],
          fact_ids: ['fact.review'],
        },
      ],
    });
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: reviewed,
          evaluation: evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [
                ...mappings,
                {
                  participant_id: 'consumer-two',
                  target: { kind: 'component_instance', instance_id: 'consumer-2' },
                },
              ],
            },
          }),
        },
      ],
    });
    expect(result.information_availability).toHaveLength(1);
    expect(result.information_availability[0]!.source.reviewed_participant_id).toBe('source');
    expect(result.information_availability[0]!.consumer.reviewed_participant_id).toBe(
      'consumer-two',
    );
  });

  it('handles shared publication only for exact consuming claims', () => {
    const reviewed = relationship({
      normalized_participants: [
        ...relationship().normalized_participants,
        { id: 'other', reference: { kind: 'component', component_id: 'component.other' } },
        { id: 'local', reference: { kind: 'component', component_id: 'component.local' } },
      ],
      normalized_information: [
        { id: 'source', direction: 'exposes', participant_id: 'source', term: 'SOC' },
        { id: 'consumer', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
        { id: 'wrong-term', direction: 'consumes', participant_id: 'other', term: 'voltage' },
      ],
      information_distributions: [
        {
          id: 'shared',
          kind: 'shared_publication',
          source_claim_id: 'source',
          source_ids: ['source.review'],
          fact_ids: ['fact.review'],
        },
      ],
    });
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: reviewed,
          evaluation: evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [
                ...mappings,
                {
                  participant_id: 'other',
                  target: { kind: 'component_instance', instance_id: 'other-1' },
                },
                {
                  participant_id: 'local',
                  target: { kind: 'component_instance', instance_id: 'local-1' },
                },
              ],
            },
          }),
        },
      ],
    });
    expect(result.information_availability).toHaveLength(1);
    expect(result.information_availability[0]!.consumer.target).toEqual(mappings[1]!.target);
    expect(result.information_availability[0]!.support[0]!.distribution_id).toBe('shared');
  });

  it('does not infer app-only, local, manufacturer, or protocol availability', () => {
    const appOnly = relationship({
      normalized_participants: [
        ...relationship().normalized_participants,
        { id: 'app', reference: { kind: 'unresolved_external', reference: 'vendor-app' } },
      ],
      normalized_information: [
        { id: 'source', direction: 'exposes', participant_id: 'source', term: 'SOC' },
        { id: 'app-consumer', direction: 'consumes', participant_id: 'app', term: 'SOC' },
      ],
    });
    const result = interpretInstalledCommunicationSystem(
      matchingInput(appOnly, {
        status: 'unknown',
        provenance: {
          ...evaluation().provenance,
          participant_mappings: [
            ...mappings,
            { participant_id: 'app', target: { kind: 'installed_artifact', artifact_id: 'app-1' } },
          ],
        },
      }),
    );
    expect(result.information_availability).toEqual([]);
  });

  it('derives independent control targets without runtime, authorization, or safety semantics', () => {
    const reviewed = relationship({
      normalized_information: undefined,
      control_claims: [
        {
          id: 'control.one',
          controller_participant_id: 'source',
          target_participant_id: 'consumer',
          action: 'trip',
          source_ids: ['source.review'],
          fact_ids: ['fact.review'],
        },
        {
          id: 'control.two',
          controller_participant_id: 'source',
          target_participant_id: 'consumer',
          action: 'reset',
          source_ids: ['source.review'],
          fact_ids: ['fact.review'],
        },
      ],
    });
    const result = interpretInstalledCommunicationSystem(matchingInput(reviewed));
    expect(result.control_availability.map((item) => item.action)).toEqual(['reset', 'trip']);
    expect(result.control_availability.every((item) => item.support[0]!.control_claim_id)).toBe(
      true,
    );
    expect(result).not.toHaveProperty('runtime_success');
    expect(result).not.toHaveProperty('authorization');
    expect(result).not.toHaveProperty('safety');
  });

  it('does not use relationship classification alone as control authority', () => {
    const reviewed = relationship({
      normalized_information: undefined,
      relationship_kind: 'control_interaction',
    } as Partial<ReviewedInteractionRelationship>);
    expect(
      interpretInstalledCommunicationSystem(matchingInput(reviewed)).control_availability,
    ).toEqual([]);
  });

  it('preserves direct, network, and prerequisite provenance', () => {
    const result = interpretInstalledCommunicationSystem(
      input(
        relationship(),
        evaluation({
          provenance: {
            ...evaluation().provenance,
            selected_relationship_id: 'direct-1',
            selected_network_id: 'network-1',
            selected_prerequisite_topology_ids: ['prerequisite-2', 'prerequisite-1'],
          },
        }),
      ),
    );
    expect(result.information_availability[0]!.support[0]).toMatchObject({
      selected_relationship_id: 'direct-1',
      selected_network_id: 'network-1',
      selected_prerequisite_topology_ids: ['prerequisite-1', 'prerequisite-2'],
    });
  });

  it('retains established facts beside unrelated unknown and not-satisfied paths', () => {
    const established = input();
    const unrelated = (status: 'unknown' | 'not_satisfied') =>
      input(
        relationship({
          id: `unrelated-${status}`,
          normalized_information: [
            { id: 'source', direction: 'exposes', participant_id: 'source', term: 'voltage' },
            { id: 'consumer', direction: 'consumes', participant_id: 'consumer', term: 'voltage' },
          ],
        }),
        evaluation({
          relationship_id: `unrelated-${status}`,
          status,
          provenance: {
            ...evaluation().provenance,
            reviewed_relationship_id: `unrelated-${status}`,
          },
        }),
      );
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        established.interactions[0]!,
        unrelated('unknown').interactions[0]!,
        unrelated('not_satisfied').interactions[0]!,
      ],
    });
    expect(result.information_availability).toHaveLength(1);
    expect(result.information_availability[0]!.term).toBe('SOC');
  });

  it('preserves independent support provenance and deterministic ordering', () => {
    const first = matchingInput(
      relationship({
        id: 'relationship-b',
        normalized_information: [
          { id: 'source-b', direction: 'exposes', participant_id: 'source', term: 'SOC' },
          { id: 'consumer-b', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
        ],
        evidence: { source_ids: ['source-b'], fact_ids: ['fact-b'] },
      }),
      {
        relationship_id: 'relationship-b',
        provenance: { ...evaluation().provenance, reviewed_relationship_id: 'relationship-b' },
      },
    );
    const second = matchingInput(
      relationship({
        id: 'relationship-a',
        normalized_information: [
          { id: 'source-a', direction: 'exposes', participant_id: 'source', term: 'SOC' },
          { id: 'consumer-a', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
        ],
        evidence: { source_ids: ['source-a'], fact_ids: ['fact-a'] },
      }),
      {
        relationship_id: 'relationship-a',
        provenance: { ...evaluation().provenance, reviewed_relationship_id: 'relationship-a' },
      },
    );
    const result = interpretInstalledCommunicationSystem({
      interactions: [first.interactions[0]!, second.interactions[0]!],
    });
    expect(result.information_availability).toHaveLength(1);
    expect(
      result.information_availability[0]!.support.map((path) => path.reviewed_relationship_id),
    ).toEqual(['relationship-a', 'relationship-b']);
    expect(result.information_availability[0]!.support.map((path) => path.source_claim_id)).toEqual(
      ['source-a', 'source-b'],
    );
  });

  it('is pure and deterministic under repetition and input mutation checks', () => {
    const source = input();
    const before = structuredClone(source);
    const first = interpretInstalledCommunicationSystem(source);
    const second = interpretInstalledCommunicationSystem(source);
    expect(second).toEqual(first);
    expect(source).toEqual(before);
  });

  it('rejects mismatched reviewed provenance and duplicate mappings', () => {
    expect(() =>
      interpretInstalledCommunicationSystem(
        input(
          relationship(),
          evaluation({
            provenance: { ...evaluation().provenance, reviewed_relationship_id: 'other' },
          }),
        ),
      ),
    ).toThrow('relationship_id');
    expect(() =>
      interpretInstalledCommunicationSystem(
        input(
          relationship(),
          evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [...mappings, mappings[0]!],
            },
          }),
        ),
      ),
    ).toThrow('Duplicate participant mapping');
  });

  it('suppresses ordinary self-information availability', () => {
    const reviewed = relationship({
      normalized_participants: [
        { id: 'self', reference: { kind: 'component', component_id: 'component.self' } },
      ],
      normalized_information: [
        { id: 'exposes', direction: 'exposes', participant_id: 'self', term: 'SOC' },
        { id: 'consumes', direction: 'consumes', participant_id: 'self', term: 'SOC' },
      ],
    });
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: reviewed,
          evaluation: evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [
                {
                  participant_id: 'self',
                  target: { kind: 'component_instance', instance_id: 'self-1' },
                },
              ],
            },
          }),
        },
      ],
    });
    expect(result.information_availability).toEqual([]);
  });

  it('does not synthesize facts from a shared network provenance alone', () => {
    const source = matchingInput(relationship({ id: 'network-source' }), {
      provenance: {
        ...evaluation().provenance,
        reviewed_relationship_id: 'network-source',
        selected_network_id: 'shared-network',
      },
    });
    const unrelated = matchingInput(
      relationship({
        id: 'network-unrelated',
        normalized_information: [
          { id: 'source', direction: 'exposes', participant_id: 'source', term: 'voltage' },
          { id: 'consumer', direction: 'consumes', participant_id: 'consumer', term: 'current' },
        ],
      }),
      {
        relationship_id: 'network-unrelated',
        provenance: {
          ...evaluation().provenance,
          reviewed_relationship_id: 'network-unrelated',
          selected_network_id: 'shared-network',
        },
      },
    );
    const result = interpretInstalledCommunicationSystem({
      interactions: [source.interactions[0]!, unrelated.interactions[0]!],
    });
    expect(result.information_availability).toHaveLength(1);
    expect(result.information_availability[0]!.term).toBe('SOC');
  });

  it('directly intersects multiple exact terms and excludes unmatched terms', () => {
    const result = interpretInstalledCommunicationSystem(
      matchingInput(informationRelationship('intersection', ['X', 'Y', 'Z'], ['X', 'Y'])),
    );
    expect(result.information_availability.map((item) => item.term)).toEqual(['X', 'Y']);
    expect(result.information_availability.some((item) => item.term === 'Z')).toBe(false);
  });

  it('gates both information and control on satisfied G7 status', () => {
    const reviewed = relationship({
      control_claims: [
        {
          id: 'control',
          controller_participant_id: 'source',
          target_participant_id: 'consumer',
          action: 'set_limit',
          source_ids: ['source.review'],
          fact_ids: ['fact.review'],
        },
      ],
    });
    for (const status of ['unknown', 'not_satisfied'] as const) {
      const result = interpretInstalledCommunicationSystem(matchingInput(reviewed, { status }));
      expect(result.information_availability).toEqual([]);
      expect(result.control_availability).toEqual([]);
    }
  });

  it('keeps same-canonical-component installed instances separate', () => {
    const reviewed = relationship({
      normalized_participants: [
        { id: 'source-one', reference: { kind: 'component', component_id: 'same.component' } },
        { id: 'source-two', reference: { kind: 'component', component_id: 'same.component' } },
        { id: 'consumer', reference: { kind: 'component', component_id: 'consumer' } },
      ],
      normalized_information: [
        { id: 'source', direction: 'exposes', participant_id: 'source-one', term: 'SOC' },
        { id: 'consumer', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
      ],
    });
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: reviewed,
          evaluation: evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [
                {
                  participant_id: 'source-one',
                  target: { kind: 'component_instance', instance_id: 'same-1' },
                },
                {
                  participant_id: 'source-two',
                  target: { kind: 'component_instance', instance_id: 'same-2' },
                },
                {
                  participant_id: 'consumer',
                  target: { kind: 'component_instance', instance_id: 'consumer-1' },
                },
              ],
            },
          }),
        },
      ],
    });
    expect(result.information_availability).toHaveLength(1);
    expect(result.information_availability[0]!.source.target).toEqual({
      kind: 'component_instance',
      instance_id: 'same-1',
    });
    expect(result.information_availability[0]!.source.target).not.toEqual({
      kind: 'component_instance',
      instance_id: 'same-2',
    });
  });

  it('preserves all explicitly listed consumers and ignores unlisted compatible claims', () => {
    const reviewed = relationship({
      normalized_participants: [
        ...relationship().normalized_participants,
        { id: 'consumer-two', reference: { kind: 'component', component_id: 'consumer-two' } },
        { id: 'consumer-three', reference: { kind: 'component', component_id: 'consumer-three' } },
      ],
      normalized_information: [
        { id: 'source', direction: 'exposes', participant_id: 'source', term: 'SOC' },
        { id: 'c1', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
        { id: 'c2', direction: 'consumes', participant_id: 'consumer-two', term: 'SOC' },
        { id: 'c3', direction: 'consumes', participant_id: 'consumer-three', term: 'SOC' },
      ],
      information_distributions: [
        {
          id: 'explicit',
          kind: 'explicit_consumers',
          source_claim_id: 'source',
          consumer_claim_ids: ['c2', 'c1'],
          source_ids: ['source.review'],
          fact_ids: ['fact.review'],
        },
      ],
    });
    const result = interpretInstalledCommunicationSystem({
      interactions: [
        {
          reviewed_relationship: reviewed,
          evaluation: evaluation({
            provenance: {
              ...evaluation().provenance,
              participant_mappings: [
                ...mappings,
                {
                  participant_id: 'consumer-two',
                  target: { kind: 'component_instance', instance_id: 'consumer-2' },
                },
                {
                  participant_id: 'consumer-three',
                  target: { kind: 'component_instance', instance_id: 'consumer-3' },
                },
              ],
            },
          }),
        },
      ],
    });
    expect(result.information_availability.map((item) => item.consumer.target)).toEqual([
      mappings[1]!.target,
      { kind: 'component_instance', instance_id: 'consumer-2' },
    ]);
    expect(
      result.information_availability.every(
        (item) =>
          item.consumer.target.kind !== 'component_instance' ||
          item.consumer.target.instance_id !== 'consumer-3',
      ),
    ).toBe(true);
  });

  it('keeps common-network relationships independent and does not infer transitive forwarding', () => {
    const first = matchingInput(
      relationship({
        id: 'a-to-b',
        normalized_information: [
          { id: 'a-source', direction: 'exposes', participant_id: 'source', term: 'SOC' },
          { id: 'b-consumer', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
        ],
      }),
      { provenance: { ...evaluation().provenance, selected_network_id: 'network' } },
    );
    const second = matchingInput(
      relationship({
        id: 'b-to-c',
        normalized_participants: [
          { id: 'source', reference: { kind: 'component', component_id: 'component.consumer' } },
          { id: 'consumer', reference: { kind: 'component', component_id: 'component.third' } },
        ],
        normalized_information: [
          { id: 'b-source', direction: 'exposes', participant_id: 'source', term: 'SOC' },
          { id: 'c-consumer', direction: 'consumes', participant_id: 'consumer', term: 'SOC' },
        ],
      }),
      {
        provenance: {
          ...evaluation().provenance,
          selected_network_id: 'network',
          participant_mappings: [
            {
              participant_id: 'source',
              target: { kind: 'component_instance', instance_id: 'consumer-1' },
            },
            {
              participant_id: 'consumer',
              target: { kind: 'component_instance', instance_id: 'third-1' },
            },
          ],
        },
      },
    );
    const result = interpretInstalledCommunicationSystem({
      interactions: [first.interactions[0]!, second.interactions[0]!],
    });
    expect(result.information_availability).toHaveLength(2);
    expect(
      result.information_availability.some(
        (item) =>
          item.source.target.kind === 'component_instance' &&
          item.source.target.instance_id === 'source-1' &&
          item.consumer.target.kind === 'component_instance' &&
          item.consumer.target.instance_id === 'third-1',
      ),
    ).toBe(false);
  });
});
