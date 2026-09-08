import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HttpSourceCaptureAdapter,
  LocalSnapshotStore,
  artifactDigest,
  captureSourceForProduction,
  compareCaptureContent,
  replaySourceCaptureSnapshot,
} from '../src/index.js';

const resolvePublicHost = async (): Promise<readonly string[]> => ['93.184.216.34'];
const response = (body: BodyInit, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  });
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const fixedTimestamp = '2026-09-08T12:00:00.000Z';
const tempRoots: string[] = [];

const newTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'checkpoint-b-source-capture-'));
  tempRoots.push(root);
  return root;
};

const adapter = (fetcher: typeof fetch): HttpSourceCaptureAdapter =>
  new HttpSourceCaptureAdapter(fetcher, () => fixedTimestamp, resolvePublicHost);

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('production-safe source capture classification', () => {
  it('retains requested/final URI, redirect chain, and HTTP revision metadata when present', async () => {
    const calls: string[] = [];
    const capture = await captureSourceForProduction(
      adapter(async (input) => {
        calls.push(String(input));
        if (calls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: '/redirected', etag: '"redirect-hop"' },
          });
        }
        return response('<!doctype html><html><body><h1>Specs</h1></body></html>', {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            etag: '"abc123"',
            'last-modified': 'Tue, 08 Sep 2026 11:58:00 GMT',
            'content-length': '56',
          },
        });
      }),
      {
        capture_id: 'capture.redirects',
        uri: 'https://example.invalid/start',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    expect(capture.disposition).toBe('authoritative');
    expect(capture.artifact).toMatchObject({
      requested_uri: 'https://example.invalid/start',
      final_uri: 'https://example.invalid/redirected',
      etag: '"abc123"',
      last_modified: 'Tue, 08 Sep 2026 11:58:00 GMT',
      response_status: 200,
      redirect_chain: [
        {
          requested_uri: 'https://example.invalid/start',
          response_status: 302,
          location: '/redirected',
          destination_uri: 'https://example.invalid/redirected',
        },
      ],
    });
    expect(capture.artifact.source_provenance).not.toHaveProperty('redirect_chain');
    expect(capture.artifact.source_provenance).not.toHaveProperty('reason_codes');
    expect(capture.source?.redirect_chain).toEqual([
      expect.objectContaining({
        requested_uri: 'https://example.invalid/start',
        response_status: 302,
        location: '/redirected',
        destination_uri: 'https://example.invalid/redirected',
      }),
    ]);
    expect(calls).toEqual(['https://example.invalid/start', 'https://example.invalid/redirected']);
  });

  it('keeps missing etag/last-modified absent and does not fabricate media type', async () => {
    const capture = await captureSourceForProduction(
      adapter(
        async () =>
          new Response(new TextEncoder().encode('<html><body>hello</body></html>'), {
            status: 200,
            headers: {},
          }),
      ),
      {
        capture_id: 'capture.missing-metadata',
        uri: 'https://example.invalid/no-content-type',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    expect(capture.disposition).toBe('non_authoritative');
    expect(capture.artifact.reason_codes).toEqual(['content_type_mismatch']);
    expect(capture.artifact.etag).toBeUndefined();
    expect(capture.artifact.last_modified).toBeUndefined();
    expect(capture.artifact.media_type).toBeUndefined();
    expect(capture.reasons.map((reason) => reason.code)).toContain('content_type_mismatch');
  });

  it('produces deterministic SHA-256 identity and deterministic same/changed comparison', async () => {
    const one = await captureSourceForProduction(
      adapter(async () => response('<!doctype html><html><body>same bytes</body></html>')),
      {
        capture_id: 'capture.same.1',
        uri: 'https://example.invalid/a',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    const two = await captureSourceForProduction(
      adapter(async () => response('<!doctype html><html><body>same bytes</body></html>')),
      {
        capture_id: 'capture.same.2',
        uri: 'https://example.invalid/b',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    const changed = await captureSourceForProduction(
      adapter(async () => response('<!doctype html><html><body>changed bytes</body></html>')),
      {
        capture_id: 'capture.changed',
        uri: 'https://example.invalid/a',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    expect(one.artifact.content_digest).toBe(
      `sha256:${createHash('sha256')
        .update('<!doctype html><html><body>same bytes</body></html>', 'utf8')
        .digest('hex')}`,
    );
    expect(compareCaptureContent(one.artifact.content_digest, two.artifact.content_digest)).toBe(
      'same_content',
    );
    expect(
      compareCaptureContent(one.artifact.content_digest, changed.artifact.content_digest),
    ).toBe('changed_content');
  });

  it.each([
    [
      'text/html; charset=utf-8',
      '<!doctype html><html><body><h1>Product</h1></body></html>',
      'authoritative',
    ],
    ['application/pdf', pdfBytes, 'authoritative'],
    ['application/pdf', '<!doctype html><html><body>challenge</body></html>', 'non_authoritative'],
    ['text/html', pdfBytes, 'non_authoritative'],
  ] as const)(
    'classifies content-type/body congruence for %s',
    async (contentType, body, expectedDisposition) => {
      const capture = await captureSourceForProduction(
        adapter(async () => response(body, { headers: { 'content-type': contentType } })),
        {
          capture_id: `capture.congruence.${contentType}`,
          uri: 'https://example.invalid/content',
          retention_status: 'not_retained',
          retrieved_at: fixedTimestamp,
        },
      );
      expect(capture.disposition).toBe(expectedDisposition);
      if (expectedDisposition === 'non_authoritative') {
        expect(capture.reasons.map((reason) => reason.code)).toContain('content_type_mismatch');
      }
    },
  );

  it.each([
    [
      'cloudflare',
      '<!doctype html><html><body><h1>Checking your browser before accessing</h1><p>Cloudflare Ray ID</p><div id="cf-browser-verification"></div></body></html>',
      'challenge_detected',
    ],
    [
      'captcha',
      '<!doctype html><html><body><h1>Human verification</h1><p>Please complete the CAPTCHA to verify you are human.</p></body></html>',
      'challenge_detected',
    ],
    [
      'login',
      '<!doctype html><html><body><h1>Sign in</h1><form><input type="password" /></form></body></html>',
      'authentication_wall',
    ],
    [
      'consent',
      '<!doctype html><html><body><h1>Cookie Consent</h1><p>Manage consent preferences</p></body></html>',
      'consent_interstitial',
    ],
    [
      'access-denied',
      '<!doctype html><html><body><h1>Access denied</h1><p>Bot verification required.</p></body></html>',
      'challenge_detected',
    ],
  ] as const)(
    'classifies %s fixtures as non-authoritative',
    async (_fixture, html, expectedCode) => {
      const capture = await captureSourceForProduction(
        adapter(async () => response(html)),
        {
          capture_id: `capture.challenge.${expectedCode}`,
          uri: 'https://www.official-example.com/product',
          retention_status: 'not_retained',
          retrieved_at: fixedTimestamp,
        },
      );
      expect(capture.disposition).toBe('non_authoritative');
      expect(capture.reasons.map((reason) => reason.code)).toContain(expectedCode);
      expect(capture.artifact.reason_codes).toContain(expectedCode);
    },
  );

  it('classifies soft-404, empty body, and trivial app shells conservatively', async () => {
    const soft404 = await captureSourceForProduction(
      adapter(async () =>
        response(
          '<!doctype html><html><body><h1>Page not found</h1><p>The product is no longer available.</p></body></html>',
        ),
      ),
      {
        capture_id: 'capture.soft404',
        uri: 'https://example.invalid/soft404',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    expect(soft404.disposition).toBe('non_authoritative');
    expect(soft404.reasons.map((reason) => reason.code)).toContain('soft_404');

    const empty = await captureSourceForProduction(
      adapter(async () => response('', { headers: { 'content-type': 'text/html' } })),
      {
        capture_id: 'capture.empty',
        uri: 'https://example.invalid/empty',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    expect(empty.disposition).toBe('empty');
    expect(empty.reasons.map((reason) => reason.code)).toContain('empty_content');
    expect(empty.artifact.reason_codes).toEqual(['empty_content']);

    const appShell = await captureSourceForProduction(
      adapter(async () =>
        response(
          '<!doctype html><html><body><div id="root"></div><script>window.__INITIAL_STATE__={}</script></body></html>',
        ),
      ),
      {
        capture_id: 'capture.shell',
        uri: 'https://example.invalid/shell',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    expect(appShell.disposition).toBe('non_authoritative');
    expect(appShell.reasons.map((reason) => reason.code)).toContain('empty_content');
  });

  it('does not falsely classify ordinary sparse valid HTML as a soft-404', async () => {
    const capture = await captureSourceForProduction(
      adapter(async () =>
        response(
          '<!doctype html><html><body><h1>Battery monitor</h1><p>Nominal voltage 12-48 V. Continuous current 500 A.</p></body></html>',
        ),
      ),
      {
        capture_id: 'capture.sparse-valid',
        uri: 'https://example.invalid/sparse-valid',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    expect(capture.disposition).toBe('authoritative');
  });

  it('supports expected-content pass/fail without transport failure', async () => {
    const pass = await captureSourceForProduction(
      adapter(async () =>
        response('<!doctype html><html><body><h1>Exact MPN SCC123</h1></body></html>'),
      ),
      {
        capture_id: 'capture.expected-pass',
        uri: 'https://example.invalid/mpn',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
        expected_content: [{ kind: 'text_includes', value: 'SCC123' }],
      },
    );
    expect(pass.disposition).toBe('authoritative');

    const fail = await captureSourceForProduction(
      adapter(async () =>
        response('<!doctype html><html><body><h1>Different content</h1></body></html>'),
      ),
      {
        capture_id: 'capture.expected-fail',
        uri: 'https://example.invalid/mpn',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
        expected_content: [{ kind: 'text_includes', value: 'SCC123' }],
      },
    );
    expect(fail.disposition).toBe('non_authoritative');
    expect(fail.reasons.map((reason) => reason.code)).toContain('expected_content_missing');
    expect(fail.artifact.reason_codes).toEqual(['expected_content_missing']);
  });

  it('supports expected JSON-path assertions with safe path syntax', async () => {
    const jsonCapture = await captureSourceForProduction(
      adapter(async () =>
        response('{"product":{"mpn":"ABC-1"}}', { headers: { 'content-type': 'application/pdf' } }),
      ),
      {
        capture_id: 'capture.expected-json-fail',
        uri: 'https://example.invalid/json',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
        expected_content: [{ kind: 'json_path_exists', path: '$.product.mpn' }],
      },
    );
    expect(jsonCapture.disposition).toBe('non_authoritative');
    expect(jsonCapture.reasons.map((reason) => reason.code)).toContain('content_type_mismatch');
  });
});

describe('snapshot storage and replay', () => {
  it('stores retained bytes content-addressably and reuses immutable references', async () => {
    const root = await newTempRoot();
    const store = new LocalSnapshotStore(root);
    const bytes = new TextEncoder().encode('retained payload');
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const first = await store.writeSnapshot(bytes, digest);
    const second = await store.writeSnapshot(bytes, digest);
    expect(first.reference).toBe(second.reference);
    expect(first.digest).toBe(second.digest);
  });

  it('returns different references for different bytes and blocks traversal references', async () => {
    const root = await newTempRoot();
    const store = new LocalSnapshotStore(root);
    const aDigest = `sha256:${createHash('sha256').update('a', 'utf8').digest('hex')}`;
    const bDigest = `sha256:${createHash('sha256').update('b', 'utf8').digest('hex')}`;
    const a = await store.writeSnapshot(new TextEncoder().encode('a'), aDigest);
    const b = await store.writeSnapshot(new TextEncoder().encode('b'), bDigest);
    expect(a.reference).not.toBe(b.reference);
    await expect(store.readSnapshot('snapshot://sha256/../../etc/passwd')).rejects.toThrow(
      /Unsupported snapshot reference/,
    );
  });

  it('captures retained snapshots when permitted and omits snapshot when not retained/permitted', async () => {
    const root = await newTempRoot();
    const store = new LocalSnapshotStore(root);
    const retained = await captureSourceForProduction(
      adapter(async () => response('<!doctype html><html><body>retain me</body></html>')),
      {
        capture_id: 'capture.retained',
        uri: 'https://example.invalid/retained',
        retention_status: 'retained',
        retrieved_at: fixedTimestamp,
      },
      { snapshot_store: store },
    );
    expect(retained.artifact.snapshot?.reference).toMatch(/^snapshot:\/\/sha256\/[a-f0-9]{64}$/);
    expect(retained.artifact.retention_status).toBe('retained');
    expect(retained.artifact.content_digest).toBeTruthy();

    const notRetained = await captureSourceForProduction(
      adapter(async () => response('<!doctype html><html><body>do not retain</body></html>')),
      {
        capture_id: 'capture.not-retained',
        uri: 'https://example.invalid/not-retained',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
      { snapshot_store: store },
    );
    const notPermitted = await captureSourceForProduction(
      adapter(async () => response('<!doctype html><html><body>not permitted</body></html>')),
      {
        capture_id: 'capture.not-permitted',
        uri: 'https://example.invalid/not-permitted',
        retention_status: 'not_permitted',
        retrieved_at: fixedTimestamp,
      },
      { snapshot_store: store },
    );
    expect(notRetained.artifact.snapshot).toBeUndefined();
    expect(notPermitted.artifact.snapshot).toBeUndefined();
  });

  it('replays retained bytes with digest verification and fails explicit corruption', async () => {
    const root = await newTempRoot();
    const store = new LocalSnapshotStore(root);
    const captured = await captureSourceForProduction(
      adapter(async () => response('<!doctype html><html><body>replay bytes</body></html>')),
      {
        capture_id: 'capture.replay',
        uri: 'https://example.invalid/replay',
        retention_status: 'retained',
        retrieved_at: fixedTimestamp,
      },
      { snapshot_store: store },
    );
    const replay = await replaySourceCaptureSnapshot(captured.artifact, store);
    expect(replay.status).toBe('replayed');
    expect(replay.bytes?.byteLength).toBeGreaterThan(0);

    const path = store.resolveSnapshotPath(captured.artifact.snapshot?.reference ?? '');
    await writeFile(path, new TextEncoder().encode('tampered bytes'));
    const corrupted = await replaySourceCaptureSnapshot(captured.artifact, store);
    expect(corrupted.status).toBe('failed');
    expect(corrupted.issue?.code).toBe('snapshot_digest_mismatch');
  });

  it('returns explicit failure when a retained snapshot is missing', async () => {
    const root = await newTempRoot();
    const store = new LocalSnapshotStore(root);
    const replay = await replaySourceCaptureSnapshot(
      {
        content_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        snapshot: undefined,
      },
      store,
    );
    expect(replay.status).toBe('failed');
    expect(replay.issue?.code).toBe('snapshot_missing');
  });
});

describe('production artifact mapping and determinism', () => {
  it('preserves digest on authoritative and non-authoritative content without inventing revisions', async () => {
    const authoritative = await captureSourceForProduction(
      adapter(async () =>
        response('<!doctype html><html><body><h1>Authoritative fixture</h1></body></html>'),
      ),
      {
        capture_id: 'capture.artifact.authoritative',
        uri: 'https://example.invalid/artifact-authoritative',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    const nonAuthoritative = await captureSourceForProduction(
      adapter(async () =>
        response(
          '<!doctype html><html><body><h1>Access denied</h1><p>bot verification required</p></body></html>',
        ),
      ),
      {
        capture_id: 'capture.artifact.non-authoritative',
        uri: 'https://example.invalid/artifact-non-authoritative',
        retention_status: 'not_retained',
        retrieved_at: fixedTimestamp,
      },
    );
    expect(authoritative.artifact.content_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(nonAuthoritative.artifact.content_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(authoritative.artifact.document_revision).toBeUndefined();
    expect(authoritative.artifact.publication_date).toBeUndefined();
    expect(nonAuthoritative.artifact.document_revision).toBeUndefined();
    expect(nonAuthoritative.artifact.publication_date).toBeUndefined();
  });

  it('produces deterministic artifacts for identical explicit capture inputs', async () => {
    const make = async () =>
      captureSourceForProduction(
        adapter(async () =>
          response('<!doctype html><html><body><h1>Deterministic fixture</h1></body></html>'),
        ),
        {
          capture_id: 'capture.deterministic',
          uri: 'https://example.invalid/deterministic',
          retention_status: 'not_retained',
          retrieved_at: fixedTimestamp,
          source_provenance: { fixture: 'deterministic' },
        },
      );
    const first = await make();
    const second = await make();
    expect(first.artifact).toEqual(second.artifact);
    expect(artifactDigest(first.artifact)).toBe(artifactDigest(second.artifact));
  });

  it('keeps transport failures as failed disposition and prevents retained-without-snapshot artifacts', async () => {
    const failed = await captureSourceForProduction(
      adapter(
        async () =>
          new Response('missing', { status: 503, headers: { 'content-type': 'text/html' } }),
      ),
      {
        capture_id: 'capture.transport-failed',
        uri: 'https://example.invalid/http503',
        retention_status: 'retained',
        retrieved_at: fixedTimestamp,
      },
    );
    expect(failed.disposition).toBe('failed');
    expect(failed.artifact.retention_status).toBe('unknown');
    expect(failed.artifact.snapshot).toBeUndefined();
    expect(failed.reasons.map((reason) => reason.code)).toContain('http_status');
  });
});
