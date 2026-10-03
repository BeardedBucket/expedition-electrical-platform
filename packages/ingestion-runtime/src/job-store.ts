import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deserializeJob, serializeJob } from './codec.js';
import type { IngestionJob } from './job-service.js';
import { replaceJobRecord } from './file-replacement.js';
import { isPreparationRecoveryEligible } from './preparation-recovery.js';
import { DEFER_REASONS, isResumedPreparationRecoveryEligible } from './product-review-lifecycle.js';
import {
  artifactDigest,
  assertAcceptedSourceResolution,
  validateProductIntake,
  validateProductionArtifactSchema,
  reviewPackageSnapshot,
  validateProductionApproval,
  approvalMatchesReviewPackage,
  type ReviewedSemanticDecision,
} from '@expedition/ingestion';

export interface IngestionJobStore {
  create(job: IngestionJob): Promise<void>;
  load(id: string): Promise<IngestionJob>;
  loadVersioned(id: string): Promise<VersionedIngestionJob>;
  save(job: IngestionJob, expectedVersion: string): Promise<string>;
  listJobIds?(): Promise<readonly string[]>;
}

export interface VersionedIngestionJob {
  readonly job: IngestionJob;
  readonly version: string;
}

export class JobStoreConflictError extends Error {
  readonly status = 409;
}

