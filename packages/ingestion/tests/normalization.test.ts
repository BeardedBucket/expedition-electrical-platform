import { describe, expect, it } from 'vitest';
import {
  buildProductCandidate,
  canonicalFieldMappings,
  isSupportedCanonicalField,
  normalizeProductFact,
  reconcileProductFacts,
  type ProductFact,
  type ProductSource,
} from '../src/index.js';

const source = (overrides: Partial<ProductSource> = {}): ProductSource => ({
  schema_version: '1.0',
  id: 'acme.manual',
  uri: 'https://example.invalid/manual',
  source_type: 'manufacturer_manual',
  authority: 'manufacturer_technical',
  publisher: 'Acme Power',
  retrieved_at: '2026-09-05T12:00:00Z',
  product_identity_claim: {
    manufacturer: 'Acme Power',
    product_family: 'Example Battery',
    model: 'Model X24',
    manufacturer_part_number: 'X24-001',
  },
  ...overrides,
});

const fact = (overrides: Partial<ProductFact> = {}): ProductFact => ({
  schema_version: '1.0',
  id: 'acme.fact.voltage',
  source_id: 'acme.manual',
  field: 'unmapped',
  raw_label: 'Nominal voltage',
  raw_value: '24 V',
  raw_unit: 'V',
  extraction_method: 'table',
  fact_state: 'provisional',
  review_required: true,
  ...overrides,
});

const normalize = (input: Partial<ProductFact> = {}, sourceOverride = source()) =>
  normalizeProductFact(fact(input), sourceOverride);

describe('product fact normalization', () => {
  it('maps only known labels and preserves raw evidence', () => {
    const result = normalize();
    expect(result.status).toBe('normalized');
    expect(result.fact).toMatchObject({
      canonical_field: 'electrical.nominal_voltage_v',
      normalized_value: 24,
      normalized_unit: 'V',
      fact: { raw_label: 'Nominal voltage', raw_value: '24 V', raw_unit: 'V' },
    });
  });

  it('keeps every explicit mapping destination backed by the component schema', () => {
    expect(
      canonicalFieldMappings.every((mapping) => isSupportedCanonicalField(mapping.canonical_field)),
    ).toBe(true);
  });

  it('leaves unknown labels unresolved without fuzzy matching', () => {
    expect(normalize({ raw_label: 'nominal voltages' })).toMatchObject({
      status: 'unresolved',
      issues: [{ code: 'normalization_unmapped_field' }],
    });
  });

  it.each([
    ['50 A', 'Continuous current', 'A', 50, 'electrical.continuous_current_a'],
    ['1600 W', 'Continuous output power', 'W', 1600, 'electrical.continuous_power_w'],
    ['2000 VA', 'Apparent power', 'VA', 2000, 'electrical.apparent_power_va'],
    ['24 mV', 'Nominal voltage', 'mV', 0.024, 'electrical.nominal_voltage_v'],
    ['2 kW', 'Continuous output power', 'kW', 2000, 'electrical.continuous_power_w'],
    ['2 kVA', 'Apparent power', 'kVA', 2000, 'electrical.apparent_power_va'],
    ['2 kg', 'Weight', 'kg', 2, 'weight_kg'],
    ['2 m', 'Length', 'm', 2000, 'dimensions_mm.x'],
  ])('normalizes exact %s values deterministically', (value, label, unit, expected, field) => {
    const result = normalize({ raw_label: label, raw_value: value, raw_unit: unit });
    expect(result).toMatchObject({
      status: 'normalized',
      fact: {
        normalized_value: expected,
        normalized_unit: expect.any(String),
        canonical_field: field,
      },
    });
  });

  it.each([
    ['up to 50 A', 'Continuous current'],
    ['50 A typical', 'Continuous current'],
    ['40-50 A', 'Continuous current'],
    ['2000 VA peak for 3 seconds', 'Apparent power'],
    ['12/24 V', 'Nominal voltage'],
  ])('does not collapse qualified or compound value %s', (raw_value, raw_label) => {
    expect(normalize({ raw_label, raw_value, raw_unit: undefined })).toMatchObject({
      status: 'unresolved',
      issues: [{ code: 'normalization_ambiguous_value' }],
    });
  });

  it('rejects unsupported units and cross-dimension conversion', () => {
    expect(normalize({ raw_unit: 'XYZ', raw_value: '50 XYZ' })).toMatchObject({
      status: 'unresolved',
      issues: [{ code: 'normalization_unsupported_unit' }],
    });
    expect(normalize({ raw_unit: 'A', raw_value: '50 A' })).toMatchObject({
      status: 'unresolved',
      issues: [{ code: 'normalization_dimension_mismatch' }],
    });
  });

  it('rejects non-finite numbers as invalid', () => {
    expect(normalize({ raw_value: 'NaN V', raw_unit: 'V' })).toMatchObject({
      status: 'unresolved',
      issues: [{ code: 'normalization_invalid_number' }],
    });
  });

  it('returns the same result for the same input', () => {
    expect(normalize()).toEqual(normalize());
  });
});

