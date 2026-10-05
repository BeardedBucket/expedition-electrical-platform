/** Node-only recommendation authority. No export through the browser/core index. */
export * from './recommendation-contracts.js';
import defaultPolicy from '../../../data/rules/recommendation.json' with { type: 'json' };
import type {
  RecommendationInput,
  RecommendationPolicy,
  RecommendationResult,
  SystemOption,
  PairwiseComparison,
} from './recommendation-contracts.js';
import { assertRecommendationSchema } from './recommendation-validation.js';
import { parseProductSelection } from './product-selection.js';
import { assertExactDemandSchedules } from './product-selection-handoff.js';
import { passportDigest, serializePassportValue } from './portable-json.js';
import {
  canonicalChoice,
  constructSystemChoices,
  materializeSystemOption,
  stableCompare,
} from './system-option-construction.js';
import { criterionFactKind, deriveTradeoffFacts, tradeoffFactCount } from './tradeoff-facts.js';
import {
  compareSystemOptions,
  buildPreferenceFronts,
  preferenceFact,
} from './preference-comparison.js';
import {
  evaluateComponentAdvisories,
  validateAdvisoryCollection,
  validateEvidenceCollection,
} from './advisory.js';

export const RECOMMENDATION_ENGINE_REVISION = 'recommendation/1.0.0' as const;
const freeze = (value: unknown): void => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
};
freeze(defaultPolicy);
export const recommendationPolicy = defaultPolicy as RecommendationPolicy;
const unique = (keys: readonly string[], label: string): void => {
  if (new Set(keys).size !== keys.length) throw new TypeError(`Duplicate ${label}.`);
};

