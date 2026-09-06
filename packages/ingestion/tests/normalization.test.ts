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
  applicability: 'direct_identity',
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
      canonicalFieldMappings
        .filter((mapping) => mapping.target_kind !== 'evidence')
        .every((mapping) => isSupportedCanonicalField(mapping.canonical_field)),
    ).toBe(true);
    expect(canonicalFieldMappings.some((mapping) => mapping.target_kind === 'evidence')).toBe(true);
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
    [
      '2,000 VA',
      'Continuous power at 25°C (Nonlinear load, crest factor 3:1)',
      'VA',
      2000,
      'electrical.apparent_power_va',
    ],
    [
      '1,600 W',
      'Continuous inverter AC output power at 25°C',
      'W',
      1600,
      'electrical.continuous_power_w',
    ],
    ['120 VAC', 'AC output voltage ±2% (adjustable)', 'VAC', 120, 'electrical.ac_output_voltage_v'],
    ['60 Hz', 'AC output frequency ±0.1% (adjustable)', 'Hz', 60, 'electrical.frequency_hz'],
    [
      '50 A',
      'Maximum charge current (up to 25°C ambient)',
      'A',
      50,
      'electrical.continuous_charge_current_a',
    ],
    ['24 mV', 'Nominal voltage', 'mV', 0.024, 'electrical.nominal_voltage_v'],
    ['2 kW', 'Continuous output power', 'kW', 2000, 'electrical.continuous_power_w'],
    ['2 kVA', 'Apparent power', 'kVA', 2000, 'electrical.apparent_power_va'],
    ['2 kg', 'Weight', 'kg', 2, 'weight_kg'],
    ['255 mm', 'Width', 'mm', 255, 'dimensions_mm.x'],
    ['520 mm', 'Height', 'mm', 520, 'dimensions_mm.z'],
    ['125 mm', 'Depth', 'mm', 125, 'dimensions_mm.y'],
    ['0.5 m', 'Width', 'm', 500, 'dimensions_mm.x'],
    ['12 cm', 'Depth', 'cm', 120, 'dimensions_mm.y'],
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

  it.each([
    ['520 x 255 x 125 mm', 'Dimensions'],
    ['520 x 255 x 125 mm', 'Overall size'],
    ['520 x 255 x 125 mm', 'Overall dimensions'],
  ])('does not resolve unlabeled compound dimensions %s', (raw_value, raw_label) => {
    expect(normalize({ raw_label, raw_value, raw_unit: undefined })).toMatchObject({
      status: 'unresolved',
      issues: [{ code: 'normalization_unmapped_field' }],
    });
  });

  it('keeps reconciled dimension data separate from service clearances and orientation rules', () => {
    const width = normalize({
      id: 'acme.fact.width',
      raw_label: 'Width',
      raw_value: '255 mm',
      raw_unit: 'mm',
    });
    const depth = normalize({
      id: 'acme.fact.depth',
      raw_label: 'Depth',
      raw_value: '125 mm',
      raw_unit: 'mm',
    });
    const height = normalize({
      id: 'acme.fact.height',
      raw_label: 'Height',
      raw_value: '520 mm',
      raw_unit: 'mm',
    });
    const candidate = buildProductCandidate({
      id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [width.fact!.fact, depth.fact!.fact, height.fact!.fact],
      normalized_facts: [width.fact!, depth.fact!, height.fact!],
    });
    expect(candidate.component_data).toMatchObject({
      dimensions_mm: { x: 255, y: 125, z: 520 },
    });
    expect(candidate.component_data).not.toHaveProperty('service_clearances_mm');
    expect(candidate.component_data).not.toHaveProperty('orientation_constraint');
  });

  it('normalizes explicit mounting evidence without inferring a face or world orientation', () => {
    const result = normalize({
      id: 'acme.fact.mounting',
      raw_label: 'Allowed mounting orientation',
      raw_value: 'vertical mounting only',
      raw_unit: undefined,
    });
    expect(result).toMatchObject({
      status: 'normalized',
      fact: {
        canonical_field: 'mounting.allowed_orientation',
        normalized_value: { vocabulary: 'vertical' },
        fact: {
          source_id: 'acme.manual',
          id: 'acme.fact.mounting',
          raw_label: 'Allowed mounting orientation',
          raw_value: 'vertical mounting only',
        },
      },
    });
    const candidate = buildProductCandidate({
      id: 'acme.mounting',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [result.fact!.fact],
      normalized_facts: [result.fact!],
    });
    expect(candidate.component_data).toEqual({});
    expect(candidate.component_data).not.toHaveProperty('dimensions_mm');
    expect(candidate.component_data).not.toHaveProperty('orientation_constraint');
  });

  it.each(['vertical', 'mount upright; do not mount upside down'])(
    'leaves ambiguous mounting prose unresolved: %s',
    (raw_value) => {
      expect(
        normalize({
          raw_label: 'Allowed mounting orientation',
          raw_value,
          raw_unit: undefined,
        }),
      ).toMatchObject({
        status: 'unresolved',
        issues: [{ code: 'normalization_ambiguous_mounting' }],
      });
    },
  );

  it('keeps prohibited mounting evidence distinct from allowed evidence', () => {
    expect(
      normalize({
        id: 'acme.fact.prohibited',
        raw_label: 'Prohibited mounting orientation',
        raw_value: 'do not mount upside down',
        raw_unit: undefined,
      }),
    ).toMatchObject({
      status: 'normalized',
      fact: { normalized_value: { vocabulary: 'upside_down' } },
    });
  });

  it('does not infer a mounting face from wall-mount evidence', () => {
    const result = normalize({
      raw_label: 'Mounting method',
      raw_value: 'wall mount',
    });
    expect(result).toMatchObject({
      status: 'normalized',
      fact: { normalized_value: { vocabulary: 'wall_mount' } },
    });
    expect(result.fact?.canonical_field).toBe('mounting.method');
  });

  it('normalizes face-relative clearance evidence into separate categories', () => {
    const service = normalize({
      id: 'acme.fact.service',
      raw_label: 'Service clearance x_min',
      raw_value: '0 mm',
      raw_unit: 'mm',
    });
    const ventilation = normalize({
      id: 'acme.fact.ventilation',
      raw_label: 'Ventilation clearance z_max',
      raw_value: '25 cm',
      raw_unit: 'cm',
    });
    const cable = normalize({
      id: 'acme.fact.cable',
      raw_label: 'Cable access clearance y_max',
      raw_value: '10 mm',
      raw_unit: 'mm',
    });
    expect(service.fact).toMatchObject({
      canonical_field: 'clearance.service.x_min',
      normalized_value: 0,
    });
    expect(ventilation.fact).toMatchObject({
      canonical_field: 'clearance.ventilation.z_max',
      normalized_value: 250,
    });
    const candidate = buildProductCandidate({
      id: 'acme.clearances',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [service.fact!.fact, ventilation.fact!.fact, cable.fact!.fact],
      normalized_facts: [service.fact!, ventilation.fact!, cable.fact!],
    });
    expect(candidate.component_data).toEqual({});
    expect(candidate.component_data).not.toHaveProperty('dimensions_mm');
    expect(candidate.component_data).not.toHaveProperty('required_installation_envelope');
  });

  it('keeps vague directional clearance unresolved and does not treat missing as zero', () => {
    expect(
      normalize({ raw_label: 'Service clearance', raw_value: '25 mm', raw_unit: 'mm' }),
    ).toMatchObject({
      status: 'unresolved',
      issues: [{ code: 'normalization_unmapped_field' }],
    });
    expect(
      normalize({ raw_label: 'Service clearance front', raw_value: '0 mm', raw_unit: 'mm' }),
    ).toMatchObject({
      status: 'unresolved',
      issues: [{ code: 'normalization_unmapped_field' }],
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

  it('allows distinct allowed and prohibited orientation evidence to coexist', () => {
    const allowed = normalize({
      id: 'acme.fact.allowed',
      raw_label: 'Allowed mounting orientation',
      raw_value: 'vertical mounting only',
    });
    const prohibited = normalize({
      id: 'acme.fact.prohibited',
      raw_label: 'Prohibited mounting orientation',
      raw_value: 'do not mount upside down',
    });
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [allowed.fact!.fact, prohibited.fact!.fact],
      normalized_facts: [allowed.fact!, prohibited.fact!],
    });
    expect(result.conflicts).toEqual([]);
    expect(result.fields.map((field) => field.field)).toEqual([
      'mounting.allowed_orientation',
      'mounting.prohibited_orientation',
    ]);
  });

  it('conflicts when the same clearance semantic target has incompatible values', () => {
    const first = normalize({
      id: 'acme.fact.service.first',
      raw_label: 'Service clearance x_min',
      raw_value: '25 mm',
      raw_unit: 'mm',
    });
    const second = normalize({
      id: 'acme.fact.service.second',
      raw_label: 'Service clearance x_min',
      raw_value: '50 mm',
      raw_unit: 'mm',
    });
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [first.fact!.fact, second.fact!.fact],
      normalized_facts: [first.fact!, second.fact!],
    });
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        code: 'reconciliation_value_conflict',
        field: 'clearance.service.x_min',
      }),
    ]);
  });

  it('keeps canonical and evidence targets separate even when field strings collide', () => {
    const canonical = normalize({
      id: 'acme.fact.canonical-collision',
      raw_label: 'Width',
      raw_value: '255 mm',
      raw_unit: 'mm',
    });
    const evidence = {
      ...canonical.fact!,
      target_kind: 'evidence' as const,
      canonical_field: 'dimensions_mm.x',
      fact: {
        ...canonical.fact!.fact,
        id: 'acme.fact.evidence-collision',
        field: 'dimensions_mm.x',
      },
    };
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [canonical.fact!.fact, evidence.fact],
      normalized_facts: [canonical.fact!, evidence],
    });
    expect(result.conflicts).toEqual([]);
    expect(result.fields).toEqual([
      expect.objectContaining({
        field: 'dimensions_mm.x',
        target_kind: 'canonical',
        value: 255,
      }),
      expect.objectContaining({
        field: 'dimensions_mm.x',
        target_kind: 'evidence',
        value: 255,
      }),
    ]);
    const candidate = buildProductCandidate({
      id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [source()],
      facts: [canonical.fact!.fact, evidence.fact],
      normalized_facts: [canonical.fact!, evidence],
    });
    expect(candidate.component_data).toEqual({ dimensions_mm: { x: 255 } });
    expect(candidate.field_evidence).toEqual({
      'dimensions_mm.x': ['acme.fact.canonical-collision'],
    });
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

  it('does not let a new source with undefined applicability enter selected data by default', () => {
    const undefinedApplicabilitySource = source({
      id: 'acme.undefined-applicability',
      uri: 'https://example.invalid/undefined-applicability',
      applicability: undefined,
    });
    const undefinedResult = normalize(
      { id: 'acme.fact.undefined-applicability', source_id: 'acme.undefined-applicability' },
      undefinedApplicabilitySource,
    );
    const strictReconciliation = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [undefinedApplicabilitySource],
      facts: [undefinedResult.fact!.fact],
      normalized_facts: [undefinedResult.fact!],
    });
    expect(strictReconciliation.fields).toEqual([]);

    const strictCandidate = buildProductCandidate({
      id: 'acme.candidate.strict',
      identity: source().product_identity_claim ?? {},
      sources: [undefinedApplicabilitySource],
      facts: [undefinedResult.fact!.fact],
      normalized_facts: [undefinedResult.fact!],
    });
    expect(strictCandidate.component_data).not.toHaveProperty('electrical.nominal_voltage_v');

    // An intentionally identified legacy caller may still opt into the old
    // undefined-applicability-is-applicable behavior via an explicit flag.
    const legacyReconciliation = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [undefinedApplicabilitySource],
      facts: [undefinedResult.fact!.fact],
      normalized_facts: [undefinedResult.fact!],
      legacy_undefined_applicability: true,
    });
    expect(legacyReconciliation.fields).toHaveLength(1);

    const legacyCandidate = buildProductCandidate({
      id: 'acme.candidate.legacy',
      identity: source().product_identity_claim ?? {},
      sources: [undefinedApplicabilitySource],
      facts: [undefinedResult.fact!.fact],
      normalized_facts: [undefinedResult.fact!],
      legacy_undefined_applicability: true,
    });
    expect(legacyCandidate.component_data).toMatchObject({ electrical: { nominal_voltage_v: 24 } });
  });
});

