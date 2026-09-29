import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acquireOfficialSources,
  HttpSourceCaptureAdapter,
  manufacturerAcquisitionProfileDigest,
  PRODUCTION_SCHEMA_VERSION,
  validateProductionArtifactSchema,
  validateSourceAcquisition,
  type CapturedSource,
  type ManufacturerAcquisitionProfile,
  type ProductIntake,
  type SourceCaptureAdapter,
} from '../src/index.js';

const page = readFileSync(join(__dirname, 'fixtures', 'checkpoint-c-source-page.html'), 'utf8');
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const hash = (value: Uint8Array): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const intake = (overrides: Partial<ProductIntake> = {}): ProductIntake => ({
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.example',
  manufacturer: 'Example Manufacturer',
  product_model: 'Example Model',
  manufacturer_part_number: 'EX-1',
  official_product_uri: 'https://example.test/products/ex-1',
  ...overrides,
});

describe('one-level manual child-document discovery', () => {
  const seed = intake().official_product_uri;
  const index = 'https://example.test/media/pg/device/en/index-en.html';
  const specs = 'https://example.test/media/pg/device/en/technical-specifications.html';
  const installation = 'https://example.test/media/pg/device/en/installation.html';
  const html = (links: string) =>
    `<html><body>${'Example device information. '.repeat(100)}${links}</body></html>`;
  const seedLinks = (extra = '') =>
    html(`<h2>Product Manuals</h2><ul><li><a href="${index}">HTML5</a></li></ul>${extra}`);
  const indexLinks = (extra = '') =>
    html(
      `<a href="technical-specifications.html">Technical specifications</a><a href="installation.html">Installation</a>${extra}`,
    );
  const fixtures = (seedHtml = seedLinks(), indexHtml = indexLinks()) => ({
    [seed]: source(seed, bytes(seedHtml), 'text/html'),
    [index]: source(index, bytes(indexHtml), 'text/html'),
    [specs]: source(specs, bytes(html('<a href="grandchild-manual.html">Manual</a>')), 'text/html'),
    [installation]: source(installation, bytes(html('Installation instructions')), 'text/html'),
  });
  const run = (
    responses = fixtures(),
    policy: {
      max_recursion_depth?: number;
      max_discovered_candidates?: number;
      max_captured_candidates?: number;
    } = {},
  ) =>
    acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor(responses),
      policy,
    });

  it('keeps child discovery disabled at default depth zero', async () => {
    const result = await run();
    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual([index]);
  });

  it('admits exactly fifty distinct seed resources despite repeated fragment anchors', async () => {
    const anchors = Array.from({ length: 51 }, (_, resource) =>
      Array.from(
        { length: 12 },
        (_, fragment) =>
          `<a href="/manual-${String(resource).padStart(2, '0')}.html#part-${fragment}">Manual part ${fragment}</a>`,
      ).join(''),
    ).join('');
    const result = await run(fixtures(html(anchors)), { max_captured_candidates: 0 });
    expect(new Set(result.candidates.map(({ candidate }) => candidate.normalized_uri)).size).toBe(
      50,
    );
    expect(result.candidates).toHaveLength(50 * 8);
    expect(validateSourceAcquisition(result.artifact!)).toEqual([]);
    expect(validateProductionArtifactSchema(result.artifact)).toEqual([]);
    expect(
      result.candidates.filter(({ candidate }) => candidate.selection_status === 'duplicate_uri'),
    ).toHaveLength(50 * 7);
    expect(result.candidates.at(-1)?.candidate.normalized_uri).toBe(
      'https://example.test/manual-49.html',
    );
    expect(result.candidates.some(({ candidate }) => candidate.discovery.parent_uri !== seed)).toBe(
      false,
    );
  });

  it('budgets fragment resources globally while bounding and retaining parent provenance', async () => {
    const fragments = Array.from(
      { length: 2000 },
      (_, i) => `<a href="installation.html#section-${i}">Installation section ${i}</a>`,
    ).join('');
    const responses = fixtures(
      seedLinks(
        `<a href="${installation}#direct">Installation direct</a><a href="/z-manual.pdf">Manual</a>`,
      ),
      indexLinks(fragments),
    );
    const calls: string[] = [];
    const adapter = adapterFor(responses);
    const request = {
      intake: intake(),
      profile: noStrategyProfile,
      adapter: {
        async capture(request: Parameters<SourceCaptureAdapter['capture']>[0]) {
          calls.push(request.uri);
          return adapter.capture(request);
        },
      },
      policy: { max_recursion_depth: 1, max_discovered_candidates: 3, max_captured_candidates: 2 },
    };
    const result = await acquireOfficialSources(request);
    const uris = result.candidates.map(({ candidate }) => candidate.normalized_uri);
    expect([...new Set(uris)]).toEqual([index, specs, installation]);
    expect(uris).not.toContain('https://example.test/z-manual.pdf');
    const installations = result.candidates.filter(
      ({ candidate }) => candidate.normalized_uri === installation,
    );
    expect(installations).toHaveLength(9);
    expect(
      installations.filter(({ candidate }) => candidate.selection_status === 'duplicate_uri'),
    ).toHaveLength(8);
    expect(installations.map(({ candidate }) => candidate.discovery.parent_uri)).toEqual([
      ...Array<string>(8).fill(index),
      seed,
    ]);
    expect(installations[1]?.candidate.discovery).toMatchObject({
      parent_capture_id: result.candidates[0]?.capture?.artifact.id,
      raw_discovered_uri: 'installation.html#section-0',
      source_label: 'Installation section 0',
      method: 'seed_page_anchor',
      locator: 'href[2]',
    });
    expect(calls.filter((uri) => uri === installation)).toHaveLength(0);
    expect(result.candidates.filter(({ capture }) => capture)).toHaveLength(2);
    expect(
      result.candidates.find(({ candidate }) => candidate.normalized_uri === installation)
        ?.candidate.selection_status,
    ).toBe('discovered');
    expect(result.issues).toContain(
      'Discovery provenance limited to eight occurrences per resource per parent.',
    );
    const repeated = await acquireOfficialSources(request);
    expect(repeated.artifact?.deterministic_snapshot).toBe(result.artifact?.deterministic_snapshot);
  });

  it('preserves redirect alias suppression independently of resource budgeting', async () => {
    const alias = 'https://example.test/a-manual.html';
    const target = 'https://example.test/b-manual.html';
    const adapter = adapterFor({
      [seed]: source(
        seed,
        bytes(html(`<a href="${alias}">Manual</a><a href="${target}#part">Manual target</a>`)),
        'text/html',
      ),
      [alias]: source(alias, bytes(html('Manual content')), 'text/html', target),
    });
    const result = await acquireOfficialSources({
      intake: intake(),
      adapter,
      policy: { max_discovered_candidates: 2 },
    });
    expect(result.candidates.map(({ candidate }) => candidate.selection_status)).toEqual([
      'selected',
      'duplicate_uri',
    ]);
    expect(result.candidates[1]?.candidate.duplicate_of_candidate_id).toBe(
      result.candidates[0]?.candidate.id,
    );
    expect(result.candidates.filter(({ capture }) => capture)).toHaveLength(1);
  });

  it('expands an authoritative structurally admitted HTML index with an unknown role', async () => {
    const result = await run(fixtures(), { max_recursion_depth: 1 });
    expect(result.candidates[0]?.candidate.role).toBe('unknown');
    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual([
      index,
      specs,
      installation,
    ]);
  });

  it('expands a Manual-labelled HTML index in the same bounded context', async () => {
    const result = await run(fixtures(seedLinks().replace('HTML5', 'Manual')), {
      max_recursion_depth: 1,
    });
    expect(result.candidates[0]?.candidate.role).toBe('manual');
    expect(result.candidates.some(({ candidate }) => candidate.normalized_uri === specs)).toBe(
      true,
    );
  });

  it('does not expand an ordinary technical HTML link outside manual context', async () => {
    const support = 'https://example.test/support/technical.html';
    const result = await run(
      {
        ...fixtures(html(`<a href="${support}">Technical support</a>`)),
        [support]: source(support, bytes(indexLinks()), 'text/html'),
      },
      { max_recursion_depth: 1 },
    );
    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual([support]);
  });

  it('offers a child a capture slot before later seed work exhausts the global budget', async () => {
    const later = 'https://example.test/z-technical.html';
    const result = await run(
      {
        ...fixtures(seedLinks(`<a href="${later}">Technical document</a>`)),
        [later]: source(later, bytes(html('Later technical source')), 'text/html'),
      },
      { max_recursion_depth: 1, max_captured_candidates: 2, max_discovered_candidates: 4 },
    );
    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual([
      index,
      specs,
      installation,
      later,
    ]);
    expect(
      result.candidates
        .filter(({ capture }) => capture)
        .map(({ candidate }) => candidate.normalized_uri),
    ).toEqual([index, specs]);
    expect(result.candidates[3]?.candidate.selection_status).toBe('discovered');
  });

  it('filters technical chapter links and excludes ordinary navigation', async () => {
    const result = await run(
      fixtures(seedLinks(), indexLinks('<a href="/home">Home</a><a href="next.html">Next</a>')),
      { max_recursion_depth: 1 },
    );
    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual([
      index,
      specs,
      installation,
    ]);
  });

  it('does not expand depth-one HTML chapters', async () => {
    const result = await run(fixtures(), { max_recursion_depth: 1 });
    expect(
      result.candidates.some(({ candidate }) => candidate.normalized_uri.includes('grandchild')),
    ).toBe(false);
  });

  it('does not expand a failed or non-authoritative index', async () => {
    const failed = await run({ ...fixtures(), [index]: 'failed' }, { max_recursion_depth: 1 });
    const challenged = source(
      index,
      bytes(html(`Cloudflare checking your browser cf-ray ${'challenge '.repeat(20)}`)),
      'text/html',
    );
    const nonAuthoritative = await run(
      { ...fixtures(), [index]: challenged },
      { max_recursion_depth: 1 },
    );
    expect(failed.candidates).toHaveLength(1);
    expect(nonAuthoritative.candidates).toHaveLength(1);
  });

  it('applies official-domain policy to each child', async () => {
    const offDomain = 'https://other.test/technical-specifications.html';
    const result = await run(
      fixtures(seedLinks(), indexLinks(`<a href="${offDomain}">Technical specifications</a>`)),
      { max_recursion_depth: 1 },
    );
    expect(
      result.candidates.find(({ candidate }) => candidate.normalized_uri === offDomain)?.candidate,
    ).toMatchObject({ officiality: 'blocked', selection_status: 'excluded_by_policy' });
  });

  it('suppresses normalized seed cycles while preserving other children', async () => {
    const result = await run(
      fixtures(
        seedLinks(),
        indexLinks(`<a href="${seed}#top">Product manual</a><a href="${index}#again">Manual</a>`),
      ),
      { max_recursion_depth: 1 },
    );
    expect(result.candidates.some(({ candidate }) => candidate.normalized_uri === seed)).toBe(
      false,
    );
    expect(
      result.candidates.filter(({ candidate }) => candidate.normalized_uri === index),
    ).toHaveLength(2);
    expect(
      result.candidates.find(
        ({ candidate }) =>
          candidate.normalized_uri === index && candidate.discovery.parent_uri === index,
      )?.candidate.selection_status,
    ).toBe('duplicate_uri');
  });

  it('captures a direct and child link to the same URI only once', async () => {
    let captures = 0;
    const adapter = adapterFor(
      fixtures(seedLinks(`<a href="${specs}">Technical specifications</a>`)),
    );
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: {
        async capture(request) {
          if (request.uri === specs) captures += 1;
          return adapter.capture(request);
        },
      },
      policy: { max_recursion_depth: 1 },
    });
    expect(captures).toBe(1);
    expect(
      result.candidates
        .filter(({ candidate }) => candidate.normalized_uri === specs)
        .map(({ candidate }) => candidate.selection_status),
    ).toEqual(['selected', 'duplicate_uri']);
    expect(
      result.candidates.find(
        ({ candidate }) =>
          candidate.normalized_uri === specs && candidate.selection_status === 'duplicate_uri',
      )?.candidate.discovery.parent_capture_id,
    ).toBe(result.seed_capture.artifact.id);
  });

  it('shares the discovered-candidate budget across seed and child links', async () => {
    const result = await run(fixtures(), { max_recursion_depth: 1, max_discovered_candidates: 2 });
    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual([
      index,
      specs,
    ]);
  });

  it('shares the capture budget across seed and child links', async () => {
    const result = await run(fixtures(), { max_recursion_depth: 1, max_captured_candidates: 1 });
    expect(result.candidates.filter(({ capture }) => capture)).toHaveLength(1);
    expect(
      result.candidates
        .slice(1)
        .every(({ candidate }) => candidate.capture_outcome === 'not_attempted'),
    ).toBe(true);
  });

  it('counts successful seed and candidate bytes within the acquisition budget', async () => {
    const seedHtml = `<html><body>${'seed-'.repeat(220)}<a href="${index}">Product page</a></body></html>`;
    const indexHtml = `<html><body>${'Example device information. '.repeat(36)}<a href="technical-specifications.html">Technical specifications</a></body></html>`;
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor({
        ...fixtures(),
        [seed]: source(seed, bytes(seedHtml), 'text/html'),
        [index]: source(index, bytes(indexHtml), 'text/html'),
      }),
      policy: { max_acquisition_bytes: 3000, max_recursion_depth: 1 },
    });
    expect(bytes(seedHtml).length).toBeGreaterThan(1000);
    expect(bytes(indexHtml).length).toBeGreaterThan(1000);
    expect(result.acquisition_bytes_used).toBeGreaterThanOrEqual(2000);
    expect(result.acquisition_bytes_used).toBeLessThanOrEqual(3000);
    expect(result.acquisition_byte_limit).toBe(3000);
    expect(result.candidates[0]?.capture).toBeDefined();
  });

  it('cannot bypass the acquisition budget by a sequence of individually legal captures', async () => {
    const seedHtml = `<html><body>${'seed-'.repeat(80)}<a href="${index}">Product page</a></body></html>`;
    const indexHtml = `<html><body>${'Example device information. '.repeat(18)}<a href="technical-specifications.html">Technical specifications</a><a href="installation.html">Installation</a></body></html>`;
    const specsHtml = `<html><body>${'Example device information. '.repeat(18)}</body></html>`;
    const installationHtml = `<html><body>${'Example device information. '.repeat(18)}</body></html>`;
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor({
        ...fixtures(),
        [seed]: source(seed, bytes(seedHtml), 'text/html'),
        [index]: source(index, bytes(indexHtml), 'text/html'),
        [specs]: source(specs, bytes(specsHtml), 'text/html'),
        [installation]: source(installation, bytes(installationHtml), 'text/html'),
      }),
      policy: { max_acquisition_bytes: 1400, max_recursion_depth: 1, max_captured_candidates: 10 },
    });
    expect(bytes(seedHtml).length).toBeLessThan(1400);
    expect(bytes(indexHtml).length).toBeLessThan(1400);
    expect(result.acquisition_bytes_used).toBeLessThanOrEqual(1400);
    expect(result.candidates.filter(({ capture }) => capture)).toHaveLength(1);
  });

  it('does not charge an early Content-Length rejection and lets a later resource use the budget', async () => {
    const seed = intake().official_product_uri;
    const first = 'https://example.test/docs/a-datasheet.pdf';
    const second = 'https://example.test/docs/b-datasheet.pdf';
    const seedHtml = `<html><body><h1>Example Model</h1><p>${'manufacturer product technical information '.repeat(100)}</p></body></html>`;
    const seedSize = bytes(seedHtml).byteLength;
    let firstBodyRead = false;
    const requests: string[] = [];
    const transport = new HttpSourceCaptureAdapter(
      async (input) => {
        const uri = String(input);
        requests.push(uri);
        if (uri === seed)
          return new Response(seedHtml, { headers: { 'content-type': 'text/html' } });
        if (uri === first) {
          return {
            status: 200,
            ok: true,
            url: uri,
            headers: new Headers({
              'content-type': 'application/pdf',
              'content-length': '5000',
            }),
            body: {
              getReader: () => ({
                read: async () => {
                  firstBodyRead = true;
                  return { done: true, value: undefined };
                },
                cancel: async () => undefined,
                releaseLock: () => undefined,
              }),
            },
          } as unknown as Response;
        }
        return new Response(bytes('%PDF-1.7 small fixture'), {
          headers: { 'content-type': 'application/pdf' },
        });
      },
      undefined,
      async () => ['93.184.216.34'],
    );
    const result = await acquireOfficialSources({
      intake: intake({ additional_official_source_uris: [first, second] }),
      profile: noStrategyProfile,
      adapter: transport,
      policy: {
        max_acquisition_bytes: seedSize + 200,
        max_captured_candidates: 2,
      },
    });
    const rejected = result.candidates.find(({ candidate }) => candidate.normalized_uri === first);
    const later = result.candidates.find(({ candidate }) => candidate.normalized_uri === second);
    expect(firstBodyRead).toBe(false);
    expect(rejected?.capture?.artifact.reason_codes).toContain('response_too_large');
    expect(rejected?.capture?.bytes_observed).toBe(0);
    expect(later?.capture?.disposition).toBe('authoritative');
    expect(requests).toContain(second);
    expect(result.acquisition_bytes_used).toBe(
      seedSize + bytes('%PDF-1.7 small fixture').byteLength,
    );
    expect(result.acquisition_bytes_used).toBeLessThanOrEqual(seedSize + 200);
  });

  it('counts streamed bytes beyond the threshold and skips all later candidate captures', async () => {
    const seed = intake().official_product_uri;
    const first = 'https://example.test/docs/a-datasheet.pdf';
    const second = 'https://example.test/docs/b-datasheet.pdf';
    const seedHtml = `<html><body><h1>Example Model</h1><p>${'manufacturer product technical information '.repeat(100)}</p></body></html>`;
    const seedSize = bytes(seedHtml).byteLength;
    const streamedChunk = bytes('%PDF-1.7 ' + 'x'.repeat(300));
    const requests: string[] = [];
    const transport = new HttpSourceCaptureAdapter(
      async (input) => {
        const uri = String(input);
        requests.push(uri);
        if (uri === seed)
          return new Response(seedHtml, { headers: { 'content-type': 'text/html' } });
        if (uri === first)
          return new Response(streamedChunk, { headers: { 'content-type': 'application/pdf' } });
        return new Response(bytes('%PDF-1.7 later'), {
          headers: { 'content-type': 'application/pdf' },
        });
      },
      undefined,
      async () => ['93.184.216.34'],
    );
    const result = await acquireOfficialSources({
      intake: intake({ additional_official_source_uris: [first, second] }),
      profile: noStrategyProfile,
      adapter: transport,
      policy: {
        max_acquisition_bytes: seedSize + 200,
        max_captured_candidates: 2,
      },
    });
    const rejected = result.candidates.find(({ candidate }) => candidate.normalized_uri === first);
    const skipped = result.candidates.find(({ candidate }) => candidate.normalized_uri === second);
    expect(rejected?.capture?.artifact.reason_codes).toContain('response_too_large');
    expect(rejected?.capture?.bytes_observed).toBe(streamedChunk.byteLength);
    expect(result.acquisition_bytes_used).toBe(seedSize + streamedChunk.byteLength);
    expect(result.acquisition_bytes_used).toBeGreaterThan(result.acquisition_byte_limit!);
    expect(skipped?.candidate.selection_status).toBe('discovered');
    expect(skipped?.capture).toBeUndefined();
    expect(requests).not.toContain(second);
    expect(result.issues).toContain(
      `Capture skipped for ${skipped?.candidate.id}: the aggregate acquisition byte budget is exhausted.`,
    );
  });

  it('retains immediate-parent provenance for children and seed links', async () => {
    const result = await run(fixtures(seedLinks(`<a href="/docs/datasheet.pdf">Datasheet</a>`)), {
      max_recursion_depth: 1,
    });
    const parent = result.candidates.find(({ candidate }) => candidate.normalized_uri === index);
    const child = result.candidates.find(({ candidate }) => candidate.normalized_uri === specs);
    const direct = result.candidates.find(({ candidate }) =>
      candidate.normalized_uri.endsWith('/docs/datasheet.pdf'),
    );
    expect(child?.candidate.discovery).toMatchObject({
      parent_capture_id: parent?.capture?.artifact.id,
      parent_uri: index,
      raw_discovered_uri: 'technical-specifications.html',
      source_label: 'Technical specifications',
    });
    expect(direct?.candidate.discovery.parent_capture_id).toBe(result.seed_capture.artifact.id);
  });

  it('orders equivalent link sets deterministically and rejects unsupported depth', async () => {
    const first = await run(fixtures(seedLinks(), indexLinks()), { max_recursion_depth: 1 });
    const reversed = await run(
      fixtures(
        seedLinks(),
        html(
          '<a href="installation.html">Installation</a><a href="technical-specifications.html">Technical specifications</a>',
        ),
      ),
      { max_recursion_depth: 1 },
    );
    expect(first.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual(
      reversed.candidates.map(({ candidate }) => candidate.normalized_uri),
    );
    expect((await run(fixtures(), { max_recursion_depth: 2 })).status).toBe('blocked');
  });
});

