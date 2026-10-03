import { describe, expect, it } from 'vitest';
import {
  artifactReference,
  buildQualifiedFactArtifact,
  buildProductionSemanticProposals,
  buildProductionProductCandidate,
  buildProductionReviewPackage,
  reconcileQualifiedFactsForWholeIntake,
  productionApprovalToPromotionReview,
  promoteProductionCandidate,
  reviewPackageSnapshot,
  canonicalProposalSchemaValid,
  serializeCanonicalComponent,
  writeCanonicalComponent,
  promotionCandidateSnapshot,
  validateProductCandidate,
  validateProductionApproval,
  type CanonicalQualifiedValue,
  type ProductIntake,
  type SourceCaptureArtifact,
  type SourceAcquisitionArtifact,
  type ProductionApproval,
  type JsonObject,
} from '../src/index.js';
import { parseContextualMeasurement, isCanonicalQualifiedValue } from '../src/qualified-values.js';
import {
  canonicalSerializedSnapshot,
  proposeCanonicalAmendment,
  writeCanonicalAmendment,
  type CanonicalAmendmentReview,
  type CanonicalAmendmentCandidate,
  type CanonicalQualifiedValueOperation,
} from '../src/canonical-amendment.js';
import componentSchema from '../../../data/schemas/component.schema.json';
import factSchema from '../../../data/schemas/product-fact.schema.json';
import productionSchema from '../../../data/schemas/production-ingestion.schema.json';

const rangeTarget = 'electrical.input_voltage_range_v';
const dimensionsTarget = 'dimensions_mm';
const dimensionsLabel = 'Outer dimensions (h x w x d)';
const realDimensions =
  '124 x 187 x 29.8 mm | 4.88 x 7.36 x 1.17 in (without connectors and mounting accessories)';
