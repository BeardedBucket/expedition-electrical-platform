import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deserializeJob, serializeJob } from './codec.js';
import type { IngestionJob } from './job-service.js';
import { replaceJobRecord } from './file-replacement.js';
import {
  artifactDigest,
  assertAcceptedSourceResolution,
  validateProductIntake,
  validateProductionArtifactSchema,
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
    if (job.intake.official_product_uri && (attempts.length || job.accepted_source_resolution))
      return false;
    if (
      job.state === 'source_resolution_required' &&
      (job.intake.official_product_uri ||
        pending.length ||
        accepted.length ||
        job.accepted_source_resolution)
    )
      return false;
    if (
      job.state === 'source_resolution_review' &&
      (job.intake.official_product_uri ||
        pending.length !== 1 ||
        accepted.length ||
        job.accepted_source_resolution)
    )
      return false;
    if (
      !['source_resolution_required', 'source_resolution_review'].includes(job.state) &&
      !job.intake.official_product_uri
    ) {
      if (
        accepted.length !== 1 ||
        pending.length ||
        job.accepted_source_resolution?.kind !== 'source_resolution' ||
        job.accepted_source_resolution.digest !== artifactDigest(accepted[0].resolution) ||
        accepted[0].capture.disposition !== 'authoritative'
      )
        return false;
      assertAcceptedSourceResolution(job.intake, accepted[0].resolution);
    }
    if (job.preparation) {
      if (artifactDigest(job.preparation.intake) !== artifactDigest(job.intake)) return false;
      if (
        job.accepted_source_resolution?.digest !==
        (job.preparation.source_resolution
          ? artifactDigest(job.preparation.source_resolution)
          : undefined)
      )
        return false;
      if (
        job.preparation.status === 'review_ready' &&
        job.preparation.review_package.source_resolution?.digest !==
          job.accepted_source_resolution?.digest
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

const reviewedSemanticDecisionHistory = (job: IngestionJob): readonly ReviewedSemanticDecision[] =>
  job.preparation?.status === 'review_ready'
    ? (job.preparation.bridge.reviewed_semantic_decisions ?? [])
    : [];

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
