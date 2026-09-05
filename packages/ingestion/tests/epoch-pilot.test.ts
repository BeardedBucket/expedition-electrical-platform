import { describe, expect, it } from 'vitest';
import {
  buildEpochCandidate,
  epochFacts,
  epochIdentity,
  epochSources,
  evaluateEpochIdentityGate,
  reconcileEpochSpecifications,
} from '../src/epoch-pilot.js';
import { evaluatePilotIdentityGate } from '../src/pilot-config.js';

describe('Epoch 24V 100Ah identity-first pilot', () => {
  it('resolves only the official product identity before admitting specifications', () => {
    expect(evaluateEpochIdentityGate()).toEqual({
      status: 'resolved',
      can_proceed_to_specification: true,
      required_fields: ['manufacturer', 'model', 'manufacturer_part_number'],
      missing_fields: [],
    });
    expect(epochIdentity).toEqual({
      manufacturer: 'Epoch Batteries',
      product_family: '24V Lithium Batteries',
      model: '24V 100Ah LiFePO4 Battery (2.56kWh)',
      manufacturer_part_number: 'B24100A-C',
      voltage_variant: '24V',
    });
  });

  it('preserves independent official source claims without synthesizing V2-T', () => {
    expect(epochSources.map((source) => source.product_identity_claim)).toEqual([
      {
        manufacturer: 'Epoch Batteries',
        model: '24V 100Ah LiFePO4 Battery (2.56kWh)',
        manufacturer_part_number: 'B24100A-C',
        voltage_variant: '24V',
      },
      {
        manufacturer: 'Epoch Batteries',
        product_family: '24V Lithium Batteries',
        voltage_variant: '24V',
      },
    ]);
    expect(
      epochSources.some((source) => source.product_identity_claim?.voltage_variant === 'V2-T'),
    ).toBe(false);
  });

  it('blocks specifications when an identity-bearing official source contradicts the SKU', () => {
    const contradictorySources = [
      ...epochSources,
      {
        ...epochSources[1],
        id: 'epoch-batteries.contradictory-source',
        product_identity_claim: {
          manufacturer: 'Epoch Batteries',
          model: '24V 100Ah LiFePO4 Battery (2.56kWh)',
          manufacturer_part_number: 'B24100A-D',
        },
      },
    ];
    expect(
      evaluatePilotIdentityGate(epochIdentity, contradictorySources, [
        'manufacturer',
        'model',
        'manufacturer_part_number',
      ]),
    ).toMatchObject({
      status: 'conflicting',
      can_proceed_to_specification: false,
    });
  });

  it('reconciles supported official facts and leaves unmatched semantics as evidence-only', () => {
    const reconciliation = reconcileEpochSpecifications();
    expect(reconciliation.identity_status).toBe('verified');
    expect(reconciliation.conflicts).toEqual([]);
    expect(reconciliation.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'battery.nominal_capacity_ah',
          value: 100,
          fact_ids: [
            'epoch-batteries.24v-100ah.product-page.nominal-capacity',
            'epoch-batteries.24v-collection.nominal-capacity',
          ],
        }),
        expect.objectContaining({ field: 'weight_kg', value: 21.999229945, unit: 'kg' }),
        expect.objectContaining({ field: 'dimensions_mm.x', value: 260.35, unit: 'mm' }),
        expect.objectContaining({ field: 'dimensions_mm.z', value: 279.4, unit: 'mm' }),
      ]),
    );
    expect(epochFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          raw_label: 'Max continuous discharge',
          fact_state: 'unresolved',
        }),
      ]),
    );
  });

  it('keeps the candidate review-required and noncanonical', () => {
    expect(buildEpochCandidate()).toMatchObject({
      identity_status: 'verified',
      review_status: 'pending',
      promotion_status: 'review_required',
      component_data: {
        battery: { nominal_capacity_ah: 100 },
        weight_kg: 21.999229945,
      },
    });
  });
});
