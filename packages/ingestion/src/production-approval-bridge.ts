import type { JsonObject, ProductCandidate } from './contracts.js';
import type { ProductionCandidateBridgeResult } from './production-candidate-bridge.js';
import {
  approvalMatchesReviewPackage,
  artifactReference,
  deterministicSerialize,
  validateProductionApprovalForPromotion,
  type ArtifactReference,
  type ProductionApproval,
  type ReviewPackage,
} from './production-contracts.js';
import { promotionCandidateSnapshot, type PromotionReview } from './promotion.js';

const sorted = (items: readonly string[]): string[] => [...items].sort();
const same = (left: unknown, right: unknown): boolean =>
  deterministicSerialize(left) === deterministicSerialize(right);
const referenceKey = (ref: ArtifactReference): string => `${ref.kind}:${ref.digest}`;
const sameReferences = (
  actual: readonly ArtifactReference[],
  expected: readonly ArtifactReference[],
): boolean =>
  same(
    [...actual].sort((a, b) => referenceKey(a).localeCompare(referenceKey(b))),
    [...expected].sort((a, b) => referenceKey(a).localeCompare(referenceKey(b))),
  );
const valueAt = (data: JsonObject, path: string): unknown =>
  path.split('.').reduce<unknown>((value, key) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as JsonObject)[key];
  }, data);

