import { describe, expect, it } from 'vitest';
import {
  artifactReference,
  buildReviewedSemanticInterpretation,
  buildQualifiedFactArtifact,
  buildProductionProductCandidate,
  buildProductionSemanticProposals,
  reconcileQualifiedFactsForWholeIntake,
  promoteCandidate,
  promotionCandidateSnapshot,
  reviewedSemanticInputSnapshot,
  type QualifiedFactArtifact,
  type ReviewedSemanticDecision,
  type SourceAcquisitionArtifact,
  type SourceCaptureArtifact,
  type ProductIntake,
} from '../src/index.js';
import { resolveCanonicalField, resolveProductionCanonicalField } from '../src/field-mapping.js';
import { reviewedSemanticContext } from '../src/semantic-context.js';
import { validateProductCandidate } from '../src/validation.js';

const intake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'test.intake',
  manufacturer: 'Example',
  product_model: 'Battery',
  manufacturer_part_number: 'BAT-1',
  official_product_uri: 'https://example.invalid/battery',
};
const sourceCapture: SourceCaptureArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_capture',
  id: 'test.capture',
  requested_uri: 'https://example.invalid/battery',
  final_uri: 'https://example.invalid/battery',
  retrieved_at: '2026-01-01T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'not_retained',
  source_provenance: { publisher: 'Example' },
};
const capture = artifactReference('source_capture', sourceCapture);
const acquisition: SourceAcquisitionArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_acquisition',
  id: 'test.acquisition',
  intake: artifactReference('product_intake', intake),
  seed_capture: capture,
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: `sha256:${'c'.repeat(64)}`,
  profile_binding: {
    profile_id: 'battle-born-batteries.web.acquisition-profile',
    profile_schema_version: '1.3',
    profile_digest: 'sha256:5548d13a19b56772fe02a62a6951d6111189bb174363fa3ab6adc9c435a07b79',
  },
};
const rows = [
  [1, 'Voltage', '12V'],
  [1, 'Capacity', '270Ah'],
  [1, 'Battery Type', 'LiFePO4 (lithium iron phosphate)'],
  [1, 'Ah PbEq', '540Ah'],
  [1, 'Usable Depth of Discharge', '100%'],
  [1, 'Maximum Series Voltage', '48V'],
  [2, 'Charging Voltage', '14.2 – 14.6 V'],
  [2, 'Float Voltage', '13.4 – 13.8 V'],
  [3, 'Width', '7.09 in'],
  [3, 'Length', '22.83 in'],
  [3, 'Height', '13.15 in'],
  [3, 'Weight', '80.8 lb'],
] as const;
const factsFor = (
  product = 'BAT-1',
  changes: Readonly<Record<string, string>> = {},
  extras: readonly (readonly [number, string, string])[] = [],
): QualifiedFactArtifact[] =>
  [...rows, ...extras].map(([table, label, original], row) =>
    buildQualifiedFactArtifact({
      source_capture: capture,
      source_acquisition: artifactReference('source_acquisition', acquisition),
      metadata: {
        source_label: label,
        source_wording: label,
        raw_value: changes[label] ?? original,
        applicability: { kind: 'exact_mpn_or_sku', value: product },
      },
      evidence: [
        {
          role: 'label',
          locator: { kind: 'html', path: `root/table[${table}]/tr[${row + 1}]/cell[1]` },
          text: label,
        },
        {
          role: 'value',
          locator: { kind: 'html', path: `root/table[${table}]/tr[${row + 1}]/cell[2]` },
          text: changes[label] ?? original,
        },
      ],
    }),
  );
const proposalsFor = (facts: QualifiedFactArtifact[]) =>
  buildProductionSemanticProposals({
    facts,
    source_acquisitions: [acquisition],
    reconciliation: reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: [acquisition],
    }),
  });

