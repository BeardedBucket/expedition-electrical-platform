import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileIngestionJobStore,
  IngestionJobService,
  type SemanticDecisionRequest,
} from '../src/index.js';
import { serializeJob } from '../src/codec.js';
import * as replacement from '../src/file-replacement.js';
import type { IngestionJob } from '../src/job-service.js';
import type { IngestionJobStore } from '../src/job-store.js';
import {
  artifactReference,
  artifactDigest,
  buildProductionSemanticProposals,
  deterministicSerialize,
  finalizeProductionIngest,
  evaluateSemanticReviewCompletion,
  prepareProductionIngestReview,
  PRODUCTION_SCHEMA_VERSION,
  reviewPackageSnapshot,
  type CapturedSource,
  type ManufacturerAcquisitionProfile,
  type ProductIntake,
  type PromotionCatalogContext,
  type ProductionApproval,
  type ReviewReadyProductionIngest,
  type SourceCaptureAdapter,
} from '@expedition/ingestion';

const productUri = 'https://example.test/products/ex-1';
const documentUri = 'https://example.test/docs/specifications.html';
const intake: ProductIntake = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.finalize',
  manufacturer: 'Example Manufacturer',
  product_model: 'Example Model',
  manufacturer_part_number: 'EX-1',
  official_product_uri: productUri,
};
const specifications = (voltage: string, current: string): string =>
  `<table><thead><tr><th>Model</th><th>nominal voltage</th><th>continuous current</th></tr></thead><tbody><tr><td>EX-1</td><td>${voltage}</td><td>${current}</td></tr></tbody></table>`;
const responses: Readonly<Record<string, string>> = {
  [productUri]: `<html><body><h1>Example Model</h1><p>Official product information for EX-1.</p><a href="${documentUri}">Specifications</a></body></html>`,
  [documentUri]: `<html><body><h1>Specifications</h1>${specifications('24 V', '10 A')}${specifications('24.0 V', '10.0 A')}</body></html>`,
};
const publisher = 'Example Manufacturer Publications';
const profile: ManufacturerAcquisitionProfile = {
  schema_version: '1.2',
  id: 'example.finalize.reviewed',
  profile_status: 'reviewed',
  manufacturer: 'Example Manufacturer',
  publisher,
  official_domains: ['example.test'],
  approved_subdomains: ['www.example.test'],
  allowed_document_domains: ['example.test'],
  strategies: [
    {
      id: 'product-pages',
      status: 'reviewed',
      reference_uri: productUri,
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
        allowed_extensions: ['.html'],
        path_prefix: '/docs/',
        role_hints: [{ pattern: 'specifications', role: 'specification_sheet' }],
        expected_content: [{ kind: 'text_includes', value: 'EX-1' }],
      },
    },
  ],
  provenance: {
    source_artifact: 'packages/ingestion/tests/production-ingest-finalize.test.ts',
    observed_source_content_hash: `sha256:${createHash('sha256').update(new TextEncoder().encode(responses[productUri])).digest('hex')}`,
  },
};
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
const adapter: SourceCaptureAdapter = {
  async capture(request) {
    const html = responses[request.uri];
    return html === undefined
      ? {
          status: 'failed',
          issues: [{ code: 'network_error', message: 'offline fixture missing' }],
        }
      : { status: 'success', source: source(request.uri, html), issues: [] };
  },
};
const prepare = async (
  current = '10 A',
  additionalTable = '',
): Promise<ReviewReadyProductionIngest> => {
  const fixtureAdapter: SourceCaptureAdapter = {
    async capture(request) {
      const html =
        request.uri === documentUri
          ? `<html><body>${specifications('24 V', current)}${specifications('24.0 V', current)}${additionalTable}</body></html>`
          : responses[request.uri];
      return html === undefined
        ? {
            status: 'failed',
            issues: [{ code: 'network_error', message: 'offline fixture missing' }],
          }
        : { status: 'success', source: source(request.uri, html), issues: [] };
    },
  };
  const result = await prepareProductionIngestReview({
    intake,
    profile,
    adapter: fixtureAdapter,
    policy: { now: () => '2026-09-08T00:00:00.000Z' },
  });
  expect(result.status).toBe('review_ready');
  if (result.status !== 'review_ready')
    throw new Error('Offline preparation did not become review-ready.');
  const diagnostics = JSON.stringify({
    facts: result.qualified_facts.map((fact) => ({
      id: fact.id,
      label: fact.metadata.source_label,
      qualification_state: fact.qualification_state,
    })),
    reconciliation: result.reconciliation.group_reconciliations.map((group) => ({
      ids: group.qualified_fact_ids,
      outcome: group.outcome,
    })),
    proposals: result.proposals.map((proposal) => ({
      target: proposal.target,
      disposition: proposal.disposition,
    })),
    projected_proposal_ids: result.bridge.projected_proposal_ids,
    non_projected: result.bridge.non_projected,
    publishers: result.captures.map((capture) => capture.source_provenance?.publisher),
  });
  expect(
    result.captures.some((capture) => capture.source_provenance?.publisher === publisher),
    diagnostics,
  ).toBe(true);
  expect(result.qualified_facts.length, diagnostics).toBeGreaterThan(0);
  expect(result.reconciliation.qualified_fact_ids, diagnostics).toEqual(
    result.qualified_facts.map((fact) => fact.id),
  );
  expect(
    result.proposals.some((proposal) => proposal.disposition === 'mapped'),
    diagnostics,
  ).toBe(true);
  expect(result.bridge.candidate, diagnostics).toBeDefined();
  expect(
    Object.keys(result.bridge.candidate?.field_evidence ?? {}).length,
    diagnostics,
  ).toBeGreaterThan(0);
  expect(result.review_package.candidate, diagnostics).toBeDefined();
  return result;
};
const approvalFor = (prepared: ReviewReadyProductionIngest): ProductionApproval => ({
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'approval',
  id: 'approval.finalize',
  review_package: artifactReference('review_package', prepared.review_package),
  review_package_snapshot: reviewPackageSnapshot(prepared.review_package),
  semantic_snapshot: prepared.review_package.semantic_snapshot,
  reviewer_id: 'reviewer.human',
  decision: 'approved',
  reviewed_at: '2026-09-09T00:00:00.000Z',
  promotion_decisions: {
    approved_fields: Object.keys(prepared.bridge.candidate?.field_evidence ?? {}).sort(),
    evidence_acknowledged: true,
    product_role: 'solar_charge_controller',
    category: 'solar_charge_controller',
  },
});

