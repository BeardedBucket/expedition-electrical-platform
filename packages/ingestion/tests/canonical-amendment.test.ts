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

const syntheticTopologyComponent = (): Record<string, unknown> => ({
  id: 'synthetic.topology.component',
  manufacturer: 'Synthetic',
  model: 'Topology Fixture',
  category: 'other',
  verification_status: 'unverified',
});

const topologyFact = (
  id: string,
  kind:
    | 'capability'
    | 'port'
    | 'power_path'
    | 'connection_point'
    | 'conductive_relationship'
    | 'switching_configuration'
    | 'protection_instance'
    | 'measurement_instance'
    | 'interaction_endpoint'
    | 'physical_connector'
    | 'physical_connector_association',
  targetId: string,
): ProductFact => ({
  schema_version: '1.0',
  id,
  source_id: 'source.synthetic',
  field: 'topology',
  raw_label: `${kind} ${targetId}`,
  raw_value: targetId,
  extraction_method: 'manual',
  fact_state: 'verified',
  topology_target: { kind, id: targetId },
});

const topologyReviewFor = (
  current: Record<string, unknown>,
  topology_operations: CanonicalAmendmentReview['topology_operations'],
  overrides: Partial<CanonicalAmendmentReview> = {},
): CanonicalAmendmentReview => ({
  ...review({
    component_id: current.id as string,
    candidate_id: 'candidate.topology',
    expected_snapshot: canonicalSerializedSnapshot(current),
    approved_fields: [],
    field_actions: {},
    ...overrides,
  }),
  topology_operations,
});

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

  it('adds reviewed topology objects atomically by stable ID', () => {
    const current = syntheticTopologyComponent();
    const operations = [
      {
        operation: 'add' as const,
        kind: 'capability' as const,
        id: 'convert',
        value: { id: 'convert', type: 'inversion' },
        evidence: ['fact.capability'],
      },
      {
        operation: 'add' as const,
        kind: 'port' as const,
        id: 'input',
        value: { id: 'input', domain: 'dc', direction: 'input' },
        evidence: ['fact.input'],
      },
      {
        operation: 'add' as const,
        kind: 'port' as const,
        id: 'output',
        value: { id: 'output', domain: 'ac', direction: 'output' },
        evidence: ['fact.output'],
      },
      {
        operation: 'add' as const,
        kind: 'power_path' as const,
        id: 'conversion',
        value: {
          id: 'conversion',
          capability_id: 'convert',
          from_port: 'input',
          to_port: 'output',
        },
        evidence: ['fact.path'],
      },
    ];
    const facts = [
      topologyFact('fact.capability', 'capability', 'convert'),
      topologyFact('fact.input', 'port', 'input'),
      topologyFact('fact.output', 'port', 'output'),
      topologyFact('fact.path', 'power_path', 'conversion'),
    ];
    const result = proposeCanonicalAmendment({
      current,
      candidate: { facts, fact_ids: facts.map((fact) => fact.id) },
      review: {
        ...review({
          component_id: current.id as string,
          candidate_id: 'candidate.topology',
          expected_snapshot: canonicalSerializedSnapshot(current),
          approved_fields: [],
          field_actions: {},
        }),
        topology_operations: operations,
      },
    });

    expect(result.status).toBe('proposed');
    expect(result.proposal?.capabilities).toEqual([{ id: 'convert', type: 'inversion' }]);
    expect(result.proposal?.ports).toEqual([
      { id: 'input', domain: 'dc', direction: 'input' },
      { id: 'output', domain: 'ac', direction: 'output' },
    ]);
    expect(result.proposal?.power_paths).toEqual([
      {
        id: 'conversion',
        capability_id: 'convert',
        from_port: 'input',
        to_port: 'output',
      },
    ]);
    expect(result.proposal?.amendment_history).toMatchObject([
      {
        topology_operations: [
          { kind: 'capability', id: 'convert', fact_ids: ['fact.capability'] },
          { kind: 'port', id: 'input', fact_ids: ['fact.input'] },
          { kind: 'port', id: 'output', fact_ids: ['fact.output'] },
          { kind: 'power_path', id: 'conversion', fact_ids: ['fact.path'] },
        ],
      },
    ]);
  });

  it('rejects duplicate IDs, mismatched evidence, missing evidence, index identities, and invalid references', () => {
    const current = {
      ...syntheticTopologyComponent(),
      capabilities: [{ id: 'convert', type: 'inversion' }],
    };
    const fact = topologyFact('fact.port', 'port', 'input');
    const baseReview = {
      ...review({
        component_id: current.id as string,
        candidate_id: 'candidate.topology',
        expected_snapshot: canonicalSerializedSnapshot(current),
        approved_fields: [],
        field_actions: {},
      }),
      topology_operations: [
        {
          operation: 'add' as const,
          kind: 'port' as const,
          id: 'input',
          value: { id: 'input', domain: 'dc', direction: 'input' },
          evidence: ['fact.port'],
        },
      ],
    };
    const candidate = { facts: [fact], fact_ids: [fact.id] };
    expect(
      proposeCanonicalAmendment({
        current,
        candidate,
        review: {
          ...baseReview,
          topology_operations: [
            {
              ...baseReview.topology_operations[0],
              kind: 'capability',
              id: 'convert',
              value: { id: 'convert', type: 'inversion' },
            },
          ],
        },
      }).issues.map((item) => item.code),
    ).toContain('amendment_topology_duplicate_id');
    expect(
      proposeCanonicalAmendment({
        current,
        candidate,
        review: {
          ...baseReview,
          topology_operations: [
            {
              ...baseReview.topology_operations[0],
              id: 'input[0]',
              value: { id: 'input[0]', domain: 'dc', direction: 'input' },
            },
          ],
        },
      }).issues.map((item) => item.code),
    ).toContain('amendment_topology_invalid_id');
    expect(
      proposeCanonicalAmendment({
        current,
        candidate,
        review: {
          ...baseReview,
          topology_operations: [
            {
              ...baseReview.topology_operations[0],
              kind: 'capability',
              value: { id: 'input', type: 'inversion' },
            },
          ],
        },
      }).issues.map((item) => item.code),
    ).toContain('amendment_topology_evidence_mismatch');
  });

  it('requires topology evidence and rejects invalid final path topology without writing', async () => {
    const current = syntheticTopologyComponent();
    const capability = topologyFact('fact.capability', 'capability', 'convert');
    const missingEvidence = proposeCanonicalAmendment({
      current,
      candidate: { facts: [capability], fact_ids: [capability.id] },
      review: {
        ...review({
          component_id: current.id as string,
          candidate_id: 'candidate.topology',
          expected_snapshot: canonicalSerializedSnapshot(current),
          approved_fields: [],
          field_actions: {},
        }),
        topology_operations: [
          {
            operation: 'add',
            kind: 'capability',
            id: 'convert',
            value: { id: 'convert', type: 'inversion' },
          },
        ],
      },
    });

    expect(missingEvidence.issues.map((item) => item.code)).toContain(
      'amendment_topology_missing_evidence',
    );

    const facts = [
      capability,
      topologyFact('fact.input', 'port', 'input'),
      topologyFact('fact.output', 'port', 'output'),
      topologyFact('fact.path', 'power_path', 'conversion'),
    ];
    const invalidPath = proposeCanonicalAmendment({
      current,
      candidate: { facts, fact_ids: facts.map((fact) => fact.id) },
      review: {
        ...review({
          component_id: current.id as string,
          candidate_id: 'candidate.topology',
          expected_snapshot: canonicalSerializedSnapshot(current),
          approved_fields: [],
          field_actions: {},
        }),
        topology_operations: [
          {
            operation: 'add',
            kind: 'capability',
            id: 'convert',
            value: { id: 'convert', type: 'inversion' },
            evidence: ['fact.capability'],
          },
          {
            operation: 'add',
            kind: 'port',
            id: 'input',
            value: { id: 'input', domain: 'dc', direction: 'input' },
            evidence: ['fact.input'],
          },
          {
            operation: 'add',
            kind: 'power_path',
            id: 'conversion',
            value: {
              id: 'conversion',
              capability_id: 'convert',
              from_port: 'input',
              to_port: 'missing',
            },
            evidence: ['fact.path'],
          },
        ],
      },
    });
    expect(invalidPath.status).toBe('blocked');
    expect(invalidPath.issues.map((item) => item.code)).toContain(
      'amendment_topology_invalid_reference',
    );
    expect(invalidPath.status).toBe('blocked');

    const root = await mkdtemp(join(tmpdir(), 'canonical-topology-dry-run-'));
    const target = join(root, 'synthetic.topology.component.yaml');
    await writeFile(target, stringify(current), 'utf8');
    const dryRun = await writeCanonicalAmendment({
      current,
      candidate: {
        facts: [capability],
        fact_ids: [capability.id],
      },
      review: {
        ...review({
          component_id: current.id as string,
          candidate_id: 'candidate.topology',
          expected_snapshot: canonicalSerializedSnapshot(current),
          approved_fields: [],
          field_actions: {},
        }),
        topology_operations: [
          {
            operation: 'add',
            kind: 'capability',
            id: 'convert',
            value: { id: 'convert', type: 'inversion' },
            evidence: ['fact.capability'],
          },
        ],
      },
      destinationRoot: root,
      write: false,
    });
    expect(dryRun.status).toBe('dry_run');
    expect(parseYaml(await readFile(target, 'utf8'))).toEqual(current);
    await rm(root, { recursive: true, force: true });
  });

  it('adds a reviewed switching configuration without duplicating connectivity', () => {
    const current = {
      ...syntheticTopologyComponent(),
      ports: [
        { id: 'input', domain: 'dc', direction: 'bidirectional' },
        { id: 'output', domain: 'dc', direction: 'bidirectional' },
      ],
      conductive_relationships: [
        {
          id: 'contact',
          participants: [
            { kind: 'port', id: 'input' },
            { kind: 'port', id: 'output' },
          ],
        },
      ],
      switching: {
        controlled_relationship_ids: ['contact'],
        configurations: [{ id: 'configuration-a', active_relationship_ids: [] }],
      },
    };
    const switching = topologyFact('fact.switching', 'switching_configuration', 'configuration-b');
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        fact_ids: ['fact.switching'],
        facts: [switching],
        topology_evidence: {
          'switching_configuration:configuration-b': ['fact.switching'],
        },
      },
      review: topologyReviewFor(current, [
        {
          operation: 'add',
          kind: 'switching_configuration',
          id: 'configuration-b',
          value: { id: 'configuration-b', active_relationship_ids: ['contact'] },
          evidence: ['fact.switching'],
        },
      ]),
    });

    expect(result.status).toBe('proposed');
    expect(result.proposal?.switching).toMatchObject({
      controlled_relationship_ids: ['contact'],
      configurations: [
        { id: 'configuration-a', active_relationship_ids: [] },
        { id: 'configuration-b', active_relationship_ids: ['contact'] },
      ],
    });
  });

  it('adds a reviewed protection instance with a stable topology target', () => {
    const current = {
      ...syntheticTopologyComponent(),
      ports: [
        { id: 'input', domain: 'dc', direction: 'bidirectional' },
        { id: 'output', domain: 'dc', direction: 'bidirectional' },
      ],
      conductive_relationships: [
        {
          id: 'inline',
          participants: [
            { kind: 'port', id: 'input' },
            { kind: 'port', id: 'output' },
          ],
        },
      ],
    };
    const protection = topologyFact('fact.protection', 'protection_instance', 'branch-fuse');
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        fact_ids: ['fact.protection'],
        facts: [protection],
        topology_evidence: {
          'protection_instance:branch-fuse': ['fact.protection'],
        },
      },
      review: topologyReviewFor(current, [
        {
          operation: 'add',
          kind: 'protection_instance',
          id: 'branch-fuse',
          value: {
            id: 'branch-fuse',
            application: 'external_circuit',
            function: 'overcurrent',
            target: { kind: 'conductive_relationship', id: 'inline' },
          },
          evidence: ['fact.protection'],
        },
      ]),
    });

    expect(result.status).toBe('proposed');
    expect(result.proposal?.protection).toEqual({
      instances: [
        {
          id: 'branch-fuse',
          application: 'external_circuit',
          function: 'overcurrent',
          target: { kind: 'conductive_relationship', id: 'inline' },
        },
      ],
    });
  });

  it('adds a reviewed measurement instance with a stable topology target', () => {
    const current = {
      ...syntheticTopologyComponent(),
      ports: [
        { id: 'input', domain: 'dc', direction: 'bidirectional' },
        { id: 'output', domain: 'dc', direction: 'bidirectional' },
      ],
      conductive_relationships: [
        {
          id: 'shunt-path',
          participants: [
            { kind: 'port', id: 'input' },
            { kind: 'port', id: 'output' },
          ],
        },
      ],
    };
    const measurement = topologyFact('fact.measurement', 'measurement_instance', 'path-current');
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        fact_ids: ['fact.measurement'],
        facts: [measurement],
        topology_evidence: {
          'measurement_instance:path-current': ['fact.measurement'],
        },
      },
      review: topologyReviewFor(current, [
        {
          operation: 'add',
          kind: 'measurement_instance',
          id: 'path-current',
          value: {
            id: 'path-current',
            quantity: 'current',
            target: { kind: 'conductive_relationship', id: 'shunt-path' },
          },
          evidence: ['fact.measurement'],
        },
      ]),
    });

    expect(result.status).toBe('proposed');
    expect(result.proposal?.measurement).toEqual({
      instances: [
        {
          id: 'path-current',
          quantity: 'current',
          target: { kind: 'conductive_relationship', id: 'shunt-path' },
        },
      ],
    });
  });

  it.each(['expected_snapshot', 'expected_current_snapshot'] as const)(
    'rejects a topology amendment with a stale %s',
    (snapshotField) => {
      const current = syntheticTopologyComponent();
      const fact = topologyFact('fact.capability', 'capability', 'convert');
      const result = proposeCanonicalAmendment({
        current,
        candidate: { facts: [fact], fact_ids: [fact.id] },
        review: topologyReviewFor(
          current,
          [
            {
              operation: 'add',
              kind: 'capability',
              id: 'convert',
              value: { id: 'convert', type: 'inversion' },
              evidence: [fact.id],
            },
          ],
          snapshotField === 'expected_snapshot'
            ? { expected_snapshot: 'sha256:stale', expected_current_snapshot: undefined }
            : { expected_snapshot: undefined, expected_current_snapshot: 'sha256:stale' },
        ),
      });

      expect(result.status).toBe('blocked');
      expect(result.issues.map((item) => item.code)).toContain('canonical_snapshot_mismatch');
    },
  );

  it('promotes a reviewed interaction endpoint without creating compatibility semantics', () => {
    const current = syntheticTopologyComponent();
    const endpoint = topologyFact('fact.endpoint', 'interaction_endpoint', 'bms-link');
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        facts: [endpoint],
        fact_ids: [endpoint.id],
        topology_evidence: { 'interaction_endpoint:bms-link': [endpoint.id] },
      },
      review: topologyReviewFor(current, [
        {
          operation: 'add',
          kind: 'interaction_endpoint',
          id: 'bms-link',
          value: { id: 'bms-link', kind: 'communication' },
          evidence: [endpoint.id],
        },
      ]),
    });

    expect(result.status).toBe('proposed');
    expect(result.proposal?.interaction_endpoints).toEqual([
      { id: 'bms-link', kind: 'communication' },
    ]);
  });

  it('promotes reviewed physical connector instances through stable topology targets', () => {
    const current = syntheticTopologyComponent();
    const connector = topologyFact('fact.connector', 'physical_connector', 'can-1');
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        facts: [connector],
        fact_ids: [connector.id],
        topology_evidence: { 'physical_connector:can-1': [connector.id] },
      },
      review: topologyReviewFor(current, [
        {
          operation: 'add',
          kind: 'physical_connector',
          id: 'can-1',
          value: { id: 'can-1', type: 'source-backed description' },
          evidence: [connector.id],
        },
      ]),
    });

    expect(result.status).toBe('proposed');
    expect(result.proposal?.physical_connectors).toEqual([
      { id: 'can-1', type: 'source-backed description' },
    ]);
  });

  it('promotes connector associations independently and records stable history', () => {
    const current = {
      ...syntheticTopologyComponent(),
      physical_connectors: [{ id: 'can-1' }],
      interaction_endpoints: [{ id: 'can', kind: 'communication' }],
    };
    const association = topologyFact(
      'fact.association',
      'physical_connector_association',
      'can-1-to-can',
    );
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        facts: [association],
        fact_ids: [association.id],
        topology_evidence: {
          'physical_connector_association:can-1-to-can': [association.id],
        },
      },
      review: topologyReviewFor(current, [
        {
          operation: 'add',
          kind: 'physical_connector_association',
          id: 'can-1-to-can',
          value: {
            id: 'can-1-to-can',
            connector_id: 'can-1',
            target: { kind: 'interaction_endpoint', id: 'can' },
          },
          evidence: [association.id],
        },
      ]),
    });

    expect(result.status).toBe('proposed');
    expect(result.proposal?.physical_connector_associations).toEqual([
      {
        id: 'can-1-to-can',
        connector_id: 'can-1',
        target: { kind: 'interaction_endpoint', id: 'can' },
      },
    ]);
    expect(result.topology_changes).toEqual([
      expect.objectContaining({
        kind: 'physical_connector_association',
        id: 'can-1-to-can',
        fact_ids: [association.id],
      }),
    ]);
  });

  it.each([
    [
      'missing connector',
      { connector_id: 'missing', target: { kind: 'interaction_endpoint', id: 'can' } },
    ],
    [
      'missing endpoint',
      { connector_id: 'can-1', target: { kind: 'interaction_endpoint', id: 'missing' } },
    ],
  ])('rejects association with %s', (_label, value) => {
    const current = {
      ...syntheticTopologyComponent(),
      physical_connectors: [{ id: 'can-1' }],
      interaction_endpoints: [{ id: 'can', kind: 'communication' }],
    };
    const association = topologyFact(
      'fact.invalid-association',
      'physical_connector_association',
      'bad',
    );
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        facts: [association],
        fact_ids: [association.id],
        topology_evidence: { 'physical_connector_association:bad': [association.id] },
      },
      review: topologyReviewFor(current, [
        {
          operation: 'add',
          kind: 'physical_connector_association',
          id: 'bad',
          value: { id: 'bad', ...value },
          evidence: [association.id],
        },
      ]),
    });
    expect(result.status).toBe('blocked');
    expect(result.issues.map((item) => item.code)).toContain(
      'amendment_topology_invalid_reference',
    );
  });

  it('protects a successfully written topology amendment from replay', async () => {
    const current = syntheticTopologyComponent();
    const fact = topologyFact('fact.capability', 'capability', 'convert');
    const root = await mkdtemp(join(tmpdir(), 'canonical-topology-replay-'));
    const target = join(root, `${current.id}.yaml`);
    await writeFile(target, stringify(current), 'utf8');
    const request = {
      current,
      candidate: { facts: [fact], fact_ids: [fact.id] },
      review: topologyReviewFor(current, [
        {
          operation: 'add',
          kind: 'capability',
          id: 'convert',
          value: { id: 'convert', type: 'inversion' },
          evidence: [fact.id],
        },
      ]),
      destinationRoot: root,
      write: true,
    } as const;

    const first = await writeCanonicalAmendment(request);
    const amended = parseYaml(await readFile(target, 'utf8')) as Record<string, unknown>;
    const replay = await writeCanonicalAmendment({
      ...request,
      current: amended,
      review: topologyReviewFor(amended, request.review.topology_operations, {
        expected_snapshot: canonicalSerializedSnapshot(amended),
      }),
    });

    expect(first.status).toBe('written');
    expect(replay.issues.map((item) => item.code)).toContain('amendment_already_applied');
    await rm(root, { recursive: true, force: true });
  });

  it('does not partially write an invalid multi-operation topology amendment', async () => {
    const current = syntheticTopologyComponent();
    const facts = [
      topologyFact('fact.capability', 'capability', 'convert'),
      topologyFact('fact.input', 'port', 'input'),
      topologyFact('fact.path', 'power_path', 'conversion'),
    ];
    const root = await mkdtemp(join(tmpdir(), 'canonical-topology-atomicity-'));
    const target = join(root, `${current.id}.yaml`);
    const original = stringify(current);
    await writeFile(target, original, 'utf8');
    const result = await writeCanonicalAmendment({
      current,
      candidate: { facts, fact_ids: facts.map((fact) => fact.id) },
      review: topologyReviewFor(current, [
        {
          operation: 'add',
          kind: 'capability',
          id: 'convert',
          value: { id: 'convert', type: 'inversion' },
          evidence: ['fact.capability'],
        },
        {
          operation: 'add',
          kind: 'port',
          id: 'input',
          value: { id: 'input', domain: 'dc', direction: 'input' },
          evidence: ['fact.input'],
        },
        {
          operation: 'add',
          kind: 'power_path',
          id: 'conversion',
          value: {
            id: 'conversion',
            capability_id: 'convert',
            from_port: 'input',
            to_port: 'unknown',
          },
          evidence: ['fact.path'],
        },
      ]),
      destinationRoot: root,
      write: true,
    });

    expect(result.status).toBe('blocked');
    expect(await readFile(target, 'utf8')).toBe(original);
    await rm(root, { recursive: true, force: true });
  });

  it('resolves topology by stable IDs independently of collection order while preserving snapshots', () => {
    const current = {
      ...syntheticTopologyComponent(),
      capabilities: [
        { id: 'first', type: 'inversion' },
        { id: 'second', type: 'charging' },
      ],
      ports: [
        { id: 'input', domain: 'dc', direction: 'input' },
        { id: 'output', domain: 'ac', direction: 'output' },
      ],
      power_paths: [
        {
          id: 'path',
          capability_id: 'first',
          from_port: 'input',
          to_port: 'output',
        },
      ],
    };
    const reordered = {
      ...current,
      capabilities: [...(current.capabilities ?? [])].reverse(),
      ports: [...(current.ports ?? [])].reverse(),
      power_paths: [...(current.power_paths ?? [])].reverse(),
    };
    const fact = topologyFact('fact.third', 'capability', 'third');
    const operation = {
      operation: 'add' as const,
      kind: 'capability' as const,
      id: 'third',
      value: { id: 'third', type: 'monitoring' },
      evidence: [fact.id],
    };

    const stale = proposeCanonicalAmendment({
      current: reordered,
      candidate: { facts: [fact], fact_ids: [fact.id] },
      review: topologyReviewFor(reordered, [operation], {
        expected_snapshot: canonicalSerializedSnapshot(current),
      }),
    });
    const valid = proposeCanonicalAmendment({
      current: reordered,
      candidate: { facts: [fact], fact_ids: [fact.id] },
      review: topologyReviewFor(reordered, [operation]),
    });

    expect(stale.issues.map((item) => item.code)).toContain('canonical_snapshot_mismatch');
    expect(valid.status).toBe('proposed');
    expect(valid.proposal?.capabilities).toEqual([
      { id: 'second', type: 'charging' },
      { id: 'first', type: 'inversion' },
      { id: 'third', type: 'monitoring' },
    ]);
  });

  it.each([
    {
      label: 'capability',
      operation: {
        operation: 'add' as const,
        kind: 'capability' as const,
        id: 'convert',
        value: { id: 'convert', type: 'inversion' },
      },
      fact: topologyFact('fact.capability', 'capability', 'convert'),
      collection: 'capabilities',
    },
    {
      label: 'port',
      operation: {
        operation: 'add' as const,
        kind: 'port' as const,
        id: 'input',
        value: { id: 'input', domain: 'dc', direction: 'input' },
      },
      fact: topologyFact('fact.input', 'port', 'input'),
      collection: 'ports',
    },
    {
      label: 'power path',
      operation: {
        operation: 'add' as const,
        kind: 'power_path' as const,
        id: 'path',
        value: {
          id: 'path',
          capability_id: 'convert',
          from_port: 'input',
          to_port: 'output',
        },
      },
      fact: topologyFact('fact.path', 'power_path', 'path'),
      collection: 'power_paths',
    },
  ])(
    'preserves absent collections when adding the first $label',
    ({ operation, fact, collection }) => {
      const current =
        operation.kind === 'power_path'
          ? {
              ...syntheticTopologyComponent(),
              capabilities: [{ id: 'convert', type: 'inversion' }],
              ports: [
                { id: 'input', domain: 'dc', direction: 'input' },
                { id: 'output', domain: 'ac', direction: 'output' },
              ],
            }
          : syntheticTopologyComponent();
      const result = proposeCanonicalAmendment({
        current,
        candidate: { facts: [fact], fact_ids: [fact.id] },
        review: topologyReviewFor(current, [{ ...operation, evidence: [fact.id] }]),
      });

      expect(result.status).toBe('proposed');
      expect(result.proposal?.[collection]).toEqual([operation.value]);
      for (const other of ['capabilities', 'ports', 'power_paths']) {
        if (other !== collection && !(other in current))
          expect(result.proposal?.[other]).toBeUndefined();
      }
    },
  );

  it('keeps proposal dry-run and controlled write boundaries distinct for topology', async () => {
    const current = syntheticTopologyComponent();
    const fact = topologyFact('fact.capability', 'capability', 'convert');
    const request = {
      current,
      candidate: { facts: [fact], fact_ids: [fact.id] },
      review: topologyReviewFor(current, [
        {
          operation: 'add',
          kind: 'capability',
          id: 'convert',
          value: { id: 'convert', type: 'inversion' },
          evidence: [fact.id],
        },
      ]),
    } as const;
    const proposal = proposeCanonicalAmendment(request);
    const root = await mkdtemp(join(tmpdir(), 'canonical-topology-write-boundary-'));
    const target = join(root, `${current.id}.yaml`);
    await writeFile(target, stringify(current), 'utf8');
    const dryRun = await writeCanonicalAmendment({
      ...request,
      destinationRoot: root,
      write: false,
    });
    const afterDryRun = await readFile(target, 'utf8');
    const written = await writeCanonicalAmendment({
      ...request,
      destinationRoot: root,
      write: true,
    });

    expect(proposal.status).toBe('proposed');
    expect(afterDryRun).toBe(stringify(current));
    expect(dryRun.status).toBe('dry_run');
    expect(written.status).toBe('written');
    expect(parseYaml(await readFile(target, 'utf8'))).toMatchObject({
      capabilities: [{ id: 'convert', type: 'inversion' }],
    });
    await rm(root, { recursive: true, force: true });
  });

  it('cross-validates operation, review, and candidate topology evidence representations', () => {
    const current = syntheticTopologyComponent();
    const first = topologyFact('fact.first', 'capability', 'convert');
    const second = topologyFact('fact.second', 'capability', 'convert');
    const result = proposeCanonicalAmendment({
      current,
      candidate: {
        facts: [first, second],
        fact_ids: [first.id, second.id],
        topology_evidence: { 'capability:convert': [second.id] },
      },
      review: topologyReviewFor(
        current,
        [
          {
            operation: 'add',
            kind: 'capability',
            id: 'convert',
            value: { id: 'convert', type: 'inversion' },
            evidence: [first.id],
          },
        ],
        { topology_evidence: { 'capability:convert': [first.id] } },
      ),
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((item) => item.code)).toContain(
      'amendment_topology_evidence_conflict',
    );
  });
});
