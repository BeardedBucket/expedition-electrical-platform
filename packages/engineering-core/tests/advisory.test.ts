import { describe, expect, it } from 'vitest';
import {
  assessAdvisory,
  evaluateComponentAdvisories,
  validateAdvisoryCollection,
  validateAdvisoryRecord,
  validateEvidenceCollection,
  evaluateAdvisoryRecommendationBoundary,
  validateEvidenceRecord,
  type AdvisoryRecord,
  type EvidenceRecord,
} from '../src/index.js';

const source = (id: string, publisher = 'synthetic-publisher') => ({
  id,
  type: 'synthetic',
  publisher,
  date_checked: '2026-09-04',
});

const evidence = (
  id: string,
  type: EvidenceRecord['type'],
  verification_status: EvidenceRecord['verification_status'] = 'verified',
  publisher = 'synthetic-publisher',
): EvidenceRecord => ({
  id,
  affected_component_ids: ['component.a'],
  type,
  sources: [source(`${id}.source`, publisher)],
  date_checked: '2026-09-04',
  summary: 'Synthetic evidence.',
  verification_status,
  status: 'active',
});

const advisory = (
  id: string,
  evidence_ids: readonly string[],
  policy_action: AdvisoryRecord['policy_action'] = 'inform',
  overrides: Partial<AdvisoryRecord> = {},
): AdvisoryRecord => ({
  id,
  affected_component_ids: ['component.a'],
  status: 'active',
  severity: 'moderate',
  confidence: 'medium',
  evidence_ids,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
  summary: 'Synthetic advisory.',
  rationale: 'Synthetic rationale.',
  policy_action,
  ...overrides,
});

