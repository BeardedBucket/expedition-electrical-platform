import { describe, expect, it } from 'vitest';
import pilot from '../../../data/ingestion/victron-multiplus-24-2000-50-50-120v.json' with { type: 'json' };
import epochPilot from '../../../data/ingestion/epoch-24v-100ah-b24100a-c.json' with { type: 'json' };
import type { ProductCandidate } from '../src/contracts.js';
import {
  promotionCandidateSnapshot,
  promoteCandidate,
  type PromotionReview,
} from '../src/promotion.js';

const candidate = (): ProductCandidate =>
  JSON.parse(JSON.stringify(pilot.candidate)) as ProductCandidate;
const sources = () => [pilot.source];
const facts = () => pilot.facts;
const approvedFields = () => Object.keys(pilot.candidate.field_evidence).sort();
const review = (overrides: Partial<PromotionReview> = {}): PromotionReview => ({
  schema_version: '1.0',
  id: 'review.synthetic.pmp242200100',
  candidate_id: pilot.candidate.id,
  candidate_snapshot: promotionCandidateSnapshot(pilot.candidate, [pilot.source], pilot.facts),
  decision: 'approved',
  reviewer_id: 'reviewer.synthetic',
  reviewed_at: '2026-09-06T12:00:00.000Z',
  approved_fields: approvedFields(),
  evidence_acknowledged: true,
  product_role: 'inverter_charger',
  category: 'inverter_charger',
  ...overrides,
});

