import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import componentSchema from '../../../data/schemas/component.schema.json' with { type: 'json' };
import factSchema from '../../../data/schemas/product-fact.schema.json' with { type: 'json' };
import productionSchema from '../../../data/schemas/production-ingestion.schema.json' with { type: 'json' };
import {
  artifactReference,
  artifactDigest,
  buildQualifiedFactArtifact,
  buildProductionSemanticProposals,
  buildProductionProductCandidate,
  buildProductionReviewPackage,
  reconcileQualifiedFactsForWholeIntake,
  reviewPackageSnapshot,
  productionApprovalToPromotionReview,
  promoteProductionCandidate,
  validateProductCandidate,
  validateProductFacts,
  normalizeProductFact,
  canonicalProposalSchemaValid,
  serializeCanonicalComponent,
  type ProductIntake,
  type SourceCaptureArtifact,
  type SourceAcquisitionArtifact,
  type CanonicalQualifiedValue,
  type ProductionApproval,
  type JsonObject,
} from '../src/index.js';
import {
  parseSourceObservations,
  isCanonicalQualifiedValue,
  sourceSupportsQualifiedValue,
} from '../src/qualified-values.js';
import {
  canonicalSerializedSnapshot,
  proposeCanonicalAmendment,
  type CanonicalAmendmentReview,
  type CanonicalAmendmentCandidate,
} from '../src/canonical-amendment.js';
import { productReviewView } from '../../../apps/ingestion-admin/server/operator-views.js';
import { constructApproval } from '../../../apps/ingestion-admin/server/product-review.js';
import type { IngestionJob } from '../../ingestion-runtime/src/job-service.js';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDataRoot } from '../../../scripts/validate-data.mjs';

