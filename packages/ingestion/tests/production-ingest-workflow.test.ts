import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  artifactDigest,
  prepareProductionIngestReview,
  PRODUCTION_SCHEMA_VERSION,
  type CapturedSource,
  type ProductIntake,
  type SourceCaptureAdapter,
} from '../src/index.js';

const productUri = 'https://example.test/products/ex-1';
const documentUri = 'https://example.test/docs/specifications.html';
const intake: ProductIntake = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.example',
  manufacturer: 'Example Manufacturer',
  product_model: 'Example Model',
  manufacturer_part_number: 'EX-1',
  official_product_uri: productUri,
};
const productPage = (link = '') =>
  `<html><body><h1>Example Model</h1><p>Official product information for EX-1.</p>${link}</body></html>`;
const table = (label = 'nominal voltage', value = '24 V') =>
  `<html><body><h1>Specifications</h1><table><thead><tr><th>Model</th><th>${label}</th></tr></thead><tbody><tr><td>EX-1</td><td>${value}</td></tr></tbody></table></body></html>`;
const source = (uri: string, html: string): CapturedSource => {
  const bytes = new TextEncoder().encode(html);
  return {
    requested_uri: uri,
    final_uri: uri,
    retrieved_at: '2026-09-08T00:00:00.000Z',
    media_type: 'text/html',
    response_status: 200,
    body: { bytes, text: html },
    content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
};
const adapter = (responses: Readonly<Record<string, string>>): SourceCaptureAdapter => ({
  async capture(request) {
    const html = responses[request.uri];
    return html === undefined
      ? {
          status: 'failed',
          issues: [{ code: 'network_error', message: 'offline fixture missing' }],
        }
      : { status: 'success', source: source(request.uri, html), issues: [] };
  },
});
const run = (responses: Readonly<Record<string, string>>) =>
  prepareProductionIngestReview({
    intake,
    adapter: adapter(responses),
    policy: { now: () => '2026-09-08T00:00:00.000Z' },
  });
const linked = {
  [productUri]: productPage(`<a href="${documentUri}">Specifications</a>`),
  [documentUri]: table(),
};

describe('production ingest review preparation', () => {
  it('prepares a review package from a product intake through the production ingestion stages', async () => {
    const result = await run(linked);
    expect(result.status).toBe('review_ready');
    if (result.status !== 'review_ready') return;
    expect(result.acquisition.status).toBe('acquired');
    expect(result.document_extractions).toHaveLength(2);
    expect(result.qualified_facts.length).toBeGreaterThan(0);
    expect(result.review_package.artifact_kind).toBe('review_package');
  });

  it('preserves source capture extraction and qualified fact provenance in the prepared result', async () => {
    const result = await run(linked);
    expect(result.status).toBe('review_ready');
    if (result.status !== 'review_ready') return;
    const fact = result.qualified_facts[0];
    expect(result.captures.map(artifactDigest)).toContain(fact.source_capture.digest);
    expect(result.document_extractions.map(artifactDigest)).toContain(
      fact.document_extraction?.digest,
    );
    expect(result.source_acquisitions.map(artifactDigest)).toContain(
      fact.source_acquisition?.digest,
    );
    expect(result.review_package.fact_refs.map((ref) => ref.digest)).toContain(
      artifactDigest(fact),
    );
  });

  it('reconciles qualified facts before semantic proposal generation', async () => {
    const result = await run(linked);
    expect(result.status).toBe('review_ready');
    if (result.status !== 'review_ready') return;
    expect(result.reconciliation.qualified_fact_ids).toEqual(
      result.qualified_facts.map((fact) => fact.id),
    );
    expect(
      result.proposals.every((proposal) =>
        proposal.input_artifact_digests.includes(artifactDigest(result.reconciliation)),
      ),
    ).toBe(true);
    expect(result.review_package.proposal_refs.map((ref) => ref.digest)).toEqual(
      result.proposals.map(artifactDigest),
    );
  });

  it('returns a review package when evidence is unresolved or unsupported', async () => {
    const result = await run({
      [productUri]: productPage(),
      [documentUri]: table('mystery rating', '42 V'),
    });
    expect(result.status).toBe('review_ready');
    if (result.status !== 'review_ready') return;
    expect(result.bridge.candidate).toBeUndefined();
    expect(result.review_package.artifact_kind).toBe('review_package');
  });

  it('does not infer canonical product semantics from unmapped manufacturer information', async () => {
    const result = await run({
      [productUri]: productPage(`<a href="${documentUri}">Specifications</a>`),
      [documentUri]: table('mystery rating', '42 V'),
    });
    expect(result.status).toBe('review_ready');
    if (result.status !== 'review_ready') return;
    expect(
      result.proposals.some((proposal) => proposal.target === 'source_label:mystery rating'),
    ).toBe(true);
    expect(result.proposals.every((proposal) => proposal.disposition !== 'mapped')).toBe(true);
  });

  it('does not perform approval promotion or corpus writes while preparing review', async () => {
    const result = await run(linked);
    expect(result.status).toBe('review_ready');
    if (result.status !== 'review_ready') return;
    expect(Object.keys(result)).not.toEqual(expect.arrayContaining(['approval', 'promotion']));
    expect(result.review_package).not.toHaveProperty('approval');
  });

  it('keeps multiple source artifacts provenance-distinct through preparation', async () => {
    const result = await run(linked);
    expect(result.status).toBe('review_ready');
    if (result.status !== 'review_ready') return;
    expect(new Set(result.captures.map(artifactDigest)).size).toBe(2);
    expect(
      new Set(result.document_extractions.map((item) => item.source_capture.digest)).size,
    ).toBe(2);
  });

  it('produces deterministic review preparation output for equivalent source inputs', async () => {
    expect(await run(linked)).toEqual(await run(linked));
  });

  it('preserves existing acquisition failure state without fabricating review data', async () => {
    const result = await run({});
    expect(result.status).toBe('preparation_failed');
    if (result.status !== 'preparation_failed') return;
    expect(result.reason).toBe('acquisition_failed');
    expect(result.acquisition.status).toBe('unresolved_officiality');
    expect(result.acquisition.artifact?.status).toBe(result.acquisition.status);
    expect(result.document_extractions).toEqual([]);
    expect(result.qualified_facts).toEqual([]);
    expect(result).not.toHaveProperty('bridge');
    expect(result).not.toHaveProperty('review_package');
  });
});
