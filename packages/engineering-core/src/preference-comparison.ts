import type {
  CriterionComparison,
  PairwiseComparison,
  PreferenceProfile,
  PreferenceRelation,
  SystemOption,
  TradeoffFact,
} from './recommendation-contracts.js';
import { criterionFactKind } from './tradeoff-facts.js';
import { stableCompare } from './system-option-construction.js';

export const preferenceFact = (option: Pick<SystemOption, 'facts'>, kind: string): TradeoffFact => {
  const fact = option.facts.find((f) => f.subject.kind === 'system' && f.kind === kind);
  if (!fact) throw new TypeError(`Missing system tradeoff fact ${kind}.`);
  return fact;
};
const comparableValue = (fact: TradeoffFact): number | boolean | undefined =>
  fact.fact.state === 'absent'
    ? false
    : fact.fact.state === 'known' &&
        (typeof fact.fact.value === 'number' || typeof fact.fact.value === 'boolean')
      ? fact.fact.value
      : undefined;

/** Unknown is neither worst nor equal. Lower tiers have authority only after a
 * complete tied higher tier. All criterion records survive for later rendering;
 * decisive_tier identifies where comparison stopped rather than hiding lower facts.
 */
export const compareSystemOptions = (
  left: SystemOption,
  right: SystemOption,
  profile: PreferenceProfile,
): PairwiseComparison => {
  if (left.engineering_status !== right.engineering_status || left.engineering_status === 'blocked')
    throw new TypeError('Preference comparison requires the same nonblocked engineering class.');
  const criteria: CriterionComparison[] = profile.tiers.flatMap((tier, index) =>
    tier.map((criterion) => {
      const a = preferenceFact(left, criterionFactKind(criterion));
      const b = preferenceFact(right, criterionFactKind(criterion));
      const x = comparableValue(a),
        y = comparableValue(b);
      let relation: PreferenceRelation = 'incomparable';
      let reason: CriterionComparison['reason'] = 'comparison_incomplete';
      if (a.fact.state === 'not_applicable' || b.fact.state === 'not_applicable')
        reason = 'not_applicable';
      else if (x !== undefined && y !== undefined && typeof x === typeof y) {
        if (a.unit !== b.unit) reason = 'unit_mismatch';
        else if (x === y) {
          relation = 'tied';
          reason = 'equal';
        } else {
          const maximize =
            criterion.direction === 'maximize' || criterion.direction === 'prefer_present';
          const aBetter = maximize ? Number(x) > Number(y) : Number(x) < Number(y);
          relation = aBetter ? 'preferred' : 'worse';
          reason = aBetter ? 'left_better' : 'right_better';
        }
      }
      return { tier: index, criterion, left_fact_id: a.id, right_fact_id: b.id, relation, reason };
    }),
  );
  const base = {
    left_option_id: left.id,
    right_option_id: right.id,
    engineering_status: left.engineering_status,
    criteria,
  };
  for (let tier = 0; tier < profile.tiers.length; tier++) {
    const items = criteria.filter((c) => c.tier === tier);
    if (items.some((c) => c.relation === 'incomparable'))
      return {
        ...base,
        relation: 'incomparable',
        decisive_tier: tier,
        reason: 'comparison_incomplete',
      };
    const wins = items.some((c) => c.relation === 'preferred');
    const losses = items.some((c) => c.relation === 'worse');
    if (wins && losses)
      return { ...base, relation: 'incomparable', decisive_tier: tier, reason: 'tier_tradeoff' };
    if (wins || losses)
      return {
        ...base,
        relation: wins ? 'preferred' : 'worse',
        decisive_tier: tier,
        reason: 'tier_dominance',
      };
  }
  return {
    ...base,
    relation: 'tied',
    decisive_tier: null,
    reason: profile.tiers.length ? 'all_tiers_tied' : 'empty_profile',
  };
};

/** Every non-dominated option remains in a front. Code-point order only serializes
 * membership. Removing a front repeats dominance over the remainder, without a score.
 */
export const buildPreferenceFronts = (
  ids: readonly string[],
  comparisons: readonly PairwiseComparison[],
): string[][] => {
  const remaining = new Set(ids);
  const fronts: string[][] = [];
  while (remaining.size) {
    const dominated = new Set<string>();
    for (const c of comparisons)
      if (remaining.has(c.left_option_id) && remaining.has(c.right_option_id)) {
        if (c.relation === 'preferred') dominated.add(c.right_option_id);
        if (c.relation === 'worse') dominated.add(c.left_option_id);
      }
    const front = [...remaining].filter((id) => !dominated.has(id)).sort(stableCompare);
    if (!front.length) throw new TypeError('Preference dominance cycle cannot produce fronts.');
    fronts.push(front);
    for (const id of front) remaining.delete(id);
  }
  return fronts;
};
