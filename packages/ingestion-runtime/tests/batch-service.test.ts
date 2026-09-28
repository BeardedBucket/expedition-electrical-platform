import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRODUCTION_SCHEMA_VERSION,
  prepareProductionIngestReview,
  type ProductIntake,
  type ReviewReadyProductionIngest,
  type SourceCaptureAdapter,
} from '@expedition/ingestion';
import {
  FileIngestionBatchStore,
  FileIngestionJobStore,
  IngestionBatchService,
  IngestionJobService,
  type IngestionJob,
} from '../src/index.js';

const intake = (suffix: string): ProductIntake => ({
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: `intake.${suffix}`,
  manufacturer: 'Example Manufacturer',
  product_model: `Example Model ${suffix}`,
  manufacturer_part_number: `EX-${suffix}`,
  official_product_uri: `https://example.test/products/${suffix}`,
});

const temporaryRoots: string[] = [];
const root = async (): Promise<string> => {
  const value = await mkdtemp(join(tmpdir(), 'expedition-batch-runtime-'));
  temporaryRoots.push(value);
  return value;
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((value) => rm(value, { recursive: true, force: true })),
  );
});

const makeSimpleBatchService = (
  storageRoot: string,
  jobService: unknown,
  options: { maxBatchSize?: number; now?: () => string } = {},
) =>
  new IngestionBatchService({
    store: new FileIngestionBatchStore(storageRoot),
    jobService: jobService as IngestionJobService,
    ...options,
  });

const makeProductionReady = async (): Promise<ReviewReadyProductionIngest> => {
  const productUri = 'https://example.test/products/ready';
  const documentUri = 'https://example.test/docs/specifications.html';
  const intakeFixture: ProductIntake = {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'product_intake',
    id: 'intake.ready',
    manufacturer: 'Example Manufacturer',
    product_model: 'Example Model Ready',
    manufacturer_part_number: 'EX-READY',
    official_product_uri: productUri,
  };
  const profile = {
    schema_version: '1.2',
    id: 'example.ready.profile',
    profile_status: 'reviewed',
    manufacturer: 'Example Manufacturer',
    publisher: 'Example Manufacturer Publications',
    official_domains: ['example.test'],
    approved_subdomains: ['www.example.test'],
    allowed_document_domains: ['example.test'],
    strategies: [],
    provenance: {
      source_artifact: 'batch-runtime-test',
      observed_source_content_hash: 'sha256:fake',
    },
  } as unknown as Parameters<typeof prepareProductionIngestReview>[0]['profile'];
  const adapter: SourceCaptureAdapter = {
    async capture(request) {
      const html =
        request.uri === documentUri
          ? '<html><body><table><tr><th>Model</th><th>nominal voltage</th><th>continuous current</th></tr><tr><td>Example Model Ready</td><td>24 V</td><td>10 A</td></tr></table></body></html>'
          : `<html><body><h1>Ready</h1><a href="${documentUri}">Specifications</a></body></html>`;
      return {
        status: 'success',
        source: {
          requested_uri: request.uri,
          final_uri: request.uri,
          retrieved_at: '2026-09-08T00:00:00.000Z',
          media_type: 'text/html',
          response_status: 200,
          body: { bytes: new TextEncoder().encode(html), text: html },
          content_hash: `sha256:${randomUUID()}`,
        },
        issues: [],
      };
    },
  };
  const prepared = await prepareProductionIngestReview({
    intake: intakeFixture,
    profile,
    adapter,
    policy: { now: () => '2026-09-08T00:00:00.000Z' },
  });
  if (prepared.status !== 'review_ready')
    throw new Error('Fixture preparation did not become review-ready.');
  return prepared;
};

