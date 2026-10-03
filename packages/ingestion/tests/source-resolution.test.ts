import { describe, expect, it, vi } from 'vitest';
import * as documentExtraction from '../src/document-extraction.js';
import {
  artifactDigest,
  artifactReference,
  captureSourceResolutionCandidate,
  HttpSourceCaptureAdapter,
  prepareProductionIngestReview,
  validateProductionArtifactSchema,
  approvalMatchesReviewPackage,
  reviewPackageSnapshot,
  finalizeProductionIngest,
  type ProductionApproval,
  type SourceCaptureAdapter,
} from '../src/index.js';
import {
  resolutionAdapter,
  resolutionIntake,
  resolutionProfile,
  resolutionUri,
} from './fixtures/source-resolution.js';

const candidate = (options: Parameters<typeof resolutionAdapter>[0] = {}, profile = true) =>
  captureSourceResolutionCandidate(
    {
      intake: resolutionIntake,
      adapter: resolutionAdapter(options),
      ...(profile ? { profile: resolutionProfile } : {}),
    },
    resolutionUri,
    'resolution.test',
  );
describe('production source resolution', () => {
  const earlyHeadings = Array.from({ length: 35 }, (_, index) => `<h2>Section ${index}</h2>`).join(
    '',
  );
  it('retains a later exact MPN after more than 30 headings with its source locator', async () => {
    const { resolution } = await candidate({
      html: `<html><body>${earlyHeadings}<p>EX-1</p></body></html>`,
    });
    expect(resolution.observations[0]).toMatchObject({
      kind: 'exact_mpn',
      value: 'EX-1',
      locator: { kind: 'html' },
    });
    expect(resolution.observations[0].locator).toHaveProperty('path');
    expect(resolution.observations).toHaveLength(30);
  });
  it('retains a later exact model despite heading-heavy content', async () => {
    const { resolution } = await candidate({
      html: `<html><body>${earlyHeadings}<p>Example Model</p></body></html>`,
    });
    expect(resolution.observations[0]).toMatchObject({
      kind: 'exact_model',
      value: 'Example Model',
    });
    expect(resolution.observations).toHaveLength(30);
  });
  it('orders MPN, model and manufacturer observations before supplemental headings', async () => {
    const { resolution } = await candidate({
      html: `<html><body>${earlyHeadings}<p>Example Manufacturer</p><p>Example Model</p><p>EX-1</p></body></html>`,
    });
    expect(resolution.observations.slice(0, 3).map((item) => item.kind)).toEqual([
      'exact_mpn',
      'exact_model',
      'exact_manufacturer',
    ]);
    expect(resolution.observations.slice(3).every((item) => item.kind === 'heading')).toBe(true);
    expect(resolution.observations).toHaveLength(30);
  });
  it('deterministically truncates excess exact observations before adding lower priorities', async () => {
    const { resolution } = await candidate({
      html: `<html><body><h1>Context</h1>${'<p>EX-1</p>'.repeat(35)}<p>Example Model</p></body></html>`,
    });
    expect(resolution.observations).toHaveLength(30);
    expect(resolution.observations.every((item) => item.kind === 'exact_mpn')).toBe(true);
    expect(new Set(resolution.observations.map((item) => JSON.stringify(item.locator))).size).toBe(
      30,
    );
  });
  it('replays identical observations in the same priority and document order', async () => {
    const html = `<html><body>${earlyHeadings}<p>Example Model EX-1</p><p>EX-1</p><p>Example Manufacturer</p></body></html>`;
    const first = await candidate({ html });
    const second = await candidate({ html });
    expect(second.resolution.observations).toEqual(first.resolution.observations);
    expect(first.resolution.observations.slice(0, 4).map((item) => item.kind)).toEqual([
      'exact_mpn',
      'exact_mpn',
      'exact_model',
      'exact_manufacturer',
    ]);
  });
  it('deduplicates the same kind/value/locator while retaining distinct locations', async () => {
    const captured = await resolutionAdapter().capture({ uri: resolutionUri });
    if (!captured.source) throw new Error('Missing fixture source.');
    const block = {
      kind: 'paragraph' as const,
      text: 'EX-1',
      locator: { fragment: 'p1' },
      source_location: { kind: 'html' as const, path: '/p[1]' },
    };
    const extractor = vi.spyOn(documentExtraction, 'extractDocumentAsync').mockResolvedValueOnce({
      source: captured.source,
      warnings: [],
      blocks: [
        block,
        { ...block, source_location: { path: '/p[1]', kind: 'html' } },
        { ...block, source_location: { kind: 'html', path: '/p[2]' } },
      ],
    });
    try {
      const { resolution } = await candidate();
      expect(resolution.observations).toEqual([
        { kind: 'exact_mpn', value: 'EX-1', locator: { kind: 'html', path: '/p[1]' } },
        { kind: 'exact_mpn', value: 'EX-1', locator: { kind: 'html', path: '/p[2]' } },
      ]);
    } finally {
      extractor.mockRestore();
    }
  });
  it('captures versioned, digest-bound evidence without changing intake', async () => {
    const before = artifactDigest(resolutionIntake);
    const { resolution, capture } = await candidate();
    expect(validateProductionArtifactSchema(resolution)).toEqual([]);
    expect(validateProductionArtifactSchema(capture)).toEqual([]);
    expect(resolution.capture.digest).toBe(artifactDigest(capture));
    expect(resolution.intake.digest).toBe(before);
    expect(resolutionIntake).not.toHaveProperty('official_product_uri');
    expect(resolution.domain_evidence.state).toBe('profile_supported');
    expect(resolution.domain_evidence.publisher).toBe('Example Publications');
    expect(resolution.title).toBe('Example product');
    expect(resolution.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'exact_model',
          value: 'Example Model',
          locator: expect.any(Object),
        }),
        expect.objectContaining({ kind: 'exact_mpn', value: 'EX-1' }),
      ]),
    );
  });

  it('uses the shared media-aware PDF default without acquisition-wide accounting', async () => {
    const pdf = new Uint8Array(2_100_000);
    pdf.set(new TextEncoder().encode('%PDF-1.7'));
    const transport = new HttpSourceCaptureAdapter(
      async () =>
        new Response(pdf, {
          headers: { 'content-type': 'application/pdf' },
        }),
      undefined,
      async () => ['93.184.216.34'],
    );
    const requests: Parameters<SourceCaptureAdapter['capture']>[0][] = [];
    const adapter: SourceCaptureAdapter = {
      capture(request) {
        requests.push(request);
        return transport.capture(request);
      },
    };
    const extractor = vi
      .spyOn(documentExtraction, 'extractDocumentAsync')
      .mockImplementation(async (source) => ({ source, warnings: [], blocks: [] }));
    try {
      const { resolution, capture } = await captureSourceResolutionCandidate(
        { intake: resolutionIntake, profile: resolutionProfile, adapter },
        resolutionUri,
        'resolution.large-pdf',
      );
      expect(capture.disposition).toBe('authoritative');
      expect(capture.content_digest).toMatch(/^sha256:/);
      expect(resolution.diagnostics).toEqual([]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.max_bytes).toBeUndefined();
    } finally {
      extractor.mockRestore();
    }
  });

  it('keeps missing-profile officiality and publisher unknown', async () => {
    const { resolution } = await candidate({}, false);
    expect(resolution.domain_evidence).toEqual({ state: 'no_reviewed_profile' });
  });
  it('keeps off-domain redirects separate from profile support', async () => {
    const { resolution } = await candidate({ final_uri: 'https://other.test/product' });
    expect(resolution.final_uri).toBe('https://other.test/product');
    expect(resolution.domain_evidence.state).toBe('outside_reviewed_domains');
    expect(resolution.domain_evidence.publisher).toBeUndefined();
  });
  it('does not rewrite fuzzy, prefix, suffix, or case-different identity evidence', async () => {
    const { resolution } = await candidate({
      html: '<html><body><p>EX-10 AEX-1 EX-1-A ex-1 Example Models</p></body></html>',
    });
    expect(resolution.observations).toEqual([]);
  });
  it('bounds observations and diagnostics instead of retaining the source body', async () => {
    const { resolution } = await candidate({
      html: `<html><body>${'<h1>Example Model EX-1</h1>'.repeat(100)}</body></html>`,
    });
    expect(resolution.observations).toHaveLength(30);
    expect(resolution).not.toHaveProperty('body');
  });
  it('uses accepted resolution explicitly and changes review bindings for another decision', async () => {
    const { resolution } = await candidate();
    const accepted = {
      ...resolution,
      disposition: 'accepted' as const,
      review: { reviewed_at: '2026-09-08T00:00:01.000Z', method: 'local_operator' as const },
    };
    const request = {
      intake: resolutionIntake,
      profile: resolutionProfile,
      adapter: resolutionAdapter(),
      source_resolution: accepted,
    };
    const prepared = await prepareProductionIngestReview(request);
    expect(prepared.status).toBe('review_ready');
    expect(prepared.acquisition.seed_capture.artifact.requested_uri).toBe(resolutionUri);
    expect(prepared.intake).not.toHaveProperty('official_product_uri');
    expect(prepared.source_resolution).toEqual(accepted);
    expect(prepared.source_acquisitions[0].source_resolution?.digest).toBe(
      artifactDigest(accepted),
    );
    if (prepared.status !== 'review_ready') throw new Error('Fixture not review ready.');
    expect(prepared.review_package.source_resolution?.digest).toBe(artifactDigest(accepted));
    const approval: ProductionApproval = {
      schema_version: '1.0',
      artifact_kind: 'approval',
      id: 'approval.old',
      decision: 'deferred',
      reviewer_id: 'test',
      reviewed_at: '2026-09-08T00:00:02.000Z',
      review_package: artifactReference('review_package', prepared.review_package),
      review_package_snapshot: reviewPackageSnapshot(prepared.review_package),
      semantic_snapshot: prepared.review_package.semantic_snapshot,
    };
    const changed = {
      ...accepted,
      id: 'resolution.other',
      attempt_id: 'resolution.other',
      candidate_uri: 'https://example.test/other',
      normalized_uri: 'https://example.test/other',
      final_uri: 'https://example.test/other',
    };
    const next = await prepareProductionIngestReview({ ...request, source_resolution: changed });
    if (next.status !== 'review_ready') throw new Error('Fixture not review ready.');
    expect(next.review_package.semantic_snapshot).not.toBe(
      prepared.review_package.semantic_snapshot,
    );
    expect(approvalMatchesReviewPackage(approval, next.review_package)).toBe(false);
    await expect(
      finalizeProductionIngest({ ...prepared, source_resolution: changed }, approval, {
        destinationRoot: 'unused',
      }),
    ).rejects.toThrow('resolution does not match');
  });
  it('rejects pending or foreign resolution before acquisition', async () => {
    const { resolution } = await candidate();
    await expect(
      prepareProductionIngestReview({
        intake: resolutionIntake,
        adapter: resolutionAdapter(),
        source_resolution: resolution,
      }),
    ).rejects.toThrow('Accepted source resolution');
    const accepted = {
      ...resolution,
      disposition: 'accepted' as const,
      review: { reviewed_at: '2026-09-08T00:00:01.000Z', method: 'local_operator' as const },
    };
    await expect(
      prepareProductionIngestReview({
        intake: { ...resolutionIntake, id: 'foreign' },
        adapter: resolutionAdapter(),
        source_resolution: accepted,
      }),
    ).rejects.toThrow('different intake');
  });
  it('does not weaken reviewed domain checks after human acceptance', async () => {
    const { resolution } = await candidate({ final_uri: 'https://other.test/product' });
    const prepared = await prepareProductionIngestReview({
      intake: resolutionIntake,
      profile: resolutionProfile,
      adapter: resolutionAdapter(),
      source_resolution: {
        ...resolution,
        disposition: 'accepted',
        review: { reviewed_at: '2026-09-08T00:00:01.000Z', method: 'local_operator' },
      },
    });
    expect(prepared.status).toBe('preparation_failed');
    expect(prepared.acquisition.status).toBe('unresolved_officiality');
  });
});
