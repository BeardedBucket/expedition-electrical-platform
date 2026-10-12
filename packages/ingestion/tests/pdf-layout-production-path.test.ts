import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  prepareProductionIngestReview,
  buildProductionSemanticProposals,
  replaySemanticAssertion,
} from '../src/index.js';
import { layoutPdfSource } from './fixtures/layout-pdf.js';

const prepare = (options: Parameters<typeof layoutPdfSource>[0] = {}) =>
  prepareProductionIngestReview({
    intake: {
      schema_version: '1.0',
      artifact_kind: 'product_intake',
      id: 'layout.fixture',
      manufacturer: 'Independent Example',
      product_model: 'EX-42',
      manufacturer_part_number: 'ORDER-42',
      official_product_uri: 'https://example.test/product',
    },
    adapter: {
      async capture(request) {
        if (request.uri.endsWith('.pdf'))
          return { status: 'success' as const, issues: [], source: layoutPdfSource(options) };
        const html =
          '<html><body><script type="application/ld+json">{"@type":"Organization","name":"Independent Example","url":"https://example.test/"}</script><main><h1>EX-42</h1><a href="https://example.test/layout.pdf">Specifications</a></main></body></html>';
        const bytes = new TextEncoder().encode(html);
        return {
          status: 'success' as const,
          issues: [],
          source: {
            requested_uri: request.uri,
            final_uri: request.uri,
            media_type: 'text/html',
            response_status: 200,
            retrieved_at: '2026-10-07T00:00:00.000Z',
            body: { bytes, text: html },
            content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          },
        };
      },
    },
    policy: { max_captured_candidates: 1, now: () => '2026-10-07T00:00:00.000Z' },
  });