const profile: ManufacturerAcquisitionProfile = {
  schema_version: '1.2',
  id: 'example.reviewed',
  profile_status: 'reviewed',
  manufacturer: 'Example Manufacturer',
  publisher: 'Example Manufacturer',
  official_domains: ['example.test'],
  approved_subdomains: ['www.example.test'],
  allowed_document_domains: ['cdn.example.test'],
  strategies: [
    {
      id: 'product-pages',
      status: 'reviewed',
      reference_uri: 'https://example.test/products/ex-1',
      path_prefix: '/products/',
      embedded_json: {
        representation: 'embedded_json',
        script: { id: 'not-present', media_type: 'application/json' },
        json_path: '$.product',
        record_collection_path: '$.documents',
        identity_property: 'sku',
      },
      document_link_discovery: {
        link_attribute: 'href',
        allowed_extensions: ['.pdf'],
        path_prefix: '/docs/',
        role_hints: [{ pattern: 'ambiguous', role: 'unknown' }],
        expected_content: [{ kind: 'text_includes', value: 'Example product' }],
      },
    },
  ],
  provenance: {
    source_artifact: 'tests/fixtures/checkpoint-c-source-page.html',
    observed_source_content_hash: hash(bytes(page)),
  },
};

const noStrategyProfile: ManufacturerAcquisitionProfile = {
  ...profile,
  strategies: [{ ...profile.strategies[0], path_prefix: '/solar-charge-controllers/' }],
};