export const evaluateRecommendation = (
  input: RecommendationInput,
  policy: RecommendationPolicy = recommendationPolicy,
): RecommendationResult => {
  assertRecommendationSchema(input, 'input');
  assertRecommendationSchema(policy, 'policy');
  const criteria = input.preference.tiers.flat();
  const context = input.context;
  // Admission rejects before any exact materialization. These independently owned
  // Phase 6 bounds limit retained passports/pairs/context, not engineering safety.
  if (
    input.sources.length > policy.bounds.max_selections ||
    criteria.length > policy.bounds.max_criteria
  )
    throw new TypeError('Recommendation selection/criterion admission exceeds policy bound.');
  const observations =
    context.prices.length +
    context.owned_acquisition.length +
    context.features.length +
    (context.advisory ? context.advisory.records.length + context.advisory.evidence.length : 0) +
    input.sources.reduce(
      (n, s) =>
        n +
        (s.handoff.device_states?.length ?? 0) +
        (s.handoff.project_demand_schedules?.reduce((m, d) => m + d.schedule.length, 0) ?? 0),
      0,
    );
  if (observations > policy.bounds.max_observations)
    throw new TypeError('Recommendation observations exceed policy bound.');
  unique(criteria.map(criterionFactKind), 'preference dimension');
  unique(
    context.prices.map((p) => p.component_id),
    'component price observation',
  );
  unique(
    context.features.map((f) => serializePassportValue([f.component_id, f.feature])),
    'component optional feature',
  );
  unique(
    context.owned_acquisition.map((o) => serializePassportValue([o.selection_digest, o.role_id])),
    'owned acquisition basis',
  );
  if (context.advisory) {
    // Explicit timezone makes date arithmetic independent of host locale/timezone.
    if (
      !/(Z|[+-]\d{2}:\d{2})$/.test(context.advisory.evaluated_at) ||
      !Number.isFinite(Date.parse(context.advisory.evaluated_at))
    )
      throw new TypeError('Advisory evaluated_at requires a valid explicit timezone.');
    const problems = [
      ...validateEvidenceCollection(context.advisory.evidence),
      ...validateAdvisoryCollection(context.advisory.records, context.advisory.evidence),
    ];
    if (problems.length)
      throw new TypeError(`Invalid advisory context: ${problems.map((p) => p.code).join(', ')}.`);
    const checkDates = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        if (
          typeof entry === 'string' &&
          /(_at|_date|date_checked|review_after|next_review_at)$/.test(key) &&
          (!(/^\d{4}-\d{2}-\d{2}$/.test(entry) || /(Z|[+-]\d{2}:\d{2})$/.test(entry)) ||
            !Number.isFinite(Date.parse(entry)))
        )
          throw new TypeError(
            'Advisory dates require explicit timezone or ISO date-only representation.',
          );
        checkDates(entry);
      }
    };
    checkDates(context.advisory);
  }
  // Serialize before copying to reject hidden/accessor input. Each evaluation owns
  // fresh snapshots; no caller mutations can rewrite upstream records or output.
  const snapshot = JSON.parse(serializePassportValue(input)) as RecommendationInput;
  const policySnapshot = JSON.parse(serializePassportValue(policy)) as RecommendationPolicy;
  const sources = snapshot.sources
    .map((source) => ({
      ...source,
      selection: parseProductSelection(serializePassportValue(source.selection)),
    }))
    .sort((a, b) => stableCompare(a.selection.result_digest, b.selection.result_digest));
  unique(
    sources.map((s) => s.selection.result_digest),
    'selection source',
  );
  for (const source of sources)
    assertExactDemandSchedules(
      source.selection.input.generation.candidates.find(
        (c) => c.id === source.selection.input.candidate_id,
      )!.demand_endpoints,
      source.handoff.project_demand_schedules ?? [],
    );
  for (const owned of context.owned_acquisition) {
    const source = sources.find((s) => s.selection.result_digest === owned.selection_digest);
    if (!source?.selection.input.fixed_existing.some((f) => f.role_id === owned.role_id))
      throw new TypeError(
        'Zero incremental acquisition basis requires explicit fixed-existing intent.',
      );
  }
  const constructionRequest =
    snapshot.construction.mode === 'explicit'
      ? {
          mode: 'explicit' as const,
          choices: snapshot.construction.choices
            .map(canonicalChoice)
            .sort((a, b) => stableCompare(serializePassportValue(a), serializePassportValue(b))),
        }
      : snapshot.construction;
  // Normalize set-like ordering for stability; tier priority and upstream snapshots
  // remain exact. Sorting never becomes a preference/tie-breaking authority.
  const normalized: RecommendationInput = {
    ...snapshot,
    sources,
    construction: constructionRequest,
    preference: {
      ...snapshot.preference,
      tiers: snapshot.preference.tiers.map((t) =>
        [...t].sort((a, b) => stableCompare(criterionFactKind(a), criterionFactKind(b))),
      ),
    },
  };
  const { choices, deferred, construction } = constructSystemChoices(
    sources,
    constructionRequest,
    policySnapshot,
  );
  const factCount = choices.reduce((n, choice) => {
    const source = sources.find((s) => s.selection.result_digest === choice.selection_digest);
    if (!source) throw new TypeError('Choice references a missing exact selection source.');
    return n + tradeoffFactCount(source, choice, normalized.context, criteria);
  }, 0);
  if (!Number.isSafeInteger(factCount) || factCount > policySnapshot.bounds.max_tradeoff_facts)
    throw new TypeError('Tradeoff fact work exceeds policy bound; nothing was truncated.');
  const options: SystemOption[] = choices
    .map((choice) => {
      const source = sources.find((s) => s.selection.result_digest === choice.selection_digest);
      if (!source) throw new TypeError('Choice references a missing exact selection source.');
      const exact = materializeSystemOption(source, choice);
      const facts = deriveTradeoffFacts(exact.id, source, choice, normalized.context, criteria);
      const missing = criteria
        .map((c) => preferenceFact({ facts }, criterionFactKind(c)))
        .filter((f) => f.fact.state === 'unknown' || f.fact.state === 'not_applicable')
        .map((f) => f.id)
        .sort(stableCompare);
      const advisory = normalized.context.advisory
        ? [...new Set(choice.bindings.map((b) => b.component_id))].sort(stableCompare).map((id) => {
            const a = normalized.context.advisory!;
            return evaluateComponentAdvisories(
              id,
              a.records,
              a.evidence,
              a.evaluated_at,
              a.configuration,
            );
          })
        : [];
      facts.push({
        id: `fact.${passportDigest({ option_id: exact.id, kind: 'advisory_context', subject: { kind: 'system' } }).slice(7)}`,
        kind: 'advisory_context',
        option_id: exact.id,
        subject: { kind: 'system' },
        fact: normalized.context.advisory
          ? { state: 'known', value: { evaluations: advisory } }
          : { state: 'unknown', reason: 'advisory_context_missing' },
        unit: null,
        identity: 'derived',
        completeness: normalized.context.advisory ? 'complete' : 'incomplete',
        provenance: [
          {
            owner: 'advisory',
            snapshot_digest: passportDigest(normalized.context),
            pointer: '/advisory',
            source_refs: [],
          },
        ],
        calculation: {
          formula:
            'evaluateComponentAdvisories for every distinct selected component using explicit context and timestamp; no engineering reinterpretation',
          inputs: [],
          source_inputs: normalized.context.advisory
            ? [
                {
                  snapshot_digest: passportDigest(normalized.context),
                  pointer: '/advisory',
                  value: normalized.context.advisory,
                  unit: null,
                },
              ]
            : [],
          known_subtotals: [],
          unresolved_contributors: [],
        },
      });
      facts.sort((a, b) => stableCompare(a.id, b.id));
      const exclusions: SystemOption['recommendation_exclusions'][number][] = [
        ...exact.passport.decisions
          .filter((d) => d.status === 'blocked')
          .map((d) => ({ owner: 'engineering' as const, subject_id: d.id, reason: d.code })),
        ...advisory
          .filter((a) => !a.eligible)
          .map((a) => ({
            owner: 'advisory' as const,
            subject_id: a.component_id,
            reason: a.effective_policy_action,
          })),
      ];
      const body = {
        ...exact,
        facts,
        preference_data: {
          completeness: missing.length ? ('incomplete' as const) : ('complete' as const),
          missing_fact_ids: missing,
        },
        advisory,
        recommendation_exclusions: exclusions,
      };
      return { ...body, option_digest: passportDigest(body) };
    })
    .sort((a, b) => stableCompare(a.id, b.id));
  unique(
    options.map((o) => o.id),
    'materialized option',
  );
  const comparisons: PairwiseComparison[] = [];
  // Excluded options stay inspectable with complete passports/facts/advisories,
  // but cannot enter either preference front. Advisory suppression is separate
  // recommendation governance and never changes the preserved engineering status.
  const admitted = options.filter(
    (o) => o.engineering_status !== 'blocked' && !o.recommendation_exclusions.length,
  );
  for (let i = 0; i < admitted.length; i++)
    for (let j = i + 1; j < admitted.length; j++) {
      if (admitted[i]!.engineering_status === admitted[j]!.engineering_status)
        comparisons.push(compareSystemOptions(admitted[i]!, admitted[j]!, normalized.preference));
    }
  const body = {
    schema_version: '1.0.0' as const,
    engine_revision: RECOMMENDATION_ENGINE_REVISION,
    input: normalized,
    input_digest: passportDigest(normalized),
    policy: policySnapshot,
    policy_digest: passportDigest(policySnapshot),
    construction,
    options,
    deferred,
    comparisons,
    fronts: {
      satisfied: buildPreferenceFronts(
        admitted.filter((o) => o.engineering_status === 'satisfied').map((o) => o.id),
        comparisons,
      ),
      unresolved: buildPreferenceFronts(
        admitted.filter((o) => o.engineering_status === 'unresolved').map((o) => o.id),
        comparisons,
      ),
    },
    excluded_option_ids: options.filter((o) => !admitted.includes(o)).map((o) => o.id),
    warnings: [
      ...(policySnapshot.status === 'approved'
        ? []
        : ['recommendation_policy_requires_human_review']),
      ...(normalized.context.advisory ? [] : ['advisory_context_missing']),
      ...(construction.status === 'complete' ? [] : ['option_space_bound_exceeded']),
    ],
  };
  return { ...body, result_digest: passportDigest(body) };
};

const reconstruct = (value: unknown): RecommendationResult => {
  assertRecommendationSchema(value, 'result');
  const result = value as RecommendationResult;
  const { result_digest: digest, ...body } = result;
  if (passportDigest(body) !== digest) throw new TypeError('Recommendation integrity mismatch.');
  const reproduced = evaluateRecommendation(result.input, result.policy);
  if (serializePassportValue(reproduced) !== serializePassportValue(result))
    throw new TypeError('Recommendation does not reproduce from exact authoritative inputs.');
  return reproduced;
};
export const serializeRecommendation = (result: RecommendationResult): string =>
  serializePassportValue(reconstruct(result));
export const parseRecommendation = (serialized: string): RecommendationResult =>
  reconstruct(JSON.parse(serialized) as unknown);
export const replayRecommendation = (
  result: RecommendationResult,
  input: RecommendationInput,
  policy: RecommendationPolicy = recommendationPolicy,
): RecommendationResult => {
  const live = evaluateRecommendation(input, policy);
  if (live.input_digest !== result.input_digest || live.policy_digest !== result.policy_digest)
    throw new TypeError('Recommendation replay selection/choice/profile/context/policy changed.');
  return reconstruct(result);
};
