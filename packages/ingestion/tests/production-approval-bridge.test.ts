import { describe, expect, it } from 'vitest';
import {
  artifactReference,
  buildProductionProductCandidate,
  buildProductionReviewPackage,
  buildProductionSemanticProposals,
  buildQualifiedFactArtifact,
  productionApprovalToPromotionReview,
  promotionCandidateSnapshot,
  PRODUCTION_SCHEMA_VERSION,
  reconcileQualifiedFactsForWholeIntake,
  reviewPackageSnapshot,
  type ProductionApproval,
  type QualifiedFactArtifact,
  type ProductIntake,
  type SourceAcquisitionArtifact,
  type SourceCaptureArtifact,
} from '../src/index.js';

const intake: ProductIntake = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.review',
  manufacturer: 'Example',
  product_model: 'Model',
  manufacturer_part_number: 'MPN',
  official_product_uri: 'https://example.invalid/product',
};
const capture: SourceCaptureArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_capture',
  id: 'capture.review',
  requested_uri: 'https://example.invalid/product',
  retrieved_at: '2026-01-01T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'not_retained',
  source_provenance: { publisher: 'Example' },
};
const acquisition: SourceAcquisitionArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_acquisition',
  id: 'acquisition.review',
  intake: artifactReference('product_intake', intake),
  seed_capture: artifactReference('source_capture', capture),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: `sha256:${'a'.repeat(64)}`,
};
const fact = (label: string, value: string, unit = 'V'): QualifiedFactArtifact =>
  buildQualifiedFactArtifact({
    source_capture: artifactReference('source_capture', capture),
    source_acquisition: artifactReference('source_acquisition', acquisition),
    metadata: {
      source_wording: `${label} ${value}`,
      source_label: label,
      raw_value: value,
      source_unit: unit,
      applicability: { kind: 'exact_mpn_or_sku', value: 'MPN' },
    },
    qualification_state: 'exact',
  });
const inputFacts = [
  fact('nominal voltage', '24'),
  fact('nominal voltage', '24.0'),
  fact('continuous current', '10', 'A'),
  fact('continuous current', '10.0', 'A'),
];
const setup = (facts: readonly QualifiedFactArtifact[] = inputFacts) => {
  const reconciliation = reconcileQualifiedFactsForWholeIntake({
    facts,
    source_acquisitions: [acquisition],
  });
  const proposals = buildProductionSemanticProposals({
    facts,
    source_acquisitions: [acquisition],
    reconciliation,
  });
  const bridge = buildProductionProductCandidate({
    intake,
    captures: [capture],
    source_acquisitions: [acquisition],
    facts,
    reconciliation,
    proposals,
  });
  const reviewPackage = buildProductionReviewPackage({ intake, reconciliation, bridge });
  const fields = Object.keys(bridge.candidate?.field_evidence ?? {}).sort();
  const approval: ProductionApproval = {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'approval',
    id: 'approval.review',
    review_package: artifactReference('review_package', reviewPackage),
    review_package_snapshot: reviewPackageSnapshot(reviewPackage),
    semantic_snapshot: reviewPackage.semantic_snapshot,
    reviewer_id: 'reviewer.human',
    decision: 'approved',
    reviewed_at: '2026-01-02T00:00:00Z',
    promotion_decisions: {
      approved_fields: fields.slice(0, 1),
      evidence_acknowledged: true,
      product_role: 'charge_controller',
      category: 'solar_charge_controller',
    },
  };
  return { bridge, reviewPackage, approval, fields };
};

