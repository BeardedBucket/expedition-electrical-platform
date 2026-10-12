import { describe, expect, it } from 'vitest';
import {
  artifactDigest,
  artifactReference,
  buildProductionProductCandidate,
  buildProductionSemanticProposals,
  buildQualifiedFactArtifact,
  genericSemanticRules,
  recognizeSemanticAssertion,
  reconcileQualifiedFactsForWholeIntake,
  evaluateSemanticReviewCompletion,
  type QualifiedFactArtifact,
  type ProductIntake,
  type SourceCaptureArtifact,
  type SourceAcquisitionArtifact,
} from '../src/index.js';
import { buildLegacyProductionSemanticProposals } from '../src/production-semantic-bridge.js';

const intake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'synthetic.intake',
  manufacturer: 'Neutral',
  product_model: 'Model',
  manufacturer_part_number: 'MPN',
  official_product_uri: 'https://example.invalid/model',
};
const capture: SourceCaptureArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_capture',
  id: 'synthetic.capture',
  requested_uri: intake.official_product_uri!,
  final_uri: intake.official_product_uri,
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
  deterministic_snapshot: `sha256:${'a'.repeat(64)}`,
};
const fact = (
  label: string,
  value: string,
  unit?: string,
  overrides: Partial<QualifiedFactArtifact['metadata']> = {},
  state: QualifiedFactArtifact['qualification_state'] = 'exact',
) =>
  buildQualifiedFactArtifact({
    source_capture: artifactReference('source_capture', capture),
    source_acquisition: artifactReference('source_acquisition', acquisition),
    qualification_state: state,
    metadata: {
      source_wording: `${label}: ${value}`,
      source_label: label,
      raw_value: value,
      ...(unit ? { source_unit: unit } : {}),
      applicability: { kind: 'exact_mpn_or_sku', value: 'MPN' },
      ...overrides,
    },
  });