describe('product reconciliation and candidates', () => {
  it('reinforces agreeing evidence and records all fact IDs', () => {
    const first = normalize();
    const second = normalize(
      { id: 'acme.fact.voltage-page', source_id: 'acme.page' },
      source({
        id: 'acme.page',
        source_type: 'manufacturer_product_page',
        authority: 'manufacturer_product',
        uri: 'https://example.invalid/page',
      }),
    );
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [source(), second.fact?.source ?? source()],
      facts: [fact(), second.fact?.fact ?? fact({ id: 'acme.fact.voltage-page' })],
      normalized_facts: [first.fact!, second.fact!],
    });
    expect(result.fields[0].fact_ids).toEqual(['acme.fact.voltage', 'acme.fact.voltage-page']);
    expect(result.conflicts).toEqual([]);
  });

  it('preserves contradictions, variant mismatches, and review requirements', () => {
    const first = normalize();
    const conflicting = normalize({
      id: 'acme.fact.conflict',
      raw_value: '25 V',
    });
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [fact(), conflicting.fact!.fact],
      normalized_facts: [first.fact!, conflicting.fact!],
    });
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        code: 'reconciliation_value_conflict',
        fact_ids: ['acme.fact.conflict', 'acme.fact.voltage'],
        values: [25, 24],
      }),
    ]);
    expect(result.review_required).toBe(true);
  });

  it('retains a lower-authority contradiction instead of deleting it', () => {
    const technical = normalize();
    const distributorSource = source({
      id: 'acme.distributor',
      uri: 'https://example.invalid/distributor',
      authority: 'authorized_distributor',
    });
    const distributor = normalize(
      {
        id: 'acme.fact.distributor',
        source_id: 'acme.distributor',
        raw_value: '25 V',
      },
      distributorSource,
    );
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [distributorSource, source()],
      facts: [technical.fact!.fact, distributor.fact!.fact],
      normalized_facts: [distributor.fact!, technical.fact!],
    });
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        code: 'reconciliation_value_conflict',
        fact_ids: ['acme.fact.distributor', 'acme.fact.voltage'],
        source_ids: ['acme.distributor', 'acme.manual'],
      }),
    ]);
  });

  it('deduplicates repeated normalized evidence IDs deterministically', () => {
    const normalized = normalize();
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [fact()],
      normalized_facts: [normalized.fact!, normalized.fact!],
    });
    expect(result.fields[0].fact_ids).toEqual(['acme.fact.voltage']);
  });

  it('blocks merging source claims that disagree on an omitted variant field', () => {
    const first = source({
      product_identity_claim: {
        manufacturer: 'Acme Power',
        product_family: 'Example Battery',
        model: 'Model X24',
        manufacturer_part_number: 'X24-001',
        voltage_variant: '12 V',
      },
    });
    const second = source({
      id: 'acme.variant',
      uri: 'https://example.invalid/variant',
      product_identity_claim: {
        manufacturer: 'Acme Power',
        product_family: 'Example Battery',
        model: 'Model X24',
        manufacturer_part_number: 'X24-001',
        voltage_variant: '48 V',
      },
    });
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: {
        manufacturer: 'Acme Power',
        product_family: 'Example Battery',
        model: 'Model X24',
        manufacturer_part_number: 'X24-001',
      },
      sources: [second, first],
      facts: [],
      normalized_facts: [],
    });
    expect(result.identity_status).toBe('conflicting');
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        code: 'reconciliation_variant_mismatch',
        source_ids: ['acme.manual', 'acme.variant'],
      }),
    ]);
  });

  it('builds evidenced candidates without auto-approval or canonical writes', () => {
    const normalized = normalize();
    const candidate = buildProductCandidate({
      id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [fact()],
      normalized_facts: [normalized.fact!],
    });
    expect(candidate).toMatchObject({
      review_status: 'pending',
      promotion_status: 'review_required',
      component_data: { electrical: { nominal_voltage_v: 24 } },
      field_evidence: { 'electrical.nominal_voltage_v': ['acme.fact.voltage'] },
    });
  });

  it('is independent of input ordering', () => {
    const first = normalize();
    const second = normalize({
      id: 'acme.fact.current',
      raw_label: 'Continuous current',
      raw_value: '50 A',
      raw_unit: 'A',
    });
    const input = {
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [fact(), second.fact!.fact],
      normalized_facts: [first.fact!, second.fact!],
    };
    expect(reconcileProductFacts(input)).toEqual(
      reconcileProductFacts({
        ...input,
        facts: [...input.facts].reverse(),
        normalized_facts: [...input.normalized_facts].reverse(),
      }),
    );
  });
});
