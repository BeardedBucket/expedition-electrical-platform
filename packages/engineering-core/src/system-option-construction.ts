import { bindProductSelection } from './product-selection-handoff.js';
import type { SelectedRoleBinding } from './product-selection-handoff.js';
import { evaluateInstalledSystem } from './engineering-passport.js';
import { passportDigest, serializePassportValue } from './portable-json.js';
import type {
  DeferredCandidate,
  RecommendationInput,
  RecommendationPolicy,
  RecommendationResult,
  SystemOptionChoice,
  SelectionOptionSource,
} from './recommendation-contracts.js';

export const stableCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const canonicalChoice = (choice: SystemOptionChoice): SystemOptionChoice => ({
  ...choice,
  bindings: [...choice.bindings].sort((a, b) => stableCompare(a.role_id, b.role_id)),
});

/** Construction has no access to preferences or commercial facts. All retained exact
 * nonblocked witnesses participate; symbolic/null candidates are retained separately.
 * BigInt preflight counts avoid overflow, and bounds report before any Cartesian allocation.
 * Complete means complete over supplied Phase 5 alternatives, not all possible designs.
 */
export const constructSystemChoices = (
  sources: readonly SelectionOptionSource[],
  request: RecommendationInput['construction'],
  policy: RecommendationPolicy,
): {
  choices: SystemOptionChoice[];
  deferred: DeferredCandidate[];
  construction: RecommendationResult['construction'];
} => {
  const deferred: DeferredCandidate[] = [];
  const spaces = sources.map(({ selection }) => ({
    selection_digest: selection.result_digest,
    roles: selection.roles.map((role) => {
      const choices: SelectedRoleBinding[] = [];
      for (const candidate of role.candidates) {
        if (candidate.assembly_generation === 'unresolved') {
          deferred.push({
            selection_digest: selection.result_digest,
            role_id: role.role.id,
            candidate,
            binding_id: null,
            reasons: ['assembly_reduction_unresolved'],
            phase5_reasons: candidate.reasons,
          });
        }
        for (const binding of candidate.bindings) {
          if (binding.status === 'BLOCKED') continue;
          const missingRecord = !selection.input.corpus.some(
            (c) => c.id === candidate.component_id,
          );
          const missingIdentity = [
            ...Object.values(binding.witness.interfaces),
            ...Object.values(binding.witness.paths),
          ].some((id) => id === null);
          if (missingRecord || missingIdentity) {
            deferred.push({
              selection_digest: selection.result_digest,
              role_id: role.role.id,
              candidate,
              binding_id: binding.id,
              reasons: [
                ...(missingRecord ? ['fixed_component_record_missing' as const] : []),
                ...(missingIdentity ? ['exact_witness_identity_missing' as const] : []),
              ],
              phase5_reasons: [
                ...new Set([
                  ...binding.gates.filter((g) => g.truth !== 'YES').map((g) => g.reason),
                  ...binding.assembly_gates.filter((g) => g.truth !== 'YES').map((g) => g.reason),
                  ...(role.upstream_unresolved.length
                    ? ['upstream_requirement_unresolved' as const]
                    : []),
                ]),
              ].sort(),
            });
            continue;
          }
          choices.push({
            role_id: role.role.id,
            component_id: candidate.component_id,
            binding_id: binding.id,
            ...(candidate.assembly ? { assembly: candidate.assembly } : {}),
          });
        }
      }
      return { role_id: role.role.id, choices };
    }),
  }));
  const roleCounts = spaces.flatMap((s) =>
    s.roles.map((r) => ({
      selection_digest: s.selection_digest,
      role_id: r.role_id,
      count: r.choices.length,
    })),
  );
  const count =
    request.mode === 'explicit'
      ? BigInt(request.choices.length)
      : spaces.reduce(
          (sum, s) => sum + s.roles.reduce((n, r) => n * BigInt(r.choices.length), 1n),
          0n,
        );
  // Across-class counts can be lower after Phase 3. This conservative preflight
  // bounds every possible pair before evaluation instead of preference-based pruning.
  const pairs = (count * (count - 1n)) / 2n;
  const exceeds =
    count > BigInt(policy.bounds.max_options) ||
    pairs > BigInt(policy.bounds.max_pairwise_comparisons);
  const construction: RecommendationResult['construction'] = {
    status: exceeds ? 'option_space_bound_exceeded' : 'complete',
    scope: request.mode === 'automatic' ? 'retained_exact_phase5_bindings' : 'explicit_choice_set',
    option_count: count.toString(),
    bound: policy.bounds.max_options,
    pairwise_bound: policy.bounds.max_pairwise_comparisons,
    role_choice_counts: roleCounts,
  };
  if (exceeds) {
    if (request.mode === 'explicit')
      throw new TypeError(
        'Explicit option set exceeds construction/pairwise bound; nothing was truncated.',
      );
    return { choices: [], deferred, construction };
  }
  const choices: SystemOptionChoice[] = [];
  if (request.mode === 'explicit') choices.push(...request.choices.map(canonicalChoice));
  else
    for (const space of spaces) {
      // A later empty role makes the entire product empty. Detect it before earlier
      // roles can allocate a large prefix whose final mathematical count is zero.
      if (space.roles.some((r) => r.choices.length === 0)) continue;
      // Iterative product avoids recursion depth depending on Phase 4 role count.
      let combinations: SelectedRoleBinding[][] = [[]];
      for (const role of space.roles)
        combinations = combinations.flatMap((c) => role.choices.map((b) => [...c, b]));
      choices.push(
        ...combinations.map((bindings) =>
          canonicalChoice({ selection_digest: space.selection_digest, bindings }),
        ),
      );
    }
  const identities = choices.map(serializePassportValue);
  if (new Set(identities).size !== choices.length)
    throw new TypeError('Duplicate exact system choice.');
  choices.sort((a, b) => stableCompare(serializePassportValue(a), serializePassportValue(b)));
  return { choices, deferred, construction };
};

export const materializeSystemOption = (
  source: SelectionOptionSource,
  choice: SystemOptionChoice,
) => {
  const bound = bindProductSelection(source.selection, choice.bindings, source.handoff);
  const passport = evaluateInstalledSystem(bound.input, bound.catalog);
  const identity = { choice, passport_digest: passport.passport_digest };
  return {
    id: `system-option.${passportDigest(identity).slice(7)}`,
    choice,
    passport,
    engineering_status: passport.result.status,
  };
};
