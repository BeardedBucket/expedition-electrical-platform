import { describe, expect, it } from 'vitest';
import {
  evaluateRecommendation,
  parseRecommendation,
  serializeRecommendation,
  replayRecommendation,
  recommendationPolicy,
  type PreferenceCriterion,
  type RecommendationInput,
} from '../src/recommendation.js';
import { serializePassportValue, passportDigest } from '../src/portable-json.js';
import {
  observationSource,
  recommendationRequest,
  recommendationSource,
  tradeoffProduct,
} from './fixtures/recommendation.js';
import { criterionFactKind } from '../src/tradeoff-facts.js';

const fact = (
  r: ReturnType<typeof evaluateRecommendation>,
  kind: string,
  component = 'fixture.a',
) =>
  r.options
    .find((o) => o.choice.bindings[0]?.component_id === component)!
    .facts.find((f) => f.kind === kind && f.subject.kind === 'system')!;
const request = (
  criteria: readonly (readonly PreferenceCriterion[])[] = [],
): RecommendationInput => {
  const a = tradeoffProduct('fixture.a'),
    b = { ...tradeoffProduct('fixture.b'), weight_kg: 4, manufacturer: 'Other maker' };
  return {
    ...recommendationRequest([recommendationSource([a, b])]),
    preference: { schema_version: '1.0.0', id: 'fixture.preference', tiers: criteria },
    context: {
      prices: [
        { component_id: a.id, amount: 200, currency: 'USD', source: observationSource },
        { component_id: b.id, amount: 100, currency: 'USD', source: observationSource },
      ],
      owned_acquisition: [],
      features: [],
    },
  };
};
const criterion = (
  kind: 'weight' | 'purchase_cost',
  direction: 'minimize' | 'maximize' = 'minimize',
): PreferenceCriterion => ({ kind, direction });
const pairForA = (r: ReturnType<typeof evaluateRecommendation>) => {
  const a = r.options.find((o) => o.choice.bindings[0]!.component_id === 'fixture.a')!;
  const p = r.comparisons[0]!;
  return {
    ...p,
    relation:
      p.left_option_id === a.id
        ? p.relation
        : p.relation === 'preferred'
          ? 'worse'
          : p.relation === 'worse'
            ? 'preferred'
            : p.relation,
  };
};
describe('exact engineering authority and structured tradeoffs', () => {
  it('materializes satisfied exact systems through Phase 5 and Phase 3', () => {
    const input = request();
    const before = serializePassportValue(input);
    const r = evaluateRecommendation(input);
    expect(r.options).toHaveLength(2);
    expect(
      r.options[0]!.passport.decisions.filter((d) => d.status !== 'satisfied').map((d) => [
        d.code,
        d.inputs,
      ]),
    ).toEqual([]);
    expect(r.options.every((o) => o.engineering_status === 'satisfied')).toBe(true);
    expect(r.fronts.satisfied[0]).toHaveLength(2);
    expect(serializePassportValue(input)).toBe(before);
    expect(
      r.options.every((o) => o.passport.input.requirements.project_demands?.length === 1),
    ).toBe(true);
  });
  it('keeps unresolved exact systems available when no satisfied system exists', () => {
    const r = evaluateRecommendation(
      recommendationRequest([recommendationSource([tradeoffProduct()], false, true)]),
    );
    expect(r.fronts.satisfied).toEqual([]);
    expect(r.fronts.unresolved[0]).toHaveLength(1);
    expect(r.options[0]!.engineering_status).toBe('unresolved');
    expect(r.options[0]!.passport.input.requirements.mandatory_conditions!.length).toBeGreaterThan(
      0,
    );
  });
  it('separates confirmed and unresolved fronts with no cross-class pairs', () => {
    const r = evaluateRecommendation(
      recommendationRequest([
        recommendationSource(),
        recommendationSource([tradeoffProduct()], false, true),
      ]),
    );
    expect(r.fronts.satisfied[0]).toHaveLength(1);
    expect(r.fronts.unresolved[0]).toHaveLength(1);
    expect(r.comparisons).toEqual([]);
  });
  it.each(['purchase_cost', 'weight', 'optional_capability'] as const)(
    'missing %s does not change engineering status',
    (kind) => {
      const p = { ...tradeoffProduct(), weight_kg: null };
      const input = recommendationRequest([recommendationSource([p])]);
      const preference: PreferenceCriterion =
        kind === 'optional_capability'
          ? { kind, capability: 'communication', direction: 'prefer_present' }
          : { kind, direction: 'minimize' };
      const r = evaluateRecommendation({
        ...input,
        preference: { ...input.preference, tiers: [[preference]] },
      });
      expect(r.options[0]!.engineering_status).toBe('satisfied');
      expect(r.options[0]!.preference_data.completeness).toBe('incomplete');
      expect(
        r.options[0]!.facts.find(
          (f) => f.kind === criterionFactKind(preference) && f.subject.kind === 'system',
        )!.fact.state,
      ).toBe('unknown');
    },
  );
  it('retains complete dimensions per component without a system envelope', () => {
    const r = evaluateRecommendation(request());
    expect(r.options[0]!.facts.filter((f) => f.kind === 'dimensions')).toHaveLength(1);
    expect(
      r.options[0]!.facts.some((f) => f.kind === 'dimensions' && f.subject.kind === 'system'),
    ).toBe(false);
  });
  it('retains weight inputs, units, formula and product provenance', () => {
    const r = evaluateRecommendation(request());
    const w = fact(r, 'weight');
    expect(w.fact).toEqual({ state: 'known', value: 2 });
    expect(w.identity).toBe('derived');
    expect(w.unit).toBe('kg');
    expect(w.calculation!.inputs).toHaveLength(1);
    expect(w.calculation!.unresolved_contributors).toEqual([]);
    expect(w.provenance[0]).toMatchObject({
      owner: 'canonical_product',
      pointer: '/weight_kg',
      source_native_representation: 'not_retained_in_canonical_record',
    });
  });
  it('withholds unverified product preference assertions', () => {
    const p = { ...tradeoffProduct(), verification_status: 'unverified' as const };
    const r = evaluateRecommendation(recommendationRequest([recommendationSource([p])]));
    expect(fact(r, 'weight').fact).toEqual({ state: 'unknown', reason: 'comparison_incomplete' });
    expect(r.options[0]!.engineering_status).toBe('unresolved');
  });
  it('purchase cost has commercial ownership and no fabricated timestamp', () => {
    const r = evaluateRecommendation(request());
    const c = fact(r, 'purchase_cost');
    expect(c.fact).toEqual({ state: 'known', value: 200 });
    expect(c.provenance[0]!.owner).toBe('commercial');
    expect(r.input.context.prices[0]!.source).not.toHaveProperty('observed_at');
    expect(
      r.options[0]!.passport.examined_evidence.some((e) =>
        serializePassportValue(e).includes('price'),
      ),
    ).toBe(false);
  });
  it('different cost currencies are incomparable', () => {
    const input = request([[criterion('purchase_cost')]]);
    const r = evaluateRecommendation({
      ...input,
      context: {
        ...input.context,
        prices: input.context.prices.map((p, i) => ({ ...p, currency: i ? 'CAD' : 'USD' })),
      },
    });
    expect(r.comparisons[0]!.criteria[0]!.reason).toBe('unit_mismatch');
    expect(r.comparisons[0]!.relation).toBe('incomparable');
  });
  it('fixed equipment stays fixed and does not get free acquisition by inference', () => {
    const source = recommendationSource([tradeoffProduct()], true);
    const r = evaluateRecommendation(recommendationRequest([source]));
    expect(fact(r, 'reuse_existing').fact).toEqual({ state: 'known', value: 1 });
    expect(fact(r, 'purchase_cost').fact.state).toBe('unknown');
    expect(r.options[0]!.choice.bindings[0]!.component_id).toBe('fixture.a');
  });
  it('explicit owned cost basis provides zero without modifying product engineering facts', () => {
    const source = recommendationSource([tradeoffProduct()], true);
    const input = recommendationRequest([source]);
    const r = evaluateRecommendation({
      ...input,
      context: {
        ...input.context,
        owned_acquisition: [
          {
            selection_digest: source.selection.result_digest,
            role_id: source.selection.roles[0]!.role.id,
            basis: 'owned_no_incremental_acquisition_cost',
            currency: 'USD',
            source: { ...observationSource, owner: 'user' },
          },
        ],
      },
    });
    expect(fact(r, 'purchase_cost').fact).toEqual({ state: 'known', value: 0 });
    expect(fact(r, 'purchase_cost').provenance[0]!.owner).toBe('user');
    expect(r.input.sources[0]!.selection).toEqual(source.selection);
  });
  it('rejects owned zero-cost basis for nonfixed equipment', () => {
    const source = recommendationSource();
    const input = recommendationRequest([source]);
    expect(() =>
      evaluateRecommendation({
        ...input,
        context: {
          ...input.context,
          owned_acquisition: [
            {
              selection_digest: source.selection.result_digest,
              role_id: source.selection.roles[0]!.role.id,
              basis: 'owned_no_incremental_acquisition_cost',
              currency: 'USD',
              source: observationSource,
            },
          ],
        },
      }),
    ).toThrow(/fixed-existing/);
  });
});
describe('explicit tier Pareto relations', () => {
  it.each([
    [[], 'tied'],
    [[[criterion('purchase_cost')]], 'worse'],
    [[[criterion('weight')]], 'preferred'],
    [[[criterion('weight'), criterion('purchase_cost')]], 'incomparable'],
    [[[criterion('weight')], [criterion('purchase_cost')]], 'preferred'],
    [[[criterion('purchase_cost')], [criterion('weight')]], 'worse'],
    [[[criterion('weight', 'maximize')]], 'worse'],
  ] as const)('retains transparent priority truth %#', (tiers, relation) => {
    const r = evaluateRecommendation(request(tiers));
    expect(pairForA(r).relation).toBe(relation);
    expect(r.options.every((o) => o.engineering_status === 'satisfied')).toBe(true);
    expect(r).not.toHaveProperty('score');
  });
  it('unknown high tier prevents a lower-tier known win', () => {
    const input = request([[criterion('purchase_cost')], [criterion('weight')]]);
    const r = evaluateRecommendation({ ...input, context: { ...input.context, prices: [] } });
    expect(r.comparisons[0]).toMatchObject({
      relation: 'incomparable',
      decisive_tier: 0,
      reason: 'comparison_incomplete',
    });
    expect(r.comparisons[0]!.criteria).toHaveLength(2);
    expect(r.fronts.satisfied[0]).toHaveLength(2);
  });
  it('known high-tier equality allows the lower tier', () => {
    const input = request([[criterion('purchase_cost')], [criterion('weight')]]);
    const r = evaluateRecommendation({
      ...input,
      context: {
        ...input.context,
        prices: input.context.prices.map((p) => ({ ...p, amount: 100 })),
      },
    });
    expect(pairForA(r)).toMatchObject({ relation: 'preferred', decisive_tier: 1 });
  });
  it('equal-priority criterion order has no authority', () => {
    const a = evaluateRecommendation(request([[criterion('weight'), criterion('purchase_cost')]]));
    const b = evaluateRecommendation(request([[criterion('purchase_cost'), criterion('weight')]]));
    expect(b).toEqual(a);
  });
  it('equal known facts tie and retain all options', () => {
    const input = request([[criterion('purchase_cost')]]);
    const r = evaluateRecommendation({
      ...input,
      context: { ...input.context, prices: input.context.prices.map((p) => ({ ...p, amount: 1 })) },
    });
    expect(r.comparisons[0]!.relation).toBe('tied');
    expect(r.fronts.satisfied[0]).toHaveLength(2);
  });
  it('manufacturer count and voltage/brand create no hidden ordering', () => {
    const r = evaluateRecommendation(request());
    expect(r.comparisons[0]!.relation).toBe('tied');
    expect(fact(r, 'manufacturer_count').fact).toEqual({ state: 'known', value: 1 });
  });
  it.each(['present', 'absent', 'unknown'] as const)(
    'optional communication %s preserves engineering authority',
    (state) => {
      const base = tradeoffProduct();
      const a = {
        ...base,
        ...(state === 'present'
          ? { capabilities: [...base.capabilities!, { id: 'can', type: 'communication' as const }] }
          : state === 'absent'
            ? { unsupported_capabilities: ['communication' as const] }
            : {}),
      };
      const b = {
        ...tradeoffProduct('fixture.b'),
        unsupported_capabilities: ['communication' as const],
      };
      const input = recommendationRequest([recommendationSource([a, b])]);
      const r = evaluateRecommendation({
        ...input,
        preference: {
          ...input.preference,
          tiers: [
            [
              {
                kind: 'optional_capability',
                capability: 'communication',
                direction: 'prefer_present',
              },
            ],
          ],
        },
      });
      expect(r.options.every((o) => o.engineering_status === 'satisfied')).toBe(true);
      expect(pairForA(r).relation).toBe(
        state === 'present' ? 'preferred' : state === 'absent' ? 'tied' : 'incomparable',
      );
      expect(fact(r, 'optional_capability.communication').fact.state).toBe(
        state === 'present' ? 'known' : state,
      );
    },
  );
  it.each(['known', 'absent', 'unknown', 'not_applicable'] as const)(
    'optional feature %s preserves state/source',
    (state) => {
      const input = request([
        [{ kind: 'optional_feature', feature: 'display', direction: 'prefer_present' }],
      ]);
      const value =
        state === 'known'
          ? { state, value: true }
          : state === 'absent'
            ? { state }
            : { state, reason: 'fixture.explicit' };
      const r = evaluateRecommendation({
        ...input,
        context: {
          ...input.context,
          features: [
            {
              component_id: 'fixture.a',
              feature: 'display',
              fact: value,
              source: { ...observationSource, owner: 'builder' },
            },
          ],
        },
      });
      const direct = r.options
        .find((o) => o.choice.bindings[0]!.component_id === 'fixture.a')!
        .facts.find(
          (f) => f.kind === 'optional_feature.display' && f.subject.kind === 'component',
        )!;
      expect(direct.fact).toEqual(value);
      expect(direct.provenance[0]!.owner).toBe('builder');
    },
  );
});
describe('portable identity, failure and reconstruction', () => {
  it('round-trips and replays the entire artifact', () => {
    const input = request([[criterion('weight')]]);
    const r = evaluateRecommendation(input);
    expect(parseRecommendation(serializeRecommendation(r))).toEqual(r);
    expect(replayRecommendation(r, input)).toEqual(r);
  });
  it.each(['facts', 'comparison', 'status', 'provenance', 'front', 'profile'] as const)(
    'rehashed %s edits fail reconstruction',
    (mode) => {
      const r = JSON.parse(
        serializeRecommendation(evaluateRecommendation(request([[criterion('weight')]]))),
      );
      if (mode === 'facts') r.options[0].facts[0].fact = { state: 'known', value: 999 };
      if (mode === 'comparison') r.comparisons[0].relation = 'incomparable';
      if (mode === 'status') r.options[0].engineering_status = 'blocked';
      if (mode === 'provenance') r.options[0].facts[0].provenance[0].owner = 'user';
      if (mode === 'front') r.fronts.satisfied = [];
      if (mode === 'profile') r.input.preference.tiers[0][0].direction = 'maximize';
      // Recompute every affected identity so rejection proves semantic reconstruction,
      // rather than merely noticing an obsolete nested digest.
      r.input_digest = passportDigest(r.input);
      for (const option of r.options) {
        const { option_digest: _optionDigest, ...optionBody } = option;
        option.option_digest = passportDigest(optionBody);
      }
      const { result_digest: _digest, ...body } = r;
      r.result_digest = passportDigest(body);
      expect(() => parseRecommendation(serializePassportValue(r))).toThrow(/reproduce/);
    },
  );
  it.each(['profile', 'price', 'choice', 'policy'] as const)(
    'external replay refuses changed %s',
    (mode) => {
      const input = request([[criterion('weight')]]);
      const r = evaluateRecommendation(input);
      const changed =
        mode === 'profile'
          ? { ...input, preference: { ...input.preference, tiers: [] } }
          : mode === 'price'
            ? { ...input, context: { ...input.context, prices: [] } }
            : mode === 'choice'
              ? {
                  ...input,
                  construction: { mode: 'explicit' as const, choices: [r.options[0]!.choice] },
                }
              : input;
      expect(() =>
        replayRecommendation(
          r,
          changed,
          mode === 'policy'
            ? { ...recommendationPolicy, status: 'reviewed' }
            : recommendationPolicy,
        ),
      ).toThrow(/changed/);
    },
  );
  it.each(['must', 'brand', 'weight', 'score', 'random'] as const)(
    'refuses unmodeled or hard preference syntax %s',
    (key) => {
      const input = request();
      const wrong = { ...input, preference: { ...input.preference, [key]: true } };
      expect(() => evaluateRecommendation(wrong)).toThrow(/schema/);
    },
  );
  it('reports automatic construction bound without truncating', () => {
    const r = evaluateRecommendation(request(), {
      ...recommendationPolicy,
      bounds: { ...recommendationPolicy.bounds, max_options: 1 },
    });
    expect(r.construction).toMatchObject({
      status: 'option_space_bound_exceeded',
      option_count: '2',
    });
    expect(r.options).toEqual([]);
    expect(parseRecommendation(serializeRecommendation(r))).toEqual(r);
  });
  it('rejects explicit bound overflow', () => {
    const input = request();
    const r = evaluateRecommendation(input);
    expect(() =>
      evaluateRecommendation(
        { ...input, construction: { mode: 'explicit', choices: r.options.map((o) => o.choice) } },
        { ...recommendationPolicy, bounds: { ...recommendationPolicy.bounds, max_options: 1 } },
      ),
    ).toThrow(/nothing was truncated/);
  });
  it.each([
    'max_selections',
    'max_criteria',
    'max_observations',
    'max_pairwise_comparisons',
  ] as const)('bounds %s reject/report rather than prune', (bound) => {
    const input = request([[criterion('weight'), criterion('purchase_cost')]]);
    const source = recommendationSource([tradeoffProduct('fixture.c')]);
    const changed =
      bound === 'max_selections'
        ? { ...input, sources: [...input.sources, source] }
        : bound === 'max_pairwise_comparisons'
          ? { ...input, sources: [...input.sources, source] }
          : input;
    const policy = {
      ...recommendationPolicy,
      bounds: { ...recommendationPolicy.bounds, [bound]: 1 },
    };
    if (bound === 'max_pairwise_comparisons')
      expect(evaluateRecommendation(changed, policy).construction.status).toBe(
        'option_space_bound_exceeded',
      );
    else expect(() => evaluateRecommendation(changed, policy)).toThrow(/bound/);
  });
  it('option reordering preserves pairwise truth', () => {
    const input = request([[criterion('weight')]]);
    const r = evaluateRecommendation(input);
    const explicit = {
      ...input,
      construction: { mode: 'explicit' as const, choices: r.options.map((o) => o.choice) },
    };
    const a = evaluateRecommendation(explicit),
      b = evaluateRecommendation({
        ...explicit,
        construction: { mode: 'explicit', choices: [...explicit.construction.choices].reverse() },
      });
    expect(b).toEqual(a);
  });
  it('unrelated options preserve existing pairwise truth', () => {
    const input = request([[criterion('weight')]]);
    const a = evaluateRecommendation(input);
    const b = evaluateRecommendation({
      ...input,
      sources: [...input.sources, recommendationSource([tradeoffProduct('fixture.c')])],
    });
    expect(
      b.comparisons.find(
        (p) =>
          p.left_option_id === a.comparisons[0]!.left_option_id &&
          p.right_option_id === a.comparisons[0]!.right_option_id,
      ),
    ).toEqual(a.comparisons[0]);
  });
  it('front peeling retains every mathematically non-dominated group', () => {
    const a = tradeoffProduct(),
      b = { ...tradeoffProduct('fixture.b'), weight_kg: 4 },
      c = { ...tradeoffProduct('fixture.c'), weight_kg: 6 };
    const input = recommendationRequest([recommendationSource([a, b, c])]);
    const r = evaluateRecommendation({
      ...input,
      preference: { ...input.preference, tiers: [[criterion('weight')]] },
    });
    expect(r.fronts.satisfied.map((f) => f.length)).toEqual([1, 1, 1]);
    expect(
      r.fronts.satisfied.map(
        (f) => r.options.find((o) => o.id === f[0])!.choice.bindings[0]!.component_id,
      ),
    ).toEqual(['fixture.a', 'fixture.b', 'fixture.c']);
  });
  it('rehashed exact passport status forgery fails full reconstruction', () => {
    const r = JSON.parse(serializeRecommendation(evaluateRecommendation(request())));
    r.options[0].passport.result.status = 'blocked';
    const { passport_digest: _passportDigest, ...passportBody } = r.options[0].passport;
    r.options[0].passport.passport_digest = passportDigest(passportBody);
    const { option_digest: _optionDigest, ...optionBody } = r.options[0];
    r.options[0].option_digest = passportDigest(optionBody);
    const { result_digest: _resultDigest, ...body } = r;
    r.result_digest = passportDigest(body);
    expect(() => parseRecommendation(serializePassportValue(r))).toThrow(/reproduce/);
  });
  it('rehashed upstream gate forgery cannot become recommendation authority', () => {
    const input = JSON.parse(serializePassportValue(request()));
    const selection = input.sources[0].selection;
    selection.roles[0].candidates[0].bindings[0].gates[0].truth = 'NO';
    const { result_digest: _digest, ...body } = selection;
    selection.result_digest = passportDigest(body);
    expect(() => evaluateRecommendation(input)).toThrow(/Selection does not reproduce/);
  });
  it('source reordering preserves the normalized artifact and comparison truth', () => {
    const input = request([[criterion('weight')]]);
    const sources = [...input.sources, recommendationSource([tradeoffProduct('fixture.c')])];
    expect(evaluateRecommendation({ ...input, sources: [...sources].reverse() })).toEqual(
      evaluateRecommendation({ ...input, sources }),
    );
  });
});