const validId = (id: string): boolean => /^[0-9a-f-]{36}$/.test(id);
const encodeRecord = (job: IngestionJob): string => {
  const payload = serializeJob(job);
  const digest = createHash('sha256').update(payload).digest('hex');
  return JSON.stringify({ digest, payload }) + '\n';
};
const decodeRecord = (raw: string): { readonly value: unknown; readonly version: string } => {
  const envelope = JSON.parse(raw) as { digest?: unknown; payload?: unknown };
  if (
    typeof envelope?.digest !== 'string' ||
    typeof envelope.payload !== 'string' ||
    createHash('sha256').update(envelope.payload).digest('hex') !== envelope.digest
  )
    throw new Error('Job record checksum mismatch.');
  return { value: deserializeJob(envelope.payload), version: envelope.digest };
};
const states = new Set([
  'source_resolution_required',
  'source_resolution_review',
  'created',
  'preparing',
  'review_ready',
  'preparation_failed',
  'approved',
  'review_rejected',
  'review_deferred',
  'finalizing',
  'finalized',
  'finalization_failed',
]);
const validJob = (value: unknown, id: string): value is IngestionJob => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as Partial<IngestionJob>;
  if (
    job.schema_version !== '1.0' ||
    job.id !== id ||
    typeof job.state !== 'string' ||
    !states.has(job.state) ||
    typeof job.created_at !== 'string' ||
    typeof job.updated_at !== 'string' ||
    !job.intake ||
    job.intake.artifact_kind !== 'product_intake'
  )
    return false;
  if (validateProductIntake(job.intake).length) return false;
  const attempts = job.source_resolution_attempts ?? [];
  if (!Array.isArray(attempts)) return false;
  try {
    if (
      job.preparation_recovery_history !== undefined &&
      !Array.isArray(job.preparation_recovery_history)
    )
      return false;
    for (const [index, recovery] of (job.preparation_recovery_history ?? []).entries()) {
      if (
        !recovery ||
        typeof recovery.requested_at !== 'string' ||
        !Number.isFinite(Date.parse(recovery.requested_at)) ||
        recovery.method !== 'local_operator' ||
        recovery.preparation?.status !== 'review_ready' ||
        artifactDigest(recovery.preparation.intake) !== artifactDigest(job.intake) ||
        (!isPreparationRecoveryEligible({
          ...job,
          state: 'review_ready',
          preparation: recovery.preparation,
          approval: undefined,
          finalization_request: undefined,
          final_result: undefined,
        }) &&
          !(job.product_review_history ?? []).some(
            (event) =>
              event.action === 'resumed' &&
              event.preparation_history_count === index &&
              event.review_snapshot === recovery.previous_review_snapshot,
          )) ||
        recovery.previous_review_snapshot !==
          reviewPackageSnapshot(recovery.preparation.review_package)
      )
        return false;
    }
    if (job.product_review_history !== undefined && !Array.isArray(job.product_review_history))
      return false;
    for (const [index, event] of (job.product_review_history ?? []).entries()) {
      if (event.revision !== index + 1) return false;
      if (event.action === 'deferred') {
        if (
          event.approval?.decision !== 'deferred' ||
          validateProductionApproval(event.approval).length ||
          (event.reason !== undefined && !DEFER_REASONS.includes(event.reason)) ||
          (index > 0 && job.product_review_history![index - 1].action !== 'resumed')
        )
          return false;
      } else if (event.action === 'resumed') {
        const prior = job.product_review_history![index - 1];
        if (
          prior?.action !== 'deferred' ||
          !event.actor_label?.trim() ||
          !Number.isFinite(Date.parse(event.recorded_at)) ||
          event.review_snapshot !== prior.approval.review_package_snapshot ||
          !Number.isSafeInteger(event.preparation_history_count) ||
          event.preparation_history_count < 0 ||
          event.preparation_history_count > (job.preparation_recovery_history?.length ?? 0)
        )
          return false;
      } else return false;
    }
    if (new Set(attempts.map((item) => item.resolution.attempt_id)).size !== attempts.length)
      return false;
    for (const { resolution, capture } of attempts) {
      if (
        validateProductionArtifactSchema(resolution).length ||
        validateProductionArtifactSchema(capture).length ||
        resolution.intake.digest !== artifactDigest(job.intake) ||
        resolution.capture.digest !== artifactDigest(capture) ||
        resolution.id !== resolution.attempt_id ||
        resolution.manufacturer !== job.intake.manufacturer ||
        resolution.product_model !== job.intake.product_model ||
        resolution.manufacturer_part_number !== job.intake.manufacturer_part_number ||
        resolution.normalized_uri !== capture.requested_uri ||
        resolution.final_uri !== capture.final_uri
      )
        return false;
    }
    const pending = attempts.filter((item) => item.resolution.disposition === 'pending');
    const accepted = attempts.filter((item) => item.resolution.disposition === 'accepted');
    const recoveries = job.source_resolution_recovery_history ?? [];
    if (!Array.isArray(recoveries)) return false;
    for (const recovery of recoveries) {
      const previousResolution = accepted.find(
        ({ resolution }) =>
          artifactDigest(resolution) === recovery.previous_source_resolution?.digest,
      )?.resolution;
      if (
        typeof recovery.requested_at !== 'string' ||
        recovery.method !== 'local_operator' ||
        recovery.previous_source_resolution.kind !== 'source_resolution' ||
        !previousResolution ||
        recovery.preparation.status !== 'preparation_failed' ||
        recovery.preparation.reason !== 'acquisition_failed' ||
        recovery.preparation.acquisition.status !== 'seed_failed' ||
        artifactDigest(recovery.preparation.intake) !== artifactDigest(job.intake) ||
        recovery.preparation.source_resolution?.id !== previousResolution.id ||
        artifactDigest(recovery.preparation.source_resolution) !==
          recovery.previous_source_resolution.digest
      )
        return false;
    }
    if (job.intake.official_product_uri && (attempts.length || job.accepted_source_resolution))
      return false;
    if (
      job.state === 'source_resolution_required' &&
      (job.intake.official_product_uri ||
        pending.length ||
        (accepted.length > 0 && !recoveries.length) ||
        (!accepted.length && job.accepted_source_resolution) ||
        job.active_source_resolution)
    )
      return false;
    if (
      job.state === 'source_resolution_review' &&
      (job.intake.official_product_uri ||
        pending.length !== 1 ||
        (accepted.length > 0 && !recoveries.length) ||
        (!accepted.length && job.accepted_source_resolution) ||
        job.active_source_resolution)
    )
      return false;
    if (
      !['source_resolution_required', 'source_resolution_review'].includes(job.state) &&
      !job.intake.official_product_uri
    ) {
      if (
        !accepted.length ||
        pending.length ||
        job.accepted_source_resolution?.kind !== 'source_resolution' ||
        !accepted.some(
          ({ resolution }) => artifactDigest(resolution) === job.accepted_source_resolution?.digest,
        )
      )
        return false;
      const activeReference =
        job.active_source_resolution ??
        (recoveries.length ? undefined : job.accepted_source_resolution);
      const activeResolution = accepted.find(
        ({ resolution }) => artifactDigest(resolution) === activeReference?.digest,
      )?.resolution;
      if (!activeResolution) return false;
      assertAcceptedSourceResolution(job.intake, activeResolution);
    }
    for (const { resolution } of accepted) assertAcceptedSourceResolution(job.intake, resolution);
    if (job.active_source_resolution) {
      const active = accepted.find(
        ({ resolution }) => artifactDigest(resolution) === job.active_source_resolution?.digest,
      )?.resolution;
      if (job.active_source_resolution.kind !== 'source_resolution' || !active) return false;
      assertAcceptedSourceResolution(job.intake, active);
    }
    if (job.preparation) {
      if (artifactDigest(job.preparation.intake) !== artifactDigest(job.intake)) return false;
      if (
        (job.active_source_resolution ?? job.accepted_source_resolution)?.digest !==
        (job.preparation.source_resolution
          ? artifactDigest(job.preparation.source_resolution)
          : undefined)
      )
        return false;
      if (
        job.preparation.status === 'review_ready' &&
        job.preparation.review_package.source_resolution?.digest !==
          (job.active_source_resolution ?? job.accepted_source_resolution)?.digest
      )
        return false;
    }
  } catch {
    return false;
  }
  if (
    [
      'review_ready',
      'approved',
      'review_rejected',
      'review_deferred',
      'finalizing',
      'finalized',
      'finalization_failed',
    ].includes(job.state) &&
    job.preparation?.status !== 'review_ready'
  )
    return false;
  if (
    job.state === 'preparation_failed' &&
    job.preparation?.status !== 'preparation_failed' &&
    !job.error
  )
    return false;
  if (
    [
      'approved',
      'review_rejected',
      'review_deferred',
      'finalizing',
      'finalized',
      'finalization_failed',
    ].includes(job.state) &&
    !job.approval
  )
    return false;
  if (job.state === 'review_rejected' && job.approval?.decision !== 'rejected') return false;
  if (job.state === 'review_deferred' && job.approval?.decision !== 'deferred') return false;
  if (job.state === 'review_deferred' && job.product_review_history?.length) {
    const last = job.product_review_history.at(-1);
    if (last?.action !== 'deferred' || serializeJob(last.approval) !== serializeJob(job.approval))
      return false;
  }
  if (
    ['approved', 'finalizing', 'finalized', 'finalization_failed'].includes(job.state) &&
    job.approval?.decision !== 'approved'
  )
    return false;
  if (
    ['finalizing', 'finalized', 'finalization_failed'].includes(job.state) &&
    (!job.finalization_request ||
      typeof job.finalization_request.requested_at !== 'string' ||
      !job.finalization_request.write_request ||
      typeof job.finalization_request.write_request.destinationRoot !== 'string')
  )
    return false;
  if (job.state === 'finalized' && !job.final_result) return false;
  return true;
};

