import {
  access as fsAccess,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename as fsRename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  canonicalSerializedSnapshot,
  proposeCanonicalAmendment,
  writeCanonicalAmendment,
  type CanonicalAmendmentCandidate,
  type CanonicalAmendmentFilesystem,
  type CanonicalAmendmentReview,
} from '../src/canonical-amendment.js';
import type { ProductFact } from '../src/contracts.js';
import type { NormalizedProductFact } from '../src/normalization-types.js';

const currentCanonical = () => {
  const text = readFileSync(
    join(process.cwd(), 'data', 'components', 'victron-energy.pmp242200100.yaml'),
    'utf8',
  );
  return parseYaml(text) as Record<string, unknown>;
};

const review = (overrides: Partial<CanonicalAmendmentReview> = {}): CanonicalAmendmentReview => ({
  schema_version: '1.0',
  id: 'review.amendment.1',
  component_id: 'victron-energy.pmp242200100',
  candidate_id: 'candidate.amendment.1',
  decision: 'approved',
  reviewer_id: 'reviewer.human',
  reviewed_at: '2026-09-06T12:00:00.000Z',
  approved_fields: ['dimensions_mm.x', 'dimensions_mm.y', 'dimensions_mm.z'],
  field_actions: {
    'dimensions_mm.x': 'add',
    'dimensions_mm.y': 'add',
    'dimensions_mm.z': 'add',
  },
  field_evidence: {
    'dimensions_mm.x': ['fact.x'],
    'dimensions_mm.y': ['fact.y'],
    'dimensions_mm.z': ['fact.z'],
  },
  evidence_acknowledged: true,
  product_role: 'inverter_charger',
  category: 'inverter_charger',
  expected_snapshot: canonicalSerializedSnapshot(currentCanonical()),
  rationale: 'Verified against manufacturer drawing.',
  ...overrides,
});

const candidateFor = (current: Record<string, unknown>): CanonicalAmendmentCandidate => ({
  component_data: {
    ...current,
    dimensions_mm: { x: 485, y: 200, z: 100 },
    weight_kg: 15,
    electrical: {
      ...(current.electrical as Record<string, unknown>),
      nominal_voltage_v: 48,
    },
  },
  field_evidence: {
    'dimensions_mm.x': ['fact.x'],
    'dimensions_mm.y': ['fact.y'],
    'dimensions_mm.z': ['fact.z'],
  },
  fact_ids: ['fact.x', 'fact.y', 'fact.z'],
  facts: (['x', 'y', 'z'] as const).map((axis): ProductFact => ({
    schema_version: '1.0',
    id: `fact.${axis}`,
    source_id: 'source.drawing',
    field: `dimensions_mm.${axis}`,
    raw_label: axis,
    raw_value: axis === 'x' ? 485 : axis === 'y' ? 200 : 100,
    normalized_value: axis === 'x' ? 485 : axis === 'y' ? 200 : 100,
    normalized_unit: 'mm',
    extraction_method: 'manual',
    fact_state: 'verified',
  })),
  normalized_facts: (['x', 'y', 'z'] as const).map((axis): NormalizedProductFact => ({
    fact: {
      schema_version: '1.0',
      id: `fact.${axis}`,
      source_id: 'source.drawing',
      field: `dimensions_mm.${axis}`,
      raw_label: axis,
      raw_value: axis === 'x' ? 485 : axis === 'y' ? 200 : 100,
      normalized_value: axis === 'x' ? 485 : axis === 'y' ? 200 : 100,
      normalized_unit: 'mm',
      extraction_method: 'manual',
      fact_state: 'verified',
    },
    source: {
      schema_version: '1.0',
      id: 'source.drawing',
      uri: 'https://example.invalid/drawing',
      source_type: 'manufacturer_drawing',
      authority: 'manufacturer_technical',
      publisher: 'Example',
      retrieved_at: '2026-09-06T12:00:00.000Z',
    },
    canonical_field: `dimensions_mm.${axis}`,
    normalized_value: axis === 'x' ? 485 : axis === 'y' ? 200 : 100,
    normalized_unit: 'mm',
    dimension: 'length',
    source_authority: 'manufacturer_technical',
    target_kind: 'canonical',
  })),
  source_ids: ['source.drawing'],
});

