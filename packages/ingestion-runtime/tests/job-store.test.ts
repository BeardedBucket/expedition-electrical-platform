// @vitest-environment node
import { mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileIngestionJobStore, JobStoreConflictError } from '../src/job-store.js';
import type { IngestionJob } from '../src/job-service.js';
import {
  artifactDigest,
  artifactReference,
  PRODUCTION_SCHEMA_VERSION,
  validateProductionArtifactSchema,
  type ReviewedSemanticDecision,
} from '@expedition/ingestion';
import * as replacement from '../src/file-replacement.js';

const replaceJobRecord = replacement.replaceJobRecord;
const roots: string[] = [];
const job: IngestionJob = {
  schema_version: '1.0',
  id: '11111111-1111-1111-1111-111111111111',
  created_at: '2026-09-27T00:00:00.000Z',
  updated_at: '2026-09-27T00:00:00.000Z',
  state: 'created',
  intake: {
    schema_version: '1.0',
    artifact_kind: 'product_intake',
    id: 'intake.test',
    manufacturer: 'Example',
    product_model: 'Example Model',
    manufacturer_part_number: 'EX-1',
    official_product_uri: 'https://example.test/product',
  },
};
const nextJob: IngestionJob = {
  ...job,
  state: 'preparing',
  updated_at: '2026-09-27T00:00:01.000Z',
};

const decisionReference = (
  kind: 'semantic_proposal' | 'qualified_fact',
  reference: string,
  marker: string,
) => ({
  kind,
  reference_schema_version: PRODUCTION_SCHEMA_VERSION,
  referenced_artifact_schema_version: PRODUCTION_SCHEMA_VERSION,
  digest: `sha256:${marker.repeat(64)}`,
  digest_algorithm: 'sha256' as const,
  reference,
});

const makeDecision = (
  revision: number,
  id: string,
  actor = 'operator.test',
  previous?: ReviewedSemanticDecision,
): ReviewedSemanticDecision => ({
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'reviewed_semantic_decision',
  id,
  revision,
  ...(previous
    ? {
        previous_decision: artifactReference(
          'reviewed_semantic_decision',
          previous,
          previous.id,
          previous.schema_version,
        ),
      }
    : {}),
  proposal_ref: decisionReference('semantic_proposal', 'semantic-proposal.test', 'a'),
  fact_refs: [decisionReference('qualified_fact', 'qualified-fact.test', 'b')],
  input_snapshot: `sha256:${'d'.repeat(64)}`,
  outcome: 'evidence_only',
  actor: { kind: 'operator_label', identifier: actor },
  recorded_at: `2026-09-27T00:00:0${revision}.000Z`,
  validation_policy_version: 'reviewed-semantic.v1',
});

const durableReviewJob = (decisions?: readonly ReviewedSemanticDecision[]): IngestionJob =>
  ({
    ...job,
    state: 'review_ready',
    preparation: {
      status: 'review_ready',
      intake: job.intake,
      review_package: {},
      bridge: {
        ...(decisions === undefined ? {} : { reviewed_semantic_decisions: decisions }),
      },
    },
  }) as unknown as IngestionJob;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'job-store-replacement-'));
  roots.push(root);
  const store = new FileIngestionJobStore(root);
  await store.create(job);
  const version = (await store.loadVersioned(job.id)).version;
  const destination = join(root, `${job.id}.json`);
  const original = await readFile(destination, 'utf8');
  return { root, store, destination, original, version };
}