const intake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'intake.synthetic',
  manufacturer: 'Synthetic',
  product_model: 'Model',
  manufacturer_part_number: 'INTAKE-ONLY',
  official_product_uri: 'https://example.invalid/model',
};
const capture: SourceCaptureArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_capture',
  id: 'capture.synthetic',
  requested_uri: 'https://example.invalid/model',
  retrieved_at: '2026-09-28T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'not_retained',
  source_provenance: { publisher: 'Synthetic' },
};
const acquisition: SourceAcquisitionArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_acquisition',
  id: 'acquisition.synthetic',
  intake: artifactReference('product_intake', intake),
  seed_capture: artifactReference('source_capture', capture),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: `sha256:${'a'.repeat(64)}`,
};
const setup = (
  rows: readonly (readonly [string, string, string?])[] = [
    ['Supply voltage', '8–70 VDC'],
    [dimensionsLabel, realDimensions],
  ],
  multiSource = false,
) => {
  const captures = multiSource
    ? [capture, { ...capture, id: 'capture.other', requested_uri: 'https://example.invalid/other' }]
    : [capture];
  const acquisitions = captures.map((source, index) => ({
    ...acquisition,
    id: `${acquisition.id}.${index}`,
    seed_capture: artifactReference('source_capture', source),
  }));
  const facts = rows.map(([label, raw, unit], index) =>
    buildQualifiedFactArtifact({
      source_capture: artifactReference('source_capture', captures[index % captures.length]),
      source_acquisition: artifactReference(
        'source_acquisition',
        acquisitions[index % acquisitions.length],
      ),
      metadata: {
        source_wording: label,
        source_label: label,
        raw_value: raw,
        ...(unit ? { source_unit: unit } : {}),
        applicability: { kind: 'exact_product', value: 'Model' },
      },
      qualification_state: 'structurally_supported',
    }),
  );
  const reconciliation = reconcileQualifiedFactsForWholeIntake({
    facts,
    source_acquisitions: acquisitions,
  });
  const proposals = buildProductionSemanticProposals({
    facts,
    source_acquisitions: acquisitions,
    reconciliation,
  });
  const bridge = buildProductionProductCandidate({
    intake,
    captures,
    source_acquisitions: acquisitions,
    facts,
    reconciliation,
    proposals,
  });
  const reviewPackage = buildProductionReviewPackage({ intake, reconciliation, bridge });
  const assertions = (bridge.candidate?.component_data.qualified_values ??
    []) as CanonicalQualifiedValue[];
  const approval: ProductionApproval = {
    schema_version: '1.0',
    artifact_kind: 'approval',
    id: 'approval.synthetic',
    review_package: artifactReference('review_package', reviewPackage),
    review_package_snapshot: reviewPackageSnapshot(reviewPackage),
    semantic_snapshot: reviewPackage.semantic_snapshot,
    reviewer_id: 'reviewer.human',
    reviewed_at: '2026-09-28T00:01:00Z',
    decision: 'approved',
    promotion_decisions: {
      approved_fields: [],
      approved_qualified_value_ids: assertions.map((a) => a.id),
      evidence_acknowledged: true,
      product_role: 'monitor',
      category: 'monitor',
    },
  };
  return { bridge, reconciliation, reviewPackage, approval, assertions };
};
const canonical = (): JsonObject => {
  const state = setup();
  const result = promoteProductionCandidate(
    state.approval,
    state.reviewPackage,
    state.bridge,
  ).result;
  expect(result.status).toBe('success');
  return result.proposal!;
};
const amendment = (operation: 'add' | 'replace' = 'replace', dimension = false) => {
  const current = canonical();
  const target = dimension ? dimensionsTarget : rangeTarget;
  const existing = (current.qualified_values as CanonicalQualifiedValue[]).find(
    (a) => a.target === target,
  )!;
  const state = setup(
    dimension
      ? [[dimensionsLabel, '125 x 188 x 30 mm (without connectors)']]
      : [['Supply voltage', '9–72 VAC']],
  );
  const value = {
    ...state.assertions[0],
    id: operation === 'replace' ? existing.id : 'qualified-value.new',
  } as CanonicalQualifiedValue;
  const ids = state.bridge.candidate!.qualified_value_evidence![state.assertions[0].id];
  const candidate: CanonicalAmendmentCandidate = {
    component_data: { qualified_values: [value] },
    qualified_value_evidence: { [value.id]: ids },
    facts: state.bridge.facts,
    fact_ids: state.bridge.facts.map((fact) => fact.id),
    source_ids: state.bridge.sources.map((source) => source.id),
    normalized_facts: state.bridge.normalized_facts,
  };
  const review: CanonicalAmendmentReview = {
    schema_version: '1.0',
    id: 'review.amendment.synthetic',
    candidate_id: state.bridge.candidate!.id,
    component_id: String(current.id),
    expected_snapshot: canonicalSerializedSnapshot(current),
    decision: 'approved',
    reviewer_id: 'reviewer.human',
    reviewed_at: '2026-09-28T00:02:00Z',
    approved_fields: [],
    evidence_acknowledged: true,
    product_role: 'monitor',
    category: 'monitor',
    rationale: 'Synthetic lifecycle acceptance',
    qualified_value_operations: [{ operation, id: value.id, value, evidence: ids }],
    qualified_value_evidence: { [value.id]: ids },
  };
  return { current, candidate, review, value, ids, existing };
};

