import { describe, expect, it } from 'vitest';
import {
  artifactDigest,
  artifactReference,
  buildProductionProductCandidate,
  buildProductionSemanticProposals,
  buildQualifiedFactArtifact,
  PRODUCTION_SCHEMA_VERSION,
  normalizeProductionSemanticTarget,
  productionSemanticFieldDescriptor,
  productionSemanticTargetContractIssues,
  productionSemanticValueMatchesTarget,
  previewReviewedSemanticMapping,
  reconcileQualifiedFactsForWholeIntake,
  reviewedSemanticInputSnapshot,
  reviewedSemanticTargetsForFacts,
  type ProductIntake,
  type QualifiedFactArtifact,
  type ReviewedSemanticDecision,
  type SemanticProposal,
  type SourceAcquisitionArtifact,
  type SourceCaptureArtifact,
} from '../src/index.js';

const intake: ProductIntake = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.reviewed-semantic',
  manufacturer: 'Example',
  product_model: 'Model',
  manufacturer_part_number: 'MPN',
  official_product_uri: 'https://example.invalid/product',
};
const capture: SourceCaptureArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_capture',
  id: 'capture.reviewed-semantic',
  requested_uri: intake.official_product_uri!,
  final_uri: intake.official_product_uri,
  retrieved_at: '2026-01-01T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'not_retained',
  source_provenance: { publisher: 'Example' },
};
const acquisition: SourceAcquisitionArtifact = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_acquisition',
  id: 'acquisition.reviewed-semantic',
  intake: artifactReference('product_intake', intake),
  seed_capture: artifactReference('source_capture', capture),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: `sha256:${'a'.repeat(64)}`,
};

const fact = (
  label: string,
  raw_value: string,
  options: {
    readonly source_unit?: string;
    readonly conditions?: readonly string[];
  } = {},
): QualifiedFactArtifact =>
  buildQualifiedFactArtifact({
    source_capture: artifactReference('source_capture', capture),
    source_acquisition: artifactReference('source_acquisition', acquisition),
    metadata: {
      source_wording: `${label}: ${raw_value}`,
      source_label: label,
      raw_value,
      ...(options.source_unit ? { source_unit: options.source_unit } : {}),
      ...(options.conditions ? { conditions: options.conditions } : {}),
      applicability: { kind: 'exact_mpn_or_sku', value: 'MPN' },
    },
    qualification_state: 'exact',
  });

const prepare = (facts: readonly QualifiedFactArtifact[]) => {
  const reconciliation = reconcileQualifiedFactsForWholeIntake({
    facts,
    source_acquisitions: [acquisition],
  });
  const proposals = buildProductionSemanticProposals({
    facts,
    source_acquisitions: [acquisition],
    reconciliation,
  });
  return { reconciliation, proposals };
};

const decision = (
  facts: readonly QualifiedFactArtifact[],
  proposals: readonly SemanticProposal[],
  proposal: SemanticProposal,
  overrides: Partial<ReviewedSemanticDecision> & Pick<ReviewedSemanticDecision, 'outcome'>,
): ReviewedSemanticDecision => {
  const snapshot = reviewedSemanticInputSnapshot({
    intake,
    source_acquisitions: [acquisition],
    facts,
    reconciliation: reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: [acquisition],
    }),
    proposals,
  });
  return {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'reviewed_semantic_decision',
    id: `decision.${artifactDigest({ proposal: proposal.id, overrides }).slice(7, 31)}`,
    revision: 1,
    proposal_ref: artifactReference(
      'semantic_proposal',
      proposal,
      proposal.id,
      proposal.schema_version,
    ),
    fact_refs: proposal.fact_refs as ReviewedSemanticDecision['fact_refs'],
    input_snapshot: snapshot,
    actor: { kind: 'operator_label', identifier: 'maintainer' },
    recorded_at: '2026-01-02T00:00:00Z',
    validation_policy_version: 'reviewed-semantic.v1',
    ...overrides,
  };
};

const rebuild = (
  facts: readonly QualifiedFactArtifact[],
  decisions: readonly ReviewedSemanticDecision[] = [],
) => {
  const { reconciliation, proposals } = prepare(facts);
  const bridge = buildProductionProductCandidate({
    intake,
    captures: [capture],
    source_acquisitions: [acquisition],
    facts,
    reconciliation,
    proposals,
    reviewed_semantic_decisions: decisions,
  });
  return { reconciliation, proposals, bridge };
};

