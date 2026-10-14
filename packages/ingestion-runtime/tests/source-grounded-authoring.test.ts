// @vitest-environment node
// All bodies, products and proposed values below are invented test-author data.
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { IngestionJobService } from '../src/job-service.js';
import { FileIngestionJobStore, JobStoreConflictError } from '../src/job-store.js';
import {
  LocalSnapshotStore,
  artifactDigest,
  type AuthoredDraftProposal,
} from '@expedition/ingestion';
import { parseSourceGroundedDraft } from '@expedition/engineering-core/source-grounded-draft';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith('wave2-authoring-test-')
    )
      throw Error('Unowned cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wave2-authoring-test-'));
  roots.push(root);
  const store = new FileIngestionJobStore(join(root, 'jobs'));
  const html =
    '<html><body><h1>Manual-Only</h1><p>Invented source narrative: this model accepts 20-30 V DC input in conversion mode. No native property table.</p></body></html>';
  const bytes = new TextEncoder().encode(html);
  const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  const time = '2026-10-13T00:00:00Z';
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
              retrieved_at: time,
              media_type: 'text/html',
              content_hash: digest,
              body: { bytes, text: html },
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
    id: 'synthetic.authoring',
    manufacturer: 'Invented Test Author',
    product_model: 'Manual-Only',
    official_product_uri: 'https://example.test/manual',
  });
  const job = await service.prepareJob(created.id);
  if (!job.preparation) throw Error('Missing fixture preparation');
  const proposal: AuthoredDraftProposal = {
    version: 'authored-draft-proposal.v1',
    draft: {
      version: 'source-grounded-draft.v1',
      authority: 'codex_prepared_unreviewed',
      product: {
        id: 'draft.synthetic',
        manufacturer: 'Invented Test Author',
        model: 'Manual-Only',
        manufacturer_part_number: null,
        hardware_revision: null,
      },
      intended_use: 'Synthetic source-only proposed voltage meaning',
      sources: [
        {
          id: 'test.source',
          url: 'https://example.test/manual',
          publisher: 'Invented Test Author',
          retrieved_at: time,
          content_digest: digest,
          document_revision: null,
          model: 'Manual-Only',
          identity_locator: 'Synthetic h1',
          rights: 'metadata_and_limited_facts_only',
          redistribution_grant: 'not_established',
        },
      ],
      facts: [
        {
          id: 'test.voltage',
          quantity: 'input_voltage_range',
          basis: 'operating',
          mode: 'conversion',
          direction: 'input',
          electrical_domain: 'dc',
          original: {
            value: '{"min":20,"max":30}',
            unit: 'V',
            presentation: 'source_value_reconstruction',
          },
          normalized: { value: { min: 20, max: 30 }, unit: 'V' },
          normalization: 'identity',
          source_id: 'test.source',
          locator: 'Synthetic narrative context',
          context_digest: digest,
          conditions: [],
          unresolved_conditions: [],
          disposition: 'typed_consumer',
        },
      ],
      holds: ['Synthetic fixture only; no real engineering authority'],
    },
    proofs: [
      {
        source_id: 'test.source',
        locator: 'Synthetic narrative context',
        context_digest: digest,
        start_byte: 0,
        end_byte: bytes.length,
      },
    ],
  };
  return { root, store, service, make, job, proposal };
}
describe('nonauthoritative direct source authoring', () => {
  it('previews without writing, imports atomically with restart/idempotency and never authors human/candidate decisions', async () => {
    const f = await fixture();
    const before = await f.store.loadVersioned(f.job.id);
    const preview = await f.service.previewAuthoredDraft(f.job.id, before.version, f.proposal);
    expect((await f.store.loadVersioned(f.job.id)).version).toBe(before.version);
    expect(preview.authority).toBe('codex_prepared_unreviewed');
    const imported = await f.service.importAuthoredDraft(f.job.id, before.version, f.proposal);
    expect(imported.authored_draft_imports).toHaveLength(1);
    expect(imported.human_adjudications).toBeUndefined();
    expect(imported.approval).toBeUndefined();
    expect(imported.final_result).toBeUndefined();
    expect(artifactDigest(imported.preparation)).toBe(artifactDigest(before.job.preparation));
    expect(await f.make().getJob(f.job.id)).toEqual(imported);
    expect(await f.service.importAuthoredDraft(f.job.id, before.version, f.proposal)).toEqual(
      imported,
    );
    const changed = structuredClone(f.proposal);
    changed.draft.holds.push('Different proposed edit');
    await expect(
      f.service.importAuthoredDraft(f.job.id, before.version, changed),
    ).rejects.toBeInstanceOf(JobStoreConflictError);
    const bytes = await f.service.authoredSourceBytes(
      f.job.id,
      preview.proposal_digest,
      'test.source',
    );
    bytes.bytes[0] = 0;
    expect(
      (await f.service.authoredSourceBytes(f.job.id, preview.proposal_digest, 'test.source'))
        .bytes[0],
    ).not.toBe(0);
  });
  it.each([
    'model',
    'publisher',
    'digest',
    'locator',
    'crop',
    'rights',
    'version',
    'unit',
    'human_authority',
    'foreign_source',
    'literal_phase',
  ] as const)('rejects %s before any durable write', async (kind) => {
    const f = await fixture();
    const before = await f.store.loadVersioned(f.job.id);
    const p = structuredClone(f.proposal);
    if (kind === 'model') p.draft.product.model = 'Other model';
    if (kind === 'publisher') p.draft.sources[0]!.publisher = 'Other publisher';
    if (kind === 'digest') p.draft.sources[0]!.content_digest = 'sha256:' + '0'.repeat(64);
    if (kind === 'locator') p.proofs[0]!.locator = 'Foreign source position';
    if (kind === 'crop') p.proofs[0]!.end_byte = 1;
    if (kind === 'rights')
      (p.draft.sources[0] as unknown as { rights: string }).rights = 'redistributable';
    if (kind === 'version') (p as unknown as { version: string }).version = 'future';
    if (kind === 'unit') p.draft.facts[0]!.normalized.unit = 'A';
    if (kind === 'human_authority')
      (p.draft as unknown as { authority: string }).authority = 'human_reviewed';
    if (kind === 'foreign_source') p.draft.facts[0]!.source_id = 'foreign';
    if (kind === 'literal_phase')
      Object.assign(p.draft.facts[0]!, {
        quantity: 'ac_phase',
        original: { value: 'three_phase', unit: 'text', presentation: 'source_literal' },
        normalized: { value: 'single_phase', unit: 'text' },
      });
    await expect(f.service.previewAuthoredDraft(f.job.id, before.version, p)).rejects.toThrow();
    await expect(f.service.importAuthoredDraft(f.job.id, before.version, p)).rejects.toThrow();
    expect((await f.store.loadVersioned(f.job.id)).version).toBe(before.version);
  });
  it('rejects history replacement and concurrent stale writes across services', async () => {
    const f = await fixture();
    const before = await f.store.loadVersioned(f.job.id);
    await f.service.importAuthoredDraft(f.job.id, before.version, f.proposal);
    const current = await f.store.loadVersioned(f.job.id);
    await expect(
      f.store.save({ ...current.job, authored_draft_imports: [] }, current.version),
    ).rejects.toThrow('immutable');
    const second = structuredClone(f.proposal);
    second.draft.holds.push('Second reviewable proposal');
    const third = structuredClone(f.proposal);
    third.draft.holds.push('Third reviewable proposal');
    const outcomes = await Promise.allSettled([
      f.service.importAuthoredDraft(f.job.id, current.version, second),
      f.make().importAuthoredDraft(f.job.id, current.version, third),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await f.store.load(f.job.id)).authored_draft_imports).toHaveLength(2);
  });
  it('checks exact normalized values rather than silently relabeling manufacturer units', () => {
    const raw = { version: 'source-grounded-draft.v1' };
    expect(() => parseSourceGroundedDraft(raw)).toThrow();
  });
});