const temporaryRoots: string[] = [];
const root = async (): Promise<string> => {
  const value = await mkdtemp(join(tmpdir(), 'expedition-job-runtime-'));
  temporaryRoots.push(value);
  return value;
};
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((value) => rm(value, { recursive: true })));
});

const service = (storageRoot: string, prepared: ReviewReadyProductionIngest) => {
  const prepareSpy = vi.fn(async () => prepared);
  const runtime = new IngestionJobService({
    store: new FileIngestionJobStore(storageRoot),
    preparationRequest: () => ({ adapter }),
    prepare: prepareSpy,
    now: () => '2026-09-10T00:00:00.000Z',
  });
  return { runtime, prepareSpy };
};

const mysteryRatingTable =
  '<table><thead><tr><th>Model</th><th>Mystery electrical rating</th></tr></thead><tbody><tr><td>EX-1</td><td>150 A</td></tr></tbody></table>';
const unknownProposal = (prepared: ReviewReadyProductionIngest) => {
  const proposal = prepared.proposals.find(
    (item) => item.target === 'source_label:mystery electrical rating',
  );
  if (!proposal) throw new Error('Fixture has no unsupported mystery-rating proposal.');
  return proposal;
};
const semanticRequestBase = (prepared: ReviewReadyProductionIngest) => {
  const proposal = unknownProposal(prepared);
  const selected_fact_ids = (proposal.fact_refs ?? [])
    .map((reference) => reference.reference)
    .filter((reference): reference is string => !!reference);
  return {
    proposal_id: proposal.id,
    expected_review_snapshot: reviewPackageSnapshot(prepared.review_package),
    selected_fact_ids,
    actor_label: 'operator.test',
  };
};
const mapRequest = (prepared: ReviewReadyProductionIngest): SemanticDecisionRequest => ({
  ...semanticRequestBase(prepared),
  outcome: 'map',
  target: 'electrical.continuous_output_current_a',
  normalized_value: 150,
  normalized_unit: 'A',
  rationale: 'The retained row explicitly identifies the continuous output current.',
});
const dispositionRequest = (
  prepared: ReviewReadyProductionIngest,
  outcome: 'evidence_only' | 'schema_gap' | 'reject' | 'not_applicable' | 'unresolved',
): SemanticDecisionRequest => {
  const base = semanticRequestBase(prepared);
  if (outcome === 'schema_gap')
    return {
      ...base,
      outcome,
      schema_gap: {
        concept_key: 'electrical.mystery_rating',
        explanation: 'The production schema has no reviewed meaning for this source label.',
      },
      rationale: 'The source meaning is not represented by a supported canonical target.',
    };
  if (outcome === 'reject' || outcome === 'not_applicable')
    return {
      ...base,
      outcome,
      rationale: 'The retained evidence does not support applying this assertion.',
    };
  return { ...base, outcome };
};
const createReviewReady = async (runtime: IngestionJobService) => {
  const created = await runtime.createJob(intake);
  const ready = await runtime.prepareJob(created.id);
  assertReviewReady(ready);
  return ready;
};
function assertReviewReady(
  job: IngestionJob,
): asserts job is IngestionJob & { preparation: ReviewReadyProductionIngest } {
  if (job.state !== 'review_ready' || job.preparation?.status !== 'review_ready')
    throw new Error('Fixture job did not become review-ready.');
}

