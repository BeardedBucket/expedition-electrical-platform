import {
  artifactDigest,
  deterministicSerialize,
  type QualifiedFactArtifact,
  type SemanticProposal,
} from './production-contracts.js';

export const RETAINED_EVIDENCE_POLICY = 'retained-evidence.v1';
export interface RetainedEvidenceRule {
  readonly id: string;
  readonly revision: 1;
  readonly label_pattern: string;
  readonly role: 'identity' | 'commercial';
  readonly rationale: string;
}
/** Closed grammars describe observation ownership, not engineering values.
 * Certification, standards, installation limits, capability and generic category
 * words are deliberately excluded. Unknown vocabulary stays review-required.
 * Classification never consumes a product/manufacturer/category as authority. */
export const retainedEvidenceRules: readonly RetainedEvidenceRule[] = [
  {
    id: 'retained.identity.brand',
    revision: 1,
    label_pattern: '(?:brand|manufacturer name)',
    role: 'identity',
    rationale:
      'Source attribution names identify an organization; they establish no engineering capability or compatibility.',
  },
  {
    id: 'retained.identity.trade_identifier',
    revision: 1,
    label_pattern: '(?:gtin(?:_barcode)?|upc|catalog number|oem model #)',
    role: 'identity',
    rationale:
      'Trade/catalog/model identifiers remain exact source evidence; this rule neither selects a variant nor assigns an engineering value.',
  },
  {
    id: 'retained.identity.product_name',
    revision: 1,
    label_pattern: 'product name',
    role: 'identity',
    rationale:
      'A source display name remains identity evidence. Its words are never parsed into product role or specifications.',
  },
  {
    id: 'retained.commercial.packaging',
    revision: 1,
    label_pattern: 'packaging type',
    role: 'commercial',
    rationale:
      'Commercial packaging designation is not an installed envelope, physical-body dimension or mounting instruction.',
  },
  {
    id: 'retained.commercial.warranty',
    revision: 1,
    label_pattern: 'warranty',
    role: 'commercial',
    rationale:
      'Warranty terms are retained commercial evidence. No lifetime, reliability, safety, absence or installation-permission assertion follows.',
  },
];
export interface AutomaticEvidenceClassification {
  readonly policy_version: typeof RETAINED_EVIDENCE_POLICY;
  readonly projection_authority: 'none';
  readonly assertions: readonly {
    readonly rule: RetainedEvidenceRule;
    readonly rule_digest: string;
    readonly source_fact: QualifiedFactArtifact;
    readonly source_fact_digest: string;
  }[];
}
const classify = (fact: QualifiedFactArtifact) => {
  const label = fact.metadata.source_label?.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    !label ||
    fact.metadata.derived_value !== undefined ||
    fact.metadata.derivation !== undefined ||
    fact.metadata.alternative_interpretations !== undefined
  )
    return undefined;
  const matches = retainedEvidenceRules.filter((r) =>
    new RegExp(`^(?:${r.label_pattern})$`, 'i').test(label),
  );
  if (matches.length !== 1) return undefined;
  return {
    rule: matches[0],
    rule_digest: artifactDigest({ policy: RETAINED_EVIDENCE_POLICY, rule: matches[0] }),
    source_fact: fact,
    source_fact_digest: artifactDigest(fact),
  };
};

/** All members must be classified. Mixed groups and true F conflicts stay human
 * work. No observation is removed: source snapshots, qualifiers and references
 * remain in the proof. Future layers can reinterpret them without refetching. */
export const classifyRetainedEvidenceProposal = (
  proposal: SemanticProposal,
  facts: readonly QualifiedFactArtifact[],
): SemanticProposal => {
  if (proposal.derivation || ['mapped', 'conflicting', 'rejected'].includes(proposal.disposition))
    return proposal;
  const members = (proposal.fact_refs ?? []).map((ref) =>
    facts.find((f) => f.id === ref.reference && artifactDigest(f) === ref.digest),
  );
  if (!members.length || members.some((f) => !f)) return proposal;
  const assertions = members.map((f) => classify(f!));
  if (assertions.some((a) => !a)) return proposal;
  const {
    id: ignored,
    proposed_value: ignoredValue,
    qualified_value: ignoredQualified,
    semantic_assertions: ignoredSemantic,
    ...base
  } = proposal;
  void ignored;
  void ignoredValue;
  void ignoredQualified;
  void ignoredSemantic;
  const content = {
    ...base,
    disposition: 'evidence_only' as const,
    evidence_classification: {
      policy_version: RETAINED_EVIDENCE_POLICY as typeof RETAINED_EVIDENCE_POLICY,
      projection_authority: 'none' as const,
      assertions: assertions as NonNullable<(typeof assertions)[number]>[],
    },
    provenance: {
      method: 'rule' as const,
      rule_version: 'production-semantic-bridge.v8',
      rationale:
        'Automatic retained non-authoritative evidence; no current engineering interpretation or projection; all raw source context retained.',
    },
    input_artifact_digests: [
      ...new Set([...base.input_artifact_digests, ...assertions.map((a) => a!.rule_digest)]),
    ].sort(),
  };
  return { ...content, id: `semantic-proposal.${artifactDigest(content).slice(7, 31)}` };
};

/** Completion validates exact current rule proof, not an evidence_only string.
 * Upstream interpretation separately reconstructs the complete proposal against
 * its durable source inputs; hashes here are replay identities, not signatures. */
export const automaticEvidenceClassificationValid = (
  proposal: Pick<
    SemanticProposal,
    | 'id'
    | 'disposition'
    | 'fact_refs'
    | 'evidence_classification'
    | 'proposed_value'
    | 'qualified_value'
    | 'semantic_assertions'
  >,
): boolean => {
  const proof = proposal.evidence_classification;
  if (
    proposal.disposition !== 'evidence_only' ||
    !proof ||
    proof.policy_version !== RETAINED_EVIDENCE_POLICY ||
    proof.projection_authority !== 'none' ||
    !proof.assertions.length ||
    proposal.proposed_value !== undefined ||
    proposal.qualified_value !== undefined ||
    proposal.semantic_assertions !== undefined ||
    proposal.fact_refs?.length !== proof.assertions.length
  )
    return false;
  return proof.assertions.every((a, i) => {
    const expected = classify(a.source_fact),
      ref = proposal.fact_refs![i];
    return (
      !!expected &&
      deterministicSerialize(a) === deterministicSerialize(expected) &&
      ref.reference === a.source_fact.id &&
      ref.digest === a.source_fact_digest
    );
  });
};
