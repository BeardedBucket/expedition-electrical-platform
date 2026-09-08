import { describe, expect, it } from 'vitest';
import {
  evaluateInstalledCommunicationRequirements,
  type InstalledCommunicationRequirement,
} from '../src/installed-communication-requirements.js';
import type {
  InstalledCommunicationInterpretation,
  InstalledControlAvailability,
  InstalledInformationAvailability,
} from '../src/installed-communication-interpretation.js';

const component = (instance_id: string) => ({ kind: 'component_instance' as const, instance_id });
const endpoint = (instance_id: string, endpoint_id: string) => ({
  kind: 'interaction_endpoint' as const,
  endpoint: { instance_id, endpoint_id },
});

const information = (
  term: string,
  source: ReturnType<typeof component>,
  consumer: ReturnType<typeof component>,
  id = `information:${term}:${source.instance_id}:${consumer.instance_id}`,
): InstalledInformationAvailability => ({
  id,
  kind: 'information',
  term,
  source: { reviewed_participant_id: 'source', target: source },
  consumer: { reviewed_participant_id: 'consumer', target: consumer },
  support: [
    {
      reviewed_relationship_id: 'reviewed.relationship',
      source_claim_id: 'claim.source',
      consumer_claim_id: 'claim.consumer',
      selected_prerequisite_topology_ids: [],
      source_ids: ['source.review'],
      fact_ids: ['fact.review'],
    },
  ],
});

const control = (
  action: string,
  controller: ReturnType<typeof component>,
  target: ReturnType<typeof component>,
): InstalledControlAvailability => ({
  id: `control:${action}:${controller.instance_id}:${target.instance_id}`,
  kind: 'control',
  action,
  controller: { reviewed_participant_id: 'controller', target: controller },
  target: { reviewed_participant_id: 'target', target },
  support: [
    {
      reviewed_relationship_id: 'reviewed.control',
      control_claim_id: 'control.claim',
      selected_prerequisite_topology_ids: [],
      source_ids: ['source.control'],
      fact_ids: ['fact.control'],
    },
  ],
});

const interpretation = (
  overrides: Partial<InstalledCommunicationInterpretation> = {},
): InstalledCommunicationInterpretation => ({
  information_availability: [],
  control_availability: [],
  diagnostics: [],
  ...overrides,
});

const informationRequirement = (
  id: string,
  term: string,
  source: ReturnType<typeof component>,
  consumer: ReturnType<typeof component>,
): InstalledCommunicationRequirement => ({
  id,
  kind: 'information',
  term,
  source,
  consumer,
});

const controlRequirement = (
  id: string,
  action: string,
  controller: ReturnType<typeof component>,
  target: ReturnType<typeof component>,
): InstalledCommunicationRequirement => ({
  id,
  kind: 'control',
  action,
  controller,
  target,
});

