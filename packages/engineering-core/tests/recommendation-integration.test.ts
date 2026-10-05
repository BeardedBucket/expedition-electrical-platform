import { describe, expect, it, vi } from 'vitest';
import { generateArchitectures } from '../src/architecture-generation.js';
import { evaluateProductSelection, bindProductSelection } from '../src/product-selection.js';
import { evaluateInstalledSystem } from '../src/engineering-passport.js';
import {
  evaluateRecommendation,
  recommendationPolicy,
  parseRecommendation,
  serializeRecommendation,
  type SelectionOptionSource,
  type RecommendationContext,
} from '../src/recommendation.js';
import { converterProduct, selectionRequest } from './fixtures/selection.js';
import {
  observationSource,
  recommendationRequest,
  recommendationSource,
  tradeoffProduct,
} from './fixtures/recommendation.js';
import { serializePassportValue } from '../src/portable-json.js';
import type { AdvisoryRecord, EvidenceRecord } from '../src/advisory.js';
import type { ComponentLibraryRecord } from '../src/component-library.js';

const systemFact = (r: ReturnType<typeof evaluateRecommendation>, kind: string) =>
  r.options[0]!.facts.find((f) => f.kind === kind && f.subject.kind === 'system')!;
const exactChoice = (source: SelectionOptionSource, status = 'ELIGIBLE') => ({
  selection_digest: source.selection.result_digest,
  bindings: source.selection.roles.map((role) => {
    const candidate = role.candidates.find((c) =>
      c.bindings.some(
        (b) =>
          b.status === status &&
          Object.values(b.witness.interfaces).every((i) => i !== null) &&
          Object.values(b.witness.paths).every((i) => i !== null),
      ),
    )!;
    return {
      role_id: role.role.id,
      component_id: candidate.component_id,
      binding_id: candidate.bindings.find(
        (b) =>
          b.status === status &&
          Object.values(b.witness.interfaces).every((i) => i !== null) &&
          Object.values(b.witness.paths).every((i) => i !== null),
      )!.id,
      ...(candidate.assembly ? { assembly: candidate.assembly } : {}),
    };
  }),
});
const acSources = (): SelectionOptionSource[] => {
  const p: ComponentLibraryRecord = {
    id: 'fixture.multi',
    manufacturer: 'Fixture manufacturer',
    model: 'M',
    verification_status: 'verified',
    weight_kg: 3,
    capabilities: [
      { id: 'invert', type: 'inversion', port_ids: ['dc', 'ac-out'] },
      { id: 'charge', type: 'charging', port_ids: ['ac-in', 'dc'] },
    ],
    ports: [
      { id: 'dc', domain: 'dc', direction: 'bidirectional', voltage_v: 24, power_w: 2000 },
      { id: 'ac-in', domain: 'ac', direction: 'input', voltage_v: 230, frequency_hz: 50 },
      {
        id: 'ac-out',
        domain: 'ac',
        direction: 'output',
        voltage_v: 120,
        frequency_hz: 60,
        power_w: 2000,
      },
    ],
    power_paths: [
      { id: 'invert', capability_id: 'invert', from_port: 'dc', to_port: 'ac-out' },
      { id: 'charge', capability_id: 'charge', from_port: 'ac-in', to_port: 'dc' },
    ],
  };
  const generation = generateArchitectures({
    schema_version: '2.0.0',
    assumptions: [],
    requirements: {
      id: 'fixture.ac',
      fixed_house_voltage_v: 24,
      loads: [
        {
          id: 'ac',
          domain: { kind: 'ac', nominal_voltage_v: 120, frequency_hz: 60 },
          required_power_w: 100,
        },
      ],
      charging_sources: [
        {
          id: 'shore',
          kind: 'shore',
          domain: { kind: 'ac', nominal_voltage_v: 230, frequency_hz: 50 },
          required_output_power_w: 100,
        },
      ],
      storage: { required: false },
    },
  });
  return generation.candidates.map((c) => ({
    selection: evaluateProductSelection({
      schema_version: '1.0.0',
      generation,
      candidate_id: c.id,
      corpus: [p],
      fixed_existing: [],
      assemblies: [],
    }),
    handoff: {},
  }));
};
describe('complete option construction and upstream isolation', () => {
  it('explicit blocked binding remains blocked and never enters fronts', () => {
    const good = tradeoffProduct();
    const bad = {
      ...tradeoffProduct('fixture.bad'),
      ports: good.ports!.map((p) => ({ ...p, voltage_v: 48 })),
    };
    const source = recommendationSource([good, bad]);
    const input = recommendationRequest([source]);
    const choice = exactChoice(source, 'BLOCKED');
    const r = evaluateRecommendation({
      ...input,
      construction: { mode: 'explicit', choices: [choice] },
      context: {
        ...input.context,
        prices: [
          {
            component_id: bad.id,
            amount: 0,
            currency: 'USD',
            source: { ...observationSource, owner: 'builder' },
          },
        ],
      },
      preference: {
        ...input.preference,
        tiers: [[{ kind: 'purchase_cost', direction: 'minimize' }]],
      },
    });
    expect(r.options[0]!.engineering_status).toBe('blocked');
    expect(r.fronts).toEqual({ satisfied: [], unresolved: [] });
    expect(r.excluded_option_ids).toEqual([r.options[0]!.id]);
    expect(r.options[0]!.recommendation_exclusions.some((e) => e.owner === 'engineering')).toBe(
      true,
    );
    const bound = bindProductSelection(source.selection, choice.bindings, source.handoff);
    expect(r.options[0]!.passport).toEqual(evaluateInstalledSystem(bound.input, bound.catalog));
  });
  it('automatic construction includes all exact eligible and unresolved bindings, excluding blocked', () => {
    const good = tradeoffProduct();
    const unreviewed = {
      ...tradeoffProduct('fixture.unknown'),
      verification_status: 'unverified' as const,
    };
    const bad = {
      ...tradeoffProduct('fixture.bad'),
      ports: good.ports!.map((p) => ({ ...p, voltage_v: 48 })),
    };
    const source = recommendationSource([good, unreviewed, bad]);
    const r = evaluateRecommendation(recommendationRequest([source]));
    const retained = source.selection.roles[0]!.candidates.flatMap((c) =>
      c.bindings
        .filter(
          (b) =>
            b.status !== 'BLOCKED' && Object.values(b.witness.interfaces).every((i) => i !== null),
        )
        .map((b) => b.id),
    ).sort();
    expect(r.options.flatMap((o) => o.choice.bindings.map((b) => b.binding_id)).sort()).toEqual(
      retained,
    );
    expect(r.options.map((o) => o.engineering_status).sort()).toEqual(['satisfied', 'unresolved']);
    expect(r.options.some((o) => o.choice.bindings.some((b) => b.component_id === bad.id))).toBe(
      false,
    );
  });
  it('fixed missing record remains deferred with exact Phase 5 reasons', () => {
    const base = recommendationSource();
    const selection = evaluateProductSelection({
      ...base.selection.input,
      corpus: [],
      fixed_existing: [{ role_id: 'storage', component_id: 'fixture.missing' }],
    });
    const r = evaluateRecommendation(recommendationRequest([{ selection, handoff: {} }]));
    expect(r.options).toEqual([]);
    expect(
      r.deferred.some((d) => d.phase5_reasons.includes('fixed_component_record_missing')),
    ).toBe(true);
    expect(r.deferred[0]!.candidate.component_id).toBe('fixture.missing');
    expect(parseRecommendation(serializeRecommendation(r))).toEqual(r);
  });
  it('null interface/path identities are deferred without fabrication', () => {
    const base = converterProduct();
    const p = { ...base, ports: [], power_paths: [] };
    const selection = evaluateProductSelection(selectionRequest([p]));
    const r = evaluateRecommendation(recommendationRequest([{ selection, handoff: {} }]));
    expect(r.options).toEqual([]);
    expect(r.deferred.some((d) => d.reasons.includes('exact_witness_identity_missing'))).toBe(true);
    expect(
      r.deferred
        .flatMap((d) => d.candidate.bindings)
        .some((b) => Object.values(b.witness.interfaces).includes(null)),
    ).toBe(true);
  });
  it('symbolic unresolved assembly remains deferred', () => {
    const p = { ...tradeoffProduct(), verification_status: 'unverified' as const };
    const r = evaluateRecommendation(recommendationRequest([recommendationSource([p])]));
    expect(
      r.deferred.some(
        (d) => d.reasons.includes('assembly_reduction_unresolved') && d.binding_id === null,
      ),
    ).toBe(true);
    expect(r.options[0]!.engineering_status).toBe('unresolved');
  });
  it('unmaterializable explicit choice rejects rather than inventing a witness', () => {
    const base = recommendationSource();
    const selection = evaluateProductSelection({
      ...base.selection.input,
      corpus: [],
      fixed_existing: [{ role_id: 'storage', component_id: 'fixture.missing' }],
    });
    const source = { selection, handoff: {} };
    const input = recommendationRequest([source]);
    const b = selection.roles[0]!.candidates[0]!.bindings[0]!;
    expect(() =>
      evaluateRecommendation({
        ...input,
        construction: {
          mode: 'explicit',
          choices: [
            {
              selection_digest: selection.result_digest,
              bindings: [{ role_id: 'storage', component_id: 'fixture.missing', binding_id: b.id }],
            },
          ],
        },
      }),
    ).toThrow(/witness/);
  });
  it('explicit complete exact alternatives reproduce automatic evaluated options', () => {
    const input = recommendationRequest([
      recommendationSource([tradeoffProduct(), tradeoffProduct('fixture.b')]),
    ]);
    const automatic = evaluateRecommendation(input);
    const explicit = evaluateRecommendation({
      ...input,
      construction: { mode: 'explicit', choices: automatic.options.map((o) => o.choice) },
    });
    expect(explicit.options).toEqual(automatic.options);
    expect(explicit.fronts).toEqual(automatic.fronts);
  });
  it('fixed existing equipment cannot be substituted outside retained intent', () => {
    const fixed = recommendationSource([tradeoffProduct()], true);
    const other = recommendationSource([tradeoffProduct('fixture.b')]);
    const wrong = { ...exactChoice(other), selection_digest: fixed.selection.result_digest };
    const input = recommendationRequest([fixed]);
    expect(() =>
      evaluateRecommendation({ ...input, construction: { mode: 'explicit', choices: [wrong] } }),
    ).toThrow(/fixed intent/);
  });
  it.each(['duplicate', 'missing_role', 'unknown_selection'] as const)(
    'invalid explicit choice %s is rejected',
    (mode) => {
      const source = recommendationSource();
      const input = recommendationRequest([source]);
      const choice = exactChoice(source);
      const choices =
        mode === 'duplicate'
          ? [choice, choice]
          : mode === 'missing_role'
            ? [{ ...choice, bindings: [] }]
            : [{ ...choice, selection_digest: 'sha256:' + '0'.repeat(64) }];
      expect(() =>
        evaluateRecommendation({ ...input, construction: { mode: 'explicit', choices } }),
      ).toThrow();
    },
  );
  it('separate roles become separate physical instances of the same model; combined stays one', () => {
    for (const source of acSources()) {
      const r = evaluateRecommendation(recommendationRequest([source]));
      const roleCount = source.selection.roles.length;
      expect(r.options).toHaveLength(1);
      expect(systemFact(r, 'component_count').fact).toEqual({ state: 'known', value: roleCount });
      const instances = r.options[0]!.passport.input.architecture.installation.component_instances!;
      expect(new Set(instances.map((i) => i.id)).size).toBe(roleCount);
      expect(new Set(instances.map((i) => i.component_id)).size).toBe(1);
      expect(systemFact(r, 'selected_power_path_count').fact).toEqual({ state: 'known', value: 2 });
    }
  });
  it('bank unit counts drive complete cost/weight and physical count exactly once', () => {
    const source = recommendationSource();
    const selection = evaluateProductSelection({
      ...source.selection.input,
      assemblies: [
        {
          role_id: 'storage',
          kind: 'homogeneous',
          component_id: 'fixture.a',
          series_count: 1,
          parallel_count: 2,
        },
      ],
    });
    const input = recommendationRequest([{ ...source, selection }]);
    const automatic = evaluateRecommendation(input);
    const bank = automatic.options.find((o) => o.choice.bindings[0]!.assembly)!;
    const r = evaluateRecommendation({
      ...input,
      construction: { mode: 'explicit', choices: [bank.choice] },
      context: {
        ...input.context,
        prices: [
          { component_id: 'fixture.a', amount: 100, currency: 'USD', source: observationSource },
        ],
      },
    });
    expect(systemFact(r, 'weight').fact).toEqual({ state: 'known', value: 4 });
    expect(systemFact(r, 'purchase_cost').fact).toEqual({ state: 'known', value: 200 });
    expect(systemFact(r, 'component_count').fact).toEqual({ state: 'known', value: 2 });
    expect(systemFact(r, 'weight').calculation!.inputs[0]!.quantity).toBe(2);
  });
  it.each(['weight_missing', 'purchase_cost_missing', 'mixed_currency'] as const)(
    'aggregate %s retains subtotal and unresolved contributors',
    (mode) => {
      const initial = acSources()[0]!;
      const p = initial.selection.input.corpus[0]!;
      const roleCount = initial.selection.roles.length;
      // Separate architecture supplies two independent physical instances; fixed
      // intents let each use an intentionally distinct model without preference pruning.
      const source = acSources().find((s) => s.selection.roles.length === 2)!;
      const q = { ...p, id: 'fixture.other', weight_kg: mode === 'weight_missing' ? null : 5 };
      const selection = evaluateProductSelection({
        ...source.selection.input,
        corpus: [p, q],
        fixed_existing: source.selection.roles.map((r, i) => ({
          role_id: r.role.id,
          component_id: i ? q.id : p.id,
        })),
      });
      const input = recommendationRequest([{ selection, handoff: {} }]);
      const r = evaluateRecommendation({
        ...input,
        context: {
          ...input.context,
          prices: [
            { component_id: p.id, amount: 10, currency: 'USD', source: observationSource },
            ...(mode === 'purchase_cost_missing'
              ? []
              : [
                  {
                    component_id: q.id,
                    amount: 20,
                    currency: mode === 'mixed_currency' ? 'CAD' : 'USD',
                    source: observationSource,
                  },
                ]),
          ],
        },
      });
      const f = systemFact(r, mode === 'weight_missing' ? 'weight' : 'purchase_cost');
      expect(roleCount).toBeGreaterThan(0);
      expect(f.fact.state).toBe('unknown');
      expect(f.completeness).toBe('incomplete');
      expect(f.calculation!.unresolved_contributors.length).toBeGreaterThan(0);
      expect(f.calculation!.known_subtotals).toEqual(
        mode === 'weight_missing'
          ? [{ unit: 'kg', value: 3 }]
          : mode === 'purchase_cost_missing'
            ? [{ unit: 'USD', value: 10 }]
            : [
                { unit: 'CAD', value: 20 },
                { unit: 'USD', value: 10 },
              ],
      );
    },
  );
  it('system optional monitoring can come from a different selected device', () => {
    const source = acSources().find((s) => s.selection.roles.length === 2)!;
    const p = source.selection.input.corpus[0]!;
    const q = {
      ...p,
      id: 'fixture.monitor',
      capabilities: [...p.capabilities!, { id: 'monitor', type: 'monitoring' as const }],
    };
    const a = { ...p, unsupported_capabilities: ['monitoring' as const] };
    const selection = evaluateProductSelection({
      ...source.selection.input,
      corpus: [a, q],
      fixed_existing: source.selection.roles.map((r, i) => ({
        role_id: r.role.id,
        component_id: i ? q.id : a.id,
      })),
    });
    const r = evaluateRecommendation(recommendationRequest([{ selection, handoff: {} }]));
    expect(systemFact(r, 'optional_capability.monitoring').fact).toEqual({
      state: 'known',
      value: true,
    });
    expect(
      r.options[0]!.facts.filter(
        (f) => f.kind === 'optional_capability.monitoring' && f.subject.kind === 'component',
      )
        .map((f) => f.fact.state)
        .sort(),
    ).toEqual(['absent', 'known']);
    expect(r.options[0]!.engineering_status).toBe('unresolved');
  });
  it.each(['max_tradeoff_facts', 'max_observations'] as const)(
    'rejects %s before materialization without truncation',
    (bound) => {
      const input = recommendationRequest();
      expect(() =>
        evaluateRecommendation(input, {
          ...recommendationPolicy,
          bounds: { ...recommendationPolicy.bounds, [bound]: 1 },
        }),
      ).toThrow(/bound/);
    },
  );
  it('preference policy and commercial facts never change the exact passports', () => {
    const input = recommendationRequest();
    const a = evaluateRecommendation(input);
    const b = evaluateRecommendation(
      {
        ...input,
        preference: { ...input.preference, tiers: [[{ kind: 'weight', direction: 'maximize' }]] },
        context: {
          ...input.context,
          prices: [
            {
              component_id: 'fixture.a',
              amount: 100000,
              currency: 'USD',
              source: observationSource,
            },
          ],
        },
      },
      { ...recommendationPolicy, status: 'reviewed' },
    );
    expect(b.options[0]!.passport).toEqual(a.options[0]!.passport);
    expect(b.input.sources[0]!.selection).toEqual(a.input.sources[0]!.selection);
    expect(b.result_digest).not.toBe(a.result_digest);
  });
});

