import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { artifactDigest } from '@expedition/ingestion';
import { IngestionJobService, FileIngestionJobStore } from '../src/index.js';
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
  it('persists failed captures for review but prevents acceptance', async () => {
    const { service, job } = await fixture(true);
    const pending = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
    expect(pending.source_resolution_attempts![0].capture.disposition).toBe('failed');
    expect(pending.source_resolution_attempts![0].resolution.domain_evidence.state).toBe(
      'final_domain_unobserved',
    );
    const id = pending.source_resolution_attempts![0].resolution.attempt_id;
    await expect(service.decideSourceResolution(job.id, id, 'accepted')).rejects.toThrow(
      'successful authoritative capture',
    );
    expect((await service.decideSourceResolution(job.id, id, 'rejected')).state).toBe(
      'source_resolution_required',
    );
  });
  it('prevents rewriting intake, accepted decisions, or downstream bindings in storage', async () => {
    const { service, store, job } = await fixture();
    const pending = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
    const accepted = await service.decideSourceResolution(
      job.id,
      pending.source_resolution_attempts![0].resolution.attempt_id,
      'accepted',
    );
    await expect(
      store.save({
        ...accepted,
        intake: { ...accepted.intake, official_product_uri: resolutionUri },
      }),
    ).rejects.toThrow();
    await expect(store.save({ ...accepted, source_resolution_attempts: [] })).rejects.toThrow();
    const prepared = await service.prepareJob(job.id);
    await expect(
      store.save({
        ...prepared,
        accepted_source_resolution: {
          ...prepared.accepted_source_resolution!,
          digest: `sha256:${'a'.repeat(64)}`,
        },
      }),
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
