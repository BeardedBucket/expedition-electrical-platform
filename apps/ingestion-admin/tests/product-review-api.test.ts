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
import {
  FileIngestionBatchStore,
  FileIngestionJobStore,
  IngestionBatchService,
  IngestionJobService,
} from '@expedition/ingestion-runtime';
import type { SemanticDecisionRequest } from '@expedition/ingestion-runtime';

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
async function fixture(
  candidate: boolean | 'qualified' | 'mixed' | 'semantic' | 'provenance' = true,
  resolved = false,
) {
  const root = await mkdtemp(join(tmpdir(), 'human-review-'));
  roots.push(root);
  const service = fixtureService(join(root, 'jobs'), candidate);
  const canonical = join(root, 'canonical');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(canonical);
  const operatorService = new IngestionBatchService({
    store: new FileIngestionBatchStore(join(root, 'batches')),
    jobService: service,
  });
  const server = createOperatorApi(operatorService, undefined, undefined, canonical);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const url = `http://127.0.0.1:${address.port}/api/ingestion/jobs`;
  const intake = { ...input } as Partial<typeof input>;
  if (resolved) delete intake.official_product_uri;
  if (candidate === 'qualified' || candidate === 'mixed') delete intake.manufacturer_part_number;
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

const semanticRequest = (
  job: Awaited<ReturnType<IngestionJobService['getJob']>>,
): Extract<SemanticDecisionRequest, { outcome: 'map' }> => {
  const preparation = job.preparation;
  if (preparation?.status !== 'review_ready') throw new Error('Fixture did not prepare');
  const proposal = preparation.proposals.find(
    (item) => item.target === 'source_label:mystery electrical rating',
  );
  if (!proposal) throw new Error('Fixture has no unsupported semantic proposal');
  return {
    proposal_id: proposal.id,
    expected_review_snapshot: reviewPackageSnapshot(preparation.review_package),
    selected_fact_ids: (proposal.fact_refs ?? [])
      .map((reference) => reference.reference)
      .filter((value): value is string => !!value),
    actor_label: 'operator.api-test',
    outcome: 'map',
    target: 'electrical.continuous_output_current_a',
    normalized_value: 150,
    normalized_unit: 'A',
    rationale: 'The retained row identifies the current rating.',
  };
};

describe('human review and guarded finalization API', () => {
  it('discovers explicit targets, previews without persistence, and persists the exact preview', async () => {
    const f = await fixture('semantic');
    const request = semanticRequest(await f.service.getJob(f.id));
    const targetPath = `${f.url}/review/semantic-proposals/${encodeURIComponent(request.proposal_id)}`;
    const path = join(f.root, 'jobs', `${f.id}.json`);
    const before = await readFile(path, 'utf8');
    const targetResponse = await post(`${targetPath}/targets`, {
      expected_review_snapshot: request.expected_review_snapshot,
      selected_fact_ids: request.selected_fact_ids,
    });
    expect(targetResponse.status).toBe(200);
    const discovered = await targetResponse.json();
    expect(discovered.proposal_id).toBe(request.proposal_id);
    expect(discovered.targets).toContainEqual(
      expect.objectContaining({
        canonical_field: 'electrical.continuous_output_current_a',
        dimension: 'current',
        unit: 'A',
        human_adjudication: 'source_fact',
      }),
    );
    expect(
      discovered.targets.every(
        (target: Record<string, unknown>) => !('normalize' in target) && !('aliases' in target),
      ),
    ).toBe(true);
    expect(JSON.stringify(discovered)).not.toMatch(/checksum|lock_version/i);

    const previewResponse = await post(`${targetPath}/preview`, {
      expected_review_snapshot: request.expected_review_snapshot,
      selected_fact_ids: request.selected_fact_ids,
      target: request.target,
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    expect(preview).toMatchObject({
      target: request.target,
      selected_fact_ids: request.selected_fact_ids,
      source_assertions: [
        { raw_value: '150', source_unit: 'A', effective_source_unit: 'A' },
        { raw_value: '150', source_unit: 'A', effective_source_unit: 'A' },
      ],
      normalized_value: 150,
      normalized_unit: 'A',
    });
    expect(await readFile(path, 'utf8')).toBe(before);
    expect((await f.service.getJob(f.id)).preparation?.status).toBe('review_ready');
    if ((await f.service.getJob(f.id)).preparation?.status === 'review_ready')
      expect(
        (await f.service.getJob(f.id)).preparation?.bridge.reviewed_semantic_decisions,
      ).toEqual([]);
    expect(
      (
        await post(`${targetPath}/targets`, {
          expected_review_snapshot: 'sha256:stale',
          selected_fact_ids: request.selected_fact_ids,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post(`${targetPath}/preview`, {
          expected_review_snapshot: 'sha256:stale',
          selected_fact_ids: request.selected_fact_ids,
          target: request.target,
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await post(`${targetPath}/preview`, {
          expected_review_snapshot: request.expected_review_snapshot,
          selected_fact_ids: request.selected_fact_ids,
          target: request.target,
          normalized_value: 150,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(`${targetPath}/targets`, {
          expected_review_snapshot: request.expected_review_snapshot,
          selected_fact_ids: request.selected_fact_ids,
          revision: 50,
        })
      ).status,
    ).toBe(400);

    const persisted = await post(`${f.url}/review/semantic-decisions`, {
      ...request,
      normalized_value: preview.normalized_value,
      normalized_unit: preview.normalized_unit,
    });
    expect(persisted.status).toBe(200);
    const saved = await persisted.json();
    expect(saved.semantic_review.decisions[0]).toMatchObject({
      proposal_id: request.proposal_id,
      target: preview.target,
      selected_fact_ids: preview.selected_fact_ids,
      normalized_value: preview.normalized_value,
      normalized_unit: preview.normalized_unit,
    });
  });

  it('records a selected-fact rejection through the batch-backed operator API exactly once', async () => {
    const f = await fixture('semantic');
    const current = await f.service.getJob(f.id);
    if (current.preparation?.status !== 'review_ready')
      throw new Error('Fixture did not reach review_ready.');
    const proposal = current.preparation.proposals.find(
      (item) => item.target === 'source_label:mystery electrical rating',
    );
    if (!proposal) throw new Error('Fixture has no unsupported semantic proposal.');
    const selectedFactIds = (proposal.fact_refs ?? [])
      .map((reference) => reference.reference)
      .filter((value): value is string => !!value);
    const request = {
      proposal_id: proposal.id,
      expected_review_snapshot: reviewPackageSnapshot(current.preparation.review_package),
      selected_fact_ids: selectedFactIds,
      actor_label: 'Human acceptance reviewer',
      outcome: 'reject',
      rationale:
        '“Model / SKU” is a table/field label, not a product value or semantic product assertion. The actual product MPN B24100A-C is represented in identity/applicability context, not in this retained fact. This qualified assertion should not project into canonical component data.',
    };

    const response = await post(`${f.url}/review/semantic-decisions`, request);
    expect(response.status).toBe(200);
    const rebuilt = await response.json();
    expect(rebuilt.semantic_review).toMatchObject({
      complete: true,
      required_dispositions: [],
      decisions: [
        expect.objectContaining({
          proposal_id: proposal.id,
          revision: 1,
          outcome: 'reject',
          selected_fact_ids: selectedFactIds,
        }),
      ],
    });

    const persisted = await new FileIngestionJobStore(join(f.root, 'jobs')).load(f.id);
    if (persisted.preparation?.status !== 'review_ready')
      throw new Error('Persisted job left review_ready unexpectedly.');
    const history = persisted.preparation.bridge.reviewed_semantic_decisions;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ outcome: 'reject', revision: 1 });
    expect(history[0].selected_fact_refs?.map((reference) => reference.reference)).toEqual(
      selectedFactIds,
    );
    expect(persisted.preparation.bridge.projected_proposal_ids).not.toContain(proposal.id);
    expect(
      rebuilt.semantic_review.interpretation.find(
        (entry: { proposal_id: string }) => entry.proposal_id === proposal.id,
      )?.state,
    ).toBe('reject');
  });

  it('returns no targets and rejects mapping preview for a derived proposal', async () => {
    const f = await fixture('semantic');
    const store = new FileIngestionJobStore(join(f.root, 'jobs'));
    const { job, version } = await store.loadVersioned(f.id);
    if (job.preparation?.status !== 'review_ready') throw new Error('Fixture not review-ready');
    const proposal = job.preparation.proposals.find(
      (item) => item.target === 'source_label:mystery electrical rating',
    );
    if (!proposal) throw new Error('Fixture proposal missing');
    const derived = {
      ...proposal,
      derivation: {
        status: 'derived' as const,
        rule_version: 'test',
        formula: 'test',
        input_targets: [],
        input_units: [],
        output_unit: 'A',
        assumptions: [],
      },
    };
    const replace = (proposals: typeof job.preparation.proposals) =>
      proposals.map((item) => (item.id === proposal.id ? derived : item));
    await store.save(
      {
        ...job,
        preparation: {
          ...job.preparation,
          proposals: replace(job.preparation.proposals),
          bridge: {
            ...job.preparation.bridge,
            proposals: replace(job.preparation.bridge.proposals),
          },
        },
      },
      version,
    );
    const snapshot = reviewPackageSnapshot(job.preparation.review_package);
    const base = `${f.url}/review/semantic-proposals/${encodeURIComponent(proposal.id)}`;
    const targetsResponse = await post(`${base}/targets`, {
      expected_review_snapshot: snapshot,
    });
    expect(targetsResponse.status, JSON.stringify(await targetsResponse.clone().json())).toBe(200);
    const targets = await targetsResponse.json();
    expect(targets.targets).toEqual([]);
    expect(
      (
        await post(`${base}/preview`, {
          expected_review_snapshot: snapshot,
          target: 'electrical.continuous_output_current_a',
        })
      ).status,
    ).toBe(400);
  });

  it('projects separate required, reviewed, automatic and derived semantic groups with safe evidence', async () => {
    const f = await fixture('semantic');
    const semantic = f.detail.semantic_review;
    const proposal =
      f.job.preparation?.status === 'review_ready'
        ? f.job.preparation.proposals.find(
            (item) => item.target === 'source_label:mystery electrical rating',
          )
        : undefined;
    expect(proposal).toBeDefined();
    const required = semantic.work.required.find(
      (item: { id: string }) => item.id === proposal?.id,
    );
    expect(required).toMatchObject({
      automatic_disposition: 'unsupported',
      required: true,
      evidence: expect.arrayContaining([
        expect.objectContaining({
          raw_value: '150',
          unit: 'A',
          label: 'Mystery electrical rating',
        }),
      ]),
    });
    expect(
      semantic.work.automatic.some(
        (item: { automatic_disposition: string }) => item.automatic_disposition === 'mapped',
      ),
    ).toBe(true);
    expect(semantic.work.derived.every((item: { derived: boolean }) => item.derived)).toBe(true);
    expect(JSON.stringify(semantic)).not.toMatch(
      /store_checksum|lock_version|persistence_envelope/i,
    );
  });

  it('exposes canonical units and value origin beside exact retained measurement evidence', async () => {
    const f = await fixture('provenance');
    const fields = f.detail.product_review.fields;
    const cases = [
      {
        target: 'dimensions_mm',
        unit: 'mm',
        canonicalValue: { x: 180, y: 30, z: 120 },
        sourceLabel: 'Outer dimensions (h x w x d)',
        rawValue: '12 x 18 x 3 cm',
      },
      {
        target: 'weight_kg',
        unit: 'kg',
        canonicalValue: 36.650263496,
        sourceLabel: 'Weight',
        rawValue: '80.8',
        sourceUnit: 'lb',
      },
      {
        target: 'electrical.nominal_voltage_v',
        unit: 'V',
        canonicalValue: 12,
        sourceLabel: 'Nominal voltage',
        rawValue: '12',
        sourceUnit: 'V',
      },
      {
        target: 'electrical.continuous_current_a',
        unit: 'A',
        canonicalValue: 150,
        sourceLabel: 'Continuous current',
        rawValue: '150',
        sourceUnit: 'A',
      },
    ];

    for (const example of cases) {
      const field = fields.find((candidate) => candidate.path === example.target);
      expect(field).toMatchObject({
        value: example.canonicalValue,
        display_value: example.canonicalValue,
        canonical_unit: example.unit,
      });
      expect(field?.proposals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: example.canonicalValue,
            display_value: example.canonicalValue,
            canonical_unit: example.unit,
            value_origin: 'normalized / converted',
            evidence: expect.arrayContaining([
              expect.objectContaining({
                label: example.sourceLabel,
                raw_value: example.rawValue,
                ...(example.sourceUnit ? { unit: example.sourceUnit } : {}),
              }),
            ]),
          }),
        ]),
      );
    }

    const nominalVoltage = f.detail.semantic_review.work.automatic.find(
      (item: { automatic_target: string }) =>
        item.automatic_target === 'electrical.nominal_voltage_v',
    );
    expect(nominalVoltage).toMatchObject({
      automatic_value: 12,
      display_value: 12,
      canonical_unit: 'V',
      value_origin: 'normalized / converted',
      derived: false,
    });
    expect(
      fields
        .flatMap((field: { proposals: { id: string; projected: boolean }[] }) => field.proposals)
        .find((proposal: { id: string }) => proposal.id === nominalVoltage.id),
    ).toMatchObject({ projected: true });
    expect(nominalVoltage.projected_field).toBe('electrical.nominal_voltage_v');
  });

  it('provides a clean display projection without changing a noisy candidate value', async () => {
    const f = await fixture('provenance');
    const noisyJob = structuredClone(f.job);
    const preparation = noisyJob.preparation;
    const candidate =
      preparation?.status === 'review_ready' ? preparation.bridge.candidate : undefined;
    if (!candidate) throw new Error('Fixture did not produce a candidate.');
    const dimensions = candidate.component_data.dimensions_mm;
    if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions))
      throw new Error('Fixture did not produce object-shaped dimensions.');
    candidate.component_data.dimensions_mm = {
      ...dimensions,
      x: 180.08599999999998,
    };

    const width = jobDetail(noisyJob).product_review?.fields.find(
      (field) => field.path === 'dimensions_mm',
    );
    expect(width?.value).toMatchObject({ x: 180.08599999999998 });
    expect(width?.display_value).toMatchObject({ x: 180.086 });
  });

  it('records a map decision through the API and returns rebuilt safe review state', async () => {
    const f = await fixture('semantic');
    const request = semanticRequest(await f.service.getJob(f.id));
    const response = await post(`${f.url}/review/semantic-decisions`, request);
    expect(response.status).toBe(200);
    const detail = await response.json();
    expect(detail.semantic_review).toMatchObject({
      complete: true,
      decisions: [
        expect.objectContaining({
          proposal_id: request.proposal_id,
          revision: 1,
          active: true,
          outcome: 'map',
          target: request.target,
        }),
      ],
    });
    expect(detail.semantic_review.interpretation).toContainEqual(
      expect.objectContaining({
        proposal_id: request.proposal_id,
        state: 'human_mapped',
        target: request.target,
      }),
    );
    expect(detail.semantic_review.expected_review_snapshot).toBe(
      reviewPackageSnapshot((await f.service.getJob(f.id)).preparation!.review_package),
    );
    expect(detail.review_package.semantic_snapshot).not.toBe(
      f.detail.review_package.semantic_snapshot,
    );
    expect(JSON.stringify(detail)).not.toMatch(
      /reviewed_semantic_decisions|input_snapshot|validation_policy_version|previous_decision|lock_version/,
    );
  });

  it('records a non-map disposition without projecting a canonical fact', async () => {
    const f = await fixture('semantic');
    const map = semanticRequest(await f.service.getJob(f.id));
    const request = {
      proposal_id: map.proposal_id,
      expected_review_snapshot: map.expected_review_snapshot,
      selected_fact_ids: map.selected_fact_ids,
      actor_label: map.actor_label,
      outcome: 'evidence_only',
    };
    const response = await post(`${f.url}/review/semantic-decisions`, request);
    expect(response.status).toBe(200);
    const detail = await response.json();
    expect(detail.semantic_review.decisions[0]).toMatchObject({
      proposal_id: map.proposal_id,
      outcome: 'evidence_only',
      active: true,
    });
    expect(detail.semantic_review.interpretation).toContainEqual(
      expect.objectContaining({ proposal_id: map.proposal_id, state: 'evidence_only' }),
    );
    expect(
      detail.candidate.projected_fields.electrical?.continuous_output_current_a,
    ).toBeUndefined();
  });

  it('blocks incomplete approval with safe required proposal IDs and no durable change', async () => {
    const f = await fixture('semantic');
    const path = join(f.root, 'jobs', `${f.id}.json`);
    const before = await readFile(path, 'utf8');
    const response = await post(`${f.url}/review/approve`, f.human);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        message: expect.stringMatching(/semantic review is incomplete/i),
        proposal_ids: expect.arrayContaining([expect.stringMatching(/^semantic-proposal\./)]),
      },
    });
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('rejects stale snapshots and invalid map intents without changing durable bytes', async () => {
    const f = await fixture('semantic');
    const request = semanticRequest(await f.service.getJob(f.id));
    const path = join(f.root, 'jobs', `${f.id}.json`);
    const before = await readFile(path, 'utf8');
    expect(
      (
        await post(`${f.url}/review/semantic-decisions`, {
          ...request,
          expected_review_snapshot: 'sha256:stale',
        })
      ).status,
    ).toBe(409);
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(
      (
        await post(`${f.url}/review/semantic-decisions`, {
          ...request,
          target: 'electrical.not_a_supported_target',
        })
      ).status,
    ).toBe(400);
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('rejects caller-authored decision bindings and derived proposal adjudication', async () => {
    const f = await fixture('semantic');
    const request = semanticRequest(await f.service.getJob(f.id));
    const path = join(f.root, 'jobs', `${f.id}.json`);
    const beforeForgery = await readFile(path, 'utf8');
    expect(
      (
        await post(`${f.url}/review/semantic-decisions`, {
          ...request,
          id: 'caller-id',
          revision: 99,
          previous_decision: {},
          input_snapshot: 'caller-snapshot',
          recorded_at: '2000-01-01T00:00:00.000Z',
          validation_policy_version: 'caller-policy',
        })
      ).status,
    ).toBe(400);
    expect(await readFile(path, 'utf8')).toBe(beforeForgery);

    const store = new FileIngestionJobStore(join(f.root, 'jobs'));
    const { job, version } = await store.loadVersioned(f.id);
    if (job.preparation?.status !== 'review_ready') throw new Error('Fixture not review-ready');
    const derivedProposal = job.preparation.proposals.find(
      (proposal) => proposal.id === request.proposal_id,
    );
    if (!derivedProposal) throw new Error('Fixture proposal disappeared');
    const derived = {
      ...derivedProposal,
      derivation: {
        status: 'derived' as const,
        rule_version: 'test',
        formula: 'test',
        input_targets: [],
        input_units: [],
        output_unit: 'A',
        assumptions: [],
      },
    };
    const saveDerivedProposal = (proposals: typeof job.preparation.proposals) =>
      proposals.map((proposal) => (proposal.id === derived.id ? derived : proposal));
    await store.save(
      {
        ...job,
        preparation: {
          ...job.preparation,
          proposals: saveDerivedProposal(job.preparation.proposals),
          bridge: {
            ...job.preparation.bridge,
            proposals: saveDerivedProposal(job.preparation.bridge.proposals),
          },
        },
      },
      version,
    );
    const beforeDerived = await readFile(path, 'utf8');
    const derivedRequest = semanticRequest(await f.service.getJob(f.id));
    const response = await post(`${f.url}/review/semantic-decisions`, derivedRequest);
    expect(response.status).toBe(400);
    expect(await readFile(path, 'utf8')).toBe(beforeDerived);
  });

  it('rejects semantic decisions after approval', async () => {
    const f = await fixture('semantic');
    const request = semanticRequest(await f.service.getJob(f.id));
    await post(`${f.url}/review/semantic-decisions`, {
      proposal_id: request.proposal_id,
      expected_review_snapshot: request.expected_review_snapshot,
      actor_label: request.actor_label,
      outcome: 'evidence_only',
    });
    expect((await post(`${f.url}/review/approve`, f.human)).status).toBe(200);
    const before = await readFile(join(f.root, 'jobs', `${f.id}.json`), 'utf8');
    const response = await post(`${f.url}/review/semantic-decisions`, {
      ...request,
      expected_review_snapshot: reviewPackageSnapshot(
        (await f.service.getJob(f.id)).preparation!.review_package,
      ),
    });
    expect(response.status).toBe(409);
    expect(await readFile(join(f.root, 'jobs', `${f.id}.json`), 'utf8')).toBe(before);
  });

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
      expect(
        (
          await post(`${f.url}/review/${action}`, {
            reviewer_id: 'Human',
            ...(action === 'defer'
              ? {
                  reviewed_decisions: ['Await capability'],
                  expected_lifecycle_snapshot:
                    f.detail.product_review_lifecycle!.expected_lifecycle_snapshot,
                }
              : {}),
          })
        ).status,
      ).toBe(200);
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
      const result = await post(`${f.url}/review/${action}`, {
        reviewer_id: 'Human',
        ...(action === 'defer'
          ? {
              reviewed_decisions: ['Await capability'],
              expected_lifecycle_snapshot:
                f.detail.product_review_lifecycle!.expected_lifecycle_snapshot,
            }
          : {}),
      });
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
  it('explicitly defers and resumes the same review, preserving history and rejecting stale/replayed actions', async () => {
    const f = await fixture(false);
    const body = {
      reviewer_id: 'Human',
      reviewed_decisions: ['Await schema capability'],
      defer_reason: 'schema_gap',
      expected_lifecycle_snapshot: f.detail.product_review_lifecycle!.expected_lifecycle_snapshot,
    };
    expect((await post(`${f.url}/review/defer`, { reviewer_id: 'Human' })).status).toBe(400);
    expect((await post(`${f.url}/review/defer`, { ...body, reviewed_decisions: [] })).status).toBe(
      400,
    );
    expect(
      (await post(`${f.url}/review/defer`, { ...body, defer_reason: 'inferred' })).status,
    ).toBe(400);
    const pausedResponse = await post(`${f.url}/review/defer`, body);
    expect(pausedResponse.status).toBe(200);
    const paused = await pausedResponse.json();
    expect(paused.summary.state).toBe('review_deferred');
    expect(paused.product_review_lifecycle.resumable).toBe(true);
    const resume = {
      expected_lifecycle_snapshot: paused.product_review_lifecycle.expected_lifecycle_snapshot,
      actor_label: 'Resume human',
    };
    expect(
      (await post(`${f.url}/review/resume`, { ...resume, state: 'review_ready' })).status,
    ).toBe(400);
    expect(
      (
        await post(`${f.url}/review/resume`, {
          ...resume,
          expected_lifecycle_snapshot: body.expected_lifecycle_snapshot,
        })
      ).status,
    ).toBe(409);
    const response = await post(`${f.url}/review/resume`, resume);
    expect(response.status).toBe(200);
    const resumed = await response.json();
    expect(resumed.summary.id).toBe(f.id);
    expect(resumed.summary.state).toBe('review_ready');
    expect(resumed.product_review_lifecycle.history).toHaveLength(2);
    expect(resumed.product_review_lifecycle.history[0].rationale).toEqual(body.reviewed_decisions);
    expect(resumed.preparation_recovery.expected_lifecycle_snapshot).toBeDefined();
    expect((await post(`${f.url}/review/resume`, resume)).status).toBe(409);
    expect((await post(`${f.url}/review/defer`, body)).status).toBe(409);
    expect(await readdir(f.canonical)).toEqual([]);
  });
  it.each(['approved', 'finalized', 'review_rejected'] as const)(
    'does not defer or resume a %s job',
    async (state) => {
      const f = await fixture();
      if (state === 'review_rejected')
        await post(`${f.url}/review/reject`, { reviewer_id: 'Human' });
      else {
        expect((await post(`${f.url}/review/approve`, f.human)).status).toBe(200);
        if (state === 'finalized') await post(`${f.url}/finalize`, { write: true });
      }
      expect((await f.service.getJob(f.id)).state).toBe(state);
      expect(
        (
          await post(`${f.url}/review/defer`, {
            reviewer_id: 'Human',
            reviewed_decisions: ['Pause'],
            expected_lifecycle_snapshot:
              f.detail.product_review_lifecycle!.expected_lifecycle_snapshot,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await post(`${f.url}/review/resume`, {
            actor_label: 'Human',
            expected_lifecycle_snapshot:
              f.detail.product_review_lifecycle!.expected_lifecycle_snapshot,
          })
        ).status,
      ).toBe(409);
      expect((await f.service.getJob(f.id)).state).toBe(state);
    },
  );
  it('preserves an existing candidate and review bindings across explicit pause/resume', async () => {
    const f = await fixture();
    const before = await f.service.getJob(f.id);
    const paused = await (
      await post(`${f.url}/review/defer`, {
        reviewer_id: 'Human',
        reviewed_decisions: ['Operator pause before approval'],
        defer_reason: 'operator_pause',
        expected_lifecycle_snapshot: f.detail.product_review_lifecycle!.expected_lifecycle_snapshot,
      })
    ).json();
    expect(paused.summary.state).toBe('review_deferred');
    const response = await post(`${f.url}/review/resume`, {
      actor_label: 'Human',
      expected_lifecycle_snapshot: paused.product_review_lifecycle.expected_lifecycle_snapshot,
    });
    expect(response.status).toBe(200);
    const after = await f.service.getJob(f.id);
    expect(artifactDigest(after.preparation)).toBe(artifactDigest(before.preparation));
    expect(
      after.preparation?.status === 'review_ready' && after.preparation.bridge.candidate,
    ).toBeTruthy();
    expect(after.approval).toBeUndefined();
    expect(after.finalization_request).toBeUndefined();
    expect(await readdir(f.canonical)).toEqual([]);
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
