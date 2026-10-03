import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  artifactReference,
  reviewPackageSnapshot,
  type ProductionApproval,
} from '@expedition/ingestion';
import {
  FileIngestionJobStore,
  FileIngestionBatchStore,
  IngestionJobService,
  IngestionBatchService,
  productReviewLifecycleSnapshot,
  JobStoreConflictError,
  type IngestionJob,
} from '../src/index.js';
import { serializeJob } from '../src/codec.js';
import {
  resolutionIntake,
  resolutionProfile,
  resolutionUri,
} from '../../ingestion/tests/fixtures/source-resolution.js';
import { positionedPdfSource } from '../../ingestion/tests/fixtures/positioned-pdf.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function approval(
  job: IngestionJob,
  decision: 'deferred' | 'rejected' = 'deferred',
): ProductionApproval {
  if (job.preparation?.status !== 'review_ready') throw new Error('Expected review');
  const pkg = job.preparation.review_package;
  return {
    schema_version: '1.0',
    artifact_kind: 'approval',
    id: `approval.${job.id}`,
    decision,
    reviewer_id: 'Human',
    reviewed_at: '2026-10-03T06:00:00Z',
    reviewed_decisions: ['Preserve evidence until schema support exists'],
    review_package: artifactReference('review_package', pkg, pkg.id, pkg.schema_version),
    review_package_snapshot: reviewPackageSnapshot(pkg),
    semantic_snapshot: pkg.semantic_snapshot,
  };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'resumable-review-'));
  roots.push(root);
  const store = new FileIngestionJobStore(join(root, 'jobs'));
  const captured = positionedPdfSource({ manufacturer: resolutionIntake.manufacturer });
  const capture = vi.fn(async (request: { uri: string }) => ({
    status: 'success' as const,
    source: { ...captured, requested_uri: request.uri, final_uri: request.uri },
    issues: [],
  }));
  const finalize = vi.fn();
  const dependencies = {
    store,
    finalize,
    preparationRequest: () => ({
      profile: resolutionProfile,
      adapter: { capture },
    }),
  };
  const service = new IngestionJobService(dependencies);
  const batchStore = new FileIngestionBatchStore(join(root, 'batches'));
  const batchService = new IngestionBatchService({ store: batchStore, jobService: service });
  const batch = await batchService.createBatch([resolutionIntake]);
  const id = batch.job_ids[0];
  const pending = await service.submitSourceResolutionCandidate(id, resolutionUri);
  await service.decideSourceResolution(
    id,
    pending.source_resolution_attempts![0].resolution.attempt_id,
    'accepted',
  );
  let ready = await service.prepareJob(id);
  if (ready.preparation?.status !== 'review_ready') throw new Error('Expected PDF');
  for (const proposal of ready.preparation.proposals) {
    if (ready.preparation?.status !== 'review_ready') throw new Error('Expected PDF');
    ready = await service.recordSemanticDecision(id, {
      proposal_id: proposal.id,
      outcome: 'schema_gap',
      actor_label: 'Human',
      expected_review_snapshot: reviewPackageSnapshot(ready.preparation.review_package),
      schema_gap: { concept_key: 'installation.unsupported', explanation: 'No suitable target' },
      rationale: 'Preserve contextual evidence without projection',
    });
  }
  const defer = (job = ready) =>
    service.submitApproval(id, approval(job), {
      expected_lifecycle_snapshot: productReviewLifecycleSnapshot(job),
      reason: 'schema_gap',
    });
  const resume = (job: IngestionJob) =>
    service.resumeDeferredReview(id, {
      expected_lifecycle_snapshot: productReviewLifecycleSnapshot(job),
      actor_label: 'Resume operator',
    });
  return {
    root,
    store,
    service,
    dependencies,
    ready,
    defer,
    resume,
    capture,
    finalize,
    batch,
    batchService,
  };
}