const run = (facts: QualifiedFactArtifact[]) => {
  const input = {
    facts,
    source_acquisitions: [acquisition],
    reconciliation: reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: [acquisition],
    }),
  };
  const proposals = buildProductionSemanticProposals(input);
  const bridge = buildProductionProductCandidate({
    ...input,
    intake,
    captures: [capture],
    proposals,
  });
  return { ...input, proposals, bridge };
};
describe('generic semantic assertion architecture', () => {
  it('preserves qualifier assertion text and abstains on missing or blank qualifier text', () => {
    for (const role of ['qualifier', 'context'] as const) {
      const base = fact('Weight', '2', 'kg');
      const text = {
        ...base,
        evidence: [
          {
            role,
            text: 'with optional cover',
            locator: { path: '/fixture/condition' },
            note: 'structural origin',
          },
        ],
      };
      if (role === 'qualifier') {
        expect(recognizeSemanticAssertion(text)?.qualifiers.source_conditions).toContain(
          'with optional cover',
        );
        expect(run([text]).proposals[0].qualified_value).toMatchObject({
          target: 'weight_kg',
          qualifiers: { source_conditions: ['with optional cover'] },
        });
      } else {
        // Context text may be extraction-profile provenance. Its evidence role
        // does not establish that this is a manufacturer rating condition.
        expect(recognizeSemanticAssertion(text)?.qualifiers.source_conditions).toBeUndefined();
        expect(recognizeSemanticAssertion(text)?.review_required_reasons).toContain(
          'qualifier_context_unresolved',
        );
        expect(run([text]).bridge.projected_proposal_ids).toEqual([]);
      }
      for (const evidence of [
        { role, locator: { path: '/fixture/a' }, note: 'condition exists' },
        { role, text: '   ' },
      ]) {
        const conditioned = { ...base, evidence: [evidence] };
        expect(recognizeSemanticAssertion(conditioned)?.review_required_reasons).toContain(
          'qualifier_context_unresolved',
        );
        const r = run([conditioned]);
        expect(r.proposals.every((p) => p.disposition !== 'mapped')).toBe(true);
        expect(r.bridge.projected_proposal_ids).toEqual([]);
      }
    }
    const unconditioned = run([fact('Weight', '2', 'kg')]);
    expect(unconditioned.bridge.candidate?.component_data.weight_kg).toBe(2);
  });
  it('does not merge equal values with different uninterpretable qualifier evidence into agreement', () => {
    const base = fact('Weight', '2', 'kg');
    const a = buildQualifiedFactArtifact({
      ...base,
      evidence: [{ role: 'qualifier', locator: { path: '/fixture/a' } }],
    });
    const b = buildQualifiedFactArtifact({
      ...base,
      evidence: [{ role: 'qualifier', locator: { path: '/fixture/b' } }],
    });
    const r = run([a, b]);
    const assertions = r.proposals.filter((p) => p.semantic_assertions);
    expect(assertions).toHaveLength(2);
    expect(
      assertions.every((p) => p.disposition === 'unresolved' && p.fact_refs!.length === 1),
    ).toBe(true);
    expect(r.bridge.projected_proposal_ids).toEqual([]);
  });
  it('abstains on invalid battery-voltage conditions and ranges without a range target', () => {
    expect(
      recognizeSemanticAssertion(fact('Operating Power – 0 volt battery', '800', 'W'))
        ?.review_required_reasons,
    ).toContain('battery_voltage_condition_unresolved');
    expect(
      recognizeSemanticAssertion(fact('Nominal voltage', '12-24', 'V'))?.review_required_reasons,
    ).toContain('value_or_unit_unresolved');
    expect(
      run([fact('Operating Power – 0 volt battery', '800', 'W')]).proposals.every(
        (p) => p.disposition !== 'mapped',
      ),
    ).toBe(true);
  });
  it('rejects voltage-range overflow rather than projecting an invalid rating', () => {
    expect(
      recognizeSemanticAssertion(fact('Input voltage range', `1-${'9'.repeat(400)}`, 'V'))
        ?.review_required_reasons,
    ).toContain('value_or_unit_unresolved');
  });
  it.each([
    ['Max. Rated Output Current', '40', 'A', 'output_current', 40],
    ['DC charge current', '150A', undefined, 'charge_current', 150],
    ['Max DC Output Voltage', '18.0Vdc (custom battery type)', undefined, 'output_voltage', 18],
    ['Full Load Max AC Input Current', '25Arms', undefined, 'input_current', 25],
    ['Peak efficiency', '99', '%', 'efficiency', 0.99],
    ['Full load efficiency', '>84%', undefined, 'efficiency', 0.84],
    ['Nominal max. Operating Power** – 12 volt battery', '800', 'W', 'operating_power', 800],
    ['Max. PV Open Circuit Voltage (Voc)', '150', 'volts', 'pv_open_circuit_voltage', 150],
    ['Surge power', '6000W (≤ 5sec)', undefined, 'peak_power', 6000],
    ['Peak output power', '6000', 'W', 'peak_power', 6000],
    ['AC frequency', '60', 'Hz', 'frequency', 60],
    ['Standby current', '20', 'mA', 'standby_current', 0.02],
    ['Nominal DC voltage', '24VDC', undefined, 'nominal_voltage', 24],
    ['Continuous power', '2', 'kW', 'continuous_power', 2000],
    ['Rated power', '2000', 'W', 'rated_power', 2000],
    ['Output AC frequency', '60', 'Hz', 'frequency', 60],
  ])('recognizes %s generically', (label, value, unit, concept, normalized) => {
    const f = fact(label, value, unit),
      a = recognizeSemanticAssertion(f)!;
    expect(a).toMatchObject({
      concept,
      normalized_value: normalized,
      review_required_reasons: [],
      projection: 'qualified',
    });
    expect(a.rule.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(a.source_fact_digest).toBe(artifactDigest(f));
  });
  it('retains maximum rated domain without inventing continuous current', () => {
    const current = fact('Max. Rated Output Current', '40', 'A');
    const context = fact('Power Type - AC DC', 'DC TO DC');
    const { proposals, bridge } = run([current, context]);
    const proposal = proposals.find((p) => p.semantic_assertions)!;
    expect(proposal.qualified_value).toMatchObject({
      target: 'electrical.output_current_a',
      value: 40,
      qualifiers: { electrical_domain: 'dc', rating_basis: 'rated_maximum', direction: 'output' },
    });
    expect(bridge.candidate?.component_data).not.toHaveProperty('electrical.continuous_current_a');
    expect(bridge.projected_proposal_ids).toContain(proposal.id);
  });
  it('does not inherit a legacy maximum-charge-current alias as a continuous rating', () => {
    const r = run([fact('Maximum charge current', '40', 'A')]);
    expect(r.proposals[0]).toMatchObject({
      disposition: 'mapped',
      qualified_value: {
        target: 'electrical.charge_current_a',
        value: 40,
        qualifiers: { rating_basis: 'maximum' },
      },
    });
    expect(r.bridge.candidate?.component_data).not.toHaveProperty(
      'electrical.continuous_charge_current_a',
    );
  });
  it('retains voltage, full source conditions, duration, temperature and revision separately', () => {
    const f = fact('Nominal max. Operating Power** – 12 volt battery', '800', 'W', {
      conditions: ['Custom programming required; controller limits output current.'],
      duration: '10 s',
      temperature_context: '25 C',
      revision_context: 'rev B',
    });
    const { proposals, bridge } = run([f]);
    expect(proposals[0].qualified_value).toMatchObject({
      value: 800,
      qualifiers: {
        battery_voltage_v: 12,
        duration: '10 s',
        temperature_context: '25 C',
        revision_context: 'rev B',
        source_conditions: expect.arrayContaining(f.metadata.conditions!),
      },
    });
    expect(bridge.candidate?.component_data).not.toHaveProperty('electrical.operating_power_w');
    expect(bridge.candidate?.component_data.qualified_values).toHaveLength(1);
    expect(bridge.facts[0].fact_state).toBe('provisional');
  });
  it('compares normalized equivalent aliases without treating different conditions as conflicts', () => {
    const a = fact('Max output current', '40', 'A', { conditions: ['at 25 C'] }),
      b = fact('Maximum output current', '40000', 'mA', { conditions: ['at 25 C'] }),
      c = fact('Maximum output current', '30', 'A', { conditions: ['at 50 C'] });
    const r = run([a, b, c]);
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals.every((p) => p.disposition === 'mapped')).toBe(true);
    expect(r.proposals.map((p) => p.fact_refs?.length).sort()).toEqual([1, 2]);
    expect(run([c, b, a]).proposals).toEqual(r.proposals);
    expect(run([c, b, a]).bridge).toEqual(r.bridge);
  });
  it('retains same-context conflict and cannot project a winner', () => {
    const r = run([
      fact('Max output current', '40', 'A'),
      fact('Maximum output current', '41', 'A'),
    ]);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].disposition).toBe('conflicting');
    expect(r.bridge.projected_proposal_ids).toHaveLength(0);
    expect(
      evaluateSemanticReviewCompletion(r.proposals, r.bridge.reviewed_semantic_interpretation)
        .complete,
    ).toBe(false);
  });
  it.each([
    { duration: 'unknown', derivation: 'estimated' },
    { alternative_interpretations: ['charge or discharge'] },
    { applicability: { kind: 'family_only' as const, value: 'Family' } },
    { applicability: { kind: 'unresolved' as const } },
    { source_unit: 'W' },
  ])('keeps unresolved evidence non-authoritative: %j', (overrides) => {
    const r = run([fact('Max output current', '40', 'A', overrides)]);
    expect(r.proposals[0].disposition).toBe('unresolved');
    expect(r.bridge.projected_proposal_ids).toHaveLength(0);
  });
  it.each(['ambiguous', 'unresolved', 'rejected'] as const)(
    'withholds %s qualification',
    (state) => {
      expect(run([fact('Max output current', '40', 'A', {}, state)]).proposals[0].disposition).toBe(
        'unresolved',
      );
    },
  );
  it('abstains on missing domain and conflicting source domain evidence', () => {
    expect(
      recognizeSemanticAssertion(fact('Frequency', '60', 'Hz'))?.review_required_reasons,
    ).toContain('electrical_domain_required');
    expect(
      recognizeSemanticAssertion(fact('AC input voltage', '24VDC'))?.review_required_reasons,
    ).toContain('competing_electrical_domains');
    const f = fact('Output current', '40', 'A'),
      peers = [f, fact('Power Type - AC DC', 'DC TO DC'), fact('Power Type - AC DC', 'AC TO DC')];
    expect(recognizeSemanticAssertion(f, peers)?.review_required_reasons).toContain(
      'conversion_domain_unresolved',
    );
    expect(
      recognizeSemanticAssertion(f, [
        f,
        fact('Power Type - AC DC', 'DC TO DC', undefined, { conditions: ['selected mode'] }),
      ])?.review_required_reasons,
    ).toContain('conversion_domain_context_unresolved');
  });
  it.each(['unrecognized current', 'Maximum output current approximate', 'storage amount'])(
    'does not infer concept from fuzzy label %s',
    (label) => {
      expect(recognizeSemanticAssertion(fact(label, '40', 'A'))).toBeUndefined();
    },
  );
  it('binds rule revisions and abstains on ambiguous installed rules', () => {
    const f = fact('Output current', '40', 'A'),
      r = genericSemanticRules.find((r) => r.concept === 'output_current')!;
    expect(
      recognizeSemanticAssertion(f, [f], [{ ...r, revision: r.revision + 1 }])?.rule.digest,
    ).not.toBe(recognizeSemanticAssertion(f)?.rule.digest);
    expect(recognizeSemanticAssertion(f, [f], [r, { ...r, id: 'competing' }])).toBeUndefined();
  });
  it('requires explicit source product role for generic battery quantities without using names or category', () => {
    const f = fact('Nominal capacity', '100', 'Ah');
    expect(recognizeSemanticAssertion(f)?.review_required_reasons).toContain(
      'product_role_required',
    );
    const role = fact('Product type', 'Battery');
    const r = run([f, role]);
    const proposal = r.proposals.find((p) => p.target === 'battery.nominal_capacity_ah')!;
    expect(proposal).toMatchObject({
      disposition: 'mapped',
      qualified_value: { value: 100, qualifiers: { product_role: 'battery' } },
    });
    expect(r.bridge.projected_proposal_ids).toContain(proposal.id);
    const competing = fact('Product role', 'Charger');
    expect(recognizeSemanticAssertion(f, [f, role, competing])?.review_required_reasons).toContain(
      'product_role_required',
    );
    expect(
      recognizeSemanticAssertion(f, [
        f,
        fact('Product type', 'Battery', undefined, { conditions: ['optional module'] }),
      ])?.review_required_reasons,
    ).toContain('product_role_required');
    expect(
      recognizeSemanticAssertion(f, [
        f,
        { ...role, source_capture: artifactReference('source_capture', { id: 'other' }) },
      ])?.review_required_reasons,
    ).toContain('product_role_required');
    expect(
      recognizeSemanticAssertion(fact('Nominal energy', '1.2', 'kWh'), [role])?.normalized_value,
    ).toBe(1200);
    expect(
      recognizeSemanticAssertion(fact('Charge voltage range', '14.2-14.6', 'V'), [role])
        ?.normalized_value,
    ).toEqual({ min: 14.2, max: 14.6 });
  });
  it('rejects stale generic proposals and retains frozen legacy replay', () => {
    const r = run([fact('Output current', '40', 'A')]);
    const tampered = r.proposals.map((p) => ({ ...p, proposed_value: 400 }));
    expect(() =>
      buildProductionProductCandidate({ ...r, intake, captures: [capture], proposals: tampered }),
    ).toThrow(/stale or foreign/);
    const legacy = buildLegacyProductionSemanticProposals(r);
    expect(() =>
      buildProductionProductCandidate({ ...r, intake, captures: [capture], proposals: legacy }),
    ).not.toThrow();
  });
  it('rejects unsafe maximum-to-continuous scalar replay from frozen legacy proposals', () => {
    const r = run([fact('Maximum charge current', '40', 'A')]);
    const legacy = buildLegacyProductionSemanticProposals(r);
    expect(
      legacy.some(
        (p) => p.target === 'electrical.continuous_charge_current_a' && p.disposition === 'mapped',
      ),
    ).toBe(true);
    const replay = buildProductionProductCandidate({
      ...r,
      intake,
      captures: [capture],
      proposals: legacy,
    });
    expect(replay.projected_proposal_ids).toEqual([]);
    expect(replay.non_projected.some((p) => p.reason.includes('legacy scalar replay'))).toBe(true);
  });
});