const reviewedSemanticDecisionHistory = (
  job: IngestionJob,
): readonly ReviewedSemanticDecision[] => [
  ...(job.preparation_recovery_history ?? []).flatMap(
    (entry) => entry.preparation.bridge.reviewed_semantic_decisions ?? [],
  ),
  ...(job.preparation?.status === 'review_ready'
    ? (job.preparation.bridge.reviewed_semantic_decisions ?? [])
    : []),
];

export class FileIngestionJobStore implements IngestionJobStore {
  readonly root: string;
  constructor(root: string) {
    if (!root) throw new Error('Job storage root is required.');
    this.root = resolve(root);
  }

  private path(id: string): string {
    if (!validId(id)) throw new Error(`Invalid ingestion job ID: ${id}`);
    return join(this.root, `${id}.json`);
  }

  private lockPath(id: string): string {
    this.path(id);
    return join(this.root, `.${id}.lock`);
  }

  async listJobIds(): Promise<readonly string[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.slice(0, -5))
        .filter(validId)
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async create(job: IngestionJob): Promise<void> {
    if (!validJob(job, job.id)) throw new Error('Invalid job schema or state.');
    const path = this.path(job.id);
    await mkdir(this.root, { recursive: true });
    const file = await open(path, 'wx');
    try {
      await file.writeFile(encodeRecord(job), 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
  }

  async load(id: string): Promise<IngestionJob> {
    return (await this.loadVersioned(id)).job;
  }

  async loadVersioned(id: string): Promise<VersionedIngestionJob> {
    let raw: string;
    try {
      raw = await readFile(this.path(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error(`Unknown ingestion job ID: ${id}`);
      throw error;
    }
    try {
      const { value, version } = decodeRecord(raw);
      if (!validJob(value, id)) throw new Error('Invalid job schema or state.');
      return { job: value, version };
    } catch (error) {
      throw new Error(`Corrupt ingestion job ${id}: ${(error as Error).message}`);
    }
  }

  async save(job: IngestionJob, expectedVersion: string): Promise<string> {
    if (!validJob(job, job.id)) throw new Error('Invalid job schema or state.');
    await mkdir(this.root, { recursive: true });
    let lock;
    try {
      lock = await open(this.lockPath(job.id), 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new JobStoreConflictError(`Ingestion job ${job.id} is being updated.`);
      throw error;
    }
    try {
      // Never steal an existing lock: a crashed writer fails closed until an
      // operator verifies the process is gone and removes its orphaned lock.
      const previous = await this.loadVersioned(job.id);
      if (previous.version !== expectedVersion)
        throw new JobStoreConflictError(
          `Ingestion job ${job.id} changed since it was loaded; reload before updating.`,
        );
      const oldEvents = previous.job.product_review_history ?? [];
      const events = job.product_review_history ?? [];
      if (
        oldEvents.length > events.length ||
        oldEvents.some((event, index) => serializeJob(event) !== serializeJob(events[index]))
      )
        throw new Error('Product review history is immutable and append-only.');
      const addedEvents = events.slice(oldEvents.length);
      const lifecyclePayload = (value: IngestionJob) =>
        serializeJob({
          ...value,
          state: undefined,
          updated_at: undefined,
          approval: undefined,
          product_review_history: undefined,
        });
      if (addedEvents.length) {
        const last = events.at(-1)!;
        if (last.action === 'deferred') {
          if (
            addedEvents.length !== 1 ||
            previous.job.state !== 'review_ready' ||
            job.state !== 'review_deferred' ||
            previous.job.approval ||
            job.finalization_request ||
            job.final_result ||
            previous.job.preparation?.status !== 'review_ready' ||
            !approvalMatchesReviewPackage(last.approval, previous.job.preparation.review_package) ||
            !last.approval.reviewed_decisions?.some((rationale) => rationale.trim()) ||
            lifecyclePayload(previous.job) !== lifecyclePayload(job)
          )
            throw new Error('Deferral must preserve the exact current review.');
        } else {
          const legacy = !oldEvents.length;
          if (
            addedEvents.length !== (legacy ? 2 : 1) ||
            (legacy &&
              (addedEvents[0].action !== 'deferred' ||
                serializeJob(addedEvents[0].approval) !== serializeJob(previous.job.approval))) ||
            previous.job.state !== 'review_deferred' ||
            job.state !== 'review_ready' ||
            previous.job.preparation?.status !== 'review_ready' ||
            previous.job.approval?.decision !== 'deferred' ||
            job.approval ||
            previous.job.finalization_request ||
            previous.job.final_result ||
            last.review_snapshot !==
              reviewPackageSnapshot(previous.job.preparation.review_package) ||
            last.preparation_history_count !==
              (previous.job.preparation_recovery_history?.length ?? 0) ||
            lifecyclePayload(previous.job) !== lifecyclePayload(job)
          )
            throw new Error('Resume must preserve the exact deferred review.');
        }
      } else if (
        (previous.job.state === 'review_deferred' &&
          serializeJob(previous.job) !== serializeJob(job)) ||
        (previous.job.state !== 'review_deferred' && job.state === 'review_deferred')
      )
        throw new Error('Deferral and resume require append-only product review events.');
      if (previous.job.state === 'review_rejected' && job.state !== 'review_rejected')
        throw new Error('Rejected product reviews are terminal.');
      const previousDecisions = reviewedSemanticDecisionHistory(previous.job);
      const nextDecisions = reviewedSemanticDecisionHistory(job);
      if (
        previousDecisions.length > nextDecisions.length ||
        previousDecisions.some(
          (decision, index) => artifactDigest(decision) !== artifactDigest(nextDecisions[index]),
        )
      )
        throw new Error('Reviewed semantic decision history is immutable and append-only.');
      if (artifactDigest(previous.job.intake) !== artifactDigest(job.intake))
        throw new Error('Original product intake is immutable.');
      const previousPreparations = previous.job.preparation_recovery_history ?? [];
      const nextPreparations = job.preparation_recovery_history ?? [];
      if (
        previousPreparations.length > nextPreparations.length ||
        previousPreparations.some(
          (entry, index) => serializeJob(entry) !== serializeJob(nextPreparations[index]),
        )
      )
        throw new Error('Preparation recovery history is immutable and append-only.');
      if (nextPreparations.length > previousPreparations.length) {
        const entry = nextPreparations[previousPreparations.length];
        if (
          nextPreparations.length !== previousPreparations.length + 1 ||
          (!isPreparationRecoveryEligible(previous.job) &&
            !isResumedPreparationRecoveryEligible(previous.job)) ||
          serializeJob(entry.preparation) !== serializeJob(previous.job.preparation) ||
          entry.previous_review_snapshot !==
            reviewPackageSnapshot(entry.preparation.review_package) ||
          job.state !== 'created' ||
          job.preparation !== undefined ||
          job.approval ||
          job.finalization_request ||
          job.final_result
        )
          throw new Error('Preparation recovery is not valid for the current job state.');
      } else if (
        previous.job.preparation &&
        !job.preparation &&
        (job.source_resolution_recovery_history?.length ?? 0) ===
          (previous.job.source_resolution_recovery_history?.length ?? 0)
      )
        throw new Error('Clearing preparation requires an append-only recovery record.');
      const previousRecoveries = previous.job.source_resolution_recovery_history ?? [];
      const nextRecoveries = job.source_resolution_recovery_history ?? [];
      if (
        previousRecoveries.length > nextRecoveries.length ||
        previousRecoveries.some(
          (recovery, index) => serializeJob(recovery) !== serializeJob(nextRecoveries[index]),
        )
      )
        throw new Error('Source-resolution recovery history is immutable and append-only.');
      if (nextRecoveries.length > previousRecoveries.length) {
        const previousSource =
          previous.job.active_source_resolution ??
          (previousRecoveries.length ? undefined : previous.job.accepted_source_resolution);
        const recovery = nextRecoveries[previousRecoveries.length];
        if (
          nextRecoveries.length !== previousRecoveries.length + 1 ||
          previous.job.state !== 'preparation_failed' ||
          previous.job.preparation?.status !== 'preparation_failed' ||
          previous.job.preparation.reason !== 'acquisition_failed' ||
          previous.job.preparation.acquisition.status !== 'seed_failed' ||
          !previousSource ||
          previousSource.kind !== 'source_resolution' ||
          recovery.previous_source_resolution.digest !== previousSource.digest ||
          serializeJob(recovery.preparation) !== serializeJob(previous.job.preparation) ||
          job.state !== 'source_resolution_required' ||
          job.preparation !== undefined ||
          job.active_source_resolution !== undefined
        )
          throw new Error('Source-selection recovery is not valid for the current job state.');
      }
      const attempts = job.source_resolution_attempts ?? [];
      for (const old of previous.job.source_resolution_attempts ?? []) {
        const next = attempts.find(
          (item) => item.resolution.attempt_id === old.resolution.attempt_id,
        );
        if (
          !next ||
          artifactDigest(old.capture) !== artifactDigest(next.capture) ||
          (old.resolution.disposition !== 'pending' &&
            artifactDigest(old.resolution) !== artifactDigest(next.resolution)) ||
          artifactDigest({ ...old.resolution, disposition: 'pending', review: undefined }) !==
            artifactDigest({ ...next.resolution, disposition: 'pending', review: undefined })
        )
          throw new Error('Source resolution history is immutable.');
      }
      if (
        previous.job.accepted_source_resolution &&
        artifactDigest(previous.job.accepted_source_resolution) !==
          artifactDigest(job.accepted_source_resolution)
      )
        throw new Error('Accepted source resolution is immutable.');
      if (nextRecoveries.length === previousRecoveries.length) {
        const previousActive =
          previous.job.active_source_resolution ??
          (previousRecoveries.length ? undefined : previous.job.accepted_source_resolution);
        const nextActive =
          job.active_source_resolution ??
          (nextRecoveries.length ? undefined : job.accepted_source_resolution);
        if (
          previousActive?.digest !== nextActive?.digest &&
          (!nextActive ||
            previous.job.state !== 'source_resolution_review' ||
            !(job.source_resolution_attempts ?? []).some(
              ({ resolution }) =>
                resolution.disposition === 'accepted' &&
                artifactDigest(resolution) === nextActive.digest &&
                (previous.job.source_resolution_attempts ?? []).some(
                  (old) =>
                    old.resolution.attempt_id === resolution.attempt_id &&
                    old.resolution.disposition === 'pending',
                ),
            ))
        )
          throw new Error(
            'The active source can change only through source acceptance or recovery.',
          );
      }
      return await this.writeReplacement(job);
    } finally {
      try {
        await lock.close();
      } finally {
        await rm(this.lockPath(job.id), { force: true });
      }
    }
  }

  private async writeReplacement(job: IngestionJob): Promise<string> {
    const payload = serializeJob(job);
    const temporary = join(this.root, `.${job.id}.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx');
      try {
        await file.writeFile(encodeRecord(job), 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await replaceJobRecord(temporary, this.path(job.id));
    } finally {
      await rm(temporary, { force: true });
    }
    return createHash('sha256').update(payload).digest('hex');
  }
}