it('pauses the same job with complete review evidence and durable rationale; no automatic resume or write', async () => {
  const f = await fixture();
  const captures = f.capture.mock.calls.length;
  const paused = await f.defer();
  expect(paused.state).toBe('review_deferred');
  expect(paused.id).toBe(f.ready.id);
  expect(serializeJob(paused.preparation)).toBe(serializeJob(f.ready.preparation));
  expect(paused.source_resolution_attempts).toEqual(f.ready.source_resolution_attempts);
  expect(paused.active_source_resolution).toEqual(f.ready.active_source_resolution);
  expect(paused.product_review_history?.[0]).toMatchObject({
    action: 'deferred',
    revision: 1,
    reason: 'schema_gap',
    approval: {
      reviewer_id: 'Human',
      reviewed_decisions: ['Preserve evidence until schema support exists'],
    },
  });
  const restarted = new IngestionJobService(f.dependencies);
  expect(serializeJob(await restarted.getJob(paused.id))).toBe(serializeJob(paused));
  await expect(restarted.prepareJob(paused.id)).rejects.toThrow('Cannot prepare');
  await expect(
    restarted.finalizeJob(paused.id, { destinationRoot: join(f.root, 'canonical'), write: true }),
  ).rejects.toThrow('Cannot finalize');
  expect(f.capture).toHaveBeenCalledTimes(captures);
  expect(f.finalize).not.toHaveBeenCalled();
});

it('explicitly resumes without rebuilding semantic decisions and can separately archive a populated review', async () => {
  const f = await fixture();
  const paused = await f.defer();
  const calls = f.capture.mock.calls.length;
  const resumed = await f.resume(paused);
  expect(resumed.id).toBe(paused.id);
  expect(resumed.state).toBe('review_ready');
  expect(resumed.approval).toBeUndefined();
  expect(serializeJob(resumed.preparation)).toBe(serializeJob(paused.preparation));
  expect(resumed.product_review_history).toHaveLength(2);
  expect(resumed.product_review_history?.[0]).toEqual(paused.product_review_history?.[0]);
  expect(f.capture).toHaveBeenCalledTimes(calls);
  if (resumed.preparation?.status !== 'review_ready') throw new Error('Expected review');
  await expect(
    f.service.reopenPreparation(
      resumed.id,
      reviewPackageSnapshot(resumed.preparation.review_package),
    ),
  ).rejects.toThrow('Only the current');
  const reopened = await f.service.reopenPreparation(
    resumed.id,
    reviewPackageSnapshot(resumed.preparation.review_package),
    productReviewLifecycleSnapshot(resumed),
  );
  expect(reopened.state).toBe('created');
  expect(serializeJob(reopened.preparation_recovery_history?.[0].preparation)).toBe(
    serializeJob(resumed.preparation),
  );
  expect(reopened.product_review_history).toEqual(resumed.product_review_history);
  expect(f.capture).toHaveBeenCalledTimes(calls);
  const prepared = await f.service.prepareJob(resumed.id);
  expect(prepared.state).toBe('review_ready');
  if (prepared.preparation?.status !== 'review_ready') throw new Error('Expected review');
  expect(prepared.preparation.bridge.reviewed_semantic_decisions).toEqual([]);
  expect(
    prepared.preparation_recovery_history?.[0].preparation.bridge.reviewed_semantic_decisions,
  ).toHaveLength(2);
  expect(prepared.active_source_resolution).toEqual(f.ready.active_source_resolution);
});

it('rejects stale operator snapshots, duplicate resume, and missing rationale without mutations', async () => {
  const f = await fixture();
  const old = productReviewLifecycleSnapshot(f.ready);
  await expect(
    f.service.submitApproval(
      f.ready.id,
      { ...approval(f.ready), reviewed_decisions: [] },
      {
        expected_lifecycle_snapshot: old,
      },
    ),
  ).rejects.toThrow('requires a human rationale');
  const paused = await f.defer();
  await expect(
    f.service.resumeDeferredReview(paused.id, {
      expected_lifecycle_snapshot: old,
      actor_label: 'Human',
    }),
  ).rejects.toThrow('current deferred');
  const resumed = await f.resume(paused);
  await expect(f.resume(paused)).rejects.toThrow('current deferred');
  await expect(
    f.service.submitApproval(resumed.id, approval(resumed), {
      expected_lifecycle_snapshot: old,
    }),
  ).rejects.toThrow('lifecycle changed');
  expect(serializeJob(await f.store.load(resumed.id))).toBe(serializeJob(resumed));
});

