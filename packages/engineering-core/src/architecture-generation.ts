/** Node-only Phase 4 entry point. It accepts no product catalog or overlay. */
export * from './architecture-generation-contracts.js';
export { ARCHITECTURE_GENERATOR_REVISION } from './architecture-candidate-builder.js';
import defaultPolicy from '../../../data/rules/architecture-generation.json' with { type: 'json' };
import type {
  ArchitectureGenerationInput,
  ArchitectureGenerationPolicy,
  ArchitectureGenerationResult,
} from './architecture-generation-contracts.js';
import {
  buildArchitectureCandidate,
  ARCHITECTURE_GENERATOR_REVISION,
} from './architecture-candidate-builder.js';
import {
  assertArchitectureSchema,
  validateGenerationBoundary,
} from './architecture-generation-validation.js';
import { passportDigest, serializePassportValue } from './portable-json.js';
import { groupArchitectureDemands } from './architecture-demand-groups.js';

const freeze = (value: unknown): void => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
};
freeze(defaultPolicy);
export const architectureGenerationPolicy = defaultPolicy as ArchitectureGenerationPolicy;

export const generateArchitectures = (
  input: ArchitectureGenerationInput,
  policy: ArchitectureGenerationPolicy = architectureGenerationPolicy,
): ArchitectureGenerationResult => {
  validateGenerationBoundary(input, policy);
  // Exact snapshots remain independent of caller-owned mutable objects. Set-like
  // policy dimensions are sorted/deduplicated; requirements are preserved whole.
  const snapshot = JSON.parse(serializePassportValue(input)) as ArchitectureGenerationInput;
  const policySnapshot = JSON.parse(serializePassportValue(policy)) as ArchitectureGenerationPolicy;
  const inputDigest = passportDigest(snapshot);
  const policyDigest = passportDigest(policySnapshot);
  const req = snapshot.requirements;
  const voltages =
    req.fixed_house_voltage_v === undefined
      ? [...new Set(policySnapshot.candidate_house_voltages_v)].sort((a, b) => a - b)
      : [req.fixed_house_voltage_v];
  const canCombine =
    groupArchitectureDemands(req.loads).filter((group) => group.domain.kind === 'ac').length ===
      1 && req.charging_sources.filter((source) => source.kind === 'shore').length === 1;
  // One AC functional domain can combine with one shore function, regardless
  // of endpoint count. Different domains or shore sources have no pairing search.
  const arrangements = canCombine
    ? [...new Set(policySnapshot.ac_function_arrangements)].sort()
    : (['separate'] as const);
  const explored = voltages.length * arrangements.length;
  // Reject before allocating candidate topologies; truncation would silently hide
  // legitimate alternatives. 16 voltage choices x 2 arrangements is schema-bound.
  if (explored > policySnapshot.bounds.max_candidates)
    throw new TypeError('Candidate expansion exceeds policy bound; nothing was truncated.');
  const byDigest = new Map<string, ReturnType<typeof buildArchitectureCandidate>>();
  for (const houseVoltage of voltages)
    for (const arrangement of arrangements) {
      const candidate = buildArchitectureCandidate(
        snapshot,
        policySnapshot,
        inputDigest,
        policyDigest,
        { house_voltage_v: houseVoltage, ac_function_arrangement: arrangement },
      );
      byDigest.set(candidate.candidate_digest, candidate);
    }
  const body = {
    schema_version: '2.0.0' as const,
    generator_revision: ARCHITECTURE_GENERATOR_REVISION,
    input: snapshot,
    input_digest: inputDigest,
    policy: policySnapshot,
    policy_digest: policyDigest,
    candidates: [...byDigest.values()],
    expansion: {
      explored:
        (req.fixed_house_voltage_v === undefined
          ? policySnapshot.candidate_house_voltages_v.length
          : 1) * policySnapshot.ac_function_arrangements.length,
      deduplicated:
        (req.fixed_house_voltage_v === undefined
          ? policySnapshot.candidate_house_voltages_v.length
          : 1) *
          policySnapshot.ac_function_arrangements.length -
        byDigest.size,
      bound: policySnapshot.bounds.max_candidates,
      complete: true as const,
    },
    filter_semantics: {
      supported_outcomes: ['eligible', 'blocked', 'unresolved'] as const,
      aggregation: 'any_blocked_else_any_unresolved_else_eligible' as const,
      order_affects_authority: false as const,
    },
    warnings: [
      ...(policySnapshot.status !== 'approved' ? ['generation_policy_requires_human_review'] : []),
      ...(snapshot.assumptions.length ? ['text_assumptions_preserved_without_interpretation'] : []),
    ],
  };
  const result = { ...body, result_digest: passportDigest(body) };
  assertArchitectureSchema(result, 'result');
  return result;
};

const reconstruct = (value: unknown): ArchitectureGenerationResult => {
  assertArchitectureSchema(value, 'result');
  const result = value as ArchitectureGenerationResult;
  if (result.generator_revision !== ARCHITECTURE_GENERATOR_REVISION)
    throw new TypeError('Unsupported architecture generator revision.');
  const { result_digest: digest, ...body } = result;
  if (passportDigest(body) !== digest)
    throw new TypeError('Architecture result integrity mismatch.');
  // Hashes are content identity, not engineering authority. Full deterministic
  // reconstruction checks roles, topology, provenance, decisions and scope even
  // after an editor recomputes every hash. Embedded policy is explicit project
  // input, not proof of its approval; replay can require the live policy snapshot.
  const reproduced = generateArchitectures(result.input, result.policy);
  if (serializePassportValue(reproduced) !== serializePassportValue(result))
    throw new TypeError(
      'Architecture result does not reproduce from its embedded requirements and policy.',
    );
  return reproduced;
};

export const serializeArchitectureGeneration = (result: ArchitectureGenerationResult): string =>
  serializePassportValue(reconstruct(result));
export const parseArchitectureGeneration = (serialized: string): ArchitectureGenerationResult =>
  reconstruct(JSON.parse(serialized) as unknown);
export const replayArchitectureGeneration = (
  result: ArchitectureGenerationResult,
  input: ArchitectureGenerationInput,
  policy: ArchitectureGenerationPolicy = architectureGenerationPolicy,
): ArchitectureGenerationResult => {
  validateGenerationBoundary(input, policy);
  if (
    result.input_digest !== passportDigest(input) ||
    result.policy_digest !== passportDigest(policy)
  )
    throw new TypeError('Architecture replay requirements or policy changed.');
  return reconstruct(result);
};
