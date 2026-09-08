import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acquireOfficialSources,
  manufacturerAcquisitionProfileDigest,
  PRODUCTION_SCHEMA_VERSION,
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
    expect(result.candidates).toHaveLength(3);
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
