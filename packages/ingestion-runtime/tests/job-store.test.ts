// @vitest-environment node
import { mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileIngestionJobStore } from '../src/job-store.js';
import type { IngestionJob } from '../src/job-service.js';
import * as replacement from '../src/file-replacement.js';

const replaceJobRecord = replacement.replaceJobRecord;
const roots: string[] = [];
const job: IngestionJob = {
  schema_version: '1.0',
  id: '11111111-1111-1111-1111-111111111111',
  created_at: '2026-09-27T00:00:00.000Z',
  updated_at: '2026-09-27T00:00:00.000Z',
  state: 'created',
  intake: {
    schema_version: '1.0',
    artifact_kind: 'product_intake',
    id: 'intake.test',
    manufacturer: 'Example',
    product_model: 'Example Model',
    manufacturer_part_number: 'EX-1',
    official_product_uri: 'https://example.test/product',
  },
};
const nextJob: IngestionJob = {
  ...job,
  state: 'preparing',
  updated_at: '2026-09-27T00:00:01.000Z',
};
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'job-store-replacement-'));
  roots.push(root);
  const store = new FileIngestionJobStore(root);
  await store.create(job);
  const destination = join(root, `${job.id}.json`);
  const original = await readFile(destination, 'utf8');
  return { root, store, destination, original };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('job-store atomic replacement and cleanup', () => {
  it('keeps the old valid record throughout contention, installs the exact new record, and cleans the temp file', async () => {
    const { root, store, destination, original } = await setup();
    const delay = vi.fn(async () => {
      expect(await readFile(destination, 'utf8')).toBe(original);
      expect(await store.load(job.id)).toEqual(job);
    });
    let attempts = 0;
    let temporaryPath: string | undefined;
    const replace = vi.fn(async (temporary: string, target: string) => {
      temporaryPath ??= temporary;
      expect(temporary).toBe(temporaryPath);
      expect(target).toBe(destination);
      expect(await readFile(destination, 'utf8')).toBe(original);
      expect(await store.load(job.id)).toEqual(job);
      expect(await readFile(temporary, 'utf8')).not.toBe(original);
      if (++attempts < 3)
        throw Object.assign(new Error('Transient replacement contention'), { code: 'EPERM' });
      await rename(temporary, target);
    });
    vi.spyOn(replacement, 'replaceJobRecord').mockImplementation((temporary, target) =>
      replaceJobRecord(temporary, target, { rename: replace, delay }),
    );
    await store.save(nextJob);
    expect(replace).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls).toHaveLength(2);
    expect(await new FileIngestionJobStore(root).load(job.id)).toEqual(nextJob);
    expect(await readdir(root)).toEqual([`${job.id}.json`]);
  });

  it('exhausts transient retries, preserves the prior record, and cleans the temp file', async () => {
    const { root, store, destination, original } = await setup();
    const error = Object.assign(new Error('EPERM: operation not permitted, rename'), {
      code: 'EPERM',
    });
    const replace = vi.fn(async (temporary: string, target: string) => {
      expect(target).toBe(destination);
      expect(await readFile(destination, 'utf8')).toBe(original);
      expect(await store.load(job.id)).toEqual(job);
      expect(await readFile(temporary, 'utf8')).not.toBe(original);
      throw error;
    });
    const delay = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(replacement, 'replaceJobRecord').mockImplementation((temporary, target) =>
      replaceJobRecord(temporary, target, { rename: replace, delay }),
    );
    await expect(store.save(nextJob)).rejects.toBe(error);
    expect(replace).toHaveBeenCalledTimes(5);
    expect(delay.mock.calls).toEqual([[25], [50], [100], [150]]);
    expect(await readFile(destination, 'utf8')).toBe(original);
    expect(await new FileIngestionJobStore(root).load(job.id)).toEqual(job);
    expect(await readdir(root)).toEqual([`${job.id}.json`]);
  });

  it('leaves exclusive initial creation unchanged and does not invoke replacement for a collision', async () => {
    const { root, store } = await setup();
    const replace = vi.spyOn(replacement, 'replaceJobRecord');
    await expect(store.create(nextJob)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(replace).not.toHaveBeenCalled();
    expect(await store.load(job.id)).toEqual(job);
    expect(await readdir(root)).toEqual([`${job.id}.json`]);
  });
});
