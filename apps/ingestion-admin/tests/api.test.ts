// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IngestionJobService, FileIngestionJobStore } from '@expedition/ingestion-runtime';
import { createOperatorApi, type OperatorService } from '../server/api.js';
import { jobDetail } from '../server/operator-views.js';
import {
  operatorConfiguration,
  operatorPolicy,
  createProductionOperatorService,
} from '../server/runtime.js';
import { fixtureService, fixturePreparation, input, intake } from './fixtures.js';
import { errorDiagnostic, type RequestContext } from '../server/request-logging.js';

const roots: string[] = [];
const servers: Server[] = [];
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

interface LogEntry extends RequestContext {
  event: string;
  timestamp: string;
  elapsed_ms?: number;
  state?: string;
  status?: number;
  error?: ReturnType<typeof errorDiagnostic>;
}
const logEntries = () =>
  vi.mocked(console.error).mock.calls.map(([entry]) => JSON.parse(entry as string) as LogEntry);
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'ingestion-admin-'));
  roots.push(path);
  return path;
}
async function start(
  service: OperatorService,
  suggestions?: Parameters<typeof createOperatorApi>[2],
) {
  const server = createOperatorApi(service, undefined, suggestions);
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
  it('starts and serves all job routes while suggestion loading fails, then retries independently', async () => {
    const service = fixtureService(await root());
    const internal = new Error(
      'Private suggestion path C:/private/canonical and underlying failure',
    );
    const suggestions = vi.fn().mockRejectedValue(internal);
    const url = await start(service, suggestions);
    expect(suggestions).not.toHaveBeenCalled();
    const suggestionsUrl = url.replace('/jobs', '/suggestions');
    const unavailable = await fetch(suggestionsUrl);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: { message: 'Canonical suggestions unavailable. Free entry remains available.' },
    });
    const failed = logEntries()[0];
    expect(failed).toMatchObject({
      event: 'REQUEST FAILED',
      pathname: '/api/ingestion/suggestions',
      status: 503,
      error: { name: 'Error', message: internal.message },
    });
    expect(failed.request_id).toBe(unavailable.headers.get('X-Request-Id'));
    const created = await post(url, input);
    expect(created.status).toBe(201);
    const job = await created.json();
    expect((await fetch(url + '/' + job.summary.id)).status).toBe(200);
    const listed = await fetch(url);
    expect(listed.status).toBe(200);
    expect((await listed.json()).jobs).toEqual([expect.objectContaining({ id: job.summary.id })]);
    const prepared = await post(url + '/' + job.summary.id + '/prepare');
    expect(prepared.status).toBe(200);
    expect((await prepared.json()).summary.state).toBe('review_ready');
    expect(suggestions).toHaveBeenCalledTimes(1);
    expect((await fetch(suggestionsUrl)).status).toBe(503);
    suggestions.mockResolvedValue({ manufacturers: ['Victron Energy'], products: [] });
    const available = await fetch(suggestionsUrl);
    expect(available.status).toBe(200);
    expect(await available.json()).toEqual({ manufacturers: ['Victron Energy'], products: [] });
    expect(suggestions).toHaveBeenCalledTimes(3);
  });
  it('does not interpret an unconfigured suggestions provider as an empty corpus', async () => {
    const url = await start(fixtureService(await root()));
    expect((await fetch(url.replace('/jobs', '/suggestions'))).status).toBe(503);
  });
  it('accepts either identifier, preserves omission in DTO/reload and exposes unresolved state', async () => {
    const service = fixtureService(await root());
    const url = await start(service);
    for (const omitted of ['manufacturer_part_number', 'official_product_uri'] as const) {
      const partial = { ...input };
      delete (partial as Partial<typeof input>)[omitted];
      const response = await post(url, partial);
      expect(response.status).toBe(201);
      const detail = await response.json();
      expect(detail.intake).not.toHaveProperty(omitted);
      expect((await service.getJob(detail.summary.id)).intake).not.toHaveProperty(omitted);
      if (omitted === 'official_product_uri') {
        expect(detail.summary.state).toBe('source_resolution_required');
        expect((await post(url + '/' + detail.summary.id + '/prepare')).status).toBe(409);
      }
    }
    expect((await post(url, { manufacturer: 'Example', product_model: 'Model' })).status).toBe(400);
    expect((await post(url, { ...input, manufacturer_part_number: ' ' })).status).toBe(400);
  });
  it('serves application-owned suggestions independently of unreviewed jobs', async () => {
    const service = fixtureService(await root());
    await service.createJob({ ...intake, manufacturer: 'Vicron Typo' });
    const server = createOperatorApi(service, undefined, () => ({
      manufacturers: ['Victron Energy'],
      products: [],
    }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const response = await fetch('http://127.0.0.1:' + address.port + '/api/ingestion/suggestions');
    expect(await response.json()).toEqual({ manufacturers: ['Victron Energy'], products: [] });
  });
  it('logs unexpected prepare errors with context, stack and causes while returning only the sanitized 500', async () => {
    const service = fixtureService(await root());
    const job = await service.createJob(intake);
    const cause = new Error('Underlying filesystem failure');
    const error = new TypeError('Internal prepare failure at C:/private/jobs', { cause });
    Object.assign(error, {
      source: { body: { text: 'PRIVATE_HTML', bytes: new Uint8Array([1, 2]) } },
      job,
      approval: 'PRIVATE_APPROVAL',
    });
    vi.spyOn(service, 'prepareJob').mockRejectedValueOnce(error);
    const url = await start(service);
    const response = await post(`${url}/${job.id}/prepare?trace=PRIVATE_QUERY`, {
      source: 'PRIVATE_REQUEST_BODY',
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { message: 'The ingestion service could not complete the request.' },
    });
    const logs = logEntries();
    expect(logs.map((entry) => entry.event)).toEqual([
      'PREPARE REQUEST START',
      'PREPARE REQUEST FAILED',
    ]);
    const failed = logs[1];
    expect(failed).toMatchObject({
      method: 'POST',
      pathname: `/api/ingestion/jobs/${job.id}/prepare`,
      job_id: job.id,
      operation: 'prepare',
      status: 500,
      error: {
        name: 'TypeError',
        message: error.message,
        stack: error.stack,
        cause: { name: 'Error', message: cause.message, stack: cause.stack },
      },
    });
    expect(failed.elapsed_ms).toBeGreaterThanOrEqual(0);
    for (const entry of logs) {
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(entry.request_id).toBe(response.headers.get('X-Request-Id'));
    }
    const serialized = JSON.stringify(logs);
    for (const excluded of [
      'PRIVATE_HTML',
      'PRIVATE_APPROVAL',
      'PRIVATE_REQUEST_BODY',
      'PRIVATE_QUERY',
      '"intake"',
      '"body"',
      '"bytes"',
    ])
      expect(serialized).not.toContain(excluded);
    expect((await service.getJob(job.id)).state).toBe('created');
  });
  it('logs one start and completion with durable state without serializing prepared evidence', async () => {
    const service = fixtureService(await root());
    const job = await service.createJob(intake);
    const url = await start(service);
    const response = await post(`${url}/${job.id}/prepare`);
    expect(response.status).toBe(200);
    const logs = logEntries();
    expect(logs.map((entry) => entry.event)).toEqual([
      'PREPARE REQUEST START',
      'PREPARE REQUEST COMPLETE',
    ]);
    expect(logs[1]).toMatchObject({
      job_id: job.id,
      operation: 'prepare',
      state: (await service.getJob(job.id)).state,
    });
    expect(logs[1].elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(logs[1].request_id).toBe(logs[0].request_id);
    expect(logs[0].request_id).toBe(response.headers.get('X-Request-Id'));
    for (const excluded of [
      'RAW_BODY_MARKER',
      'source_capture',
      'qualified_facts',
      '"body"',
      '"bytes"',
      '"intake"',
    ])
      expect(JSON.stringify(logs)).not.toContain(excluded);
  });
  it('keeps expected 4xx mappings and limits prepare failures to concise diagnostics', async () => {
    const service = fixtureService(await root());
    const job = await service.createJob(intake);
    const url = await start(service);
    const response = await post(url, { ...input, manufacturer: '' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message:
          'Provide manufacturer, product model and at least one identification-evidence field.',
      },
    });
    expect((await fetch(`${url}/bad`)).status).toBe(400);
    expect((await fetch(`${url}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`)).status).toBe(404);
    expect(logEntries()).toEqual([]);
    for (const message of [
      'Cannot prepare job in state review_ready.',
      `Ingestion job ${job.id} already has an operation in progress.`,
      `Unknown ingestion job ID: ${job.id}`,
    ]) {
      vi.mocked(console.error).mockClear();
      vi.spyOn(service, 'prepareJob').mockRejectedValueOnce(new Error(message));
      const response = await post(`${url}/${job.id}/prepare`);
      expect(response.status).toBe(message.startsWith('Unknown') ? 404 : 409);
      expect(await response.json()).toEqual({ error: { message } });
      expect(logEntries().map((entry) => entry.event)).toEqual([
        'PREPARE REQUEST START',
        'PREPARE REQUEST FAILED',
      ]);
      expect(logEntries()[1].error).toEqual({ name: 'RequestError', message });
    }
  });
  it.each(['create', 'get', 'list'] as const)(
    'logs an unexpected %s error with its operation and sanitized response',
    async (operation) => {
      const service = fixtureService(await root());
      const url = await start(service);
      const error = new Error(`Internal ${operation} failure`);
      const jobId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      if (operation === 'create') vi.spyOn(service, 'createJob').mockRejectedValueOnce(error);
      else if (operation === 'get') vi.spyOn(service, 'getJob').mockRejectedValueOnce(error);
      else vi.spyOn(service, 'listJobs').mockRejectedValueOnce(error);
      const response =
        operation === 'create'
          ? await post(url, input)
          : await fetch(operation === 'get' ? `${url}/${jobId}` : url);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: { message: 'The ingestion service could not complete the request.' },
      });
      expect(logEntries()).toHaveLength(1);
      expect(logEntries()[0]).toMatchObject({
        event: 'REQUEST FAILED',
        operation,
        method: operation === 'create' ? 'POST' : 'GET',
        pathname: operation === 'get' ? `/api/ingestion/jobs/${jobId}` : '/api/ingestion/jobs',
        error: { name: 'Error', message: error.message, stack: error.stack },
      });
      expect(logEntries()[0].job_id).toBe(operation === 'get' ? jobId : undefined);
    },
  );
  it('bounds nested and circular causes and omits arbitrary thrown object contents', () => {
    const circular = new Error('Circular');
    circular.cause = circular;
    expect(errorDiagnostic(circular).cause?.name).toBe('CauseCycle');
    let nested: Error = new Error('Deep');
    for (let i = 0; i < 10; i++) nested = new Error('a'.repeat(3000), { cause: nested });
    const diagnostic = errorDiagnostic(nested);
    expect(diagnostic.message).toHaveLength(3000);
    expect(diagnostic.cause?.message).toHaveLength(2000);
    expect(JSON.stringify(diagnostic)).toContain('CauseLimit');
    const withObject = errorDiagnostic(
      new Error('Failure', { cause: { bytes: 'PRIVATE_BYTES', job: 'PRIVATE_JOB' } }),
    );
    expect(JSON.stringify(withObject)).not.toContain('PRIVATE_');
    expect(errorDiagnostic({ html: 'PRIVATE_HTML' })).toEqual({
      name: 'NonErrorThrow',
      message: 'Thrown object; value omitted.',
    });
  });
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
    expect(logEntries().map((entry) => entry.event)).toEqual([
      'PREPARE REQUEST START',
      'PREPARE REQUEST COMPLETE',
    ]);
    expect(logEntries()[1].state).toBe('preparation_failed');
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
  it('supports create/list/get/prepare batch routes with durable child summaries and safe DTOs', async () => {
    const batchRoot = await root();
    const jobRoot = join(batchRoot, 'jobs');
    const jobService = fixtureService(jobRoot);
    const createJobSpy = vi.spyOn(jobService, 'createJob');
    const batchService = new (await import('@expedition/ingestion-runtime')).IngestionBatchService({
      store: new (await import('@expedition/ingestion-runtime')).FileIngestionBatchStore(
        join(batchRoot, 'batches'),
      ),
      jobService,
    });
    const prepareSpy = vi.spyOn(batchService, 'prepareBatch');
    const url = await start(batchService);

    const intakeA = {
      schema_version: '1.0',
      artifact_kind: 'product_intake',
      id: 'intake.alpha',
      ...input,
      manufacturer: 'Alpha Manufacturer',
      product_model: 'Alpha Model',
      manufacturer_part_number: 'AL-1',
      official_product_uri: 'https://example.test/products/alpha',
    };
    const intakeB = {
      schema_version: '1.0',
      artifact_kind: 'product_intake',
      id: 'intake.beta',
      ...input,
      manufacturer: 'Beta Manufacturer',
      product_model: 'Beta Model',
      manufacturer_part_number: 'BE-2',
      official_product_uri: 'https://example.test/products/beta',
    };
    const created = await post(`${url.replace('/jobs', '')}/batches`, [intakeA, intakeB]);
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.summary.requested_count).toBe(2);
    expect(createdBody.summary.job_count).toBe(2);
    expect(createdBody.job_ids).toHaveLength(2);
    expect(new Set(createdBody.job_ids).size).toBe(2);
    expect(createdBody.summary.jobs.map((job: { id: string }) => job.id)).toEqual(
      createdBody.job_ids,
    );
    expect(createdBody.summary.counts.created).toBe(2);
    expect(createdBody.summary.counts.pending).toBe(2);
    expect(createdBody.summary.state).toBe('pending');
    expect(createJobSpy).toHaveBeenCalledTimes(2);

    const listed = await fetch(`${url.replace('/jobs', '')}/batches`);
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.batches).toHaveLength(1);
    expect(listedBody.batches[0].id).toBe(createdBody.summary.id);
    expect(listedBody.batches[0].state).toBe('pending');
    expect(listedBody.batches[0].jobs.map((job: { id: string }) => job.id)).toEqual(
      createdBody.job_ids,
    );

    const read = await fetch(`${url.replace('/jobs', '')}/batches/${createdBody.summary.id}`);
    expect(read.status).toBe(200);
    const readBody = await read.json();
    expect(readBody.summary).toMatchObject({
      id: createdBody.summary.id,
      state: 'pending',
      requested_count: 2,
      job_count: 2,
    });
    expect(readBody.job_ids).toEqual(createdBody.job_ids);
    expect(JSON.stringify(readBody)).not.toContain('RAW_BODY_MARKER');
    expect(JSON.stringify(readBody)).not.toContain('source_provenance');
    expect(JSON.stringify(readBody)).not.toContain('"bytes"');

    const prepared = await post(
      `${url.replace('/jobs', '')}/batches/${createdBody.summary.id}/prepare`,
    );
    expect(prepared.status).toBe(200);
    const preparedBody = await prepared.json();
    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(prepareSpy).toHaveBeenCalledWith(createdBody.summary.id);
    expect(preparedBody.summary.state).toBe('review_ready');
    expect(preparedBody.job_ids).toEqual(createdBody.job_ids);
    expect(preparedBody.summary.counts.review_ready).toBe(2);
    expect(
      preparedBody.summary.jobs.every((job: { state: string }) => job.state === 'review_ready'),
    ).toBe(true);
    expect(
      await (await fetch(`${url.replace('/jobs', '')}/batches/${createdBody.summary.id}`)).json(),
    ).toMatchObject({
      summary: { state: 'review_ready' },
    });
    expect(
      await (await fetch(`${url.replace('/jobs', '')}/batches/${createdBody.summary.id}`)).json(),
    ).not.toHaveProperty('raw');
    const unknown = await fetch(
      `${url.replace('/jobs', '')}/batches/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({
      error: { message: 'Unknown ingestion batch ID: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    });

    const secondCreated = await post(`${url.replace('/jobs', '')}/batches`, [intakeA]);
    expect(secondCreated.status).toBe(201);
    expect(createJobSpy).toHaveBeenCalledTimes(3);
    const expectedBatchIds = [
      createdBody.summary.id,
      (await secondCreated.json()).summary.id,
    ].sort();
    const listUrl = `${url.replace('/jobs', '')}/batches`;
    const firstList = await fetch(listUrl);
    const secondList = await fetch(listUrl);
    expect((await firstList.json()).batches.map((batch: { id: string }) => batch.id)).toEqual(
      expectedBatchIds,
    );
    expect((await secondList.json()).batches.map((batch: { id: string }) => batch.id)).toEqual(
      expectedBatchIds,
    );
  });

  it('fails safely for empty, oversized, malformed, and unknown batch requests', async () => {
    const jobService = fixtureService(await root());
    const createJobSpy = vi.spyOn(jobService, 'createJob');
    const service = new (await import('@expedition/ingestion-runtime')).IngestionBatchService({
      store: new (await import('@expedition/ingestion-runtime')).FileIngestionBatchStore(
        await root(),
      ),
      jobService,
    });
    const url = await start(service);
    const batchesUrl = url.replace('/jobs', '/batches');

    expect((await post(batchesUrl, [])).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, index) => ({
      ...input,
      manufacturer: `Batch-${index}`,
      product_model: `Model-${index}`,
      manufacturer_part_number: `BP-${index}`,
      official_product_uri: `https://example.test/products/${index}`,
    }));
    expect((await post(batchesUrl, tooMany)).status).toBe(400);
    expect((await post(batchesUrl, [{ ...input, product_model: 123 }])).status).toBe(400);
    expect(createJobSpy).not.toHaveBeenCalled();
    expect((await fetch(`${batchesUrl}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`)).status).toBe(404);
    expect((await fetch(batchesUrl)).status).toBe(200);
  });

  it('does not expose batch approval, finalization, or canonical-write routes', async () => {
    const rootPath = await root();
    const service = new (await import('@expedition/ingestion-runtime')).IngestionBatchService({
      store: new (await import('@expedition/ingestion-runtime')).FileIngestionBatchStore(
        join(rootPath, 'batches'),
      ),
      jobService: fixtureService(join(rootPath, 'jobs')),
    });
    const url = await start(service);
    const batchUrl = `${url.replace('/jobs', '')}/batches/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;

    for (const action of ['approve', 'finalize', 'write']) {
      const response = await post(`${batchUrl}/${action}`, { write: true });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { message: 'Route not found.' } });
    }
  });

  it('sanitizes batch failures while logging batch-aware structured context', async () => {
    const rootPath = await root();
    const service = new (await import('@expedition/ingestion-runtime')).IngestionBatchService({
      store: new (await import('@expedition/ingestion-runtime')).FileIngestionBatchStore(
        join(rootPath, 'batches'),
      ),
      jobService: fixtureService(join(rootPath, 'jobs')),
    });
    const failure = Object.assign(new Error('Private batch storage path'), {
      capture: { body: 'PRIVATE_BATCH_BODY', bytes: [1, 2] },
    });
    vi.spyOn(service, 'getBatch').mockRejectedValueOnce(failure);
    const url = await start(service);
    const response = await fetch(
      `${url.replace('/jobs', '')}/batches/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
    );

    expect(response.status).toBe(500);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      error: { message: 'The ingestion service could not complete the request.' },
    });
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(logEntries()).toMatchObject([
      {
        event: 'REQUEST FAILED',
        pathname: '/api/ingestion/batches/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        batch_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        operation: 'get',
        status: 500,
        request_id: response.headers.get('X-Request-Id'),
      },
    ]);
    expect(JSON.stringify(responseBody)).not.toContain('Private batch storage path');
    expect(JSON.stringify(logEntries())).not.toContain('PRIVATE_BATCH_BODY');
  });

  it('keeps child source-resolution states and excludes raw job payloads in batch responses', async () => {
    const rootPath = await root();
    const rootJobService = fixtureService(join(rootPath, 'jobs'));
    const batchService = new (await import('@expedition/ingestion-runtime')).IngestionBatchService({
      store: new (await import('@expedition/ingestion-runtime')).FileIngestionBatchStore(
        join(rootPath, 'batches'),
      ),
      jobService: rootJobService,
    });
    const pendingIntake = {
      ...input,
      manufacturer: 'Pending',
      product_model: 'Pending Model',
      manufacturer_part_number: 'PD-2',
    };
    delete (pendingIntake as Partial<typeof input>).official_product_uri;
    const batch = await batchService.createBatch([
      {
        schema_version: '1.0',
        artifact_kind: 'product_intake',
        id: 'intake.ready',
        ...input,
        manufacturer: 'Ready',
        product_model: 'Ready Model',
        manufacturer_part_number: 'RD-1',
        official_product_uri: 'https://example.test/products/ready',
      },
      {
        schema_version: '1.0',
        artifact_kind: 'product_intake',
        id: 'intake.pending',
        ...pendingIntake,
      },
    ]);
    const sourceState = await batchService.getBatch(batch.id);
    expect(sourceState.state).toBe('pending');
    expect(sourceState.jobs.map((job) => job.state)).toEqual([
      'created',
      'source_resolution_required',
    ]);
    const url = await start(batchService);
    const response = await fetch(`${url.replace('/jobs', '')}/batches/${batch.id}`);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.summary.jobs.map((job: { state: string }) => job.state)).toEqual([
      'created',
      'source_resolution_required',
    ]);
    expect(JSON.stringify(json)).not.toContain('RAW_BODY_MARKER');
    expect(JSON.stringify(json)).not.toContain('source_resolution_attempts');
    expect(JSON.stringify(json)).not.toContain('"bytes"');
  });

  it('uses distinct production roots and keeps the shared job service in the composition', async () => {
    const defaultConfig = operatorConfiguration({
      INGESTION_REPOSITORY_ROOT: process.cwd(),
      INGESTION_CANONICAL_ROOT: '/reserved',
    });
    expect(defaultConfig.jobRoot).toMatch(
      /(?:^|[\\/])(?:\.local-ingestion|local-ingestion)[\\/]jobs$/i,
    );
    expect(defaultConfig.batchRoot).toMatch(
      /(?:^|[\\/])(?:\.local-ingestion|local-ingestion)[\\/]batches$/i,
    );
    const customJobRoot = await root();
    const customBatchRoot = await root();
    const config = operatorConfiguration({
      INGESTION_REPOSITORY_ROOT: process.cwd(),
      INGESTION_JOB_ROOT: customJobRoot,
      INGESTION_BATCH_ROOT: customBatchRoot,
      INGESTION_CANONICAL_ROOT: '/reserved',
    });
    expect(config.jobRoot).not.toBe(config.batchRoot);
    expect(config.jobRoot).toBe(customJobRoot);
    expect(config.batchRoot).toBe(customBatchRoot);
    const service = await createProductionOperatorService(config);
    expect(service).toHaveProperty('jobService');
    const latest = await service.createJob(intake);
    expect(latest.state).toBe('created');
    expect(service.jobService).toBeDefined();
    await expect(service.getJob(latest.id)).resolves.toHaveProperty('id', latest.id);
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