const target = 'electrical.power_consumption_w';
const contractValidators = [componentSchema, factSchema, productionSchema].map((schema) => {
  const Ajv = Ajv2020 as unknown as new (options: object) => {
    compile(schema: unknown): (value: unknown) => boolean;
  };
  return new Ajv({ strict: false, strictNumbers: true }).compile({
    $defs: schema.$defs,
    $ref: '#/$defs/canonicalQualifiedValue',
  });
});
const offLabel = 'Power draw display off';
const onLabel = 'Power draw display on (100% brightness)';
const off = '2.6W 12V | 3.0W @ 24V | 3.7W @ 48V';
const on = '6.2W @ 12V | 6.6W @ 24V |7.4W @ 48V';
const rows = [
  ['Supply voltage', '8 - 70V DC'],
  [
    'Outer dimensions (h x w x d)',
    '124 x 187 x 29.8 mm | 4.88 x 7.36 x 1.17 in (without connectors and mounting accessories)',
  ],
  [offLabel, off],
  [onLabel, on],
] as const;
const intake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'intake.power.synthetic',
  manufacturer: 'Synthetic',
  product_model: 'Ekrano-shaped',
  manufacturer_part_number: 'REQUEST-ONLY',
  official_product_uri: 'https://example.invalid/specifications',
};
const capture: SourceCaptureArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_capture',
  id: 'capture.power.synthetic',
  requested_uri: intake.official_product_uri!,
  retrieved_at: '2026-09-28T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'not_retained',
  source_provenance: { publisher: 'Synthetic' },
};
const acquisition: SourceAcquisitionArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_acquisition',
  id: 'acquisition.power.synthetic',
  intake: artifactReference('product_intake', intake),
  seed_capture: artifactReference('source_capture', capture),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: `sha256:${'a'.repeat(64)}`,
};
const setup = (input: readonly (readonly [string, string])[] = rows, valueEvidence = false) => {
  const facts = input.map(([label, raw]) =>
    buildQualifiedFactArtifact({
      source_capture: artifactReference('source_capture', capture),
      source_acquisition: artifactReference('source_acquisition', acquisition),
      ...(valueEvidence ? { evidence: [{ role: 'value' as const, text: raw }] } : {}),
      metadata: {
        source_wording: label,
        source_label: label,
        raw_value: raw,
        applicability: { kind: 'exact_product', value: intake.product_model },
      },
      qualification_state: 'structurally_supported',
    }),
  );
  const reconciliation = reconcileQualifiedFactsForWholeIntake({
    facts,
    source_acquisitions: [acquisition],
  });
  const proposals = buildProductionSemanticProposals({
    facts,
    source_acquisitions: [acquisition],
    reconciliation,
  });
  const bridge = buildProductionProductCandidate({
    intake,
    captures: [capture],
    source_acquisitions: [acquisition],
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
    id: 'approval.power.synthetic',
    review_package: artifactReference('review_package', reviewPackage),
    review_package_snapshot: reviewPackageSnapshot(reviewPackage),
    semantic_snapshot: reviewPackage.semantic_snapshot,
    reviewer_id: 'reviewer.synthetic',
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
  return { facts, reconciliation, proposals, bridge, reviewPackage, assertions, approval };
};

describe('atomic qualified power consumption', () => {
  it('preserves ordered atomic meanings while binding artifact IDs to reordered raw evidence', () => {
    const leftRaw = '2.6W 12V | 3.0W 24V | 3.7W 48V';
    const rightRaw = '3.7W 48V | 2.6W 12V | 3.0W 24V';
    const left = setup([[offLabel, leftRaw]], true);
    const right = setup([[offLabel, rightRaw]], true);
    expect(parseSourceObservations(target, offLabel, rightRaw)).toEqual(
      parseSourceObservations(target, offLabel, leftRaw),
    );
    expect(right.facts[0].id).not.toBe(left.facts[0].id);
    const meanings = (s: ReturnType<typeof setup>) =>
      s.proposals
        .map((p) => ({
          target: p.target,
          value: p.proposed_value,
          qualifiers: p.qualified_value!.qualifiers,
        }))
        .sort(
          (a, b) => Number(a.qualifiers.supply_voltage_v) - Number(b.qualifiers.supply_voltage_v),
        );
    const observations = parseSourceObservations(target, offLabel, leftRaw)!;
    const expected = observations.map((o) => ({
      target,
      value: o.value,
      qualifiers: o.qualifiers,
    }));
    expect(meanings(left)).toEqual(expected);
    expect(meanings(right)).toEqual(expected);
    expect(left.proposals).toHaveLength(3);
    expect(right.proposals).toHaveLength(3);
    expect(right.assertions.map((a) => a.id)).not.toEqual(left.assertions.map((a) => a.id));
    expect(right.proposals.map((p) => p.id)).not.toEqual(left.proposals.map((p) => p.id));
    for (const [s, raw] of [
      [left, leftRaw],
      [right, rightRaw],
    ] as const) {
      for (const proposal of s.proposals) {
        const { id, schema_version: _schema, artifact_kind: _kind, ...content } = proposal;
        expect(id).toBe(`semantic-proposal.${artifactDigest(content).slice(7, 31)}`);
        expect(proposal.provenance.rule_version).toBe('production-semantic-bridge.v6');
        const assertion = proposal.qualified_value!;
        expect(assertion.id).toBe(
          `qualified-value.${artifactDigest({
            target: assertion.target,
            value: assertion.value,
            qualifiers: assertion.qualifiers,
            fact_ids: [s.facts[0].id],
          }).slice(7, 31)}`,
        );
        expect(proposal.fact_refs).toEqual([
          artifactReference('qualified_fact', s.facts[0], s.facts[0].id, s.facts[0].schema_version),
        ]);
        expect(proposal.input_artifact_digests).toContain(artifactDigest(s.facts[0]));
        const projectedIds = s.bridge.candidate!.qualified_value_evidence![assertion.id];
        expect(projectedIds).toHaveLength(1);
        const projected = s.bridge.facts.find((f) => f.id === projectedIds[0])!;
        expect(projected.raw_value).toBe(raw);
        expect(projected.qualified_value).toEqual(assertion);
        expect(sourceSupportsQualifiedValue(projected, assertion)).toBe(true);
      }
    }
    expect(right.proposals[0].fact_refs).not.toEqual(left.proposals[0].fact_refs);
    expect(right.proposals[0].input_artifact_digests).not.toEqual(
      left.proposals[0].input_artifact_digests,
    );
    expect(reviewPackageSnapshot(right.reviewPackage)).not.toBe(
      reviewPackageSnapshot(left.reviewPackage),
    );
    expect(() =>
      productionApprovalToPromotionReview(left.approval, right.reviewPackage, right.bridge),
    ).toThrow();
    const changed = setup([[offLabel, '3.8W 48V | 2.6W 12V | 3.0W 24V']], true);
    expect(changed.assertions.map((a) => a.id)).not.toEqual(left.assertions.map((a) => a.id));
  });
  it('replays exact input with identical source, assertion, proposal, candidate/evidence and review identities', () => {
    const first = setup([[offLabel, '2.6W 12V | 3.0W 24V | 3.7W 48V']], true);
    const replay = setup([[offLabel, '2.6W 12V | 3.0W 24V | 3.7W 48V']], true);
    expect(replay.facts).toEqual(first.facts);
    expect(replay.assertions).toEqual(first.assertions);
    expect(replay.proposals).toEqual(first.proposals);
    expect(replay.bridge).toEqual(first.bridge);
    expect(replay.reviewPackage).toEqual(first.reviewPackage);
    expect(reviewPackageSnapshot(replay.reviewPackage)).toBe(
      reviewPackageSnapshot(first.reviewPackage),
    );
  });
  it.each([
    [{}, false],
    [{ operating_state: 'off', display: { state: 'off' } }, true],
    [{ operating_state: 'active', display: { state: 'off' } }, true],
    [{ operating_state: 'off', display: { state: 'on' } }, false],
    ...[0, 50, 100].map((brightness_percent) => [
      { operating_state: 'off', display: { state: 'on', brightness_percent } },
      false,
    ]),
    ...['idle', 'standby', 'sleep', 'active'].flatMap((operating_state) =>
      ['off', 'on'].map((state) => [{ operating_state, display: { state } }, true]),
    ),
    [{ measurement_basis: 'quiescent', display: { state: 'off' } }, true],
  ])('enforces only the whole-device off/display-on contradiction: %j', (qualifiers, valid) => {
    const assertion = { id: 'power.states', target, value: 3, qualifiers };
    expect(isCanonicalQualifiedValue(assertion)).toBe(valid);
    for (const validate of contractValidators) expect(validate(assertion)).toBe(valid);
  });
  it('never chooses a point through singular normalization without an explicit supported selection', () => {
    const s = setup([[offLabel, off]]);
    const fact = s.bridge.facts[0];
    const source = s.bridge.sources[0];
    expect(normalizeProductFact(fact, source).status).toBe('unresolved');
    expect(
      normalizeProductFact(fact, source, {
        value: 99,
        qualifiers: fact.qualified_value!.qualifiers,
      }).status,
    ).toBe('unresolved');
    expect(
      normalizeProductFact(fact, source, {
        value: fact.qualified_value!.value,
        qualifiers: fact.qualified_value!.qualifiers,
      }).status,
    ).toBe('normalized');
    const invalid = { ...fact, qualified_value: { ...fact.qualified_value!, value: Infinity } };
    expect(validateProductFacts([invalid], s.bridge.sources).status).toBe('invalid');
  });
  it('supports a source-explicit electrical domain and retains full-row evidence', () => {
    const s = setup([[offLabel, '4W 24VDC | 5W 48V DC']]);
    expect(s.assertions).toHaveLength(2);
    for (const assertion of s.assertions)
      expect(assertion.qualifiers).toMatchObject({ electrical_domain: 'dc' });
    const fact = s.bridge.facts[0];
    const assertion = fact.qualified_value!;
    for (const qualifiers of [
      { ...assertion.qualifiers, operating_state: 'idle' },
      { ...assertion.qualifiers, measurement_basis: 'quiescent' },
      { ...assertion.qualifiers, electrical_domain: 'ac' },
      { supply_voltage_v: 36, display: { state: 'off' } },
    ])
      expect(
        sourceSupportsQualifiedValue(fact, { ...assertion, qualifiers } as CanonicalQualifiedValue),
      ).toBe(false);
  });
  it('fans two source rows into six points, retaining the old two qualified values', () => {
    const s = setup();
    expect(s.facts).toHaveLength(4);
    expect(s.reconciliation.groups).toHaveLength(4);
    expect(
      s.reconciliation.group_reconciliations.every((g) => g.outcome === 'single_observation'),
    ).toBe(true);
    expect(s.proposals).toHaveLength(8);
    expect(s.assertions).toHaveLength(8);
    const power = s.assertions.filter((a) => a.target === target);
    expect(power).toHaveLength(6);
    expect(new Set(s.proposals.map((p) => p.id)).size).toBe(8);
    expect(new Set(s.assertions.map((p) => p.id)).size).toBe(8);
    expect(new Set(s.bridge.facts.map((f) => f.id)).size).toBe(8);
    for (const [label, watts, state] of [
      [offLabel, [2.6, 3, 3.7], 'off'],
      [onLabel, [6.2, 6.6, 7.4], 'on'],
    ] as const) {
      const fact = s.facts.find((f) => f.metadata.source_label === label)!;
      const children = s.proposals.filter((p) => p.fact_refs?.some((r) => r.reference === fact.id));
      expect(children).toHaveLength(3);
      for (const [i, voltage] of [12, 24, 48].entries()) {
        const assertion = power.find(
          (a) => a.qualifiers.supply_voltage_v === voltage && a.qualifiers.display?.state === state,
        )!;
        expect(assertion.value).toBe(watts[i]);
        expect(assertion.qualifiers).toEqual({
          supply_voltage_v: voltage,
          display: state === 'off' ? { state: 'off' } : { state: 'on', brightness_percent: 100 },
        });
        const ids = s.bridge.candidate!.qualified_value_evidence![assertion.id];
        expect(ids).toHaveLength(1);
        const productionFact = s.bridge.facts.find((f) => f.id === ids[0])!;
        expect(productionFact.raw_value).toBe(fact.metadata.raw_value);
        expect(productionFact.qualified_value).toEqual(assertion);
        expect(sourceSupportsQualifiedValue(productionFact, assertion)).toBe(true);
      }
    }
    expect(s.bridge.candidate!.component_data.electrical).toBeUndefined();
    expect(s.bridge.candidate!.component_data.dimensions_mm).toBeUndefined();
    expect(s.bridge.candidate!.field_evidence).toEqual({});
    expect(s.bridge.candidate!.identity_status).toBe('provisional');
    expect(
      validateProductCandidate(s.bridge.candidate!, s.bridge.sources, s.bridge.facts).status,
    ).not.toBe('invalid');
    expect(setup().assertions).toEqual(s.assertions);
    expect(setup([...rows].reverse()).proposals).toEqual(s.proposals);
  });
  it('keeps 30 source groups while producing 34 proposals: eight mapped, 26 unsupported', () => {
    const labels = [
      'Relay',
      'VE.Direct ports (always isolated)',
      'VE.Bus (always isolated)',
      'VE.Can 1',
      'VE.Can 2',
      'Ethernet',
      'WiFi',
      'Wifi Frequencies and Power',
      'Bluetooth Smart',
      'Bluetooth Frequencies and Power',
      'USB Host ports',
      'MicroSD Card Slot',
      'Resistive tank level inputs',
      'Temperature sense inputs',
      'Digital inputs',
      'Display resolution',
      'Display max. backlight brightness',
      'Backlight dimming',
      'Touch toggle on/off button',
      'Operating temperature range',
      'Mounting',
      'Buzzer',
      'Protection category',
      'Safety',
      'EMC',
      'Automotive',
    ];
    const s = setup([
      ...rows,
      ...labels.map((label) => [label, 'Synthetic unsupported observation'] as const),
    ]);
    expect(s.reconciliation.groups).toHaveLength(30);
    expect(s.proposals).toHaveLength(34);
    expect(s.proposals.filter((p) => p.disposition === 'mapped')).toHaveLength(8);
    expect(s.proposals.filter((p) => p.disposition === 'unsupported')).toHaveLength(26);
    expect(s.bridge.projected_proposal_ids).toHaveLength(8);
    expect(s.assertions).toHaveLength(8);
  });
  it.each([' 2.6 W 12 V ', '2.6W@12V', '2.6 W @ 12 V', '0W 1V', '99.25W 36V | 0W@72V'])(
    'accepts explicit generic points and optional @: %s',
    (raw) => {
      expect(parseSourceObservations(target, offLabel, raw)).toBeDefined();
    },
  );
  it('deduplicates equal repeated conditions without last-write-wins', () => {
    expect(setup([[offLabel, '3W 24V | 3.0W @ 24V']]).assertions).toHaveLength(1);
  });
  it.each([
    '3W 24V | 4W 24V',
    '2W 12V | mystery',
    '2W 12V |',
    '2 12V',
    '2W 12',
    '2A 12V',
    '2VA 12V',
    '2W 0V',
    '-2W 12V',
    'NaNW 12V',
    'InfinityW 12V',
    '2W 12V typical',
    '2W 12VDC AC',
    '2W 12V | 3.5A 24V',
  ])('fails the whole row closed: %s', (raw) => {
    const s = setup([[offLabel, raw]]);
    expect(s.assertions).toEqual([]);
    expect(s.proposals).toHaveLength(1);
    expect(s.proposals[0].disposition).toBe('unresolved');
    expect(s.bridge.candidate).toBeUndefined();
  });
  it.each([
    'Power draw',
    'Power draw idle',
    'Power draw display off idle',
    'Power draw display on (101% brightness)',
    'Power draw display off (100% brightness)',
  ])('does not fuzzy-map unknown label context: %s', (label) => {
    expect(setup([[label, off]]).proposals[0].disposition).toBe('unsupported');
  });
  it('preserves explicit alternate brightness and inline domain without cross-row inference', () => {
    expect(
      parseSourceObservations(target, 'Power draw display on (50% brightness)', '4W 24V DC'),
    ).toEqual([
      {
        value: 4,
        qualifiers: {
          supply_voltage_v: 24,
          display: { state: 'on', brightness_percent: 50 },
          electrical_domain: 'dc',
        },
      },
    ]);
    expect(parseSourceObservations(target, offLabel, '4W 24V', 'A')).toBeUndefined();
    expect(
      parseSourceObservations(target, offLabel, '4W 24V', 'W')?.[0].qualifiers,
    ).not.toHaveProperty('electrical_domain');
  });
  it.each([
    { value: -1 },
    { value: Infinity },
    { value: NaN },
    { qualifiers: {} },
    { qualifiers: { supply_voltage_v: 0 } },
    { qualifiers: { supply_voltage_v: Infinity } },
    { qualifiers: { display: { state: 'off', brightness_percent: 0 } } },
    { qualifiers: { display: { brightness_percent: 50 } } },
    { qualifiers: { display: { state: 'on', brightness_percent: 101 } } },
    { qualifiers: { display: { state: 'on', brightness_percent: NaN } } },
    { qualifiers: { operating_state: 'quiescent' } },
    { qualifiers: { measurement_basis: 'idle' } },
    { qualifiers: { mystery: 'value' } },
    { qualifiers: { electrical_domain: 'unknown' } },
  ])('rejects malformed closed qualifiers/value %j', (patch) => {
    expect(
      isCanonicalQualifiedValue({
        id: 'power.invalid',
        target,
        value: 3,
        qualifiers: { supply_voltage_v: 24 },
        ...patch,
      }),
    ).toBe(false);
  });
  it('allows explicit future device states/bases independently, never defaults them', () => {
    for (const state of ['idle', 'standby', 'sleep', 'active', 'off'])
      expect(
        isCanonicalQualifiedValue({
          id: 'power.future',
          target,
          value: 0,
          qualifiers: { operating_state: state },
        }),
      ).toBe(true);
    for (const basis of ['typical', 'nominal', 'maximum', 'minimum', 'quiescent'])
      expect(
        isCanonicalQualifiedValue({
          id: 'power.future',
          target,
          value: 0,
          qualifiers: { measurement_basis: basis },
        }),
      ).toBe(true);
  });
  it('uses generic operator DTO and independent ID selections with exact snapshots', () => {
    const s = setup();
    const preparation = {
      status: 'review_ready',
      intake,
      acquisition: {
        status: 'acquired',
        artifact: acquisition,
        seed_capture: { disposition: 'authoritative', artifact: capture, reasons: [] },
        candidates: [],
        issues: [],
      },
      source_acquisitions: [acquisition],
      captures: [capture],
      document_extractions: [],
      qualifications: [],
      qualified_facts: s.facts,
      reconciliation: s.reconciliation,
      proposals: s.proposals,
      bridge: s.bridge,
      review_package: s.reviewPackage,
    };
    const job = {
      schema_version: '1.0',
      id: 'job.power.synthetic',
      state: 'review_ready',
      created_at: '2026-09-28T00:00:00Z',
      updated_at: '2026-09-28T00:00:00Z',
      intake,
      preparation,
    } as IngestionJob;
    const view = productReviewView(job)!;
    expect(view.qualified_values).toHaveLength(8);
    for (const assertion of s.assertions) {
      const displayed = view.qualified_values.find((a) => a.id === assertion.id)!;
      expect(displayed).toMatchObject(assertion);
      expect(displayed.candidate_fact_ids).toEqual(
        s.bridge.candidate!.qualified_value_evidence![assertion.id],
      );
      expect(displayed.proposals).toHaveLength(1);
      const approval = constructApproval(job, 'approved', {
        reviewer_id: 'Synthetic construction only',
        promotion_decisions: {
          ...s.approval.promotion_decisions,
          approved_fields: [],
          approved_qualified_value_ids: [assertion.id],
        },
      });
      expect(
        productionApprovalToPromotionReview(approval, s.reviewPackage, s.bridge)
          .approved_qualified_value_ids,
      ).toEqual([assertion.id]);
    }
    const changed = structuredClone(s.bridge);
    (changed.candidate!.component_data.qualified_values as CanonicalQualifiedValue[])[0].value = 9;
    expect(() =>
      productionApprovalToPromotionReview(s.approval, s.reviewPackage, changed),
    ).toThrow();
  });
  it('promotes selected points only with source-local evidence and valid canonical serialization', () => {
    const s = setup();
    const all = promoteProductionCandidate(s.approval, s.reviewPackage, s.bridge).result;
    expect(all.status).toBe('success');
    expect(all.proposal!.qualified_values).toHaveLength(8);
    expect(canonicalProposalSchemaValid(all.proposal!)).toBe(true);
    expect(serializeCanonicalComponent(all.proposal!)).toContain(target);
    const power = s.assertions.filter((a) => a.target === target);
    const approval = {
      ...s.approval,
      promotion_decisions: {
        ...s.approval.promotion_decisions!,
        approved_qualified_value_ids: [power[1].id, power[4].id],
      },
    };
    const chosen = promoteProductionCandidate(approval, s.reviewPackage, s.bridge).result;
    expect(chosen.proposal!.qualified_values).toHaveLength(2);
    expect(chosen.proposal!.electrical).toBeUndefined();
    const ref = (chosen.proposal!.source_refs as JsonObject[])[0];
    expect(Object.keys(ref.qualified_value_evidence as JsonObject).sort()).toEqual(
      [power[1].id, power[4].id].sort(),
    );
    expect(ref.fact_ids).toEqual(
      Object.values(chosen.audit!.qualified_value_evidence!).flat().sort(),
    );
  });
  it.each(['add', 'replace'] as const)(
    'amends one exact 24 V point from a multi-point row: %s',
    (operation) => {
      const s = setup();
      const current = promoteProductionCandidate(s.approval, s.reviewPackage, s.bridge).result
        .proposal!;
      const existing = s.assertions.find(
        (a) =>
          a.target === target &&
          a.qualifiers.supply_voltage_v === 24 &&
          a.qualifiers.display?.state === 'off',
      )!;
      const newer = setup([[offLabel, '2.6W 12V | 3.2W 24V | 3.7W 48V']]);
      const selected = newer.assertions.find(
        (a) => a.target === target && a.qualifiers.supply_voltage_v === 24,
      )!;
      const value = {
        ...selected,
        id: operation === 'replace' ? existing.id : 'power.added',
      } as CanonicalQualifiedValue;
      const ids = newer.bridge.candidate!.qualified_value_evidence![selected.id];
      const candidate: CanonicalAmendmentCandidate = {
        component_data: { qualified_values: [value] },
        qualified_value_evidence: { [value.id]: ids },
        facts: newer.bridge.facts,
        fact_ids: newer.bridge.facts.map((f) => f.id),
        source_ids: newer.bridge.sources.map((s) => s.id),
        normalized_facts: newer.bridge.normalized_facts,
      };
      const review: CanonicalAmendmentReview = {
        schema_version: '1.0',
        id: `review.power.${operation}`,
        candidate_id: newer.bridge.candidate!.id,
        component_id: String(current.id),
        expected_snapshot: canonicalSerializedSnapshot(current),
        decision: 'approved',
        reviewer_id: 'reviewer.synthetic',
        reviewed_at: '2026-09-28T00:02:00Z',
        approved_fields: [],
        evidence_acknowledged: true,
        product_role: 'monitor',
        category: 'monitor',
        rationale: 'Synthetic exact observation review',
        qualified_value_operations: [{ operation, id: value.id, value, evidence: ids }],
      };
      const result = proposeCanonicalAmendment({ current, candidate, review });
      expect(result.status).toBe('proposed');
      expect(result.proposal!.qualified_values).toHaveLength(operation === 'replace' ? 8 : 9);
      expect(result.proposal!.qualified_values).toContainEqual(value);
      expect(result.qualified_value_changes![0]).toMatchObject({
        operation,
        value,
        fact_ids: ids,
        ...(operation === 'replace' ? { previous_value: existing } : {}),
      });
      expect(result.proposal!.amendment_history).toMatchObject([
        { qualified_value_operations: [{ value, fact_ids: ids }] },
      ]);
      expect(result.proposal!.electrical).toBeUndefined();
      expect(
        proposeCanonicalAmendment({
          current,
          candidate: { ...candidate, qualified_value_evidence: {} },
          review,
        }).status,
      ).toBe('blocked');
      const wrong = { ...value, value: 99 } as CanonicalQualifiedValue;
      const wrongReview = {
        ...review,
        qualified_value_operations: [{ operation, id: wrong.id, value: wrong, evidence: ids }],
      };
      expect(
        proposeCanonicalAmendment({
          current,
          candidate: { ...candidate, component_data: { qualified_values: [wrong] } },
          review: wrongReview,
        }).status,
      ).toBe('blocked');
    },
  );
  it('validates an isolated corpus and rejects duplicate IDs without reading repository components', async () => {
    const root = await mkdtemp(join(tmpdir(), 'power-corpus-'));
    try {
      await mkdir(join(root, 'schemas'));
      await mkdir(join(root, 'components'));
      await copyFile(
        'data/schemas/component.schema.json',
        join(root, 'schemas/component.schema.json'),
      );
      const s = setup();
      const proposal = promoteProductionCandidate(s.approval, s.reviewPackage, s.bridge).result
        .proposal!;
      const path = join(root, 'components', `${proposal.id}.yaml`);
      await writeFile(path, serializeCanonicalComponent(proposal));
      await expect(validateDataRoot(root)).resolves.toBeDefined();
      const power = s.assertions.find((a) => a.target === target)!;
      proposal.qualified_values = [power, { ...power, value: 99 }];
      await writeFile(path, JSON.stringify(proposal));
      await expect(validateDataRoot(root)).rejects.toThrow('duplicate qualified-value ID');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
