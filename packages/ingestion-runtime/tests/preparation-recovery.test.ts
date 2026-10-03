import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { reviewPackageSnapshot } from '@expedition/ingestion';
import {
  FileIngestionJobStore,
  IngestionJobService,
  JobStoreConflictError,
  PreparationRecoveryError,
  isPreparationRecoveryEligible,
} from '../src/index.js';
import {
  resolutionAdapter,
  resolutionIntake,
  resolutionProfile,
  resolutionUri,
} from '../../ingestion/tests/fixtures/source-resolution.js';
import { serializeJob } from '../src/codec.js';
import { positionedPdfSource } from '../../ingestion/tests/fixtures/positioned-pdf.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'empty-preparation-'));
  roots.push(root);
  const store = new FileIngestionJobStore(root);
  const dependencies = {
    store,
    preparationRequest: () => ({
      adapter: resolutionAdapter({
        html: `<html><body><h1>Example Model EX-1</h1><p>${'Source text without specification rows. '.repeat(30)}</p></body></html>`,
      }),
      profile: resolutionProfile,
    }),
  };
  const service = new IngestionJobService(dependencies);
  const job = await service.createJob(resolutionIntake);
  const pending = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
  await service.decideSourceResolution(
    job.id,
    pending.source_resolution_attempts![0].resolution.attempt_id,
    'accepted',
  );
  const ready = await service.prepareJob(job.id);
  if (ready.preparation?.status !== 'review_ready') throw new Error('Expected empty review.');
  return {
    store,
    service,
    dependencies,
    ready,
    snapshot: reviewPackageSnapshot(ready.preparation.review_package),
  };
}

it('archives the complete empty review on the same job without recapturing or changing source decisions', async () => {
  const { ready, service, dependencies, store, snapshot } = await fixture();
  expect(isPreparationRecoveryEligible(ready)).toBe(true);
  const reopened = await service.reopenPreparation(ready.id, snapshot);
  expect(reopened.state).toBe('created');
  expect(reopened.id).toBe(ready.id);
  expect(reopened.preparation).toBeUndefined();
  expect(reopened.source_resolution_attempts).toEqual(ready.source_resolution_attempts);
  expect(reopened.accepted_source_resolution).toEqual(ready.accepted_source_resolution);
  expect(reopened.active_source_resolution).toEqual(ready.active_source_resolution);
  expect(serializeJob(reopened.preparation_recovery_history?.[0].preparation)).toBe(
    serializeJob(ready.preparation),
  );
  expect(reopened.approval).toBeUndefined();
  expect(reopened.final_result).toBeUndefined();
  await expect(service.reopenPreparation(ready.id, snapshot)).rejects.toBeInstanceOf(
    PreparationRecoveryError,
  );
  const version = (await store.loadVersioned(ready.id)).version;
  await expect(
    store.save({ ...reopened, preparation_recovery_history: [] }, version),
  ).rejects.toThrow('immutable and append-only');
  const restarted = new IngestionJobService(dependencies);
  const second = await restarted.prepareJob(ready.id);
  expect(second.state).toBe('review_ready');
  expect(second.preparation?.source_resolution).toEqual(ready.preparation?.source_resolution);
  expect(serializeJob(second.preparation_recovery_history?.[0].preparation)).toBe(
    serializeJob(ready.preparation),
  );
  expect(second.source_resolution_attempts).toEqual(ready.source_resolution_attempts);
});

it('rejects stale review snapshots and nonempty reviews without mutating the job', async () => {
  const { ready, service, store, snapshot } = await fixture();
  await expect(
    service.reopenPreparation(ready.id, `sha256:${'0'.repeat(64)}`),
  ).rejects.toBeInstanceOf(PreparationRecoveryError);
  const nonemptyService = new IngestionJobService({
    store,
    preparationRequest: () => ({ adapter: resolutionAdapter(), profile: resolutionProfile }),
  });
  await service.reopenPreparation(ready.id, snapshot);
  const nonempty = await nonemptyService.prepareJob(ready.id);
  expect(nonempty.preparation?.status).toBe('review_ready');
  expect(isPreparationRecoveryEligible(nonempty)).toBe(false);
  await expect(nonemptyService.reopenPreparation(ready.id, snapshot)).rejects.toBeInstanceOf(
    PreparationRecoveryError,
  );
  expect(serializeJob(await nonemptyService.getJob(ready.id))).toBe(serializeJob(nonempty));
  expect(isPreparationRecoveryEligible({ ...ready, state: 'approved' })).toBe(false);
  expect(isPreparationRecoveryEligible({ ...ready, state: 'finalized' })).toBe(false);
});

it('rejects a stale CAS recovery and retains the current empty review', async () => {
  const { ready, store, dependencies, snapshot } = await fixture();
  let inject = true;
  const staleStore = {
    create: store.create.bind(store),
    load: store.load.bind(store),
    loadVersioned: async (id: string) => {
      const current = await store.loadVersioned(id);
      if (inject) {
        inject = false;
        await store.save({ ...current.job, updated_at: '2026-10-03T00:00:00Z' }, current.version);
      }
      return current;
    },
    save: store.save.bind(store),
  };
  const staleService = new IngestionJobService({ ...dependencies, store: staleStore });
  await expect(staleService.reopenPreparation(ready.id, snapshot)).rejects.toBeInstanceOf(
    JobStoreConflictError,
  );
  const current = await store.load(ready.id);
  expect(current.state).toBe('review_ready');
  expect(serializeJob(current.preparation)).toBe(serializeJob(ready.preparation));
  expect(current.preparation_recovery_history).toBeUndefined();
});

it('advances the same accepted source to PDF facts only after explicit recovery and preparation', async () => {
  const { ready, store, service, snapshot } = await fixture();
  const captured = positionedPdfSource({ manufacturer: resolutionIntake.manufacturer });
  const pdfService = new IngestionJobService({
    store,
    preparationRequest: () => ({
      profile: resolutionProfile,
      adapter: {
        async capture(request) {
          return {
            status: 'success',
            source: { ...captured, requested_uri: request.uri, final_uri: request.uri },
            issues: [],
          };
        },
      },
    }),
  });
  await expect(pdfService.prepareJob(ready.id)).rejects.toThrow('Cannot prepare');
  await service.reopenPreparation(ready.id, snapshot);
  const updated = await pdfService.prepareJob(ready.id);
  expect(updated.id).toBe(ready.id);
  expect(updated.state).toBe('review_ready');
  expect(updated.preparation?.status).toBe('review_ready');
  if (updated.preparation?.status !== 'review_ready') throw new Error('Expected PDF review.');
  expect(updated.preparation.qualified_facts).toHaveLength(2);
  expect(updated.source_resolution_attempts).toEqual(ready.source_resolution_attempts);
  expect(updated.active_source_resolution).toEqual(ready.active_source_resolution);
  expect(serializeJob(updated.preparation_recovery_history?.[0].preparation)).toBe(
    serializeJob(ready.preparation),
  );
  expect(updated.approval).toBeUndefined();
  expect(updated.final_result).toBeUndefined();
});
