import { describe, expect, it } from 'vitest';
import {
  artifactReference,
  buildProductionSemanticProposals,
  buildQualifiedFactArtifact,
  PRODUCTION_SCHEMA_VERSION,
  reconcileQualifiedFactsForWholeIntake,
  type QualifiedFactArtifact,
  type SourceAcquisitionArtifact,
} from '../src/index.js';

const capture = (id: string) => ({
  kind: 'source_capture' as const,
  reference_schema_version: PRODUCTION_SCHEMA_VERSION,
  digest: `sha256:${id.padEnd(64, 'a')}`,
  digest_algorithm: 'sha256' as const,
});

const acquisition = (id: string): SourceAcquisitionArtifact => ({
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_acquisition',
  id,
  intake: artifactReference('product_intake', {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'product_intake',
    id: 'intake',
    manufacturer: 'Example',
    product_model: 'Model',
    manufacturer_part_number: 'MPN',
    official_product_uri: 'https://example.invalid/product',
  }),
  seed_capture: capture(`seed-${id}`),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});

const fact = (
  id: string,
  source: SourceAcquisitionArtifact | undefined,
  label: string | undefined,
  value: string,
  overrides: Partial<QualifiedFactArtifact['metadata']> = {},
  qualificationState: QualifiedFactArtifact['qualification_state'] = 'exact',
): QualifiedFactArtifact => buildQualifiedFactArtifact({
  source_capture: capture(`fact-${id}`),
  ...(source ? { source_acquisition: artifactReference('source_acquisition', source) } : {}),
  metadata: {
    source_wording: label ?? 'Nominal voltage is stated as 24 V',
    ...(label ? { source_label: label } : {}),
    raw_value: value,
    source_unit: 'V',
    applicability: { kind: 'exact_product', value: 'MPN' },
    ...overrides,
  },
  qualification_state: qualificationState,
});

const bridge = (facts: readonly QualifiedFactArtifact[], sources: readonly SourceAcquisitionArtifact[]) => {
  const reconciliation = reconcileQualifiedFactsForWholeIntake({ facts, source_acquisitions: sources });
  return buildProductionSemanticProposals({ facts, source_acquisitions: sources, reconciliation });
};