describe('multi-source identity policy', () => {
  it.each([
    [
      'same exact identity from two official sources',
      {
        manufacturer: 'Acme Power',
        model: 'Model X24',
        manufacturer_part_number: 'X24-001',
      },
      {
        manufacturer: 'Acme Power',
        model: 'Model X24',
        manufacturer_part_number: 'X24-001',
      },
      'verified',
    ],
    [
      'one source omits optional suffix, second specifies it',
      {
        manufacturer: 'Acme Power',
        model: 'Model X24',
        manufacturer_part_number: 'X24-001',
      },
      {
        manufacturer: 'Acme Power',
        model: 'Model X24',
        manufacturer_part_number: 'X24-001',
        voltage_variant: '24V',
      },
      'verified',
    ],
    [
      'one source says V2 and another says V2-T',
      {
        manufacturer: 'Epoch',
        model: '24V 100Ah',
        manufacturer_part_number: 'E-24-100',
        voltage_variant: 'V2',
      },
      {
        manufacturer: 'Epoch',
        model: '24V 100Ah',
        manufacturer_part_number: 'E-24-100',
        voltage_variant: 'V2-T',
      },
      'conflicting',
    ],
    [
      'one source publishes exact SKU, another omits SKU',
      {
        manufacturer: 'Epoch',
        model: '24V 100Ah',
        manufacturer_part_number: 'E-24-100',
      },
      {
        manufacturer: 'Epoch',
        model: '24V 100Ah',
      },
      'verified',
    ],
    [
      'two defined SKUs differ',
      {
        manufacturer: 'Epoch',
        model: '24V 100Ah',
        manufacturer_part_number: 'E-24-100',
      },
      {
        manufacturer: 'Epoch',
        model: '24V 100Ah',
        manufacturer_part_number: 'E-24-101',
      },
      'conflicting',
    ],
  ])('handles identity claim comparison for %s', (_label, left, right, expected) => {
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: left,
      sources: [
        source({
          id: 'source.left',
          authority: 'manufacturer_product',
          product_identity_claim: left,
        }),
        source({
          id: 'source.right',
          authority: 'manufacturer_product',
          product_identity_claim: right,
        }),
      ],
      facts: [],
      normalized_facts: [],
    });
    expect(result.identity_status).toBe(expected);
  });

  it('normalizes whitespace without creating a false conflict', () => {
    const left = {
      manufacturer: 'Acme Power',
      model: 'Model   X24',
      manufacturer_part_number: 'X24-001',
    };
    const right = {
      manufacturer: 'acme power',
      model: 'Model X24',
      manufacturer_part_number: ' X24-001 ',
    };
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: left,
      sources: [
        source({ id: 'source.left', product_identity_claim: left }),
        source({ id: 'source.right', product_identity_claim: right }),
      ],
      facts: [],
      normalized_facts: [],
    });
    expect(result.identity_status).toBe('verified');
  });

  it('keeps raw source claims intact while comparing case-insensitive values', () => {
    const left = {
      manufacturer: 'ACME Power',
      model: 'Model X24',
      manufacturer_part_number: 'X24-001',
    };
    const right = {
      manufacturer: 'acme power',
      model: 'Model X24',
      manufacturer_part_number: 'x24-001',
    };
    const leftSource = source({ id: 'source.left', product_identity_claim: left });
    const rightSource = source({ id: 'source.right', product_identity_claim: right });
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: left,
      sources: [leftSource, rightSource],
      facts: [],
      normalized_facts: [],
    });
    expect(result.identity_status).toBe('verified');
    expect(leftSource.product_identity_claim).toEqual(left);
    expect(rightSource.product_identity_claim).toEqual(right);
  });

  it('does not silently discard punctuation or suffixes during comparison', () => {
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: {
        manufacturer: 'Epoch',
        model: '24V 100Ah V2-T',
        manufacturer_part_number: 'E-24-100',
      },
      sources: [
        source({
          id: 'source.left',
          product_identity_claim: {
            manufacturer: 'Epoch',
            model: '24V 100Ah V2',
            manufacturer_part_number: 'E-24-100',
          },
        }),
        source({
          id: 'source.right',
          product_identity_claim: {
            manufacturer: 'Epoch',
            model: '24V 100Ah V2-T',
            manufacturer_part_number: 'E-24-100',
          },
        }),
      ],
      facts: [],
      normalized_facts: [],
    });
    expect(result.identity_status).toBe('conflicting');
  });

  it('keeps lower-authority contradictory evidence visible instead of overriding stronger facts', () => {
    const technical = source({
      id: 'source.technical',
      authority: 'manufacturer_technical',
      product_identity_claim: {
        manufacturer: 'Epoch',
        model: '24V 100Ah',
        manufacturer_part_number: 'E-24-100',
        voltage_variant: 'V2',
      },
    });
    const distributor = source({
      id: 'source.distributor',
      authority: 'authorized_distributor',
      product_identity_claim: {
        manufacturer: 'Epoch',
        model: '24V 100Ah',
        manufacturer_part_number: 'E-24-100',
        voltage_variant: 'V2-T',
      },
    });
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: technical.product_identity_claim ?? {},
      sources: [technical, distributor],
      facts: [],
      normalized_facts: [],
    });
    expect(result.identity_status).toBe('conflicting');
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'reconciliation_variant_mismatch',
          source_ids: ['source.distributor', 'source.technical'],
        }),
      ]),
    );
  });
});