describe('batch runtime service', () => {
  it('creates and reads a persistent batch in order', async () => {
    const storageRoot = await root();
    const created = new Map<string, IngestionJob>();
    const fakeJobService = {
      createJob: vi.fn(async (input: ProductIntake) => {
        const job = {
          schema_version: '1.0',
          id: randomUUID(),
          created_at: '2026-09-10T00:00:00.000Z',
          updated_at: '2026-09-10T00:00:00.000Z',
          intake: input,
          state: 'created',
        };
        created.set(job.id, job);
        return job;
      }),
      getJob: vi.fn(async (id: string) => {
        const job = created.get(id);
        if (!job) throw new Error(`Unknown job ${id}`);
        return job;
      }),
      prepareJob: vi.fn(async (id: string) => {
        const job = created.get(id);
        if (!job) throw new Error(`Unknown job ${id}`);
        const updated = { ...job, state: 'review_ready', updated_at: '2026-09-10T00:00:01.000Z' };
        created.set(id, updated);
        return updated;
      }),
      listJobs: vi.fn(async () => Array.from(created.values())),
    };

    const batchService = makeSimpleBatchService(storageRoot, fakeJobService);
    const batch = await batchService.createBatch([intake('a'), intake('b')]);

    expect(batch.job_count).toBe(2);
    expect(batch.requested_count).toBe(2);
    expect(batch.job_ids).toHaveLength(2);
    expect(batch.state).toBe('pending');
    expect(batch.jobs.map((job) => job.state)).toEqual(['created', 'created']);

    const reloaded = await batchService.getBatch(batch.id);
    expect(reloaded.id).toBe(batch.id);
    expect(reloaded.job_ids).toEqual(batch.job_ids);
    expect(reloaded.counts.pending).toBe(2);
    expect(reloaded.updated_at).toBe(batch.updated_at);
  });

  it('continues after a failed child without hiding the failure in aggregate state', async () => {
    const storageRoot = await root();
    const created = new Map<string, IngestionJob>();
    const prepareCalls: string[] = [];
    const fakeJobService = {
      createJob: vi.fn(async (input: ProductIntake) => {
        const job = {
          schema_version: '1.0',
          id: randomUUID(),
          created_at: '2026-09-10T00:00:00.000Z',
          updated_at: '2026-09-10T00:00:00.000Z',
          intake: input,
          state: 'created',
        };
        created.set(job.id, job);
        return job;
      }),
      getJob: vi.fn(async (id: string) => {
        const job = created.get(id);
        if (!job) throw new Error(`Unknown job ${id}`);
        return job;
      }),
      prepareJob: vi.fn(async (id: string) => {
        prepareCalls.push(id);
        const job = created.get(id);
        if (!job) throw new Error(`Unknown job ${id}`);
        const updated = job.intake.product_model.endsWith('A')
          ? { ...job, state: 'preparation_failed', updated_at: '2026-09-10T00:00:02.000Z' }
          : { ...job, state: 'review_ready', updated_at: '2026-09-10T00:00:02.000Z' };
        created.set(id, updated);
        return updated;
      }),
      listJobs: vi.fn(async () => Array.from(created.values())),
    };

    const batchService = makeSimpleBatchService(storageRoot, fakeJobService);
    const ingestA = intake('A');
    const ingestB = intake('B');
    const ingestC = intake('C');
    const batch = await batchService.createBatch([ingestA, ingestB, ingestC]);

    const result = await batchService.prepareBatch(batch.id);

    expect(prepareCalls).toEqual(batch.job_ids);
    expect(created.get(batch.job_ids[0]).state).toBe('preparation_failed');
    expect(created.get(batch.job_ids[1]).state).toBe('review_ready');
    expect(created.get(batch.job_ids[2]).state).toBe('review_ready');
    expect(result.counts.preparation_failed).toBe(1);
    expect(result.counts.review_ready).toBe(2);
    expect(result.state).toBe('mixed');
    expect(result.jobs.map((job) => job.state)).toEqual([
      'preparation_failed',
      'review_ready',
      'review_ready',
    ]);
  });

  it('is idempotent for created, review_ready, failed, preparing, approved, and finalized children', async () => {
    const storageRoot = await root();
    const created = new Map<string, IngestionJob>();
    const prepareJob = vi.fn(async (id: string) => {
      const job = created.get(id);
      if (!job) throw new Error(`Unknown job ${id}`);
      const updated = { ...job, state: 'review_ready', updated_at: '2026-09-10T00:00:03.000Z' };
      created.set(id, updated);
      return updated;
    });
    const fakeJobService = {
      createJob: vi.fn(async (input: ProductIntake) => {
        const job = {
          schema_version: '1.0',
          id: randomUUID(),
          created_at: '2026-09-10T00:00:00.000Z',
          updated_at: '2026-09-10T00:00:00.000Z',
          intake: input,
          state: 'created',
        };
        created.set(job.id, job);
        return job;
      }),
      getJob: vi.fn(async (id: string) => {
        const job = created.get(id);
        if (!job) throw new Error(`Unknown job ${id}`);
        return job;
      }),
      prepareJob,
      listJobs: vi.fn(async () => Array.from(created.values())),
    };

    const batchService = makeSimpleBatchService(storageRoot, fakeJobService);
    const batch = await batchService.createBatch([
      intake('created'),
      intake('review'),
      intake('failed'),
      intake('preparing'),
      intake('approved'),
      intake('finalized'),
    ]);
    const [createdId, reviewId, failedId, preparingId, approvedId, finalizedId] = batch.job_ids;
    created.set(reviewId, { ...created.get(reviewId), state: 'review_ready' });
    created.set(failedId, { ...created.get(failedId), state: 'preparation_failed' });
    created.set(preparingId, { ...created.get(preparingId), state: 'preparing' });
    created.set(approvedId, { ...created.get(approvedId), state: 'approved' });
    created.set(finalizedId, { ...created.get(finalizedId), state: 'finalized' });

    const first = await batchService.prepareBatch(batch.id);
    expect(prepareJob).toHaveBeenCalledTimes(1);
    expect(prepareJob.mock.calls[0][0]).toBe(createdId);
    expect(first.job_ids).toEqual(batch.job_ids);
    expect(first.counts.preparation_failed).toBe(1);
    expect(first.counts.review_ready).toBe(2);
    expect(fakeJobService.createJob).toHaveBeenCalledTimes(6);

    const second = await batchService.prepareBatch(batch.id);
    expect(prepareJob).toHaveBeenCalledTimes(1);
    expect(second.job_ids).toEqual(batch.job_ids);
    expect(second.state).toBe('mixed');
    expect(second.jobs.map((job) => job.state)).toEqual([
      'review_ready',
      'review_ready',
      'preparation_failed',
      'preparing',
      'approved',
      'finalized',
    ]);
  });

  it('reconstructs the batch state from durable storage after restart', async () => {
    const storageRoot = await root();
    const jobsRoot = join(storageRoot, 'jobs');
    const batchesRoot = join(storageRoot, 'batches');
    const jobStore = new FileIngestionJobStore(jobsRoot);
    const productionPrepare = vi.fn(
      async (request: Parameters<typeof prepareProductionIngestReview>[0]) => {
        if (request.intake.id.endsWith('restart-failed')) {
          throw new Error('capture unavailable');
        }
        return makeProductionReady();
      },
    );
    const jobRuntime = new IngestionJobService({
      store: jobStore,
      preparationRequest: () => ({
        adapter: {
          async capture() {
            return {
              status: 'success',
              source: {
                requested_uri: 'https://example.test/products/restart',
                final_uri: 'https://example.test/products/restart',
                retrieved_at: '2026-09-10T00:00:00.000Z',
                media_type: 'text/html',
                response_status: 200,
                body: { bytes: new TextEncoder().encode('<html></html>'), text: '<html></html>' },
                content_hash: `sha256:${randomUUID()}`,
              },
              issues: [],
            };
          },
        },
      }),
      prepare: productionPrepare,
      now: () => '2026-09-10T00:00:00.000Z',
    });

    const jobA = await jobRuntime.createJob({
      ...intake('restart-review'),
      official_product_uri: 'https://example.test/products/restart-review',
    });
    const jobB = await jobRuntime.createJob({
      ...intake('restart-failed'),
      official_product_uri: 'https://example.test/products/restart-failed',
    });
    const jobC = await jobRuntime.createJob({
      ...intake('restart-preparing'),
      official_product_uri: 'https://example.test/products/restart-preparing',
    });

    const readyA = await prepareProductionIngestReview({
      intake: jobA.intake,
      profile: {
        schema_version: '1.2',
        id: 'example.restart.review',
        profile_status: 'reviewed',
        manufacturer: 'Example Manufacturer',
        publisher: 'Example Manufacturer Publications',
        official_domains: ['example.test'],
        approved_subdomains: ['www.example.test'],
        allowed_document_domains: ['example.test'],
        strategies: [],
        provenance: {
          source_artifact: 'batch-runtime-test',
          observed_source_content_hash: 'sha256:fake',
        },
      } as unknown as Parameters<typeof prepareProductionIngestReview>[0]['profile'],
      adapter: {
        async capture() {
          return {
            status: 'success',
            source: {
              requested_uri: jobA.intake.official_product_uri!,
              final_uri: jobA.intake.official_product_uri!,
              retrieved_at: '2026-09-10T00:00:00.000Z',
              media_type: 'text/html',
              response_status: 200,
              body: {
                bytes: new TextEncoder().encode(
                  '<html><body><table><tr><th>Model</th><th>nominal voltage</th><th>continuous current</th></tr><tr><td>Example Model Restart Review</td><td>24 V</td><td>10 A</td></tr></table></body></html>',
                ),
                text: '<html><body><table><tr><th>Model</th><th>nominal voltage</th><th>continuous current</th></tr><tr><td>Example Model Restart Review</td><td>24 V</td><td>10 A</td></tr></table></body></html>',
              },
              content_hash: `sha256:${randomUUID()}`,
            },
            issues: [],
          };
        },
      },
      policy: { now: () => '2026-09-10T00:00:00.000Z' },
    });
    if (readyA.status !== 'review_ready')
      throw new Error('Fixture preparation did not become review-ready.');

    await jobStore.save({
      ...jobA,
      state: 'review_ready',
      preparation: readyA,
      updated_at: '2026-09-10T00:00:03.000Z',
    });
    await jobStore.save({
      ...jobB,
      state: 'preparation_failed',
      updated_at: '2026-09-10T00:00:04.000Z',
      error: { operation: 'prepare', message: 'capture unavailable' },
    });
    await jobStore.save({
      ...jobC,
      state: 'preparing',
      updated_at: '2026-09-10T00:00:05.000Z',
    });

    const batchStore = new FileIngestionBatchStore(batchesRoot);
    const persistedBatch = {
      schema_version: '1.0' as const,
      id: randomUUID(),
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
      job_ids: [jobA.id, jobB.id, jobC.id],
      requested_count: 3,
    };
    await batchStore.create(persistedBatch);

    const restarted = new IngestionBatchService({
      store: new FileIngestionBatchStore(batchesRoot),
      jobService: new IngestionJobService({
        store: new FileIngestionJobStore(jobsRoot),
        preparationRequest: () => ({
          adapter: {
            async capture() {
              throw new Error('Restart reconstruction must not capture a source.');
            },
          },
        }),
        prepare: productionPrepare,
        now: () => '2026-09-10T00:00:00.000Z',
      }),
    });

    const reloaded = await restarted.getBatch(persistedBatch.id);
    expect(await batchStore.list()).toEqual([persistedBatch]);
    expect(await new FileIngestionJobStore(jobsRoot).listJobIds()).toEqual(
      [jobA.id, jobB.id, jobC.id].sort(),
    );
    expect((await restarted.listBatches()).map((item) => item.id)).toEqual([persistedBatch.id]);
    expect(reloaded.id).toBe(persistedBatch.id);
    expect(reloaded.job_ids).toEqual(persistedBatch.job_ids);
    expect(reloaded.jobs.map((job) => job.state)).toEqual([
      'review_ready',
      'preparation_failed',
      'preparing',
    ]);
    expect(reloaded.state).toBe('mixed');

    const beforePrepare = await restarted.prepareBatch(persistedBatch.id);
    expect(beforePrepare.job_ids).toEqual(persistedBatch.job_ids);
    expect(beforePrepare.counts.review_ready).toBe(1);
    expect(beforePrepare.counts.preparation_failed).toBe(1);
    expect(beforePrepare.counts.preparing).toBe(1);
  });

  it('rejects invalid batch boundaries before creating any jobs', async () => {
    const storageRoot = await root();
    const created = new Map<string, IngestionJob>();
    const createJobImpl = vi.fn(async (input: ProductIntake) => {
      const job = {
        schema_version: '1.0',
        id: randomUUID(),
        created_at: '2026-09-10T00:00:00.000Z',
        updated_at: '2026-09-10T00:00:00.000Z',
        intake: input,
        state: 'created',
      };
      created.set(job.id, job);
      return job;
    });
    const getJobImpl = vi.fn(async (id: string) => {
      const job = created.get(id);
      if (!job) throw new Error(`Unknown job ${id}`);
      return job;
    });
    const batchService = makeSimpleBatchService(storageRoot, {
      createJob: createJobImpl,
      getJob: getJobImpl,
      prepareJob: vi.fn(),
      listJobs: vi.fn(),
    } as unknown as IngestionJobService);

    await expect(batchService.createBatch([])).rejects.toThrow('at least one product intake');
    const fifty = Array.from({ length: 50 }, (_, index) => intake(`ok-${index}`));
    await expect(batchService.createBatch(fifty)).resolves.toMatchObject({ requested_count: 50 });
    await expect(
      batchService.createBatch(
        Array.from({ length: 51 }, (_, index) => intake(`too-many-${index}`)),
      ),
    ).rejects.toThrow('maximum of 50');
    expect(createJobImpl).toHaveBeenCalledTimes(50);

    const invalid = { ...intake('bad'), manufacturer: '' };
    await expect(batchService.createBatch([intake('good'), invalid])).rejects.toThrow(
      'Invalid product intake',
    );
    expect(createJobImpl).toHaveBeenCalledTimes(50);
  });

  it('allows a configured service limit to narrow but never widen the hard limit', async () => {
    const storageRoot = await root();
    const createJob = vi.fn(async (input: ProductIntake) => ({
      schema_version: '1.0',
      id: randomUUID(),
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
      intake: input,
      state: 'created',
    }));
    const getJob = vi.fn(async (id: string) => ({
      schema_version: '1.0',
      id,
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
      intake: intake(id),
      state: 'created',
    }));
    const lowerBound = makeSimpleBatchService(
      join(storageRoot, 'lower'),
      { createJob, getJob },
      { maxBatchSize: 2 },
    );

    await expect(
      lowerBound.createBatch([intake('low-1'), intake('low-2'), intake('low-3')]),
    ).rejects.toThrow('maximum of 2');
    expect(createJob).not.toHaveBeenCalled();
    await expect(lowerBound.createBatch([intake('low-1'), intake('low-2')])).resolves.toMatchObject(
      {
        requested_count: 2,
      },
    );
    expect(() =>
      makeSimpleBatchService(
        join(storageRoot, 'wide'),
        { createJob, getJob },
        { maxBatchSize: 51 },
      ),
    ).toThrow('between 1 and 50');
    expect(() =>
      makeSimpleBatchService(
        join(storageRoot, 'invalid'),
        { createJob, getJob },
        { maxBatchSize: 0 },
      ),
    ).toThrow('between 1 and 50');
  });

  it('treats all source-resolution waiting states as pending', async () => {
    const storageRoot = await root();
    const created = new Map<string, IngestionJob>();
    const fakeJobService = {
      createJob: vi.fn(async (input: ProductIntake) => {
        const job = {
          schema_version: '1.0',
          id: randomUUID(),
          created_at: '2026-09-10T00:00:00.000Z',
          updated_at: '2026-09-10T00:00:00.000Z',
          intake: input,
          state: 'created',
        };
        created.set(job.id, job);
        return job;
      }),
      getJob: vi.fn(async (id: string) => created.get(id)),
    };
    const batchService = makeSimpleBatchService(storageRoot, fakeJobService);

    const sourceReviewBatch = await batchService.createBatch([intake('source-review')]);
    const [sourceReviewId] = sourceReviewBatch.job_ids;
    created.set(sourceReviewId, {
      ...created.get(sourceReviewId),
      state: 'source_resolution_review',
    });
    expect((await batchService.getBatch(sourceReviewBatch.id)).state).toBe('pending');

    const mixedWaitingBatch = await batchService.createBatch([
      intake('source-created'),
      intake('source-required'),
      intake('source-review-mixed'),
    ]);
    const [createdId, requiredId, reviewId] = mixedWaitingBatch.job_ids;
    created.set(requiredId, { ...created.get(requiredId), state: 'source_resolution_required' });
    created.set(reviewId, { ...created.get(reviewId), state: 'source_resolution_review' });
    const summary = await batchService.getBatch(mixedWaitingBatch.id);
    expect(summary.state).toBe('pending');
    expect(summary.counts.pending).toBe(3);
    expect(summary.counts.created).toBe(1);
    expect(summary.counts.source_resolution_required).toBe(1);
    expect(summary.counts.source_resolution_review).toBe(1);
    expect(created.get(createdId).state).toBe('created');
  });

  it('invokes only the normal prepare path and never approval or finalization when preparing a batch', async () => {
    const storageRoot = await root();
    const created = new Map<string, IngestionJob>();
    const submitApproval = vi.fn();
    const finalizeJob = vi.fn();
    const fakeJobService = {
      createJob: vi.fn(async (input: ProductIntake) => {
        const job = {
          schema_version: '1.0',
          id: randomUUID(),
          created_at: '2026-09-10T00:00:00.000Z',
          updated_at: '2026-09-10T00:00:00.000Z',
          intake: input,
          state: 'created',
        };
        created.set(job.id, job);
        return job;
      }),
      getJob: vi.fn(async (id: string) => {
        const job = created.get(id);
        if (!job) throw new Error(`Unknown job ${id}`);
        return job;
      }),
      prepareJob: vi.fn(async (id: string) => {
        const job = created.get(id);
        const updated = { ...job, state: 'review_ready', updated_at: '2026-09-10T00:00:04.000Z' };
        created.set(id, updated);
        return updated;
      }),
      submitApproval,
      finalizeJob,
      listJobs: vi.fn(async () => Array.from(created.values())),
    };

    const batchService = makeSimpleBatchService(storageRoot, fakeJobService);
    const batch = await batchService.createBatch([intake('one'), intake('two')]);
    await batchService.prepareBatch(batch.id);

    expect(fakeJobService.prepareJob).toHaveBeenCalledTimes(2);
    expect(submitApproval).not.toHaveBeenCalled();
    expect(finalizeJob).not.toHaveBeenCalled();
  });
});
