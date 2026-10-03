import { describe, expect, it } from 'vitest';
import {
  artifactDigest,
  artifactReference,
  buildProductionProductCandidate,
  buildProductionReviewPackage,
  buildProductionSemanticProposals,
  buildQualifiedFactArtifact,
  PRODUCTION_SCHEMA_VERSION,
  reconcileQualifiedFactsForWholeIntake,
  type ProductIntake,
  type QualifiedFactArtifact,
  type SourceAcquisitionArtifact,
  type SourceCaptureArtifact,
} from '../src/index.js';

const intake: ProductIntake = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.example',
  manufacturer: 'Example',
  product_model: 'Model',
  manufacturer_part_number: 'MPN',
  official_product_uri: 'https://example.invalid/product',
};
const capture: SourceCaptureArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_capture',
  id: 'capture.example',
  requested_uri: 'https://example.invalid/product',
  retrieved_at: '2026-01-01T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'not_retained',
  source_provenance: { publisher: 'Example' },
};
const acquisition: SourceAcquisitionArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_acquisition',
  id: 'acquisition.example',
  intake: artifactReference('product_intake', intake),
  seed_capture: artifactReference('source_capture', capture),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: `sha256:${'a'.repeat(64)}`,
};
const fact = (
  label: string,
  value: string,
  suffix: string,
  metadata: Partial<QualifiedFactArtifact['metadata']> = {},
): QualifiedFactArtifact =>
  buildQualifiedFactArtifact({
    source_capture: artifactReference('source_capture', capture),
    source_acquisition: artifactReference('source_acquisition', acquisition),
    metadata: {
      source_wording: `${label} ${value} ${suffix}`,
      source_label: label,
      raw_value: value,
      source_unit: 'V',
      applicability: { kind: 'exact_mpn_or_sku', value: 'MPN' },
      ...metadata,
    },
    qualification_state: 'exact',
  });
const mapped = () => [fact('nominal voltage', '24', 'a'), fact('nominal voltage', '24.0', 'b')];
const mixed = () => [
  ...mapped(),
  fact('maximum pv open-circuit voltage', '30', 'a'),
  fact('maximum pv open-circuit voltage', '30.0', 'b'),
  fact('mystery rating', '40', 'a'),
  fact('mystery rating', '40.0', 'b'),
  fact('continuous current', '10', 'a', { conditions: ['at 25 C'] }),
  fact('continuous current', '10.0', 'b'),
  fact('mystery conflict', '24', 'conflict-a'),
  fact('mystery conflict', '25', 'conflict-b'),
];
const run = (facts: readonly QualifiedFactArtifact[]) => {
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
  return {
    reconciliation,
    bridge,
    review: buildProductionReviewPackage({ intake, reconciliation, bridge }),
  };
};

