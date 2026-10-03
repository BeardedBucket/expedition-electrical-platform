import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MAX_INGESTION_BATCH_SIZE } from './batch-contract.js';
import { deserializeJob, serializeJob } from './codec.js';
import { replaceJobRecord } from './file-replacement.js';

export interface IngestionBatch {
  readonly schema_version: '1.0';
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly job_ids: readonly string[];
  readonly requested_count: number;
}

export interface IngestionBatchStore {
  create(batch: IngestionBatch): Promise<void>;
  load(id: string): Promise<IngestionBatch>;
  save(batch: IngestionBatch): Promise<void>;
  list(): Promise<readonly IngestionBatch[]>;
}

const validId = (id: string): boolean => /^[0-9a-f-]{36}$/.test(id);
const encodeRecord = (batch: IngestionBatch): string => {
  const payload = serializeJob(batch);
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
    throw new Error('Batch record checksum mismatch.');
  return deserializeJob(envelope.payload);
};
const validBatch = (value: unknown, id: string): value is IngestionBatch => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const batch = value as Partial<IngestionBatch>;
  if (
    batch.schema_version !== '1.0' ||
    batch.id !== id ||
    typeof batch.created_at !== 'string' ||
    typeof batch.updated_at !== 'string' ||
    !Array.isArray(batch.job_ids) ||
    typeof batch.requested_count !== 'number' ||
    !Number.isInteger(batch.requested_count)
  )
    return false;
  if (batch.job_ids.length !== batch.requested_count) return false;
  if (batch.job_ids.length === 0) return false;
  if (batch.job_ids.length > MAX_INGESTION_BATCH_SIZE) return false;
  if (batch.job_ids.some((entry) => typeof entry !== 'string' || !validId(entry))) return false;
  if (new Set(batch.job_ids).size !== batch.job_ids.length) return false;
  return true;
};

export class FileIngestionBatchStore implements IngestionBatchStore {
  readonly root: string;

  constructor(root: string) {
    if (!root) throw new Error('Batch storage root is required.');
    this.root = resolve(root);
  }

  private path(id: string): string {
    if (!validId(id)) throw new Error(`Invalid ingestion batch ID: ${id}`);
    return join(this.root, `${id}.json`);
  }

  async list(): Promise<readonly IngestionBatch[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      const ids = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.slice(0, -5))
        .filter(validId)
        .sort();
      return Promise.all(ids.map((id) => this.load(id)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async create(batch: IngestionBatch): Promise<void> {
    if (!validBatch(batch, batch.id)) throw new Error('Invalid batch schema or state.');
    const path = this.path(batch.id);
    await mkdir(this.root, { recursive: true });
    const file = await open(path, 'wx');
    try {
      await file.writeFile(encodeRecord(batch), 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
  }

  async load(id: string): Promise<IngestionBatch> {
    let raw: string;
    try {
      raw = await readFile(this.path(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error(`Unknown ingestion batch ID: ${id}`);
      throw error;
    }
    try {
      const value = decodeRecord(raw);
      if (!validBatch(value, id)) throw new Error('Invalid batch schema or state.');
      return value;
    } catch (error) {
      throw new Error(`Corrupt ingestion batch ${id}: ${(error as Error).message}`);
    }
  }

  async save(batch: IngestionBatch): Promise<void> {
    const previous = await this.load(batch.id);
    if (!validBatch(batch, batch.id)) throw new Error('Invalid batch schema or state.');
    if (previous.job_ids.length !== batch.job_ids.length)
      throw new Error('Batch child job IDs are immutable after creation.');
    if (previous.job_ids.some((entry, index) => entry !== batch.job_ids[index]))
      throw new Error('Batch child job ordering is immutable after creation.');
    const temporary = join(this.root, `.${batch.id}.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx');
      try {
        await file.writeFile(encodeRecord(batch), 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await replaceJobRecord(temporary, this.path(batch.id));
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
