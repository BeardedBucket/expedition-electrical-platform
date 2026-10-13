import {
  artifactDigest,
  artifactReference,
  deterministicSerialize,
  PRODUCTION_SCHEMA_VERSION,
  type SemanticProposal,
} from './production-contracts.js';
import {
  semanticRulesFor,
  SEMANTIC_RULE_INTERPRETER,
  type SemanticInterpreter,
  recognizeSemanticAssertion,
  semanticAssertionComparisonKey,
  assertionQualifiedValue,
} from './semantic-rules.js';
import type { ProductionSemanticBridgeInput } from './production-semantic-bridge.js';

export const SEMANTIC_BRIDGE_REVISION = 'production-semantic-bridge.v12';

/** Source-native F remains immutable diagnostic evidence. This comparison is a
 * separately versioned semantic comparison: it knows the concept, applicability
 * and full conditions before comparing values. Neither comparison approves truth. */
export const buildSemanticAssertionProposals = (
  input: ProductionSemanticBridgeInput,
  legacy: readonly SemanticProposal[],
  interpreter: SemanticInterpreter = SEMANTIC_RULE_INTERPRETER,
): readonly SemanticProposal[] => {
  const rules = semanticRulesFor(interpreter);
  const scoped = new Map(
    input.reconciliation.groups.flatMap((g) =>
      g.qualified_fact_ids.map((id) => [id, g.key.reconciliation_scope] as const),
    ),
  );
  const groups = new Map<
    string,
    {
      fact: (typeof input.facts)[number];
      assertion: NonNullable<ReturnType<typeof recognizeSemanticAssertion>>;
    }[]
  >();
  const covered = new Set<string>();
  for (const fact of input.facts) {
    const assertion = recognizeSemanticAssertion(fact, input.facts, rules, interpreter);
    if (!assertion || !scoped.has(fact.id)) continue;
    // Retain existing reviewed battery vocabulary and already-safe direct scalar
    // mappings. New rules handle otherwise unsupported/contextual observations.
    const prior = legacy.find(
      (p) => !p.derivation && p.fact_refs?.some((r) => r.reference === fact.id),
    );
    const legacyEquivalent =
      prior?.target === assertion.target &&
      (assertion.projection === 'scalar' ||
        assertion.concept === 'nominal_voltage' ||
        rules.find((r) => r.id === assertion.rule.id)?.required_role === 'battery');
    // Only an equivalent legacy quantity may retain its reviewed representation.
    // In particular, legacy aliases for MAXIMUM charge current must not silently
    // turn a maximum basis into a continuous rating. Unrepresentable context
    // always blocks retention. Other generic role reasons do not invalidate an
    // independently reviewed legacy battery interpretation in this branch.
    if (
      prior?.disposition === 'mapped' &&
      !assertion.review_required_reasons.includes('qualifier_context_unresolved') &&
      !assertion.review_required_reasons.includes('battery_property_owner_required') &&
      !assertion.review_required_reasons.includes('competing_source_units') &&
      !assertion.review_required_reasons.includes('secondary_quantity_requires_comparison') &&
      legacyEquivalent &&
      !assertion.qualifiers.source_conditions &&
      !assertion.qualifiers.duration &&
      !assertion.qualifiers.temperature_context &&
      !assertion.qualifiers.revision_context &&
      !assertion.qualifiers.comparison &&
      !assertion.qualifiers.electrical_domain
    )
      continue;
    const scope = scoped.get(fact.id)!;
    const intake = scope.kind === 'product_intake' ? scope.digest : scope.intake_digest;
    const key = semanticAssertionComparisonKey(assertion, fact, intake);
    const entries = groups.get(key) ?? [];
    entries.push({ fact, assertion });
    groups.set(key, entries);
    covered.add(fact.id);
  }
  const proposals: SemanticProposal[] = [];
  for (const entries of groups.values()) {
    entries.sort((a, b) => a.fact.id.localeCompare(b.fact.id));
    const assertions = entries.map((e) => e.assertion),
      a = assertions[0];
    const reasons = [...new Set(assertions.flatMap((a) => a.review_required_reasons))];
    const same = assertions.every(
      (b) =>
        deterministicSerialize(b.normalized_value) === deterministicSerialize(a.normalized_value),
    );
    const comparison = reasons.length
      ? 'unresolved'
      : same
        ? entries.length === 1
          ? 'single_observation'
          : 'agreement'
        : a.qualifiers.comparison
          ? 'unresolved'
          : 'conflict';
    const disposition =
      comparison === 'conflict'
        ? 'conflicting'
        : comparison === 'unresolved'
          ? 'unresolved'
          : 'mapped';
    const ids = entries.map((e) => e.fact.id);
    const factRefs = entries.map(({ fact }) =>
      artifactReference('qualified_fact', fact, fact.id, fact.schema_version),
    );
    const evidenceRefs = entries.flatMap(({ fact }) => [
      fact.source_capture,
      ...(fact.source_acquisition ? [fact.source_acquisition] : []),
      ...(fact.document_extraction ? [fact.document_extraction] : []),
    ]);
    const content = {
      target: a.target,
      disposition,
      semantic_assertions: assertions,
      ...(disposition === 'mapped'
        ? {
            proposed_value: a.normalized_value,
            ...(a.projection === 'qualified'
              ? { qualified_value: assertionQualifiedValue(a, ids) }
              : {}),
          }
        : {}),
      fact_refs: factRefs,
      evidence_refs: [
        ...new Map(evidenceRefs.map((r) => [`${r.kind}:${r.digest}`, r])).values(),
      ].sort((a, b) => a.digest.localeCompare(b.digest)),
      provenance: {
        method: 'rule' as const,
        rule_version:
          interpreter === 'semantic-assertions.v2'
            ? 'production-semantic-bridge.v7'
            : interpreter === 'semantic-assertions.v3'
              ? 'production-semantic-bridge.v8'
              : interpreter === 'semantic-assertions.v4'
                ? 'production-semantic-bridge.v9'
                : interpreter === 'semantic-assertions.v5'
                  ? 'production-semantic-bridge.v10'
                  : interpreter === 'semantic-assertions.v6'
                    ? 'production-semantic-bridge.v11'
                    : SEMANTIC_BRIDGE_REVISION,
        rationale: `Semantic comparison ${comparison}; F retained independently; ${reasons.join('; ') || 'exact concept, unit dimension, applicability and source conditions preserved'}`,
      },
      input_artifact_digests: [
        ...new Set([
          ...factRefs.map((r) => r.digest),
          artifactDigest(input.reconciliation),
          artifactDigest(rules),
          ...assertions.map((a) => a.rule.digest),
          ...input.source_acquisitions.map(artifactDigest),
        ]),
      ].sort(),
    };
    proposals.push({
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'semantic_proposal',
      id: `semantic-proposal.${artifactDigest(content).slice(7, 31)}`,
      ...content,
    } as SemanticProposal);
  }
  // If a legacy group contains both replaced and unsupported observations, the
  // entire source group remains visible instead of silently discarding a member.
  return [
    ...legacy.filter(
      (p) =>
        p.derivation ||
        !p.fact_refs?.length ||
        !p.fact_refs.every((r) => covered.has(r.reference ?? '')),
    ),
    ...proposals,
  ].sort((a, b) => a.id.localeCompare(b.id));
};