/** Translate explicit human selections after binding every reviewed production artifact. */
export const productionApprovalToPromotionReview = (
  approval: ProductionApproval,
  reviewPackage: ReviewPackage,
  bridge: ProductionCandidateBridgeResult,
): PromotionReview => {
  const errors = validateProductionApprovalForPromotion(approval);
  if (errors.length)
    throw new Error(`Production approval is not promotion-ready: ${errors.join('; ')}`);
  if (!approvalMatchesReviewPackage(approval, reviewPackage))
    throw new Error('Production approval does not match the exact review package.');

  const candidate = bridge.candidate;
  if (
    !candidate ||
    !reviewPackage.candidate ||
    !same(
      reviewPackage.candidate,
      artifactReference('product_candidate', candidate, candidate.id, candidate.schema_version),
    )
  )
    throw new Error('Review package candidate does not match the supplied candidate state.');

  const proposals = bridge.proposals;
  const qualifiedFacts = bridge.qualified_facts;
  const expectedFacts = [
    ...qualifiedFacts.map((fact) =>
      artifactReference('qualified_fact', fact, fact.id, fact.schema_version),
    ),
    ...bridge.facts.map((fact) =>
      artifactReference('product_fact', fact, fact.id, fact.schema_version),
    ),
  ];
  const packageSources = reviewPackage.source_refs.filter((ref) => ref.kind === 'product_source');
  const expectedSources = bridge.sources.map((source) =>
    artifactReference('product_source', source, source.id),
  );
  if (
    !sameReferences(reviewPackage.fact_refs, expectedFacts) ||
    !sameReferences(packageSources, expectedSources) ||
    !sameReferences(
      reviewPackage.proposal_refs,
      proposals.map((proposal) =>
        artifactReference('semantic_proposal', proposal, proposal.id, proposal.schema_version),
      ),
    ) ||
    !same(sorted(candidate.fact_ids), sorted(bridge.facts.map((fact) => fact.id))) ||
    !same(sorted(candidate.source_ids), sorted(bridge.sources.map((source) => source.id)))
  )
    throw new Error('Review package and candidate bridge evidence do not match.');

  const projected = new Set(bridge.projected_proposal_ids);
  const support = new Map<string, string[]>();
  for (const proposal of proposals) {
    const ids = bridge.proposal_fact_ids[proposal.id];
    if (!projected.has(proposal.id)) {
      if (ids !== undefined) throw new Error('Non-projected proposal has candidate evidence.');
      continue;
    }
    if (
      proposal.disposition !== 'mapped' ||
      !ids?.length ||
      !proposal.fact_refs?.length ||
      proposal.fact_refs.some(
        (ref) =>
          !qualifiedFacts.some((fact) =>
            same(ref, artifactReference('qualified_fact', fact, fact.id, fact.schema_version)),
          ),
      ) ||
      ids.some(
        (id) => !bridge.facts.some((fact) => fact.id === id && fact.field === proposal.target),
      )
    )
      throw new Error('Projected proposal has invalid reviewed field evidence.');
    support.set(proposal.target, [...(support.get(proposal.target) ?? []), ...ids]);
  }
  if (
    projected.size !== bridge.projected_proposal_ids.length ||
    projected.size !== Object.keys(bridge.proposal_fact_ids).length ||
    !same(sorted([...support.keys()]), sorted(Object.keys(candidate.field_evidence))) ||
    [...support].some(
      ([field, ids]) =>
        !same(sorted(ids), sorted(candidate.field_evidence[field] ?? [])) ||
        new Set(ids).size !== ids.length,
    )
  )
    throw new Error('Candidate field evidence does not match reviewed production proposals.');

  const decisions = approval.promotion_decisions!;
  const candidateFields = new Set(Object.keys(candidate.field_evidence));
  const approved = new Set(decisions.approved_fields);
  const excluded = new Set(decisions.excluded_fields ?? []);
  for (const field of [...approved, ...excluded]) {
    if (!candidateFields.has(field) || valueAt(candidate.component_data, field) === undefined)
      throw new Error(`Field '${field}' is not a reviewed candidate field.`);
    if (approved.has(field) && excluded.has(field))
      throw new Error(`Field '${field}' is both approved and excluded.`);
  }
  const candidateFactIds = new Set(candidate.fact_ids);
  for (const id of [
    ...(decisions.excluded_fact_ids ?? []),
    ...(decisions.reviewed_evidence_fact_ids ?? []),
  ]) {
    if (!candidateFactIds.has(id))
      throw new Error(`Fact '${id}' is outside reviewed candidate evidence.`);
  }
  for (const [field, resolution] of Object.entries(decisions.field_resolutions ?? {})) {
    if (
      !approved.has(field) ||
      !candidate.field_evidence[field]?.includes(resolution.selected_fact_id)
    )
      throw new Error(`Resolution for '${field}' is outside reviewed supporting evidence.`);
  }
  for (const [target, ids] of Object.entries(decisions.topology_evidence ?? {})) {
    if (
      !candidate.topology_evidence?.[target] ||
      ids.some(
        (id) => !candidate.topology_evidence![target].includes(id) || !candidateFactIds.has(id),
      )
    )
      throw new Error(`Topology evidence for '${target}' is outside reviewed candidate evidence.`);
  }

  const orderedResolutions = Object.fromEntries(
    Object.entries(decisions.field_resolutions ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  const orderedTopology = Object.fromEntries(
    Object.entries(decisions.topology_evidence ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([target, ids]) => [target, sorted(ids)]),
  );
  return {
    schema_version: candidate.schema_version,
    id: approval.id,
    candidate_id: candidate.id,
    candidate_snapshot: promotionCandidateSnapshot(
      candidate,
      [...bridge.sources].sort((a, b) => a.id.localeCompare(b.id)),
      [...bridge.facts].sort((a, b) => a.id.localeCompare(b.id)),
    ),
    decision: 'approved',
    reviewer_id: approval.reviewer_id,
    reviewed_at: approval.reviewed_at,
    approved_fields: sorted(decisions.approved_fields),
    ...(decisions.excluded_fields ? { excluded_fields: sorted(decisions.excluded_fields) } : {}),
    ...(decisions.excluded_fact_ids
      ? { excluded_fact_ids: sorted(decisions.excluded_fact_ids) }
      : {}),
    ...(decisions.reviewed_evidence_fact_ids
      ? { reviewed_evidence_fact_ids: sorted(decisions.reviewed_evidence_fact_ids) }
      : {}),
    ...(decisions.field_resolutions ? { field_resolutions: orderedResolutions } : {}),
    topology_evidence: orderedTopology,
    evidence_acknowledged: decisions.evidence_acknowledged,
    product_role: decisions.product_role,
    category: decisions.category,
  };
};
