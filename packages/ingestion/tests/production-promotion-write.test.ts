import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import {
  artifactReference,
  buildProductionProductCandidate,
  buildProductionReviewPackage,
  buildProductionSemanticProposals,
  buildQualifiedFactArtifact,
  promoteCandidate,
  promoteProductionCandidate,
  PRODUCTION_SCHEMA_VERSION,
  reconcileQualifiedFactsForWholeIntake,
  reviewPackageSnapshot,
  writeProductionPromotion,
  type ProductionApproval,
  type ProductIntake,
  type QualifiedFactArtifact,
  type SourceAcquisitionArtifact,
  type SourceCaptureArtifact,
} from '../src/index.js';

const intake: ProductIntake = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.write',
  manufacturer: 'Example',
  product_model: 'Model',
  manufacturer_part_number: 'MPN',
  official_product_uri: 'https://example.invalid/product',
};
const capture: SourceCaptureArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_capture',
  id: 'capture.write',
  requested_uri: 'https://example.invalid/product',
  retrieved_at: '2026-01-01T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'not_retained',
  source_provenance: { publisher: 'Example' },
};
const acquisition: SourceAcquisitionArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_acquisition',
  id: 'acquisition.write',
  intake: artifactReference('product_intake', intake),
  seed_capture: artifactReference('source_capture', capture),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: `sha256:${'a'.repeat(64)}`,
};
const fact = (label: string, value: string, unit: string): QualifiedFactArtifact =>
  buildQualifiedFactArtifact({
    source_capture: artifactReference('source_capture', capture),
    source_acquisition: artifactReference('source_acquisition', acquisition),
    metadata: {
      source_wording: `${label} ${value}`,
      source_label: label,
      raw_value: value,
      source_unit: unit,
      applicability: { kind: 'exact_mpn_or_sku', value: 'MPN' },
    },
    qualification_state: 'exact',
  });
const inputFacts = [
  fact('nominal voltage', '24', 'V'),
  fact('nominal voltage', '24.0', 'V'),
  fact('continuous current', '10', 'A'),
  fact('continuous current', '10.0', 'A'),
];
const setup = () => {
  const reconciliation = reconcileQualifiedFactsForWholeIntake({
    facts: inputFacts,
    source_acquisitions: [acquisition],
  });
  const proposals = buildProductionSemanticProposals({
    facts: inputFacts,
    source_acquisitions: [acquisition],
    reconciliation,
  });
  const bridge = buildProductionProductCandidate({
    intake,
    captures: [capture],
    source_acquisitions: [acquisition],
    facts: inputFacts,
    reconciliation,
    proposals,
  });
  const reviewPackage = buildProductionReviewPackage({ intake, reconciliation, bridge });
  const approval: ProductionApproval = {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'approval',
    id: 'approval.write',
    review_package: artifactReference('review_package', reviewPackage),
    review_package_snapshot: reviewPackageSnapshot(reviewPackage),
    semantic_snapshot: reviewPackage.semantic_snapshot,
    reviewer_id: 'reviewer.human',
    decision: 'approved',
    reviewed_at: '2026-01-02T00:00:00Z',
    promotion_decisions: {
      approved_fields: Object.keys(bridge.candidate?.field_evidence ?? {}).sort(),
      evidence_acknowledged: true,
      product_role: 'solar_charge_controller',
      category: 'solar_charge_controller',
    },
  };
  return { bridge, reviewPackage, approval };
};

const temporaryRoots: string[] = [];
const root = async (): Promise<string> => {
  const value = await mkdtemp(join(tmpdir(), 'expedition-production-write-'));
  temporaryRoots.push(value);
  return value;
};
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((value) => rm(value, { recursive: true })));
});