describe('persistent ingestion job runtime', () => {
  it.each([
    ['single_observation', specifications('24 V', '10 A')],
    ['agreement', specifications('24 V', '10 A') + specifications('24.0 V', '10.0 A')],
    ['conflict', specifications('24 V', '10 A') + specifications('25 V', '11 A')],
    ['unresolved', specifications('≤ 24 V', '≤ 10 A') + specifications('24 V', '10 A')],
  ] as const)('durably reloads preparation with %s after restart', async (outcome, tables) => {
    const customAdapter: SourceCaptureAdapter = {
      async capture(request) {
        const html =
          request.uri === documentUri
            ? `<html><body>${tables}</body></html>`
            : responses[request.uri];
        return { status: 'success', source: source(request.uri, html), issues: [] };
      },
    };
    const prepared = await prepareProductionIngestReview({
      intake,
      profile,
      adapter: customAdapter,
      policy: { now: () => '2026-09-08T00:00:00.000Z' },
    });
    if (prepared.status !== 'review_ready') throw new Error('Fixture failed preparation');
    expect(prepared.reconciliation.group_reconciliations.map((group) => group.outcome)).toEqual([
      outcome,
      outcome,
    ]);
    const storageRoot = await root();
    const { runtime } = service(storageRoot, prepared);
    const created = await runtime.createJob(intake);
    await runtime.prepareJob(created.id);
    const restarted = new FileIngestionJobStore(storageRoot);
    const reloaded = await restarted.load(created.id);
    expect(serializeJob(reloaded.preparation)).toBe(serializeJob(prepared));
    if (reloaded.preparation?.status !== 'review_ready') throw new Error('Reload lost preparation');
    expect(reloaded.preparation.reconciliation).toEqual(prepared.reconciliation);
    expect(deterministicSerialize(reloaded.preparation)).toBe(deterministicSerialize(prepared));
    expect(artifactDigest(reloaded.preparation)).toBe(artifactDigest(prepared));
    const changed = {
      ...prepared.reconciliation,
      group_reconciliations: prepared.reconciliation.group_reconciliations.map((group) => ({
        ...group,
        outcome: group.outcome === 'unresolved' ? ('agreement' as const) : ('unresolved' as const),
      })),
    };
    expect(artifactDigest(changed)).not.toBe(artifactDigest(prepared.reconciliation));
    expect(artifactDigest({ ...prepared, reconciliation: changed })).not.toBe(
      artifactDigest(prepared),
    );
  });

  it('persists MPN-only intake awaiting resolution and rejects preparation before invoking it', async () => {
    const store = new FileIngestionJobStore(await root());
    const prepare = vi.fn();
    const runtime = new IngestionJobService({
      store,
      preparationRequest: () => ({ adapter }),
      prepare,
    });
    const mpnOnly = { ...intake };
    delete mpnOnly.official_product_uri;
    const job = await runtime.createJob(mpnOnly);
    expect(job.state).toBe('source_resolution_required');
    expect((await runtime.getJob(job.id)).intake).not.toHaveProperty('official_product_uri');
    await expect(runtime.prepareJob(job.id)).rejects.toThrow('source_resolution_required');
    expect(prepare).not.toHaveBeenCalled();
    expect((await runtime.getJob(job.id)).state).toBe('source_resolution_required');
  });
  it.each(['rejected', 'deferred'] as const)(
    'persists a bound %s review without a candidate and refuses finalization',
    async (decision) => {
      const storageRoot = await root();
      const prepared = await prepare();
      const noCandidate: ReviewReadyProductionIngest = {
        ...prepared,
        bridge: { ...prepared.bridge, candidate: undefined },
        review_package: {
          ...prepared.review_package,
          candidate: undefined,
          source_refs: [],
          fact_refs: [],
          proposal_refs: [],
        },
      };
      const { runtime } = service(storageRoot, noCandidate);
      const job = await runtime.createJob(intake);
      await runtime.prepareJob(job.id);
      const { promotion_decisions: _promotion, ...bound } = approvalFor(noCandidate);
      const approval: ProductionApproval = { ...bound, decision };
      await expect(
        runtime.submitApproval(job.id, { ...approval, reviewer_id: '' }),
      ).rejects.toThrow(/Invalid production approval/);
      await expect(
        runtime.submitApproval(job.id, {
          ...approval,
          semantic_snapshot: `sha256:${'b'.repeat(64)}`,
        }),
      ).rejects.toThrow(/exact review package/);
      await expect(
        runtime.submitApproval(job.id, {
          ...approval,
          review_package_snapshot: `sha256:${'c'.repeat(64)}`,
        }),
      ).rejects.toThrow(/exact review package/);
      expect((await runtime.getJob(job.id)).state).toBe('review_ready');
      const reviewed = await runtime.submitApproval(job.id, approval);
      expect(reviewed.state).toBe(`review_${decision}`);
      const reloaded = await new FileIngestionJobStore(storageRoot).load(job.id);
      expect(reloaded.approval).toEqual(approval);
      expect(reloaded.state).toBe(`review_${decision}`);
      expect(reloaded.approval?.promotion_decisions).toBeUndefined();
      await expect(
        runtime.finalizeJob(job.id, { destinationRoot: await root(), write: true }),
      ).rejects.toThrow(/Cannot finalize job/);
    },
  );

  it('requires existing promotion readiness for an approved decision', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const { runtime } = service(storageRoot, prepared);
    const job = await runtime.createJob(intake);
    await runtime.prepareJob(job.id);
    const { promotion_decisions: _promotion, ...approval } = approvalFor(prepared);
    await expect(runtime.submitApproval(job.id, approval)).rejects.toThrow(/promotion_decisions/);
    expect((await runtime.getJob(job.id)).state).toBe('review_ready');
  });

  it('persists the exact attempt before a pending finalizer and retains the final result', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    let release!: () => void;
    let announce!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const finalizer = vi.fn(async (...args: Parameters<typeof finalizeProductionIngest>) => {
      announce();
      await gate;
      return finalizeProductionIngest(...args);
    });
    const runtime = new IngestionJobService({
      store: new FileIngestionJobStore(storageRoot),
      preparationRequest: () => ({ adapter }),
      prepare: async () => prepared,
      finalize: finalizer,
      now: () => '2026-09-10T00:00:00.000Z',
    });
    const job = await runtime.createJob(intake);
    await runtime.prepareJob(job.id);
    await runtime.submitApproval(job.id, approvalFor(prepared));
    const writeRequest = { destinationRoot: await root(), write: true, overwrite: false };
    const catalogContext: PromotionCatalogContext = { components: [] };
    const pending = runtime.finalizeJob(job.id, writeRequest, catalogContext);
    await started;
    try {
      const reloaded = await new FileIngestionJobStore(storageRoot).load(job.id);
      expect(reloaded.state).toBe('finalizing');
      expect(reloaded.finalization_request).toEqual({
        requested_at: '2026-09-10T00:00:00.000Z',
        write_request: writeRequest,
        catalog_context: catalogContext,
      });
      expect(finalizer).toHaveBeenCalledTimes(1);
      expect(deterministicSerialize(finalizer.mock.calls[0][0])).toBe(
        deterministicSerialize(prepared),
      );
      expect(finalizer.mock.calls[0].slice(1)).toEqual([
        approvalFor(prepared),
        writeRequest,
        catalogContext,
      ]);
      expect(reloaded.final_result).toBeUndefined();
    } finally {
      release();
    }
    const finalized = await pending;
    expect(finalized.final_result?.write_result.status).toBe('written');
    const reloaded = await new FileIngestionJobStore(storageRoot).load(job.id);
    expect(reloaded.state).toBe('finalized');
    expect(reloaded.finalization_request).toEqual(finalized.finalization_request);
    expect(reloaded.final_result).toEqual(finalized.final_result);
  });

  it('retains the attempted request when the finalizer throws', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const runtime = new IngestionJobService({
      store: new FileIngestionJobStore(storageRoot),
      preparationRequest: () => ({ adapter }),
      prepare: async () => prepared,
      finalize: async () => {
        throw new Error('writer interrupted');
      },
    });
    const job = await runtime.createJob(intake);
    await runtime.prepareJob(job.id);
    await runtime.submitApproval(job.id, approvalFor(prepared));
    const request = { destinationRoot: await root(), write: true };
    const failed = await runtime.finalizeJob(job.id, request);
    expect(failed.state).toBe('finalization_failed');
    const reloaded = await runtime.getJob(job.id);
    expect(reloaded.finalization_request?.write_request).toEqual(request);
    expect(reloaded.finalization_request).not.toHaveProperty('catalog_context');
    expect(reloaded.error?.message).toContain('writer interrupted');
    await expect(runtime.finalizeJob(job.id, request)).rejects.toThrow(/state/);
  });

  it.each(['finalizing', 'finalized', 'finalization_failed'] as const)(
    'rejects a %s record missing its finalization attempt',
    async (state) => {
      const storageRoot = await root();
      const prepared = await prepare();
      const { runtime } = service(storageRoot, prepared);
      const job = await runtime.createJob(intake);
      await runtime.prepareJob(job.id);
      await runtime.submitApproval(job.id, approvalFor(prepared));
      const finalized = await runtime.finalizeJob(job.id, { destinationRoot: await root() });
      const store = new FileIngestionJobStore(storageRoot);
      await expect(
        store.save(
          { ...finalized, state, finalization_request: undefined },
          (await store.loadVersioned(job.id)).version,
        ),
      ).rejects.toThrow(/Invalid job schema or state/);
      expect((await store.load(job.id)).state).toBe('finalized');
    },
  );

  it('creates a reloadable job before preparation', async () => {
    const storageRoot = await root();
    const { runtime } = service(storageRoot, await prepare());
    const job = await runtime.createJob(intake);
    expect(job.state).toBe('created');
    expect(await new FileIngestionJobStore(storageRoot).load(job.id)).toEqual(job);
    expect((await readFile(join(storageRoot, `${job.id}.json`), 'utf8')).length).toBeGreaterThan(0);
  });

  it('persists complete review state including captured bytes after restart', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const instanceA = service(storageRoot, prepared);
    const created = await instanceA.runtime.createJob(intake);
    const ready = await instanceA.runtime.prepareJob(created.id);
    expect(ready.error).toBeUndefined();
    expect(ready.state).toBe('review_ready');
    expect(instanceA.prepareSpy).toHaveBeenCalledTimes(1);
    const instanceB = service(storageRoot, prepared);
    const reloaded = await instanceB.runtime.getJob(created.id);
    expect(deterministicSerialize(reloaded)).toBe(deterministicSerialize(ready));
    expect(deterministicSerialize(reloaded.preparation)).toBe(deterministicSerialize(prepared));
    expect(
      Object.prototype.toString.call(
        reloaded.preparation?.acquisition.seed_capture.source?.body.bytes,
      ),
    ).toBe('[object Uint8Array]');
    expect(instanceB.prepareSpy).not.toHaveBeenCalled();
  });

  it('preserves review-ready diagnostics without a product candidate', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const noCandidate = {
      ...prepared,
      bridge: { ...prepared.bridge, candidate: undefined },
      review_package: {
        ...prepared.review_package,
        candidate: undefined,
        source_refs: [],
        fact_refs: [],
        proposal_refs: [],
      },
    };
    const { runtime } = service(storageRoot, noCandidate);
    const created = await runtime.createJob(intake);
    const ready = await runtime.prepareJob(created.id);
    expect(ready.state).toBe('review_ready');
    expect(deterministicSerialize((await runtime.getJob(created.id)).preparation)).toBe(
      deterministicSerialize(noCandidate),
    );
    await expect(runtime.submitApproval(created.id, approvalFor(prepared))).rejects.toThrow(
      /exact review package/,
    );
    await expect(runtime.submitApproval(created.id, approvalFor(noCandidate))).rejects.toThrow(
      /candidate state/,
    );
  });

  it('persists a terminal preparation result', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const failed = {
      status: 'preparation_failed' as const,
      reason: 'extraction_failed' as const,
      intake,
      acquisition: prepared.acquisition,
      source_acquisitions: prepared.source_acquisitions,
      captures: prepared.captures,
      document_extractions: prepared.document_extractions,
      qualifications: prepared.qualifications,
      qualified_facts: prepared.qualified_facts,
    };
    const runtime = new IngestionJobService({
      store: new FileIngestionJobStore(storageRoot),
      preparationRequest: () => ({ adapter }),
      prepare: async () => failed,
    });
    const job = await runtime.createJob(intake);
    const result = await runtime.prepareJob(job.id);
    expect(result.state).toBe('preparation_failed');
    expect(deterministicSerialize((await runtime.getJob(job.id)).preparation)).toBe(
      deterministicSerialize(failed),
    );
    await expect(runtime.submitApproval(job.id, approvalFor(prepared))).rejects.toThrow(/state/);
  });

  it('persists thrown preparation diagnostics', async () => {
    const storageRoot = await root();
    const runtime = new IngestionJobService({
      store: new FileIngestionJobStore(storageRoot),
      preparationRequest: () => ({ adapter }),
      prepare: async () => {
        throw new Error('capture unavailable');
      },
    });
    const job = await runtime.createJob(intake);
    expect((await runtime.prepareJob(job.id)).error?.message).toContain('capture unavailable');
    expect((await runtime.getJob(job.id)).state).toBe('preparation_failed');
  });

  it('rejects invalid state transitions and stale approval', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const { runtime } = service(storageRoot, prepared);
    const job = await runtime.createJob(intake);
    await expect(runtime.submitApproval(job.id, approvalFor(prepared))).rejects.toThrow(/state/);
    await runtime.prepareJob(job.id);
    await expect(runtime.prepareJob(job.id)).rejects.toThrow(/state/);
    await expect(
      runtime.submitApproval(job.id, {
        ...approvalFor(prepared),
        semantic_snapshot: `sha256:${'b'.repeat(64)}`,
      }),
    ).rejects.toThrow(/exact review package/);
    expect((await runtime.getJob(job.id)).state).toBe('review_ready');
  });

  it('approves and finalizes after restart without preparing again', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const a = service(storageRoot, prepared);
    const job = await a.runtime.createJob(intake);
    await a.runtime.prepareJob(job.id);
    const b = service(storageRoot, prepared);
    const approved = await b.runtime.submitApproval(job.id, approvalFor(prepared));
    expect(approved.state).toBe('approved');
    expect((await b.runtime.getJob(job.id)).approval).toEqual(approvalFor(prepared));
    const destinationRoot = await root();
    const finalized = await b.runtime.finalizeJob(job.id, { destinationRoot, write: true });
    expect(finalized.state).toBe('finalized');
    expect(finalized.final_result?.write_result.status).toBe('written');
    expect((await b.runtime.getJob(job.id)).final_result).toEqual(finalized.final_result);
    expect(parseYaml(await readFile(finalized.final_result!.write_result.path!, 'utf8'))).toEqual(
      finalized.final_result!.promotion.result.proposal,
    );
    expect(a.prepareSpy).toHaveBeenCalledTimes(1);
    expect(b.prepareSpy).not.toHaveBeenCalled();
    await expect(b.runtime.finalizeJob(job.id, { destinationRoot })).rejects.toThrow(/state/);
  });

  it('keeps dry-run authorization in the existing finalizer', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const { runtime } = service(storageRoot, prepared);
    const job = await runtime.createJob(intake);
    await runtime.prepareJob(job.id);
    await runtime.submitApproval(job.id, approvalFor(prepared));
    const result = await runtime.finalizeJob(job.id, { destinationRoot: await root() });
    expect(result.final_result?.write_result.status).toBe('dry_run');
  });

  it('rejects unknown IDs and corrupt records', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const { runtime } = service(storageRoot, prepared);
    const unknown = '11111111-1111-1111-1111-111111111111';
    await expect(runtime.getJob(unknown)).rejects.toThrow(/Unknown ingestion job/);
    const job = await runtime.createJob(intake);
    await writeFile(join(storageRoot, `${job.id}.json`), '{bad', 'utf8');
    await expect(runtime.getJob(job.id)).rejects.toThrow(/Corrupt ingestion job/);
  });

  it('blocks duplicate transitions while an operation is running', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    let release!: (value: ReviewReadyProductionIngest) => void;
    const pending = new Promise<ReviewReadyProductionIngest>((resolve) => {
      release = resolve;
    });
    const runtime = new IngestionJobService({
      store: new FileIngestionJobStore(storageRoot),
      preparationRequest: () => ({ adapter }),
      prepare: () => pending,
    });
    const job = await runtime.createJob(intake);
    const first = runtime.prepareJob(job.id);
    await expect(runtime.prepareJob(job.id)).rejects.toThrow(/in progress/);
    release(prepared);
    expect((await first).state).toBe('review_ready');
  });
});