it.each(['defer', 'resume'] as const)('rejects a racing %s through durable CAS', async (action) => {
  const f = await fixture();
  const initial = action === 'resume' ? await f.defer() : f.ready;
  let inject = true;
  const staleStore = {
    create: f.store.create.bind(f.store),
    load: f.store.load.bind(f.store),
    save: f.store.save.bind(f.store),
    loadVersioned: async (id: string) => {
      const read = await f.store.loadVersioned(id);
      if (inject) {
        inject = false;
        if (action === 'resume') await f.resume(initial);
        else await f.defer();
      }
      return read;
    },
  };
  const racing = new IngestionJobService({ ...f.dependencies, store: staleStore });
  const request = { expected_lifecycle_snapshot: productReviewLifecycleSnapshot(initial) };
  await expect(
    action === 'resume'
      ? racing.resumeDeferredReview(initial.id, { ...request, actor_label: 'Stale operator' })
      : racing.submitApproval(initial.id, approval(initial), request),
  ).rejects.toBeInstanceOf(JobStoreConflictError);
  expect((await f.store.load(initial.id)).product_review_history).toHaveLength(
    action === 'resume' ? 2 : 1,
  );
});

it('enforces history and exact-review preservation at the store boundary', async () => {
  const f = await fixture();
  const paused = await f.defer();
  let current = await f.store.loadVersioned(paused.id);
  await expect(
    f.store.save({ ...paused, state: 'review_ready', approval: undefined }, current.version),
  ).rejects.toThrow('append-only product review events');
  const resumed = await f.resume(paused);
  current = await f.store.loadVersioned(paused.id);
  await expect(
    f.store.save({ ...resumed, product_review_history: [] }, current.version),
  ).rejects.toThrow('immutable and append-only');
  if (resumed.preparation?.status !== 'review_ready') throw new Error('Expected review');
  await expect(
    f.store.save({ ...resumed, preparation: undefined }, current.version),
  ).rejects.toThrow();
});

it('does not resume rejected reviews or allow defer after terminal rejection', async () => {
  const f = await fixture();
  const rejected = await f.service.submitApproval(f.ready.id, approval(f.ready, 'rejected'));
  await expect(f.resume(rejected)).rejects.toThrow('current deferred');
  await expect(f.defer(rejected)).rejects.toThrow('Cannot approve');
  const current = await f.store.loadVersioned(rejected.id);
  await expect(
    f.store.save({ ...rejected, state: 'review_ready', approval: undefined }, current.version),
  ).rejects.toThrow('terminal');
});

it('reports paused children without batch-driven resume or preparation', async () => {
  const f = await fixture();
  const paused = await f.defer();
  const calls = f.capture.mock.calls.length;
  const summary = await f.batchService.prepareBatch(f.batch.id);
  expect(summary.state).toBe('mixed');
  expect(summary.counts.review_deferred).toBe(1);
  expect(summary.jobs[0].state).toBe('review_deferred');
  expect(serializeJob(await f.store.load(paused.id))).toBe(serializeJob(paused));
  expect(f.capture).toHaveBeenCalledTimes(calls);
});

it('resumes legacy deferred records without inventing their missing rationale/classification', async () => {
  const f = await fixture();
  const legacy: IngestionJob = {
    ...f.ready,
    id: randomUUID(),
    state: 'review_deferred',
    approval: { ...approval(f.ready), reviewed_decisions: undefined },
  };
  await f.store.create(legacy);
  const resumed = await f.service.resumeDeferredReview(legacy.id, {
    expected_lifecycle_snapshot: productReviewLifecycleSnapshot(legacy),
    actor_label: 'Human',
  });
  expect(resumed.product_review_history?.[0]).toEqual({
    action: 'deferred',
    revision: 1,
    approval: legacy.approval,
  });
  expect(resumed.state).toBe('review_ready');
});