describe('multi-source fact policy', () => {
  it('treats equivalent mass and length units as the same normalized fact', () => {
    const lb = normalize({
      id: 'acme.fact.weight-lb',
      raw_label: 'Weight',
      raw_value: '5 lb',
      raw_unit: 'lb',
    });
    const kg = normalize({
      id: 'acme.fact.weight-kg',
      raw_label: 'Weight',
      raw_value: '2.26796185 kg',
      raw_unit: 'kg',
    });
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [
        source(),
        source({
          id: 'acme.page',
          authority: 'manufacturer_product',
          uri: 'https://example.invalid/page',
        }),
      ],
      facts: [lb.fact!.fact, kg.fact!.fact],
      normalized_facts: [lb.fact!, kg.fact!],
    });
    expect(result.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'weight_kg', value: 2.26796185 })]),
    );
  });

  it('treats equivalent inch and millimeter measurements as the same normalized fact', () => {
    const inches = normalize({
      id: 'acme.fact.width-in',
      raw_label: 'Width',
      raw_value: '10 in',
      raw_unit: 'in',
    });
    const millimeters = normalize({
      id: 'acme.fact.width-mm',
      raw_label: 'Width',
      raw_value: '254 mm',
      raw_unit: 'mm',
    });
    const result = reconcileProductFacts({
      candidate_id: 'acme.candidate',
      identity: source().product_identity_claim ?? {},
      sources: [
        source(),
        source({
          id: 'acme.page',
          authority: 'manufacturer_product',
          uri: 'https://example.invalid/page',
        }),
      ],
      facts: [inches.fact!.fact, millimeters.fact!.fact],
      normalized_facts: [inches.fact!, millimeters.fact!],
    });
    expect(result.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'dimensions_mm.x', value: 254 })]),
    );
  });
});
