import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import {
  artifactReference,
  finalizeProductionIngest,
  prepareProductionIngestReview,
  PRODUCTION_SCHEMA_VERSION,
  reviewPackageSnapshot,
  type CapturedSource,
  type ManufacturerAcquisitionProfile,
  type ProductIntake,
  type ProductionApproval,
  type ReviewReadyProductionIngest,
  type SourceCaptureAdapter,
} from '../src/index.js';

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
  const value = await mkdtemp(join(tmpdir(), 'expedition-ingest-finalize-'));
  temporaryRoots.push(value);
  return value;
};
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((value) => rm(value, { recursive: true })));
});

describe('production ingest finalization', () => {
  it('finalizes a prepared reviewed ingest through guarded canonical write', async () => {
    const prepared = await prepare();
    const result = await finalizeProductionIngest(prepared, approvalFor(prepared), {
      destinationRoot: await root(),
      write: true,
    });
    expect(result.promotion.result.status).toBe('success');
    expect(result.write_result.status).toBe('written');
    expect(parseYaml(await readFile(result.write_result.path!, 'utf8'))).toEqual(
      result.promotion.result.proposal,
    );
  });

  it('preserves dry-run behavior when write authorization is absent', async () => {
    const prepared = await prepare();
    const result = await finalizeProductionIngest(prepared, approvalFor(prepared), {
      destinationRoot: await root(),
    });
    expect(result.write_result.status).toBe('dry_run');
    expect(result.write_result.issues.map((issue) => issue.code)).toContain('write_not_authorized');
    await expect(readFile(result.write_result.path!, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('returns blocked promotion and no write when human evidence acknowledgement is false', async () => {
    const prepared = await prepare();
    const approval = approvalFor(prepared);
    const result = await finalizeProductionIngest(
      prepared,
      {
        ...approval,
        promotion_decisions: { ...approval.promotion_decisions!, evidence_acknowledged: false },
      },
      { destinationRoot: join(await root(), 'missing'), write: true },
    );
    expect(result.promotion.result.status).toBe('blocked');
    expect(result.write_result).toEqual({
      status: 'blocked',
      issues: result.promotion.result.issues,
      schema_valid: false,
      collision: false,
    });
  });

  it('rejects an approval for a different review package', async () => {
    const prepared = await prepare();
    const approval = approvalFor(prepared);
    const destinationRoot = await root();
    await expect(
      finalizeProductionIngest(
        prepared,
        { ...approval, semantic_snapshot: `sha256:${'b'.repeat(64)}` },
        { destinationRoot, write: true },
      ),
    ).rejects.toThrow(/exact review package/);
    await expect(
      readFile(join(destinationRoot, `${prepared.bridge.candidate!.id}.yaml`), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves create-only collision behavior during finalization', async () => {
    const prepared = await prepare();
    const destinationRoot = await root();
    const dryRun = await finalizeProductionIngest(prepared, approvalFor(prepared), {
      destinationRoot,
    });
    const target = dryRun.write_result.path!;
    await writeFile(target, 'original\n', 'utf8');
    const result = await finalizeProductionIngest(prepared, approvalFor(prepared), {
      destinationRoot,
      write: true,
    });
    expect(result.write_result.status).toBe('blocked');
    expect(result.write_result.collision).toBe(true);
    expect(result.write_result.issues.map((issue) => issue.code)).toContain(
      'promotion_already_exists',
    );
    expect(await readFile(target, 'utf8')).toBe('original\n');
  });

  it('passes catalog context through for canonical identity collision during finalization', async () => {
    const prepared = await prepare();
    const approval = approvalFor(prepared);
    const destinationRoot = await root();
    const dryRun = await finalizeProductionIngest(prepared, approval, { destinationRoot });
    expect(dryRun.promotion.result.status).toBe('success');
    const result = await finalizeProductionIngest(
      prepared,
      approval,
      { destinationRoot, write: true },
      { components: [dryRun.promotion.result.proposal!] },
    );
    expect(result.promotion.result.status).toBe('blocked');
    expect(result.promotion.result.issues.map((issue) => issue.code)).toContain(
      'promotion_already_exists',
    );
    expect(result.write_result.status).toBe('blocked');
    await expect(readFile(dryRun.write_result.path!, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('uses the exact prepared candidate and review package without recomputing ingestion', async () => {
    const prepared = await prepare();
    const approval = approvalFor(prepared);
    const result = await finalizeProductionIngest(prepared, approval, {
      destinationRoot: await root(),
    });
    expect(result.promotion.review.id).toBe(approval.id);
    expect(result.promotion.review.candidate_id).toBe(prepared.bridge.candidate!.id);
    expect(approval.review_package).toEqual(
      artifactReference('review_package', prepared.review_package),
    );
    expect(approval.review_package_snapshot).toBe(reviewPackageSnapshot(prepared.review_package));
    expect(result.promotion.result.audit?.candidate_id).toBe(prepared.bridge.candidate!.id);
  });

  it('does not mutate the prepared review state approval or write request', async () => {
    const prepared = await prepare();
    const approval = approvalFor(prepared);
    const writeRequest = { destinationRoot: await root(), write: false };
    const beforePrepared = structuredClone(prepared);
    const beforeApproval = structuredClone(approval);
    const beforeRequest = structuredClone(writeRequest);
    await finalizeProductionIngest(prepared, approval, writeRequest);
    expect(prepared).toEqual(beforePrepared);
    expect(approval).toEqual(beforeApproval);
    expect(writeRequest).toEqual(beforeRequest);
  });

  it('produces deterministic finalization results for equivalent prepared inputs', async () => {
    const prepared = await prepare();
    const equivalent = await prepare();
    const destinationRoot = await root();
    const first = await finalizeProductionIngest(prepared, approvalFor(prepared), {
      destinationRoot,
    });
    const second = await finalizeProductionIngest(equivalent, approvalFor(equivalent), {
      destinationRoot,
    });
    expect(first).toEqual(second);
    expect(first.write_result.status).toBe('dry_run');
  });
});