async function setupSemanticHistory(decisions?: readonly ReviewedSemanticDecision[]): Promise<{
  readonly root: string;
  readonly store: FileIngestionJobStore;
  readonly destination: string;
  readonly version: string;
  readonly current: IngestionJob;
}> {
  const root = await mkdtemp(join(tmpdir(), 'job-store-semantic-history-'));
  roots.push(root);
  const store = new FileIngestionJobStore(root);
  const current = durableReviewJob(decisions);
  for (const decision of decisions ?? [])
    expect(validateProductionArtifactSchema(decision)).toEqual([]);
  await store.create(current);
  return {
    root,
    store,
    destination: join(root, `${job.id}.json`),
    version: (await store.loadVersioned(job.id)).version,
    current,
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('job-store atomic replacement and cleanup', () => {
  it.each(['manufacturer_part_number', 'official_product_uri'] as const)(
    'preserves absent %s through durable reload',
    async (field) => {
      const { root, store } = await setup();
      const intake = { ...job.intake };
      delete intake[field];
      const state = field === 'official_product_uri' ? 'source_resolution_required' : 'created';
      const absentId = '22222222-2222-2222-2222-222222222222';
      await store.create({ ...job, id: absentId, intake, state });
      const reloaded = await new FileIngestionJobStore(root).load(absentId);
      expect(reloaded.intake).toEqual(intake);
      expect(reloaded.intake).not.toHaveProperty(field);
      expect(reloaded.state).toBe(state);
    },
  );
  it('keeps the old valid record throughout contention, installs the exact new record, and cleans the temp file', async () => {
    const { root, store, destination, original, version } = await setup();
    const delay = vi.fn(async () => {
      expect(await readFile(destination, 'utf8')).toBe(original);
      expect(await store.load(job.id)).toEqual(job);
    });
    let attempts = 0;
    let temporaryPath: string | undefined;
    const replace = vi.fn(async (temporary: string, target: string) => {
      temporaryPath ??= temporary;
      expect(temporary).toBe(temporaryPath);
      expect(target).toBe(destination);
      expect(await readFile(destination, 'utf8')).toBe(original);
      expect(await store.load(job.id)).toEqual(job);
      expect(await readFile(temporary, 'utf8')).not.toBe(original);
      if (++attempts < 3)
        throw Object.assign(new Error('Transient replacement contention'), { code: 'EPERM' });
      await rename(temporary, target);
    });
    vi.spyOn(replacement, 'replaceJobRecord').mockImplementation((temporary, target) =>
      replaceJobRecord(temporary, target, { rename: replace, delay }),
    );
    await store.save(nextJob, version);
    expect(replace).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls).toHaveLength(2);
    expect(await new FileIngestionJobStore(root).load(job.id)).toEqual(nextJob);
    expect(await readdir(root)).toEqual([`${job.id}.json`]);
  });

  it('exhausts transient retries, preserves the prior record, and cleans the temp file', async () => {
    const { root, store, destination, original, version } = await setup();
    const error = Object.assign(new Error('EPERM: operation not permitted, rename'), {
      code: 'EPERM',
    });
    const replace = vi.fn(async (temporary: string, target: string) => {
      expect(target).toBe(destination);
      expect(await readFile(destination, 'utf8')).toBe(original);
      expect(await store.load(job.id)).toEqual(job);
      expect(await readFile(temporary, 'utf8')).not.toBe(original);
      throw error;
    });
    const delay = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(replacement, 'replaceJobRecord').mockImplementation((temporary, target) =>
      replaceJobRecord(temporary, target, { rename: replace, delay }),
    );
    await expect(store.save(nextJob, version)).rejects.toBe(error);
    expect(replace).toHaveBeenCalledTimes(5);
    expect(delay.mock.calls).toEqual([[25], [50], [100], [150]]);
    expect(await readFile(destination, 'utf8')).toBe(original);
    expect(await new FileIngestionJobStore(root).load(job.id)).toEqual(job);
    expect(await readdir(root)).toEqual([`${job.id}.json`]);
  });

  it('leaves exclusive initial creation unchanged and does not invoke replacement for a collision', async () => {
    const { root, store } = await setup();
    const replace = vi.spyOn(replacement, 'replaceJobRecord');
    await expect(store.create(nextJob)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(replace).not.toHaveBeenCalled();
    expect(await store.load(job.id)).toEqual(job);
    expect(await readdir(root)).toEqual([`${job.id}.json`]);
  });

  it('conditionally replaces the job when the expected durable checksum matches', async () => {
    const { store, version } = await setup();
    const nextVersion = await store.save(nextJob, version);
    const reloaded = await store.loadVersioned(job.id);

    expect(reloaded.job).toEqual(nextJob);
    expect(reloaded.version).toBe(nextVersion);
    expect(reloaded.version).not.toBe(version);
  });

  it('rejects a stale checksum and leaves the competing durable state untouched', async () => {
    const { store, version, destination } = await setup();
    const competingJob = { ...nextJob, updated_at: '2026-09-27T00:00:02.000Z' };
    await store.save(competingJob, version);
    const competingBytes = await readFile(destination, 'utf8');
    const staleWriter = { ...nextJob, updated_at: '2026-09-27T00:00:03.000Z' };

    await expect(store.save(staleWriter, version)).rejects.toBeInstanceOf(JobStoreConflictError);
    expect(await readFile(destination, 'utf8')).toBe(competingBytes);
    expect((await store.load(job.id)).updated_at).toBe(competingJob.updated_at);
  });

  it('allows a replacement that preserves the existing semantic decision history', async () => {
    const first = makeDecision(1, 'decision.one');
    const { store, current, version } = await setupSemanticHistory([first]);
    const unchangedHistory = {
      ...current,
      updated_at: '2026-09-27T00:00:02.000Z',
    };

    await store.save(unchangedHistory, version);
    const reloaded = await store.load(job.id);
    expect(
      reloaded.preparation?.status === 'review_ready'
        ? reloaded.preparation.bridge.reviewed_semantic_decisions
        : undefined,
    ).toEqual([first]);
  });

  it('allows appending a new decision after the exact existing history prefix', async () => {
    const first = makeDecision(1, 'decision.one');
    const second = makeDecision(2, 'decision.two', 'operator.corrected', first);
    const { store, current, version } = await setupSemanticHistory([first]);
    const appended = {
      ...current,
      preparation: {
        ...current.preparation!,
        bridge: {
          ...current.preparation!.bridge,
          reviewed_semantic_decisions: [first, second],
        },
      },
    } as IngestionJob;

    await store.save(appended, version);
    const reloaded = await store.load(job.id);
    expect(
      reloaded.preparation?.status === 'review_ready'
        ? reloaded.preparation.bridge.reviewed_semantic_decisions
        : undefined,
    ).toEqual([first, second]);
  });

  it.each([
    ['truncation', (first: ReviewedSemanticDecision, _second: ReviewedSemanticDecision) => [first]],
    [
      'modification',
      (first: ReviewedSemanticDecision, second: ReviewedSemanticDecision) => [
        { ...first, actor: { kind: 'operator_label' as const, identifier: 'operator.edited' } },
        second,
      ],
    ],
    [
      'reordering',
      (first: ReviewedSemanticDecision, second: ReviewedSemanticDecision) => [second, first],
    ],
    [
      'same-ID replacement',
      (first: ReviewedSemanticDecision, second: ReviewedSemanticDecision) => [
        first,
        { ...second, actor: { kind: 'operator_label' as const, identifier: 'operator.replaced' } },
        makeDecision(3, 'decision.three', 'operator.appended', second),
      ],
    ],
  ] as const)(
    'rejects semantic history %s and preserves the durable record bytes',
    async (_case, replacementHistory) => {
      const first = makeDecision(1, 'decision.one');
      const second = makeDecision(2, 'decision.two', 'operator.corrected', first);
      const { store, current, version, destination } = await setupSemanticHistory([first, second]);
      const recordBytes = await readFile(destination, 'utf8');
      const replacement = {
        ...current,
        preparation: {
          ...current.preparation!,
          bridge: {
            ...current.preparation!.bridge,
            reviewed_semantic_decisions: replacementHistory(first, second),
          },
        },
      } as IngestionJob;

      await expect(store.save(replacement, version)).rejects.toThrow(
        /Reviewed semantic decision history is immutable and append-only/,
      );
      expect(await readFile(destination, 'utf8')).toBe(recordBytes);
      expect(artifactDigest(await store.load(job.id))).toBe(artifactDigest(current));
    },
  );

  it('keeps legacy absent history compatible and allows it to acquire a first event', async () => {
    const { store, current, version, destination } = await setupSemanticHistory();
    expect(current.preparation?.status).toBe('review_ready');
    if (current.preparation?.status !== 'review_ready')
      throw new Error('Test fixture is not review-ready.');
    expect(current.preparation.bridge).not.toHaveProperty('reviewed_semantic_decisions');

    const unchangedLegacy = {
      ...current,
      updated_at: '2026-09-27T00:00:04.000Z',
    };
    const nextVersion = await store.save(unchangedLegacy, version);
    const loadedLegacy = await store.load(job.id);
    expect(loadedLegacy.preparation?.status).toBe('review_ready');
    if (loadedLegacy.preparation?.status !== 'review_ready')
      throw new Error('Reloaded test fixture is not review-ready.');
    expect(loadedLegacy.preparation.bridge).not.toHaveProperty('reviewed_semantic_decisions');

    const first = makeDecision(1, 'decision.legacy-first');
    expect(validateProductionArtifactSchema(first)).toEqual([]);
    const appended = {
      ...loadedLegacy,
      preparation: {
        ...loadedLegacy.preparation,
        bridge: { ...loadedLegacy.preparation.bridge, reviewed_semantic_decisions: [first] },
      },
    };
    await store.save(appended, nextVersion);
    const reloaded = await store.load(job.id);
    expect(
      reloaded.preparation?.status === 'review_ready'
        ? reloaded.preparation.bridge.reviewed_semantic_decisions
        : undefined,
    ).toEqual([first]);
    expect(await readFile(destination, 'utf8')).not.toBe('');
  });
});
