import { describe, expect, it } from 'vitest';
import {
  artifactReference,
  buildProductionProductCandidate,
  buildProductionSemanticProposals,
  buildQualifiedFactArtifact,
  PRODUCTION_SCHEMA_VERSION,
  reconcileQualifiedFactsForWholeIntake,
  type ProductIntake,
  type QualifiedFactArtifact,
  type SourceAcquisitionArtifact,
  type SourceCaptureArtifact,
} from '../src/index.js';

const intake: ProductIntake = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.example',
  manufacturer: 'Example',
  product_model: 'Model',
  manufacturer_part_number: 'MPN',
  official_product_uri: 'https://example.invalid/product',
};

const capture = (publisher: string | undefined = 'Example'): SourceCaptureArtifact => ({
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_capture',
  id: 'capture.example',
  requested_uri: 'https://example.invalid/product',
  final_uri: 'https://example.invalid/product',
  retrieved_at: '2026-01-01T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'not_retained',
  ...(publisher ? { source_provenance: { publisher } } : {}),
});

const acquisition = (source: SourceCaptureArtifact): SourceAcquisitionArtifact => ({
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_acquisition',
  id: 'acquisition.example',
  intake: artifactReference('product_intake', intake),
  seed_capture: artifactReference('source_capture', source),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});

const fact = (
  source: SourceCaptureArtifact,
  acquired: SourceAcquisitionArtifact | undefined,
  label: string | undefined,
  value: string,
  overrides: Partial<QualifiedFactArtifact['metadata']> = {},
): QualifiedFactArtifact =>
  buildQualifiedFactArtifact({
    source_capture: artifactReference('source_capture', source),
    ...(acquired ? { source_acquisition: artifactReference('source_acquisition', acquired) } : {}),
    metadata: {
      source_wording: `${label ?? 'unlabeled'} ${value}`,
      ...(label ? { source_label: label } : {}),
      raw_value: value,
      source_unit: 'V',
      applicability: { kind: 'exact_mpn_or_sku', value: 'MPN' },
      ...overrides,
    },
    qualification_state: 'exact',
  });

const run = (
  facts: readonly QualifiedFactArtifact[],
  acquisitions: readonly SourceAcquisitionArtifact[],
  captures: readonly SourceCaptureArtifact[],
) => {
  const reconciliation = reconcileQualifiedFactsForWholeIntake({
    facts,
    source_acquisitions: acquisitions,
  });
  const proposals = buildProductionSemanticProposals({
    facts,
    source_acquisitions: acquisitions,
    reconciliation,
  });
  return buildProductionProductCandidate({
    intake,
    captures,
    source_acquisitions: acquisitions,
    facts,
    reconciliation,
    proposals,
  });
};

const pair = (source: SourceCaptureArtifact, acquired: SourceAcquisitionArtifact) => [
  fact(source, acquired, 'nominal voltage', '24'),
  fact(source, acquired, 'nominal voltage', '24.0'),
];

