import { describe, it, expect } from 'vitest';
import { prepareProductionIngestReview, type ProductIntake } from '../src/index.js';
import { vectorPdfSource } from './fixtures/vector-pdf.js';
import { pdfVectorStructure } from '../src/pdf-vector-structure.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createHash } from 'node:crypto';

const intake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'vector.fixture',
  manufacturer: 'Independent Example',
  product_model: 'EX-42',
  manufacturer_part_number: 'ORDER-42',
  official_product_uri: 'https://example.test/products/device',
};
const prepare = (options: Parameters<typeof vectorPdfSource>[0] = {}, pdfFinalUri?: string) =>
  prepareProductionIngestReview({
    intake,
    adapter: {
      async capture(request) {
        if (request.uri.endsWith('.pdf'))
          return {
            status: 'success',
            issues: [],
            source: {
              ...vectorPdfSource(options),
              ...(pdfFinalUri ? { final_uri: pdfFinalUri } : {}),
            },
          };
        const html =
          '<html><body><script type="application/ld+json">{"@type":"Organization","name":"Independent Example","url":"https://example.test/"}</script><main><h1>EX-42</h1><a href="https://example.test/matrix.pdf">Specifications</a></main></body></html>';
        const bytes = new TextEncoder().encode(html);
        return {
          status: 'success',
          issues: [],
          source: {
            requested_uri: request.uri,
            final_uri: request.uri,
            media_type: 'text/html',
            response_status: 200,
            retrieved_at: '2026-10-05T00:00:00.000Z',
            body: { bytes, text: html },
            content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          },
        };
      },
    },
    policy: { max_captured_candidates: 1 },
  });

describe('source-painted PDF matrix production path', () => {
  it('withholds inherited publisher attribution after a cross-origin final URI', async () => {
    const result = await prepare({}, 'https://example.test:8443/matrix.pdf');
    if (result.status !== 'review_ready') throw Error('unexpected failure');
    expect(result.qualified_facts).toHaveLength(3);
    expect(result.bridge.projected_proposal_ids).toEqual([]);
  });
  it('produces model-owned facts, F groups, semantic proposals and a candidate without a reviewed profile', async () => {
    const result = await prepare();
    if (result.status !== 'review_ready') throw Error('unexpected failure');
    expect(
      result.qualified_facts.map((f) => [f.metadata.source_label, f.metadata.raw_value]).sort(),
    ).toEqual([
      ['Continuous DC power', '400 W'],
      ['DC output voltage', '24 VDC'],
      ['Weight', '2 kg'],
    ]);
    expect(
      result.qualified_facts.every(
        (f) =>
          f.metadata.applicability.kind === 'exact_product' &&
          f.evidence?.some((e) => e.context?.kind === 'qualification_provenance'),
      ),
    ).toBe(true);
    expect(result.reconciliation.groups).toHaveLength(3);
    expect(result.bridge.projected_proposal_ids).toHaveLength(3);
    expect(result.bridge.candidate).toBeDefined();
    expect(
      result.bridge.sources.every(
        (s) => s.product_identity_claim?.manufacturer_part_number === undefined,
      ),
    ).toBe(true);
  });
  it('never borrows the sibling model voltage', async () => {
    const result = await prepare({ sibling: true });
    if (result.status !== 'review_ready') throw Error('unexpected failure');
    expect(
      result.qualified_facts.find((f) => f.metadata.source_label === 'DC output voltage')?.metadata
        .raw_value,
    ).toBe('48 VDC');
  });
  it.each([{ ambiguous: true }])('abstains from ambiguous model headers %s', async (options) => {
    const result = await prepare(options);
    if (result.status !== 'review_ready') throw Error('unexpected failure');
    expect(result.qualified_facts).toEqual([]);
    expect(result.bridge.projected_proposal_ids).toEqual([]);
  });
  it('recovers a missing border through the independently confirmed aligned matrix', async () => {
    const result = await prepare({ missingBorder: true });
    if (result.status !== 'review_ready') throw Error('unexpected failure');
    expect(result.qualified_facts).toHaveLength(3);
    expect(result.qualified_facts.every((f) => f.qualifier === 'pdf-source-layout.v1')).toBe(true);
    expect(result.bridge.projected_proposal_ids).toHaveLength(3);
  });
  it('preserves an unscoped note and prevents unconditional projection', async () => {
    const result = await prepare({ note: true });
    if (result.status !== 'review_ready') throw Error('unexpected failure');
    expect(result.qualified_facts).toHaveLength(3);
    expect(
      result.qualified_facts.every((f) =>
        f.evidence?.some((e) => e.role === 'qualifier' && e.text.includes('ambient temperature')),
      ),
    ).toBe(true);
    expect(result.bridge.projected_proposal_ids).toEqual([]);
  });
  it('fails closed on unmatched graphics restores instead of using a stale transform', () => {
    const source = {
      text: 'Model',
      x: 40,
      y: 710,
      width: 20,
      height: 8,
      upright: true,
      location: { kind: 'pdf' as const, page: 1, ordinal: 1 },
    };
    expect(
      pdfVectorStructure(
        [source],
        { fnArray: [pdfjs.OPS.restore], argsArray: [[]] },
        pdfjs.OPS,
        50,
      ),
    ).toBeUndefined();
  });
  it('requires painted rules, balanced state and a complete retained rule budget', () => {
    const source = {
      text: 'Model',
      x: 40,
      y: 710,
      width: 20,
      height: 8,
      upright: true,
      location: { kind: 'pdf' as const, page: 1, ordinal: 1 },
    };
    const line = [pdfjs.OPS.stroke, [new Float32Array([0, 40, 700, 1, 540, 700])]];
    const run = (fnArray: number[], argsArray: unknown[], budget = 50) =>
      pdfVectorStructure([source], { fnArray, argsArray }, pdfjs.OPS, budget);
    expect(run([pdfjs.OPS.constructPath], [line])).toBeDefined();
    expect(run([pdfjs.OPS.setDash, pdfjs.OPS.constructPath], [[[2, 2], 0], line])).toBeUndefined();
    expect(run([pdfjs.OPS.constructPath], [line], 0)).toBeUndefined();
    expect(run([pdfjs.OPS.save, pdfjs.OPS.constructPath], [[], line])).toBeUndefined();
    expect(
      run([pdfjs.OPS.setGState, pdfjs.OPS.constructPath], [[[['CA', 0]]], line]),
    ).toBeUndefined();
    expect(
      run(
        [pdfjs.OPS.clip, pdfjs.OPS.constructPath, pdfjs.OPS.constructPath],
        [[], [pdfjs.OPS.endPath, [new Float32Array([0, 0, 0, 2, 1, 1, 2, 2, 3, 3])]], line],
      ),
    ).toBeUndefined();
    const clip = [
      pdfjs.OPS.endPath,
      [new Float32Array([0, 0, 0, 1, 600, 0, 1, 600, 750, 1, 0, 750, 3])],
    ];
    expect(
      run([pdfjs.OPS.clip, pdfjs.OPS.constructPath, pdfjs.OPS.constructPath], [[], clip, line]),
    ).toBeDefined();
    const excluded = [pdfjs.OPS.stroke, [new Float32Array([0, 40, 760, 1, 540, 760])]];
    expect(
      run([pdfjs.OPS.clip, pdfjs.OPS.constructPath, pdfjs.OPS.constructPath], [[], clip, excluded]),
    ).toBeUndefined();
  });
});