describe('durable human semantic adjudication', () => {
  it('blocks approval for an undispositioned unresolved proposal without changing durable bytes', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const recordPath = join(storageRoot, `${ready.id}.json`);
    const before = await readFile(recordPath, 'utf8');
    const completion = evaluateSemanticReviewCompletion(
      ready.preparation.proposals,
      ready.preparation.bridge.reviewed_semantic_interpretation,
    );
    expect(completion.complete).toBe(false);
    expect(completion.required_dispositions.map(({ proposal_id }) => proposal_id)).toContain(
      unknownProposal(prepared).id,
    );
    await expect(
      runtime.submitApproval(ready.id, approvalFor(ready.preparation)),
    ).rejects.toMatchObject({
      status: 409,
      proposal_ids: completion.required_dispositions.map(({ proposal_id }) => proposal_id),
    });
    expect(await readFile(recordPath, 'utf8')).toBe(before);
    expect((await runtime.getJob(ready.id)).state).toBe('review_ready');
  });

  it('approves only after every required proposal has its own explicit disposition', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const required = evaluateSemanticReviewCompletion(
      ready.preparation.proposals,
      ready.preparation.bridge.reviewed_semantic_interpretation,
    ).required_dispositions;
    expect(required.length).toBeGreaterThan(0);

    let current = ready;
    for (const { proposal_id } of required) {
      current = await runtime.recordSemanticDecision(current.id, {
        proposal_id,
        expected_review_snapshot: reviewPackageSnapshot(current.preparation!.review_package),
        actor_label: 'operator.complete-review',
        outcome: 'evidence_only',
      });
      assertReviewReady(current);
    }
    expect(
      evaluateSemanticReviewCompletion(
        current.preparation.proposals,
        current.preparation.bridge.reviewed_semantic_interpretation,
      ),
    ).toEqual({ complete: true, required_dispositions: [] });
    expect((await runtime.submitApproval(current.id, approvalFor(current.preparation))).state).toBe(
      'approved',
    );
  });

  it.each([
    'map',
    'evidence_only',
    'schema_gap',
    'reject',
    'not_applicable',
    'unresolved',
  ] as const)('counts %s as reviewed and only map as projecting', async (outcome) => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const proposal = unknownProposal(prepared);
    const request =
      outcome === 'map' ? mapRequest(prepared) : dispositionRequest(prepared, outcome);
    const updated = await runtime.recordSemanticDecision(ready.id, request);
    assertReviewReady(updated);
    const completion = evaluateSemanticReviewCompletion(
      updated.preparation.proposals,
      updated.preparation.bridge.reviewed_semantic_interpretation,
    );
    expect(completion.complete).toBe(true);
    expect(completion.required_dispositions).toEqual([]);
    const entry = updated.preparation.bridge.reviewed_semantic_interpretation.entries.find(
      ({ proposal_id }) => proposal_id === proposal.id,
    );
    expect(entry?.state).toBe(outcome === 'map' ? 'human_mapped' : outcome);
    expect(updated.preparation.bridge.projected_proposal_ids.includes(proposal.id)).toBe(
      outcome === 'map',
    );
  });

  it('uses the latest correction revision for completion and projection before approval', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const proposal = unknownProposal(prepared);
    const first = await runtime.recordSemanticDecision(ready.id, mapRequest(prepared));
    assertReviewReady(first);
    const second = await runtime.recordSemanticDecision(ready.id, {
      ...dispositionRequest(prepared, 'unresolved'),
      expected_review_snapshot: reviewPackageSnapshot(first.preparation.review_package),
    });
    assertReviewReady(second);
    expect(second.preparation.bridge.reviewed_semantic_decisions).toHaveLength(2);
    expect(
      second.preparation.bridge.reviewed_semantic_interpretation.entries.find(
        ({ proposal_id }) => proposal_id === proposal.id,
      )?.state,
    ).toBe('unresolved');
    expect(second.preparation.bridge.projected_proposal_ids).not.toContain(proposal.id);
    expect(
      evaluateSemanticReviewCompletion(
        second.preparation.proposals,
        second.preparation.bridge.reviewed_semantic_interpretation,
      ).complete,
    ).toBe(true);
    expect((await runtime.submitApproval(ready.id, approvalFor(second.preparation))).state).toBe(
      'approved',
    );
  });

  it('allows approval for a legacy automatically mapped job with no decision history', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const { reviewed_semantic_decisions: _history, ...legacyBridge } = ready.preparation.bridge;
    const legacy = {
      ...ready,
      preparation: {
        ...ready.preparation,
        bridge: legacyBridge,
      },
    } as unknown as IngestionJob;
    const payload = serializeJob(legacy);
    await writeFile(
      join(storageRoot, `${ready.id}.json`),
      JSON.stringify({
        digest: createHash('sha256').update(payload).digest('hex'),
        payload,
      }) + '\n',
      'utf8',
    );
    expect((await runtime.submitApproval(ready.id, approvalFor(ready.preparation))).state).toBe(
      'approved',
    );
  });

  it('loads a legacy review-ready job with no decision-history property as empty history', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const { reviewed_semantic_decisions: _history, ...legacyBridge } = ready.preparation.bridge;
    const legacyJob = {
      ...ready,
      preparation: { ...ready.preparation, bridge: legacyBridge },
    } as unknown as IngestionJob;
    const payload = serializeJob(legacyJob);
    await writeFile(
      join(storageRoot, `${ready.id}.json`),
      JSON.stringify({
        digest: createHash('sha256').update(payload).digest('hex'),
        payload,
      }) + '\n',
      'utf8',
    );

    const restarted = new FileIngestionJobStore(storageRoot);
    const loaded = await restarted.load(ready.id);
    expect(loaded.state).toBe('review_ready');
    expect(loaded.preparation?.status).toBe('review_ready');
    expect(loaded.preparation?.bridge).not.toHaveProperty('reviewed_semantic_decisions');

    await expect(
      runtime.submitApproval(ready.id, approvalFor(ready.preparation)),
    ).rejects.toMatchObject({
      status: 409,
    });
    const updated = await runtime.recordSemanticDecision(ready.id, mapRequest(prepared));
    assertReviewReady(updated);
    expect(updated.preparation.bridge.reviewed_semantic_decisions).toHaveLength(1);
    expect(updated.preparation.bridge.reviewed_semantic_decisions[0].revision).toBe(1);
  });

  it('appends a valid first map, rebuilds the package, and reloads the same reviewed state', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const immutableFacts = deterministicSerialize(ready.preparation.qualified_facts);
    const immutableProposals = deterministicSerialize(ready.preparation.proposals);

    const updated = await runtime.recordSemanticDecision(ready.id, mapRequest(prepared));
    assertReviewReady(updated);
    const decision = updated.preparation.bridge.reviewed_semantic_decisions[0];
    expect(decision).toMatchObject({
      revision: 1,
      outcome: 'map',
      target: 'electrical.continuous_output_current_a',
      normalized_value: 150,
      normalized_unit: 'A',
      actor: { kind: 'operator_label', identifier: 'operator.test' },
      recorded_at: '2026-09-10T00:00:00.000Z',
    });
    expect(decision.previous_decision).toBeUndefined();
    expect(updated.preparation.bridge.reviewed_semantic_interpretation.entries).toContainEqual(
      expect.objectContaining({
        proposal_id: decision.proposal_ref.reference,
        state: 'human_mapped',
      }),
    );
    expect(updated.preparation.bridge.candidate?.component_data).toMatchObject({
      electrical: { continuous_output_current_a: 150 },
    });
    expect(updated.preparation.review_package).not.toEqual(prepared.review_package);
    expect(deterministicSerialize(updated.preparation.qualified_facts)).toBe(immutableFacts);
    expect(deterministicSerialize(updated.preparation.proposals)).toBe(immutableProposals);

    const reloaded = await new FileIngestionJobStore(storageRoot).load(ready.id);
    assertReviewReady(reloaded);
    expect(deterministicSerialize(reloaded.preparation)).toBe(
      deterministicSerialize(updated.preparation),
    );
    expect(reviewPackageSnapshot(reloaded.preparation.review_package)).toBe(
      reviewPackageSnapshot(updated.preparation.review_package),
    );
    expect(
      buildProductionSemanticProposals({
        facts: reloaded.preparation.qualified_facts,
        source_acquisitions: reloaded.preparation.source_acquisitions,
        reconciliation: reloaded.preparation.reconciliation,
      }),
    ).toEqual(prepared.proposals);
  });

  it('appends corrections as revision 2 while retaining and linking revision 1', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const first = await runtime.recordSemanticDecision(ready.id, mapRequest(prepared));
    assertReviewReady(first);
    const prior = first.preparation.bridge.reviewed_semantic_decisions[0];
    const revisedRequest = {
      ...mapRequest(prepared),
      expected_review_snapshot: reviewPackageSnapshot(first.preparation.review_package),
      actor_label: 'operator.corrected',
    };

    const second = await runtime.recordSemanticDecision(ready.id, revisedRequest);
    assertReviewReady(second);
    const history = second.preparation.bridge.reviewed_semantic_decisions;
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(prior);
    expect(history[1].revision).toBe(2);
    expect(history[1].previous_decision).toEqual(
      artifactReference('reviewed_semantic_decision', prior, prior.id, prior.schema_version),
    );
    expect(second.preparation.bridge.reviewed_semantic_interpretation.entries).toContainEqual(
      expect.objectContaining({
        proposal_id: history[1].proposal_ref.reference,
        decision_ref: artifactReference(
          'reviewed_semantic_decision',
          history[1],
          history[1].id,
          history[1].schema_version,
        ),
        state: 'human_mapped',
      }),
    );
  });

  it('rejects unsupported values without changing the durable job record', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const recordPath = join(storageRoot, `${ready.id}.json`);
    const originalBytes = await readFile(recordPath, 'utf8');
    const request = mapRequest(prepared);

    await expect(
      runtime.recordSemanticDecision(ready.id, { ...request, normalized_value: 999 }),
    ).rejects.toThrow(/not supported by (?:retained source fact|the selected source facts)/i);
    expect(await readFile(recordPath, 'utf8')).toBe(originalBytes);
    expect(serializeJob(await new FileIngestionJobStore(storageRoot).load(ready.id))).toBe(
      serializeJob(ready),
    );
  });

  it.each([
    ['unsupported target', { target: 'electrical.not_a_field' }],
    ['incompatible unit', { normalized_unit: 'V' }],
    [
      'incompatible source context',
      {
        target: 'battery.nominal_capacity_ah',
        normalized_value: 150,
        normalized_unit: 'Ah',
      },
    ],
  ])('rejects an invalid %s without a partial write', async (_label, invalid) => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const recordPath = join(storageRoot, `${ready.id}.json`);
    const originalBytes = await readFile(recordPath, 'utf8');

    await expect(
      runtime.recordSemanticDecision(ready.id, { ...mapRequest(prepared), ...invalid }),
    ).rejects.toThrow();
    expect(await readFile(recordPath, 'utf8')).toBe(originalBytes);
  });

  it('rejects a stale review snapshot and leaves the current decision untouched', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const staleRequest = mapRequest(prepared);
    await runtime.recordSemanticDecision(ready.id, staleRequest);
    const beforeStaleRequest = await readFile(join(storageRoot, `${ready.id}.json`), 'utf8');

    await expect(runtime.recordSemanticDecision(ready.id, staleRequest)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/changed|stale/i),
    });
    expect(await readFile(join(storageRoot, `${ready.id}.json`), 'utf8')).toBe(beforeStaleRequest);
    assertReviewReady(await runtime.getJob(ready.id));
  });

  it('serializes two callers on one snapshot so the second receives a stale conflict', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    const firstRequest = mapRequest(prepared);
    const secondRequest = { ...firstRequest, actor_label: 'operator.second' };
    const results = await Promise.allSettled([
      runtime.recordSemanticDecision(ready.id, firstRequest),
      runtime.recordSemanticDecision(ready.id, secondRequest),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') expect(rejected.reason).toMatchObject({ status: 409 });
    const current = await new FileIngestionJobStore(storageRoot).load(ready.id);
    assertReviewReady(current);
    expect(current.preparation.bridge.reviewed_semantic_decisions).toHaveLength(1);
  });

  it('uses durable CAS when independent job services read the same review state', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const durableStore = new FileIngestionJobStore(storageRoot);
    const seedRuntime = new IngestionJobService({
      store: durableStore,
      preparationRequest: () => ({ adapter }),
      prepare: async () => prepared,
      now: () => '2026-09-10T00:00:00.000Z',
    });
    const ready = await createReviewReady(seedRuntime);

    let waitingReads = 0;
    let releasePair!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      releasePair = resolve;
    });
    let holdReads = true;
    const independentStore = (): IngestionJobStore => ({
      create: (job) => durableStore.create(job),
      load: (id) => durableStore.load(id),
      loadVersioned: async (id) => {
        const loaded = await durableStore.loadVersioned(id);
        if (holdReads && id === ready.id) {
          waitingReads++;
          if (waitingReads === 2) {
            holdReads = false;
            releasePair();
          }
          await bothRead;
        }
        return loaded;
      },
      save: (job, expectedVersion) => durableStore.save(job, expectedVersion),
      listJobIds: () => durableStore.listJobIds!(),
    });
    const makeIndependentRuntime = () =>
      new IngestionJobService({
        store: independentStore(),
        preparationRequest: () => ({ adapter }),
        prepare: async () => prepared,
        now: () => '2026-09-10T00:00:00.000Z',
      });
    const firstRuntime = makeIndependentRuntime();
    const secondRuntime = makeIndependentRuntime();
    const outcomes = await Promise.allSettled([
      firstRuntime.recordSemanticDecision(ready.id, mapRequest(prepared)),
      secondRuntime.recordSemanticDecision(ready.id, {
        ...mapRequest(prepared),
        actor_label: 'independent.operator',
      }),
    ]);

    expect(waitingReads).toBe(2);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const conflict = outcomes.find((result) => result.status === 'rejected');
    expect(conflict?.status).toBe('rejected');
    if (conflict?.status === 'rejected') expect(conflict.reason).toMatchObject({ status: 409 });
    const reloaded = await durableStore.load(ready.id);
    assertReviewReady(reloaded);
    expect(reloaded.preparation.bridge.reviewed_semantic_decisions).toHaveLength(1);
    expect(reloaded.preparation.bridge.reviewed_semantic_decisions[0].revision).toBe(1);
    expect(deterministicSerialize(reloaded.preparation.qualified_facts)).toBe(
      deterministicSerialize(prepared.qualified_facts),
    );
    expect(deterministicSerialize(reloaded.preparation.proposals)).toBe(
      deterministicSerialize(prepared.proposals),
    );
  });

  it('prevents a stale approval save from overwriting a semantic decision', async () => {
    const storageRoot = await root();
    const prepared = await prepare();
    const durableStore = new FileIngestionJobStore(storageRoot);
    const seedRuntime = new IngestionJobService({
      store: durableStore,
      preparationRequest: () => ({ adapter }),
      prepare: async () => prepared,
    });
    const ready = await createReviewReady(seedRuntime);
    assertReviewReady(ready);
    let releaseApprovalSave!: () => void;
    let signalApprovalSave!: () => void;
    const approvalSaveStarted = new Promise<void>((resolve) => {
      signalApprovalSave = resolve;
    });
    const approvalSaveGate = new Promise<void>((resolve) => {
      releaseApprovalSave = resolve;
    });
    const pausingStore: IngestionJobStore = {
      create: (job) => durableStore.create(job),
      load: (id) => durableStore.load(id),
      loadVersioned: (id) => durableStore.loadVersioned(id),
      save: async (job, version) => {
        if (job.approval?.decision === 'approved') {
          signalApprovalSave();
          await approvalSaveGate;
        }
        return durableStore.save(job, version);
      },
      listJobIds: () => durableStore.listJobIds!(),
    };
    const approvalRuntime = new IngestionJobService({
      store: pausingStore,
      preparationRequest: () => ({ adapter }),
    });
    const decisionRuntime = new IngestionJobService({
      store: durableStore,
      preparationRequest: () => ({ adapter }),
    });
    const staleApproval = approvalRuntime.submitApproval(ready.id, approvalFor(ready.preparation));
    await approvalSaveStarted;

    const proposal = prepared.proposals.find(
      (item) => item.disposition === 'mapped' && !item.derivation && item.fact_refs?.length,
    );
    if (!proposal) throw new Error('Fixture has no automatically mapped source proposal');
    await decisionRuntime.recordSemanticDecision(ready.id, {
      proposal_id: proposal.id,
      expected_review_snapshot: reviewPackageSnapshot(ready.preparation.review_package),
      actor_label: 'operator.race-test',
      outcome: 'evidence_only',
    });
    releaseApprovalSave();
    await expect(staleApproval).rejects.toMatchObject({ status: 409 });

    const current = await durableStore.load(ready.id);
    assertReviewReady(current);
    expect(current.approval).toBeUndefined();
    expect(current.preparation.bridge.reviewed_semantic_decisions).toHaveLength(1);
    expect(current.preparation.bridge.reviewed_semantic_decisions[0].proposal_ref.reference).toBe(
      proposal.id,
    );
  });

  it('rejects decisions outside review_ready and after approval or finalization', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const created = await runtime.createJob(intake);
    await expect(
      runtime.recordSemanticDecision(created.id, mapRequest(prepared)),
    ).rejects.toMatchObject({ status: 409 });

    const ready = await createReviewReady(runtime);
    const reviewed = await runtime.recordSemanticDecision(ready.id, mapRequest(prepared));
    assertReviewReady(reviewed);
    await runtime.submitApproval(ready.id, approvalFor(reviewed.preparation));
    await expect(
      runtime.recordSemanticDecision(ready.id, mapRequest(prepared)),
    ).rejects.toMatchObject({ status: 409 });

    const secondReady = await createReviewReady(runtime);
    const secondReviewed = await runtime.recordSemanticDecision(
      secondReady.id,
      mapRequest(prepared),
    );
    assertReviewReady(secondReviewed);
    await runtime.submitApproval(secondReady.id, approvalFor(secondReviewed.preparation));
    const finalized = await runtime.finalizeJob(secondReady.id, {
      destinationRoot: await root(),
      write: true,
    });
    expect(finalized.state).toBe('finalized');
    await expect(
      runtime.recordSemanticDecision(secondReady.id, mapRequest(prepared)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ['evidence_only', { outcome: 'evidence_only' }],
    [
      'schema_gap',
      {
        outcome: 'schema_gap',
        schema_gap: {
          concept_key: 'electrical.output_ampacity',
          explanation: 'A reviewed canonical field is not available.',
        },
        rationale: 'Retain the concept for schema maintenance.',
      },
    ],
    ['reject', { outcome: 'reject', rationale: 'The source statement is mis-scoped.' }],
    [
      'not_applicable',
      { outcome: 'not_applicable', rationale: 'This statement does not apply to this product.' },
    ],
    ['unresolved', { outcome: 'unresolved' }],
  ] as const)(
    'persists and reloads the distinct %s outcome without projecting it',
    async (_name, outcomeFields) => {
      const storageRoot = await root();
      const prepared = await prepare('10 A', mysteryRatingTable);
      const { runtime } = service(storageRoot, prepared);
      const ready = await createReviewReady(runtime);
      const request = {
        ...semanticRequestBase(prepared),
        ...outcomeFields,
      } as SemanticDecisionRequest;

      const updated = await runtime.recordSemanticDecision(ready.id, request);
      assertReviewReady(updated);
      const reloaded = await new FileIngestionJobStore(storageRoot).load(ready.id);
      assertReviewReady(reloaded);
      const decision = reloaded.preparation.bridge.reviewed_semantic_decisions[0];
      expect(decision.outcome).toBe(outcomeFields.outcome);
      expect(
        reloaded.preparation.bridge.reviewed_semantic_interpretation.entries.find(
          (entry) => entry.proposal_id === decision.proposal_ref.reference,
        )?.state,
      ).toBe(outcomeFields.outcome);
      expect(reloaded.preparation.bridge.facts.some((fact) => fact.raw_value === '150 A')).toBe(
        false,
      );
      if (outcomeFields.outcome === 'schema_gap')
        expect(decision.schema_gap).toEqual(outcomeFields.schema_gap);
      if (outcomeFields.outcome === 'reject' || outcomeFields.outcome === 'not_applicable')
        expect(decision.outcome).toBe(outcomeFields.outcome);
    },
  );

  it('keeps explicit unresolved distinct from no adjudication and preserves selected-fact provenance', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const { runtime } = service(storageRoot, prepared);
    const ready = await createReviewReady(runtime);
    expect(ready.preparation.bridge.reviewed_semantic_decisions).toEqual([]);
    expect(
      ready.preparation.bridge.reviewed_semantic_interpretation.entries.find(
        (entry) => entry.proposal_id === unknownProposal(prepared).id,
      )?.state,
    ).toBe('automatic');

    const request: SemanticDecisionRequest = {
      ...semanticRequestBase(prepared),
      outcome: 'unresolved',
    };
    const updated = await runtime.recordSemanticDecision(ready.id, request);
    const reloaded = await new FileIngestionJobStore(storageRoot).load(ready.id);
    assertReviewReady(reloaded);
    const decision = reloaded.preparation.bridge.reviewed_semantic_decisions[0];
    expect(decision.outcome).toBe('unresolved');
    expect(decision.selected_fact_refs?.map((reference) => reference.reference)).toEqual(
      request.selected_fact_ids,
    );
    expect(updated.preparation?.status).toBe('review_ready');
    expect(
      reloaded.preparation.bridge.reviewed_semantic_interpretation.entries.find(
        (entry) => entry.proposal_id === decision.proposal_ref.reference,
      )?.state,
    ).toBe('unresolved');
  });

  it('does not persist a decision when the atomic job replacement fails', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const store = new FileIngestionJobStore(storageRoot);
    const runtime = new IngestionJobService({
      store,
      preparationRequest: () => ({ adapter }),
      prepare: async () => prepared,
      now: () => '2026-09-10T00:00:00.000Z',
    });
    const ready = await createReviewReady(runtime);
    const recordPath = join(storageRoot, `${ready.id}.json`);
    const originalBytes = await readFile(recordPath, 'utf8');
    const failure = new Error('simulated durable-store failure');
    vi.spyOn(replacement, 'replaceJobRecord').mockRejectedValue(failure);

    await expect(runtime.recordSemanticDecision(ready.id, mapRequest(prepared))).rejects.toBe(
      failure,
    );
    expect(await readFile(recordPath, 'utf8')).toBe(originalBytes);
    expect(serializeJob(await store.load(ready.id))).toBe(serializeJob(ready));
  });

  it('rejects a derived proposal before recording a decision', async () => {
    const storageRoot = await root();
    const prepared = await prepare('10 A', mysteryRatingTable);
    const store = new FileIngestionJobStore(storageRoot);
    const runtime = new IngestionJobService({
      store,
      preparationRequest: () => ({ adapter }),
      prepare: async () => prepared,
    });
    const ready = await createReviewReady(runtime);
    const proposal = unknownProposal(prepared);
    const markedDerived = {
      ...proposal,
      derivation: {} as NonNullable<typeof proposal.derivation>,
    };
    const proposals = ready.preparation.proposals.map((item) =>
      item.id === proposal.id ? markedDerived : item,
    );
    const bridgeProposals = ready.preparation.bridge.proposals.map((item) =>
      item.id === proposal.id ? markedDerived : item,
    );
    const changed = {
      ...ready,
      preparation: {
        ...ready.preparation,
        proposals,
        bridge: { ...ready.preparation.bridge, proposals: bridgeProposals },
      },
    };
    await store.save(changed, (await store.loadVersioned(ready.id)).version);
    const originalBytes = await readFile(join(storageRoot, `${ready.id}.json`), 'utf8');

    await expect(
      runtime.recordSemanticDecision(ready.id, {
        ...mapRequest(prepared),
        proposal_id: proposal.id,
      }),
    ).rejects.toThrow(/derived semantic proposals/i);
    expect(await readFile(join(storageRoot, `${ready.id}.json`), 'utf8')).toBe(originalBytes);
  });
});
