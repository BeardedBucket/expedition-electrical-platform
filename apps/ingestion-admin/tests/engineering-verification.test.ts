// @vitest-environment node
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parse, stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalEngineeringDigest,
  hasCurrentCanonicalVerification,
  canonicalVerificationHistoryValid,
  canonicalVerificationEventId,
} from '@expedition/engineering-core/canonical-verification';
import { loadComponentLibraryFile } from '@expedition/engineering-core/component-library-loader';
import { fixtureService, intake } from './fixtures.js';
import { constructApproval } from '../server/product-review.js';
import { createOperatorApi } from '../server/api.js';
import { IngestionBatchService, FileIngestionBatchStore } from '@expedition/ingestion-runtime';
import type { Server } from 'node:http';
import { readEngineeringVerificationPreview } from '../../../packages/ingestion/src/engineering-verification.js';

const roots: string[] = [],
  servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  for (const root of roots.splice(0)) {
    if (relative(tmpdir(), root).startsWith('..')) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
const promoted = async (write = true) => {
  const root = await mkdtemp(join(tmpdir(), 'verification-synthetic-'));
  roots.push(root);
  const canonical = join(root, 'canonical');
  await mkdir(canonical);
  const service = fixtureService(join(root, 'jobs'));
  const created = await service.createJob(intake);
  const prepared = await service.prepareJob(created.id);
  if (prepared.preparation?.status !== 'review_ready')
    throw new Error('Synthetic preparation failed');
  const candidate = prepared.preparation.bridge.candidate!;
  await service.submitApproval(
    created.id,
    constructApproval(prepared, 'approved', {
      reviewer_id: 'Approval label',
      promotion_decisions: {
        approved_fields: Object.keys(candidate.field_evidence),
        evidence_acknowledged: true,
        category: 'distribution',
        product_role: 'distribution_panel',
      },
    }),
  );
  const job = await service.finalizeJob(created.id, { destinationRoot: canonical, write });
  const path = job.final_result?.write_result.path;
  return { root, canonical, service, id: created.id, path: path!, job };
};
describe('separate trusted local engineering verification', () => {
  it('rejects canonical root drift even when another root contains the same-ID file', async () => {
    const f = await promoted(),
      alternate = join(f.root, 'alternate');
    await mkdir(alternate);
    const copy = join(alternate, `${f.job.final_result!.write_result.proposal!.id}.yaml`);
    await writeFile(copy, await readFile(f.path, 'utf8'));
    const before = await readFile(copy, 'utf8');
    await expect(f.service.engineeringVerificationPreview(f.id, alternate)).rejects.toThrow(
      /durable canonical write destination/i,
    );
    const original = await f.service.engineeringVerificationPreview(f.id, f.canonical);
    await expect(
      f.service.verifyEngineering(f.id, alternate, original.snapshot, 'Engineer'),
    ).rejects.toThrow(/durable canonical write destination/i);
    expect(await readFile(copy, 'utf8')).toBe(before);
    expect(
      (await f.service.verifyEngineering(f.id, f.canonical, original.snapshot, 'Engineer')).current,
    ).toBe(true);
  });
  it('rejects missing, mismatched, outside and redirected durable write destinations', async () => {
    const f = await promoted();
    for (const path of [
      undefined,
      `${f.path}.other`,
      join(f.root, 'outside.yaml'),
      `${f.job.final_result!.write_result.proposal!.id}.yaml`,
    ]) {
      const origin = {
        job_id: f.id,
        approval: f.job.approval!,
        finalization: {
          ...f.job.final_result!,
          write_result: { ...f.job.final_result!.write_result, path },
        },
      };
      await expect(readEngineeringVerificationPreview(f.canonical, origin)).rejects.toThrow(
        /durable canonical write destination/i,
      );
    }
  });
  it('downgrades a schema-valid status-only claim without fabricating verification history', async () => {
    const f = await promoted(),
      record = parse(await readFile(f.path, 'utf8'));
    await writeFile(f.path, stringify({ ...record, verification_status: 'verified' }));
    const loaded = await loadComponentLibraryFile(f.path);
    expect(loaded.ok && loaded.value.verification_status).toBe('unverified');
    expect(loaded.ok && loaded.value).not.toHaveProperty('engineering_verification_history');
    expect((await f.service.engineeringVerificationPreview(f.id, f.canonical)).current).toBe(false);
  });
  it('leaves promoted content unverified, and preview is read-only', async () => {
    const f = await promoted();
    const before = await readFile(f.path, 'utf8');
    const preview = await f.service.engineeringVerificationPreview(f.id, f.canonical);
    expect(preview.current).toBe(false);
    expect(preview.record.verification_status).toBe('unverified');
    expect(preview.record.engineering_verification_history).toBeUndefined();
    expect(await readFile(f.path, 'utf8')).toBe(before);
    expect((await f.service.getJob(f.id)).final_result).toEqual(f.job.final_result);
  });
  it('records exact content, origin and an explicitly unauthenticated label without asserting completeness', async () => {
    const f = await promoted(),
      preview = await f.service.engineeringVerificationPreview(f.id, f.canonical);
    const verified = await f.service.verifyEngineering(
      f.id,
      f.canonical,
      preview.snapshot,
      ' Local engineer ',
    );
    const events = verified.record.engineering_verification_history as Record<string, unknown>[];
    expect(verified.current).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor: { kind: 'operator_label', identifier: 'Local engineer' },
      authority_boundary: 'trusted_local_operator',
      content_digest: preview.content_digest,
      component_id: preview.record.id,
      promotion_binding: { job_id: f.id },
    });
    expect(events[0].content_snapshot).not.toHaveProperty('verification_status');
    expect(verified.record).not.toHaveProperty('battery');
    expect(verified.record).not.toHaveProperty('ports');
    expect(hasCurrentCanonicalVerification(verified.record)).toBe(true);
    const loaded = await loadComponentLibraryFile(f.path);
    expect(loaded.ok && loaded.value.verification_status).toBe('verified');
    expect(loaded.ok && hasCurrentCanonicalVerification(loaded.value)).toBe(true);
    const again = await f.service.engineeringVerificationPreview(f.id, f.canonical);
    expect(again).toEqual(verified);
  });
  it('rejects replayed requests and invalid labels without changing the canonical bytes', async () => {
    const f = await promoted(),
      preview = await f.service.engineeringVerificationPreview(f.id, f.canonical);
    await expect(
      f.service.verifyEngineering(f.id, f.canonical, preview.snapshot, '  '),
    ).rejects.toThrow(/operator label/);
    await f.service.verifyEngineering(f.id, f.canonical, preview.snapshot, 'Engineer');
    const bytes = await readFile(f.path, 'utf8');
    await expect(
      f.service.verifyEngineering(f.id, f.canonical, preview.snapshot, 'Engineer'),
    ).rejects.toThrow(/stale/);
    expect(await readFile(f.path, 'utf8')).toBe(bytes);
  });
  it('keeps historical events after a content edit and requires a fresh explicit re-verification', async () => {
    const f = await promoted(),
      preview = await f.service.engineeringVerificationPreview(f.id, f.canonical);
    const verified = await f.service.verifyEngineering(
      f.id,
      f.canonical,
      preview.snapshot,
      'Engineer',
    );
    const record = { ...verified.record, weight_kg: 42 };
    await writeFile(f.path, stringify(record));
    expect(canonicalVerificationHistoryValid(record)).toBe(true);
    expect(hasCurrentCanonicalVerification(record)).toBe(false);
    const stale = await f.service.engineeringVerificationPreview(f.id, f.canonical);
    expect(stale.current).toBe(false);
    expect(canonicalEngineeringDigest(record)).not.toBe(verified.content_digest);
    const loaded = await loadComponentLibraryFile(f.path);
    expect(loaded.ok && loaded.value.verification_status).toBe('unverified');
    await expect(
      f.service.verifyEngineering(f.id, f.canonical, verified.snapshot, 'Engineer'),
    ).rejects.toThrow(/stale/);
    const renewed = await f.service.verifyEngineering(
      f.id,
      f.canonical,
      stale.snapshot,
      'Second label',
    );
    expect(renewed.current).toBe(true);
    const events = renewed.record.engineering_verification_history as unknown[];
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual((verified.record.engineering_verification_history as unknown[])[0]);
    expect(renewed.record).not.toHaveProperty('battery');
  });
  it('cannot verify a dry-run finalization or an unpromoted job', async () => {
    const dry = await promoted(false);
    await expect(dry.service.engineeringVerificationPreview(dry.id, dry.canonical)).rejects.toThrow(
      /completed canonical write/,
    );
    const created = await dry.service.createJob(intake);
    await expect(
      dry.service.engineeringVerificationPreview(created.id, dry.canonical),
    ).rejects.toThrow(/only after/);
  });
  it('compares event origin against the durable promotion even when a changed event was rehashed', async () => {
    const f = await promoted(),
      preview = await f.service.engineeringVerificationPreview(f.id, f.canonical);
    const verified = await f.service.verifyEngineering(
      f.id,
      f.canonical,
      preview.snapshot,
      'Engineer',
    );
    const record = parse(await readFile(f.path, 'utf8'));
    const event = record.engineering_verification_history[0];
    event.promotion_binding.approval_digest = `sha256:${'b'.repeat(64)}`;
    const { id: ignored, ...body } = event;
    void ignored;
    event.id = canonicalVerificationEventId(body);
    await writeFile(f.path, stringify(record));
    expect(verified.current).toBe(true);
    await expect(f.service.engineeringVerificationPreview(f.id, f.canonical)).rejects.toThrow(
      /durable promotion/,
    );
  });
  it('fails closed on writer contention and a corrupt history', async () => {
    const f = await promoted(),
      preview = await f.service.engineeringVerificationPreview(f.id, f.canonical);
    await writeFile(`${f.path}.authority.lock`, 'synthetic abandoned lock');
    await expect(
      f.service.verifyEngineering(f.id, f.canonical, preview.snapshot, 'Engineer'),
    ).rejects.toThrow();
    expect((await f.service.engineeringVerificationPreview(f.id, f.canonical)).current).toBe(false);
    await rm(`${f.path}.authority.lock`);
    const verified = await f.service.verifyEngineering(
      f.id,
      f.canonical,
      preview.snapshot,
      'Engineer',
    );
    const record = {
      ...verified.record,
      engineering_verification_history: [{ actor: { kind: 'authenticated', identifier: 'fake' } }],
    };
    await writeFile(f.path, stringify(record));
    await expect(f.service.engineeringVerificationPreview(f.id, f.canonical)).rejects.toThrow(
      /invalid/,
    );
  });
  it('API owns path/origin/time, supports the batch facade and accepts only intent', async () => {
    const f = await promoted();
    const facade = new IngestionBatchService({
      jobService: f.service,
      store: new FileIngestionBatchStore(join(f.root, 'batches')),
    });
    const server = createOperatorApi(facade, undefined, undefined, f.canonical);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const url = `http://127.0.0.1:${address.port}/api/ingestion/jobs/${f.id}/engineering-verification`;
    const preview = await (await fetch(url)).json();
    const post = (body: unknown) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const before = await readFile(f.path, 'utf8');
    for (const injection of [
      { authority_boundary: 'authenticated' },
      { recorded_at: '2026-01-01' },
      { path: f.path },
      { record: { verification_status: 'verified' } },
    ])
      expect(
        (
          await post({
            ...injection,
            expected_snapshot: preview.snapshot,
            operator_label: 'Engineer',
          })
        ).status,
      ).toBe(400);
    expect(await readFile(f.path, 'utf8')).toBe(before);
    const success = await post({ expected_snapshot: preview.snapshot, operator_label: 'Engineer' });
    expect(success.status).toBe(200);
    expect((await success.json()).current).toBe(true);
    expect(
      (await post({ expected_snapshot: preview.snapshot, operator_label: 'Engineer' })).status,
    ).toBe(409);
  });
});