describe('late exact timing preserves requirement and Phase 4 authority', () => {
  it('late explicit timing preserves endpoint identity, W and origin without generated assumptions', () => {
    const source = recommendationSource();
    const bound = bindProductSelection(
      source.selection,
      exactChoice(source).bindings,
      source.handoff,
    );
    const demand = bound.input.requirements.project_demands![0]!;
    expect(demand.id).toBe(
      source.selection.input.generation.candidates[0]!.demand_endpoints[0]!.id,
    );
    expect(demand.required_power_w).toBe(100);
    expect(demand.provenance).toMatchObject({ requirement_id: 'load' });
    expect(bound.input.assumptions).toEqual([]);
    expect(source.selection.input.generation.input.requirements.loads[0]!.schedule).toBeUndefined();
  });
  it('upstream schedule interpretation remains unresolved despite complete exact accounting', () => {
    const r = evaluateRecommendation(
      recommendationRequest([recommendationSource([tradeoffProduct()], false, true)]),
    );
    expect(r.options[0]!.passport.result.energy.completeness).toBe('complete');
    expect(r.options[0]!.engineering_status).toBe('unresolved');
  });
  it.each(['override', 'unknown_id', 'duplicate'] as const)('rejects late timing %s', (mode) => {
    const source = recommendationSource([tradeoffProduct()], false, true);
    const schedule = source.handoff.project_demand_schedules![0]!;
    const schedules =
      mode === 'override'
        ? [{ ...schedule, schedule: [{ state: 'active' as const, duration_hours: 2 }] }]
        : mode === 'unknown_id'
          ? [{ ...schedule, demand_id: 'missing' }]
          : [schedule, schedule];
    expect(() =>
      bindProductSelection(source.selection, exactChoice(source).bindings, {
        ...source.handoff,
        project_demand_schedules: schedules,
      }),
    ).toThrow();
  });
  it('omitted late timing stays unknown rather than gaining a default schedule', () => {
    const source = recommendationSource();
    const { project_demand_schedules: _unused, ...handoff } = source.handoff;
    const r = evaluateRecommendation(recommendationRequest([{ ...source, handoff }]));
    expect(r.options[0]!.passport.result.energy.completeness).toBe('incomplete');
    expect(r.options[0]!.engineering_status).toBe('unresolved');
  });
});

