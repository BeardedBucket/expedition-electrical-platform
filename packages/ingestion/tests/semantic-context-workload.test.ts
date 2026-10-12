import { describe, expect, it } from 'vitest';
import {
  artifactDigest,
  artifactReference,
  buildQualifiedFactArtifact,
  buildProductionSemanticProposals,
  buildProductionProductCandidate,
  reconcileQualifiedFactsForWholeIntake,
  evaluateSemanticReviewCompletion,
  qualifiedContext,
  recognizeSemanticAssertion,
  semanticRulesFor,
  replaySemanticAssertion,
  automaticEvidenceClassificationValid,
  SEMANTIC_RULE_INTERPRETER,
  validateProductionArtifactSchema,
  type QualifiedFactArtifact,
  type QualifiedFactEvidence,
  type ProductIntake,
  type SourceCaptureArtifact,
  type SourceAcquisitionArtifact,
} from '../src/index.js';
const intake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'synthetic.context',
  manufacturer: 'Neutral',
  product_model: 'Model',
  manufacturer_part_number: 'MPN',
};
const capture: SourceCaptureArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_capture',
  id: 'synthetic.capture',
  requested_uri: 'https://example.invalid',
  retrieved_at: '2026-01-01T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'not_retained',
  source_provenance: { publisher: 'Neutral' },
};
const acquisition: SourceAcquisitionArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_acquisition',
  id: 'synthetic.acquisition',
  intake: artifactReference('product_intake', intake),
  seed_capture: artifactReference('source_capture', capture),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: artifactDigest('context fixture'),
};
const fact = (
  label: string,
  value: string,
  unit?: string,
  evidence: QualifiedFactEvidence[] = [],
) =>
  buildQualifiedFactArtifact({
    source_capture: artifactReference('source_capture', capture),
    source_acquisition: artifactReference('source_acquisition', acquisition),
    qualification_state: 'exact',
    metadata: {
      source_wording: label,
      source_label: label,
      raw_value: value,
      ...(unit ? { source_unit: unit } : {}),
      applicability: { kind: 'exact_mpn_or_sku', value: 'MPN' },
    },
    evidence,
  });