describe('canonical amendment workflow', () => {
  it('adds only the approved dimensions without modifying unrelated fields', () => {
    const current = currentCanonical();
    const result = proposeCanonicalAmendment({
      current,
      candidate: candidateFor(current),
      review: review(),
    });

    expect(result.issues).toEqual([]);
    expect(result.status).toBe('proposed');
    expect(result.issues).toEqual([]);
    expect(result.proposal).toMatchObject({
      dimensions_mm: { x: 485, y: 200, z: 100 },
      id: 'victron-energy.pmp242200100',
      manufacturer: 'Victron Energy',
    });
    expect(result.proposal?.weight_kg).toBe(13);
    expect(result.proposal?.electrical).toMatchObject({
      nominal_voltage_v: 24,
    });
  });

  it('blocks a stale review when the canonical snapshot changed', async () => {
    const result = await writeCanonicalAmendment({
      current: currentCanonical(),
      candidate: candidateFor(currentCanonical()),
      review: review({ expected_snapshot: 'deadbeef' }),
      destinationRoot: process.cwd(),
      filename: 'stale-test.yaml',
      write: false,
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'canonical_snapshot_mismatch')).toBe(true);
  });

  it('requires explicit reviewed_at and review approval metadata', () => {
    const result = proposeCanonicalAmendment({
      current: currentCanonical(),
      candidate: candidateFor(currentCanonical()),
      review: review({ decision: 'rejected', reviewed_at: '' }),
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toContain('amendment_review_not_approved');
  });

  it('requires an explicit reviewed snapshot', () => {
    const result = proposeCanonicalAmendment({
      current: currentCanonical(),
      candidate: candidateFor(currentCanonical()),
      review: review({ expected_snapshot: undefined }),
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toContain(
      'amendment_missing_expected_snapshot',
    );
  });

  it('requires explicit approval and action consistency', () => {
    const current = currentCanonical();
    const unapprovedAction = proposeCanonicalAmendment({
      current,
      candidate: candidateFor(current),
      review: review({ approved_fields: [], field_actions: { 'dimensions_mm.x': 'add' } }),
    });
    const missingAction = proposeCanonicalAmendment({
      current,
      candidate: candidateFor(current),
      review: review({ approved_fields: ['dimensions_mm.x'], field_actions: {} }),
    });

    expect(unapprovedAction.issues.map((issue) => issue.code)).toContain(
      'amendment_action_without_approval',
    );
    expect(missingAction.issues.map((issue) => issue.code)).toContain('amendment_action_missing');
  });

  it('enforces add and replace field-state semantics', () => {
    const current = currentCanonical();
    const addExisting = proposeCanonicalAmendment({
      current,
      candidate: candidateFor(current),
      review: review({
        approved_fields: ['weight_kg'],
        field_actions: { weight_kg: 'add' },
        field_evidence: { weight_kg: ['fact.x'] },
      }),
    });
    const replaceMissing = proposeCanonicalAmendment({
      current,
      candidate: candidateFor(current),
      review: review({
        approved_fields: ['dimensions_mm.x'],
        field_actions: { 'dimensions_mm.x': 'replace' },
      }),
    });

    expect(addExisting.issues.map((issue) => issue.code)).toContain(
      'amendment_operation_state_mismatch',
    );
    expect(replaceMissing.issues.map((issue) => issue.code)).toContain(
      'amendment_operation_state_mismatch',
    );
  });

  it.each([
    'id',
    'manufacturer',
    'model',
    'part_number',
    'product_family',
    'product_role',
    'category',
    'verification_status',
  ])('protects identity and verification field %s', (field) => {
    const current = currentCanonical();
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        ...candidateFor(current),
        component_data: { ...candidateFor(current).component_data, [field]: 'changed' },
      },
      review: review({
        approved_fields: [field],
        field_actions: { [field]: 'replace' },
        field_evidence: { [field]: ['fact.x'] },
      }),
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toContain(
      field === 'verification_status'
        ? 'amendment_verification_status_prohibited'
        : 'amendment_identity_field_prohibited',
    );
  });

  it('requires field-level evidence and exposes a deterministic change summary', () => {
    const current = currentCanonical();
    const result = proposeCanonicalAmendment({
      current,
      candidate: { ...candidateFor(current), field_evidence: undefined },
      review: review({ field_evidence: undefined }),
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toContain('amendment_missing_field_evidence');

    const valid = proposeCanonicalAmendment({
      current,
      candidate: candidateFor(current),
      review: review(),
    });
    expect(
      valid.changes?.map((change) => [change.field, change.operation, change.fact_ids]),
    ).toEqual([
      ['dimensions_mm.x', 'add', ['fact.x']],
      ['dimensions_mm.y', 'add', ['fact.y']],
      ['dimensions_mm.z', 'add', ['fact.z']],
    ]);
    expect(valid.proposal?.amendment_history).toBeDefined();
    expect(valid.proposal?.source_refs).toEqual(current.source_refs);
    expect(valid.proposal?.verification_status).toBe(current.verification_status);
  });

  it('blocks unsupported removal independently', () => {
    const current = currentCanonical();
    const candidate = candidateFor(current);
    const result = proposeCanonicalAmendment({
      current,
      candidate,
      review: review({
        approved_fields: ['dimensions_mm.x'],
        field_actions: { 'dimensions_mm.x': 'remove' },
        field_evidence: { 'dimensions_mm.x': ['fact.x'] },
      }),
    });

    expect(result.issues.map((issue) => issue.code)).toEqual(['amendment_unsupported_operation']);
  });

  it.each(['unresolved', 'conflicting'] as const)('blocks %s evidence directly', (factState) => {
    const current = currentCanonical();
    const candidate = candidateFor(current);
    const evidenceState = {
      ...candidate,
      facts: candidate.facts?.map((fact) => ({ ...fact, fact_state: factState })),
    };
    const result = proposeCanonicalAmendment({
      current,
      candidate: evidenceState,
      review: review({
        approved_fields: ['dimensions_mm.x'],
        field_actions: { 'dimensions_mm.x': 'add' },
        field_evidence: { 'dimensions_mm.x': ['fact.x'] },
      }),
    });

    expect(result.issues.map((issue) => issue.code)).toEqual(['amendment_unresolved_evidence']);
  });

  it('accepts evidence normalized to the exact canonical field', () => {
    const current = currentCanonical();
    const candidate = candidateFor(current);
    const weightFact: ProductFact = {
      schema_version: '1.0',
      id: 'fact.weight',
      source_id: 'source.drawing',
      field: 'weight_kg',
      raw_label: 'weight',
      raw_value: 15,
      normalized_value: 15,
      normalized_unit: 'kg',
      extraction_method: 'manual',
      fact_state: 'verified',
    };
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        ...candidate,
        component_data: { ...candidate.component_data, weight_kg: 15 },
        facts: [...(candidate.facts ?? []), weightFact],
        normalized_facts: [
          ...(candidate.normalized_facts ?? []),
          {
            fact: weightFact,
            source: candidate.normalized_facts?.[0]?.source ?? {
              schema_version: '1.0',
              id: 'source.drawing',
              uri: 'https://example.invalid/drawing',
              source_type: 'manufacturer_drawing',
              authority: 'manufacturer_technical',
              publisher: 'Example',
              retrieved_at: '2026-09-06T12:00:00.000Z',
            },
            canonical_field: 'weight_kg',
            normalized_value: 15,
            normalized_unit: 'kg',
            dimension: 'mass',
            source_authority: 'manufacturer_technical',
            target_kind: 'canonical',
          },
        ],
      },
      review: review({
        approved_fields: ['weight_kg'],
        field_actions: { weight_kg: 'replace' },
        field_evidence: { weight_kg: ['fact.weight'] },
      }),
    });

    expect(result.issues).toEqual([]);
    expect(result.status).toBe('proposed');
  });

  it.each([
    ['unrelated verified fact', 'weight_kg', 'canonical'],
    ['another canonical field fact', 'dimensions_mm.y', 'canonical'],
    ['evidence-only target', 'dimensions_mm.x', 'evidence'],
  ] as const)('rejects %s as amendment evidence', (_label, canonicalField, targetKind) => {
    const current = currentCanonical();
    const candidate = candidateFor(current);
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        ...candidate,
        normalized_facts: candidate.normalized_facts?.map((fact) => ({
          ...fact,
          canonical_field: canonicalField,
          target_kind: targetKind,
        })),
      },
      review: review({
        approved_fields: ['dimensions_mm.x'],
        field_actions: { 'dimensions_mm.x': 'add' },
        field_evidence: { 'dimensions_mm.x': ['fact.x'] },
      }),
    });

    expect(result.issues.map((issue) => issue.code)).toContain('amendment_evidence_field_mismatch');
  });

  it.each(['__proto__.polluted', 'constructor.prototype.polluted', 'dimensions_mm..x'])(
    'rejects unsafe amendment path %s without modifying Object.prototype',
    (field) => {
      const current = currentCanonical();
      const candidate = candidateFor(current);
      const result = proposeCanonicalAmendment({
        current,
        candidate: {
          ...candidate,
          component_data: { ...candidate.component_data, [field]: 1 },
        },
        review: review({
          approved_fields: [field],
          field_actions: { [field]: 'add' },
          field_evidence: { [field]: ['fact.x'] },
        }),
      });

      expect(result.issues.map((issue) => issue.code)).toContain('amendment_unsafe_field_path');
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  it('writes only an existing matching target and blocks replay or disk races', async () => {
    const root = await mkdtemp(join(tmpdir(), 'canonical-amendment-'));
    const current = currentCanonical();
    const candidate = candidateFor(current);
    const target = join(root, 'victron-energy.pmp242200100.yaml');
    await writeFile(target, stringify(current), 'utf8');
    const baseRequest = {
      current,
      candidate,
      review: review(),
      destinationRoot: root,
      write: true,
    } as const;

    const first = await writeCanonicalAmendment(baseRequest);
    expect(first.status).toBe('written');
    const amended = parseYaml(await readFile(target, 'utf8')) as Record<string, unknown>;
    expect(amended.dimensions_mm).toEqual({ x: 485, y: 200, z: 100 });
    const replay = await writeCanonicalAmendment({
      ...baseRequest,
      current: amended,
      review: review({
        expected_snapshot: canonicalSerializedSnapshot(amended),
      }),
    });
    expect(replay.issues.map((issue) => issue.code)).toContain('amendment_already_applied');

    const staleRoot = await mkdtemp(join(tmpdir(), 'canonical-amendment-stale-'));
    const staleTarget = join(staleRoot, 'victron-energy.pmp242200100.yaml');
    await writeFile(staleTarget, stringify(current), 'utf8');
    const staleReview = review({ id: 'review.amendment.stale' });
    await writeFile(staleTarget, stringify({ ...current, weight_kg: 14 }), 'utf8');
    const stale = await writeCanonicalAmendment({
      ...baseRequest,
      destinationRoot: staleRoot,
      review: staleReview,
    });
    expect(stale.status).toBe('blocked');
    expect(stale.issues.map((issue) => issue.code)).toContain('canonical_snapshot_mismatch');
    await rm(staleRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it('blocks missing targets and filename violations without creating files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'canonical-amendment-missing-'));
    const current = currentCanonical();
    const request = {
      current,
      candidate: candidateFor(current),
      review: review(),
      destinationRoot: root,
      write: true,
    } as const;
    const missing = await writeCanonicalAmendment(request);
    const wrong = await writeCanonicalAmendment({ ...request, filename: 'wrong.json' });
    expect(missing.issues.map((issue) => issue.code)).toContain('amendment_target_missing');
    expect(wrong.issues.map((issue) => issue.code)).toContain('write_path_invalid');
    await rm(root, { recursive: true, force: true });
  });

  const failureFilesystem = (failRenameCalls: readonly number[]): CanonicalAmendmentFilesystem => {
    let renameCalls = 0;
    return {
      access: fsAccess,
      readFile: async (path, encoding) => readFile(path, encoding),
      mkdir,
      writeFile: async (path, data, options) => writeFile(path, data, options),
      rename: async (oldPath, newPath) => {
        renameCalls += 1;
        if (failRenameCalls.includes(renameCalls)) {
          throw new Error(`injected rename failure ${renameCalls}`);
        }
        await fsRename(oldPath, newPath);
      },
      rm,
    };
  };

  it('reports replacement failure after successful rollback and removes the backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'canonical-amendment-rollback-'));
    const current = currentCanonical();
    const target = join(root, 'victron-energy.pmp242200100.yaml');
    const original = stringify(current);
    await writeFile(target, original, 'utf8');

    const result = await writeCanonicalAmendment({
      current,
      candidate: candidateFor(current),
      review: review({ id: 'review.amendment.rollback-success' }),
      destinationRoot: root,
      write: true,
      filesystem: failureFilesystem([2]),
    });

    expect(result.status).toBe('blocked');
    expect(result.issues[0]?.code).toBe('write_failed');
    expect(await readFile(target, 'utf8')).toBe(original);
    expect((await readdir(root)).filter((entry) => entry.endsWith('.bak'))).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  it('preserves the backup when replacement and rollback both fail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'canonical-amendment-rollback-failure-'));
    const current = currentCanonical();
    const target = join(root, 'victron-energy.pmp242200100.yaml');
    await writeFile(target, stringify(current), 'utf8');

    const result = await writeCanonicalAmendment({
      current,
      candidate: candidateFor(current),
      review: review({ id: 'review.amendment.rollback-failure' }),
      destinationRoot: root,
      write: true,
      filesystem: failureFilesystem([2, 3]),
    });

    expect(result.status).toBe('blocked');
    expect(result.issues[0]?.code).toBe('write_failed');
    expect(result.issues[0]?.message).toContain('Backup preserved');
    const backups = (await readdir(root)).filter((entry) => entry.endsWith('.bak'));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(root, backups[0]), 'utf8')).toBe(stringify(current));
    expect(result.status).not.toBe('written');
    await rm(root, { recursive: true, force: true });
  });
});