const advisoryContext = (
  action: AdvisoryRecord['policy_action'],
): NonNullable<RecommendationContext['advisory']> => {
  const evidence: EvidenceRecord = {
    id: 'fixture.recall',
    affected_component_ids: ['fixture.a'],
    type: 'recall',
    sources: [{ id: 'fixture.source', type: 'synthetic', date_checked: '2026-09-01' }],
    date_checked: '2026-09-01',
    summary: 'Project-authored test notice',
    verification_status: 'verified',
    status: 'active',
  };
  const advisory: AdvisoryRecord = {
    id: 'fixture.advisory',
    affected_component_ids: ['fixture.a'],
    status: 'active',
    severity: 'critical',
    confidence: 'high',
    evidence_ids: [evidence.id],
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    summary: 'Synthetic advisory',
    rationale: 'Synthetic test rationale',
    policy_action: action,
  };
  return {
    evaluated_at: '2026-09-03T00:00:00Z',
    records: [advisory],
    evidence: [evidence],
    configuration: {},
  };
};
describe('explicit advisory ownership and determinism', () => {
  it.each(['caution', 'suppress_recommendation', 'exclude'] as const)(
    'preserves engineering truth with advisory %s',
    (action) => {
      const input = recommendationRequest();
      const a = evaluateRecommendation(input);
      const r = evaluateRecommendation({
        ...input,
        context: { ...input.context, advisory: advisoryContext(action) },
      });
      expect(r.options[0]!.passport).toEqual(a.options[0]!.passport);
      expect(r.options[0]!.engineering_status).toBe('satisfied');
      expect(r.options[0]!.advisory[0]!.effective_policy_action).toBe(action);
      expect(r.fronts.satisfied.length).toBe(action === 'caution' ? 1 : 0);
      expect(systemFact(r, 'advisory_context').provenance[0]!.owner).toBe('advisory');
      expect(parseRecommendation(serializeRecommendation(r))).toEqual(r);
    },
  );
  it('missing advisory context is visible and not asserted as no advisories', () => {
    const r = evaluateRecommendation(recommendationRequest());
    expect(r.warnings).toContain('advisory_context_missing');
    expect(systemFact(r, 'advisory_context').fact.state).toBe('unknown');
  });
  it('explicit empty advisory snapshot differs from absent context', () => {
    const input = recommendationRequest();
    const r = evaluateRecommendation({
      ...input,
      context: {
        ...input.context,
        advisory: {
          evaluated_at: '2026-09-03T00:00:00Z',
          records: [],
          evidence: [],
          configuration: {},
        },
      },
    });
    expect(systemFact(r, 'advisory_context').fact.state).toBe('known');
    expect(r.options[0]!.advisory[0]!.applicable_advisory_ids).toEqual([]);
  });
  it.each(['evaluated_at', 'updated_at'] as const)(
    'refuses ambient-timezone advisory date %s',
    (field) => {
      const input = recommendationRequest();
      const advisory = advisoryContext('caution');
      const changed =
        field === 'evaluated_at'
          ? { ...advisory, evaluated_at: '2026-09-03T00:00:00' }
          : {
              ...advisory,
              records: advisory.records.map((r) => ({ ...r, updated_at: '2026-09-02T00:00:00' })),
            };
      expect(() =>
        evaluateRecommendation({ ...input, context: { ...input.context, advisory: changed } }),
      ).toThrow(/timezone/);
    },
  );
  it('runtime reads neither clock nor randomness nor network', () => {
    const input = recommendationRequest();
    const baseline = evaluateRecommendation(input);
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('clock');
    });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('random');
    });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network');
    });
    try {
      expect(serializePassportValue(evaluateRecommendation(input))).toBe(
        serializePassportValue(baseline),
      );
    } finally {
      clock.mockRestore();
      random.mockRestore();
      fetch.mockRestore();
    }
  });
});