describe('reviewed candidate promotion', () => {
  it.each([
    ['pending review', { decision: 'rejected' as const }],
    ['review for another candidate', { candidate_id: 'other.candidate' }],
    ['unacknowledged evidence', { evidence_acknowledged: false }],
  ])('blocks %s', (_name, overrides) => {
    const result = promoteCandidate(candidate(), sources(), facts(), review(overrides));
    expect(result.status).toBe('blocked');
    expect(result.issues.map((item) => item.code)).toContain(
      overrides.evidence_acknowledged === false
        ? 'promotion_evidence_missing'
        : 'promotion_review_not_approved',
    );
  });

  it.each([
    ['unresolved identity', { identity_status: 'unresolved' as const }],
    ['conflicting identity', { identity_status: 'conflicting' as const }],
  ])('blocks %s', (_name, overrides) => {
    const result = promoteCandidate(candidateWith(overrides), sources(), facts(), review());
    expect(result.status).toBe('blocked');
    expect(result.issues.map((item) => item.code)).toContain(
      overrides.identity_status === 'unresolved'
        ? 'promotion_identity_unresolved'
        : 'promotion_candidate_conflicting',
    );
  });

  it('blocks unresolved fields, missing evidence, and dangling resolutions', () => {
    const unresolved = candidate();
    const unresolvedResult = promoteCandidate(
      {
        ...unresolved,
        component_data: {
          ...unresolved.component_data,
          extra: { value: 1 },
        },
        field_evidence: unresolved.field_evidence,
      },
      sources(),
      facts(),
      review({ approved_fields: [...approvedFields(), 'extra.value'] }),
    );
    expect(unresolvedResult.issues.map((item) => item.code)).toContain(
      'promotion_evidence_missing',
    );

    const danglingResult = promoteCandidate(
      candidate(),
      sources(),
      facts(),
      review({
        field_resolutions: {
          weight_kg: { selected_fact_id: 'missing.fact', rationale: 'Selected during review.' },
        },
      }),
    );
    expect(danglingResult.issues.map((item) => item.code)).toContain(
      'promotion_dangling_resolution',
    );
  });

  it('rejects invalid candidates and existing canonical identity', () => {
    const invalid = candidate();
    const invalidResult = promoteCandidate(
      { ...invalid, source_ids: [] },
      sources(),
      facts(),
      review(),
    );
    expect(invalidResult.status).toBe('invalid');
    expect(invalidResult.issues.map((item) => item.code)).toContain(
      'promotion_candidate_validation_failed',
    );

    const success = promoteCandidate(candidate(), sources(), facts(), review());
    const collisionResult = promoteCandidate(candidate(), sources(), facts(), review(), {
      components: [
        {
          id: success.proposal?.id ?? '',
          manufacturer: 'Victron Energy',
          part_number: 'PMP242200100',
        },
      ],
    });
    expect(collisionResult.issues.map((item) => item.code)).toContain('promotion_already_exists');
  });

  it('produces a schema-valid dry-run proposal with provenance and no dimensions', () => {
    const result = promoteCandidate(candidate(), sources(), facts(), review());
    expect(result.status).toBe('success');
    expect(result.proposal).toMatchObject({
      manufacturer: 'Victron Energy',
      model: '24/2000/50-50 120V VE.Bus',
      part_number: 'PMP242200100',
      product_role: 'inverter_charger',
      verification_status: 'unverified',
    });
    expect(result.proposal).not.toHaveProperty('dimensions_mm');
    expect(result.proposal?.source_refs).toEqual([
      expect.objectContaining({
        id: pilot.source.id,
        uri: pilot.source.uri,
        review_id: 'review.synthetic.pmp242200100',
      }),
    ]);
    expect(result.audit?.field_evidence).toEqual(pilot.candidate.field_evidence);
    expect(result.audit?.omitted_fields).toEqual([]);
  });

  it('requires an exact candidate and evidence snapshot for new reviews', () => {
    const baseReview = review();
    expect(promoteCandidate(candidate(), sources(), facts(), baseReview).status).toBe('success');
    expect(
      promoteCandidate(
        { ...candidate(), component_data: { ...candidate().component_data, weight_kg: 22 } },
        sources(),
        facts(),
        baseReview,
      ).issues.map((item) => item.code),
    ).toContain('promotion_snapshot_mismatch');
    expect(
      promoteCandidate(
        { ...candidate(), identity: { ...candidate().identity, model: 'Changed' } },
        sources(),
        facts(),
        baseReview,
      ).issues.map((item) => item.code),
    ).toContain('promotion_snapshot_mismatch');
    expect(
      promoteCandidate(
        { ...candidate(), field_evidence: { ...candidate().field_evidence, weight_kg: ['other'] } },
        sources(),
        facts(),
        baseReview,
      ).issues.map((item) => item.code),
    ).toContain('promotion_snapshot_mismatch');
    expect(
      promoteCandidate(
        candidate(),
        [{ ...pilot.source, content_hash: 'sha256:changed' }],
        facts(),
        baseReview,
      ).issues.map((item) => item.code),
    ).toContain('promotion_snapshot_mismatch');
    expect(
      promoteCandidate(candidate(), sources(), facts(), {
        ...baseReview,
        candidate_snapshot: undefined,
      }).issues.map((item) => item.code),
    ).toContain('promotion_snapshot_missing');
    expect(
      promoteCandidate(
        candidate(),
        sources(),
        facts(),
        { ...baseReview, candidate_snapshot: undefined },
        {},
        {
          allowLegacyReview: true,
        },
      ).status,
    ).toBe('success');
  });

  it('promotes structured topology only through explicit parent approval', () => {
    const topologyCandidate = epochPilot.candidate;
    const topologyReview: PromotionReview = {
      schema_version: '1.0',
      id: 'review.synthetic.epoch-topology',
      candidate_id: topologyCandidate.id,
      candidate_snapshot: promotionCandidateSnapshot(
        topologyCandidate,
        [epochPilot.source],
        epochPilot.facts,
      ),
      decision: 'approved',
      reviewer_id: 'reviewer.synthetic',
      reviewed_at: '2026-09-06T12:00:00.000Z',
      approved_fields: ['battery.allowed_series_count', 'battery.allowed_parallel_count'],
      evidence_acknowledged: true,
      product_role: 'battery',
      category: 'battery',
    };
    const result = promoteCandidate(
      topologyCandidate,
      [epochPilot.source],
      epochPilot.facts,
      topologyReview,
    );
    expect(result.status).toBe('success');
    expect(result.proposal?.battery).toMatchObject({
      allowed_series_count: { min: 1, max: 2 },
      allowed_parallel_count: { min: 1, max: 4 },
    });
    expect(result.audit?.field_evidence).toMatchObject({
      'battery.allowed_series_count': ['extracted.fact.432682d70f01b77d'],
      'battery.allowed_parallel_count': ['extracted.fact.9200d17163e0a4d8'],
    });

    const missingEvidence = promoteCandidate(
      topologyCandidate,
      [epochPilot.source],
      epochPilot.facts,
      {
        ...topologyReview,
        approved_fields: ['battery.allowed_series_count'],
        field_resolutions: {
          'battery.allowed_series_count': {
            selected_fact_id: 'missing',
            rationale: 'missing',
          },
        },
      },
    );
    expect(missingEvidence.issues.map((item) => item.code)).toContain(
      'promotion_dangling_resolution',
    );
    const leafApproval = promoteCandidate(
      topologyCandidate,
      [epochPilot.source],
      epochPilot.facts,
      {
        ...topologyReview,
        approved_fields: ['battery.allowed_series_count.min'],
      },
    );
    expect(leafApproval.issues.map((item) => item.code)).toContain('promotion_evidence_missing');
  });
});

const candidateWith = (overrides: Partial<ProductCandidate>): ProductCandidate => ({
  ...candidate(),
  ...overrides,
});
