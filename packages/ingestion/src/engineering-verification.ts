import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import {
  CANONICAL_VERIFICATION_REVISION,
  canonicalEngineeringContent,
  canonicalEngineeringDigest,
  canonicalVerificationSnapshot,
  canonicalLineageDigest,
  canonicalVerificationEventId,
  canonicalVerificationHistoryValid,
  hasCurrentCanonicalVerification,
  verificationMatchesPromotion,
  type CanonicalVerificationEvent,
} from '@expedition/engineering-core/canonical-verification';
import { passportDigest } from '@expedition/engineering-core/engineering-passport';
import { artifactDigest, type ProductionApproval } from './production-contracts.js';
import type { ProductionIngestFinalizeResult } from './production-ingest-finalize.js';
import { canonicalProposalSchemaValid } from './promotion.js';
import { withCanonicalRecordLock } from './canonical-record-lock.js';

export interface VerificationOrigin {
  readonly job_id: string;
  readonly approval: ProductionApproval;
  readonly finalization: ProductionIngestFinalizeResult;
}
export const verificationPromotionBinding = (
  origin: VerificationOrigin,
): CanonicalVerificationEvent['promotion_binding'] => {
  const f = origin.finalization;
  if (
    origin.approval.decision !== 'approved' ||
    f.promotion.result.status !== 'success' ||
    f.write_result.status !== 'written' ||
    f.promotion.review.id !== origin.approval.id ||
    !f.write_result.proposal ||
    artifactDigest(f.write_result.proposal) !== artifactDigest(f.promotion.result.proposal)
  )
    throw new Error(
      'Engineering verification requires a successful explicit approved promotion and completed canonical write.',
    );
  return {
    job_id: origin.job_id,
    approval_digest: artifactDigest(origin.approval),
    promotion_digest: artifactDigest(f.promotion),
    write_digest: artifactDigest(f.write_result),
  };
};

const pathFor = async (root: string, origin: VerificationOrigin): Promise<string> => {
  verificationPromotionBinding(origin);
  const id = origin.finalization.write_result.proposal!.id;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]+$/.test(id))
    throw new Error('Unsafe canonical verification identity.');
  const destination = origin.finalization.write_result.path;
  if (typeof destination !== 'string' || !isAbsolute(destination))
    throw new Error('Durable canonical write destination is missing or not absolute.');
  const configuredRoot = resolve(root),
    expected = join(configuredRoot, `${id}.yaml`);
  const within = relative(configuredRoot, resolve(destination));
  // Host path.relative owns Windows drive/case semantics. A successful durable
  // write must identify this exact leaf, not a same-ID record in a changed root.
  if (
    !within ||
    within === '..' ||
    within.startsWith(`..${sep}`) ||
    isAbsolute(within) ||
    relative(expected, resolve(destination)) !== ''
  )
    throw new Error(
      'Durable canonical write destination does not match the configured canonical root and identity.',
    );
  const physicalRoot = await realpath(configuredRoot),
    physicalDestination = await realpath(destination);
  if (relative(join(physicalRoot, `${id}.yaml`), physicalDestination) !== '')
    throw new Error('Durable canonical write destination escapes its physical canonical root.');
  return physicalDestination;
};

const readPreviewAt = async (path: string, origin: VerificationOrigin) => {
  const record = parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  if (
    !canonicalProposalSchemaValid(record as never) ||
    record.id !== origin.finalization.write_result.proposal!.id ||
    (record.engineering_verification_history !== undefined &&
      !canonicalVerificationHistoryValid(record))
  )
    throw new Error('Canonical verification record or history is invalid.');
  const history = record.engineering_verification_history as
    CanonicalVerificationEvent[] | undefined;
  if (
    history?.some(
      (event) => !verificationMatchesPromotion(event, verificationPromotionBinding(origin)),
    )
  )
    throw new Error('Canonical verification history does not match this durable promotion.');
  return {
    record,
    snapshot: canonicalVerificationSnapshot(record),
    content_digest: canonicalEngineeringDigest(record),
    current: record.verification_status === 'verified' && hasCurrentCanonicalVerification(record),
  };
};

export const readEngineeringVerificationPreview = async (
  root: string,
  origin: VerificationOrigin,
) => readPreviewAt(await pathFor(root, origin), origin);

/** Separate explicit local-human authority. Intent is bound to the WHOLE disk
 * snapshot (including history), preventing replay even when engineering content
 * is unchanged. Server owns origin and time; the caller supplies only the label
 * and snapshot they reviewed. No claim of authenticated identity is made. */
export const verifyCanonicalEngineering = async (request: {
  readonly root: string;
  readonly origin: VerificationOrigin;
  readonly expected_snapshot: string;
  readonly operator_label: string;
  readonly recorded_at: string;
}): Promise<CanonicalVerificationEvent> => {
  if (!request.operator_label.trim() || !Number.isFinite(Date.parse(request.recorded_at)))
    throw new Error('Verification needs an operator label and explicit valid timestamp.');
  const path = await pathFor(request.root, request.origin);
  return withCanonicalRecordLock(path, async () => {
    // Re-prove configuration under the lock, then read and replace the same
    // proven physical destination. A root redirect must not change the record
    // read while the write still targets a previously locked file.
    if (relative(path, await pathFor(request.root, request.origin)) !== '')
      throw new Error('Durable canonical write destination changed during verification.');
    const preview = await readPreviewAt(path, request.origin);
    if (preview.snapshot !== request.expected_snapshot)
      throw new Error('Canonical verification snapshot is stale.');
    const record = preview.record;
    if (!Array.isArray(record.source_refs) || !record.source_refs.length)
      throw new Error('Canonical source/evidence lineage is required for verification.');
    const history = (record.engineering_verification_history ?? []) as CanonicalVerificationEvent[];
    const content: Omit<CanonicalVerificationEvent, 'id'> = {
      revision: history.length + 1,
      policy_version: CANONICAL_VERIFICATION_REVISION,
      actor: { kind: 'operator_label', identifier: request.operator_label.trim() },
      authority_boundary: 'trusted_local_operator',
      recorded_at: request.recorded_at,
      component_id: String(record.id),
      content_snapshot: canonicalEngineeringContent(record),
      content_digest: preview.content_digest,
      lineage_digest: canonicalLineageDigest(record),
      promotion_binding: verificationPromotionBinding(request.origin),
      ...(history.length ? { previous_event_digest: passportDigest(history.at(-1)) } : {}),
    };
    const event = { id: canonicalVerificationEventId(content), ...content };
    const proposal = {
      ...record,
      verification_status: 'verified',
      engineering_verification_history: [...history, event],
    };
    if (
      !canonicalProposalSchemaValid(proposal as never) ||
      !hasCurrentCanonicalVerification(proposal)
    )
      throw new Error('Engineering verification failed reconstruction.');
    const temp = `${path}.${randomUUID()}.tmp`;
    // One canonical replacement persists state and its event together. Cleanup
    // owns only our unique temporary file; the previous canonical file is never
    // unlinked before replacement. All supported real writers share the lock.
    // Snapshot values may share in-memory references with the live record.
    // Emit value copies: sorted YAML aliases can otherwise precede their anchors,
    // and content identity is a JSON value identity, not object-reference identity.
    try {
      await writeFile(
        temp,
        stringify(proposal, { sortMapEntries: true, aliasDuplicateObjects: false }),
        { flag: 'wx' },
      );
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
    return event;
  });
};
