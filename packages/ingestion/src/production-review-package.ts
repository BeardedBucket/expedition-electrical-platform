import type {
  ArtifactReference,
  ProductIntake,
  ReviewPackage,
  SemanticProposal,
  SourceReference,
} from './production-contracts.js';
import {
  artifactDigest,
  artifactReference,
  deterministicSerialize,
  PRODUCTION_SCHEMA_VERSION,
} from './production-contracts.js';
import type { ProductionCandidateBridgeResult } from './production-candidate-bridge.js';
import type { QualifiedFactWholeIntakeReconciliationResult } from './reconciliation.js';
import {
  assertAcceptedSourceResolution,
  type SourceResolutionArtifact,
} from './source-resolution.js';

export interface ProductionReviewPackageInput {
  readonly intake: ProductIntake;
  readonly source_resolution?: SourceResolutionArtifact;
  readonly reconciliation: QualifiedFactWholeIntakeReconciliationResult;
  readonly bridge: ProductionCandidateBridgeResult;
}

const ordered = <T>(items: readonly T[], key: (item: T) => string): T[] =>
  [...items].sort((left, right) => key(left).localeCompare(key(right)));

const same = (left: unknown, right: unknown): boolean =>
  deterministicSerialize(left) === deterministicSerialize(right);

const isSourceReference = (reference: ArtifactReference): reference is SourceReference =>
  reference.kind === 'source_capture' ||
  reference.kind === 'source_revision' ||
  reference.kind === 'product_source';

const sourceReference = (reference: ArtifactReference): SourceReference => {
  if (!isSourceReference(reference))
    throw new Error('Review package received a non-source artifact reference.');
  return reference;
};

