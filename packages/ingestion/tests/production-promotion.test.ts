import { describe, expect, it } from 'vitest';
import {
  artifactReference,
  buildProductionProductCandidate,
  buildProductionReviewPackage,
  buildProductionSemanticProposals,
  buildQualifiedFactArtifact,
  promoteCandidate,
  promoteProductionCandidate,
  PRODUCTION_SCHEMA_VERSION,
  reconcileQualifiedFactsForWholeIntake,
  reviewPackageSnapshot,
  type ProductionApproval,
  type ProductIntake,
  type QualifiedFactArtifact,
  type SourceAcquisitionArtifact,
  type SourceCaptureArtifact,
} from '../src/index.js';

const intake: ProductIntake = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.promotion',
  manufacturer: 'Example',
  product_model: 'Model',
  manufacturer_part_number: 'MPN',
  official_product_uri: 'https://example.invalid/product',
};
const capture: SourceCaptureArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_capture',
  id: 'capture.promotion',
  requested_uri: 'https://example.invalid/product',
  retrieved_at: '2026-01-01T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'not_retained',
  source_provenance: { publisher: 'Example' },
};
const acquisition: SourceAcquisitionArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_acquisition',
  id: 'acquisition.promotion',
  intake: artifactReference('product_intake', intake),
  seed_capture: artifactReference('source_capture', capture),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: `sha256:${'a'.repeat(64)}`,
};
const fact = (label: string, value: string, unit: string): QualifiedFactArtifact =>
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
  fact('nominal voltage', '24', 'V'),
  fact('nominal voltage', '24.0', 'V'),
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
    id: 'approval.promotion',
    review_package: artifactReference('review_package', reviewPackage),
    review_package_snapshot: reviewPackageSnapshot(reviewPackage),
    semantic_snapshot: reviewPackage.semantic_snapshot,
    reviewer_id: 'reviewer.human',
    decision: 'approved',
    reviewed_at: '2026-01-02T00:00:00Z',
    promotion_decisions: {
      approved_fields: fields,
      evidence_acknowledged: true,
      product_role: 'solar_charge_controller',
      category: 'solar_charge_controller',
    },
  };
  return { bridge, reviewPackage, approval, fields };
};

describe('production promotion', () => {
  it('produces a canonical promotion result from an approved production review', () => {
    const { bridge, reviewPackage, approval } = setup();
    const { review, result } = promoteProductionCandidate(approval, reviewPackage, bridge);
    expect(result.status).toBe('success');
    expect(result.proposal).toMatchObject({
      manufacturer: 'Example',
      model: 'Model',
      part_number: 'MPN',
      category: 'solar_charge_controller',
      product_role: 'solar_charge_controller',
      verification_status: 'unverified',
    });
    expect(result).toEqual(
      promoteCandidate(bridge.candidate!, bridge.sources, bridge.facts, review),
    );
  });

  it('promotes only the fields explicitly approved by the human', () => {
    const { bridge, reviewPackage, approval, fields } = setup();
    const selected = fields[0];
    const { result } = promoteProductionCandidate(
      {
        ...approval,
        promotion_decisions: { ...approval.promotion_decisions!, approved_fields: [selected] },
      },
      reviewPackage,
      bridge,
    );
    expect(fields).toEqual(['electrical.continuous_current_a', 'electrical.nominal_voltage_v']);
    expect(result.status).toBe('success');
    expect(result.proposal?.electrical).toEqual({ continuous_current_a: 10 });
    expect(result.audit?.omitted_fields).toEqual([fields[1]]);
  });

  it('preserves the existing promotion audit', () => {
    const { bridge, reviewPackage, approval, fields } = setup();
    const evidenceOnly = bridge.candidate!.field_evidence[fields[1]][0];
    const { review, result } = promoteProductionCandidate(
      {
        ...approval,
        promotion_decisions: {
          ...approval.promotion_decisions!,
          approved_fields: [fields[0]],
          reviewed_evidence_fact_ids: [evidenceOnly],
        },
      },
      reviewPackage,
      bridge,
    );
    expect(result.status).toBe('success');
    expect(result.audit).toMatchObject({
      candidate_id: bridge.candidate!.id,
      review_id: review.id,
      reviewer_id: approval.reviewer_id,
      field_evidence: { [fields[0]]: bridge.candidate!.field_evidence[fields[0]] },
      omitted_fields: [fields[1]],
      reviewed_evidence_fact_ids: [evidenceOnly],
    });
  });

  it('returns blocked promotion results unchanged', () => {
    const { bridge, reviewPackage, approval } = setup();
    const blockedApproval = {
      ...approval,
      promotion_decisions: { ...approval.promotion_decisions!, evidence_acknowledged: false },
    };
    const { review, result } = promoteProductionCandidate(blockedApproval, reviewPackage, bridge);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((item) => item.code)).toContain('promotion_evidence_missing');
    expect(result).toEqual(
      promoteCandidate(bridge.candidate!, bridge.sources, bridge.facts, review),
    );
  });

  it('passes catalog context through for canonical identity collision detection', () => {
    const { bridge, reviewPackage, approval } = setup();
    const existing = promoteProductionCandidate(approval, reviewPackage, bridge).result.proposal!;
    const catalogContext = { components: [existing] };
    const { review, result } = promoteProductionCandidate(
      approval,
      reviewPackage,
      bridge,
      catalogContext,
    );
    expect(result.status).toBe('blocked');
    expect(result.issues.map((item) => item.code)).toContain('promotion_already_exists');
    expect(result).toEqual(
      promoteCandidate(bridge.candidate!, bridge.sources, bridge.facts, review, catalogContext),
    );
  });

  it('rejects stale production approval binding before promotion', () => {
    const { bridge, reviewPackage, approval } = setup();
    expect(() =>
      promoteProductionCandidate(
        { ...approval, semantic_snapshot: `sha256:${'b'.repeat(64)}` },
        reviewPackage,
        bridge,
      ),
    ).toThrow(/exact review package/);
  });

  it('does not enable legacy review or bypass candidate snapshot binding', () => {
    const { bridge, reviewPackage, approval } = setup();
    expect(() =>
      promoteProductionCandidate(approval, reviewPackage, {
        ...bridge,
        candidate: {
          ...bridge.candidate!,
          component_data: { electrical: { nominal_voltage_v: 25, continuous_current_a: 10 } },
        },
      }),
    ).toThrow(/candidate state/);
  });

  it('produces deterministic promotion output for equivalent reordered bridge inputs', () => {
    const { bridge, reviewPackage, approval } = setup();
    const reordered = {
      ...bridge,
      sources: [...bridge.sources].reverse(),
      facts: [...bridge.facts].reverse(),
    };
    const originalSources = [...bridge.sources];
    const originalFacts = [...bridge.facts];
    const reorderedSources = [...reordered.sources];
    const reorderedFacts = [...reordered.facts];
    expect(reordered.facts.map((fact) => fact.id)).not.toEqual(bridge.facts.map((fact) => fact.id));
    const first = promoteProductionCandidate(approval, reviewPackage, bridge);
    const second = promoteProductionCandidate(approval, reviewPackage, reordered);
    expect(first.result.status).toBe('success');
    expect(second.result.status).toBe('success');
    expect(second.review.candidate_snapshot).toBe(first.review.candidate_snapshot);
    expect(second.review).toEqual(first.review);
    expect(second.result).toEqual(first.result);
    expect(bridge.sources).toEqual(originalSources);
    expect(bridge.facts).toEqual(originalFacts);
    expect(reordered.sources).toEqual(reorderedSources);
    expect(reordered.facts).toEqual(reorderedFacts);
  });
});
