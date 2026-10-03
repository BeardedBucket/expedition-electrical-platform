// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { fixtureService, fixtureAdapter, profile, intake, input } from './fixtures.js';
import { artifactDigest } from '@expedition/ingestion';
import { IngestionJobService, FileIngestionJobStore } from '@expedition/ingestion-runtime';
import { createOperatorApi } from '../server/api.js';
import { jobDetail } from '../server/operator-views.js';
import { serializeJob } from '../../../packages/ingestion-runtime/src/codec.js';
import {
  resolutionAdapter,
  resolutionIntake,
  resolutionProfile,
  resolutionUri,
} from '../../../packages/ingestion/tests/fixtures/source-resolution.js';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(failedCapture = false) {
  const root = await mkdtemp(join(tmpdir(), 'source-resolution-api-'));
  roots.push(root);
  const service = fixtureService(root, true, failedCapture);
  const { official_product_uri: _url, ...mpnOnly } = intake;
  const job = await service.createJob(mpnOnly);
  const server = createOperatorApi(service);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address.');
  const url = `http://127.0.0.1:${address.port}/api/ingestion/jobs/${job.id}`;
  return { service, job, url, root };
}
const post = (url: string, body?: object) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
it('reopens only the displayed empty preparation and preserves its source/history through the API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'preparation-recovery-api-'));
  roots.push(root);
  const service = new IngestionJobService({
    store: new FileIngestionJobStore(root),
    preparationRequest: () => ({
      adapter: resolutionAdapter({
        html: `<html><body><h1>Example Model EX-1</h1><p>${'Source without specification rows. '.repeat(30)}</p></body></html>`,
      }),
      profile: resolutionProfile,
    }),
  });
  const job = await service.createJob(resolutionIntake);
  const pending = await service.submitSourceResolutionCandidate(job.id, resolutionUri);
  await service.decideSourceResolution(
    job.id,
    pending.source_resolution_attempts![0].resolution.attempt_id,
    'accepted',
  );
  const ready = await service.prepareJob(job.id);
  const dto = jobDetail(ready);
  expect(dto.preparation_recovery).toBeDefined();
  const server = createOperatorApi(service);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address.');
  const url = `http://127.0.0.1:${address.port}/api/ingestion/jobs/${job.id}/preparation/reopen`;
  expect((await post(url)).status).toBe(400);
  expect((await post(url, { expected_review_snapshot: `sha256:${'0'.repeat(64)}` })).status).toBe(
    409,
  );
  const response = await post(url, dto.preparation_recovery);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.summary).toMatchObject({ id: job.id, state: 'created' });
  expect(result.preparation_recovery_history).toHaveLength(1);
  const durable = await service.getJob(job.id);
  expect(serializeJob(durable.preparation_recovery_history?.[0].preparation)).toBe(
    serializeJob(ready.preparation),
  );
  expect(durable.source_resolution_attempts).toEqual(ready.source_resolution_attempts);
  expect(durable.active_source_resolution).toEqual(ready.active_source_resolution);
  expect(durable.preparation).toBeUndefined();
  expect((await post(url, dto.preparation_recovery)).status).toBe(409);
});
it('serves candidate review, rejection, second candidate and explicit acceptance on the same job', async () => {
  const { url, service, job } = await fixture();
  const first = await post(`${url}/source-resolution/candidates`, {
    official_product_uri: input.official_product_uri,
  });
  expect(first.status).toBe(200);
  const pending = await first.json();
  expect(pending.summary.state).toBe('source_resolution_review');
  const attempt_id = pending.source_resolution.attempts[0].attempt_id;
  const rejected = await post(`${url}/source-resolution/reject`, { attempt_id });
  expect((await rejected.json()).summary.state).toBe('source_resolution_required');
  const second = await post(`${url}/source-resolution/candidates`, {
    official_product_uri: input.official_product_uri,
  });
  const next = await second.json();
  const accepted = await post(`${url}/source-resolution/accept`, {
    attempt_id: next.source_resolution.attempts[1].attempt_id,
  });
  expect((await accepted.json()).summary.state).toBe('created');
  expect((await service.getJob(job.id)).intake.official_product_uri).toBeUndefined();
  expect((await post(`${url}/prepare`)).status).toBe(200);
  expect((await service.getJob(job.id)).state).toBe('review_ready');
});
it('projects and accepts a failed capture as a separate source-identity decision', async () => {
  const { url, service, job } = await fixture(true);
  const candidate = await post(`${url}/source-resolution/candidates`, {
    official_product_uri: input.official_product_uri,
  });
  expect(candidate.status).toBe(200);
  const pending = await candidate.json();
  const attempt = pending.source_resolution.attempts[0];
  expect(attempt.capture).toMatchObject({
    disposition: 'failed',
    response_status: 403,
    reason_codes: ['http_status'],
  });
  expect(attempt.final_uri).toBe(input.official_product_uri);
  expect(attempt.can_accept).toBe(true);
  const accepted = await post(`${url}/source-resolution/accept`, {
    attempt_id: attempt.attempt_id,
  });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  expect((await accepted.json()).summary.state).toBe('created');
  const durable = await service.getJob(job.id);
  expect(durable.source_resolution_attempts?.[0].resolution.disposition).toBe('accepted');
  expect(durable.source_resolution_attempts?.[0].capture).toMatchObject({
    disposition: 'failed',
    response_status: 403,
    reason_codes: ['http_status'],
  });
});
it('reopens an acquisition-failed job through the normal candidate and human-decision flow', async () => {
  const { url, service, job } = await fixture(true);
  const candidate = await post(`${url}/source-resolution/candidates`, {
    official_product_uri: input.official_product_uri,
  });
  const pending = await candidate.json();
  const accepted = await post(`${url}/source-resolution/accept`, {
    attempt_id: pending.source_resolution.attempts[0].attempt_id,
  });
  expect((await accepted.json()).summary.id).toBe(job.id);
  expect((await post(`${url}/prepare`)).status).toBe(200);
  const failed = await service.getJob(job.id);
  expect(failed.state).toBe('preparation_failed');
  const failedDto = jobDetail(failed);
  expect(failedDto.source_resolution?.recovery.can_reopen).toBe(true);
  expect(failedDto.source_resolution?.recovery.acquisition_status).toBe('seed_failed');
  expect(failedDto.source_resolution?.attempts[0].disposition).toBe('accepted');
  expect(failedDto.source_resolution?.attempts[0].capture.response_status).toBe(403);

  const reopenedResponse = await post(`${url}/source-resolution/reopen`);
  expect(reopenedResponse.status).toBe(200);
  const reopened = await reopenedResponse.json();
  expect(reopened.summary).toMatchObject({ id: job.id, state: 'source_resolution_required' });
  expect(reopened.source_resolution.accepted_uri).toBeUndefined();
  expect(reopened.source_resolution.recovery_history).toHaveLength(1);
  expect(reopened.source_resolution.recovery_history[0]).toMatchObject({
    previous_source_uri: input.official_product_uri,
    preparation_status: 'preparation_failed',
    preparation_reason: 'acquisition_failed',
    acquisition_status: 'seed_failed',
    seed_capture_disposition: 'failed',
    seed_response_status: 403,
  });
  expect(reopened.source_resolution.attempts[0]).toMatchObject({
    disposition: 'accepted',
    final_uri: input.official_product_uri,
    capture: { disposition: 'failed', response_status: 403 },
  });
  expect((await post(`${url}/source-resolution/reopen`)).status).toBe(409);

  const alternate = await post(`${url}/source-resolution/candidates`, {
    official_product_uri: 'https://example.test/products/alternate',
  });
  expect(alternate.status).toBe(200);
  const alternatePending = await alternate.json();
  expect(alternatePending.summary).toMatchObject({ id: job.id, state: 'source_resolution_review' });
  expect(alternatePending.source_resolution.attempts[0].disposition).toBe('accepted');
  expect(alternatePending.source_resolution.attempts[1]).toMatchObject({
    disposition: 'pending',
    can_accept: true,
  });
  expect(
    (await service.getJob(job.id)).source_resolution_attempts?.[1].resolution.disposition,
  ).toBe('pending');
});
it('maps candidate validation and stale state errors to 400/409', async () => {
  const { url } = await fixture();
  expect(
    (
      await post(`${url}/source-resolution/candidates`, {
        official_product_uri: 'http://localhost',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post(`${url}/source-resolution/candidates`, {
        official_product_uri: input.official_product_uri,
        extra: true,
      })
    ).status,
  ).toBe(400);
  expect((await post(`${url}/source-resolution/accept`, { attempt_id: 'missing' })).status).toBe(
    409,
  );
  await post(`${url}/source-resolution/candidates`, {
    official_product_uri: input.official_product_uri,
  });
  expect((await post(`${url}/prepare`)).status).toBe(409);
  expect((await post(`${url}/source-resolution/accept`, { attempt_id: 'missing' })).status).toBe(
    409,
  );
});
it('projects bounded evidence without raw bodies, bytes or internal capture provenance', async () => {
  const { service, job } = await fixture();
  const pending = await service.submitSourceResolutionCandidate(job.id, input.official_product_uri);
  const text = JSON.stringify(jobDetail(pending));
  expect(text).not.toContain('RAW_BODY_MARKER');
  expect(text).not.toContain('<html');
  expect(text).not.toContain('"bytes"');
  expect(text).not.toContain('source_provenance');
  expect(jobDetail(pending).source_resolution?.attempts[0].domain_evidence.state).toBe(
    'profile_supported',
  );
});
it('projects only the digest-bound accepted final URI through preparation and service restart', async () => {
  const { root, job } = await fixture();
  const originalDigest = artifactDigest(job.intake);
  const finalUri = 'https://example.test/products/captured-final';
  const baseAdapter = fixtureAdapter();
  const restart = () =>
    new IngestionJobService({
      store: new FileIngestionJobStore(root),
      preparationRequest: () => ({
        profile,
        adapter: {
          async capture(request) {
            const result = await baseAdapter.capture(request);
            return result.source && request.uri === input.official_product_uri
              ? { ...result, source: { ...result.source, final_uri: finalUri } }
              : result;
          },
        },
      }),
    });
  const service = restart();
  expect(jobDetail(job).source_resolution?.accepted_uri).toBeUndefined();
  const pending = await service.submitSourceResolutionCandidate(job.id, input.official_product_uri);
  expect(jobDetail(pending).source_resolution?.accepted_uri).toBeUndefined();
  const accepted = await service.decideSourceResolution(
    job.id,
    pending.source_resolution_attempts![0].resolution.attempt_id,
    'accepted',
  );
  expect(jobDetail(accepted).source_resolution?.accepted_uri).toBe(finalUri);
  expect(
    jobDetail({
      ...accepted,
      accepted_source_resolution: {
        ...accepted.accepted_source_resolution!,
        digest: `sha256:${'a'.repeat(64)}`,
      },
      active_source_resolution: {
        ...accepted.active_source_resolution!,
        digest: `sha256:${'a'.repeat(64)}`,
      },
    }).source_resolution?.accepted_uri,
  ).toBeUndefined();
  const prepared = await service.prepareJob(job.id);
  expect(prepared.state).toBe('review_ready');
  const reloaded = await restart().getJob(job.id);
  expect(jobDetail(reloaded).source_resolution?.accepted_uri).toBe(finalUri);
  expect(jobDetail(reloaded).intake.official_product_uri).toBeUndefined();
  expect(jobDetail(reloaded).summary.official_product_uri).toBeUndefined();
  expect(artifactDigest(reloaded.intake)).toBe(originalDigest);
});
it('keeps ordinary URL-present DTOs free of a resolved source', async () => {
  const { service } = await fixture();
  const ordinary = await service.createJob(intake);
  const dto = jobDetail(ordinary);
  expect(dto.summary.official_product_uri).toBe(input.official_product_uri);
  expect(dto.source_resolution).toBeUndefined();
});