const source = (
  requestedUri: string,
  body: Uint8Array,
  mediaType: string,
  finalUri = requestedUri,
): CapturedSource => ({
  requested_uri: requestedUri,
  final_uri: finalUri,
  retrieved_at: '2026-09-08T00:00:00.000Z',
  media_type: mediaType,
  response_status: 200,
  body: {
    bytes: body,
    ...(mediaType.includes('html') ? { text: new TextDecoder().decode(body) } : {}),
  },
  content_hash: hash(body),
});

const adapterFor = (
  responses: Readonly<Record<string, CapturedSource | 'failed'>>,
): SourceCaptureAdapter => ({
  async capture(request) {
    const response = responses[request.uri];
    if (response === 'failed' || !response) {
      return { status: 'failed', issues: [{ code: 'network_error', message: 'fixture failure' }] };
    }
    return { status: 'success', source: response, issues: [] };
  },
});

describe('candidate capture timeout isolation', () => {
  it('records a timed-out candidate and continues to a later eligible source', async () => {
    const seed = intake().official_product_uri;
    const timedOut = 'https://example.test/docs/first-datasheet.pdf';
    const later = 'https://example.test/docs/second-datasheet.pdf';
    const seedBody = bytes(
      `<html><body><h1>Example Model</h1><p>${'product information '.repeat(100)}</p><a href="${timedOut}">First datasheet</a><a href="${later}">Second datasheet</a></body></html>`,
    );
    const adapter: SourceCaptureAdapter = {
      async capture(request) {
        if (request.uri === seed) {
          return { status: 'success', source: source(seed, seedBody, 'text/html'), issues: [] };
        }
        if (request.uri === timedOut) {
          return {
            status: 'failed',
            bytes_observed: 17,
            issues: [{ code: 'aborted', message: 'The capture timed out or was aborted.' }],
          };
        }
        return {
          status: 'success',
          source: source(later, bytes('%PDF-1.7 later'), 'application/pdf'),
          issues: [],
        };
      },
    };

    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter,
      policy: { max_captured_candidates: 2 },
    });
    const timedOutResult = result.candidates.find(
      ({ candidate }) => candidate.normalized_uri === timedOut,
    );
    const laterResult = result.candidates.find(
      ({ candidate }) => candidate.normalized_uri === later,
    );

    expect(timedOutResult?.capture?.disposition).toBe('failed');
    expect(timedOutResult?.candidate.capture_outcome).toBe('failed');
    expect(timedOutResult?.candidate.capture_reason_codes).toContain('aborted');
    expect(timedOutResult?.capture?.bytes_observed).toBe(17);
    expect(laterResult?.capture?.disposition).toBe('authoritative');
    expect(result.acquisition_bytes_used).toBe(
      seedBody.byteLength + 17 + bytes('%PDF-1.7 later').byteLength,
    );
    expect(result.status).toBe('partially_acquired');
  });
});

