import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deserializeJob, serializeJob } from './codec.js';
import type { IngestionJob } from './job-service.js';
import { replaceJobRecord } from './file-replacement.js';

export interface IngestionJobStore {
  create(job: IngestionJob): Promise<void>;
  load(id: string): Promise<IngestionJob>;
  save(job: IngestionJob): Promise<void>;
  listJobIds?(): Promise<readonly string[]>;
}

const validId = (id: string): boolean => /^[0-9a-f-]{36}$/.test(id);
const encodeRecord = (job: IngestionJob): string => {
  const payload = serializeJob(job);
  const digest = createHash('sha256').update(payload).digest('hex');
  return JSON.stringify({ digest, payload }) + '\n';
};
const decodeRecord = (raw: string): unknown => {
  const envelope = JSON.parse(raw) as { digest?: unknown; payload?: unknown };
  if (
    typeof envelope?.digest !== 'string' ||
    typeof envelope.payload !== 'string' ||
    createHash('sha256').update(envelope.payload).digest('hex') !== envelope.digest
  )
    throw new Error('Job record checksum mismatch.');
  return deserializeJob(envelope.payload);
};
const states = new Set([
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
    let raw: string;
    try {
      raw = await readFile(this.path(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error(`Unknown ingestion job ID: ${id}`);
      throw error;
    }
    try {
      const value = decodeRecord(raw);
      if (!validJob(value, id)) throw new Error('Invalid job schema or state.');
      return value;
    } catch (error) {
      throw new Error(`Corrupt ingestion job ${id}: ${(error as Error).message}`);
    }
  }

  async save(job: IngestionJob): Promise<void> {
    await this.load(job.id);
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
  }
}