describe('production candidate bridge', () => {
  it('projects a singleton model binding as a model source claim only', () => {
    const source = capture();
    const acquired = acquisition(source);
    const only = fact(source, acquired, 'nominal voltage', '24', {
      applicability: { kind: 'exact_product', value: 'Model' },
    });
    const result = run([only], [acquired], [source]);
    expect(result.sources[0].product_identity_claim).toEqual({ model: 'Model' });
    expect(result.candidate).toMatchObject({
      identity: { manufacturer: 'Example', model: 'Model', manufacturer_part_number: 'MPN' },
      identity_status: 'provisional',
      identity_source_ids: [result.sources[0].id],
      review_status: 'pending',
      promotion_status: 'review_required',
      review_reasons: ['fact_review_required'],
    });
    expect(result.facts[0]).toMatchObject({ fact_state: 'provisional', review_required: true });
  });

  it('retains exact manufacturer MPN verification for a singleton while requiring fact review', () => {
    const source = capture();
    const acquired = acquisition(source);
    const result = run([fact(source, acquired, 'nominal voltage', '24')], [acquired], [source]);
    expect(result.sources[0].product_identity_claim).toEqual({ manufacturer_part_number: 'MPN' });
    expect(result.candidate).toMatchObject({
      identity_status: 'verified',
      identity: { manufacturer: 'Example', model: 'Model', manufacturer_part_number: 'MPN' },
      review_status: 'pending',
      promotion_status: 'review_required',
    });
    expect(result.facts[0]).toMatchObject({ fact_state: 'provisional', review_required: true });
  });

  it.each(['capture', 'acquisition'] as const)(
    'rejects singleton projection without authoritative official %s',
    (boundary) => {
      const source = {
        ...capture(),
        ...(boundary === 'capture' ? { disposition: 'non_authoritative' as const } : {}),
      };
      const acquired = {
        ...acquisition(source),
        ...(boundary === 'acquisition' ? { officiality: 'unofficial' as const } : {}),
      };
      const result = run([fact(source, acquired, 'nominal voltage', '24')], [acquired], [source]);
      expect(result.candidate).toBeUndefined();
      expect(result.non_projected[0].reason).toContain('authoritative official');
    },
  );
  it('projects exact product model facts without inventing an MPN source claim', () => {
    const source = capture();
    const acquired = acquisition(source);
    const facts = ['24', '24.0'].map((value) =>
      fact(source, acquired, 'nominal voltage', value, {
        applicability: { kind: 'exact_product', value: 'Model' },
      }),
    );
    const result = run(facts, [acquired], [source]);
    expect(result.candidate?.component_data).toEqual({ electrical: { nominal_voltage_v: 24 } });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].product_identity_claim).toEqual({ model: 'Model' });
    expect(
      result.qualified_facts.every((fact) => fact.metadata.applicability.kind === 'exact_product'),
    ).toBe(true);
  });
  it('projects a safely mapped production proposal through existing candidate construction', () => {
    const source = capture();
    const acquired = acquisition(source);
    const result = run(pair(source, acquired), [acquired], [source]);
    expect(result.candidate?.component_data).toEqual({ electrical: { nominal_voltage_v: 24 } });
    expect(result.projected_proposal_ids).toHaveLength(1);
  });

  it('keeps evidence-only unsupported unresolved and conflicting proposals out of candidate data', () => {
    const source = capture();
    const acquired = acquisition(source);
    const facts = [
      fact(source, acquired, 'maximum pv open-circuit voltage', '24'),
      fact(source, acquired, 'maximum pv open-circuit voltage', '24.0'),
      fact(source, acquired, 'mystery rating', '24'),
      fact(source, acquired, 'mystery rating', '24.0'),
      fact(source, acquired, 'continuous current', '24', { conditions: ['at 25 C'] }),
      fact(source, acquired, 'continuous current', '24.0'),
      fact(source, acquired, 'nominal voltage', '24'),
      fact(source, acquired, 'nominal voltage', '25'),
    ];
    const result = run(facts, [acquired], [source]);
    expect(result.candidate).toBeUndefined();
    expect(result.non_projected.map((item) => item.reason).sort()).toEqual([
      'disposition: conflicting',
      'disposition: evidence_only',
      'disposition: unresolved',
      'disposition: unsupported',
    ]);
    expect(result.proposals).toHaveLength(4);
  });

  it('dereferences qualified facts instead of treating proposed value as complete source data', () => {
    const source = capture();
    const acquired = acquisition(source);
    const facts = [
      fact(source, acquired, 'nominal voltage', '24000', { source_unit: 'mV' }),
      fact(source, acquired, 'nominal voltage', '24', { source_unit: 'V' }),
    ];
    const result = run(facts, [acquired], [source]);
    expect(result.facts.map((item) => [item.raw_value, item.raw_unit]).sort()).toEqual([
      ['24', 'V'],
      ['24000', 'mV'],
    ]);
    expect(result.sources[0].publisher).toBe('Example');
    expect(result.sources[0].uri).toBe(source.final_uri);
    expect(result.candidate?.component_data).toEqual({ electrical: { nominal_voltage_v: 24 } });
  });

  it('preserves production F mechanical agreement through existing candidate construction', () => {
    const source = capture();
    const acquired = acquisition(source);
    const facts = [
      fact(source, acquired, 'nominal voltage', '0.7', { source_unit: 'V' }),
      fact(source, acquired, 'nominal voltage', '700', { source_unit: 'mV' }),
    ];
    expect(0.7).not.toBe(700 * 0.001);
    const reconciliation = reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: [acquired],
    });
    expect(reconciliation.group_reconciliations[0].outcome).toBe('agreement');
    const proposals = buildProductionSemanticProposals({
      facts,
      source_acquisitions: [acquired],
      reconciliation,
    });
    expect(proposals[0].disposition).toBe('mapped');
    const result = buildProductionProductCandidate({
      intake,
      captures: [source],
      source_acquisitions: [acquired],
      facts,
      reconciliation,
      proposals,
    });
    expect(result.projected_proposal_ids).toEqual([proposals[0].id]);
    expect(result.facts.map((item) => [item.raw_value, item.raw_unit]).sort()).toEqual([
      ['0.7', 'V'],
      ['700', 'mV'],
    ]);
    expect(result.normalized_facts.map((item) => item.normalized_value).sort()).toEqual(
      [0.7, 700 * 0.001].sort(),
    );
    expect(result.candidate?.component_data).toEqual({ electrical: { nominal_voltage_v: 0.7 } });
  });

  it('does not fabricate source identity or applicability to make a proposal eligible', () => {
    const source = { ...capture(), source_provenance: {} };
    const acquired = acquisition(source);
    const missingPublisher = run(pair(source, acquired), [acquired], [source]);
    expect(missingPublisher.candidate).toBeUndefined();
    expect(missingPublisher.non_projected[0].reason).toMatch(/publisher/);
    const complete = capture();
    const completeAcquisition = acquisition(complete);
    const wrongIdentity = pair(complete, completeAcquisition).map((item) => ({
      ...item,
      metadata: { ...item.metadata, applicability: { kind: 'unresolved' as const } },
    }));
    const unresolved = run(wrongIdentity, [completeAcquisition], [complete]);
    expect(unresolved.candidate).toBeUndefined();
    expect(unresolved.non_projected).toHaveLength(1);
  });

  it('does not mark projected production evidence verified from F agreement or semantic mapping', () => {
    const source = capture();
    const acquired = acquisition(source);
    const result = run(pair(source, acquired), [acquired], [source]);
    expect(
      result.facts.every((item) => item.fact_state === 'provisional' && item.review_required),
    ).toBe(true);
    expect(result.candidate?.review_status).toBe('pending');
  });

  it('rejects a stale or foreign semantic proposal set', () => {
    const source = capture();
    const acquired = acquisition(source);
    const facts = pair(source, acquired);
    const reconciliation = reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: [acquired],
    });
    const proposals = buildProductionSemanticProposals({
      facts,
      source_acquisitions: [acquired],
      reconciliation,
    });
    expect(() =>
      buildProductionProductCandidate({
        intake,
        captures: [source],
        source_acquisitions: [acquired],
        facts,
        reconciliation,
        proposals: [{ ...proposals[0], proposed_value: 25 }],
      }),
    ).toThrow(/stale or foreign/);
  });

  it('preserves production proposal identity alongside candidate field evidence', () => {
    const source = capture();
    const acquired = acquisition(source);
    const result = run(pair(source, acquired), [acquired], [source]);
    const proposalId = result.projected_proposal_ids[0];
    expect(result.candidate?.field_evidence['electrical.nominal_voltage_v']).toEqual(
      result.proposal_fact_ids[proposalId],
    );
    expect(result.proposals[0].fact_refs).toHaveLength(2);
    expect(result.qualified_facts).toHaveLength(2);
  });

  it('produces deterministic projection when equivalent inputs are reordered', () => {
    const source = capture();
    const acquired = acquisition(source);
    const facts = pair(source, acquired);
    expect(run(facts, [acquired], [source])).toEqual(
      run([...facts].reverse(), [acquired], [source]),
    );
  });
});