describe('production review package', () => {
  it('builds a deterministic review package from a production candidate bridge result', () => {
    const { bridge, review } = run(mapped());
    expect(review.candidate?.digest).toBe(artifactDigest(bridge.candidate));
    expect(review.proposal_refs.map((ref) => ref.digest)).toEqual(
      bridge.proposals.map(artifactDigest),
    );
    expect(review.semantic_snapshot).toMatch(/^sha256:/);
    expect(run(mapped()).review).toEqual(review);
  });

  it('includes non-projected proposals and projection diagnostics in review state', () => {
    const { bridge, review } = run(mixed());
    expect(review.proposal_refs).toHaveLength(bridge.proposals.length);
    expect(review.unresolved_items).toEqual(
      bridge.non_projected.map((item) => `${item.proposal_id}: ${item.reason}`),
    );
    expect(bridge.proposals.map((proposal) => proposal.disposition)).toEqual(
      expect.arrayContaining(['evidence_only', 'unsupported', 'unresolved', 'conflicting']),
    );
  });

  it('preserves conflicting alternatives without selecting a winner', () => {
    const { bridge, review } = run(mixed());
    const conflicts = bridge.proposals.filter((proposal) => proposal.disposition === 'conflicting');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].alternatives).toHaveLength(2);
    expect(review.conflicts).toEqual(conflicts.map((proposal) => proposal.id));
    expect(review.proposal_refs).toContainEqual(
      artifactReference(
        'semantic_proposal',
        conflicts[0],
        conflicts[0].id,
        conflicts[0].schema_version,
      ),
    );
  });

  it('preserves proposal fact and evidence provenance for projected fields', () => {
    const { bridge, review } = run(mapped());
    const proposal = bridge.proposals[0];
    expect(proposal.fact_refs?.map((ref) => ref.digest)).toEqual(
      bridge.qualified_facts.map(artifactDigest),
    );
    expect(proposal.evidence_refs).toContainEqual(artifactReference('source_capture', capture));
    expect(review.fact_refs.filter((ref) => ref.kind === 'qualified_fact')).toHaveLength(2);
    expect(bridge.candidate?.field_evidence[proposal.target]).toEqual(
      bridge.proposal_fact_ids[proposal.id],
    );
  });

  it('validates multiple projected proposals contributing to one candidate field', () => {
    const facts = [
      ...mapped(),
      fact('nominal battery voltage', '24', 'a'),
      fact('nominal battery voltage', '24.0', 'b'),
    ];
    const { reconciliation, bridge, review } = run(facts);
    const field = 'electrical.nominal_voltage_v';
    expect(reconciliation.group_reconciliations).toHaveLength(2);
    expect(bridge.proposals).toHaveLength(2);
    expect(
      bridge.proposals.every(
        (proposal) => proposal.disposition === 'mapped' && proposal.target === field,
      ),
    ).toBe(true);
    expect(bridge.projected_proposal_ids).toEqual(bridge.proposals.map((proposal) => proposal.id));
    expect(bridge.candidate?.component_data).toEqual({ electrical: { nominal_voltage_v: 24 } });
    const combinedIds = bridge.proposals
      .flatMap((proposal) => bridge.proposal_fact_ids[proposal.id])
      .sort();
    expect(bridge.candidate?.field_evidence[field]).toEqual(combinedIds);
    expect(review.proposal_refs.map((ref) => ref.digest)).toEqual(
      bridge.proposals.map(artifactDigest),
    );
    expect(run([...facts].reverse()).review.semantic_snapshot).toBe(review.semantic_snapshot);
    expect(() =>
      buildProductionReviewPackage({
        intake,
        reconciliation,
        bridge: {
          ...bridge,
          candidate: {
            ...bridge.candidate!,
            field_evidence: { [field]: [...combinedIds.slice(0, -1), combinedIds[0]] },
          },
        },
      }),
    ).toThrow(/stale or inconsistent/);
  });

  it('builds a review package when no product candidate can be constructed', () => {
    const { bridge, review } = run([
      fact('mystery rating', '40', 'a'),
      fact('mystery rating', '40.0', 'b'),
    ]);
    expect(bridge.candidate).toBeUndefined();
    expect(review.candidate).toBeUndefined();
    expect(review.proposal_refs).toHaveLength(1);
    expect(review.unresolved_items).toHaveLength(1);
  });

  it('rejects stale or inconsistent production candidate bridge input', () => {
    const { reconciliation, bridge } = run(mapped());
    expect(() =>
      buildProductionReviewPackage({
        intake,
        reconciliation: { ...reconciliation, id: 'stale' },
        bridge,
      }),
    ).toThrow(/stale or inconsistent/);
    expect(() =>
      buildProductionReviewPackage({
        intake,
        reconciliation,
        bridge: { ...bridge, projected_proposal_ids: [] },
      }),
    ).toThrow(/stale or inconsistent/);
  });

  it('does not infer approval verification or winner selection while packaging review', () => {
    const { bridge, review } = run(mixed());
    expect(
      bridge.facts.every((fact) => fact.fact_state === 'provisional' && fact.review_required),
    ).toBe(true);
    expect(bridge.candidate?.review_status).toBe('pending');
    expect(review).not.toHaveProperty('decision');
    expect(review).not.toHaveProperty('reviewer_id');
    expect(review).not.toHaveProperty('selected_value');
  });

  it('produces the same review package for equivalent reordered inputs', () => {
    const facts = mixed();
    expect(run(facts).review).toEqual(run([...facts].reverse()).review);
  });
});
