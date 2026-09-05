import { describe, expect, it } from 'vitest';
import pilot from '../../../data/ingestion/victron-multiplus-24-2000-50-50-120v.json' with { type: 'json' };
import type { ProductCandidate } from '../src/contracts.js';
import { promoteCandidate, type PromotionReview } from '../src/promotion.js';

const candidate = (): ProductCandidate =>
  JSON.parse(JSON.stringify(pilot.candidate)) as ProductCandidate;
const sources = () => [pilot.source];
const facts = () => pilot.facts;
const approvedFields = () => Object.keys(pilot.candidate.field_evidence).sort();
const review = (overrides: Partial<PromotionReview> = {}): PromotionReview => ({
  schema_version: '1.0',
  id: 'review.synthetic.pmp242200100',
  candidate_id: pilot.candidate.id,
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
});

const candidateWith = (overrides: Partial<ProductCandidate>): ProductCandidate => ({
  ...candidate(),
  ...overrides,
});
