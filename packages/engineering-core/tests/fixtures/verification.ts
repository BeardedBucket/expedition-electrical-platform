import {
  CANONICAL_VERIFICATION_REVISION,
  canonicalEngineeringContent,
  canonicalEngineeringDigest,
  canonicalLineageDigest,
  canonicalVerificationEventId,
  type CanonicalVerificationEvent,
} from '../../src/canonical-verification.js';

/** TEST ONLY. Explicitly assert authority for a completed project-authored
 * fixture, after its test-specific engineering edits. Never use production
 * records, and never silently repair an existing stale/invalid event. This
 * builds a synthetic event, not a runtime human verification transition. */
export const verifySyntheticRecord = <T extends Record<string, unknown>>(record: T): T => {
  if (
    record.verification_status !== 'verified' ||
    record.engineering_verification_history !== undefined
  )
    return record;
  if (!/^(?:fixture[.]|synthetic[.]|witness[.])/.test(String(record.id)))
    throw new Error('Synthetic verification cannot authorize a production record.');
  const content: Omit<CanonicalVerificationEvent, 'id'> = {
    revision: 1,
    policy_version: CANONICAL_VERIFICATION_REVISION,
    actor: { kind: 'operator_label', identifier: 'Project-authored synthetic verification' },
    authority_boundary: 'trusted_local_operator',
    recorded_at: '2026-01-01T00:00:00Z',
    component_id: String(record.id),
    content_snapshot: JSON.parse(JSON.stringify(canonicalEngineeringContent(record))),
    content_digest: canonicalEngineeringDigest(record),
    lineage_digest: canonicalLineageDigest(record),
    promotion_binding: {
      job_id: 'synthetic-job',
      approval_digest: `sha256:${'a'.repeat(64)}`,
      promotion_digest: `sha256:${'b'.repeat(64)}`,
      write_digest: `sha256:${'c'.repeat(64)}`,
    },
  };
  return {
    ...record,
    engineering_verification_history: [{ id: canonicalVerificationEventId(content), ...content }],
  };
};