const successfulResponses = (
  overrides: Readonly<Record<string, CapturedSource | 'failed'>> = {},
) => {
  const seed = intake().official_product_uri;
  const pdf = bytes('%PDF-1.7 project-authored fixture');
  const defaults: Record<string, CapturedSource | 'failed'> = {
    [seed]: source(seed, bytes(page), 'text/html'),
    'https://example.test/docs/example-datasheet.pdf': source(
      'https://example.test/docs/example-datasheet.pdf',
      pdf,
      'application/pdf',
    ),
    'https://example.test/docs/example-installation-manual.pdf': source(
      'https://example.test/docs/example-installation-manual.pdf',
      bytes('%PDF-1.7 installation'),
      'application/pdf',
    ),
    'https://example.test/docs/example-dimensional-drawing.pdf?download=1': source(
      'https://example.test/docs/example-dimensional-drawing.pdf?download=1',
      bytes('%PDF-1.7 drawing'),
      'application/pdf',
    ),
    'https://example.test/docs/example-technical-drawing.pdf': source(
      'https://example.test/docs/example-technical-drawing.pdf',
      bytes('%PDF-1.7 technical drawing'),
      'application/pdf',
    ),
    'https://example.test/docs/example-certificate.pdf': source(
      'https://example.test/docs/example-certificate.pdf',
      bytes('%PDF-1.7 certificate'),
      'application/pdf',
    ),
    'https://example.test/docs/ambiguous.pdf': source(
      'https://example.test/docs/ambiguous.pdf',
      bytes('%PDF-1.7 ambiguous'),
      'application/pdf',
    ),
    'https://cdn.example.test/docs/example-manual.pdf': source(
      'https://cdn.example.test/docs/example-manual.pdf',
      bytes('%PDF-1.7 manual'),
      'application/pdf',
    ),
    'https://example.test/support/compatibility.html': source(
      'https://example.test/support/compatibility.html',
      bytes(`<html><body>${'support compatibility '.repeat(80)}</body></html>`),
      'text/html',
    ),
  };
  return { ...defaults, ...overrides };
};

