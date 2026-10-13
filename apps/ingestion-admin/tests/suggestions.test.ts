// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentLibraryRecord } from '@expedition/engineering-core';
import { verifySyntheticRecord } from '../../../packages/engineering-core/tests/fixtures/verification.js';
import { buildIntakeSuggestions, loadIntakeSuggestions } from '../server/suggestions.js';
import { operatorConfiguration } from '../server/runtime.js';

/** Test-owned Git v2 inventory, not staging in a developer checkout. The real
 * read-only ls-files command consumes this fixed fixture; no init/add/commit or
 * root discovery is needed. Layout constants follow gitformat-index:
 * https://git-scm.com/docs/gitformat-index (12-byte header, 62-byte fixed entry,
 * eight-byte entry alignment, SHA-1 checksum). Stat fields are zero because
 * ls-files reads names without refreshing or checking fixture worktree stats. */
async function writeSyntheticInventory(root: string, files: Record<string, string>) {
  const gitRoot = join(root, '.git');
  await mkdir(join(gitRoot, 'objects'), { recursive: true });
  await mkdir(join(gitRoot, 'refs'), { recursive: true });
  await writeFile(join(gitRoot, 'HEAD'), 'ref: refs/heads/synthetic-fixture\n');
  await writeFile(join(gitRoot, 'empty-config'), '');
  const header = Buffer.alloc(12);
  header.write('DIRC');
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(Object.keys(files).length, 8);
  const entries = [];
  for (const name of Object.keys(files).sort()) {
    const contents = Buffer.from(files[name]);
    await writeFile(join(root, name), contents);
    const nameBytes = Buffer.from(name);
    const entry = Buffer.alloc(Math.ceil((62 + nameBytes.length + 1) / 8) * 8);
    entry.writeUInt32BE(0o100644, 24);
    entry.writeUInt32BE(contents.length, 36);
    createHash('sha1')
      .update(`blob ${contents.length}\0`)
      .update(contents)
      .digest()
      .copy(entry, 40);
    entry.writeUInt16BE(nameBytes.length, 60);
    nameBytes.copy(entry, 62);
    entries.push(entry);
  }
  const index = Buffer.concat([header, ...entries]);
  await writeFile(
    join(gitRoot, 'index'),
    Buffer.concat([index, createHash('sha1').update(index).digest()]),
  );
  // Pin every Git path to the fresh fixture, including when the caller's shell
  // carries Git overrides. Global/system config cannot redirect its inventory.
  for (const [name, value] of Object.entries({
    GIT_DIR: gitRoot,
    GIT_COMMON_DIR: gitRoot,
    GIT_WORK_TREE: root,
    GIT_INDEX_FILE: join(gitRoot, 'index'),
    GIT_OBJECT_DIRECTORY: join(gitRoot, 'objects'),
    GIT_CEILING_DIRECTORIES: dirname(root),
    GIT_CONFIG_GLOBAL: join(gitRoot, 'empty-config'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '0',
    GIT_CONFIG_PARAMETERS: '',
    GIT_OPTIONAL_LOCKS: '0',
  }))
    vi.stubEnv(name, value);
}

describe('authoritative intake suggestions', () => {
  it('loads reviewed manufacturer spellings using a validated synthetic catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'intake-suggestions-'));
    try {
      await mkdir(join(root, 'data/components'), { recursive: true });
      await mkdir(join(root, 'data/ingestion/manufacturer-acquisition-profiles'), {
        recursive: true,
      });
      // These names test canonical spelling only; no manufacturer specification
      // is asserted. The existing helper binds authority to this synthetic record.
      const record = {
        id: 'synthetic.suggestions-reviewed',
        manufacturer: 'Victron Energy',
        model: 'Synthetic spelling fixture',
        verification_status: 'verified',
        source_refs: [{ id: 'synthetic.source', title: 'Project-authored spelling fixture' }],
      } satisfies ComponentLibraryRecord;
      await writeSyntheticInventory(root, {
        'data/components/synthetic-reviewed.yaml': JSON.stringify(verifySyntheticRecord(record)),
        'data/components/synthetic-status-only.yaml': JSON.stringify({
          ...record,
          id: 'synthetic.suggestions-status-only',
          manufacturer: 'Victron',
        }),
      });
      // An invalid unindexed file proves discovery follows the fixed Git
      // inventory rather than walking even this test-owned component directory.
      await writeFile(join(root, 'data/components/unindexed.yaml'), ': invalid fixture');
      const indexBefore = await readFile(join(root, '.git/index'));
      const suggestions = await loadIntakeSuggestions(
        operatorConfiguration({ INGESTION_REPOSITORY_ROOT: root }),
      );
      expect(suggestions.manufacturers).toContain('Victron Energy');
      expect(suggestions.manufacturers).not.toContain('Victron');
      expect(
        suggestions.products.every((product) =>
          product.provenance.startsWith('verified component:'),
        ),
      ).toBe(true);
      expect(suggestions.products.some((product) => product.provenance.includes('ekrano'))).toBe(
        false,
      );
      expect(suggestions.products).toEqual([
        {
          manufacturer: 'Victron Energy',
          model: 'Synthetic spelling fixture',
          provenance: 'verified component: synthetic.suggestions-reviewed',
        },
      ]);
      expect(await readFile(join(root, '.git/index'))).toEqual(indexBefore);
    } finally {
      // Restore caller environment before removing only the mkdtemp-owned root.
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('excludes unverified/partially verified product identities and preserves canonical spelling', () => {
    const record: ComponentLibraryRecord = {
      id: 'example.a',
      manufacturer: 'Canonical Maker',
      model: 'Model A',
      part_number: 'SKU-A',
      category: 'test',
      verification_status: 'verified',
    };
    const suggestions = buildIntakeSuggestions(
      [
        record,
        { ...record, manufacturer: 'Unreviewed typo', verification_status: 'unverified' },
        { ...record, manufacturer: 'Partial', verification_status: 'partially_verified' },
      ],
      [],
    );
    expect(suggestions).toEqual({
      manufacturers: ['Canonical Maker'],
      products: [
        {
          manufacturer: 'Canonical Maker',
          model: 'Model A',
          mpn: 'SKU-A',
          provenance: 'verified component: example.a',
        },
      ],
    });
  });
});