describe('production approval bridge', () => {
  it('uses explicit empty topology evidence instead of falling back to candidate topology', () => {
    const { bridge, reviewPackage, approval } = setup();
    expect(approval.promotion_decisions).not.toHaveProperty('topology_evidence');
    const review = productionApprovalToPromotionReview(approval, reviewPackage, bridge);
    expect(review).toHaveProperty('topology_evidence', {});
    expect(review.topology_evidence).toEqual({});
  });

  it('translates an exact matching production approval into a promotion review', () => {
    const { bridge, reviewPackage, approval, fields } = setup();
    const review = productionApprovalToPromotionReview(approval, reviewPackage, bridge);
    expect(review).toMatchObject({
      schema_version: bridge.candidate?.schema_version,
      id: approval.id,
      candidate_id: bridge.candidate?.id,
      decision: 'approved',
      reviewer_id: approval.reviewer_id,
      reviewed_at: approval.reviewed_at,
      approved_fields: fields.slice(0, 1),
      evidence_acknowledged: true,
      product_role: 'charge_controller',
      category: 'solar_charge_controller',
    });
  });

  it('rejects an approval that does not match the exact review package', () => {
    const { bridge, reviewPackage, approval } = setup();
    expect(() =>
      productionApprovalToPromotionReview(
        { ...approval, semantic_snapshot: `sha256:${'b'.repeat(64)}` },
        reviewPackage,
        bridge,
      ),
    ).toThrow(/exact review package/);
  });

  it('rejects promotion when the review package candidate does not match the supplied candidate state', () => {
    const { bridge, reviewPackage, approval } = setup();
    expect(() =>
      productionApprovalToPromotionReview(approval, reviewPackage, {
        ...bridge,
        candidate: { ...bridge.candidate!, id: 'other-candidate' },
      }),
    ).toThrow(/candidate state/);
    expect(() =>
      productionApprovalToPromotionReview(approval, reviewPackage, {
        ...bridge,
        candidate: undefined,
      }),
    ).toThrow(/candidate state/);
  });

  it('does not infer approval for candidate fields not explicitly selected by the human', () => {
    const { bridge, reviewPackage, approval, fields } = setup();
    expect(fields).toEqual(['electrical.continuous_current_a', 'electrical.nominal_voltage_v']);
    expect(bridge.projected_proposal_ids).toHaveLength(2);
    expect(bridge.proposals.every((proposal) => proposal.disposition === 'mapped')).toBe(true);
    expect(bridge.candidate?.component_data).toEqual({
      electrical: { continuous_current_a: 10, nominal_voltage_v: 24 },
    });
    expect(reviewPackage.fact_refs.filter((ref) => ref.kind === 'product_fact')).toHaveLength(4);
    const review = productionApprovalToPromotionReview(approval, reviewPackage, bridge);
    expect(review.approved_fields).toEqual([fields[0]]);
    expect(review.approved_fields).not.toContain(fields[1]);
  });

  it('rejects unknown or contradictory approved and excluded fields', () => {
    const { bridge, reviewPackage, approval, fields } = setup();
    const decisions = approval.promotion_decisions!;
    expect(() =>
      productionApprovalToPromotionReview(
        { ...approval, promotion_decisions: { ...decisions, approved_fields: ['unknown.field'] } },
        reviewPackage,
        bridge,
      ),
    ).toThrow(/reviewed candidate field/);
    expect(() =>
      productionApprovalToPromotionReview(
        { ...approval, promotion_decisions: { ...decisions, excluded_fields: [fields[0]] } },
        reviewPackage,
        bridge,
      ),
    ).toThrow(/both approved and excluded/);
    expect(() =>
      productionApprovalToPromotionReview(
        { ...approval, promotion_decisions: { ...decisions, excluded_fields: ['unknown.field'] } },
        reviewPackage,
        bridge,
      ),
    ).toThrow(/reviewed candidate field/);
  });

  it('rejects fact and field resolution decisions outside reviewed evidence', () => {
    const { bridge, reviewPackage, approval, fields } = setup();
    const decisions = approval.promotion_decisions!;
    expect(() =>
      productionApprovalToPromotionReview(
        { ...approval, promotion_decisions: { ...decisions, excluded_fact_ids: ['foreign'] } },
        reviewPackage,
        bridge,
      ),
    ).toThrow(/outside reviewed candidate evidence/);
    expect(() =>
      productionApprovalToPromotionReview(
        {
          ...approval,
          promotion_decisions: {
            ...decisions,
            field_resolutions: {
              [fields[0]]: { selected_fact_id: 'foreign', rationale: 'Choice' },
            },
          },
        },
        reviewPackage,
        bridge,
      ),
    ).toThrow(/outside reviewed supporting evidence/);
  });

  it('preserves explicit reviewer category role evidence and field decisions', () => {
    const { bridge, reviewPackage, approval, fields } = setup();
    const selected = bridge.candidate!.field_evidence[fields[0]][0];
    const evidenceOnly = bridge.candidate!.field_evidence[fields[1]][0];
    const review = productionApprovalToPromotionReview(
      {
        ...approval,
        reviewed_decisions: [`approve ${fields[1]}`, 'category: invented'],
        promotion_decisions: {
          ...approval.promotion_decisions!,
          excluded_fields: [fields[1]],
          excluded_fact_ids: [evidenceOnly],
          reviewed_evidence_fact_ids: [evidenceOnly],
          field_resolutions: { [fields[0]]: { selected_fact_id: selected, rationale: 'Reviewed' } },
        },
      },
      reviewPackage,
      bridge,
    );
    expect(review).toMatchObject({
      reviewer_id: 'reviewer.human',
      reviewed_at: '2026-01-02T00:00:00Z',
      category: 'solar_charge_controller',
      product_role: 'charge_controller',
      approved_fields: [fields[0]],
      excluded_fields: [fields[1]],
      excluded_fact_ids: [evidenceOnly],
      reviewed_evidence_fact_ids: [evidenceOnly],
      field_resolutions: { [fields[0]]: { selected_fact_id: selected, rationale: 'Reviewed' } },
    });
    expect(review).not.toHaveProperty('notes');
  });

  it('binds the promotion review to the exact candidate snapshot and is deterministic under reordered inputs', () => {
    const { bridge, reviewPackage, approval, fields } = setup();
    const first = productionApprovalToPromotionReview(approval, reviewPackage, bridge);
    expect(first.candidate_snapshot).toBe(
      promotionCandidateSnapshot(bridge.candidate!, bridge.sources, bridge.facts),
    );
    const second = productionApprovalToPromotionReview(
      {
        ...approval,
        promotion_decisions: {
          ...approval.promotion_decisions!,
          approved_fields: [...fields].reverse(),
        },
      },
      reviewPackage,
      { ...bridge, sources: [...bridge.sources].reverse(), facts: [...bridge.facts].reverse() },
    );
    const all = productionApprovalToPromotionReview(
      {
        ...approval,
        promotion_decisions: { ...approval.promotion_decisions!, approved_fields: fields },
      },
      reviewPackage,
      bridge,
    );
    expect(second).toEqual(all);
    expect(first.candidate_snapshot).toBe(second.candidate_snapshot);
  });
});