describe('Checkpoint C official-source discovery and acquisition', () => {
  it('propagates reviewed manufacturer profile publisher to the seed capture provenance', async () => {
    const reviewed = { ...profile, publisher: 'Reviewed Profile Publisher' };
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: reviewed,
      adapter: adapterFor(successfulResponses()),
    });

    expect(result.seed_capture.artifact.source_provenance?.publisher).toBe(reviewed.publisher);
  });

  it('propagates reviewed manufacturer profile publisher to discovered candidate capture provenance', async () => {
    const reviewed = { ...profile, publisher: 'Reviewed Profile Publisher' };
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: reviewed,
      adapter: adapterFor(successfulResponses()),
    });
    const datasheet = result.candidates.find(
      ({ candidate }) =>
        candidate.normalized_uri === 'https://example.test/docs/example-datasheet.pdf' &&
        candidate.selection_status === 'selected',
    );

    expect(datasheet?.capture?.artifact.source_provenance?.publisher).toBe(reviewed.publisher);
  });

  it('does not infer publisher without a reviewed manufacturer profile', async () => {
    const result = await acquireOfficialSources({
      intake: intake(),
      adapter: adapterFor(successfulResponses()),
    });

    expect(result.seed_capture.artifact.source_provenance).not.toHaveProperty('publisher');
    for (const { capture } of result.candidates) {
      if (capture) expect(capture.artifact.source_provenance).not.toHaveProperty('publisher');
    }
  });

  it('does not use an unreviewed profile as publisher provenance', async () => {
    const proposed = { ...profile, profile_status: 'proposed' as const };
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: proposed,
      adapter: adapterFor(successfulResponses()),
    });

    expect(result.artifact?.profile_binding).toBeUndefined();
    expect(result.seed_capture.artifact.source_provenance).not.toHaveProperty('publisher');
    for (const { capture } of result.candidates) {
      if (capture) expect(capture.artifact.source_provenance).not.toHaveProperty('publisher');
    }
  });

  it('preserves existing acquisition provenance while adding reviewed publisher', async () => {
    const result = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(successfulResponses()),
    });
    const datasheet = result.candidates.find(
      ({ candidate }) =>
        candidate.normalized_uri === 'https://example.test/docs/example-datasheet.pdf' &&
        candidate.selection_status === 'selected',
    );

    expect(result.seed_capture.artifact.source_provenance).toMatchObject({
      acquisition_stage: 'source_acquisition',
      source_role: 'product_page',
      publisher: profile.publisher,
    });
    expect(datasheet?.capture?.artifact.source_provenance).toMatchObject({
      acquisition_stage: 'source_acquisition',
      candidate_id: datasheet?.candidate.id,
      source_role: 'datasheet',
      publisher: profile.publisher,
    });
    expect(datasheet?.candidate.discovery).toMatchObject({
      parent_capture_id: result.seed_capture.artifact.id,
      method: 'seed_page_anchor',
      profile_id: profile.id,
      profile_rule_id: 'product-pages',
    });
  });

  it('captures a valid seed and discovers deterministic first-party candidates', async () => {
    const result = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(successfulResponses()),
      policy: { max_discovered_candidates: 20 },
    });
    expect(result.status).toBe('acquired');
    expect(result.artifact?.seed_capture.kind).toBe('source_capture');
    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toContain(
      'https://example.test/docs/example-datasheet.pdf',
    );
    expect(
      result.candidates.find(
        ({ candidate }) =>
          candidate.normalized_uri === 'https://third-party.test/example-datasheet.pdf',
      )?.candidate,
    ).toMatchObject({
      officiality: 'blocked',
      selection_status: 'excluded_by_policy',
      capture_outcome: 'not_attempted',
    });
    expect(
      result.candidates.find(({ candidate }) => candidate.normalized_uri.includes('ambiguous.pdf'))
        ?.candidate.role,
    ).toBe('unknown');
  });

  it('uses generic technical filtering when a reviewed profile has no applicable strategy', async () => {
    const seed = intake().official_product_uri;
    const html = `<html><body>${'Example product information. '.repeat(100)}
      <a href="/blog">Blog</a><a href="/contact">Contact</a><a href="/jobs">Jobs</a>
      <a href="/upload/documents/Datasheet-Example.pdf">Datasheet</a>
      <a href="/upload/documents/Example-Manual.pdf">Manual</a>
    </body></html>`;
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor({
        [seed]: source(seed, bytes(html), 'text/html'),
      }),
      policy: { max_captured_candidates: 0 },
    });
    const uris = result.candidates.map(({ candidate }) => candidate.normalized_uri);

    expect(uris).toEqual([
      'https://example.test/upload/documents/Datasheet-Example.pdf',
      'https://example.test/upload/documents/Example-Manual.pdf',
    ]);
    expect(
      result.candidates.every(({ candidate }) => candidate.discovery.profile_rule_id === undefined),
    ).toBe(true);
  });

  it('retains a format-only html manual link from manual section context', async () => {
    const seed = intake().official_product_uri;
    const html = `<html><body>${'Example device information. '.repeat(100)}
      <h2>Product Manuals</h2><ul><li><span>Example device</span>
      <a href="/media/pg/device/en/index-en.html">HTML5</a>
      <a href="/store">Store</a></li></ul></body></html>`;
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor({ [seed]: source(seed, bytes(html), 'text/html') }),
      policy: { max_captured_candidates: 0 },
    });

    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual([
      'https://example.test/media/pg/device/en/index-en.html',
    ]);
    expect(result.candidates[0]?.candidate).toMatchObject({
      raw_discovered_uri: '/media/pg/device/en/index-en.html',
      role: 'unknown',
      discovery: {
        raw_discovered_uri: '/media/pg/device/en/index-en.html',
        normalized_uri: 'https://example.test/media/pg/device/en/index-en.html',
        source_label: 'HTML5',
        method: 'seed_page_anchor',
        locator: 'href[0]',
        parent_capture_id: result.seed_capture.artifact.id,
        parent_uri: seed,
      },
    });
    expect(result.candidates[0]?.candidate.discovery.profile_rule_id).toBeUndefined();
  });

  it('does not retain the same format-only link outside technical context', async () => {
    const seed = intake().official_product_uri;
    const html = `<html><body>${'Example device information. '.repeat(100)}
      <h2>Community</h2><ul><li><span>Example device</span>
      <a href="/media/pg/device/en/index-en.html">HTML5</a></li></ul></body></html>`;
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor({ [seed]: source(seed, bytes(html), 'text/html') }),
      policy: { max_captured_candidates: 0 },
    });

    expect(result.candidates).toEqual([]);
  });

  it('does not borrow manual context from a neighboring list item', async () => {
    const seed = intake().official_product_uri;
    const html = `<html><body>${'Example device information. '.repeat(100)}
      <ul><li>Manual downloads</li><li><span>Example device</span>
      <a href="/media/pg/device/en/index-en.html">HTML5</a></li></ul></body></html>`;
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor({ [seed]: source(seed, bytes(html), 'text/html') }),
      policy: { max_captured_candidates: 0 },
    });

    expect(result.candidates).toEqual([]);
  });

  it('preserves ordinary technical term discovery with format-only context', async () => {
    const seed = intake().official_product_uri;
    const html = `<html><body>${'Example device information. '.repeat(100)}
      <h2>Product Manuals</h2><ul><li>
      <a href="/media/pg/device/en/index-en.html">HTML5</a></li></ul>
      <a href="/docs/datasheet.pdf">Datasheet</a>
      <a href="/docs/installation-manual.pdf">Installation manual</a>
      <a href="/docs/ordinary.pdf">PDF</a></body></html>`;
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor({ [seed]: source(seed, bytes(html), 'text/html') }),
      policy: { max_captured_candidates: 0 },
    });

    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual([
      'https://example.test/docs/datasheet.pdf',
      'https://example.test/docs/installation-manual.pdf',
      'https://example.test/media/pg/device/en/index-en.html',
    ]);
  });

  it('preserves deterministic discovery ordering and existing bounds for structural links', async () => {
    const seed = intake().official_product_uri;
    const html = `<html><body>${'Example device information. '.repeat(100)}
      <h2>Product Manuals</h2><ul><li>
      <a href="/z/index.html">HTML5</a><a href="/a/index.html">HTML</a>
      <a href="/m/index.html">PDF</a></li></ul></body></html>`;
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor({ [seed]: source(seed, bytes(html), 'text/html') }),
      policy: { max_discovered_candidates: 2, max_captured_candidates: 1 },
    });

    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual([
      'https://example.test/a/index.html',
      'https://example.test/m/index.html',
    ]);
    expect(result.candidates.map(({ candidate }) => candidate.selection_status)).toEqual([
      'selected',
      'discovered',
    ]);
  });

  it('does not let navigation crowd a technical document out of the discovery bound when no profile strategy applies', async () => {
    const seed = intake().official_product_uri;
    const navigation = Array.from(
      { length: 60 },
      (_, index) => `<a href="/a-${String(index).padStart(2, '0')}">Overview</a>`,
    ).join('');
    const documentUri = 'https://example.test/upload/documents/Datasheet-Example.pdf';
    const html = `<html><body>${'Example product information. '.repeat(100)}${navigation}
      <a href="${documentUri}">Datasheet</a></body></html>`;
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor({ [seed]: source(seed, bytes(html), 'text/html') }),
      policy: { max_captured_candidates: 0 },
    });

    expect(result.candidates.map(({ candidate }) => candidate.normalized_uri)).toEqual([
      documentUri,
    ]);
  });

  it('preserves strategy-aware discovery when a reviewed strategy applies', async () => {
    const result = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(successfulResponses()),
      policy: { max_captured_candidates: 0 },
    });
    const ambiguous = result.candidates.find(({ candidate }) =>
      candidate.normalized_uri.endsWith('/docs/ambiguous.pdf'),
    )?.candidate;

    expect(ambiguous?.selection_status).toBe('discovered');
    expect(ambiguous?.discovery.profile_rule_id).toBe('product-pages');
  });

  it('preserves generic technical filtering when no profile is supplied', async () => {
    const result = await acquireOfficialSources({
      intake: intake(),
      adapter: adapterFor(successfulResponses()),
      policy: { max_captured_candidates: 0 },
    });
    const uris = result.candidates.map(({ candidate }) => candidate.normalized_uri);

    expect(uris).toContain('https://example.test/docs/example-datasheet.pdf');
    expect(uris).not.toContain('https://example.test/docs/ambiguous.pdf');
  });

  it('preserves reviewed profile publisher and domain authority when no strategy applies', async () => {
    const seed = intake().official_product_uri;
    const official = 'https://example.test/upload/documents/Datasheet-Example.pdf';
    const thirdParty = 'https://third-party.test/Datasheet-Example.pdf';
    const html = `<html><body>${'Example product information. '.repeat(100)}
      <a href="${official}">Datasheet</a><a href="${thirdParty}">Datasheet mirror</a>
    </body></html>`;
    const result = await acquireOfficialSources({
      intake: intake(),
      profile: noStrategyProfile,
      adapter: adapterFor({
        [seed]: source(seed, bytes(html), 'text/html'),
        [official]: source(official, bytes('%PDF-1.7 example datasheet'), 'application/pdf'),
      }),
    });
    const officialCandidate = result.candidates.find(
      ({ candidate }) => candidate.normalized_uri === official,
    );
    const blockedCandidate = result.candidates.find(
      ({ candidate }) => candidate.normalized_uri === thirdParty,
    )?.candidate;

    expect(result.seed_capture.artifact.source_provenance?.publisher).toBe(profile.publisher);
    expect(result.artifact?.profile_binding?.profile_id).toBe(profile.id);
    expect(officialCandidate?.candidate.selection_status).toBe('selected');
    expect(officialCandidate?.capture?.artifact.source_provenance?.publisher).toBe(
      profile.publisher,
    );
    expect(blockedCandidate).toMatchObject({
      officiality: 'blocked',
      selection_status: 'excluded_by_policy',
      capture_outcome: 'not_attempted',
    });
  });

  it('retains relative/query/fragment provenance and deduplicates URI capture work', async () => {
    const result = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(successfulResponses()),
    });
    const datasheets = result.candidates.filter(({ candidate }) =>
      candidate.normalized_uri.includes('https://example.test/docs/example-datasheet.pdf'),
    );
    expect(datasheets).toHaveLength(2);
    expect(datasheets[0]?.candidate.selection_status).toBe('selected');
    expect(datasheets[0]?.candidate.capture_outcome).toBe('authoritative');
    expect(datasheets[1]?.candidate.selection_status).toBe('duplicate_uri');
    expect(datasheets[1]?.candidate.capture_outcome).toBe('not_attempted');
    expect(datasheets[1]?.candidate.discovery.raw_discovered_uri).toContain('#page=2');
    expect(datasheets[1]?.candidate.discovery.normalized_uri).toBe(
      datasheets[0]?.candidate.normalized_uri,
    );
    expect(datasheets[0]?.candidate.discovery.method).toBe('seed_page_anchor');
    expect(datasheets[0]?.candidate.discovery.profile_rule_id).toBe('product-pages');
  });

  it('classifies technical roles conservatively and leaves ambiguous PDFs unknown', async () => {
    const result = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(successfulResponses()),
    });
    const role = (needle: string) =>
      result.candidates.find(({ candidate }) => candidate.normalized_uri.includes(needle))
        ?.candidate.role;
    expect(role('datasheet')).toBe('datasheet');
    expect(role('installation')).toBe('installation_manual');
    expect(role('dimensional')).toBe('dimensional_drawing');
    expect(role('technical-drawing')).toBe('technical_drawing');
    expect(role('example-manual')).toBe('manual');
    expect(role('compatibility')).toBe('support_article');
    expect(role('certificate')).toBe('certificate');
    expect(role('ambiguous')).toBe('unknown');
    expect(result.candidates.find(({ candidate }) => candidate.role === 'unknown')).toBeTruthy();
  });

  it('enforces official alternate hosts and redirect final-domain policy', async () => {
    const redirectUri = 'https://cdn.example.test/docs/example-manual.pdf';
    const redirected = source(
      redirectUri,
      bytes('%PDF-1.7 redirected'),
      'application/pdf',
      'https://unapproved.example.test/docs/example-manual.pdf',
    );
    const result = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(successfulResponses({ [redirectUri]: redirected })),
    });
    const candidate = result.candidates.find(
      ({ candidate: item }) => item.normalized_uri === redirectUri,
    )?.candidate;
    expect(candidate?.officiality).toBe('blocked');
    expect(candidate?.selection_status).toBe('selected');
    expect(candidate?.capture_outcome).toBe('authoritative');
    expect(candidate?.capture).toBeTruthy();
  });

  it('isolates failed and challenged sources while preserving sibling captures', async () => {
    const failedUri = 'https://example.test/docs/example-datasheet.pdf';
    const challengeUri = 'https://example.test/docs/ambiguous.pdf';
    const challenge = source(
      challengeUri,
      bytes(
        `<html><body>Cloudflare checking your browser cf-ray ${'challenge '.repeat(20)}</body></html>`,
      ),
      'text/html',
    );
    const result = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(
        successfulResponses({ [failedUri]: 'failed', [challengeUri]: challenge }),
      ),
    });
    expect(result.status).toBe('partially_acquired');
    expect(
      result.candidates.find(({ candidate }) => candidate.normalized_uri === failedUri)?.candidate
        .capture_outcome,
    ).toBe('failed');
    expect(
      result.candidates.find(({ candidate }) => candidate.normalized_uri === challengeUri)
        ?.candidate.capture_outcome,
    ).toBe('non_authoritative');
    expect(
      result.candidates.some(({ candidate }) => candidate.capture_outcome === 'authoritative'),
    ).toBe(true);
  });

  it('does not treat a challenged seed as an acquired product page', async () => {
    const seed = intake().official_product_uri;
    const challenged = source(
      seed,
      bytes(
        `<html><body>Cloudflare checking your browser cf-ray ${'challenge '.repeat(20)}</body></html>`,
      ),
      'text/html',
    );
    const result = await acquireOfficialSources({
      intake: intake(),
      adapter: adapterFor({ [seed]: challenged }),
    });
    expect(result.status).toBe('seed_failed');
    expect(result.seed_capture.disposition).toBe('non_authoritative');
    expect(result.seed_capture.artifact.reason_codes).toContain('challenge_detected');
  });

  it('supports no-profile fallback, proposed-profile fallback, and insufficient sources', async () => {
    const fallback = await acquireOfficialSources({
      intake: intake(),
      adapter: adapterFor(successfulResponses()),
    });
    expect(fallback.status).toBe('acquired');
    expect(fallback.artifact?.profile_binding).toBeUndefined();

    const proposed = { ...profile, profile_status: 'proposed' as const };
    const proposedResult = await acquireOfficialSources({
      intake: intake(),
      profile: proposed,
      adapter: adapterFor(successfulResponses()),
    });
    expect(proposedResult.artifact?.profile_binding).toBeUndefined();

    const noLinks = await acquireOfficialSources({
      intake: intake({ official_product_uri: 'https://example.test/products/empty' }),
      adapter: adapterFor({
        'https://example.test/products/empty': source(
          'https://example.test/products/empty',
          bytes(`<html><body>${'product content '.repeat(100)}</body></html>`),
          'text/html',
        ),
      }),
    });
    expect(noLinks.status).toBe('insufficient_sources');
  });

  it('returns explicit seed failures and keeps acquisition snapshots deterministic', async () => {
    const malformed = await acquireOfficialSources({
      intake: intake({ official_product_uri: 'not a uri' }),
      adapter: adapterFor({}),
    });
    expect(malformed.status).toBe('seed_failed');
    expect(malformed.artifact?.status).toBe('seed_failed');

    const unsupported = await acquireOfficialSources({
      intake: intake({ official_product_uri: 'ftp://example.test/product' }),
      adapter: adapterFor({}),
    });
    expect(unsupported.seed_capture.artifact.reason_codes).toContain('unsupported_scheme');

    const first = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(successfulResponses()),
    });
    const second = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(successfulResponses()),
    });
    expect(first.artifact?.deterministic_snapshot).toBe(second.artifact?.deterministic_snapshot);
  });

  it('bounds discovery and capture without depending on completion order', async () => {
    const result = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(successfulResponses()),
      policy: { max_discovered_candidates: 3, max_captured_candidates: 1, max_recursion_depth: 1 },
    });
    expect(new Set(result.candidates.map(({ candidate }) => candidate.normalized_uri)).size).toBe(
      3,
    );
    expect(result.candidates.filter(({ candidate }) => candidate.capture).length).toBe(1);
    expect(
      result.candidates.some(({ candidate }) => candidate.selection_status === 'discovered'),
    ).toBe(true);
  });

  it('marks identical bytes as equivalent content without conflating URI duplicates', async () => {
    const same = bytes('%PDF-1.7 same bytes');
    const result = await acquireOfficialSources({
      intake: intake({
        additional_official_source_uris: [
          'https://example.test/docs/one.pdf',
          'https://example.test/docs/two.pdf',
        ],
      }),
      adapter: adapterFor({
        ...successfulResponses(),
        'https://example.test/docs/one.pdf': source(
          'https://example.test/docs/one.pdf',
          same,
          'application/pdf',
        ),
        'https://example.test/docs/two.pdf': source(
          'https://example.test/docs/two.pdf',
          same,
          'application/pdf',
        ),
      }),
    });
    const equivalents = result.candidates.filter(
      ({ candidate }) => candidate.content_equivalence === 'equivalent',
    );
    expect(equivalents).toHaveLength(1);
    expect(equivalents[0]?.candidate.equivalent_content_of_candidate_id).toBeTruthy();
    expect(
      result.candidates.filter(({ candidate }) => candidate.normalized_uri.includes('/one.pdf')),
    ).toHaveLength(1);
    expect(
      result.candidates.filter(({ candidate }) => candidate.normalized_uri.includes('/two.pdf')),
    ).toHaveLength(1);
  });

  it('binds the exact reviewed profile configuration with a canonical content digest', async () => {
    const result = await acquireOfficialSources({
      intake: intake(),
      profile,
      adapter: adapterFor(successfulResponses()),
    });
    expect(result.artifact?.profile_binding).toEqual({
      profile_id: profile.id,
      profile_schema_version: profile.schema_version,
      profile_digest: manufacturerAcquisitionProfileDigest(profile),
    });

    const reordered = Object.fromEntries(
      Object.entries(profile).reverse(),
    ) as ManufacturerAcquisitionProfile;
    const changedMechanics: ManufacturerAcquisitionProfile = {
      ...profile,
      strategies: [
        {
          ...profile.strategies[0],
          document_link_discovery: {
            ...profile.strategies[0].document_link_discovery,
            allowed_extensions: ['.html', '.pdf'],
          },
        },
      ],
    };
    expect(manufacturerAcquisitionProfileDigest(reordered)).toBe(
      manufacturerAcquisitionProfileDigest(profile),
    );
    expect(manufacturerAcquisitionProfileDigest(changedMechanics)).not.toBe(
      manufacturerAcquisitionProfileDigest(profile),
    );
    expect(
      manufacturerAcquisitionProfileDigest({
        ...profile,
        provenance: { ...profile.provenance, source_artifact: 'C:\\other\\profile.json' },
      }),
    ).toBe(manufacturerAcquisitionProfileDigest(profile));
  });

  it('derives every declared terminal acquisition status from persisted outcomes', async () => {
    const seedUri = intake().official_product_uri;
    const noLinksBody = bytes(`<html><body>${'product content '.repeat(100)}</body></html>`);
    const onlyThirdParty = bytes(
      `<html><body>${'product content '.repeat(100)}<a href="https://third-party.test/datasheet.pdf">datasheet</a></body></html>`,
    );
    const onlyFailedCandidate = bytes(
      `<html><body>${'product content '.repeat(100)}<a href="/docs/datasheet.pdf">datasheet</a></body></html>`,
    );
    const common = {
      intake: intake(),
      adapter: adapterFor(successfulResponses()),
    };

    await expect(acquireOfficialSources({ ...common, profile })).resolves.toMatchObject({
      status: 'acquired',
    });
    await expect(
      acquireOfficialSources({
        ...common,
        profile: { ...profile, official_domains: ['other.test'] },
      }),
    ).resolves.toMatchObject({ status: 'unresolved_officiality' });
    await expect(
      acquireOfficialSources({
        intake: intake(),
        adapter: adapterFor({
          [seedUri]: source(seedUri, noLinksBody, 'text/html'),
        }),
      }),
    ).resolves.toMatchObject({ status: 'insufficient_sources' });
    await expect(
      acquireOfficialSources({
        intake: intake(),
        adapter: adapterFor({
          [seedUri]: source(seedUri, onlyThirdParty, 'text/html'),
        }),
      }),
    ).resolves.toMatchObject({ status: 'blocked' });
    await expect(
      acquireOfficialSources({
        intake: intake(),
        adapter: adapterFor({
          [seedUri]: source(seedUri, onlyFailedCandidate, 'text/html'),
          'https://example.test/docs/datasheet.pdf': 'failed',
        }),
      }),
    ).resolves.toMatchObject({ status: 'failed' });
    await expect(
      acquireOfficialSources({
        intake: intake({ official_product_uri: 'not a uri' }),
        adapter: adapterFor({}),
      }),
    ).resolves.toMatchObject({ status: 'seed_failed' });
    await expect(
      acquireOfficialSources({
        ...common,
        policy: { max_recursion_depth: -1 },
      }),
    ).resolves.toMatchObject({ status: 'blocked' });
  });
});
