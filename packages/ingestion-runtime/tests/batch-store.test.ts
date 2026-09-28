import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileIngestionBatchStore, type IngestionBatch } from '../src/index.js';

const temporaryRoots: string[] = [];
const root = async (): Promise<string> => {
  const value = await mkdtemp(join(tmpdir(), 'expedition-batch-store-'));
  temporaryRoots.push(value);
  return value;
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((value) => rm(value, { recursive: true, force: true })),
  );
});

const batch = (jobIds: readonly string[]): IngestionBatch => ({
  schema_version: '1.0',
  id: randomUUID(),
  created_at: '2026-09-28T00:00:00.000Z',
  updated_at: '2026-09-28T00:00:00.000Z',
  job_ids: jobIds,
  requested_count: jobIds.length,
});

describe('file ingestion batch store', () => {
  it('accepts 50 durable child jobs and rejects 51', async () => {
    const store = new FileIngestionBatchStore(await root());
    const fifty = batch(Array.from({ length: 50 }, () => randomUUID()));
    await store.create(fifty);
    await expect(store.load(fifty.id)).resolves.toEqual(fifty);

    await expect(
      store.create(batch(Array.from({ length: 51 }, () => randomUUID()))),
    ).rejects.toThrow('Invalid batch schema or state');
  });

  it('rejects duplicate child IDs without deduplicating the record', async () => {
    const store = new FileIngestionBatchStore(await root());
    const duplicateId = randomUUID();
    const duplicateBatch = batch([duplicateId, duplicateId]);

    await expect(store.create(duplicateBatch)).rejects.toThrow('Invalid batch schema or state');
  });

  it('rejects checksum corruption when loading a durable record', async () => {
    const storageRoot = await root();
    const store = new FileIngestionBatchStore(storageRoot);
    const record = batch([randomUUID()]);
    await store.create(record);
    const path = join(storageRoot, `${record.id}.json`);
    const envelope = JSON.parse(await readFile(path, 'utf8')) as { digest: string };
    envelope.digest = '0'.repeat(64);
    await writeFile(path, `${JSON.stringify(envelope)}\n`, 'utf8');

    await expect(store.load(record.id)).rejects.toThrow('checksum mismatch');
  });

  it('prevents membership changes and reordering on save', async () => {
    const store = new FileIngestionBatchStore(await root());
    const record = batch([randomUUID(), randomUUID()]);
    await store.create(record);

    await expect(
      store.save({ ...record, job_ids: [...record.job_ids, randomUUID()], requested_count: 3 }),
    ).rejects.toThrow('Batch child job IDs are immutable');
    await expect(store.save({ ...record, job_ids: [...record.job_ids].reverse() })).rejects.toThrow(
      'Batch child job ordering is immutable',
    );
  });

  it('lists and reloads only durable batch records after store reconstruction', async () => {
    const storageRoot = await root();
    const first = batch([randomUUID()]);
    const second = batch([randomUUID(), randomUUID()]);
    await new FileIngestionBatchStore(storageRoot).create(first);
    await new FileIngestionBatchStore(storageRoot).create(second);

    const restartedStore = new FileIngestionBatchStore(storageRoot);
    await expect(restartedStore.load(first.id)).resolves.toEqual(first);
    await expect(restartedStore.list()).resolves.toEqual(
      [first, second].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });
});
