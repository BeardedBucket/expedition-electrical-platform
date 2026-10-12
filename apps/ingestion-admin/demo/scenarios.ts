import type {
  OperatorApi,
  OperatorJobDetail,
  SemanticDecisionInput,
  SemanticPreviewRequest,
  SemanticTargetResponse,
} from '../src/api.js';
import { OperatorApiError } from '../src/api.js';
type WorkItem = NonNullable<OperatorJobDetail['semantic_review']>['work']['required'][number];
type Fact = WorkItem['evidence'][number];
type FixtureInput<T> = T extends readonly (infer U)[]
  ? FixtureInput<U>[]
  : T extends object
    ? { [K in keyof T]?: FixtureInput<T[K]> }
    : T;
type PreviewValue = number | { min: number; max: number };
const output = 'electrical.continuous_output_current_a';
const input = 'electrical.continuous_input_current_a';
function descriptor(field: string, unit = 'A', dimension = 'current') {
  return {
    canonical_field: field,
    value_shapes: ['number'] as const,
    dimension,
    unit,
    allows_unit_conversion: true,
    human_adjudication: 'source_fact' as const,
    normalizer_version: 'synthetic-preview.v1',
  };
}
function fact(label: string, raw: string, extra: FixtureInput<Fact> = {}): Fact {
  return {
    id: 'synthetic.' + label,
    label,
    raw_value: raw,
    unit: 'A',
    applicability: { kind: 'exact_mpn_or_sku', value: 'DEMO-1' },
    qualification: 'exact',
    document: 'Invented demonstration specifications',
    source_uri: 'https://example.test/synthetic-specifications',
    conflicts: [],
    locators: [
      { role: 'value', text: raw, locator: { kind: 'html', path: '/table[1]/tr[1]/td[2]' } },
    ],
    source_context: {
      wording: raw,
      capture_id: 'synthetic-capture',
      capture: {
        kind: 'source_capture',
        reference: 'synthetic-capture',
        digest: 'sha256:' + 'a'.repeat(64),
        digest_algorithm: 'sha256',
        reference_schema_version: '1.0',
      },
      content_digest: 'sha256:' + 'b'.repeat(64),
    },
    ...extra,
  } as Fact;
}
function item(id: string, facts: Fact[], extra: FixtureInput<WorkItem> = {}): WorkItem {
  return {
    id,
    automatic_target: 'source_label:' + facts[0]?.label,
    automatic_disposition: 'unsupported',
    derived: false,
    state: 'automatic',
    required: true,
    decision_history: [],
    evidence: facts,
    ...extra,
  } as WorkItem;
}
export interface DemoScenario {
  id: string;
  title: string;
  risk: string;
  items: WorkItem[];
  targets: SemanticTargetResponse['targets'];
  values?: Record<string, PreviewValue>;
  previewError?: string;
  nonProjection?: string;
  identity?: { manufacturer: string; product_model: string };
  retainedSource?: {
    observation_digest: string;
    pdf_digest: string;
    uri: string;
    page: number;
    engine: string;
    version: string;
  };
}
const conditioned =
  'This synthetic source has material conditions or uncertain applicability. Direct scalar mapping cannot discard them; keep the meaning unresolved or report a possible missing property.';
