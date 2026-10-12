import { passportDigest, serializePassportValue } from './portable-json.js';

export const CANONICAL_VERIFICATION_REVISION = 'canonical-engineering-verification.v1';
export interface CanonicalVerificationEvent {
  readonly id: string;
  readonly revision: number;
  readonly policy_version: typeof CANONICAL_VERIFICATION_REVISION;
  readonly actor: { readonly kind: 'operator_label'; readonly identifier: string };
  readonly authority_boundary: 'trusted_local_operator';
  readonly recorded_at: string;
  readonly component_id: string;
  readonly content_digest: string;
  readonly content_snapshot: Record<string, unknown>;
  readonly lineage_digest: string;
  readonly promotion_binding: {
    readonly job_id: string;
    readonly approval_digest: string;
    readonly promotion_digest: string;
    readonly write_digest: string;
  };
  readonly previous_event_digest?: string;
}

/** Conservative whole-record binding: only authority state and its own history
 * are excluded to avoid a self-referential digest. Evidence, amendments, model
 * identity and all unknown future engineering fields participate. Even a metadata
 * change may require reauthorization; no blacklist of engineering fields can
 * silently miss a future assertion. Hashes provide identity, not authentication. */
export const canonicalEngineeringContent = (
  record: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([k]) => !['verification_status', 'engineering_verification_history'].includes(k),
    ),
  );
export const canonicalEngineeringDigest = (record: Record<string, unknown>): string =>
  passportDigest(canonicalEngineeringContent(record));
export const canonicalVerificationSnapshot = (record: Record<string, unknown>): string =>
  passportDigest(record);
export const canonicalLineageDigest = (record: Record<string, unknown>): string =>
  passportDigest({
    source_refs: record.source_refs ?? null,
    amendment_history: record.amendment_history ?? null,
  });
export const canonicalVerificationEventId = (
  event: Omit<CanonicalVerificationEvent, 'id'>,
): string => `engineering-verification.${passportDigest(event).slice(7)}`;

export const canonicalVerificationHistoryValid = (record: Record<string, unknown>): boolean => {
  const history = record.engineering_verification_history;
  // A status string carries no content-bound authority. Absence is normal for
  // an unverified record, but it is not a valid verification history.
  if (history === undefined) return false;
  if (!Array.isArray(history) || !history.length) return false;
  try {
    for (const [i, raw] of history.entries()) {
      const e = raw as CanonicalVerificationEvent;
      if (
        !e ||
        e.policy_version !== CANONICAL_VERIFICATION_REVISION ||
        e.revision !== i + 1 ||
        e.component_id !== record.id ||
        e.actor?.kind !== 'operator_label' ||
        !e.actor.identifier.trim() ||
        e.authority_boundary !== 'trusted_local_operator' ||
        !Number.isFinite(Date.parse(e.recorded_at)) ||
        e.content_digest !== passportDigest(e.content_snapshot) ||
        e.content_snapshot.id !== e.component_id ||
        e.lineage_digest !== canonicalLineageDigest(e.content_snapshot) ||
        Object.keys(e.promotion_binding ?? {})
          .sort()
          .join(',') !== 'approval_digest,job_id,promotion_digest,write_digest' ||
        !e.promotion_binding.job_id ||
        ![
          e.promotion_binding.approval_digest,
          e.promotion_binding.promotion_digest,
          e.promotion_binding.write_digest,
        ].every((d) => /^sha256:[a-f0-9]{64}$/.test(d)) ||
        e.previous_event_digest !== (i ? passportDigest(history[i - 1]) : undefined)
      )
        return false;
      const { id, ...content } = e;
      if (
        id !== canonicalVerificationEventId(content) ||
        serializePassportValue(e.content_snapshot) !==
          serializePassportValue(canonicalEngineeringContent(e.content_snapshot))
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
};

export const hasCurrentCanonicalVerification = (record: Record<string, unknown>): boolean => {
  if (record.verification_status !== 'verified') return false;
  if (!canonicalVerificationHistoryValid(record)) return false;
  const history = record.engineering_verification_history;
  const last = (history as CanonicalVerificationEvent[]).at(-1)!;
  return (
    last.content_digest === canonicalEngineeringDigest(record) &&
    serializePassportValue(last.content_snapshot) ===
      serializePassportValue(canonicalEngineeringContent(record))
  );
};

/** Replay compares against the actual durable promotion, not an event's own
 * editable claim about its origin. The trusted filesystem is still an authority
 * boundary; coherently forged authoritative inputs are not authenticated by hashes. */
export const verificationMatchesPromotion = (
  event: CanonicalVerificationEvent,
  expected: CanonicalVerificationEvent['promotion_binding'],
): boolean => serializePassportValue(event.promotion_binding) === serializePassportValue(expected);
