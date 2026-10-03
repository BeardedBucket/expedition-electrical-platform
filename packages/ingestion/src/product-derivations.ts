import type { JsonValue, SemanticProductDerivation } from './contracts.js';
import {
  artifactDigest,
  PRODUCTION_SCHEMA_VERSION,
  type QualifiedFactArtifact,
  type SemanticProposal,
  type SourceAcquisitionArtifact,
} from './production-contracts.js';
import { reviewedSemanticContext } from './semantic-context.js';
import { deterministicSerialize } from './production-contracts.js';

const RULE_VERSION = 'battery-product-derivations.v1';

interface Rule {
  readonly target: string;
  readonly inputs: readonly [string, string];
  readonly units: readonly [string, string, string];
  readonly formula: string;
  readonly assumptions: readonly string[];
  derive(left: number, right: number): JsonValue | undefined;
}

// These are product-data interpretations, never system design or a recommendation.
const rules: readonly Rule[] = [
  {
    target: 'battery.usable_capacity_ah',
    inputs: ['battery.nominal_capacity_ah', 'battery.usable_depth_of_discharge_fraction'],
    units: ['Ah', 'fraction', 'Ah'],
    formula: 'nominal_capacity_ah * usable_depth_of_discharge_fraction',
    assumptions: [
      'Same exact battery product',
      'Manufacturer usable DoD applies to the nominal Ah rating',
    ],
    derive: (capacity, fraction) =>
      capacity > 0 && fraction >= 0 && fraction <= 1 ? capacity * fraction : undefined,
  },
  {
    target: 'battery.allowed_series_count',
    inputs: ['electrical.nominal_voltage_v', 'battery.maximum_series_voltage_v'],
    units: ['V', 'V', 'count'],
    formula: 'maximum_series_voltage_v / nominal_voltage_v',
    assumptions: [
      'Same exact battery product',
      'Both published voltages use the same nominal voltage class',
      'Series permission is not a recommendation',
    ],
    // A nonintegral class relation cannot be converted into a count by flooring.
    derive: (nominal, maximum) => {
      const count = maximum / nominal;
      return nominal > 0 && maximum >= nominal && Number.isSafeInteger(count)
        ? { min: 1, max: count }
        : undefined;
    },
  },
];

export const deriveProductSemanticProposals = (
  proposals: readonly SemanticProposal[],
  facts: readonly QualifiedFactArtifact[],
  acquisitions: readonly SourceAcquisitionArtifact[],
): readonly SemanticProposal[] => {
  const factsByDigest = new Map(facts.map((fact) => [artifactDigest(fact), fact]));
  const results: SemanticProposal[] = [];
  for (const rule of rules) {
    const inputs = rule.inputs.map((target) =>
      proposals.filter(
        (proposal) =>
          proposal.target === target &&
          proposal.disposition === 'mapped' &&
          typeof proposal.proposed_value === 'number',
      ),
    );
    if (inputs[0].length !== 1 || inputs[1].length !== 1) continue;
    const [left, right] = [inputs[0][0], inputs[1][0]];
    const inputFacts = [left, right].flatMap((proposal) =>
      (proposal.fact_refs ?? []).map((ref) => factsByDigest.get(ref.digest)),
    );
    if (!inputFacts.length || inputFacts.some((fact) => !fact)) continue;
    const presentFacts = inputFacts as QualifiedFactArtifact[];
    const product = presentFacts[0].metadata.applicability.value;
    if (
      !product ||
      !presentFacts.every(
        (fact) =>
          fact.metadata.applicability.kind === 'exact_mpn_or_sku' &&
          fact.metadata.applicability.value === product &&
          reviewedSemanticContext(fact, facts, acquisitions)?.role === 'battery',
      )
    )
      continue;
    const value = rule.derive(left.proposed_value as number, right.proposed_value as number);
    if (value === undefined) continue;
    const direct = proposals.filter(
      (proposal) =>
        proposal.target === rule.target &&
        proposal.disposition === 'mapped' &&
        !proposal.derivation,
    );
    const same =
      direct.length === 1 &&
      deterministicSerialize(direct[0].proposed_value) === deterministicSerialize(value);
    const disposition: SemanticProposal['disposition'] = direct.length
      ? same
        ? 'evidence_only'
        : 'conflicting'
      : 'mapped';
    const derivation: SemanticProductDerivation = {
      status: 'derived',
      rule_version: RULE_VERSION,
      formula: rule.formula,
      input_targets: rule.inputs,
      input_qualified_fact_ids: [...new Set(presentFacts.map((fact) => fact.id))].sort(),
      input_units: rule.units.slice(0, 2),
      output_unit: rule.units[2],
      assumptions: rule.assumptions,
    };
    const factRefs = [...(left.fact_refs ?? []), ...(right.fact_refs ?? [])];
    const evidenceRefs = [
      ...new Map(
        [...left.evidence_refs, ...right.evidence_refs].map(
          (ref) => [`${ref.kind}:${ref.digest}`, ref] as const,
        ),
      ).values(),
    ].sort((a, b) => `${a.kind}:${a.digest}`.localeCompare(`${b.kind}:${b.digest}`));
    const content = {
      target: rule.target,
      disposition,
      ...(disposition === 'mapped' ? { proposed_value: value } : {}),
      ...(disposition === 'conflicting'
        ? {
            alternatives: [
              { value, rationale: 'Calculated from published input assertions.' },
              ...direct.map((proposal) => ({
                value: proposal.proposed_value,
                rationale: `Direct source proposal ${proposal.id}.`,
              })),
            ],
          }
        : {}),
      derivation,
      fact_refs: factRefs,
      evidence_refs: evidenceRefs,
      provenance: {
        method: 'rule' as const,
        rule_version: RULE_VERSION,
        rationale: direct.length
          ? 'Direct published assertion takes precedence; calculated value is a consistency check.'
          : 'Deterministic product-data calculation from exact-product published inputs.',
      },
      input_artifact_digests: [
        ...new Set([...left.input_artifact_digests, ...right.input_artifact_digests]),
      ].sort(),
    };
    results.push({
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'semantic_proposal',
      id: `semantic-proposal.${artifactDigest(content).slice(7, 31)}`,
      ...content,
    });
  }
  return results;
};