describe('canonical qualified-value pipeline', () => {
  it('derives identical qualified IDs from reordered repeated semantic evidence', () => {
    const rows = [
      ['Supply voltage', '8–70 VDC'],
      ['Supply voltage', '8–70 V DC'],
    ] as const;
    expect(setup(rows).assertions.map((a) => a.id)).toEqual(
      setup([...rows].reverse()).assertions.map((a) => a.id),
    );
  });
  it.each(['value', 'target', 'qualifiers', 'id', 'evidence'])(
    'rejects post-package %s mutation',
    (kind) => {
      const state = setup();
      const candidate = structuredClone(state.bridge.candidate!);
      const assertion = (candidate.component_data.qualified_values as CanonicalQualifiedValue[])[0];
      if (kind === 'value') assertion.value = { min: 9, max: 71 };
      if (kind === 'target')
        assertion.target =
          assertion.target === 'dimensions_mm'
            ? 'electrical.input_voltage_range_v'
            : 'dimensions_mm';
      if (kind === 'qualifiers') assertion.qualifiers = { electrical_domain: 'ac' };
      if (kind === 'id') assertion.id = 'changed.id';
      if (kind === 'evidence')
        candidate.qualified_value_evidence = { [assertion.id]: ['other.fact'] };
      expect(() =>
        productionApprovalToPromotionReview(state.approval, state.reviewPackage, {
          ...state.bridge,
          candidate,
        }),
      ).toThrow();
    },
  );
  it.each(['excluded_fact_ids', 'reviewed_evidence_fact_ids'] as const)(
    'rejects qualified approval using %s',
    (key) => {
      const state = setup();
      state.approval.promotion_decisions = {
        ...state.approval.promotion_decisions!,
        [key]: state.bridge.candidate!.qualified_value_evidence![state.assertions[0].id],
      };
      expect(() =>
        productionApprovalToPromotionReview(state.approval, state.reviewPackage, state.bridge),
      ).toThrow();
    },
  );

  it('keeps qualified provenance local to each producing source', () => {
    const state = setup(
      [
        ['Supply voltage', '8–70 VDC'],
        ['Supply voltage', '8–70 V DC'],
      ],
      true,
    );
    const result = promoteProductionCandidate(
      state.approval,
      state.reviewPackage,
      state.bridge,
    ).result;
    expect(result.status).toBe('success');
    const refs = result.proposal!.source_refs as JsonObject[];
    expect(refs).toHaveLength(2);
    for (const ref of refs) {
      const localIds = state.bridge.facts
        .filter((fact) => fact.source_id === ref.id)
        .map((fact) => fact.id)
        .sort();
      expect(
        Object.values(ref.qualified_value_evidence as JsonObject)
          .flat()
          .sort(),
      ).toEqual(localIds);
      expect(ref.fact_ids).toEqual(localIds);
    }
    expect(Object.values(result.audit!.qualified_value_evidence!).flat()).toHaveLength(2);
  });
  it('keeps persisted assertion schemas aligned', () => {
    expect(factSchema.$defs.canonicalQualifiedValue).toEqual(
      componentSchema.$defs.canonicalQualifiedValue,
    );
    expect(productionSchema.$defs.canonicalQualifiedValue).toEqual(
      componentSchema.$defs.canonicalQualifiedValue,
    );
  });
  it.each(['8–70 VDC', '8–70 V DC', '8–70 V dc'])('preserves explicit DC: %s', (raw) => {
    const state = setup([['Supply voltage', raw]]);
    expect(state.assertions[0]).toMatchObject({
      target: rangeTarget,
      value: { min: 8, max: 70 },
      qualifiers: { electrical_domain: 'dc' },
    });
    expect(state.bridge.candidate!.component_data.electrical).toBeUndefined();
  });
  it.each(['100–240 VAC', '100–240 V AC'])('preserves explicit AC: %s', (raw) => {
    expect(setup([['Supply voltage', raw]]).assertions[0].qualifiers).toEqual({
      electrical_domain: 'ac',
    });
  });
  it('keeps plain V and dimensions on the direct path without inventing context', () => {
    const state = setup([
      ['Supply voltage', '8–70 V'],
      [dimensionsLabel, '120 x 180 x 30 mm'],
    ]);
    expect(state.assertions).toEqual([]);
    expect(state.bridge.candidate!.component_data).toEqual({
      electrical: { input_voltage_range_v: { min: 8, max: 70 } },
      dimensions_mm: { x: 180, y: 30, z: 120 },
    });
  });
  it.each([
    'without connectors',
    'excluding connectors',
    'without mounting accessories',
    'excluding mounting accessories',
    'without connectors and mounting accessories',
    'excluding mounting accessories and connectors',
  ])('retains physical exclusions: %s', (phrase) => {
    const state = setup([[dimensionsLabel, `120 x 180 x 30 mm (${phrase})`]]);
    expect(state.assertions[0]).toMatchObject({
      target: dimensionsTarget,
      value: { x: 180, y: 30, z: 120 },
      qualifiers: { physical_scope: { kind: 'physical_body' } },
    });
    expect(state.bridge.candidate!.component_data.dimensions_mm).toBeUndefined();
    const exclusions = (
      state.assertions[0].qualifiers as { physical_scope: { exclusions: string[] } }
    ).physical_scope.exclusions;
    expect(exclusions).toEqual(
      phrase.includes(' and ')
        ? ['connectors', 'mounting_accessories']
        : [phrase.includes('connectors') ? 'connectors' : 'mounting_accessories'],
    );
  });
  it('accepts bare narrow exclusion wording', () => {
    expect(
      setup([[dimensionsLabel, '120 x 180 x 30 mm without connectors']]).assertions,
    ).toHaveLength(1);
  });
  it('accepts documented dual-unit dimensions with original source evidence', () => {
    const state = setup();
    const dims = state.assertions.find((a) => a.target === dimensionsTarget)!;
    expect(dims.value).toEqual({ x: 187, y: 29.8, z: 124 });
    expect(dims.qualifiers).toEqual({
      physical_scope: { kind: 'physical_body', exclusions: ['connectors', 'mounting_accessories'] },
    });
    expect(state.bridge.facts.find((fact) => fact.field === dimensionsTarget)?.raw_value).toBe(
      realDimensions,
    );
    expect(
      state.bridge.facts.every((fact) => fact.fact_state === 'provisional' && fact.review_required),
    ).toBe(true);
    expect(state.bridge.candidate).toMatchObject({
      identity_status: 'provisional',
      review_status: 'pending',
      promotion_status: 'review_required',
    });
    expect(
      state.bridge.proposals.every((p) => p.provenance.rationale?.includes('single_observation')),
    ).toBe(true);
  });
  it.each([
    ['Supply voltage', '70–8 VDC'],
    ['Supply voltage', '8–70 VAC DC'],
    ['Supply voltage', '8–70 VDC typical'],
    [dimensionsLabel, '124 x 187 x 29.8 mm | 9.88 x 7.36 x 1.17 in (without connectors)'],
    [dimensionsLabel, '120 x 180 x 30 mm (without removable parts)'],
    [dimensionsLabel, '120 x 180 x 30 mm (mounted envelope)'],
  ])('fails closed for unsafe context: %s %s', (label, raw) => {
    const state = setup([[label, raw]]);
    expect(state.bridge.candidate).toBeUndefined();
    expect(state.bridge.proposals[0].disposition).toBe('unresolved');
  });
  it('fails closed for contradicting domain or unit evidence', () => {
    expect(parseContextualMeasurement(rangeTarget, '8–70 VDC', 'VAC')).toBeUndefined();
    expect(parseContextualMeasurement(rangeTarget, '8–70 VDC', 'mV')).toBeUndefined();
    expect(
      parseContextualMeasurement(dimensionsTarget, '120 x 180 x 30 mm (without connectors)', 'in'),
    ).toBeUndefined();
  });
  it('does not map envelopes, clearances, or weakened label aliases', () => {
    for (const label of [
      'Mounted envelope',
      'Service clearance',
      'Supply voltage typical',
      'Body dimensions',
    ])
      expect(setup([[label, '120 x 180 x 30 mm']]).bridge.candidate).toBeUndefined();
  });
  it('allows same-target different-context assertions and deterministic replay', () => {
    const rows = [
      ['Supply voltage', '8–70 VDC'],
      ['Supply voltage', '100–240 VAC'],
    ] as const;
    const first = setup(rows);
    expect(first.assertions).toHaveLength(2);
    expect(new Set(first.assertions.map((a) => a.id)).size).toBe(2);
    expect(setup([...rows].reverse())).toEqual(first);
    for (const assertion of first.assertions)
      expect(first.bridge.candidate!.qualified_value_evidence![assertion.id]).toHaveLength(1);
  });
  it('reconciles repeated recognized context without losing qualifiers', () => {
    const state = setup([
      ['Supply voltage', '8–70 VDC'],
      ['Supply voltage', '8–70 V DC'],
    ]);
    expect(state.reconciliation.group_reconciliations[0].outcome).toBe('agreement');
    expect(state.assertions).toHaveLength(1);
    expect(state.bridge.candidate!.qualified_value_evidence![state.assertions[0].id]).toHaveLength(
      2,
    );
  });
  it('reconciles domain spellings supplied inline or as a separate source unit', () => {
    const state = setup([
      ['Supply voltage', '8–70 VDC'],
      ['Supply voltage', '8–70', 'VDC'],
    ]);
    expect(state.reconciliation.group_reconciliations[0].outcome).toBe('agreement');
    expect(state.assertions).toHaveLength(1);
    expect(state.assertions[0].qualifiers).toEqual({ electrical_domain: 'dc' });
  });
  it('does not hide conflict within the same qualified context', () => {
    expect(
      setup([
        ['Supply voltage', '8–70 VDC'],
        ['Supply voltage', '9–72 V DC'],
      ]).bridge.candidate,
    ).toBeUndefined();
  });
  it('rejects target/qualifier mismatch, invalid shape, ordering, and unknown qualifiers', () => {
    const assertion = setup().assertions.find((a) => a.target === rangeTarget)!;
    for (const value of [
      { ...assertion, target: dimensionsTarget },
      { ...assertion, target: 'anything' },
      {
        ...assertion,
        qualifiers: { physical_scope: { kind: 'physical_body', exclusions: ['connectors'] } },
      },
      { ...assertion, qualifiers: { electrical_domain: 'dc', mystery: true } },
      { ...assertion, value: { min: 70, max: 8 } },
      { ...assertion, value: { min: 8 } },
      { ...assertion, qualifiers: {} },
    ])
      expect(isCanonicalQualifiedValue(value)).toBe(false);
    const dims = setup().assertions.find((a) => a.target === dimensionsTarget)!;
    expect(isCanonicalQualifiedValue({ ...dims, qualifiers: { electrical_domain: 'dc' } })).toBe(
      false,
    );
  });
  it('explicitly approves only selected assertion IDs and preserves atomic audit evidence', () => {
    const state = setup();
    state.approval.promotion_decisions = {
      ...state.approval.promotion_decisions!,
      approved_qualified_value_ids: [state.assertions[0].id],
    };
    const result = promoteProductionCandidate(
      state.approval,
      state.reviewPackage,
      state.bridge,
    ).result;
    expect(result.status).toBe('success');
    expect(result.proposal!.qualified_values).toEqual([state.assertions[0]]);
    expect(result.audit!.qualified_value_evidence).toEqual({
      [state.assertions[0].id]:
        state.bridge.candidate!.qualified_value_evidence![state.assertions[0].id],
    });
    expect(result.proposal!.electrical).toBeUndefined();
    expect(result.proposal!.dimensions_mm).toBeUndefined();
    expect(canonicalProposalSchemaValid(result.proposal!)).toBe(true);
    expect(serializeCanonicalComponent(result.proposal!)).toContain('qualified_values:');
  });
  it('package approval does not imply qualified-value approval', () => {
    const state = setup();
    state.approval.promotion_decisions = {
      ...state.approval.promotion_decisions!,
      approved_qualified_value_ids: undefined,
    };
    expect(
      promoteProductionCandidate(state.approval, state.reviewPackage, state.bridge).result.proposal!
        .qualified_values,
    ).toBeUndefined();
  });
  it('rejects arbitrary ID selections and field/index approval', () => {
    for (const fields of [
      rangeTarget,
      dimensionsTarget,
      'qualified_values',
      'qualified_values.0',
      'qualified_values[0]',
      `qualified_values.${setup().assertions[0].id}.value`,
    ]) {
      const state = setup();
      state.approval.promotion_decisions = {
        ...state.approval.promotion_decisions!,
        approved_fields: [fields],
      };
      expect(() =>
        productionApprovalToPromotionReview(state.approval, state.reviewPackage, state.bridge),
      ).toThrow();
    }
    const state = setup();
    state.approval.promotion_decisions = {
      ...state.approval.promotion_decisions!,
      approved_qualified_value_ids: ['unknown.id'],
    };
    expect(() =>
      productionApprovalToPromotionReview(state.approval, state.reviewPackage, state.bridge),
    ).toThrow();
    expect(
      validateProductionApproval({
        ...state.approval,
        promotion_decisions: {
          ...state.approval.promotion_decisions,
          approved_qualified_value_ids: [42],
        },
      }).length,
    ).toBeGreaterThan(0);
  });
  it('snapshot binds assertion and evidence; detached mutations are rejected', () => {
    const state = setup();
    const snapshot = promotionCandidateSnapshot(
      state.bridge.candidate!,
      state.bridge.sources,
      state.bridge.facts,
    );
    const changed = structuredClone(state.bridge.candidate!);
    (changed.component_data.qualified_values as CanonicalQualifiedValue[])[0].qualifiers = {
      electrical_domain: 'ac',
    };
    expect(promotionCandidateSnapshot(changed, state.bridge.sources, state.bridge.facts)).not.toBe(
      snapshot,
    );
    expect(validateProductCandidate(changed, state.bridge.sources, state.bridge.facts).status).toBe(
      'invalid',
    );
    expect(() =>
      productionApprovalToPromotionReview(state.approval, state.reviewPackage, {
        ...state.bridge,
        candidate: changed,
      }),
    ).toThrow();
    const duplicate = structuredClone(state.bridge.candidate!);
    duplicate.field_evidence = {
      [state.assertions[0].target]: duplicate.qualified_value_evidence![state.assertions[0].id],
    };
    duplicate.component_data[
      state.assertions[0].target === dimensionsTarget ? 'dimensions_mm' : 'electrical'
    ] =
      state.assertions[0].target === dimensionsTarget
        ? state.assertions[0].value
        : { input_voltage_range_v: state.assertions[0].value };
    expect(
      validateProductCandidate(duplicate, state.bridge.sources, state.bridge.facts).status,
    ).toBe('invalid');
  });
  it('canonical writer accepts reviewed qualified assertions as a dry run', async () => {
    const state = setup();
    const promotion = promoteProductionCandidate(
      state.approval,
      state.reviewPackage,
      state.bridge,
    ).result;
    const result = await writeCanonicalComponent({
      promotion,
      destinationRoot: '.tmp/qualified-value-writer-fixture',
    });
    expect(result.status).toBe('dry_run');
    expect(result.schema_valid).toBe(true);
  });
});

