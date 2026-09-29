import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpSourceCaptureAdapter } from '../src/http-capture.js';
import { acquireOfficialSources } from '../src/source-acquisition.js';
import { captureSourceForProduction } from '../src/source-capture.js';

const uri = 'https://example.test/product';
const makeAdapter = (fetcher: typeof fetch) =>
  new HttpSourceCaptureAdapter(
    fetcher,
    () => '2026-09-28T00:00:00.000Z',
    async () => ['93.184.216.34'],
  );
const fixture = (media = 'application/pdf', cancellation?: () => Promise<void>) => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn(cancellation);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel,
  });
  const response = new Response(stream, { headers: { 'content-type': media } });
  const send = (count = 5) => controller.enqueue(new Uint8Array(count).fill(65));
  return { controller, stream, response, send, cancel };
};
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('bounded streaming capture timeouts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it.each(['text/html', 'text/plain', 'application/pdf'])(
    'completes %s with continuous progress beyond the old ten-second wall clock',
    async (media) => {
      const f = fixture(media);
      const pending = makeAdapter(async () => f.response).capture({ uri });
      await flush();
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(6_000);
        f.send();
        await flush();
      }
      f.controller.close();
      const result = await pending;
      expect(result.status).toBe('success');
      expect(result.bytes_observed).toBe(15);
      expect(result.source?.content_hash).toMatch(/^sha256:/);
      expect(f.stream.locked).toBe(false);
      expect(f.cancel).not.toHaveBeenCalled();
    },
  );

  it('aborts a stalled body, retains bytes, releases the reader, and produces no digest', async () => {
    const f = fixture();
    const pending = captureSourceForProduction(
      makeAdapter(async () => f.response),
      {
        uri,
        capture_id: 'capture.stall',
        retention_status: 'not_retained',
      },
    );
    await flush();
    f.send(7);
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.disposition).toBe('failed');
    expect(result.bytes_observed).toBe(7);
    expect(result.source).toBeUndefined();
    expect(result.artifact.content_digest).toBeUndefined();
    expect(result.artifact.snapshot).toBeUndefined();
    expect(result.reasons).toEqual([
      { code: 'aborted', message: 'The body inactivity timeout was exceeded.' },
    ]);
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.stream.locked).toBe(false);
  });

  it('aborts at an independent absolute deadline despite continuous chunks', async () => {
    const f = fixture();
    const pending = makeAdapter(async () => f.response).capture({ uri, body_timeout_ms: 20_000 });
    await flush();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(6_000);
      f.send();
      await flush();
    }
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await pending;
    expect(result).toMatchObject({
      status: 'failed',
      bytes_observed: 15,
      issues: [{ code: 'aborted', message: 'The absolute body-transfer timeout was exceeded.' }],
    });
    expect(result.source).toBeUndefined();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.stream.locked).toBe(false);
  });

  it('counts the size-crossing chunk and cancels before the timeout', async () => {
    const f = fixture('text/plain');
    const pending = makeAdapter(async () => f.response).capture({ uri, max_bytes: 8 });
    await flush();
    f.send(5);
    await flush();
    f.send(5);
    const result = await pending;
    expect(result).toMatchObject({
      status: 'failed',
      bytes_observed: 10,
      issues: [{ code: 'response_too_large' }],
    });
    expect(result.source).toBeUndefined();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.stream.locked).toBe(false);
  });

  it('rejects oversized Content-Length without reading and releases the reader', async () => {
    const f = fixture('text/plain');
    f.response.headers.set('content-length', '2000001');
    const result = await makeAdapter(async () => f.response).capture({ uri });
    expect(result).toMatchObject({
      status: 'failed',
      bytes_observed: 0,
      issues: [{ code: 'response_too_large' }],
    });
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.stream.locked).toBe(false);
  });

  it.each([false, true])('honors external abort (already aborted: %s)', async (already) => {
    const f = fixture();
    const caller = new AbortController();
    if (already) caller.abort();
    const fetcher = vi.fn(async () => f.response);
    const pending = makeAdapter(fetcher).capture({ uri, signal: caller.signal });
    await flush();
    if (!already) {
      f.send(9);
      await flush();
      caller.abort();
    }
    const result = await pending;
    expect(result).toMatchObject({
      status: 'failed',
      issues: [{ code: 'aborted', message: 'The capture was externally aborted.' }],
    });
    expect(result.source).toBeUndefined();
    if (already) expect(fetcher).not.toHaveBeenCalled();
    else {
      expect(result.bytes_observed).toBe(9);
      expect(f.cancel).toHaveBeenCalledOnce();
    }
    expect(f.stream.locked).toBe(false);
  });

  it('bounds response start even when DNS ignores cancellation', async () => {
    const adapter = new HttpSourceCaptureAdapter(fetch, undefined, () => new Promise(() => {}));
    const pending = adapter.capture({ uri });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({
      status: 'failed',
      issues: [{ code: 'aborted', message: 'The request/response-start timeout was exceeded.' }],
    });
  });

  it('cancels a late response from a fetch that ignores cancellation', async () => {
    const f = fixture();
    let resolve!: (response: Response) => void;
    const pending = makeAdapter(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    ).capture({ uri });
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).issues[0].message).toContain('response-start');
    resolve(f.response);
    await flush();
    expect(f.cancel).toHaveBeenCalledOnce();
  });

  it.each(['reject', 'hang'])('contains cancellation that can %s', async (behavior) => {
    const f = fixture('application/pdf', () =>
      behavior === 'reject' ? Promise.reject(new Error('cancel failure')) : new Promise(() => {}),
    );
    const pending = makeAdapter(async () => f.response).capture({ uri });
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe('failed');
    expect(f.stream.locked).toBe(false);
  });

  it('preserves genuine body network errors and partial bytes', async () => {
    const f = fixture();
    const pending = makeAdapter(async () => f.response).capture({ uri });
    await flush();
    f.send(3);
    await flush();
    f.controller.error(new Error('transport broke'));
    expect(await pending).toMatchObject({
      status: 'failed',
      bytes_observed: 3,
      issues: [{ code: 'network_error', message: 'Error: transport broke' }],
    });
    expect(f.stream.locked).toBe(false);
  });

  it('does not reset idle time for zero-byte chunks', async () => {
    const f = fixture();
    const pending = makeAdapter(async () => f.response).capture({ uri });
    await flush();
    await vi.advanceTimersByTimeAsync(6_000);
    f.send(0);
    await flush();
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await pending).issues[0].message).toContain('inactivity');
  });

  it('removes caller listeners after completion', async () => {
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const result = await makeAdapter(async () => new Response('small')).capture({
      uri,
      signal: caller.signal,
    });
    expect(result.status).toBe('success');
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);
  });

  it('accepts no late chunk when a timeout wins the same-clock race', async () => {
    const f = fixture();
    const pending = makeAdapter(async () => f.response).capture({ uri, body_timeout_ms: 10_000 });
    await flush();
    f.send(4);
    await flush();
    setTimeout(() => {
      try {
        f.send(10);
      } catch {
        /* cancelled stream */
      }
    }, 10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({
      status: 'failed',
      bytes_observed: 4,
      issues: [{ code: 'aborted', message: 'The absolute body-transfer timeout was exceeded.' }],
    });
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.stream.locked).toBe(false);
  });

  it.each(['timeout_ms', 'body_idle_timeout_ms', 'body_timeout_ms'] as const)(
    'rejects malformed %s before transport',
    async (field) => {
      const fetcher = vi.fn(async () => new Response('small'));
      for (const value of [0, -1, NaN, Infinity, 1.5, 2_147_483_648]) {
        expect(await makeAdapter(fetcher).capture({ uri, [field]: value })).toMatchObject({
          status: 'invalid',
          issues: [{ code: 'invalid_timeout' }],
        });
      }
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(['idle', 'absolute'])(
    'continues acquisition after a body %s timeout and accounts partial bytes',
    async (kind) => {
      const stalled = fixture();
      const calls: string[] = [];
      const http = makeAdapter(async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/a-manual.pdf')) return stalled.response;
        return new Response(
          url === uri
            ? '<html><body><h1>Example Model</h1><a href="/a-manual.pdf">Manual</a><a href="/z-manual.pdf">Manual</a></body></html>'
            : '%PDF-complete',
          { headers: { 'content-type': url === uri ? 'text/html' : 'application/pdf' } },
        );
      });
      const pending = acquireOfficialSources({
        intake: {
          schema_version: '1.0',
          artifact_kind: 'product_intake',
          id: 'intake.timeout',
          manufacturer: 'Example',
          product_model: 'Example Model',
          official_product_uri: uri,
        },
        adapter: {
          capture: (request) =>
            http.capture({
              ...request,
              ...(kind === 'absolute' ? { body_timeout_ms: 9_000 } : {}),
            }),
        },
        profile: {
          schema_version: '1.2',
          id: 'example.reviewed',
          profile_status: 'reviewed',
          manufacturer: 'Example',
          publisher: 'Example',
          official_domains: ['example.test'],
          strategies: [],
          provenance: {
            source_artifact: 'offline fixture',
            observed_source_content_hash: 'sha256:' + 'a'.repeat(64),
          },
        },
      });
      await flush();
      stalled.send(7);
      await flush();
      await vi.advanceTimersByTimeAsync(kind === 'absolute' ? 9_000 : 10_000);
      const result = await pending;
      expect(calls).toEqual([
        uri,
        'https://example.test/a-manual.pdf',
        'https://example.test/z-manual.pdf',
      ]);
      expect(result.candidates[0].capture).toMatchObject({
        disposition: 'failed',
        bytes_observed: 7,
      });
      expect(result.candidates[0].capture?.artifact.content_digest).toBeUndefined();
      expect(result.candidates[1].capture?.disposition).toBe('authoritative');
      expect(stalled.cancel).toHaveBeenCalledOnce();
      expect(stalled.stream.locked).toBe(false);
      expect(
        result.seed_capture.bytes_observed! +
          result.candidates.reduce((sum, item) => sum + (item.capture?.bytes_observed ?? 0), 0),
      ).toBe(result.seed_capture.bytes_observed! + 7 + 13);
    },
  );
});