describe('installed communication requirement evaluation', () => {
  it('satisfies exact information requirements and preserves the G8 fact reference', () => {
    const fact = information('SOC', component('battery-1'), component('monitor-1'));
    const result = evaluateInstalledCommunicationRequirements({
      requirements: [
        informationRequirement('r1', 'SOC', component('battery-1'), component('monitor-1')),
      ],
      interpretation: interpretation({ information_availability: [fact] }),
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      requirement_id: 'r1',
      status: 'satisfied',
      matched_fact_id: fact.id,
      support: fact.support,
    });
  });

  it('requires exact terms and exact source and consumer identities', () => {
    const fact = information('SOC', component('battery-1'), component('monitor-1'));
    const result = evaluateInstalledCommunicationRequirements({
      requirements: [
        informationRequirement('wrong-term', 'soc', component('battery-1'), component('monitor-1')),
        informationRequirement(
          'wrong-source',
          'SOC',
          component('battery-2'),
          component('monitor-1'),
        ),
        informationRequirement(
          'wrong-consumer',
          'SOC',
          component('battery-1'),
          component('monitor-2'),
        ),
      ],
      interpretation: interpretation({ information_availability: [fact] }),
    });
    expect(result.results.map((item) => item.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(result.results.every((item) => item.status !== 'not_satisfied')).toBe(true);
  });

  it('distinguishes component and endpoint identity, including repeated endpoint IDs', () => {
    const fact = information('SOC', component('battery-1'), component('monitor-1'));
    const endpointFact = {
      ...information('SOC', endpoint('battery-1', 'status'), endpoint('monitor-1', 'status')),
      source: { reviewed_participant_id: 'source', target: endpoint('battery-1', 'status') },
      consumer: { reviewed_participant_id: 'consumer', target: endpoint('monitor-1', 'status') },
    };
    const result = evaluateInstalledCommunicationRequirements({
      requirements: [
        informationRequirement('component', 'SOC', component('battery-1'), component('monitor-1')),
        informationRequirement(
          'other-instance',
          'SOC',
          component('battery-2'),
          component('monitor-1'),
        ),
        informationRequirement(
          'endpoint',
          'SOC',
          endpoint('battery-1', 'status'),
          endpoint('monitor-1', 'status'),
        ),
        informationRequirement(
          'other-endpoint',
          'SOC',
          endpoint('battery-2', 'status'),
          endpoint('monitor-1', 'status'),
        ),
        informationRequirement(
          'component-vs-endpoint',
          'SOC',
          component('battery-1'),
          endpoint('monitor-1', 'status'),
        ),
      ],
      interpretation: interpretation({ information_availability: [fact, endpointFact] }),
    });
    expect(result.results.map((item) => item.status)).toEqual([
      'satisfied',
      'unknown',
      'satisfied',
      'unknown',
      'unknown',
    ]);
  });

  it('treats multiple G8 support paths as one satisfied requirement result', () => {
    const fact = information('SOC', component('battery-1'), component('monitor-1'));
    const result = evaluateInstalledCommunicationRequirements({
      requirements: [
        informationRequirement('r1', 'SOC', component('battery-1'), component('monitor-1')),
      ],
      interpretation: interpretation({
        information_availability: [
          {
            ...fact,
            support: [...fact.support, { ...fact.support[0]!, reviewed_relationship_id: 'second' }],
          },
        ],
      }),
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.matched_fact_id).toBe(fact.id);
  });

  it('satisfies exact control requirements without using information facts', () => {
    const fact = control('set_charge_limit', component('controller-1'), component('charger-1'));
    const result = evaluateInstalledCommunicationRequirements({
      requirements: [
        controlRequirement(
          'control',
          'set_charge_limit',
          component('controller-1'),
          component('charger-1'),
        ),
        controlRequirement(
          'wrong-action',
          'charge_limit',
          component('controller-1'),
          component('charger-1'),
        ),
        controlRequirement(
          'wrong-controller',
          'set_charge_limit',
          component('controller-2'),
          component('charger-1'),
        ),
        controlRequirement(
          'wrong-target',
          'set_charge_limit',
          component('controller-1'),
          component('charger-2'),
        ),
      ],
      interpretation: interpretation({
        information_availability: [
          information('set_charge_limit', component('controller-1'), component('charger-1')),
        ],
        control_availability: [fact],
      }),
    });
    expect(result.results.map((item) => item.status)).toEqual([
      'satisfied',
      'unknown',
      'unknown',
      'unknown',
    ]);
  });

  it('keeps control instance identity and does not invent runtime semantics', () => {
    const fact = control('set_charge_limit', component('controller-1'), component('charger-1'));
    const result = evaluateInstalledCommunicationRequirements({
      requirements: [
        controlRequirement(
          'matched',
          'set_charge_limit',
          component('controller-1'),
          component('charger-1'),
        ),
        controlRequirement(
          'other-controller',
          'set_charge_limit',
          component('controller-2'),
          component('charger-1'),
        ),
      ],
      interpretation: interpretation({ control_availability: [fact] }),
    });
    expect(result.results.map((item) => item.status)).toEqual(['satisfied', 'unknown']);
    expect(result).not.toHaveProperty('runtime_success');
    expect(result).not.toHaveProperty('authorization');
    expect(result).not.toHaveProperty('safety');
  });

  it('evaluates requirements independently and preserves deterministic order', () => {
    const requirements = [
      informationRequirement('r2', 'temperature', component('battery-1'), component('monitor-1')),
      informationRequirement('r1', 'SOC', component('battery-1'), component('monitor-1')),
    ];
    const result = evaluateInstalledCommunicationRequirements({
      requirements,
      interpretation: interpretation({
        information_availability: [
          information('SOC', component('battery-1'), component('monitor-1')),
        ],
      }),
    });
    expect(result.results.map((item) => item.requirement_id)).toEqual(['r1', 'r2']);
    expect(result.results.map((item) => item.status)).toEqual(['satisfied', 'unknown']);
  });

  it('returns an empty result for an explicit empty collection and rejects duplicate or invalid requirements', () => {
    expect(
      evaluateInstalledCommunicationRequirements({
        requirements: [],
        interpretation: interpretation(),
      }),
    ).toEqual({ results: [] });
    expect(() =>
      evaluateInstalledCommunicationRequirements({
        requirements: [
          informationRequirement('', 'SOC', component('battery-1'), component('monitor-1')),
        ],
        interpretation: interpretation(),
      }),
    ).toThrow('non-empty');
    expect(() =>
      evaluateInstalledCommunicationRequirements({
        requirements: [
          informationRequirement(
            'duplicate',
            'SOC',
            component('battery-1'),
            component('monitor-1'),
          ),
          informationRequirement(
            'duplicate',
            'temperature',
            component('battery-1'),
            component('monitor-1'),
          ),
        ],
        interpretation: interpretation(),
      }),
    ).toThrow('Duplicate requirement ID');
  });

  it('keeps absence and ambiguity unknown rather than not_satisfied', () => {
    const result = evaluateInstalledCommunicationRequirements({
      requirements: [
        informationRequirement('missing', 'SOC', component('battery-1'), component('monitor-1')),
      ],
      interpretation: interpretation({
        diagnostics: [
          {
            code: 'ambiguous_information_source',
            relationship_id: 'relationship',
            detail: 'Multiple sources',
          },
        ],
      }),
    });
    expect(result.results[0]).toMatchObject({
      status: 'unknown',
      reason_code: 'ambiguous_information_interpretation',
    });
    expect(result.results[0]).not.toHaveProperty('matched_fact_id');
  });

  it('supports the realistic system means case', () => {
    const b1 = component('battery-1');
    const gx1 = component('monitor-1');
    const shunt = component('shunt-1');
    const f1 = component('protection-1');
    const c1 = component('controller-1');
    const charger = component('charger-1');
    const result = evaluateInstalledCommunicationRequirements({
      requirements: [
        informationRequirement('r1', 'SOC', b1, gx1),
        informationRequirement('r2', 'temperature', b1, gx1),
        informationRequirement('r3', 'current', shunt, gx1),
        informationRequirement('r4', 'trip_state', f1, gx1),
        controlRequirement('r5', 'set_charge_limit', c1, charger),
      ],
      interpretation: interpretation({
        information_availability: [
          information('SOC', b1, gx1),
          information('temperature', b1, gx1),
          information('current', shunt, gx1),
        ],
        control_availability: [control('set_charge_limit', c1, charger)],
      }),
    });
    expect(result.results.map((item) => item.status)).toEqual([
      'satisfied',
      'satisfied',
      'satisfied',
      'unknown',
      'satisfied',
    ]);
  });

  it('does not mutate inputs and repeated evaluation is deep-equal', () => {
    const input = {
      requirements: [
        informationRequirement('r1', 'SOC', component('battery-1'), component('monitor-1')),
      ],
      interpretation: interpretation({
        information_availability: [
          information('SOC', component('battery-1'), component('monitor-1')),
        ],
      }),
    };
    const before = structuredClone(input);
    const first = evaluateInstalledCommunicationRequirements(input);
    expect(evaluateInstalledCommunicationRequirements(input)).toEqual(first);
    expect(input).toEqual(before);
  });
});