describe('independent PDF layout production mechanisms', () => {
  it('repeats extraction, qualification, F, proposals and projection deterministically', async () => {
    const first = await prepare({ method: 'painted' });
    const second = await prepare({ method: 'painted' });
    if (first.status !== 'review_ready' || second.status !== 'review_ready')
      throw Error('not ready');
    expect(first.document_extractions).toEqual(second.document_extractions);
    expect(first.qualified_facts).toEqual(second.qualified_facts);
    expect(first.reconciliation).toEqual(second.reconciliation);
    expect(first.proposals).toEqual(second.proposals);
    expect(first.bridge).toEqual(second.bridge);
  });
  it.each(['aligned', 'painted', 'ruled'] as const)(
    'extracts %s structure through F and candidate projection',
    async (method) => {
      const r = await prepare({ method });
      if (r.status !== 'review_ready') throw Error('not ready');
      expect(r.qualified_facts.map((f) => [f.metadata.source_label, f.metadata.raw_value])).toEqual(
        expect.arrayContaining([
          ['DC output voltage', '24 VDC'],
          ['Continuous DC power', '400 W'],
          ['Weight', '2 kg'],
        ]),
      );
      expect(
        r.qualified_facts.every((f) =>
          f.evidence?.some((e) => e.context?.kind === 'qualification_provenance'),
        ),
      ).toBe(true);
      expect(r.reconciliation.groups).toHaveLength(3);
      expect(r.bridge.projected_proposal_ids).toHaveLength(3);
      expect(r.bridge.candidate).toBeDefined();
      const input = {
        facts: r.qualified_facts,
        source_acquisitions: r.source_acquisitions,
        reconciliation: r.reconciliation,
      };
      const old = buildProductionSemanticProposals(input, 'semantic-assertions.v6');
      expect(
        old
          .filter((p) => p.semantic_assertions)
          .every((p) => p.provenance.rule_version === 'production-semantic-bridge.v11'),
      ).toBe(true);
      expect(old.some((p) => p.semantic_assertions)).toBe(true);
      expect(buildProductionSemanticProposals(input, 'semantic-assertions.v6')).toEqual(old);
      for (const p of old)
        for (const assertion of p.semantic_assertions ?? []) {
          const source = input.facts.find((f) =>
            p.fact_refs?.some((ref) => ref.reference === f.id),
          )!;
          expect(replaySemanticAssertion(source, input.facts, assertion)).toEqual(assertion);
        }
    },
  );
  it('does not borrow a sibling model value', async () => {
    const r = await prepare({ sibling: true });
    if (r.status !== 'review_ready') throw Error('not ready');
    expect(
      r.qualified_facts.find((f) => f.metadata.source_label === 'DC output voltage')?.metadata
        .raw_value,
    ).toBe('48 VDC');
  });
  it('versions generic meanings only after production recovers their source rows', async () => {
    const r = await prepare({ quantities: true });
    if (r.status !== 'review_ready') throw Error('not ready');
    expect(r.qualified_facts).toHaveLength(3);
    expect(r.bridge.projected_proposal_ids).toHaveLength(3);
    const input = {
      facts: r.qualified_facts,
      source_acquisitions: r.source_acquisitions,
      reconciliation: r.reconciliation,
    };
    const old = buildProductionSemanticProposals(input, 'semantic-assertions.v6');
    expect(old.filter((p) => p.disposition === 'mapped')).toHaveLength(0);
    expect(
      r.proposals
        .filter((p) => p.semantic_assertions)
        .every((p) => p.provenance.rule_version === 'production-semantic-bridge.v12'),
    ).toBe(true);
    expect(
      r.proposals
        .flatMap((p) => p.semantic_assertions ?? [])
        .every((a) => a.qualifiers.source_conditions?.length),
    ).toBe(true);
  });
  it.each([
    { duplicate: true },
    { missingIdentity: true },
    { crossing: true },
    { displaced: true },
  ])('withholds conflicting/incomplete layout %s', async (options) => {
    const r = await prepare(options);
    if (r.status !== 'review_ready') throw Error('not ready');
    expect(r.qualified_facts).toEqual([]);
    expect(r.bridge.projected_proposal_ids).toEqual([]);
  });
  it('joins source-bounded label fragments', async () => {
    const r = await prepare({ method: 'ruled', fragments: true });
    if (r.status !== 'review_ready') throw Error('not ready');
    expect(
      r.qualified_facts
        .find((f) => f.metadata.source_label === 'DC output voltage')
        ?.evidence?.filter((e) => e.role === 'label'),
    ).toHaveLength(2);
  });
  it('preserves the complete wrapped painted label', async () => {
    const r = await prepare({ method: 'painted', wrapped: true });
    if (r.status !== 'review_ready') throw Error('not ready');
    expect(
      r.qualified_facts
        .find((f) => f.metadata.source_label === 'DC output voltage')
        ?.evidence?.filter((e) => e.role === 'label'),
    ).toHaveLength(2);
    expect(r.bridge.projected_proposal_ids).toHaveLength(3);
  });
  it.each(['explicit', 'incomplete'] as const)(
    'requires complete explicit source dimension axes: %s',
    async (dimensions) => {
      const r = await prepare({ method: 'painted', dimensions });
      if (r.status !== 'review_ready') throw Error('not ready');
      const axes = r.qualified_facts.filter((f) =>
        ['Width', 'Height', 'Depth'].includes(f.metadata.source_label ?? ''),
      );
      expect(axes.map((f) => [f.metadata.source_label, f.metadata.raw_value])).toEqual(
        dimensions === 'explicit'
          ? expect.arrayContaining([
              ['Width', '32 mm'],
              ['Height', '125.2 mm'],
              ['Depth', '102 mm'],
            ])
          : [],
      );
      expect(r.bridge.projected_proposal_ids).toHaveLength(dimensions === 'explicit' ? 5 : 2);
      if (dimensions === 'explicit') {
        const old = buildProductionSemanticProposals(
          {
            facts: r.qualified_facts,
            source_acquisitions: r.source_acquisitions,
            reconciliation: r.reconciliation,
          },
          'semantic-assertions.v6',
        );
        expect(
          old.filter((p) => p.target?.startsWith('dimensions_mm.') && p.disposition === 'mapped'),
        ).toEqual([]);
      }
    },
  );
  it('retains unknown note scope without engineering projection', async () => {
    const r = await prepare({ note: 'unknown' });
    if (r.status !== 'review_ready') throw Error('not ready');
    expect(r.qualified_facts).toHaveLength(3);
    expect(r.bridge.projected_proposal_ids).toEqual([]);
    expect(
      r.qualified_facts.every((f) => f.evidence?.some((e) => e.context?.kind === 'unresolved')),
    ).toBe(true);
  });
  it('preserves explicit general note conditions in projection', async () => {
    const r = await prepare({ note: 'general' });
    if (r.status !== 'review_ready') throw Error('not ready');
    expect(r.bridge.projected_proposal_ids).toHaveLength(3);
    expect(
      r.qualified_facts.every((f) =>
        f.evidence?.some((e) => e.context?.kind === 'source_semantic' && e.text.includes('25 C')),
      ),
    ).toBe(true);
  });
});