describe('advisory evidence and policy', () => {
  it('leaves a component with no advisories eligible', () => {
    const result = evaluateComponentAdvisories('component.a', [], [], '2026-09-04T00:00:00Z');
    expect(result.eligible).toBe(true);
    expect(result.effective_policy_action).toBe('none');
  });

  it('aggregates policy, severity, and confidence independently', () => {
    const records = [evidence('evidence.a', 'news_report'), evidence('evidence.b', 'recall')];
    const result = evaluateComponentAdvisories(
      'component.a',
      [
        advisory('advisory.inform', ['evidence.a'], 'inform', { severity: 'high' }),
        advisory('advisory.exclude', ['evidence.b'], 'exclude', { severity: 'low' }),
      ],
      records,
      '2026-09-04T00:00:00Z',
    );
    expect(result.effective_policy_action).toBe('exclude');
    expect(result.effective_severity).toBe('high');
    expect(result.effective_confidence).toBe('high');
    expect(result.eligible).toBe(false);
  });

  it('keeps caution eligible and distinguishes suppression from exclusion', () => {
    const caution = evaluateComponentAdvisories(
      'component.a',
      [advisory('advisory.caution', ['evidence.a'], 'caution')],
      [evidence('evidence.a', 'community_report', 'unverified')],
      '2026-09-04T00:00:00Z',
    );
    expect(caution.eligible).toBe(true);
    expect(caution.effective_policy_action).toBe('caution');

    const suppressed = evaluateComponentAdvisories(
      'component.a',
      [advisory('advisory.suppressed', ['evidence.b'], 'suppress_recommendation')],
      [evidence('evidence.b', 'recall')],
      '2026-09-04T00:00:00Z',
    );
    expect(suppressed.eligible).toBe(false);
    expect(suppressed.effective_policy_action).toBe('suppress_recommendation');
  });

  it.each([
    'litigation',
    'community_report',
    'forum_report',
    'social_media_report',
    'news_report',
  ] as const)('%s alone remains needs_review and cannot confirm a finding', (type) => {
    const item = evidence('evidence.only', type, 'verified');
    const result = assessAdvisory(advisory('advisory.only', [item.id], 'exclude'), [item]);
    expect(result.status).toBe('needs_review');
    expect(result.confidence).toBe('low');
    expect(result.policy_action).not.toBe('exclude');
  });

  it('caps litigation-only exclusion at automatic caution', () => {
    const item = evidence('evidence.litigation-cap', 'litigation');
    expect(
      assessAdvisory(advisory('advisory.litigation-cap', [item.id], 'exclude'), [item])
        .policy_action,
    ).toBe('caution');
  });

  it('caps forum-only suppression at automatic caution', () => {
    const item = evidence('evidence.forum-cap', 'forum_report');
    expect(
      assessAdvisory(advisory('advisory.forum-cap', [item.id], 'suppress_recommendation'), [item])
        .policy_action,
    ).toBe('caution');
  });

  it('caps news-only suppression at automatic caution', () => {
    const item = evidence('evidence.news-cap', 'news_report');
    expect(
      assessAdvisory(advisory('advisory.news-cap', [item.id], 'suppress_recommendation'), [item])
        .policy_action,
    ).toBe('caution');
  });

  it('allows verified recall evidence to support strong action', () => {
    const item = evidence('evidence.recall', 'regulator_notice');
    const result = assessAdvisory(advisory('advisory.recall', [item.id], 'exclude'), [item]);
    expect(result.status).toBe('sufficient');
    expect(result.confidence).toBe('high');
    expect(result.policy_action).toBe('exclude');
  });

  it('does not count duplicate publishers as independent corroboration', () => {
    const first = evidence('evidence.first', 'independent_lab_test', 'verified', 'same-source');
    const duplicate = evidence(
      'evidence.duplicate',
      'independent_lab_test',
      'verified',
      'same-source',
    );
    const result = assessAdvisory(advisory('advisory.duplicates', [first.id, duplicate.id]), [
      first,
      duplicate,
    ]);
    expect(result.confidence).toBe('high');
    expect(result.reasons).toContain('verified_or_corroborated_technical_evidence');
  });

  it('ignores retracted and superseded evidence normally', () => {
    const item = { ...evidence('evidence.retracted', 'recall'), status: 'retracted' as const };
    const result = assessAdvisory(advisory('advisory.retracted', [item.id], 'exclude'), [item]);
    expect(result.status).toBe('needs_review');
    expect(result.policy_action).toBe('none');
  });

  it('flags stale and review-due records without dismissing them', () => {
    const result = evaluateComponentAdvisories(
      'component.a',
      [
        advisory('advisory.stale', ['evidence.a'], 'caution', {
          updated_at: '2026-01-01T00:00:00Z',
          next_review_at: '2026-02-01T00:00:00Z',
        }),
      ],
      [evidence('evidence.a', 'independent_lab_test')],
      '2026-09-04T00:00:00Z',
      { staleAfterDays: 30 },
    );
    expect(result.stale).toBe(true);
    expect(result.review_due).toBe(true);
    expect(result.effective_policy_action).toBe('caution');
  });

  it('reports missing evidence references and malformed records structurally', () => {
    const missing = validateAdvisoryRecord(
      advisory('advisory.missing', ['evidence.missing']),
      new Set(),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.code).toBe('missing_evidence_reference');

    const malformed = validateEvidenceRecord({ id: 'bad id', date_checked: 'not-a-date' });
    expect(malformed.ok).toBe(false);
    const invalidTimestamp = validateAdvisoryRecord({
      ...advisory('advisory.invalid'),
      created_at: 'not-a-date',
      updated_at: '2026-09-01T00:00:00Z',
    });
    expect(invalidTimestamp.ok).toBe(false);
  });

  it('rejects duplicate IDs, reverse timestamps, and self-supersession', () => {
    const first = advisory('advisory.duplicate', []);
    const second = advisory('advisory.duplicate', []);
    const duplicate = validateAdvisoryCollection([first, second]);
    expect(duplicate.some((problem) => problem.code === 'duplicate_advisory_id')).toBe(true);
    const invalid = validateAdvisoryRecord({
      ...first,
      created_at: '2026-09-04T00:00:00Z',
      updated_at: '2026-09-03T00:00:00Z',
      supersedes: first.id,
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok)
      expect(invalid.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining(['timestamp_order', 'self_supersedes']),
      );
  });

  it('keeps resolved and withdrawn advisories inactive by default', () => {
    const item = evidence('evidence.lifecycle', 'recall');
    const result = evaluateComponentAdvisories(
      'component.a',
      [
        advisory('advisory.resolved', [item.id], 'exclude', { status: 'resolved' }),
        advisory('advisory.withdrawn', [item.id], 'exclude', { status: 'withdrawn' }),
      ],
      [item],
      '2026-09-04T00:00:00Z',
    );
    expect(result.effective_policy_action).toBe('none');
    expect(result.eligible).toBe(true);
  });

  it('keeps superseded advisories inactive by default', () => {
    const item = evidence('evidence.superseded', 'recall');
    const result = evaluateComponentAdvisories(
      'component.a',
      [advisory('advisory.superseded', [item.id], 'exclude', { status: 'superseded' })],
      [item],
      '2026-09-04T00:00:00Z',
    );
    expect(result.effective_policy_action).toBe('none');
  });

  it('flags stale evidence independently from stale advisory metadata', () => {
    const item = {
      ...evidence('evidence.old', 'independent_lab_test'),
      date_checked: '2026-01-01',
    };
    const result = evaluateComponentAdvisories(
      'component.a',
      [advisory('advisory.current', [item.id], 'caution')],
      [item],
      '2026-09-04T00:00:00Z',
      { evidenceStaleAfterDays: 30 },
    );
    expect(result.stale).toBe(true);
    expect(result.warnings).toContain('advisory.current:evidence_stale');
  });

  it('uses reviewed action and confidence without overwriting automatic assessment', () => {
    const item = evidence('evidence.reviewed', 'community_report', 'unverified');
    const record = advisory('advisory.reviewed', [item.id], 'caution', {
      reviewed_decision: {
        status: 'active',
        severity: 'high',
        confidence: 'confirmed',
        policy_action: 'exclude',
        rationale: 'Synthetic human review.',
        reviewer: 'reviewer.synthetic',
        reviewed_at: '2026-09-04T00:00:00Z',
      },
    });
    const automatic = assessAdvisory(record, [item]);
    const effective = evaluateComponentAdvisories(
      'component.a',
      [record],
      [item],
      '2026-09-04T00:00:00Z',
    );
    expect(automatic.policy_action).toBe('caution');
    expect(effective.effective_policy_action).toBe('exclude');
    expect(effective.effective_confidence).toBe('confirmed');
  });

  it('validates duplicate evidence IDs and duplicate source IDs', () => {
    const duplicateEvidence = validateEvidenceCollection([
      evidence('evidence.same', 'news_report'),
      evidence('evidence.same', 'news_report'),
    ]);
    expect(duplicateEvidence.some((problem) => problem.code === 'duplicate_evidence_id')).toBe(
      true,
    );
    const duplicateSource = validateEvidenceRecord({
      ...evidence('evidence.sources', 'news_report'),
      sources: [source('source.same'), source('source.same')],
    });
    expect(duplicateSource.ok).toBe(false);
    if (!duplicateSource.ok) {
      expect(duplicateSource.errors.some((problem) => problem.code === 'duplicate_source_id')).toBe(
        true,
      );
    }
  });

  it('distinguishes suppressed candidates from excluded candidates at the recommendation boundary', () => {
    const records = [
      evidence('evidence.suppress', 'recall'),
      evidence('evidence.exclude', 'recall'),
    ];
    const result = evaluateAdvisoryRecommendationBoundary(
      [
        {
          component: { id: 'component.suppress', verificationStatus: 'verified' },
          engineeringStatus: 'compatible',
        },
        {
          component: { id: 'component.exclude', verificationStatus: 'verified' },
          engineeringStatus: 'compatible',
        },
      ],
      [
        advisory('advisory.suppress', ['evidence.suppress'], 'suppress_recommendation', {
          affected_component_ids: ['component.suppress'],
        }),
        advisory('advisory.exclude', ['evidence.exclude'], 'exclude', {
          affected_component_ids: ['component.exclude'],
        }),
      ],
      records,
      '2026-09-04T00:00:00Z',
    );
    expect(result.recommendations).toHaveLength(0);
    expect(result.inspectableAdvisoryCandidates.map((item) => item.id)).toEqual([
      'component.suppress',
    ]);
    expect(
      result.globalCandidates.find((item) => item.component.id === 'component.suppress')
        ?.engineeringStatus,
    ).toBe('compatible');
    expect(
      result.globalCandidates.find((item) => item.component.id === 'component.exclude')
        ?.engineeringStatus,
    ).toBe('compatible');
  });

  it('generic recommendations honor inform and caution without builder logic', () => {
    const result = evaluateAdvisoryRecommendationBoundary(
      [
        {
          component: { id: 'component.inform', verificationStatus: 'verified' },
          engineeringStatus: 'compatible',
        },
      ],
      [advisory('advisory.inform', ['evidence.inform'], 'inform')],
      [evidence('evidence.inform', 'community_report', 'unverified')],
      '2026-09-04T00:00:00Z',
    );
    expect(result.recommendations[0]?.id).toBe('component.inform');
  });

  it('does not recommend engineering-incompatible candidates even without advisories', () => {
    const result = evaluateAdvisoryRecommendationBoundary(
      [
        {
          component: { id: 'component.bad', verificationStatus: 'verified' },
          engineeringStatus: 'incompatible',
        },
      ],
      [],
      [],
      '2026-09-04T00:00:00Z',
    );
    expect(result.recommendations).toHaveLength(0);
  });

  it('inform remains eligible', () => {
    const result = evaluateComponentAdvisories(
      'component.a',
      [advisory('advisory.inform-only', ['evidence.inform-only'], 'inform')],
      [evidence('evidence.inform-only', 'news_report')],
      '2026-09-04T00:00:00Z',
    );
    expect(result.eligible).toBe(true);
    expect(result.effective_policy_action).toBe('inform');
  });

  it('strongest policy action wins regardless of advisory order', () => {
    const item = evidence('evidence.action', 'recall');
    const records = [
      advisory('advisory.caution', [item.id], 'caution'),
      advisory('advisory.exclude-2', [item.id], 'exclude'),
      advisory('advisory.inform-2', [item.id], 'inform'),
    ];
    const reversed = evaluateComponentAdvisories(
      'component.a',
      [...records].reverse(),
      [item],
      '2026-09-04T00:00:00Z',
    );
    expect(reversed.effective_policy_action).toBe('exclude');
  });

  it('severity aggregation uses the highest severity deterministically', () => {
    const item = evidence('evidence.severity', 'recall');
    const result = evaluateComponentAdvisories(
      'component.a',
      [
        advisory('advisory.low', [item.id], 'inform', { severity: 'low' }),
        advisory('advisory.critical', [item.id], 'inform', { severity: 'critical' }),
      ],
      [item],
      '2026-09-04T00:00:00Z',
    );
    expect(result.effective_severity).toBe('critical');
  });

  it('confidence aggregation is independent from severity aggregation', () => {
    const lowConfidence = evidence('evidence.low-confidence', 'news_report');
    const highConfidence = evidence('evidence.high-confidence', 'recall');
    const result = evaluateComponentAdvisories(
      'component.a',
      [
        advisory('advisory.high-impact', [lowConfidence.id], 'inform', { severity: 'critical' }),
        advisory('advisory.strong-evidence', [highConfidence.id], 'inform', { severity: 'low' }),
      ],
      [lowConfidence, highConfidence],
      '2026-09-04T00:00:00Z',
    );
    expect(result.effective_severity).toBe('critical');
    expect(result.effective_confidence).toBe('high');
  });

  it('verified manufacturer recall supports a stronger assessment', () => {
    const result = assessAdvisory(
      advisory('advisory.manufacturer', ['evidence.manufacturer'], 'exclude'),
      [evidence('evidence.manufacturer', 'manufacturer_notice')],
    );
    expect(result.status).toBe('sufficient');
    expect(result.confidence).toBe('high');
  });

  it('verified regulator recall supports a stronger assessment', () => {
    const result = assessAdvisory(
      advisory('advisory.regulator', ['evidence.regulator'], 'exclude'),
      [evidence('evidence.regulator', 'regulator_notice')],
    );
    expect(result.status).toBe('sufficient');
    expect(result.confidence).toBe('high');
  });

  it('two independent technical sources corroborate at high confidence without confirming', () => {
    const first = evidence('evidence.tech-1', 'independent_lab_test', 'verified', 'lab-one');
    const second = evidence('evidence.tech-2', 'service_bulletin', 'verified', 'manufacturer-two');
    const result = assessAdvisory(advisory('advisory.corroborated', [first.id, second.id]), [
      first,
      second,
    ]);
    expect(result.confidence).toBe('high');
    expect(result.reasons).toContain(
      'independent_technical_sources_corroborate_at_high_confidence',
    );
  });

  it('same underlying source key does not count as independent corroboration', () => {
    const first = {
      ...evidence('evidence.repost-1', 'independent_lab_test'),
      sources: [{ ...source('source.repost-1', 'publisher'), event_key: 'event.same' }],
    };
    const second = {
      ...evidence('evidence.repost-2', 'independent_lab_test'),
      sources: [{ ...source('source.repost-2', 'publisher'), event_key: 'event.same' }],
    };
    const result = assessAdvisory(advisory('advisory.reposted', [first.id, second.id]), [
      first,
      second,
    ]);
    expect(result.confidence).toBe('high');
    expect(result.confidence).not.toBe('confirmed');
  });

  it('superseded evidence becomes insufficient rather than safe', () => {
    const item = {
      ...evidence('evidence.superseded-only', 'recall'),
      status: 'superseded' as const,
    };
    const result = assessAdvisory(advisory('advisory.superseded-only', [item.id], 'exclude'), [
      item,
    ]);
    expect(result.status).toBe('needs_review');
    expect(result.reasons).toContain('insufficient_evidence');
  });

  it('incomplete evidence produces needs_review', () => {
    const result = assessAdvisory(
      advisory('advisory.incomplete', ['evidence.incomplete'], 'exclude'),
      [],
    );
    expect(result.status).toBe('needs_review');
    expect(result.policy_action).toBe('none');
  });

  it('review timestamps are validated', () => {
    const invalid = validateAdvisoryRecord({
      ...advisory('advisory.review-time'),
      next_review_at: 'not-a-date',
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok)
      expect(invalid.errors.some((error) => error.path === 'next_review_at')).toBe(true);
  });

  it('invalid severity, confidence, and action are rejected', () => {
    const invalid = validateAdvisoryRecord({
      ...advisory('advisory.invalid-enums'),
      severity: 'extreme',
      confidence: 'certain',
      policy_action: 'ignore',
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining(['invalid_severity', 'invalid_confidence', 'invalid_policy_action']),
      );
    }
  });

  it('retains advisory and evidence provenance in the evaluation trace', () => {
    const item = evidence('evidence.trace', 'recall');
    const result = evaluateComponentAdvisories(
      'component.a',
      [advisory('advisory.trace', [item.id])],
      [item],
      '2026-09-04T00:00:00Z',
    );
    expect(result.applicable_advisory_ids).toEqual(['advisory.trace']);
    expect(result.trace[0]?.evidence_ids).toEqual(['evidence.trace']);
  });

  it('does not let stale state dismiss an otherwise applicable advisory', () => {
    const item = { ...evidence('evidence.stale-active', 'recall'), date_checked: '2020-01-01' };
    const result = evaluateComponentAdvisories(
      'component.a',
      [advisory('advisory.stale-active', [item.id], 'caution')],
      [item],
      '2026-09-04T00:00:00Z',
      { evidenceStaleAfterDays: 30 },
    );
    expect(result.effective_policy_action).toBe('caution');
    expect(result.stale).toBe(true);
  });

  it('resolved lifecycle can be explicitly configured to retain an action', () => {
    const item = evidence('evidence.resolved-policy', 'recall');
    const result = evaluateComponentAdvisories(
      'component.a',
      [advisory('advisory.resolved-policy', [item.id], 'exclude', { status: 'resolved' })],
      [item],
      '2026-09-04T00:00:00Z',
      { resolvedPolicyAction: 'caution' },
    );
    expect(result.effective_policy_action).toBe('caution');
    expect(result.eligible).toBe(true);
  });

  it('withdrawn lifecycle can be explicitly configured to retain a warning', () => {
    const item = evidence('evidence.withdrawn-policy', 'recall');
    const result = evaluateComponentAdvisories(
      'component.a',
      [advisory('advisory.withdrawn-policy', [item.id], 'exclude', { status: 'withdrawn' })],
      [item],
      '2026-09-04T00:00:00Z',
      { withdrawnPolicyAction: 'caution' },
    );
    expect(result.effective_policy_action).toBe('caution');
  });

  it('uses explicit evaluation timestamps deterministically', () => {
    const args = [
      'component.a',
      [advisory('advisory.time', ['evidence.time'], 'caution')],
      [evidence('evidence.time', 'news_report')],
      '2026-09-04T00:00:00Z',
      { evidenceStaleAfterDays: 30 },
    ] as const;
    expect(evaluateComponentAdvisories(...args)).toEqual(evaluateComponentAdvisories(...args));
  });

  it('reports unknown component references without changing engineering data', () => {
    const result = evaluateComponentAdvisories(
      'not-a-stable-id!',
      [advisory('advisory.unknown', [])],
      [],
      '2026-09-04T00:00:00Z',
    );
    expect(
      result.problems.some((problem) => problem.code === 'unresolved_component_reference'),
    ).toBe(true);
  });
});