describe('production semantic proposal bridge', () => {
  it('maps agreed exact labels with all fact and evidence references', () => {
    const source = acquisition('source');
    const proposals = bridge([fact('a', source, 'nominal voltage', '24'), fact('b', source, 'nominal voltage', '24.0')], [source]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ target: 'electrical.nominal_voltage_v', disposition: 'mapped', proposed_value: 24 });
    expect(proposals[0].fact_refs).toHaveLength(2);
    expect(proposals[0].evidence_refs).toHaveLength(3);
    expect(proposals[0].input_artifact_digests).toContain(proposals[0].fact_refs?.[0].digest);
  });

  it('allows structurally supported evidence to map after safe F agreement', () => {
    const source = acquisition('source');
    const exact = fact('exact', source, 'nominal voltage', '24');
    const supported = fact('supported', source, 'nominal voltage', '24', {}, 'structurally_supported');
    const reconciliation = reconcileQualifiedFactsForWholeIntake({
      facts: [exact, supported], source_acquisitions: [source],
    });
    expect(reconciliation.group_reconciliations[0].outcome).toBe('agreement');
    expect(buildProductionSemanticProposals({
      facts: [exact, supported], source_acquisitions: [source], reconciliation,
    })[0]).toMatchObject({ disposition: 'mapped', proposed_value: 24 });
  });

  it('preserves F mechanical numeric agreement through semantic mapping', () => {
    const source = acquisition('source');
    const volts = fact('volts', source, 'nominal voltage', '0.7');
    const millivolts = fact('millivolts', source, 'nominal voltage', '700', { source_unit: 'mV' });
    expect(0.7).not.toBe(700 * 0.001);
    const facts = [volts, millivolts];
    const reconciliation = reconcileQualifiedFactsForWholeIntake({ facts, source_acquisitions: [source] });
    expect(reconciliation.group_reconciliations[0].outcome).toBe('agreement');
    const proposal = buildProductionSemanticProposals({ facts, source_acquisitions: [source], reconciliation })[0];
    const first = [...facts].sort((left, right) => left.id.localeCompare(right.id))[0];
    expect(proposal).toMatchObject({ target: 'electrical.nominal_voltage_v', disposition: 'mapped' });
    expect(proposal.proposed_value).toBe(first.metadata.source_unit === 'mV' ? 700 * 0.001 : 0.7);
  });

  it('keeps an explicit evidence target evidence only', () => {
    const source = acquisition('source');
    const proposals = bridge([fact('a', source, 'maximum pv open-circuit voltage', '24'), fact('b', source, 'maximum pv open-circuit voltage', '24')], [source]);
    expect(proposals[0]).toMatchObject({ target: 'electrical.max_pv_voltage_v', disposition: 'evidence_only' });
    expect(proposals[0]).not.toHaveProperty('proposed_value');
  });

  it('preserves an unknown label without a canonical target', () => {
    const source = acquisition('source');
    const proposals = bridge([fact('a', source, 'mystery rating', '24'), fact('b', source, 'mystery rating', '24')], [source]);
    expect(proposals[0]).toMatchObject({ target: 'source_label:mystery rating', disposition: 'unsupported' });
  });

  it('never uses source wording when the source label is missing', () => {
    const source = acquisition('source');
    const proposals = bridge([fact('a', source, undefined, '24')], [source]);
    expect(proposals[0]).toMatchObject({ target: 'source_label:unavailable', disposition: 'unresolved' });
    expect(proposals[0]).not.toHaveProperty('proposed_value');
  });

  it('retains every conflicting fact without selecting a value', () => {
    const source = acquisition('source');
    const proposals = bridge([fact('a', source, 'nominal voltage', '24'), fact('b', source, 'nominal voltage', '25')], [source]);
    expect(proposals[0].disposition).toBe('conflicting');
    expect(proposals[0].fact_refs).toHaveLength(2);
    expect(proposals[0]).not.toHaveProperty('proposed_value');
  });

  it('leaves unresolved, unscoped, inconsistent, and label-unavailable facts non-selected', () => {
    const source = acquisition('source');
    const proposals = bridge([
      fact('singleton', source, 'nominal voltage', '24'),
      fact('unscoped', undefined, 'continuous current', '5'),
      fact('missing', source, undefined, '24'),
    ], [source]);
    expect(proposals).toHaveLength(3);
    expect(proposals.every((proposal) => proposal.disposition === 'unresolved' && !('proposed_value' in proposal))).toBe(true);
    const inconsistent = { ...fact('inconsistent', source, 'nominal voltage', '24'), acquisition_candidate_id: 'missing-candidate' };
    expect(bridge([inconsistent], [source])[0].disposition).toBe('unresolved');
  });

  it('does not strip context or qualification to map an unconditional value', () => {
    const source = acquisition('source');
    const contextual = fact('a', source, 'nominal voltage', '24', { conditions: ['at 25 C'] });
    const other = fact('b', source, 'nominal voltage', '24');
    const proposals = bridge([contextual, other], [source]);
    expect(proposals[0].disposition).toBe('unresolved');
    expect(proposals[0]).not.toHaveProperty('proposed_value');
    expect(proposals[0].fact_refs).toHaveLength(2);
    expect(proposals[0].alternatives?.some((alternative) => alternative.rationale.includes('at 25 C'))).toBe(true);
    const domainA = fact('domain-a', source, 'nominal voltage', '24', { source_unit: 'VDC' });
    const domainB = fact('domain-b', source, 'nominal voltage', '24', { source_unit: 'VDC' });
    expect(bridge([domainA, domainB], [source])[0].disposition).toBe('unresolved');
  });

  it('keeps IDs and ordering stable when equivalent inputs are reordered and rejects stale F', () => {
    const first = acquisition('first');
    const second = acquisition('second');
    const a = fact('a', first, 'nominal voltage', '24');
    const b = fact('b', second, 'nominal voltage', '24');
    expect(bridge([a, b], [first, second])).toEqual(bridge([b, a], [second, first]));
    const reconciliation = reconcileQualifiedFactsForWholeIntake({ facts: [a, b], source_acquisitions: [first, second] });
    expect(() => buildProductionSemanticProposals({ facts: [a], source_acquisitions: [first, second], reconciliation })).toThrow(/inconsistent/);
  });
});
