import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { artifactDigest } from '@expedition/ingestion';
import {
  IngestionJobService,
  FileIngestionJobStore,
  isSourceSelectionRecoveryEligible,
  JobStoreConflictError,
  SourceResolutionError,
} from '../src/index.js';
import { serializeJob } from '../src/codec.js';
import {
  resolutionAdapter,
  resolutionIntake,
  resolutionProfile,
  resolutionUri,
} from '../../ingestion/tests/fixtures/source-resolution.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(failed = false) {
  const root = await mkdtemp(join(tmpdir(), 'source-resolution-'));
  roots.push(root);
  const store = new FileIngestionJobStore(root);
  const dependencies = {
    store,
    preparationRequest: () => ({
      adapter: resolutionAdapter({ failed }),
      profile: resolutionProfile,
    }),
    now: () => '2026-09-08T00:00:01.000Z',
  };
  const service = new IngestionJobService(dependencies);
  const job = await service.createJob(resolutionIntake);
  return { store, dependencies, service, job };
}
describe('durable source resolution workflow', () => {
  it('starts MPN-only jobs unresolved and forbids preparation', async () => {
    const { service, job } = await fixture();
    expect(job.state).toBe('source_resolution_required');
    await expect(service.prepareJob(job.id)).rejects.toThrow('Cannot prepare');
  });
  it('rejects malformed, unsupported and private candidate URLs without changing state', async () => {
    const { service, job } = await fixture();
    for (const uri of [
      'bad URI',
      'ftp://example.test/file',
      'http://localhost/page',
      'http://10.1.1.1/page',
    ])
      await expect(service.submitSourceResolutionCandidate(job.id, uri)).rejects.toThrow(
        'Invalid source resolution candidate',
      );
    expect((await service.getJob(job.id)).state).toBe('source_resolution_required');
  });
  it('persists capture evidence and pending review, preserving intake', async () => {
    const { service, job } = await fixture();
    const next = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
    expect(next.state).toBe('source_resolution_review');
    expect(next.intake).toEqual(resolutionIntake);
    const loaded = await service.getJob(job.id);
    expect(loaded.source_resolution_attempts).toEqual(next.source_resolution_attempts);
    expect(loaded.source_resolution_attempts?.[0].capture.content_digest).toMatch(/^sha256:/);
    await expect(service.prepareJob(job.id)).rejects.toThrow('Cannot prepare');
    await expect(service.submitSourceResolutionCandidate(job.id, resolutionUri)).rejects.toThrow(
      'Cannot submit',
    );
  });
  it('requires the pending attempt ID and rejects replayed decisions', async () => {
    const { service, job } = await fixture();
    const pending = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
    await expect(service.decideSourceResolution(job.id, 'other', 'accepted')).rejects.toThrow(
      'not pending',
    );
    const id = pending.source_resolution_attempts![0].resolution.attempt_id;
    await service.decideSourceResolution(job.id, id, 'accepted');
    await expect(service.decideSourceResolution(job.id, id, 'rejected')).rejects.toThrow(
      'Cannot review',
    );
  });
  it('retains rejected attempts, permits another candidate and survives restart', async () => {
    const { service, dependencies, job } = await fixture();
    const first = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
    const rejected = await service.decideSourceResolution(
      job.id,
      first.source_resolution_attempts![0].resolution.attempt_id,
      'rejected',
    );
    expect(rejected.state).toBe('source_resolution_required');
    const restarted = new IngestionJobService(dependencies);
    const second = await restarted.submitSourceResolutionCandidate(
      job.id,
      'https://example.test/products/other',
    );
    const accepted = await restarted.decideSourceResolution(
      job.id,
      second.source_resolution_attempts![1].resolution.attempt_id,
      'accepted',
    );
    expect(accepted.state).toBe('created');
    expect(accepted.source_resolution_attempts?.map((item) => item.resolution.disposition)).toEqual(
      ['rejected', 'accepted'],
    );
    expect(accepted.accepted_source_resolution?.digest).toBe(
      artifactDigest(accepted.source_resolution_attempts![1].resolution),
    );
    expect(await new IngestionJobService(dependencies).getJob(job.id)).toEqual(accepted);
  });
  it('completes the offline add → candidate → accept → prepare smoke on the same job', async () => {
    const { service, job } = await fixture();
    const pending = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
    await service.decideSourceResolution(
      job.id,
      pending.source_resolution_attempts![0].resolution.attempt_id,
      'accepted',
    );
    const prepared = await service.prepareJob(job.id);
    expect(prepared.id).toBe(job.id);
    expect(prepared.state).toBe('review_ready');
    expect(prepared.intake).not.toHaveProperty('official_product_uri');
    expect(prepared.preparation?.source_resolution?.disposition).toBe('accepted');
    expect(prepared.preparation?.acquisition.seed_capture.artifact.requested_uri).toBe(
      resolutionUri,
    );
    expect(serializeJob(await service.getJob(job.id))).toBe(serializeJob(prepared));
  });
  it('accepts source identity independently of a failed capture and keeps preparation fail-closed', async () => {
    const { store, job } = await fixture(false);
    const failedService = new IngestionJobService({
      store,
      preparationRequest: () => ({
        adapter: resolutionAdapter({ failed: true, final_uri: resolutionUri }),
        profile: resolutionProfile,
      }),
      now: () => '2026-09-08T00:00:01.000Z',
    });
    const pending = await failedService.submitSourceResolutionCandidate(job.id, resolutionUri);
    expect(pending.source_resolution_attempts![0].capture.disposition).toBe('failed');
    expect(pending.source_resolution_attempts![0].capture.response_status).toBe(403);
    expect(pending.source_resolution_attempts![0].resolution.domain_evidence.state).toBe(
      'profile_supported',
    );
    const id = pending.source_resolution_attempts![0].resolution.attempt_id;
    const accepted = await failedService.decideSourceResolution(job.id, id, 'accepted');
    expect(accepted.state).toBe('created');
    expect(accepted.source_resolution_attempts![0].capture.disposition).toBe('failed');
    expect(accepted.source_resolution_attempts![0].resolution.disposition).toBe('accepted');
    expect(
      await new IngestionJobService({
        store,
        preparationRequest: () => ({
          adapter: {
            async capture() {
              return { status: 'failed', issues: [{ code: 'http_status', message: 'HTTP 403' }] };
            },
          },
          profile: resolutionProfile,
        }),
      }).getJob(job.id),
    ).toEqual(accepted);
    const failedPreparation = await failedService.prepareJob(job.id);
    expect(failedPreparation.state).toBe('preparation_failed');
    expect(failedPreparation.preparation?.status).toBe('preparation_failed');
    expect(failedPreparation.preparation?.reason).toBe('acquisition_failed');
    expect(failedPreparation.preparation?.acquisition.seed_capture.artifact).toMatchObject({
      requested_uri: resolutionUri,
      response_status: 403,
    });
    expect(failedPreparation.preparation?.document_extractions).toEqual([]);
    expect(failedPreparation.source_resolution_attempts![0].capture).toEqual(
      accepted.source_resolution_attempts![0].capture,
    );
    expect(failedPreparation.source_resolution_attempts![0].resolution.review).toEqual(
      accepted.source_resolution_attempts![0].resolution.review,
    );
  });
  it('reopens source selection after acquisition failure without rewriting accepted history', async () => {
    const { service, store, job } = await fixture(false);
    const firstCandidate = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
    const firstAccepted = await service.decideSourceResolution(
      job.id,
      firstCandidate.source_resolution_attempts![0].resolution.attempt_id,
      'accepted',
    );
    const firstResolution = firstAccepted.source_resolution_attempts![0].resolution;
    const firstCapture = firstAccepted.source_resolution_attempts![0].capture;
    const failedService = new IngestionJobService({
      store,
      preparationRequest: () => ({
        adapter: resolutionAdapter({ failed: true, final_uri: resolutionUri }),
        profile: resolutionProfile,
      }),
    });
    const failed = await failedService.prepareJob(job.id);
    expect(failed.state).toBe('preparation_failed');
    expect(isSourceSelectionRecoveryEligible(failed)).toBe(true);
    expect(failed.preparation?.document_extractions).toEqual([]);

    const reopened = await failedService.reopenSourceSelection(job.id);
    expect(reopened.id).toBe(job.id);
    expect(reopened.state).toBe('source_resolution_required');
    expect(reopened.accepted_source_resolution).toEqual(firstAccepted.accepted_source_resolution);
    expect(reopened.active_source_resolution).toBeUndefined();
    expect(reopened.source_resolution_attempts?.[0].resolution).toEqual(firstResolution);
    expect(reopened.source_resolution_attempts?.[0].capture).toEqual(firstCapture);
    expect(reopened.preparation).toBeUndefined();
    expect(reopened.source_resolution_recovery_history).toHaveLength(1);
    expect(reopened.source_resolution_recovery_history?.[0].preparation).toEqual(
      failed.preparation,
    );
    const reopenedVersion = (await store.loadVersioned(job.id)).version;
    await expect(
      store.save({ ...reopened, source_resolution_recovery_history: [] }, reopenedVersion),
    ).rejects.toThrow();
    await expect(
      store.save(
        {
          ...reopened,
          state: 'created',
          active_source_resolution: firstAccepted.accepted_source_resolution,
        },
        reopenedVersion,
      ),
    ).rejects.toThrow('The active source can change only through source acceptance or recovery.');
    expect(isSourceSelectionRecoveryEligible(reopened)).toBe(false);
    await expect(failedService.reopenSourceSelection(job.id)).rejects.toBeInstanceOf(
      SourceResolutionError,
    );

    const alternateUri = 'https://example.test/products/alternate';
    const pending = await service.submitSourceResolutionCandidate(job.id, alternateUri);
    expect(pending.id).toBe(job.id);
    expect(pending.state).toBe('source_resolution_review');
    expect(pending.source_resolution_attempts).toHaveLength(2);
    expect(pending.source_resolution_attempts?.[0].resolution).toEqual(firstResolution);
    expect(pending.source_resolution_attempts?.[1].resolution.disposition).toBe('pending');
    expect(pending.active_source_resolution).toBeUndefined();
    await expect(service.prepareJob(job.id)).rejects.toThrow('Cannot prepare');

    const accepted = await service.decideSourceResolution(
      job.id,
      pending.source_resolution_attempts![1].resolution.attempt_id,
      'accepted',
    );
    expect(accepted.accepted_source_resolution).toEqual(firstAccepted.accepted_source_resolution);
    expect(accepted.active_source_resolution?.digest).toBe(
      artifactDigest(accepted.source_resolution_attempts![1].resolution),
    );
    expect(accepted.source_resolution_attempts?.[0].resolution).toEqual(firstResolution);
    const prepared = await service.prepareJob(job.id);
    expect(prepared.state).toBe('review_ready');
    expect(prepared.preparation?.source_resolution?.id).toBe(
      accepted.source_resolution_attempts![1].resolution.id,
    );
    expect(prepared.preparation?.acquisition.seed_capture.artifact.requested_uri).toBe(
      alternateUri,
    );
    expect(prepared.source_resolution_recovery_history?.[0].preparation).toEqual(
      failed.preparation,
    );
    expect(
      (
        await new IngestionJobService({
          store,
          preparationRequest: () => ({
            adapter: resolutionAdapter(),
            profile: resolutionProfile,
          }),
        }).getJob(job.id)
      ).source_resolution_attempts?.[0].resolution,
    ).toEqual(firstResolution);
  });
  it('does not allow source-selection recovery for non-acquisition failures', async () => {
    const { service, store, job } = await fixture();
    const candidate = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
    await service.decideSourceResolution(
      job.id,
      candidate.source_resolution_attempts![0].resolution.attempt_id,
      'accepted',
    );
    const failingService = new IngestionJobService({
      store,
      preparationRequest: () => ({
        adapter: resolutionAdapter(),
        profile: resolutionProfile,
      }),
      prepare: async () => {
        throw new Error('synthetic processing failure');
      },
    });
    const failed = await failingService.prepareJob(job.id);
    expect(failed.state).toBe('preparation_failed');
    expect(isSourceSelectionRecoveryEligible(failed)).toBe(false);
    expect(isSourceSelectionRecoveryEligible({ ...failed, state: 'approved' })).toBe(false);
    expect(isSourceSelectionRecoveryEligible({ ...failed, state: 'finalized' })).toBe(false);
    await expect(failingService.reopenSourceSelection(job.id)).rejects.toThrow(
      'can only be reopened after an accepted source fails during acquisition',
    );
    expect((await failingService.getJob(job.id)).state).toBe('preparation_failed');
  });
  it('rejects stale recovery saves through the store version compare-and-swap', async () => {
    const { service, store, job } = await fixture();
    const candidate = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
    await service.decideSourceResolution(
      job.id,
      candidate.source_resolution_attempts![0].resolution.attempt_id,
      'accepted',
    );
    const failedService = new IngestionJobService({
      store,
      preparationRequest: () => ({
        adapter: resolutionAdapter({ failed: true, final_uri: resolutionUri }),
        profile: resolutionProfile,
      }),
    });
    await failedService.prepareJob(job.id);
    let injectConcurrentUpdate = true;
    const staleReadStore = {
      create: store.create.bind(store),
      load: store.load.bind(store),
      loadVersioned: async (id: string) => {
        const snapshot = await store.loadVersioned(id);
        if (injectConcurrentUpdate) {
          injectConcurrentUpdate = false;
          await store.save(
            { ...snapshot.job, updated_at: '2026-09-08T00:00:02.000Z' },
            snapshot.version,
          );
        }
        return snapshot;
      },
      save: store.save.bind(store),
    };
    const staleService = new IngestionJobService({
      store: staleReadStore,
      preparationRequest: () => ({
        adapter: resolutionAdapter(),
        profile: resolutionProfile,
      }),
    });
    await expect(staleService.reopenSourceSelection(job.id)).rejects.toBeInstanceOf(
      JobStoreConflictError,
    );
    const current = await service.getJob(job.id);
    expect(current.state).toBe('preparation_failed');
    expect(current.source_resolution_recovery_history).toBeUndefined();
  });
  it('still requires an actual final URL before accepting a failed capture', async () => {
    const { store, job } = await fixture(false);
    const failedService = new IngestionJobService({
      store,
      preparationRequest: () => ({
        adapter: resolutionAdapter({ failed: true }),
        profile: resolutionProfile,
      }),
    });
    const pending = await failedService.submitSourceResolutionCandidate(job.id, resolutionUri);
    expect(pending.source_resolution_attempts![0].resolution.final_uri).toBeUndefined();
    await expect(
      failedService.decideSourceResolution(
        job.id,
        pending.source_resolution_attempts![0].resolution.attempt_id,
        'accepted',
      ),
    ).rejects.toThrow('final URL');
    expect((await failedService.getJob(job.id)).state).toBe('source_resolution_review');
  });
  it('prevents rewriting intake, accepted decisions, or downstream bindings in storage', async () => {
    const { service, store, job } = await fixture();
    const pending = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
    const accepted = await service.decideSourceResolution(
      job.id,
      pending.source_resolution_attempts![0].resolution.attempt_id,
      'accepted',
    );
    const acceptedVersion = (await store.loadVersioned(job.id)).version;
    await expect(
      store.save(
        {
          ...accepted,
          intake: { ...accepted.intake, official_product_uri: resolutionUri },
        },
        acceptedVersion,
      ),
    ).rejects.toThrow();
    await expect(
      store.save({ ...accepted, source_resolution_attempts: [] }, acceptedVersion),
    ).rejects.toThrow();
    const prepared = await service.prepareJob(job.id);
    await expect(
      store.save(
        {
          ...prepared,
          accepted_source_resolution: {
            ...prepared.accepted_source_resolution!,
            digest: `sha256:${'a'.repeat(64)}`,
          },
        },
        (await store.loadVersioned(job.id)).version,
      ),
    ).rejects.toThrow();
  });
  it('keeps URL-present jobs on the ordinary preparation path', async () => {
    const { service } = await fixture();
    const job = await service.createJob({
      ...resolutionIntake,
      official_product_uri: resolutionUri,
    });
    expect(job.state).toBe('created');
    await expect(service.submitSourceResolutionCandidate(job.id, resolutionUri)).rejects.toThrow(
      'Cannot submit',
    );
    const prepared = await service.prepareJob(job.id);
    expect(prepared.state).toBe('review_ready');
    expect(prepared.preparation?.source_resolution).toBeUndefined();
  });
});