const provenance = (): QualifiedFactEvidence => ({
  role: 'context',
  context: qualifiedContext('qualification_provenance', 'profile-qualified-evidence'),
  source_reference: artifactReference('source_capture', capture),
  text: 'arbitrary provenance text, not a condition',
});
const run = (facts: QualifiedFactArtifact[], interpreter?: 'semantic-assertions.v2') => {
  const input = {
    facts,
    source_acquisitions: [acquisition],
    reconciliation: reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: [acquisition],
    }),
  };
  const proposals = buildProductionSemanticProposals(input, interpreter);
  const bridge = buildProductionProductCandidate({
    ...input,
    intake,
    captures: [capture],
    proposals,
  });
  return {
    proposals,
    bridge,
    completion: evaluateSemanticReviewCompletion(
      proposals,
      bridge.reviewed_semantic_interpretation,
    ),
  };
};
describe('producer context and workload authority', () => {
  it('ignores only typed bound provenance while retaining all source evidence', () => {
    const f = fact('Weight', '2', 'kg', [provenance()]);
    const r = run([f]);
    expect(recognizeSemanticAssertion(f)?.review_required_reasons).toEqual([]);
    expect(r.bridge.candidate?.component_data.weight_kg).toBe(2);
    expect(r.bridge.qualified_facts[0]).toEqual(f);
    const old = recognizeSemanticAssertion(
      f,
      [f],
      semanticRulesFor('semantic-assertions.v2'),
      'semantic-assertions.v2',
    )!;
    expect(old.review_required_reasons).toContain('qualifier_context_unresolved');
    expect(replaySemanticAssertion(f, [f], old)).toEqual(old);
    expect(run([f], 'semantic-assertions.v2').bridge.projected_proposal_ids).toEqual([]);
  });
  it.each(['source_semantic', 'unresolved'] as const)(
    'preserves or abstains on typed %s and mixed context',
    (kind) => {
      const source: QualifiedFactEvidence = {
        role: 'context',
        context: qualifiedContext(kind, 'document-qualification'),
        text: 'at 25 C',
      };
      const f = fact('Weight', '2', 'kg', [provenance(), source]);
      const a = recognizeSemanticAssertion(f)!;
      if (kind === 'source_semantic') {
        expect(a.qualifiers.source_conditions).toEqual(['at 25 C']);
        expect(run([f]).proposals[0].qualified_value).toBeDefined();
      } else {
        expect(a.review_required_reasons).toContain('qualifier_context_unresolved');
        expect(run([f]).bridge.projected_proposal_ids).toEqual([]);
      }
      expect(run([f]).bridge.candidate?.component_data.weight_kg).toBeUndefined();
    },
  );
  it.each([
    { role: 'context', text: 'reviewed profile seemingly harmless' },
    { ...provenance(), context: undefined },
    { ...provenance(), source_reference: artifactReference('source_capture', { id: 'foreign' }) },
    { ...provenance(), context: { ...provenance().context!, producer_revision: 3 } },
    {
      role: 'qualifier',
      context: qualifiedContext('source_semantic', 'document-qualification'),
      locator: { path: '/condition' },
    },
  ] as QualifiedFactEvidence[])(
    'abstains on legacy/foreign/unsupported/missing-text context %#',
    (e) => {
      const f = fact('Weight', '2', 'kg', [e]);
      expect(recognizeSemanticAssertion(f)?.review_required_reasons).toContain(
        'qualifier_context_unresolved',
      );
      expect(run([f]).bridge.projected_proposal_ids).toEqual([]);
    },
  );
  it.each([
    'Brand',
    'Manufacturer name',
    'gtin_barcode',
    'UPC',
    'Catalog Number',
    'OEM MODEL #',
    'Product Name',
    'Packaging Type',
    'Warranty',
  ])('closes exact retained %s without a projection or human event', (label) => {
    const f = fact(label, 'retained raw statement', undefined, [
      { role: 'context', text: 'legacy unknown context retained' },
    ]);
    const r = run([f]),
      p = r.proposals[0];
    expect(p.disposition).toBe('evidence_only');
    expect(automaticEvidenceClassificationValid(p)).toBe(true);
    expect(validateProductionArtifactSchema(p)).toEqual([]);
    expect(p.evidence_classification?.assertions[0].source_fact).toEqual(f);
    expect(r.completion.complete).toBe(true);
    expect(r.bridge.projected_proposal_ids).toEqual([]);
    expect(r.bridge.candidate).toBeUndefined();
    expect(run([f], 'semantic-assertions.v2').completion.complete).toBe(false);
  });
  it.each([
    'Warranty Voltage',
    'Installation restriction',
    'CE and RoHS compliant',
    'IEC 62109',
    'Safety',
    'Product Type',
    'Category',
    'unknown label',
  ])('keeps uncovered or engineering-sensitive %s human-reviewable', (label) => {
    const r = run([fact(label, 'source statement')]);
    expect(r.proposals[0].evidence_classification).toBeUndefined();
    expect(r.completion.complete).toBe(false);
  });
  it('rejects forged classification proof and bare evidence-only labels at completion', () => {
    const r = run([fact('Warranty', '2 years')]),
      p = r.proposals[0];
    for (const q of [
      { ...p, evidence_classification: undefined },
      { ...p, proposed_value: 2 },
      {
        ...p,
        evidence_classification: { ...p.evidence_classification!, policy_version: 'unknown' },
      },
      {
        ...p,
        evidence_classification: {
          ...p.evidence_classification!,
          assertions: p.evidence_classification!.assertions.map((a) => ({
            ...a,
            rule_digest: artifactDigest('forged'),
          })),
        },
      },
    ] as (typeof p)[]) {
      expect(automaticEvidenceClassificationValid(q)).toBe(false);
      expect(
        evaluateSemanticReviewCompletion([q], r.bridge.reviewed_semantic_interpretation).complete,
      ).toBe(false);
    }
  });
  it('keeps a source-native conflict for retained identifiers as human work', () => {
    // F can mechanically compare numeric-looking catalog identifiers. Identity
    // classification must not erase that recorded conflict or select a source.
    const r = run([fact('Catalog Number', '123 V'), fact('Catalog Number', '124 V')]);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].disposition).toBe('conflicting');
    expect(r.proposals[0].evidence_classification).toBeUndefined();
    expect(r.completion.complete).toBe(false);
  });
  it.each([
    ['Product weight', '2', 'kg', 'weight_kg', 2],
    ['Solar input voltage', '10-30', 'V', 'electrical.input_voltage_v', { min: 10, max: 30 }],
    ['AC Frequency (configurable)', '60', 'Hz', 'electrical.frequency_hz', 60],
    ['Physical body height', '2', 'in', 'dimensions_mm.z', 50.8],
    ['Body width', '10', 'cm', 'dimensions_mm.x', 100],
    ['Body depth', '1', 'in', 'dimensions_mm.y', 25.4],
  ] as const)(
    'recognizes exact grammar %s with unit/condition provenance',
    (label, value, unit, target, normalized) => {
      const f = fact(label, value, unit, [provenance()]),
        r = run([f]);
      expect(r.proposals[0]).toMatchObject({
        target,
        disposition: 'mapped',
        proposed_value: normalized,
      });
      expect(r.bridge.projected_proposal_ids).toHaveLength(1);
      expect(r.proposals[0].semantic_assertions?.[0].rule.interpreter).toBe(
        SEMANTIC_RULE_INTERPRETER,
      );
    },
  );
  it('requires explicit physical-body scope and exact battery ownership', () => {
    const f = fact('Product height', '10', 'cm');
    expect(recognizeSemanticAssertion(f)?.review_required_reasons).toContain(
      'physical_body_scope_required',
    );
    expect(
      run([f, fact('Dimension scope', 'physical body', undefined, [provenance()])]).proposals.find(
        (p) => p.target === 'dimensions_mm.z',
      )?.disposition,
    ).toBe('mapped');
    const charger = fact('Max. charging voltage', '14', 'V');
    expect(recognizeSemanticAssertion(charger)?.review_required_reasons).toContain(
      'product_role_required',
    );
    const r = run([charger, fact('Product role', 'Battery', undefined, [provenance()])]);
    expect(r.proposals.find((p) => p.target === 'battery.charging_voltage_range_v')).toMatchObject({
      disposition: 'mapped',
      qualified_value: { qualifiers: { rating_basis: 'maximum', product_role: 'battery' } },
    });
  });
  it.each([
    ['Product weight', '2', 'A'],
    ['Solar input voltage', '12', 'Vac'],
    ['Frequency (configurable)', '60', 'Hz'],
    ['Body height', '10', 'kg'],
    ['Body width', '10', 'kg'],
    ['Body depth', '10', 'kg'],
    ['Max. charging voltage', '14', 'V'],
  ])('rejects dimensional/domain/role ambiguity %s', (label, value, unit) => {
    expect(run([fact(label, value, unit)]).bridge.projected_proposal_ids).toEqual([]);
  });
});
