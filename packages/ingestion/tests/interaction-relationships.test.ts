import { describe, expect, it } from 'vitest';
import {
  validateInteractionRelationships,
  type InteractionRelationship,
} from '../src/interaction-relationships.js';

const relationship = (
  overrides: Partial<InteractionRelationship> = {},
): InteractionRelationship => ({
  schema_version: '1.0',
  id: 'g2.smartshunt.charger-sharing',
  relationship_kind: 'information_sharing',
  participants: [
    {
      ref: 'victron:smartshunt',
      kind: 'product_family',
      role: 'producer',
    },
    {
      ref: 'victron:connected-chargers',
      kind: 'product_family',
      role: 'consumer',
    },
  ],
  scope: 'product_family',
  information: [
    {
      direction: 'exposes',
      participant_ref: 'victron:smartshunt',
      term: 'battery voltage, current, and temperature',
      raw_wording:
        'The SmartShunt shares battery voltage, current, and temperature with connected chargers.',
    },
    {
      direction: 'consumes',
      participant_ref: 'victron:connected-chargers',
      term: 'battery voltage, current, and temperature',
    },
  ],
  conditions: [{ kind: 'connection', value: 'connected chargers' }],
  evidence: {
    source_ids: ['victron.g1.smart-battery-shunt'],
    fact_ids: ['claim.smartshunt.charger-sharing'],
  },
  state: 'provisional',
  ...overrides,
});

describe('interaction relationships', () => {
  it('preserves directional information, family scope, and source evidence', () => {
    expect(validateInteractionRelationships([relationship()])).toEqual({
      status: 'valid',
      issues: [],
      ok: true,
    });
  });

  it('preserves a required accessory without flattening direct compatibility', () => {
    const result = validateInteractionRelationships([
      relationship({
        id: 'g2.battery-victron-cable',
        relationship_kind: 'required_intermediate',
        participants: [
          { ref: 'external:can-battery', kind: 'unresolved_external', role: 'battery' },
          { ref: 'victron:system', kind: 'manufacturer_ecosystem', role: 'system' },
          {
            ref: 'victron:ve-can-bms-cable',
            kind: 'accessory_class',
            role: 'required intermediate',
          },
        ],
        required_intermediates: ['victron:ve-can-bms-cable'],
        scope: 'manufacturer_ecosystem',
        information: undefined,
        conditions: [
          { kind: 'brand_dependent', value: 'Cable type A or B depends on battery brand.' },
        ],
        evidence: {
          source_ids: ['victron.g1.ve-can-to-can-bus-bms'],
          fact_ids: ['claim.adapter.cross-manufacturer'],
        },
      }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects dangling references and duplicate stable ids', () => {
    const invalid = relationship({
      required_intermediates: ['missing:adapter'],
      information: [{ direction: 'exposes', participant_ref: 'missing:endpoint', term: 'SOC' }],
    });
    const result = validateInteractionRelationships([invalid, invalid]);
    expect(result.status).toBe('invalid');
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'duplicate_id',
        'invalid_intermediate_ref',
        'invalid_information_ref',
      ]),
    );
  });

  it('does not turn Epoch Bluetooth or protocol equality into interoperability', () => {
    const result = validateInteractionRelationships([
      relationship({
        id: 'g2.epoch-negative-control',
        relationship_kind: 'information_sharing',
        participants: [
          { ref: 'epoch:B24100A-C', kind: 'exact_product', role: 'source' },
          { ref: 'epoch:li-ion-app', kind: 'unresolved_external', role: 'consumer' },
        ],
        scope: 'exact_product',
        information: [
          {
            direction: 'exposes',
            participant_ref: 'epoch:B24100A-C',
            term: 'Bluetooth/app data',
            raw_wording: 'Yes - compatible with Epoch Li-Ion app for iOS and Android',
          },
        ],
        evidence: {
          source_ids: ['epoch-batteries.phase9b-d2.product-page'],
          fact_ids: ['claim.epoch.bluetooth'],
        },
      }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