describe('ID-addressed qualified-value amendments', () => {
  it('adds by ID and retains full immutable history', () => {
    const input = amendment('add');
    const original = structuredClone(input.current);
    const result = proposeCanonicalAmendment(input);
    expect(result.status).toBe('proposed');
    expect(result.proposal!.qualified_values).toHaveLength(3);
    expect(result.qualified_value_changes![0]).toEqual({
      operation: 'add',
      id: input.value.id,
      value: input.value,
      fact_ids: input.ids,
      review_id: input.review.id,
    });
    expect(result.proposal!.amendment_history).toMatchObject([
      {
        review_id: input.review.id,
        candidate_id: input.review.candidate_id,
        expected_snapshot: input.review.expected_snapshot,
        qualified_value_operations: [{ value: input.value, operation: 'add', fact_ids: input.ids }],
      },
    ]);
    expect(input.current).toEqual(original);
  });
  it.each([false, true])(
    'replaces full value and qualifiers under the same ID (dimensions=%s)',
    (dimension) => {
      const input = amendment('replace', dimension);
      const sibling = (input.current.qualified_values as CanonicalQualifiedValue[]).find(
        (a) => a.id !== input.value.id,
      )!;
      const result = proposeCanonicalAmendment(input);
      expect(result.status).toBe('proposed');
      expect(result.proposal!.qualified_values).toContainEqual(input.value);
      expect(result.proposal!.qualified_values).toContainEqual(sibling);
      expect(result.qualified_value_changes![0]).toMatchObject({
        previous_value: input.existing,
        value: input.value,
      });
      expect(result.proposal!.amendment_history).toMatchObject([
        { qualified_value_operations: [{ previous_value: input.existing, value: input.value }] },
      ]);
      expect(result.proposal!.electrical).toBeUndefined();
      expect(result.proposal!.dimensions_mm).toBeUndefined();
    },
  );
  it('independently replaces one same-target sibling and appends history', () => {
    const input = amendment();
    input.current.qualified_values = [
      ...(input.current.qualified_values as CanonicalQualifiedValue[]),
      { ...input.existing, id: 'qualified-value.sibling' },
    ];
    input.current.amendment_history = [{ review_id: 'prior.review', retained: true }];
    input.review.expected_snapshot = canonicalSerializedSnapshot(input.current);
    const result = proposeCanonicalAmendment(input);
    expect(result.status).toBe('proposed');
    expect(result.proposal!.qualified_values).toContainEqual({
      ...input.existing,
      id: 'qualified-value.sibling',
    });
    expect(result.proposal!.amendment_history).toHaveLength(2);
    expect((result.proposal!.amendment_history as JsonObject[])[0]).toEqual({
      review_id: 'prior.review',
      retained: true,
    });
  });
  it.each([
    'duplicate_add',
    'duplicate_operation',
    'missing_replace',
    'id_mismatch',
    'retarget',
    'partial',
  ])('blocks invalid operation: %s', (kind) => {
    const input = amendment(kind === 'duplicate_add' ? 'add' : 'replace');
    const op = input.review.qualified_value_operations![0];
    if (kind === 'duplicate_add')
      input.current.qualified_values = [
        ...(input.current.qualified_values as CanonicalQualifiedValue[]),
        input.value,
      ];
    if (kind === 'duplicate_operation') input.review.qualified_value_operations = [op, op];
    if (kind === 'missing_replace') input.current.qualified_values = [];
    if (kind === 'id_mismatch')
      input.review.qualified_value_operations = [{ ...op, id: 'different.id' }];
    if (kind === 'retarget')
      input.current.qualified_values = [
        { ...setup().assertions.find((a) => a.target === dimensionsTarget)!, id: op.id },
      ];
    if (kind === 'partial')
      input.review.qualified_value_operations = [
        { ...op, value: { id: op.id, value: op.value.value } as CanonicalQualifiedValue },
      ];
    input.review.expected_snapshot = canonicalSerializedSnapshot(input.current);
    expect(proposeCanonicalAmendment(input).status).toBe('blocked');
  });
  it.each([
    'qualified_values',
    'qualified_values.0',
    'qualified_values[0]',
    'qualified_values.some-id.value',
  ])('rejects ordinary field mutation: %s', (field) => {
    const input = amendment();
    input.review.approved_fields = [field];
    input.review.field_actions = { [field]: 'replace' };
    expect(proposeCanonicalAmendment(input).status).toBe('blocked');
  });
  it.each([
    'stale',
    'replay',
    'conflicting_evidence',
    'missing_evidence',
    'absent_candidate_map',
    'empty_candidate_map',
    'disagreeing_candidate_map',
    'unresolved_fact',
    'outside_candidate',
    'wrong_assertion',
  ])('blocks unsafe state/evidence: %s', (kind) => {
    const input = amendment();
    if (kind === 'stale') input.review.expected_snapshot = 'sha256:stale';
    if (kind === 'replay') {
      input.current.amendment_history = [{ review_id: input.review.id }];
      input.review.expected_snapshot = canonicalSerializedSnapshot(input.current);
    }
    if (kind === 'conflicting_evidence')
      input.review.qualified_value_evidence = { [input.value.id]: ['different.fact'] };
    if (kind === 'missing_evidence') {
      input.review.qualified_value_operations = [
        { ...input.review.qualified_value_operations![0], evidence: undefined },
      ];
      input.review.qualified_value_evidence = undefined;
      input.candidate.qualified_value_evidence = undefined;
    }
    if (kind === 'absent_candidate_map') input.candidate.qualified_value_evidence = {};
    if (kind === 'empty_candidate_map')
      input.candidate.qualified_value_evidence = { [input.value.id]: [] };
    if (kind === 'disagreeing_candidate_map')
      input.candidate.qualified_value_evidence = { [input.value.id]: ['other.fact'] };
    if (kind === 'unresolved_fact')
      input.candidate.facts = input.candidate.facts!.map((fact) => ({
        ...fact,
        fact_state: 'unresolved',
      }));
    if (kind === 'outside_candidate') input.candidate.fact_ids = [];
    if (kind === 'wrong_assertion')
      input.candidate.facts = input.candidate.facts!.map((fact) => ({
        ...fact,
        qualified_value: input.existing,
      }));
    expect(proposeCanonicalAmendment(input).status).toBe('blocked');
  });
  it('invalid multi-operation amendment performs no write', async () => {
    const input = amendment();
    input.review.qualified_value_operations = [
      ...input.review.qualified_value_operations!,
      {
        ...input.review.qualified_value_operations![0],
        id: 'missing.id',
      } as CanonicalQualifiedValueOperation,
    ];
    let writes = 0;
    const result = await writeCanonicalAmendment({
      ...input,
      write: true,
      destinationRoot: '.tmp',
      filesystem: {
        access: async () => {},
        readFile: async () => '',
        mkdir: async () => {},
        writeFile: async () => {
          writes++;
        },
        rename: async () => {
          writes++;
        },
        rm: async () => {
          writes++;
        },
      },
    });
    expect(result.status).toBe('blocked');
    expect(writes).toBe(0);
  });
});