describe('reviewed battery semantic context', () => {
  it('maps the differentiated published rows and derives only from exact battery inputs', () => {
    const facts = factsFor();
    const proposals = proposalsFor(facts);
    const mapped = new Map(
      proposals.filter((item) => item.disposition === 'mapped').map((item) => [item.target, item]),
    );
    expect(mapped.get('electrical.nominal_voltage_v')?.proposed_value).toBe(12);
    expect(mapped.get('battery.nominal_capacity_ah')?.proposed_value).toBe(270);
    expect(mapped.get('battery.chemistry')?.proposed_value).toBe('lifepo4');
    expect(mapped.get('battery.charging_voltage_range_v')?.proposed_value).toEqual({
      min: 14.2,
      max: 14.6,
    });

    expect(mapped.get('battery.float_voltage_range_v')?.proposed_value).toEqual({
      min: 13.4,
      max: 13.8,
    });
    expect(mapped.get('dimensions_mm.y')?.proposed_value).toBeCloseTo(579.882);
    expect(mapped.get('battery.usable_capacity_ah')?.proposed_value).toBe(270);
    expect(mapped.get('battery.allowed_series_count')?.proposed_value).toEqual({ min: 1, max: 4 });
    expect(
      mapped.get('battery.usable_capacity_ah')?.derivation?.input_qualified_fact_ids,
    ).toHaveLength(2);
    expect(mapped.get('battery.usable_capacity_ah')?.derivation?.input_fact_ids).toBeUndefined();
    expect(mapped.get('battery.allowed_series_count')?.derivation?.input_fact_ids).toBeUndefined();
    expect(proposals.find((item) => item.target === 'source_label:ah pbeq')?.disposition).toBe(
      'unsupported',
    );
    const reconciliation = reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: [acquisition],
    });
    const bridge = buildProductionProductCandidate({
      intake,
      captures: [sourceCapture],
      source_acquisitions: [acquisition],
      facts,
      reconciliation,
      proposals,
    });
    expect(bridge.candidate?.derived_fields?.['battery.usable_capacity_ah']?.status).toBe(
      'derived',
    );
    expect(bridge.candidate?.derived_fields?.['battery.allowed_series_count']).toMatchObject({
      input_fact_ids: expect.arrayContaining([expect.any(String), expect.any(String)]),
      input_qualified_fact_ids: expect.arrayContaining([expect.any(String), expect.any(String)]),
    });
    for (const field of ['battery.usable_capacity_ah', 'battery.allowed_series_count']) {
      const derivedFactId = bridge.candidate?.field_evidence[field]?.[0];
      const derivedFact = bridge.facts.find((item) => item.id === derivedFactId);
      expect(
        derivedFact?.derivation?.input_fact_ids.every((id) =>
          bridge.facts.some((item) => item.id === id),
        ),
      ).toBe(true);
      expect(
        derivedFact?.derivation?.input_qualified_fact_ids?.every((id) =>
          facts.some((item) => item.id === id),
        ),
      ).toBe(true);
    }
    expect(bridge.candidate?.component_data.battery).toMatchObject({
      usable_capacity_ah: 270,
      allowed_series_count: { min: 1, max: 4 },
    });
    const validation = validateProductCandidate(bridge.candidate!, bridge.sources, bridge.facts);
    expect(validation.issues.filter((item) => item.category === 'invalid')).toEqual([]);
    const approvedFields = ['battery.usable_capacity_ah', 'battery.allowed_series_count'];
    const promotion = promoteCandidate(bridge.candidate!, bridge.sources, bridge.facts, {
      schema_version: '1.0',
      id: 'review.battery-derived',
      candidate_id: bridge.candidate!.id,
      candidate_snapshot: promotionCandidateSnapshot(
        bridge.candidate!,
        bridge.sources,
        bridge.facts,
      ),
      decision: 'approved',
      reviewer_id: 'reviewer.test',
      reviewed_at: '2026-01-02T00:00:00Z',
      approved_fields: approvedFields,
      evidence_acknowledged: true,
      product_role: 'battery',
      category: 'battery',
    });
    expect(promotion.status).toBe('success');
    const promotedFactIds = bridge.candidate!.field_evidence['battery.usable_capacity_ah'];
    expect(promotion.proposal?.source_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fact_ids: expect.arrayContaining(promotedFactIds) }),
      ]),
    );
  });

  it.each([
    'map',
    'evidence_only',
    'schema_gap',
    'reject',
    'not_applicable',
    'unresolved',
  ] as const)('rejects %s decisions for calculated proposals', (outcome) => {
    const facts = factsFor();
    const reconciliation = reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: [acquisition],
    });
    const proposals = proposalsFor(facts);
    const proposal = proposals.find(
      (item) => item.target === 'battery.usable_capacity_ah' && item.derivation,
    );
    if (!proposal) throw new Error('Expected a derived usable-capacity proposal.');
    const decision: ReviewedSemanticDecision = {
      schema_version: '1.0',
      artifact_kind: 'reviewed_semantic_decision',
      id: `decision.derived.${outcome}`,
      revision: 1,
      proposal_ref: artifactReference(
        'semantic_proposal',
        proposal,
        proposal.id,
        proposal.schema_version,
      ),
      fact_refs: proposal.fact_refs as ReviewedSemanticDecision['fact_refs'],
      input_snapshot: reviewedSemanticInputSnapshot({
        intake,
        source_acquisitions: [acquisition],
        facts,
        reconciliation,
        proposals,
      }),
      outcome,
      ...(outcome === 'map'
        ? {
            target: proposal.target,
            normalized_value: proposal.proposed_value,
            normalized_unit: 'Ah',
            rationale: 'The value is a direct product fact.',
          }
        : outcome === 'schema_gap'
          ? {
              rationale: 'A target is missing.',
              schema_gap: {
                concept_key: 'battery.usable_capacity_ah',
                explanation: 'The calculated field has existing derivation lineage.',
              },
            }
          : outcome === 'reject' || outcome === 'not_applicable'
            ? { rationale: 'This calculated proposal is not source semantic evidence.' }
            : {}),
      actor: { kind: 'operator_label', identifier: 'maintainer' },
      recorded_at: '2026-01-02T00:00:00Z',
      validation_policy_version: 'reviewed-semantic.v1',
    };
    expect(() =>
      buildReviewedSemanticInterpretation({
        intake,
        source_acquisitions: [acquisition],
        facts,
        reconciliation,
        proposals,
        decisions: [decision],
      }),
    ).toThrow(/apply only to source semantic proposals/i);
  });

  it('fails closed outside the attested role, region, and voltage class', () => {
    expect(resolveCanonicalField('Voltage')).toBeUndefined();
    expect(resolveCanonicalField('Capacity')).toBeUndefined();
    expect(resolveCanonicalField('Length')).toBeUndefined();
    expect(resolveCanonicalField('Cable Length')).toBeUndefined();
    expect(resolveCanonicalField('Mounting Clearance')).toBeUndefined();
    expect(resolveProductionCanonicalField('Maximum Series Count')).toBeUndefined();
    const facts = factsFor();
    const battery = reviewedSemanticContext(facts[0], facts, [acquisition]);
    expect(resolveCanonicalField('Voltage', battery)?.canonical_field).toBe(
      'electrical.nominal_voltage_v',
    );
    expect(resolveCanonicalField('Capacity', battery)?.canonical_field).toBe(
      'battery.nominal_capacity_ah',
    );
    expect(resolveCanonicalField('Ah PbEq', battery)).toBeUndefined();
    expect(resolveProductionCanonicalField('Maximum Series Count', battery)?.canonical_field).toBe(
      'battery.allowed_series_count',
    );
    expect(
      resolveCanonicalField(
        'Charging Voltage',
        reviewedSemanticContext(facts[6], facts, [acquisition]),
      )?.canonical_field,
    ).toBe('battery.charging_voltage_range_v');
    expect(
      resolveCanonicalField(
        'Float Voltage',
        reviewedSemanticContext(facts[7], facts, [acquisition]),
      )?.canonical_field,
    ).toBe('battery.float_voltage_range_v');
    expect(resolveCanonicalField('Length', battery)).toBeUndefined();
    expect(
      resolveCanonicalField('Length', reviewedSemanticContext(facts[9], facts, [acquisition]))
        ?.canonical_field,
    ).toBe('dimensions_mm.y');
    const changed = factsFor('BAT-1', { 'Maximum Series Voltage': '50V' });
    expect(
      proposalsFor(changed).some(
        (item) => item.derivation && item.target === 'battery.allowed_series_count',
      ),
    ).toBe(false);
    const wrongUnit = factsFor('BAT-1', { Capacity: '270Wh' });
    expect(
      proposalsFor(wrongUnit).find((item) => item.target === 'battery.nominal_capacity_ah')
        ?.disposition,
    ).toBe('unresolved');
    const mixed = [...facts.slice(0, 1), ...factsFor('BAT-2').slice(1)];
    expect(proposalsFor(mixed).some((item) => item.derivation)).toBe(false);
    const missingContext = facts.map((fact) => ({ ...fact, evidence: undefined }));
    expect(
      proposalsFor(missingContext).some((item) => item.target === 'electrical.nominal_voltage_v'),
    ).toBe(false);
  });

  it('keeps a direct manufacturer assertion and surfaces a disagreement with calculation', () => {
    const facts = factsFor('BAT-1', {}, [
      [1, 'Usable Capacity', '250Ah'],
      [1, 'Maximum Series Count', 'up to 3 in series'],
    ]);
    const proposals = proposalsFor(facts);
    expect(
      proposals.find((item) => item.target === 'battery.usable_capacity_ah' && !item.derivation),
    ).toMatchObject({ disposition: 'mapped', proposed_value: 250 });
    expect(
      proposals.find((item) => item.target === 'battery.usable_capacity_ah' && item.derivation),
    ).toMatchObject({ disposition: 'conflicting' });
    expect(
      proposals.find((item) => item.target === 'battery.allowed_series_count' && item.derivation),
    ).toMatchObject({ disposition: 'conflicting' });
    const reconciliation = reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: [acquisition],
    });
    const bridge = buildProductionProductCandidate({
      intake,
      captures: [sourceCapture],
      source_acquisitions: [acquisition],
      facts,
      reconciliation,
      proposals,
    });
    expect(bridge.candidate?.component_data.battery).toMatchObject({
      usable_capacity_ah: 250,
      allowed_series_count: { min: 1, max: 3 },
    });
    expect(bridge.candidate?.promotion_status).toBe('blocked');
    expect(bridge.candidate?.derived_fields).toBeUndefined();
    const agreeing = proposalsFor(factsFor('BAT-1', {}, [[1, 'Usable Capacity', '270Ah']]));
    expect(
      agreeing.find((item) => item.target === 'battery.usable_capacity_ah' && item.derivation),
    ).toMatchObject({ disposition: 'evidence_only' });
  });
});