/** Assemble existing production results without interpreting or approving their evidence. */
export const buildProductionReviewPackage = (
  input: ProductionReviewPackageInput,
): ReviewPackage => {
  const { intake, reconciliation, bridge } = input;
  if (input.source_resolution) assertAcceptedSourceResolution(intake, input.source_resolution);
  const resolutionBinding = input.source_resolution
    ? {
        source_resolution: artifactReference(
          'source_resolution',
          input.source_resolution,
          input.source_resolution.id,
          input.source_resolution.schema_version,
        ),
      }
    : {};
  const proposals = ordered(bridge.proposals, (proposal) => proposal.id);
  const facts = ordered(bridge.qualified_facts, (fact) => fact.id);
  const factByDigest = new Map(facts.map((fact) => [artifactDigest(fact), fact]));
  const proposalIds = new Set(proposals.map((proposal) => proposal.id));
  const projectedIds = new Set(bridge.projected_proposal_ids);
  const diagnosticIds = new Set(bridge.non_projected.map((item) => item.proposal_id));
  const fail = (): never => {
    throw new Error(
      'Review package received stale or inconsistent production candidate bridge input.',
    );
  };

  if (
    proposalIds.size !== proposals.length ||
    new Set(facts.map((fact) => fact.id)).size !== facts.length ||
    factByDigest.size !== facts.length ||
    projectedIds.size !== bridge.projected_proposal_ids.length ||
    diagnosticIds.size !== bridge.non_projected.length ||
    !same(
      ordered(reconciliation.qualified_fact_ids, (id) => id),
      facts.map((fact) => fact.id),
    ) ||
    [...projectedIds, ...diagnosticIds].length !== proposals.length ||
    [...projectedIds, ...diagnosticIds].some((id) => !proposalIds.has(id)) ||
    [...projectedIds].some((id) => diagnosticIds.has(id))
  )
    fail();

  const reconciliationDigest = artifactDigest(reconciliation);
  for (const proposal of proposals) {
    const refs = proposal.fact_refs ?? [];
    if (
      !refs.length ||
      refs.some(
        (ref) =>
          ref.kind !== 'qualified_fact' ||
          !factByDigest.has(ref.digest) ||
          factByDigest.get(ref.digest)?.id !== ref.reference,
      ) ||
      !proposal.input_artifact_digests.includes(reconciliationDigest) ||
      refs.some((ref) => !proposal.input_artifact_digests.includes(ref.digest))
    )
      fail();
    const evidence = refs.flatMap((ref) => {
      const fact = factByDigest.get(ref.digest)!;
      return [
        fact.source_capture,
        ...(fact.source_acquisition ? [fact.source_acquisition] : []),
        ...(fact.document_extraction ? [fact.document_extraction] : []),
        ...(fact.evidence?.flatMap((item) =>
          item.source_reference ? [item.source_reference] : [],
        ) ?? []),
      ];
    });
    if (
      !same(
        ordered(proposal.evidence_refs, (ref) => `${ref.kind}:${ref.digest}`),
        ordered(
          [...new Map(evidence.map((ref) => [`${ref.kind}:${ref.digest}`, ref])).values()],
          (ref) => `${ref.kind}:${ref.digest}`,
        ),
      )
    )
      fail();
    if (projectedIds.has(proposal.id)) {
      const legacyIds = bridge.proposal_fact_ids[proposal.id];
      if (
        proposal.disposition !== 'mapped' ||
        proposal.proposed_value === undefined ||
        !legacyIds?.length ||
        !same(
          ordered(legacyIds, (id) => id),
          legacyIds,
        ) ||
        legacyIds.some((id) => !bridge.facts.some((fact) => fact.id === id))
      )
        fail();
    } else if (bridge.proposal_fact_ids[proposal.id]) fail();
  }

  const projectedFactIds = ordered(Object.values(bridge.proposal_fact_ids).flat(), (id) => id);
  if (
    !same(
      projectedFactIds,
      ordered(
        bridge.facts.map((fact) => fact.id),
        (id) => id,
      ),
    ) ||
    !same(
      projectedFactIds,
      ordered(
        bridge.normalized_facts.map((item) => item.fact.id),
        (id) => id,
      ),
    ) ||
    !same(
      ordered(
        bridge.sources.map((source) => source.id),
        (id) => id,
      ),
      bridge.candidate?.source_ids ?? [],
    ) ||
    !same(projectedFactIds, bridge.candidate?.fact_ids ?? []) ||
    Boolean(bridge.candidate) !== projectedFactIds.length > 0
  )
    fail();
  if (bridge.candidate) {
    const fieldSupport = new Map<string, string[]>();
    const qualifiedSupport = new Map<string, string[]>();
    for (const proposal of proposals) {
      if (!projectedIds.has(proposal.id)) continue;
      const support = proposal.qualified_value ? qualifiedSupport : fieldSupport;
      const key = proposal.qualified_value?.id ?? proposal.target;
      if (
        proposal.qualified_value &&
        !same(
          (bridge.candidate.component_data.qualified_values as unknown[] | undefined)?.find(
            (entry) => (entry as { id?: string }).id === key,
          ),
          proposal.qualified_value,
        )
      )
        fail();
      support.set(key, [...(support.get(key) ?? []), ...bridge.proposal_fact_ids[proposal.id]]);
    }
    const candidateFields = bridge.candidate.field_evidence;
    const candidateQualified = bridge.candidate.qualified_value_evidence ?? {};
    if (
      qualifiedSupport.size !== Object.keys(candidateQualified).length ||
      [...qualifiedSupport].some(
        ([id, ids]) =>
          !same(
            ordered(ids, (id) => id),
            candidateQualified[id],
          ),
      )
    )
      fail();
    if (
      bridge.candidate.id !== `production-candidate.${artifactDigest(intake).slice(7, 31)}` ||
      bridge.candidate.identity.manufacturer !== intake.manufacturer ||
      bridge.candidate.identity.model !== intake.product_model ||
      bridge.candidate.identity.manufacturer_part_number !== intake.manufacturer_part_number ||
      fieldSupport.size !== Object.keys(candidateFields).length ||
      [...fieldSupport].some(([field, supportingIds]) => {
        const candidateIds = candidateFields[field];
        return (
          !candidateIds ||
          new Set(supportingIds).size !== supportingIds.length ||
          new Set(candidateIds).size !== candidateIds.length ||
          !same(
            ordered(supportingIds, (id) => id),
            ordered(candidateIds, (id) => id),
          )
        );
      })
    )
      fail();
  }

  const nonProjected = ordered(bridge.non_projected, (item) => item.proposal_id);
  const sourceRefs: SourceReference[] = [
    ...new Map(
      [
        ...facts.map((fact) => sourceReference(fact.source_capture)),
        ...bridge.sources.map((source) => artifactReference('product_source', source, source.id)),
      ].map((ref) => [`${ref.kind}:${ref.digest}`, ref] as const),
    ).values(),
  ];
  const semanticSnapshot = artifactDigest({
    ...resolutionBinding,
    intake: artifactDigest(intake),
    reconciliation,
    proposals,
    qualified_facts: facts,
    candidate: bridge.candidate,
    projected_proposal_ids: ordered(bridge.projected_proposal_ids, (id) => id),
    non_projected: nonProjected,
    proposal_fact_ids: Object.fromEntries(
      Object.entries(bridge.proposal_fact_ids)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, ids]) => [id, ordered(ids, (item) => item)]),
    ),
    sources: ordered(bridge.sources, (source) => source.id),
    facts: ordered(bridge.facts, (fact) => fact.id),
    normalized_facts: ordered(bridge.normalized_facts, (fact) => fact.fact.id),
  });
  const content = {
    ...resolutionBinding,
    intake: artifactReference('product_intake', intake, intake.id, intake.schema_version),
    ...(bridge.candidate
      ? {
          candidate: artifactReference(
            'product_candidate',
            bridge.candidate,
            bridge.candidate.id,
            bridge.candidate.schema_version,
          ),
        }
      : {}),
    source_refs: ordered(sourceRefs, (ref) => `${ref.kind}:${ref.digest}`),
    fact_refs: [
      ...facts.map((fact) =>
        artifactReference('qualified_fact', fact, fact.id, fact.schema_version),
      ),
      ...bridge.facts.map((fact) =>
        artifactReference('product_fact', fact, fact.id, fact.schema_version),
      ),
    ].sort((left, right) =>
      `${left.kind}:${left.digest}`.localeCompare(`${right.kind}:${right.digest}`),
    ),
    proposal_refs: proposals.map((proposal: SemanticProposal) =>
      artifactReference('semantic_proposal', proposal, proposal.id, proposal.schema_version),
    ),
    unresolved_items: nonProjected.map((item) => `${item.proposal_id}: ${item.reason}`),
    conflicts: proposals
      .filter((proposal) => proposal.disposition === 'conflicting')
      .map((proposal) => proposal.id),
    semantic_snapshot: semanticSnapshot,
  };
  return {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'review_package',
    id: `review-package.${artifactDigest(content).slice(7, 31)}`,
    ...content,
  };
};