describe('production promotion guarded canonical write', () => {
  it('writes a successful production promotion through the existing guarded writer', async () => {
    const { bridge, reviewPackage, approval } = setup();
    const production = promoteProductionCandidate(approval, reviewPackage, bridge);
    expect(production.result.status).toBe('success');
    const result = await writeProductionPromotion(production, {
      destinationRoot: await root(),
      write: true,
    });
    expect(result.status).toBe('written');
    expect(parseYaml(await readFile(result.path!, 'utf8'))).toEqual(production.result.proposal);
    expect(result.audit).toEqual(production.result.audit);
  });

  it('does not attempt a canonical write for a blocked promotion result', async () => {
    const { bridge, reviewPackage, approval } = setup();
    const production = promoteProductionCandidate(
      {
        ...approval,
        promotion_decisions: { ...approval.promotion_decisions!, evidence_acknowledged: false },
      },
      reviewPackage,
      bridge,
    );
    const result = await writeProductionPromotion(production, {
      destinationRoot: join(await root(), 'missing'),
      write: true,
    });
    expect(production.result.status).toBe('blocked');
    expect(result).toEqual({
      status: 'blocked',
      issues: production.result.issues,
      schema_valid: false,
      collision: false,
    });
  });

  it('does not attempt a canonical write for an invalid promotion result', async () => {
    const { bridge, reviewPackage, approval } = setup();
    const production = promoteProductionCandidate(approval, reviewPackage, bridge);
    const invalid = promoteCandidate(
      { ...bridge.candidate!, source_ids: [] },
      bridge.sources,
      bridge.facts,
      production.review,
    );
    expect(invalid.status).toBe('invalid');
    const result = await writeProductionPromotion(
      { ...production, result: invalid },
      { destinationRoot: join(await root(), 'missing'), write: true },
    );
    expect(result.status).toBe('invalid');
    expect(result.issues).toBe(invalid.issues);
    expect(result.path).toBeUndefined();
  });

  it('requires the existing explicit write authorization', async () => {
    const { bridge, reviewPackage, approval } = setup();
    const production = promoteProductionCandidate(approval, reviewPackage, bridge);
    const result = await writeProductionPromotion(production, { destinationRoot: await root() });
    expect(result.status).toBe('dry_run');
    expect(result.issues.map((issue) => issue.code)).toContain('write_not_authorized');
    await expect(readFile(result.path!, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves create-only behavior when the canonical target already exists', async () => {
    const { bridge, reviewPackage, approval } = setup();
    const production = promoteProductionCandidate(approval, reviewPackage, bridge);
    const destinationRoot = await root();
    const target = join(destinationRoot, `${String(production.result.proposal!.id)}.yaml`);
    await writeFile(target, 'original\n', 'utf8');
    const result = await writeProductionPromotion(production, { destinationRoot, write: true });
    expect(result.status).toBe('blocked');
    expect(result.collision).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toContain('promotion_already_exists');
    expect(await readFile(target, 'utf8')).toBe('original\n');
  });

  it('preserves existing path and destination protections', async () => {
    const { bridge, reviewPackage, approval } = setup();
    const production = promoteProductionCandidate(approval, reviewPackage, bridge);
    const destinationRoot = await root();
    const result = await writeProductionPromotion(production, {
      destinationRoot,
      filename: '../escape.yaml',
      write: true,
    });
    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toContain('write_path_invalid');
    await expect(readFile(join(destinationRoot, 'escape.yaml'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('passes the canonical promotion proposal to the writer unchanged', async () => {
    const { bridge, reviewPackage, approval } = setup();
    const production = promoteProductionCandidate(approval, reviewPackage, bridge);
    const before = structuredClone(production);
    const request = { destinationRoot: await root(), write: false };
    const result = await writeProductionPromotion(production, request);
    expect(result.proposal).toBe(production.result.proposal);
    expect(result.audit).toBe(production.result.audit);
    expect(production).toEqual(before);
    expect(request).toEqual({ destinationRoot: request.destinationRoot, write: false });
  });

  it('uses only temporary storage and leaves the reviewed component corpus untouched', async () => {
    const { bridge, reviewPackage, approval } = setup();
    const production = promoteProductionCandidate(approval, reviewPackage, bridge);
    const destinationRoot = await root();
    const result = await writeProductionPromotion(production, { destinationRoot, write: true });
    expect(result.status).toBe('written');
    expect(result.path).toBe(
      join(destinationRoot, `${String(production.result.proposal!.id)}.yaml`),
    );
    expect(await readFile(result.path!, 'utf8')).toBe(result.serialized);
  });
});
