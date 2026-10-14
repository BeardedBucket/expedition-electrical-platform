// @vitest-environment node
// Project-authored, invented products and source pages. Human actions below are
// test-author-controlled fixtures, never real operator review or product approval.
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IngestionJobService } from '../src/job-service.js';
import { FileIngestionJobStore } from '../src/job-store.js';
import {
  artifactDigest,
  LocalSnapshotStore,
  replaySourceCaptureSnapshot,
  reviewPackageSnapshot,
  suggestEngineeringProfileSources,
  type HumanAdjudicationIntent,
  type ReviewReadyProductionIngest,
} from '@expedition/ingestion';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith('wave2-source-review-')
    )
      throw new Error('Unowned cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});
const html = `<html><head><script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Invented Labs","url":"https://example.test"},{"@type":"Product","name":"Invented Panel","sku":"NP-12"}]}</script></head><body><main><h1>Invented Panel</h1><h2>Description</h2><div>
<ul><li><strong>Product Code</strong><span>NP-12</span></li><li><strong>Open-Circuit Voltage (Voc)</strong><span>26V</span></li><li><strong>Maximum Power (Pmax)</strong><span>180W</span></li></ul>
<ul><li><strong>Operating condition</strong><span>All specifications at 25°C; coefficient domain is unknown.</span></li></ul>
</div></main></body></html>`;
async function fixture(sourceHtml = html, model = 'NP-12', part: string | undefined = 'NP-12') {
  const root = await mkdtemp(join(tmpdir(), 'wave2-source-review-'));
  roots.push(root);
  const store = new FileIngestionJobStore(join(root, 'jobs'));
  const bytes = new TextEncoder().encode(sourceHtml);
  const make = () =>
    new IngestionJobService({
      store,
      preparationRequest: () => ({
        adapter: {
          capture: async (r) => ({
            status: 'success',
            issues: [],
            source: {
              requested_uri: r.uri,
              final_uri: r.uri,
              retrieved_at: '2026-10-13T00:00:00Z',
              media_type: 'text/html',
              content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
              body: { bytes, text: sourceHtml },
            },
          }),
        },
        policy: {
          max_captured_candidates: 0,
          max_recursion_depth: 0,
          retention_status: 'retained',
          snapshot_store: new LocalSnapshotStore(join(root, 'snapshots')),
        },
      }),
    });
  const service = make();
  const created = await service.createJob({
    schema_version: '1.0',
    artifact_kind: 'product_intake',
    id: 'synthetic.wave2.intake',
    manufacturer: 'Invented Labs',
    product_model: model,
    ...(part ? { manufacturer_part_number: part } : {}),
    official_product_uri: 'https://example.test/spec',
    submitted_at: '2026-10-13T00:00:00Z',
  });
  const job = await service.prepareJob(created.id);
  if (job.preparation?.status !== 'review_ready') throw new Error(JSON.stringify(job.error));
  return { make, service, store, job, root, p: job.preparation };
}
function intent(p: ReviewReadyProductionIngest): HumanAdjudicationIntent {
  const suggestion = suggestEngineeringProfileSources(
    p.intake,
    p.document_extractions,
    p.qualified_facts,
  ).find(
    (s) =>
      s.statement.mapping?.kind === 'engineering_profile_fact' &&
      s.statement.mapping.quantity === 'voc_v',
  );
  if (!suggestion) throw new Error('No native suggestion');
  return {
    version: 'human-adjudication.v1',
    group_id: 'synthetic.native-voc',
    replaces_fact_ids: suggestion.replaces_fact_ids ?? [],
    action: suggestion.replaces_fact_ids?.length ? 'correct' : 'add',
    disposition: 'ready',
    rationale:
      'Controlled fixture: inspect full source-owned row and keep the source temperature condition',
    statements: [suggestion.statement],
  };
}
describe('Wave 2 native source to durable human correction', () => {
  it('fails the separately invoked retained-byte replay on tampered or missing private snapshots', async () => {
    const f = await fixture();
    const capture = f.p.captures.find((c) => c.disposition === 'authoritative')!;
    const snapshots = new LocalSnapshotStore(join(f.root, 'snapshots'));
    expect((await replaySourceCaptureSnapshot(capture, snapshots)).status).toBe('replayed');
    const path = snapshots.resolveSnapshotPath(capture.snapshot!.reference);
    await writeFile(path, 'controlled test tamper');
    expect((await replaySourceCaptureSnapshot(capture, snapshots)).status).toBe('failed');
    expect(
      (
        await replaySourceCaptureSnapshot(
          capture,
          new LocalSnapshotStore(join(f.root, 'missing-snapshots')),
        )
      ).status,
    ).toBe('failed');
  });
  it('atomically composes conditional battery members with original units and separate unknown discharge location', async () => {
    const source =
      '<html><head><script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Invented Labs","url":"https://example.test"},{"@type":"Product","name":"Invented Bank","sku":"BANK-X"}]}</script></head><body><main><h1>Invented Bank</h1><section><h2>Technical Specifications &amp; Dimensions</h2><table><tr><th colspan="2">General</th></tr><tr><td>Battery / cell charge range</td><td>0°C to 40°C / 32°F to 104°F after heating</td></tr><tr><td>Discharge temperature range</td><td>-20°C to 50°C / -4°F to 122°F</td></tr><tr><td>Series connections</td><td>Max 2 batteries in series, up to 48V</td></tr><tr><td>Bank matching</td><td>Use matched batteries of the same model, age, capacity, and state of charge</td></tr></table></section></main></body></html>';
    const f = await fixture(source, 'BANK-X', 'BANK-X');
    const rows = suggestEngineeringProfileSources(
      f.p.intake,
      f.p.document_extractions,
      f.p.qualified_facts,
    ).filter(
      (s) =>
        s.statement.mapping?.kind === 'engineering_profile_fact' &&
        s.statement.mapping.quantity.startsWith('battery_'),
    );
    expect(rows).toHaveLength(3);
    const request = {
      expected_review_snapshot: reviewPackageSnapshot(f.p.review_package),
      actor_label: 'CONTROLLED TEST AUTHOR',
      intent: {
        version: 'human-adjudication.v1' as const,
        group_id: 'synthetic.battery',
        replaces_fact_ids: rows.flatMap((r) => r.replaces_fact_ids ?? []),
        action: 'split' as const,
        disposition: 'ready' as const,
        rationale: 'Controlled test source-condition review',
        statements: rows.map((r) => r.statement),
      },
    };
    const preview = await f.service.previewHumanAdjudication(f.job.id, request);
    expect(preview.candidate?.engineering_profile).toMatchObject({
      battery_operating: {
        version: 'battery-operating.v1',
        charge_range: {
          min_c: 0,
          max_c: 40,
          measurement_point: 'battery_cell',
          prerequisite: 'after_heating',
        },
        discharge_range: { measurement_point: 'unknown' },
        series_permission: { max_count: 2, requires_matched_bank: true },
      },
    });
    const saved = await f.service.recordHumanAdjudication(f.job.id, request);
    expect(artifactDigest(await f.make().getJob(f.job.id))).toBe(artifactDigest(saved));
  });
  it('previews a missed typed fact without writing a human event; saves and replays an explicit controlled action', async () => {
    const f = await fixture();
    const correction = intent(f.p);
    const request = {
      expected_review_snapshot: reviewPackageSnapshot(f.p.review_package),
      actor_label: 'CONTROLLED TEST AUTHOR',
      intent: correction,
    };
    const preview = await f.service.previewHumanAdjudication(f.job.id, request);
    expect(preview.candidate?.engineering_profile, JSON.stringify(preview)).toMatchObject({
      pv: { voc_v: { value: 26, unit: 'V' } },
    });
    expect((await f.make().getJob(f.job.id)).human_adjudications).toBeUndefined();
    const saved = await f.service.recordHumanAdjudication(f.job.id, request);
    const replay = await f.make().getJob(f.job.id);
    expect(artifactDigest(replay)).toBe(artifactDigest(saved));
    expect(replay.approval).toBeUndefined();
    expect(replay.preparation?.status).toBe('review_ready');
    const profile =
      replay.preparation?.status === 'review_ready'
        ? replay.preparation.bridge.candidate?.component_data.engineering_profile
        : undefined;
    expect(JSON.stringify(profile)).toContain('coefficient domain is unknown');
    await expect(f.service.recordHumanAdjudication(f.job.id, request)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('refuses cropped context, wrong quantity, sibling identity and unconditional projections', async () => {
    const f = await fixture();
    const original = intent(f.p);
    const variants = [
      (s: (typeof original.statements)[number]) => ({
        ...s,
        citations: [{ ...s.citations[0], quote: s.wording }],
      }),
      (s: (typeof original.statements)[number]) => ({
        ...s,
        mapping: {
          kind: 'engineering_profile_fact' as const,
          target: 'engineering_profile' as const,
          quantity: 'pmax_w' as const,
        },
      }),
      (s: (typeof original.statements)[number]) => ({
        ...s,
        applicability: {
          relationship: 'source_record' as const,
          citation: { ...s.citations[0], quote: s.citations[0].quote.replace('NP-12', 'NP-24') },
        },
      }),
      (s: (typeof original.statements)[number]) => ({
        ...s,
        mapping: { kind: 'scalar' as const, target: 'electrical.nominal_voltage_v' },
      }),
    ];
    for (const mutate of variants)
      await expect(
        f.service.previewHumanAdjudication(f.job.id, {
          expected_review_snapshot: reviewPackageSnapshot(f.p.review_package),
          actor_label: 'CONTROLLED TEST AUTHOR',
          intent: { ...original, statements: [mutate(original.statements[0])] },
        }),
      ).rejects.toMatchObject({ status: 400 });
  });
  it('exposes a literal shared native model column without guessing retail aliases or neighboring values', async () => {
    const table =
      '<html><body><h1>Invented controller manual</h1><table><tr><th></th><th>MPPT-X</th><th>MPPT-Y</th></tr><tr><td>Maximum PV open circuit voltage</td><td>90V</td><td>160V</td></tr><tr><td>Battery voltage</td><td colspan="2">24V</td></tr><tr><td colspan="3">All specifications require review at the declared temperature.</td></tr></table></body></html>';
    const f = await fixture(table, 'MPPT-Y', undefined);
    expect(
      f.p.qualified_facts.find((v) => v.metadata.source_label === 'Maximum PV open circuit voltage')
        ?.metadata.raw_value,
    ).toBe('160V');
    const suggestions = suggestEngineeringProfileSources(f.p.intake, f.p.document_extractions);
    expect(
      suggestions.find(
        (s) =>
          s.statement.mapping?.kind === 'engineering_profile_fact' &&
          s.statement.mapping.quantity === 'pv_absolute_voc_v',
      )?.statement.value,
    ).toBe('160V');
    const bad = await fixture(table.replace('colspan="2"', 'colspan="3"'), 'MPPT-Y', undefined);
    expect(bad.p.qualified_facts).toHaveLength(0);
    const alias = await fixture(table, 'Invented MPPT-Y', undefined);
    expect(alias.p.qualified_facts).toHaveLength(0);
  });
});
