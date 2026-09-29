// @vitest-environment node
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  artifactDigest,
  reviewPackageSnapshot,
  type ProductionPromotionDecisions,
} from '@expedition/ingestion';
import { createOperatorApi } from '../server/api.js';
import { constructApproval } from '../server/product-review.js';
import { jobDetail } from '../server/operator-views.js';
import { fixtureService, input } from './fixtures.js';
import { IngestionJobService, FileIngestionJobStore } from '@expedition/ingestion-runtime';

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
const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
async function fixture(candidate: boolean | 'qualified' | 'mixed' = true, resolved = false) {
  const root = await mkdtemp(join(tmpdir(), 'human-review-'));
  roots.push(root);
  const service = fixtureService(join(root, 'jobs'), candidate);
  const canonical = join(root, 'canonical');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(canonical);
  const server = createOperatorApi(service, undefined, undefined, canonical);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const url = `http://127.0.0.1:${address.port}/api/ingestion/jobs`;
  const intake = { ...input } as Partial<typeof input>;
  if (resolved) delete intake.official_product_uri;
  if (typeof candidate === 'string') delete intake.manufacturer_part_number;
  const created = await (await post(url, intake)).json();
  const id: string = created.summary.id;
  if (resolved) {
    const attempt = await (
      await post(`${url}/${id}/source-resolution/candidates`, {
        official_product_uri: input.official_product_uri,
      })
    ).json();
    await post(`${url}/${id}/source-resolution/accept`, {
      attempt_id: attempt.source_resolution.attempts[0].attempt_id,
    });
  }
  const detail = await (await post(`${url}/${id}/prepare`, {})).json();
  const job = await service.getJob(id);
  const selections: ProductionPromotionDecisions = {
    approved_fields: Object.keys(
      job.preparation?.status === 'review_ready'
        ? (job.preparation.bridge.candidate?.field_evidence ?? {})
        : {},
    ),
    evidence_acknowledged: true,
    category: 'distribution',
    product_role: 'distribution_panel',
  };
  const human = { reviewer_id: 'Offline reviewer', promotion_decisions: selections };
  return { root, canonical, service, url: `${url}/${id}`, id, job, detail, human, selections };
}
describe('human review and guarded finalization API', () => {
  it('derives operator stage counts from the durable preparation without treating extraction as qualification', async () => {
    const f = await fixture();
    const p = f.job.preparation;
    if (!p || p.status !== 'review_ready') throw new Error('Fixture did not prepare');
    const stage = f.detail.pipeline_summary;
    expect(stage.capture_dispositions.authoritative).toBe(
      p.captures.filter((capture) => capture.disposition === 'authoritative').length,
    );
    expect(stage.extraction_results).toBe(p.document_extractions.length);
    expect(stage.extracted_observations).toBe(
      p.document_extractions.reduce((count, extraction) => count + extraction.blocks.length, 0),
    );
    expect(stage.qualified_facts).toBe(p.qualified_facts.length);
    expect(stage.reconciliation_groups).toBe(p.reconciliation.group_reconciliations.length);
    expect(stage.semantic_proposals).toBe(p.proposals.length);
    expect(stage.projected_fields).toBe(
      Object.keys(p.bridge.candidate?.field_evidence ?? {}).length,
    );
    expect(stage.qualified_values).toBe(0);
  });
  it('approves offline Ekrano-shaped qualified-only evidence through the real operator API, then separately finalizes', async () => {
    const f = await fixture('qualified');
    const review = f.detail.product_review;
    expect(review.fields).toEqual([]);
    expect(review.qualified_values).toHaveLength(2);
    const voltage = review.qualified_values.find(
      (a: { target: string }) => a.target === 'electrical.input_voltage_range_v',
    );
    const dimensions = review.qualified_values.find(
      (a: { target: string }) => a.target === 'dimensions_mm',
    );
    expect(voltage).toMatchObject({
      value: { min: 8, max: 70 },
      qualifiers: { electrical_domain: 'dc' },
    });
    expect(dimensions).toMatchObject({
      value: { x: 187, y: 29.8, z: 124 },
      qualifiers: {
        physical_scope: {
          kind: 'physical_body',
          exclusions: ['connectors', 'mounting_accessories'],
        },
      },
    });
    for (const assertion of review.qualified_values) {
      expect(assertion.candidate_fact_ids.length).toBeGreaterThan(0);
      expect(assertion.proposals[0].evidence[0].source_uri).toContain('https://');
      expect(assertion.proposals[0].evidence[0].locators.length).toBeGreaterThan(0);
    }
    expect(f.job.preparation?.status).toBe('review_ready');
    if (f.job.preparation?.status !== 'review_ready') throw new Error('Not prepared');
    expect(f.job.preparation.bridge.candidate?.identity.manufacturer_part_number).toBeUndefined();
    expect(f.job.preparation.bridge.candidate?.component_data.electrical).toBeUndefined();
    expect(f.job.preparation.bridge.candidate?.component_data.dimensions_mm).toBeUndefined();
    const human = {
      ...f.human,
      promotion_decisions: {
        ...f.selections,
        approved_fields: [],
        approved_qualified_value_ids: review.qualified_values.map((a: { id: string }) => a.id),
      },
    };
    const approval = constructApproval(f.job, 'approved', human);
    expect(approval.review_package_snapshot).toBe(
      reviewPackageSnapshot(f.job.preparation.review_package),
    );
    expect((await post(`${f.url}/review/approve`, human)).status).toBe(200);
    expect(await readdir(f.canonical)).toEqual([]);
    expect((await f.service.getJob(f.id)).finalization_request).toBeUndefined();
    expect((await post(`${f.url}/finalize`, {})).status).toBe(400);
    expect((await post(`${f.url}/finalize`, { write: true })).status).toBe(200);
    const durable = await f.service.getJob(f.id);
    expect(durable.final_result?.promotion.result.status).toBe('success');
    expect(durable.final_result?.write_result.status).toBe('written');
    const component = durable.final_result?.promotion.result.proposal;
    expect(component?.qualified_values).toHaveLength(2);
    expect(component?.electrical).toBeUndefined();
    expect(component?.dimensions_mm).toBeUndefined();
    expect(component?.verification_status).toBe('unverified');
  });
  it.each(['fields', 'qualified', 'both'] as const)(
    'mixed candidate explicitly selects %s',
    async (selection) => {
      const f = await fixture('mixed');
      const ids = f.detail.product_review.qualified_values.map((a: { id: string }) => a.id);
      expect(ids).toHaveLength(2);
      const human = {
        ...f.human,
        promotion_decisions: {
          ...f.selections,
          approved_fields: selection === 'qualified' ? [] : f.selections.approved_fields,
          approved_qualified_value_ids: selection === 'fields' ? [] : ids,
        },
      };
      expect((await post(`${f.url}/review/approve`, human)).status).toBe(200);
      expect(await readdir(f.canonical)).toEqual([]);
      await post(`${f.url}/finalize`, { write: true });
      const proposal = (await f.service.getJob(f.id)).final_result?.promotion.result.proposal;
      expect(proposal?.qualified_values === undefined).toBe(selection === 'fields');
      expect(proposal?.electrical === undefined).toBe(selection === 'qualified');
    },
  );
  it.each(['reject', 'defer'] as const)(
    'qualified-only %s needs no promotion selections',
    async (action) => {
      const f = await fixture('qualified');
      expect((await post(`${f.url}/review/${action}`, { reviewer_id: 'Human' })).status).toBe(200);
      expect((await f.service.getJob(f.id)).approval?.promotion_decisions).toBeUndefined();
      expect(await readdir(f.canonical)).toEqual([]);
    },
  );
  it('guards qualified selections and incompatible evidence decisions', async () => {
    const f = await fixture('qualified');
    const assertion = f.detail.product_review.qualified_values[0];
    for (const change of [
      { approved_qualified_value_ids: [] },
      { approved_qualified_value_ids: ['unknown'] },
      { approved_qualified_value_ids: [assertion.id, assertion.id] },
      { approved_qualified_value_ids: [42] },
      { approved_fields: ['qualified_values'] },
      { approved_fields: ['qualified_values.0'] },
      {
        approved_qualified_value_ids: [assertion.id],
        excluded_fact_ids: assertion.candidate_fact_ids,
      },
      {
        approved_qualified_value_ids: [assertion.id],
        reviewed_evidence_fact_ids: assertion.candidate_fact_ids,
      },
    ])
      expect(
        (
          await post(`${f.url}/review/approve`, {
            ...f.human,
            promotion_decisions: { ...f.selections, approved_fields: [], ...change },
          })
        ).status,
      ).toBe(400);
    expect(await readdir(f.canonical)).toEqual([]);
  });

  it('derives exact binding, persists approval across restart, and does not finalize', async () => {
    const f = await fixture();
    const response = await post(`${f.url}/review/approve`, f.human);
    expect(response.status).toBe(200);
    const durable = await fixtureService(join(f.root, 'jobs')).getJob(f.id);
    expect(durable.state).toBe('approved');
    expect(durable.finalization_request).toBeUndefined();
    if (f.job.preparation?.status !== 'review_ready') throw new Error('Not prepared');
    expect(durable.approval?.review_package.digest).toBe(
      artifactDigest(f.job.preparation.review_package),
    );
    expect(durable.approval?.review_package_snapshot).toBe(
      reviewPackageSnapshot(f.job.preparation.review_package),
    );
    expect(durable.approval?.semantic_snapshot).toBe(
      f.job.preparation.review_package.semantic_snapshot,
    );
    expect(durable.intake).toEqual(f.job.intake);
    expect(await readdir(f.canonical)).toEqual([]);
  });
  it.each(['reject', 'defer'] as const)(
    'allows no-candidate %s with no promotion conversion and survives restart',
    async (action) => {
      const f = await fixture(false);
      const result = await post(`${f.url}/review/${action}`, { reviewer_id: 'Human' });
      expect(result.status).toBe(200);
      const durable = await fixtureService(join(f.root, 'jobs'), false).getJob(f.id);
      expect(durable.state).toBe(action === 'reject' ? 'review_rejected' : 'review_deferred');
      expect(durable.approval?.promotion_decisions).toBeUndefined();
      expect(durable.finalization_request).toBeUndefined();
      expect((await post(`${f.url}/finalize`, { write: true })).status).toBe(409);
      expect(await readdir(f.canonical)).toEqual([]);
    },
  );
  it('rejects no-candidate approval', async () => {
    const f = await fixture(false);
    expect((await post(`${f.url}/review/approve`, f.human)).status).toBe(409);
  });
  it('rejects forged browser authority, references, destinations and promotions', async () => {
    const f = await fixture();
    for (const key of [
      'review_package',
      'review_package_snapshot',
      'semantic_snapshot',
      'source_refs',
      'reviewed_at',
    ])
      expect((await post(`${f.url}/review/approve`, { ...f.human, [key]: 'forged' })).status).toBe(
        400,
      );
    await post(`${f.url}/review/approve`, f.human);
    for (const key of [
      'destinationRoot',
      'filename',
      'overwrite',
      'promotion',
      'catalogComponents',
    ])
      expect((await post(`${f.url}/finalize`, { write: true, [key]: 'forged' })).status).toBe(400);
    expect((await f.service.getJob(f.id)).state).toBe('approved');
  });
  it('requires explicit fields, evidence acknowledgement, category, role and reviewer', async () => {
    const f = await fixture();
    for (const change of [
      { approved_fields: [] },
      { evidence_acknowledged: false },
      { category: '' },
      { product_role: '' },
      { product_role: 'invented' },
    ])
      expect(
        (
          await post(`${f.url}/review/approve`, {
            ...f.human,
            promotion_decisions: { ...f.selections, ...change },
          })
        ).status,
      ).toBe(400);
    expect((await post(`${f.url}/review/approve`, { ...f.human, reviewer_id: '' })).status).toBe(
      400,
    );
    expect((await post(`${f.url}/review/approve`, { reviewer_id: 'Human' })).status).toBe(400);
  });
  it('rejects unknown fields, contradictory exclusions and unsupported fact resolutions', async () => {
    const f = await fixture();
    const field = f.selections.approved_fields[0];
    for (const change of [
      { approved_fields: ['fabricated'] },
      { excluded_fields: [field] },
      { reviewed_evidence_fact_ids: ['fabricated'] },
      {
        field_resolutions: {
          [field]: { selected_fact_id: 'fabricated', rationale: 'Human choice' },
        },
      },
    ])
      expect(
        (
          await post(`${f.url}/review/approve`, {
            ...f.human,
            promotion_decisions: { ...f.selections, ...change },
          })
        ).status,
      ).toBe(400);
  });
  it('existing runtime rejects stale review and semantic binding', async () => {
    const f = await fixture();
    const approval = constructApproval(f.job, 'approved', f.human);
    const stale = `sha256:${'0'.repeat(64)}`;
    for (const change of [{ semantic_snapshot: stale }, { review_package_snapshot: stale }])
      await expect(f.service.submitApproval(f.id, { ...approval, ...change })).rejects.toThrow(
        'exact review package',
      );
  });
  it('requires write:true and uses only server destination, persisting final result across restart', async () => {
    const f = await fixture();
    await post(`${f.url}/review/approve`, f.human);
    for (const input of [{}, { write: false }])
      expect((await post(`${f.url}/finalize`, input)).status).toBe(400);
    expect(await readdir(f.canonical)).toEqual([]);
    const result = await (await post(`${f.url}/finalize`, { write: true })).json();
    expect(result.finalization.write_status).toBe('written');
    const durable = await fixtureService(join(f.root, 'jobs')).getJob(f.id);
    expect(durable.state).toBe('finalized');
    expect(durable.finalization_request?.write_request).toEqual({
      destinationRoot: f.canonical,
      write: true,
      overwrite: false,
    });
    expect(await readdir(f.canonical)).toHaveLength(1);
    expect(durable.intake).toEqual(f.job.intake);
    expect((await post(`${f.url}/finalize`, { write: true })).status).toBe(409);
  });
  it('preserves collision content and exposes collision without internal paths', async () => {
    const f = await fixture();
    await post(`${f.url}/review/approve`, f.human);
    const target = join(f.canonical, `${f.detail.product_review.canonical_id}.yaml`);
    await writeFile(target, 'sentinel');
    const result = await (await post(`${f.url}/finalize`, { write: true })).json();
    expect(result.finalization).toMatchObject({ collision: true, write_status: 'blocked' });
    expect(await readFile(target, 'utf8')).toBe('sentinel');
    expect(JSON.stringify(result)).not.toContain(f.root);
  });
  it('returns blocked promotion distinctly rather than successful write', async () => {
    const f = await fixture();
    await post(`${f.url}/review/approve`, f.human);
    const original = f.service.finalizeJob.bind(f.service);
    const finalize = vi
      .spyOn(f.service, 'finalizeJob')
      .mockImplementation((id, request) =>
        original(id, request, { components: [{ id: f.detail.product_review.canonical_id }] }),
      );
    await post(`${f.url}/finalize`, { write: true });
    expect(finalize).toHaveBeenCalledOnce();
    expect((await f.service.getJob(f.id)).final_result?.write_result.status).toBe('blocked');
    expect(await readdir(f.canonical)).toEqual([]);
  });
  it('source-resolved jobs bind provenance through guarded finalization without changing intake', async () => {
    const f = await fixture(true, true);
    await post(`${f.url}/review/approve`, f.human);
    await post(`${f.url}/finalize`, { write: true });
    const durable = await fixtureService(join(f.root, 'jobs')).getJob(f.id);
    expect(durable.final_result?.write_result.status).toBe('written');
    expect(durable.preparation?.source_resolution?.disposition).toBe('accepted');
    expect(durable.intake).toEqual(f.job.intake);
    expect(durable.intake.official_product_uri).toBeUndefined();
    expect(jobDetail(durable).product_review?.fields.length).toBeGreaterThan(0);
  });
  it('projects all evidence and locators while omitting bodies, byte arrays and writer internals', async () => {
    const f = await fixture();
    const review = f.detail.product_review;
    expect(review.fields.length).toBeGreaterThan(0);
    if (f.job.preparation?.status !== 'review_ready') throw new Error('Not prepared');
    const p = f.job.preparation;
    const first = p.proposals[0];
    const multiple = jobDetail({
      ...f.job,
      preparation: { ...p, proposals: [...p.proposals, { ...first, id: 'another.proposal' }] },
    });
    expect(
      multiple.product_review?.fields.find((field) => field.path === first.target)?.proposals,
    ).toHaveLength(2);
    expect(review.fields[0].proposals[0].evidence.length).toBeGreaterThan(1);
    const evidence = review.fields[0].proposals[0].evidence[0];
    expect(evidence.source_uri).toContain('https://');
    expect(evidence.locators.length).toBeGreaterThan(0);
    for (const forbidden of [
      'RAW_BODY_MARKER',
      '"bytes"',
      '"body"',
      '"serialized"',
      'destinationRoot',
    ])
      expect(JSON.stringify(f.detail)).not.toContain(forbidden);
  });
  it('preserves finalization failure and exposes no recovery action or internal path', async () => {
    const f = await fixture();
    await post(`${f.url}/review/approve`, f.human);
    const failing = new IngestionJobService({
      store: new FileIngestionJobStore(join(f.root, 'jobs')),
      preparationRequest: () => {
        throw new Error('Not called');
      },
      finalize: async () => {
        throw new Error(`Private failure ${f.root}`);
      },
    });
    const result = jobDetail(
      await failing.finalizeJob(f.id, { destinationRoot: f.canonical, write: true }),
    );
    expect(result.summary.state).toBe('finalization_failed');
    expect((await f.service.getJob(f.id)).finalization_request).toBeDefined();
    expect(JSON.stringify(result)).not.toContain(f.root);
    await expect(
      failing.finalizeJob(f.id, { destinationRoot: f.canonical, write: true }),
    ).rejects.toThrow('Cannot finalize');
  });
});
