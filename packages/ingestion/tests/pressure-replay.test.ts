// @vitest-environment node
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  replayPressureCorpus,
  classifyPressureProposal,
} from '../../../scripts/ingestion-pressure-replay.mjs';
import { serializeJob } from '../../ingestion-runtime/src/codec.js';
import {
  artifactReference,
  artifactDigest,
  buildQualifiedFactArtifact,
  reconcileQualifiedFactsForWholeIntake,
} from '../src/index.js';
import { buildLegacyProductionSemanticProposals } from '../src/production-semantic-bridge.js';
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (relative(tmpdir(), root).startsWith('..')) throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
const envelope = (value: unknown) => {
  const payload = serializeJob(value);
  return JSON.stringify({ digest: createHash('sha256').update(payload).digest('hex'), payload });
};
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pressure-synthetic-'));
  roots.push(root);
  await mkdir(join(root, 'batches'));
  await mkdir(join(root, 'jobs'));
  const id = '00000000-0000-4000-8000-000000000001';
  const intake = {
    schema_version: '1.0' as const,
    artifact_kind: 'product_intake' as const,
    id: 'synthetic.intake',
    manufacturer: 'Neutral',
    product_model: 'Model',
    manufacturer_part_number: 'MPN',
    official_product_uri: 'https://example.invalid/product',
  };
  const capture = {
    schema_version: '1.0' as const,
    artifact_kind: 'source_capture' as const,
    id: 'synthetic.capture',
    requested_uri: intake.official_product_uri,
    retrieved_at: '2026-01-01T00:00:00Z',
    disposition: 'authoritative' as const,
    retention_status: 'not_retained' as const,
    source_provenance: { publisher: 'Neutral' },
  };
  const source = {
    schema_version: '1.0' as const,
    artifact_kind: 'source_acquisition' as const,
    id: 'synthetic.source',
    intake: artifactReference('product_intake', intake),
    seed_capture: artifactReference('source_capture', capture),
    officiality: 'official' as const,
    status: 'acquired' as const,
    candidates: [],
    deterministic_snapshot: `sha256:${'a'.repeat(64)}`,
  };
  const fact = buildQualifiedFactArtifact({
    source_capture: artifactReference('source_capture', capture),
    source_acquisition: artifactReference('source_acquisition', source),
    qualification_state: 'exact',
    metadata: {
      source_wording: 'Maximum output current: 40 A',
      source_label: 'Maximum output current',
      raw_value: '40',
      source_unit: 'A',
      applicability: { kind: 'exact_mpn_or_sku', value: 'MPN' },
    },
  });
  const input = {
    facts: [fact],
    source_acquisitions: [source],
    reconciliation: reconcileQualifiedFactsForWholeIntake({
      facts: [fact],
      source_acquisitions: [source],
    }),
  };
  const job = {
    id,
    intake,
    state: 'review_ready',
    preparation: {
      status: 'review_ready',
      qualified_facts: [fact],
      source_acquisitions: [source],
      reconciliation: input.reconciliation,
      proposals: buildLegacyProductionSemanticProposals(input),
      captures: [capture],
      document_extractions: [],
    },
  };
  const batch = join(root, 'batches', 'synthetic.json'),
    jobPath = join(root, 'jobs', `${id}.json`);
  await writeFile(batch, envelope({ id: 'synthetic.batch', job_ids: [id] }));
  await writeFile(jobPath, envelope(job));
  return { root, batch, jobPath, job };
};
describe('offline pressure replay isolation', () => {
  it('counts non-mapped retained evidence separately from actual human work and preserves complete tables', async () => {
    const f = await fixture();
    const prior = f.job.preparation.qualified_facts[0];
    const retained = buildQualifiedFactArtifact({
      source_capture: prior.source_capture,
      source_acquisition: prior.source_acquisition,
      qualification_state: 'exact',
      metadata: {
        source_wording: 'Warranty: 2 years',
        source_label: 'Warranty',
        raw_value: '2 years',
        applicability: prior.metadata.applicability,
      },
    });
    const facts = [retained];
    const input = {
      facts,
      source_acquisitions: f.job.preparation.source_acquisitions,
      reconciliation: reconcileQualifiedFactsForWholeIntake({
        facts,
        source_acquisitions: f.job.preparation.source_acquisitions,
      }),
    };
    const preparation = {
      ...f.job.preparation,
      qualified_facts: facts,
      reconciliation: input.reconciliation,
      proposals: buildLegacyProductionSemanticProposals(input),
    };
    await writeFile(f.jobPath, envelope({ ...f.job, preparation }));
    const bytes = await readFile(f.jobPath, 'utf8');
    const report = replayPressureCorpus(f.batch, join(f.root, 'retained.json'));
    expect(report.after).toMatchObject({
      non_mapped_proposals: 1,
      automatic_retained_evidence: 1,
      human_dispositions: 0,
    });
    expect(report.remaining_human_review_table).toHaveLength(0);
    expect(report.automatic_retained_evidence_table).toHaveLength(1);
    expect(report.complete_mapped_rule_table).toHaveLength(0);
    expect(report.complete_grouped_remaining_table).toMatchObject([{ count: 1, human_count: 0 }]);
    expect(
      report.automatic_retained_evidence_table[0].automatic_evidence_classification.assertions[0]
        .source_fact,
    ).toEqual(retained);
    expect(report.authority_actions).toBe(0);
    expect(await readFile(f.jobPath, 'utf8')).toBe(bytes);
  });
  it('reports vocabulary limitations separately from recognized value/context failures and schema gaps', () => {
    const sourceFact = buildQualifiedFactArtifact({
      source_capture: artifactReference('source_capture', { id: 'synthetic.capture' }),
      qualification_state: 'exact',
      metadata: {
        source_label: 'Height',
        source_wording: 'Height 10 mm',
        raw_value: '10',
        source_unit: 'mm',
        applicability: { kind: 'exact_product', value: 'Model' },
      },
    });
    const base = {
      id: 'synthetic.proposal',
      target: 'source_label:height',
      disposition: 'unsupported',
      provenance: { rationale: 'no mapping rule' },
      fact_refs: [artifactReference('qualified_fact', sourceFact, sourceFact.id)],
    };
    const unknown = classifyPressureProposal(
      base,
      [sourceFact],
      [{ proposal_id: base.id, reason: 'disposition: unsupported' }],
    );
    expect(unknown).toMatchObject({
      source_labels: ['Height'],
      fallback_source_label: 'height',
      normalized_source_labels: ['height'],
      category: 'unrecognized_source_vocabulary',
      non_projection_reasons: ['disposition: unsupported'],
    });
    expect(
      classifyPressureProposal({ ...base, target: 'unknown.interpretation' }, []).category,
    ).toBe('unclassified_unsupported_interpretation');
    const rule = {
      id: 'generic.height',
      revision: 2,
      digest: artifactDigest('synthetic'),
      interpreter: 'synthetic.interpreter',
    };
    const recognized = (reasons: string[]) => ({
      ...base,
      target: 'dimensions_mm.z',
      disposition: 'unresolved',
      semantic_assertions: [{ concept: 'height', rule, review_required_reasons: reasons }],
    });
    expect(classifyPressureProposal(recognized(['value_or_unit_unresolved']), []).category).toBe(
      'recognized_concept_unresolved_value_or_unit',
    );
    expect(
      classifyPressureProposal(
        recognized(['qualifier_context_unresolved', 'value_or_unit_unresolved']),
        [],
      ).category,
    ).toBe('recognized_concept_context_or_applicability_unresolved');
    expect(classifyPressureProposal({ ...base, disposition: 'conflicting' }, []).category).toBe(
      'conflict',
    );
    expect(classifyPressureProposal({ ...base, disposition: 'evidence_only' }, []).category).toBe(
      'evidence_only',
    );
    expect(
      classifyPressureProposal({ ...base, schema_gap: { concept_key: 'invented' } }, []).category,
    ).toBe('unrecognized_source_vocabulary');
  });
  it('reduces ordinary semantic work deterministically with no network or evidence mutation', async () => {
    const f = await fixture(),
      bytes = await readFile(f.jobPath, 'utf8');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
    const a = replayPressureCorpus(f.batch, join(f.root, 'first.json')),
      b = replayPressureCorpus(f.batch, join(f.root, 'second.json'));
    expect(a).toEqual(b);
    expect(a.before.human_dispositions).toBe(1);
    expect(a.after.human_dispositions).toBe(0);
    expect(a.after.dispositions.mapped).toBe(1);
    expect(a.authority_actions).toBe(0);
    expect(a.copied_evidence_unchanged).toBe(true);
    expect(await readFile(f.jobPath, 'utf8')).toBe(bytes);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses original-workspace inputs, corrupt envelopes, existing output and authority-bearing evidence', async () => {
    const f = await fixture();
    expect(() =>
      replayPressureCorpus(join(process.cwd(), 'synthetic.json'), join(f.root, 'outside.json')),
    ).toThrow(/TEMP/);
    const output = join(f.root, 'first.json');
    replayPressureCorpus(f.batch, output);
    expect(() => replayPressureCorpus(f.batch, output)).toThrow(/EEXIST/);
    await writeFile(f.jobPath, envelope({ ...f.job, approval: { decision: 'approved' } }));
    expect(() => replayPressureCorpus(f.batch, join(f.root, 'approved.json'))).toThrow(
      /human authority/,
    );
    await writeFile(f.jobPath, JSON.stringify({ digest: 'wrong', payload: serializeJob(f.job) }));
    expect(() => replayPressureCorpus(f.batch, join(f.root, 'bad.json'))).toThrow(/integrity/);
  });
  it('keeps the archived v5 interpreter available after the current-version advance', async () => {
    const f = await fixture();
    const report = replayPressureCorpus(
      f.batch,
      join(f.root, 'archived-v5.json'),
      undefined,
      'semantic-assertions.v5',
    );
    expect(report.semantic_interpreter).toBe('semantic-assertions.v5');
    expect(report.deterministic).toBe(true);
    expect(report.copied_evidence_unchanged).toBe(true);
    expect(report.authority_actions).toBe(0);
  });
});
