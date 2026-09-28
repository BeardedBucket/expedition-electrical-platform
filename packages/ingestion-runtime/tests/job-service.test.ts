import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileIngestionJobStore, IngestionJobService } from '../src/index.js';
import { serializeJob } from '../src/codec.js';
import {
  artifactReference,
  artifactDigest,
  deterministicSerialize,
  finalizeProductionIngest,
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
const prepare = async (): Promise<ReviewReadyProductionIngest> => {
  const result = await prepareProductionIngestReview({
    intake,
    profile,
    adapter,
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
        store.save({ ...finalized, state, finalization_request: undefined }),
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
