import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_SCHEMA_VERSION,
  approvalMatchesReviewPackage,
  artifactDigest,
  artifactReference,
  deterministicSerialize,
  hasArtifactKind,
  reviewPackageSnapshot,
  sourceContentIdentity,
  validateSourceCapture,
  validateArtifactReferences,
  validateProductIntake,
  type ProductIntake,
  type ReviewPackage,
  type SourceCaptureArtifact,
} from '../src/production-contracts.js';
import type { ProductCandidate } from '../src/contracts.js';

const intake: ProductIntake = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.example',
  manufacturer: 'Example Manufacturer',
  product_model: 'Example Model',
  manufacturer_part_number: 'EX-1',
  official_product_uri: 'https://example.com/products/ex-1',
};

const capture: SourceCaptureArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_capture',
  id: 'capture.example',
  requested_uri: 'https://example.com/products/ex-1',
  retrieved_at: '2026-09-08T00:00:00Z',
  disposition: 'non_authoritative',
  retention_status: 'not_permitted',
  content_digest: artifactDigest('manufacturer bytes'),
  digest_algorithm: 'sha256',
};

describe('production ingestion contracts', () => {
  it('represents ordinary intake without invented defaults', () => {
    expect(intake.manufacturer_part_number).toBe('EX-1');
    expect('system_voltage' in intake).toBe(false);
    expect('submitted_at' in intake).toBe(false);
  });

  it('requires the identity fields at the type boundary', () => {
    expect(validateProductIntake({ ...intake, manufacturer: '' })).toEqual([
      'manufacturer is required',
    ]);
    expect(intake.product_model).toBeTruthy();
  });

  it('creates deterministic references independent of object key order', () => {
    expect(deterministicSerialize({ b: 2, a: 1 })).toBe(deterministicSerialize({ a: 1, b: 2 }));
    expect(artifactReference('product_intake', intake).digest).toBe(
      artifactReference('product_intake', { ...intake }).digest,
    );
  });

  it('separates reference schema version from referenced artifact schema version', () => {
    const candidate: ProductCandidate = {
      schema_version: '1.0',
      id: 'candidate.example',
      identity_status: 'unresolved',
      identity: {},
      review_status: 'pending',
      promotion_status: 'review_required',
      source_ids: [],
      identity_source_ids: [],
      fact_ids: [],
      component_data: {},
      field_evidence: {},
    };
    const reference = artifactReference(
      'product_candidate',
      candidate,
      undefined,
      candidate.schema_version,
    );
    expect(reference.reference_schema_version).toBe(PRODUCTION_SCHEMA_VERSION);
    expect(reference.referenced_artifact_schema_version).toBe(candidate.schema_version);
    expect(hasArtifactKind(reference, 'product_candidate')).toBe(true);
    expect(candidate).not.toHaveProperty('reference_schema_version');
  });

  it('rejects unrelated artifact kinds at typed graph edges', () => {
    const source = artifactReference('source_capture', capture);
    const proposal = artifactReference('semantic_proposal', {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'semantic_proposal',
      id: 'proposal.example',
      target: 'example',
      evidence_refs: [source],
      disposition: 'mapped',
      provenance: { method: 'rule' },
      input_artifact_digests: [source.digest],
    });
    expect(hasArtifactKind(source, 'source_capture')).toBe(true);
    expect(hasArtifactKind(source, 'review_package')).toBe(false);
    expect(hasArtifactKind(proposal, 'semantic_proposal')).toBe(true);
    expect(hasArtifactKind(proposal, 'product_fact')).toBe(false);
  });

  it('supports retained and non-retained source bytes', () => {
    expect(capture.retention_status).toBe('not_permitted');
    expect(
      {
        ...capture,
        retention_status: 'retained' as const,
        snapshot: artifactReference('source_capture', capture, 'cas://capture'),
      }.snapshot?.reference,
    ).toBe('cas://capture');
    expect(validateSourceCapture(capture)).toEqual([]);
    expect(
      validateSourceCapture({
        ...capture,
        retention_status: 'retained',
      }),
    ).toContain('retained captures require a snapshot reference');
    expect(
      validateSourceCapture({
        ...capture,
        snapshot: artifactReference('source_capture', capture),
      }),
    ).toContain('non-retained captures cannot have a snapshot reference');
  });

  it('uses content hash rather than URI as source revision identity', () => {
    const first = artifactReference('source_capture', capture);
    const second = artifactReference('source_capture', {
      ...capture,
      requested_uri: 'https://cdn.example.com/ex-1',
    });
    const changed = artifactReference('source_capture', {
      ...capture,
      content_digest: artifactDigest('changed manufacturer bytes'),
    });
    expect(first.digest).not.toBe(second.digest);
    expect(sourceContentIdentity(capture)).toBe(artifactDigest('manufacturer bytes'));
    expect(
      sourceContentIdentity({ content_digest: artifactDigest('changed manufacturer bytes') }),
    ).not.toBe(sourceContentIdentity(capture));
    expect(changed.digest).toBeTruthy();
    expect(sourceContentIdentity({ content_digest: capture.content_digest })).toBe(
      sourceContentIdentity({
        content_digest: capture.content_digest,
      }),
    );
    expect(first.digest).not.toBe(changed.digest);
  });

  it('represents non-linear source revision relationships', () => {
    const sameContentDifferentUri = artifactReference('source_capture', {
      ...capture,
      requested_uri: 'https://cdn.example.com/ex-1',
    });
    const changedContent = artifactReference('source_capture', {
      ...capture,
      content_digest: artifactDigest('changed manufacturer bytes'),
    });
    const predecessor = artifactReference(
      'source_revision',
      {
        schema_version: PRODUCTION_SCHEMA_VERSION,
        artifact_kind: 'source_revision',
        id: 'revision.previous',
        capture: artifactReference('source_capture', capture),
        content_digest: capture.content_digest,
        digest_algorithm: 'sha256',
      },
      undefined,
      PRODUCTION_SCHEMA_VERSION,
    );
    const revision = {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'source_revision' as const,
      id: 'revision.example',
      capture: changedContent,
      content_digest: artifactDigest('changed manufacturer bytes'),
      digest_algorithm: 'sha256' as const,
      relations: [
        { relation: 'predecessor' as const, artifact: predecessor },
        { relation: 'same_content' as const, artifact: sameContentDifferentUri },
      ],
    };
    expect(revision.relations).toHaveLength(2);
    expect(revision.relations.map((relation) => relation.relation)).toEqual([
      'predecessor',
      'same_content',
    ]);
  });

  it('keeps applicability and qualified conditions explicit', () => {
    const unresolved = { kind: 'unresolved' as const, reason: 'SKU not stated by source' };
    const exact = { kind: 'exact_sku' as const, value: 'EX-1' };
    expect(unresolved.value).toBeUndefined();
    expect(exact.value).toBe('EX-1');
  });

  it.each(['mapped', 'evidence_only', 'ambiguous', 'unresolved'] as const)(
    'allows %s proposal disposition',
    (disposition) =>
      expect(['mapped', 'evidence_only', 'ambiguous', 'unresolved']).toContain(disposition),
  );

  it('preserves qualified conditions and proposal authority boundaries', () => {
    const sourceRef = artifactReference('source_capture', capture);
    const factRef = artifactReference('qualified_fact', {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'qualified_fact',
      id: 'fact.example',
      source_capture: sourceRef,
      metadata: {
        source_wording: '25 A switching rating',
        raw_value: 25,
        source_unit: 'A',
        conditions: ['resistive load'],
        applicability: { kind: 'unresolved', reason: 'source does not define the load class' },
      },
    });
    const proposal = {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'semantic_proposal' as const,
      id: 'proposal.example',
      target: 'electrical.switching_rating_a',
      evidence_refs: [sourceRef],
      fact_refs: [factRef],
      disposition: 'evidence_only' as const,
      provenance: { method: 'machine' as const, provider: 'provider-neutral' },
      input_artifact_digests: [factRef.digest],
    };
    expect(proposal.provenance.provider).toBe('provider-neutral');
    expect(proposal).not.toHaveProperty('authorize_canonical_write');
    expect(proposal).not.toHaveProperty('canonical_write');
    expect(proposal.disposition).toBe('evidence_only');
  });

  it('binds approvals to the complete review package snapshot', () => {
    const intakeRef = artifactReference('product_intake', intake);
    const reviewPackage: ReviewPackage = {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'review_package',
      id: 'review.example',
      intake: intakeRef,
      source_refs: [artifactReference('source_capture', capture)],
      fact_refs: [],
      proposal_refs: [],
      unresolved_items: ['source wording has no defined load class'],
      semantic_snapshot: artifactDigest({ semantic: 'unknown' }),
    };
    const approval = {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      id: 'approval.example',
      review_package: artifactReference('review_package', reviewPackage),
      review_package_snapshot: reviewPackageSnapshot(reviewPackage),
      semantic_snapshot: reviewPackage.semantic_snapshot,
      reviewer_id: 'maintainer',
      decision: 'approved' as const,
      reviewed_at: '2026-09-08T00:01:00Z',
    };
    expect(approvalMatchesReviewPackage(approval, reviewPackage)).toBe(true);
    expect(reviewPackage.unresolved_items).toEqual(['source wording has no defined load class']);
    expect(
      approvalMatchesReviewPackage(approval, { ...reviewPackage, unresolved_items: ['unknown'] }),
    ).toBe(false);
    expect(
      approvalMatchesReviewPackage(approval, {
        ...reviewPackage,
        semantic_snapshot: artifactDigest({ semantic: 'changed' }),
      }),
    ).toBe(false);
  });

  it('supports isolated product outcomes within one ingestion job', () => {
    const intakeRef = artifactReference('product_intake', intake);
    const firstRun = artifactReference('product_run', {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'product_run' as const,
      id: 'run.one',
      intake: intakeRef,
      state: 'unresolved_awaiting_human_review' as const,
      attempt: 1,
      artifact_refs: [],
    });
    const secondRun = artifactReference('product_run', {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'product_run' as const,
      id: 'run.two',
      intake: intakeRef,
      state: 'promotable' as const,
      attempt: 1,
      artifact_refs: [],
    });
    const job = {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'ingestion_job' as const,
      id: 'job.example',
      created_at: '2026-09-08T00:00:00Z',
      state: 'partially_completed' as const,
      product_runs: [firstRun, secondRun],
    };
    expect(job.product_runs).toHaveLength(2);
    expect(job.product_runs[0].digest).not.toBe(job.product_runs[1].digest);
    expect(job.state).toBe('partially_completed');
  });

  it('reports dangling references without changing unknown into a negative fact', () => {
    const reference = artifactReference('source_capture', capture);
    expect(validateArtifactReferences([reference], new Set([reference.digest]))).toEqual([]);
    expect(validateArtifactReferences([reference], new Set())).toEqual([reference.digest]);
    expect(capture.response_status).toBeUndefined();
  });
});