// Shapes come from the frozen audit's condition/state/direction/body-vs-installation boundaries.
// Every number, identity, URI and locator below is invented; no manufacturer fact is asserted.
export const demoScenarios: DemoScenario[] = [
  {
    id: 'scalar',
    title: '01 · Eligible continuous output rating',
    risk: 'Review a straightforward source statement, inspect conversion, then save and next.',
    items: [
      item('scalar', [fact('Continuous output current', '40 A')]),
      item('scalar-next', [fact('Second continuous output current', '60 A')]),
    ],
    targets: [descriptor(output), descriptor(input)],
    values: { scalar: 40, 'scalar-next': 60 },
  },
  {
    id: 'duration',
    title: '02 · Continuous versus time-limited current',
    risk: 'Identical numbers have different meanings when duration and temperature apply.',
    items: [
      item('continuous', [fact('Continuous output current', '150 A')]),
      item('limited', [
        fact('Maximum current for five seconds', '150 A for 5 seconds at 25°C', {
          source_context: {
            wording: '150 A for 5 seconds at 25°C',
            duration: '5 seconds',
            temperature: '25°C',
          },
        }),
      ]),
    ],
    targets: [descriptor(output), descriptor(input)],
    values: { continuous: 150 },
    previewError: conditioned,
  },
  {
    id: 'surge',
    title: '03 · Surge duration and temperature',
    risk: 'Preserve a surge rating and all qualifiers; Slice A cannot manually map arbitrary qualified ratings.',
    items: [
      item('surge', [
        fact('Surge output power', '2400 W for 3 seconds at 20°C', {
          unit: 'W',
          source_context: {
            wording: '2400 W for 3 seconds at 20°C',
            duration: '3 seconds',
            temperature: '20°C',
            conditions: ['Surge operating state'],
          },
        }),
      ]),
    ],
    targets: [],
    previewError: conditioned,
  },
  {
    id: 'measurement',
    title: '04 · Accuracy and resolution on a 500 A shunt',
    risk: 'Measurement basis is not current ampacity. Precision has no supported direct target.',
    items: [
      item('accuracy', [
        fact('Current measurement accuracy', '±0.4% with a 500 A shunt', {
          unit: '%',
          source_context: {
            wording: '±0.4% with a 500 A shunt',
            conditions: ['Specified 500 A shunt basis'],
          },
          locators: [
            {
              role: 'qualifier',
              text: '500 A shunt basis; resolution 0.1 A',
              locator: { kind: 'pdf', page: 2 },
            },
          ],
        }),
      ]),
    ],
    targets: [],
  },
  {
    id: 'sibling',
    title: '05 · Exact part versus sibling model',
    risk: 'A conversion can succeed without establishing applicability to the requested part.',
    items: [
      item('sibling', [
        fact('Sibling model continuous current', '80 A', {
          applicability: { kind: 'exact_mpn_or_sku', value: 'DEMO-2' },
        }),
      ]),
    ],
    targets: [descriptor(output)],
    values: { sibling: 80 },
    nonProjection:
      'Source names DEMO-2; requested part is DEMO-1. Exact target applicability is not established.',
  },
  {
    id: 'table',
    title: '06 · Uncertain shared table column',
    risk: 'Do not borrow a neighboring column when model assignment is uncertain.',
    items: [
      item('table', [
        fact('Shared table maximum current', '30 A or 45 A', {
          qualification: 'ambiguous',
          source_context: {
            wording: '30 A | 45 A',
            alternatives: ['DEMO-1 column', 'DEMO-2 column'],
          },
          locators: [
            {
              role: 'subject',
              text: 'DEMO-1 | DEMO-2; spanning header assignment uncertain',
              locator: { kind: 'html', path: '/table[1]/tr[1]' },
            },
          ],
        }),
      ]),
    ],
    targets: [descriptor(output)],
    previewError: conditioned,
  },
  {
    id: 'direction',
    title: '07 · Electrical input versus output',
    risk: 'Compare similarly named properties; direction is part of the engineering meaning.',
    items: [
      item('input', [fact('Continuous input current', '12 A')]),
      item('output', [fact('Continuous output current', '18 A')]),
    ],
    targets: [descriptor(input), descriptor(output)],
    values: { input: 12, output: 18 },
  },
  {
    id: 'state',
    title: '08 · No-load, standby and quiescent consumption',
    risk: 'Consumption depends on operating state; do not substitute rated output power.',
    items: [
      item('no-load', [
        fact('No-load consumption', '6 W', {
          unit: 'W',
          source_context: {
            wording: '6 W without connected load',
            conditions: ['No connected load'],
          },
        }),
      ]),
      item('standby', [
        fact('Standby consumption', '1.2 W', {
          unit: 'W',
          source_context: { wording: '1.2 W in standby', conditions: ['Standby'] },
        }),
      ]),
      item('quiescent', [
        fact('Quiescent current', '0.03 A', {
          source_context: { wording: '0.03 A quiescent', conditions: ['Quiescent state'] },
        }),
      ]),
    ],
    targets: [],
  },
  {
    id: 'physical',
    title: '09 · Body dimensions, mounting and clearance',
    risk: 'Body dimensions differ from fastener spacing and installed clearance.',
    items: [
      item('body', [fact('Body width', '180 mm', { unit: 'mm' })]),
      item('mount', [fact('Mounting hole spacing', '160 mm', { unit: 'mm' })]),
      item('clearance', [
        fact('Required upper clearance', '50 mm', {
          unit: 'mm',
          source_context: {
            wording: '50 mm above installed body',
            conditions: ['Installation clearance'],
          },
        }),
      ]),
    ],
    targets: [descriptor('dimensions_mm.x', 'mm', 'length')],
    values: { body: 180 },
    previewError: conditioned,
  },
  {
    id: 'conversion',
    title: '10 · Evidence-supported unit conversion',
    risk: 'Compare the exact inch source with its server-unit representation; do not type an invented value.',
    items: [item('conversion', [fact('Body height Z', '11.5 in', { unit: 'in' })])],
    targets: [descriptor('dimensions_mm.z', 'mm', 'length')],
    values: { conversion: 292.1 },
  },
  {
    id: 'conflict',
    title: '11 · Competing source observations',
    risk: 'Choose evidence deliberately and explain the conflict; automatic extraction is provisional.',
    items: [
      item('conflict', [
        fact('Continuous output current', '40 A', {
          id: 'conflicting-fact.40',
          conflicts: [{ id: 'synthetic-conflict-45', outcome: 'unresolved' }],
        }),
        fact('Continuous output current alternate', '45 A', {
          id: 'conflicting-fact.45',
          conflicts: [{ id: 'synthetic-conflict-40', outcome: 'unresolved' }],
        }),
      ]),
    ],
    targets: [descriptor(output)],
    values: { conflict: 40 },
  },
  {
    id: 'missing',
    title: '12 · Meaningful unsupported engineering concept',
    risk: 'Record a possible missing concept without creating a canonical property.',
    items: [
      item('missing', [
        fact('Front ingress protection with panel gasket', 'Synthetic protection class', {
          unit: undefined,
          source_context: {
            wording: 'Synthetic protection class only when gasket installed',
            conditions: ['Front face with installed gasket'],
          },
        }),
      ]),
    ],
    targets: [],
  },
  {
    id: 'provenance',
    title: '13 · Missing context and provenance',
    risk: 'Missing information remains unknown. It cannot establish unconditional or exact applicability.',
    items: [
      item('provenance', [
        fact('Unlabeled electrical value', '24', {
          unit: undefined,
          applicability: undefined,
          qualification: undefined,
          document: undefined,
          source_uri: undefined,
          source_context: undefined,
          locators: [],
        }),
      ]),
    ],
    targets: [],
  },
  {
    id: 'layout',
    title: '14 · Long evidence and 240-item queue',
    risk: 'Stress nested layout, searchable bounded scrolling and technical-string access without page overflow.',
    items: Array.from({ length: 240 }, (_, index) =>
      item('layout-' + index, [
        fact(
          'Source specification ' +
            index +
            ' with a deliberately long manufacturer label describing multiple test arrangements and retained notes',
          '40 A',
          {
            id: 'synthetic-long-fact-' + index + '-' + 'f'.repeat(180),
            source_uri: 'https://example.test/' + 'source-reference-'.repeat(30),
            source_context: {
              wording: '40 A',
              conditions: [
                'A long synthetic source note describes operating state, measurement basis, model scope and uncertainty. '.repeat(
                  8,
                ),
              ],
              capture_id: 'synthetic-' + 'c'.repeat(160),
              content_digest: 'sha256:' + 'd'.repeat(64),
            },
            locators: [
              {
                role: 'qualifier',
                text: 'Bound manufacturer-style note (invented). '.repeat(16),
                locator: { kind: 'html', path: '/' + 'table[100]/tr[200]/td[300]/'.repeat(14) },
              },
            ],
          },
        ),
      ]),
    ),
    targets: [descriptor(output)],
    previewError: conditioned,
  },
  {
    id: 'recovery',
    title: '15 · Failed save and stale-snapshot recovery',
    risk: 'Choose failure controls, retain local input, reload/reconfirm evidence, and append a correction revision without replay.',
    items: [
      item('recovery', [fact('Continuous output current needing review', '40 A')], {
        required: false,
        state: 'unresolved',
        active_decision: {
          id: 'synthetic-prior',
          proposal_id: 'recovery',
          revision: 1,
          active: true,
          outcome: 'unresolved',
          actor_label: 'Synthetic previous reviewer',
          recorded_at: '2026-10-10T00:00:00Z',
          selected_fact_ids: ['synthetic.Continuous output current needing review'],
          rationale: 'Need a second interpretation.',
        },
        decision_history: [
          {
            id: 'synthetic-prior',
            proposal_id: 'recovery',
            revision: 1,
            active: true,
            outcome: 'unresolved',
            actor_label: 'Synthetic previous reviewer',
            recorded_at: '2026-10-10T00:00:00Z',
            selected_fact_ids: ['synthetic.Continuous output current needing review'],
            rationale: 'Need a second interpretation.',
          },
        ],
      }),
    ],
    targets: [descriptor(output)],
    values: { recovery: 40 },
  },
];
export function createDemoController(scenario: DemoScenario) {
  let failure: 'none' | 'save' | 'stale' | 'reload' = 'none';
  let reloadFails = false;
  let revision = 1;
  const durable = {
    summary: {
      id: scenario.id,
      state: 'review_ready',
      manufacturer: scenario.identity?.manufacturer ?? 'Synthetic maker',
      product_model: scenario.identity?.product_model ?? 'Demonstration device',
      manufacturer_part_number: scenario.retainedSource ? undefined : 'DEMO-1',
    },
    intake: {
      manufacturer: scenario.identity?.manufacturer ?? 'Synthetic maker',
      product_model: scenario.identity?.product_model ?? 'Demonstration device',
      manufacturer_part_number: scenario.retainedSource ? undefined : 'DEMO-1',
      official_product_uri: scenario.retainedSource?.uri ?? 'https://example.test/synthetic',
    },
    candidate: { present: false, non_projected: [] },
    extractions: [],
    facts: [],
    proposals: [],
    diagnostics: [],
    semantic_review: {
      complete: scenario.items.every((item) => !item.required),
      required_dispositions: scenario.items
        .filter((item) => item.required)
        .map((item) => ({ proposal_id: item.id, reason: 'no_current_human_disposition' })),
      expected_review_snapshot: 'synthetic.' + revision,
      interpretation: [],
      decisions: [],
      work: {
        required: structuredClone(scenario.items.filter((item) => item.required)),
        reviewed: structuredClone(scenario.items.filter((item) => !item.required)),
        automatic: [],
        derived: [],
      },
    },
  } as unknown as OperatorJobDetail;
  const current = () => structuredClone(durable);
  const lookup = (id: string) =>
    [
      ...durable.semantic_review!.work.required,
      ...durable.semantic_review!.work.reviewed,
      ...durable.semantic_review!.work.automatic,
    ].find((item) => item.id === id)!;
  const check = (snapshot: string) => {
    if (snapshot !== durable.semantic_review!.expected_review_snapshot)
      throw new OperatorApiError(
        409,
        'Synthetic review changed. Reload and inspect the current evidence.',
      );
  };
  function preview(id: string, intent: SemanticPreviewRequest) {
    check(intent.expected_review_snapshot);
    if (!scenario.targets.some((target) => target.canonical_field === intent.target))
      throw new OperatorApiError(422, 'No supported synthetic target.');
    const selected = lookup(id).evidence.filter((fact) =>
      intent.selected_fact_ids.includes(fact.id),
    );
    if (!selected.length || selected.length !== intent.selected_fact_ids.length)
      throw new OperatorApiError(422, 'Select current source statements.');
    if (scenario.id === 'conflict' && selected.length !== 1)
      throw new OperatorApiError(
        422,
        'Competing values differ. Review and explicitly select one source observation.',
      );
    let value = scenario.values?.[id];
    if (scenario.id === 'conflict') value = selected[0].id === 'conflicting-fact.45' ? 45 : 40;
    if (value === undefined) throw new OperatorApiError(422, scenario.previewError ?? conditioned);
    return {
      target: intent.target,
      selected_fact_ids: intent.selected_fact_ids,
      source_assertions: selected.map((fact) => ({
        fact_id: fact.id,
        raw_value: fact.raw_value,
        source_unit: fact.unit,
      })),
      normalized_value: value,
      normalized_unit: scenario.targets.find((target) => target.canonical_field === intent.target)!
        .unit,
    };
  }
  const methods: Partial<OperatorApi> = {
    get: async () => {
      if (reloadFails) {
        reloadFails = false;
        throw new Error('Synthetic reload failed once. Your input is retained.');
      }
      return current();
    },
    semanticTargets: async (_job, id, intent) => {
      check(intent.expected_review_snapshot);
      return { proposal_id: id, targets: structuredClone(scenario.targets) };
    },
    semanticPreview: async (_job, id, intent) => preview(id, intent),
    semanticDecision: async (_job, decision: SemanticDecisionInput) => {
      if (failure === 'save') {
        failure = 'none';
        throw new Error('Synthetic save failed once. No decision was recorded.');
      }
      if (failure === 'stale' || failure === 'reload') {
        reloadFails = failure === 'reload';
        failure = 'none';
        durable.semantic_review!.expected_review_snapshot = 'synthetic.' + ++revision;
        throw new OperatorApiError(409, 'Synthetic concurrent review changed.');
      }
      check(decision.expected_review_snapshot);
      if (decision.outcome === 'map') {
        const expected = preview(decision.proposal_id, { ...decision });
        if (
          JSON.stringify(expected.normalized_value) !== JSON.stringify(decision.normalized_value) ||
          expected.normalized_unit !== decision.normalized_unit
        )
          throw new OperatorApiError(422, 'Synthetic preview mismatch.');
      }
      const review = durable.semantic_review!;
      const source = lookup(decision.proposal_id);
      const recorded = {
        ...decision,
        id: 'synthetic-decision.' + ++revision,
        revision: (source.active_decision?.revision ?? 0) + 1,
        active: true,
        recorded_at: '2026-10-10T00:00:00Z',
      };
      const next = {
        ...source,
        required: false,
        state: decision.outcome,
        active_decision: recorded,
        decision_history: [
          ...source.decision_history.map((prior) => ({ ...prior, active: false })),
          recorded,
        ],
        ...(decision.outcome === 'map'
          ? {
              target: decision.target,
              value: decision.normalized_value,
              normalized_unit: decision.normalized_unit,
            }
          : { target: undefined, value: undefined, normalized_unit: undefined }),
      };
      review.work.required = review.work.required.filter((item) => item.id !== source.id);
      review.work.reviewed = [
        ...review.work.reviewed.filter((item) => item.id !== source.id),
        next,
      ] as typeof review.work.reviewed;
      review.expected_review_snapshot = 'synthetic.' + revision;
      review.complete = !review.work.required.length;
      review.required_dispositions = review.work.required.map((item) => ({
        proposal_id: item.id,
        reason: 'no_current_human_disposition',
      }));
      durable.candidate!.non_projected =
        decision.outcome === 'map'
          ? [
              {
                proposal_id: source.id,
                reason:
                  scenario.nonProjection ??
                  'This synthetic lab does not build real candidates. Saving records review progress only.',
              },
            ]
          : [];
      return current();
    },
  };
  // Every unimplemented authority action throws locally. No retained store or canonical writer is imported; bundled browser API
  // definitions are not called (the static build also denies connections via CSP). the real HTTP safety contract is exercised separately by focused runtime tests.
  const client = new Proxy(methods, {
    get(target, key) {
      return (
        target[key as keyof OperatorApi] ??
        (async () => {
          throw new Error('Unavailable in the isolated synthetic lab: ' + String(key));
        })
      );
    },
  }) as OperatorApi;
  return {
    client,
    current,
    failNext: (mode: typeof failure) => {
      failure = mode;
    },
  };
}
