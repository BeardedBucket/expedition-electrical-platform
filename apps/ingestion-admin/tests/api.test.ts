// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IngestionJobService, FileIngestionJobStore } from '@expedition/ingestion-runtime';
import { createOperatorApi, type OperatorService } from '../server/api.js';
import { jobDetail } from '../server/operator-views.js';
import {
  operatorConfiguration,
  operatorPolicy,
  createProductionOperatorService,
} from '../server/runtime.js';
import { fixtureService, fixturePreparation, input, intake } from './fixtures.js';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'ingestion-admin-'));
  roots.push(path);
  return path;
}
async function start(service: OperatorService) {
  const server = createOperatorApi(service);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listening address.');
  return `http://127.0.0.1:${address.port}/api/ingestion/jobs`;
}
const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('operator HTTP API and durable DTO boundary', () => {
  it('creates durably, prepares through the real offline pipeline, and restores after service restart', async () => {
    const path = await root();
    const service = fixtureService(path);
    const prepare = vi.spyOn(service, 'prepareJob');
    const url = await start(service);
    const response = await post(url, input);
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.summary.state).toBe('created');
    expect(created.summary).not.toHaveProperty('fact_count');
    expect((await service.getJob(created.summary.id)).intake.id).toMatch(/^intake\./);
    const result = await post(`${url}/${created.summary.id}/prepare`);
    expect(result.status).toBe(200);
    const detail = await result.json();
    expect(prepare).toHaveBeenCalledWith(created.summary.id);
    expect(detail.summary.state).toBe('review_ready');
    expect(detail.candidate.present).toBe(true);
    expect(detail.summary.fact_count).toBeGreaterThan(0);
    expect(detail.candidate.field_evidence).toBeDefined();
    const durable = await service.getJob(created.summary.id);
    expect(durable.preparation?.acquisition.seed_capture.source?.body.bytes).toBeInstanceOf(
      Uint8Array,
    );
    const serialized = JSON.stringify(detail);
    for (const forbidden of [
      'RAW_BODY_MARKER',
      '"bytes"',
      '"body"',
      '"blocks"',
      'source_provenance',
    ])
      expect(serialized).not.toContain(forbidden);
    expect(detail.sources[0].role).toBe('product_page');
    expect(detail.extractions[0].block_count).toBeGreaterThan(0);
    expect(detail.review_package.semantic_snapshot).toBeDefined();
    const restarted = fixtureService(path);
    const restartUrl = await start(restarted);
    expect(await (await fetch(`${restartUrl}/${created.summary.id}`)).json()).toEqual(detail);
    expect((await post(`${restartUrl}/${created.summary.id}/prepare`)).status).toBe(409);
  });
  it('preserves zero facts, zero proposals and absent candidate as a valid review result', async () => {
    const service = fixtureService(await root(), false);
    const url = await start(service);
    const created = await (await post(url, input)).json();
    const result = await (await post(`${url}/${created.summary.id}/prepare`)).json();
    expect(result.summary).toMatchObject({
      state: 'review_ready',
      fact_count: 0,
      proposal_count: 0,
      candidate_present: false,
    });
    expect(result.candidate.present).toBe(false);
    expect(result.review_package.candidate_present).toBe(false);
  });
  it('rejects malformed input, authoritative intake validation, IDs and unknown jobs', async () => {
    const service = fixtureService(await root());
    const url = await start(service);
    for (const body of [
      null,
      [],
      { ...input, manufacturer: '' },
      { ...input, extra: true },
      { ...input, product_model: 10 },
    ])
      expect((await post(url, body)).status).toBe(400);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect((await fetch(`${url}/bad`)).status).toBe(400);
    expect((await fetch(`${url}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`)).status).toBe(404);
    expect((await post(`${url}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/prepare`)).status).toBe(404);
    expect((await post(`${url}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/approve`)).status).toBe(404);
    vi.spyOn(service, 'createJob').mockRejectedValueOnce(
      new Error('Invalid product intake: authoritative validation issue'),
    );
    expect((await post(url, input)).status).toBe(400);
  });
  it('reports persisted runtime failures and structured pipeline failures without stacks', async () => {
    const service = new IngestionJobService({
      store: new FileIngestionJobStore(await root()),
      preparationRequest: () => {
        throw new Error('Capture unavailable');
      },
    });
    const url = await start(service);
    const created = await (await post(url, input)).json();
    const failed = await (await post(`${url}/${created.summary.id}/prepare`)).json();
    expect(failed.summary.state).toBe('preparation_failed');
    expect(failed.diagnostics[0].message).toContain('Capture unavailable');
    expect(JSON.stringify(failed)).not.toContain(' at ');
    const prepared = await fixturePreparation(false);
    expect(
      jobDetail({
        ...(await service.getJob(created.summary.id)),
        preparation: { ...prepared, status: 'preparation_failed', reason: 'extraction_failed' },
      }).diagnostics,
    ).toContainEqual(expect.objectContaining({ code: 'extraction_failed' }));
    vi.spyOn(service, 'getJob').mockRejectedValue(new Error('private stack/path'));
    const response = await fetch(`${url}/${created.summary.id}`);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private');
  });
  it('lists deterministically, ignores unrelated entries, and validates listed records normally', async () => {
    const path = await root();
    const service = fixtureService(path);
    const a = await service.createJob(intake);
    const b = await service.createJob(intake);
    await writeFile(join(path, 'unrelated.json'), '{}');
    await writeFile(join(path, '.partial.tmp'), 'partial');
    const url = await start(service);
    const response = await (await fetch(url)).json();
    const expected = [a, b]
      .sort((x, y) =>
        x.updated_at === y.updated_at
          ? x.id < y.id
            ? -1
            : 1
          : x.updated_at > y.updated_at
            ? -1
            : 1,
      )
      .map((j) => j.id);
    expect(response.jobs.map((j: { id: string }) => j.id)).toEqual(expected);
    await writeFile(join(path, `${a.id}.json`), '{}');
    expect((await fetch(url)).status).toBe(500);
  });
  it('rejects cross-site mutation and oversized requests', async () => {
    const url = await start(fixtureService(await root()));
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Origin: 'https://external.test', 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    expect((await post(url, { ...input, manufacturer: 'a'.repeat(17_000) })).status).toBe(413);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Origin: 'http://127.0.0.1:5174', 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: {
            Origin: 'http://127.0.0.1:5174',
            'Sec-Fetch-Site': 'cross-site',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
  });
  it('configures the real reviewed profile source and confines recursion to the operator', async () => {
    expect(operatorPolicy).toMatchObject({
      max_recursion_depth: 1,
      max_discovered_candidates: 50,
      max_captured_candidates: 20,
    });
    const config = operatorConfiguration({
      INGESTION_REPOSITORY_ROOT: process.cwd(),
      INGESTION_JOB_ROOT: await root(),
      INGESTION_CANONICAL_ROOT: '/reserved',
    });
    expect(config.host).toBe('127.0.0.1');
    expect(config.canonicalRoot).toContain('reserved');
    const service = await createProductionOperatorService(config);
    expect((await service.createJob(intake)).state).toBe('created');
  });
});