describe('reviewed semantic interpretation', () => {
  it('keeps target contracts independent of automatic aliases and rejects schema-only paths', () => {
    expect(productionSemanticTargetContractIssues()).toEqual([]);
    expect(
      productionSemanticFieldDescriptor('electrical.continuous_input_current_a'),
    ).toMatchObject({
      canonical_field: 'electrical.continuous_input_current_a',
      dimension: 'current',
      unit: 'A',
    });
    expect(productionSemanticFieldDescriptor('manufacturer')).toBeUndefined();

    const facts = [fact('unlisted input amperage', '150A')];
    const { proposals } = prepare(facts);
    expect(proposals[0].disposition).toBe('unsupported');
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome: 'map',
      target: 'electrical.continuous_input_current_a',
      normalized_value: 150,
      normalized_unit: 'A',
      rationale: 'The retained assertion states the product input current.',
    });
    expect(rebuild(facts, [reviewed]).bridge.candidate?.component_data).toEqual({
      electrical: { continuous_input_current_a: 150 },
    });
  });

  it('discovers a contract target for an unsupported label and previews the persisted normalization', () => {
    const facts = [fact('Mystery electrical rating', '150 A')];
    const { proposals } = prepare(facts);
    expect(proposals[0].target).toBe('source_label:mystery electrical rating');
    const targets = reviewedSemanticTargetsForFacts(facts, facts, [acquisition]);
    expect(targets.map((target) => target.canonical_field)).toContain(
      'electrical.continuous_output_current_a',
    );
    expect(targets.every((target) => !('normalize' in target) && !('aliases' in target))).toBe(
      true,
    );

    const preview = previewReviewedSemanticMapping(
      'electrical.continuous_output_current_a',
      facts,
      facts,
      [acquisition],
    );
    expect(preview).toMatchObject({
      target: 'electrical.continuous_output_current_a',
      selected_fact_ids: [facts[0].id],
      source_assertions: [{ raw_value: '150 A' }],
      normalized_value: 150,
      normalized_unit: 'A',
    });
    expect(facts[0].metadata.raw_value).toBe('150 A');
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome: 'map',
      target: preview.target,
      normalized_value: preview.normalized_value,
      normalized_unit: preview.normalized_unit,
      rationale: 'The retained assertion identifies continuous output current.',
    });
    const result = rebuild(facts, [reviewed]).bridge.reviewed_semantic_interpretation.entries[0];
    expect(result).toMatchObject({
      state: 'human_mapped',
      target: preview.target,
      value: preview.normalized_value,
      normalized_unit: preview.normalized_unit,
      selected_fact_refs: proposals[0].fact_refs,
    });
  });

  it('converts a retained inch assertion to the canonical millimetre preview', () => {
    const facts = [fact('Unlisted body width', '11.5 in')];
    const preview = previewReviewedSemanticMapping('dimensions_mm.x', facts, facts, [acquisition]);
    expect(preview.source_assertions[0]).toMatchObject({ raw_value: '11.5 in' });
    expect(preview).toMatchObject({
      target: 'dimensions_mm.x',
      normalized_value: 292.1,
      normalized_unit: 'mm',
    });
    expect(facts[0].metadata.raw_value).toBe('11.5 in');
  });

  it('filters role-restricted fields and fails closed for unsupported units and dimensions', () => {
    const facts = [fact('Unknown rating', '150 bananas')];
    const targets = reviewedSemanticTargetsForFacts(facts, facts, [acquisition]);
    expect(targets.map((target) => target.canonical_field)).not.toContain(
      'battery.nominal_capacity_ah',
    );
    expect(() =>
      previewReviewedSemanticMapping('electrical.continuous_output_current_a', facts, facts, [
        acquisition,
      ]),
    ).toThrow();
    expect(() =>
      previewReviewedSemanticMapping('dimensions_mm.x', [fact('Unknown length', '10 A')], facts, [
        acquisition,
      ]),
    ).toThrow();
  });

  it('maps explicit range targets using the same contract as automatic proposals', () => {
    const rangeFacts = [fact('unlisted output voltage range', '230-240 V')];
    const rangeProposals = prepare(rangeFacts).proposals;
    expect(rangeProposals[0].disposition).toBe('unsupported');
    const rangeDecision = decision(rangeFacts, rangeProposals, rangeProposals[0], {
      outcome: 'map',
      target: 'electrical.output_voltage_range_v',
      normalized_value: { min: 230, max: 240 },
      normalized_unit: 'V',
      rationale: 'The retained assertion states the product output voltage range.',
    });
    expect(rebuild(rangeFacts, [rangeDecision]).bridge.candidate?.component_data).toEqual({
      electrical: { output_voltage_range_v: { min: 230, max: 240 } },
    });
  });

  it('does not discard electrical-domain qualifiers absent from the decision contract', () => {
    const facts = [fact('unlisted output voltage range', '230-240 V AC')];
    const proposals = prepare(facts).proposals;
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome: 'map',
      target: 'electrical.output_voltage_range_v',
      normalized_value: { min: 230, max: 240 },
      normalized_unit: 'V',
      rationale: 'The target has a voltage-range shape.',
    });
    expect(() => rebuild(facts, [reviewed])).toThrow(/qualifiers not represented/i);
  });

  it('maps an unsupported automatic proposal without changing the automatic proposal', () => {
    const facts = [fact('Maximum steady output', '150A')];
    const { proposals } = prepare(facts);
    const proposal = proposals[0];
    expect(proposal.disposition).toBe('unsupported');
    const reviewed = decision(facts, proposals, proposal, {
      outcome: 'map',
      target: 'electrical.continuous_output_current_a',
      normalized_value: 150,
      normalized_unit: 'A',
      rationale: 'The retained output-current row states 150 A.',
    });
    const first = rebuild(facts, [reviewed]);
    const secondAutomatic = prepare(facts);
    expect(first.bridge.candidate?.component_data).toEqual({
      electrical: { continuous_output_current_a: 150 },
    });
    expect(first.bridge.proposals).toEqual(proposals);
    expect(secondAutomatic.proposals).toEqual(proposals);
    expect(first.bridge.reviewed_semantic_interpretation.entries[0].state).toBe('human_mapped');
    expect(facts[0].metadata.raw_value).toBe('150A');
  });

  it('rejects a schema-valid reviewed value not supported by retained source evidence', () => {
    const facts = [fact('Maximum steady output', '150A')];
    const { proposals } = prepare(facts);
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome: 'map',
      target: 'electrical.continuous_output_current_a',
      normalized_value: 999,
      normalized_unit: 'A',
      rationale: 'The reviewer selected an unsupported value.',
    });
    expect(() => rebuild(facts, [reviewed])).toThrow(/not supported by retained source fact/i);
  });

  it('requires all selected facts to normalize to the same reviewed value', () => {
    const facts = [
      fact('Unlisted output amperage', '150A'),
      fact('Unlisted output amperage', '160A'),
    ];
    const { proposals } = prepare(facts);
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome: 'map',
      target: 'electrical.continuous_output_current_a',
      normalized_value: 150,
      normalized_unit: 'A',
      rationale: 'The selected source rows state one output current.',
    });
    expect(() => rebuild(facts, [reviewed])).toThrow(
      /not supported by retained source fact|consistent normalized value/i,
    );
  });

  it('resolves an unresolved proposal using explicit evidence', () => {
    const facts = [fact('Output ampacity', '150 A', { conditions: ['at 25 C'] })];
    const { proposals } = prepare(facts);
    expect(proposals[0].disposition).toBe('unresolved');
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome: 'map',
      target: 'electrical.continuous_output_current_a',
      normalized_value: 150,
      normalized_unit: 'A',
      rationale: 'The retained row identifies continuous output current.',
    });
    expect(rebuild(facts, [reviewed]).bridge.candidate?.component_data).toEqual({
      electrical: { continuous_output_current_a: 150 },
    });
  });

  it('retains an automatic target correction separately from the original proposal', () => {
    const facts = [fact('Continuous current', '150 A')];
    const { proposals } = prepare(facts);
    expect(proposals[0]).toMatchObject({
      disposition: 'mapped',
      target: 'electrical.continuous_current_a',
    });
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome: 'map',
      target: 'electrical.continuous_output_current_a',
      normalized_value: 150,
      normalized_unit: 'A',
      rationale: 'This value is stated for the output path, not the input path.',
    });
    const result = rebuild(facts, [reviewed]);
    expect(result.bridge.proposals[0].target).toBe('electrical.continuous_current_a');
    expect(result.bridge.candidate?.component_data).toEqual({
      electrical: { continuous_output_current_a: 150 },
    });
  });

  it('recovers a source unit only from explicit raw evidence without mutating the qualified fact', () => {
    const facts = [fact('Output ampacity', '150A', { source_unit: 'unknown' })];
    const { proposals } = prepare(facts);
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome: 'map',
      target: 'electrical.continuous_output_current_a',
      normalized_value: 150,
      normalized_unit: 'A',
      source_unit: 'A',
      rationale: 'The raw source value explicitly includes A.',
    });
    const result = rebuild(facts, [reviewed]);
    expect(facts[0].metadata.source_unit).toBe('unknown');
    expect(result.bridge.facts[0]).toMatchObject({
      raw_value: '150A',
      raw_unit: 'unknown',
      normalized_value: 150,
      normalized_unit: 'A',
      normalization: {
        method: 'semantic_normalization',
        source_unit: 'A',
        normalized_unit: 'A',
      },
    });
  });

  it('shares raw unit recovery between validation and reconstruction without a reviewed source unit', () => {
    const facts = [fact('Output ampacity', '150A', { source_unit: 'unknown' })];
    const { proposals } = prepare(facts);
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome: 'map',
      target: 'electrical.continuous_output_current_a',
      normalized_value: 150,
      normalized_unit: 'A',
      rationale: 'The retained assertion explicitly states 150 A.',
    });
    expect(reviewed.source_unit).toBeUndefined();
    const result = rebuild(facts, [reviewed]);
    expect(result.bridge.reviewed_semantic_interpretation.entries[0].state).toBe('human_mapped');
    expect(result.bridge.non_projected).toEqual([]);
    expect(result.bridge.candidate?.component_data).toEqual({
      electrical: { continuous_output_current_a: 150 },
    });
    expect(result.bridge.facts[0]).toMatchObject({
      raw_value: '150A',
      raw_unit: 'unknown',
      normalized_value: 150,
      normalized_unit: 'A',
      normalization: {
        method: 'semantic_normalization',
        source_unit: 'A',
        normalized_unit: 'A',
      },
    });
    expect(facts[0].metadata.source_unit).toBe('unknown');
    expect(facts[0].metadata.raw_value).toBe('150A');
  });

  it('uses descriptor role and region eligibility for target normalization', () => {
    const target = 'battery.nominal_capacity_ah';
    const batteryContext = {
      role: 'battery' as const,
      region: 'battery_specs' as const,
      vocabulary_version: 'test',
      vocabulary_digest: `sha256:${'a'.repeat(64)}`,
    };
    expect(productionSemanticFieldDescriptor(target)).toBeUndefined();
    expect(normalizeProductionSemanticTarget(target, '150 Ah', undefined)).toBeUndefined();
    for (const region of ['battery_specs', 'battery_charge', 'body_dimensions'] as const) {
      const context = { ...batteryContext, region };
      const descriptor = productionSemanticFieldDescriptor(target, context.role, context.region);
      const normalized = normalizeProductionSemanticTarget(target, '150 Ah', undefined, context);
      expect(normalized === undefined).toBe(descriptor === undefined);
      expect(productionSemanticValueMatchesTarget(target, 150, context.role, context.region)).toBe(
        descriptor !== undefined,
      );
      if (descriptor) expect(normalized?.value).toBe(150);
    }
  });

  it('records exact inch-to-millimetre conversion as normalization, not derivation', () => {
    const facts = [fact('Width', '7.09 in')];
    const { proposals } = prepare(facts);
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome: 'map',
      target: 'dimensions_mm.x',
      normalized_value: 180.086,
      normalized_unit: 'mm',
      rationale: 'The source identifies this measurement as product width.',
    });
    const result = rebuild(facts, [reviewed]);
    expect(result.bridge.candidate?.component_data).toEqual({
      dimensions_mm: { x: 180.086 },
    });
    expect(result.bridge.facts[0]).toMatchObject({
      raw_value: '7.09 in',
      normalized_value: 180.086,
      normalized_unit: 'mm',
      normalization: {
        method: 'unit_conversion',
        source_unit: 'in',
        normalized_unit: 'mm',
      },
    });
    expect(result.bridge.facts[0].derivation).toBeUndefined();
    expect(result.bridge.candidate?.derived_fields).toBeUndefined();
    expect(facts[0].metadata.raw_value).toBe('7.09 in');
  });

  it('keeps automatic source conversion typed and separate from calculated derivation', () => {
    const facts = [fact('Weight', '80.8 lb')];
    const result = rebuild(facts);
    expect(result.bridge.candidate?.component_data).toHaveProperty('weight_kg');
    expect(result.bridge.facts[0]).toMatchObject({
      raw_value: '80.8 lb',
      normalized_unit: 'kg',
      normalization: {
        method: 'unit_conversion',
        source_unit: 'lb',
        normalized_unit: 'kg',
      },
    });
    expect(result.bridge.facts[0].derivation).toBeUndefined();
    expect(result.bridge.candidate?.derived_fields).toBeUndefined();
  });

  it('rebuilds selected evidence deterministically across independent sources', () => {
    const otherCapture: SourceCaptureArtifact = {
      ...capture,
      id: 'capture.reviewed-semantic-datasheet',
      requested_uri: 'https://example.invalid/specification',
      final_uri: 'https://example.invalid/specification',
      source_provenance: { publisher: 'Example technical documents' },
    };
    const otherAcquisition: SourceAcquisitionArtifact = {
      ...acquisition,
      id: 'acquisition.reviewed-semantic-datasheet',
      seed_capture: artifactReference('source_capture', otherCapture),
      deterministic_snapshot: `sha256:${'b'.repeat(64)}`,
    };
    const facts = [
      fact('Continuous current', '150 A'),
      buildQualifiedFactArtifact({
        source_capture: artifactReference('source_capture', otherCapture),
        source_acquisition: artifactReference('source_acquisition', otherAcquisition),
        metadata: {
          source_wording: 'Continuous current: 150 A',
          source_label: 'Continuous current',
          raw_value: '150 A',
          applicability: { kind: 'exact_mpn_or_sku', value: 'MPN' },
        },
        qualification_state: 'exact',
      }),
    ];
    const acquisitions = [acquisition, otherAcquisition];
    const reconciliation = reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: acquisitions,
    });
    const proposals = buildProductionSemanticProposals({
      facts,
      source_acquisitions: acquisitions,
      reconciliation,
    });
    const proposal = proposals[0];
    const firstFactRef = artifactReference(
      'qualified_fact',
      facts[0],
      facts[0].id,
      facts[0].schema_version,
    );
    const snapshot = reviewedSemanticInputSnapshot({
      intake,
      source_acquisitions: acquisitions,
      facts,
      reconciliation,
      proposals,
    });
    const reviewed: ReviewedSemanticDecision = {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'reviewed_semantic_decision',
      id: 'decision.selected-source',
      revision: 1,
      proposal_ref: artifactReference(
        'semantic_proposal',
        proposal,
        proposal.id,
        proposal.schema_version,
      ),
      fact_refs: proposal.fact_refs as ReviewedSemanticDecision['fact_refs'],
      selected_fact_refs: [firstFactRef],
      input_snapshot: snapshot,
      outcome: 'map',
      target: 'electrical.continuous_output_current_a',
      normalized_value: 150,
      normalized_unit: 'A',
      rationale: 'The product page row explicitly describes output current.',
      actor: { kind: 'operator_label', identifier: 'maintainer' },
      recorded_at: '2026-01-02T00:00:00Z',
      validation_policy_version: 'reviewed-semantic.v1',
    };
    const rebuild = () =>
      buildProductionProductCandidate({
        intake,
        captures: [capture, otherCapture],
        source_acquisitions: acquisitions,
        facts,
        reconciliation,
        proposals,
        reviewed_semantic_decisions: [reviewed],
      });
    const first = rebuild();
    const replay = rebuild();
    expect(first.facts.map((item) => item.raw_value)).toEqual(['150 A']);
    expect(first.sources).toHaveLength(1);
    expect(first.sources[0].uri).toBe(capture.final_uri);
    expect(first.candidate?.component_data).toEqual({
      electrical: { continuous_output_current_a: 150 },
    });
    expect(first).toEqual(replay);
  });

  it.each([
    ['evidence_only', 'evidence_only'],
    ['schema_gap', 'schema_gap'],
    ['reject', 'reject'],
    ['not_applicable', 'not_applicable'],
    ['unresolved', 'unresolved'],
  ] as const)('retains %s as a distinct non-projecting decision', (outcome, state) => {
    const facts = [fact('Mystery electrical rating', '150A')];
    const { proposals } = prepare(facts);
    const reviewed = decision(facts, proposals, proposals[0], {
      outcome,
      ...(outcome === 'schema_gap'
        ? {
            schema_gap: {
              concept_key: 'electrical.output_ampacity',
              explanation: 'No canonical output-ampacity field exists.',
            },
            rationale: 'A canonical target is missing.',
          }
        : outcome === 'reject'
          ? { rationale: 'The extracted statement is incorrectly scoped.' }
          : outcome === 'not_applicable'
            ? { rationale: 'This assertion does not apply to this exact product.' }
            : {}),
    });
    const result = rebuild(facts, [reviewed]);
    expect(result.bridge.candidate).toBeUndefined();
    expect(result.bridge.reviewed_semantic_interpretation.entries[0].state).toBe(state);
    expect(result.bridge.reviewed_semantic_decisions).toEqual([reviewed]);
  });

  it('rejects unsupported targets, incompatible values, units, roles, and foreign facts', () => {
    const facts = [fact('Mystery current', '150A')];
    const { proposals } = prepare(facts);
    const proposal = proposals[0];
    const invalid = (overrides: Partial<ReviewedSemanticDecision>) =>
      decision(facts, proposals, proposal, {
        outcome: 'map',
        target: 'electrical.continuous_output_current_a',
        normalized_value: 150,
        normalized_unit: 'A',
        rationale: 'Reviewer interpretation.',
        ...overrides,
      });
    expect(() => rebuild(facts, [invalid({ target: 'electrical.not_a_field' })])).toThrow(
      /unsupported|not supported/i,
    );
    expect(() => rebuild(facts, [invalid({ target: 'manufacturer' })])).toThrow(
      /unsupported|not supported/i,
    );
    expect(() => rebuild(facts, [invalid({ normalized_value: '150 A' })])).toThrow(
      /satisfy canonical target/i,
    );
    expect(() => rebuild(facts, [invalid({ normalized_unit: 'V' })])).toThrow(/requires unit/i);
    expect(() =>
      rebuild(facts, [
        invalid({
          target: 'battery.nominal_capacity_ah',
          normalized_value: 150,
          normalized_unit: 'Ah',
        }),
      ]),
    ).toThrow(/incompatible for this fact context|unsupported|not supported/i);
    expect(() =>
      rebuild(facts, [
        invalid({
          selected_fact_refs: [artifactReference('qualified_fact', facts[0], 'foreign-fact')],
        }),
      ]),
    ).toThrow(/selected facts|missing or foreign qualified facts/i);
  });

  it('requires rationale for not-applicable while allowing evidence-only and unresolved without boilerplate', () => {
    const facts = [fact('Mystery electrical rating', '150A')];
    const { proposals } = prepare(facts);
    const notApplicable = decision(facts, proposals, proposals[0], {
      outcome: 'not_applicable',
    });
    expect(() => rebuild(facts, [notApplicable])).toThrow(/requires a rationale/i);
    for (const outcome of ['evidence_only', 'unresolved'] as const) {
      const reviewed = decision(facts, proposals, proposals[0], { outcome });
      expect(
        rebuild(facts, [reviewed]).bridge.reviewed_semantic_interpretation.entries[0].state,
      ).toBe(outcome);
    }
  });

  it('marks changed-evidence decisions stale and falls back to the unchanged automatic result', () => {
    const originalFacts = [fact('Mystery current', '150A')];
    const original = prepare(originalFacts);
    const oldDecision = decision(originalFacts, original.proposals, original.proposals[0], {
      outcome: 'map',
      target: 'electrical.continuous_output_current_a',
      normalized_value: 150,
      normalized_unit: 'A',
      rationale: 'Reviewed mapping.',
    });
    const changedFacts = [fact('Mystery current', '175A')];
    const result = rebuild(changedFacts, [oldDecision]);
    expect(result.bridge.candidate).toBeUndefined();
    expect(result.bridge.reviewed_semantic_interpretation.stale_decision_refs).toHaveLength(1);
    expect(
      result.bridge.reviewed_semantic_interpretation.entries.some(
        (entry) => entry.state === 'stale',
      ),
    ).toBe(true);
  });

  it('does not invent a semantic repair path when no qualified facts exist', () => {
    const result = rebuild([]);
    expect(result.proposals).toEqual([]);
    expect(result.bridge.candidate).toBeUndefined();
    expect(result.bridge.reviewed_semantic_interpretation.entries).toEqual([]);
  });
});
