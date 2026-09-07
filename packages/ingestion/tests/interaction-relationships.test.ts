import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import {
  canonicalInteractionRelationshipSnapshot,
  proposeCanonicalInteractionRelationship,
  validateInteractionRelationships,
  writeCanonicalInteractionRelationship,
  type CanonicalInteractionRelationshipReview,
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
  ],
  conditions: [{ kind: 'connection', value: 'connected chargers' }],
  evidence: {
    source_ids: ['victron.g1.smart-battery-shunt'],
    fact_ids: ['claim.smartshunt.charger-sharing'],
    applicability: [
      { scope: 'product_family', ref: 'victron:smartshunt' },
      { scope: 'product_family', ref: 'victron:connected-chargers' },
    ],
  },
  state: 'verified',
  ...overrides,
});

const reviewFor = (
  current: InteractionRelationship,
  overrides: Partial<CanonicalInteractionRelationshipReview> = {},
): CanonicalInteractionRelationshipReview => ({
  schema_version: '1.0',
  id: 'review.relationship.1',
  relationship_id: current.id,
  candidate_id: 'candidate.relationship.1',
  decision: 'approved',
  reviewer_id: 'reviewer.human',
  reviewed_at: '2026-09-07T12:00:00.000Z',
  expected_snapshot: canonicalInteractionRelationshipSnapshot(current),
  evidence_acknowledged: true,
  source_ids: current.evidence.source_ids,
  fact_ids: current.evidence.fact_ids,
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
          applicability: [
            { scope: 'manufacturer_ecosystem', ref: 'victron:system' },
            { scope: 'accessory_class', ref: 'victron:ve-can-bms-cable' },
          ],
        },
      }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects unsupported cross-manufacturer evidence with generic applicability matching', () => {
    const mismatched = relationship({
      id: 'g3.cross-manufacturer-mismatch',
      participants: [
        { ref: 'manufacturer-a:exact-product', kind: 'exact_product', role: 'producer' },
        { ref: 'manufacturer-b:ecosystem', kind: 'manufacturer_ecosystem', role: 'consumer' },
      ],
      scope: 'manufacturer_ecosystem',
      information: [
        {
          direction: 'exposes',
          participant_ref: 'manufacturer-a:exact-product',
          term: 'product telemetry',
        },
      ],
      evidence: {
        source_ids: ['manufacturer-a.g1.product-page'],
        fact_ids: ['claim.manufacturer-a.exact-product'],
        applicability: [{ scope: 'exact_product', ref: 'manufacturer-a:exact-product' }],
      },
    });

    const result = proposeCanonicalInteractionRelationship({
      current: mismatched,
      review: reviewFor(mismatched),
      participantReferenceResolver: (kind, ref) =>
        kind === 'exact_product' ? ref === 'manufacturer-a:exact-product' : true,
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'source_evidence_scope_mismatch')).toBe(
      true,
    );
  });

  it('supports matching exact product and family applicability generically', () => {
    const exactMatch = relationship({
      id: 'g3.exact-match',
      participants: [
        { ref: 'manufacturer-a:exact-product', kind: 'exact_product', role: 'producer' },
        { ref: 'manufacturer-a:family', kind: 'product_family', role: 'consumer' },
      ],
      scope: 'exact_product',
      information: [
        {
          direction: 'exposes',
          participant_ref: 'manufacturer-a:exact-product',
          term: 'product telemetry',
        },
      ],
      evidence: {
        source_ids: ['manufacturer-a.g1.exact-product'],
        fact_ids: ['claim.manufacturer-a.exact-product'],
        applicability: [
          { scope: 'exact_product', ref: 'manufacturer-a:exact-product' },
          { scope: 'product_family', ref: 'manufacturer-a:family' },
        ],
      },
    });
    const exactResult = proposeCanonicalInteractionRelationship({
      current: exactMatch,
      review: reviewFor(exactMatch),
      participantReferenceResolver: (kind, ref) =>
        kind === 'exact_product' ? ref === 'manufacturer-a:exact-product' : true,
    });
    expect(exactResult.status).toBe('proposed');

    const familyMatch = relationship({
      id: 'g3.family-match',
      participants: [
        { ref: 'manufacturer-a:family-alpha', kind: 'product_family', role: 'producer' },
        { ref: 'manufacturer-a:family-beta', kind: 'product_family', role: 'consumer' },
      ],
      scope: 'product_family',
      information: [
        {
          direction: 'exposes',
          participant_ref: 'manufacturer-a:family-alpha',
          term: 'family telemetry',
        },
      ],
      evidence: {
        source_ids: ['manufacturer-a.g1.family-page'],
        fact_ids: ['claim.manufacturer-a.family'],
        applicability: [
          { scope: 'product_family', ref: 'manufacturer-a:family-alpha' },
          { scope: 'product_family', ref: 'manufacturer-a:family-beta' },
        ],
      },
    });
    const familyResult = proposeCanonicalInteractionRelationship({
      current: familyMatch,
      review: reviewFor(familyMatch),
    });
    expect(familyResult.status).toBe('proposed');

    const familyMismatch = relationship({
      id: 'g3.family-mismatch',
      participants: [
        { ref: 'manufacturer-a:family-alpha', kind: 'product_family', role: 'producer' },
        { ref: 'manufacturer-b:family-beta', kind: 'product_family', role: 'consumer' },
      ],
      scope: 'product_family',
      information: [
        {
          direction: 'exposes',
          participant_ref: 'manufacturer-a:family-alpha',
          term: 'family telemetry',
        },
      ],
      evidence: {
        source_ids: ['manufacturer-a.g1.family-page'],
        fact_ids: ['claim.manufacturer-a.family'],
        applicability: [{ scope: 'product_family', ref: 'manufacturer-a:family-alpha' }],
      },
    });
    const familyMismatchResult = proposeCanonicalInteractionRelationship({
      current: familyMismatch,
      review: reviewFor(familyMismatch),
    });
    expect(familyMismatchResult.status).toBe('blocked');
    expect(
      familyMismatchResult.issues.some((issue) => issue.code === 'source_evidence_scope_mismatch'),
    ).toBe(true);
  });

  it('does not infer consumes from shares-with wording and supports explicit consumption evidence', () => {
    const sharedExposure = relationship({
      id: 'g3.exposes-not-consumes',
      information: [
        {
          direction: 'exposes',
          participant_ref: 'victron:smartshunt',
          term: 'battery voltage, current, and temperature',
          raw_wording:
            'The SmartShunt shares battery voltage, current, and temperature with connected chargers.',
        },
      ],
    });
    const sharedResult = proposeCanonicalInteractionRelationship({
      current: sharedExposure,
      review: reviewFor(sharedExposure),
    });
    expect(sharedResult.status).toBe('proposed');
    expect(
      sharedResult.proposal?.information?.some((claim) => claim.direction === 'consumes'),
    ).toBe(false);

    const explicitConsumption = relationship({
      id: 'g3.explicit-consumes',
      information: [
        {
          direction: 'consumes',
          participant_ref: 'victron:connected-chargers',
          term: 'battery voltage, current, and temperature',
          raw_wording:
            'The connected chargers use SmartShunt voltage, current, and temperature for charging logic.',
        },
      ],
      evidence: {
        source_ids: ['victron.g1.charger-uses-smartshunt'],
        fact_ids: ['claim.charger.uses-smartshunt-values'],
        applicability: [
          { scope: 'product_family', ref: 'victron:smartshunt' },
          { scope: 'product_family', ref: 'victron:connected-chargers' },
        ],
      },
    });
    const explicitResult = proposeCanonicalInteractionRelationship({
      current: explicitConsumption,
      review: reviewFor(explicitConsumption),
    });
    expect(explicitResult.status).toBe('proposed');
    expect(
      explicitResult.proposal?.information?.some((claim) => claim.direction === 'consumes'),
    ).toBe(true);
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
    const result = validateInteractionRelationships(
      [
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
      ],
      {
        participantReferenceResolver: (kind, ref) =>
          kind === 'exact_product' ? ref === 'epoch:B24100A-C' : true,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('persists a durable promotion history that links the review to source and fact evidence', () => {
    const current = relationship();
    const result = proposeCanonicalInteractionRelationship({
      current,
      review: reviewFor(current),
    });

    expect(result.status).toBe('proposed');
    expect(result.proposal?.promotion_history).toEqual([
      expect.objectContaining({
        review_id: 'review.relationship.1',
        relationship_id: current.id,
        reviewer_id: 'reviewer.human',
        source_ids: current.evidence.source_ids,
        fact_ids: current.evidence.fact_ids,
        expected_snapshot: canonicalInteractionRelationshipSnapshot(current),
      }),
    ]);
  });

  it('requires concrete canonical refs to resolve when they are claimed', () => {
    const resolved = relationship({
      id: 'g3.concrete-resolved',
      participants: [
        { ref: 'victron:smartshunt', kind: 'exact_product', role: 'producer' },
        { ref: 'victron:connected-chargers', kind: 'product_family', role: 'consumer' },
      ],
      scope: 'exact_product',
    });
    const resolvedResult = proposeCanonicalInteractionRelationship({
      current: resolved,
      review: reviewFor(resolved),
      participantReferenceResolver: (kind, ref) =>
        kind === 'exact_product' ? ref === 'victron:smartshunt' : true,
    });
    expect(resolvedResult.status).toBe('proposed');

    const unresolved = relationship({
      id: 'g3.concrete-unresolved',
      participants: [
        { ref: 'fabricated:unknown-product', kind: 'exact_product', role: 'producer' },
        { ref: 'victron:connected-chargers', kind: 'product_family', role: 'consumer' },
      ],
      scope: 'exact_product',
    });
    const unresolvedResult = proposeCanonicalInteractionRelationship({
      current: unresolved,
      review: reviewFor(unresolved),
      participantReferenceResolver: (kind, ref) =>
        kind === 'exact_product' ? ref === 'victron:smartshunt' : true,
    });
    expect(unresolvedResult.status).toBe('blocked');
    expect(
      unresolvedResult.issues.some((issue) => issue.code === 'canonical_identity_unresolved'),
    ).toBe(true);

    const familyScoped = relationship({
      id: 'g3.family-scope',
      participants: [
        { ref: 'victron:smartshunt', kind: 'product_family', role: 'producer' },
        { ref: 'victron:connected-chargers', kind: 'manufacturer_ecosystem', role: 'consumer' },
      ],
      scope: 'manufacturer_ecosystem',
    });
    const familyResult = proposeCanonicalInteractionRelationship({
      current: familyScoped,
      review: reviewFor(familyScoped),
    });
    expect(familyResult.status).toBe('proposed');
  });

  it('rejects source assertions that smuggle derived compatibility or installed-system conclusions', () => {
    const derived = relationship({
      id: 'g3.derived-compatibility',
      notes:
        'This compatibility conclusion is derived for the platform and not a raw manufacturer assertion.',
    });
    const derivedResult = proposeCanonicalInteractionRelationship({
      current: derived,
      review: reviewFor(derived),
    });
    expect(derivedResult.status).toBe('blocked');
    expect(
      derivedResult.issues.some((issue) => issue.code === 'derived_compatibility_rejected'),
    ).toBe(true);

    const installed = relationship({
      id: 'g3.installed-system',
      notes: 'The system currently has this installed and connected at runtime.',
    });
    const installedResult = proposeCanonicalInteractionRelationship({
      current: installed,
      review: reviewFor(installed),
    });
    expect(installedResult.status).toBe('blocked');
    expect(installedResult.issues.some((issue) => issue.code === 'installed_system_rejected')).toBe(
      true,
    );
  });

  it('rejects Epoch evidence when it is used to claim a Victron interoperability relationship', () => {
    const current = relationship({
      id: 'g3.epoch-victron-negative-control',
      relationship_kind: 'manufacturer_interoperability',
      participants: [
        { ref: 'epoch:B24100A-C', kind: 'exact_product', role: 'source' },
        { ref: 'victron:gx', kind: 'product_family', role: 'consumer' },
      ],
      scope: 'exact_product',
      evidence: {
        source_ids: ['epoch-batteries.phase9b-d2.product-page'],
        fact_ids: ['claim.epoch.bluetooth'],
        applicability: [{ scope: 'exact_product', ref: 'epoch:B24100A-C' }],
      },
      information: [
        {
          direction: 'exposes',
          participant_ref: 'epoch:B24100A-C',
          term: 'Bluetooth status',
        },
      ],
      notes:
        'Source evidence is a manufacturer app claim; it does not prove Victron interoperability.',
    });
    const result = proposeCanonicalInteractionRelationship({
      current,
      review: reviewFor(current),
      participantReferenceResolver: (kind, ref) =>
        kind === 'exact_product' ? ref === 'epoch:B24100A-C' : true,
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'source_evidence_scope_mismatch')).toBe(
      true,
    );
  });

  it('promotes a reviewed relationship when the snapshot and evidence are valid', () => {
    const current = relationship();
    const result = proposeCanonicalInteractionRelationship({
      current,
      review: reviewFor(current),
    });

    expect(result.status).toBe('proposed');
    expect(result.issues).toEqual([]);
    expect(result.schema_valid).toBe(true);
  });

  it('rejects stale reviewed relationships without mutating canonical data', () => {
    const current = relationship();
    const result = proposeCanonicalInteractionRelationship({
      current,
      review: reviewFor(current, { expected_snapshot: 'deadbeef' }),
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'canonical_snapshot_mismatch')).toBe(true);
  });

  it('rejects dangling required intermediates during promotion', () => {
    const current = relationship({
      id: 'g3.dangling-intermediate',
      required_intermediates: ['missing:adapter'],
      evidence: {
        source_ids: ['victron.g1.ve-can-to-can-bus-bms'],
        fact_ids: ['claim.adapter.cross-manufacturer'],
      },
    });
    const result = proposeCanonicalInteractionRelationship({
      current,
      review: reviewFor(current),
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'invalid_intermediate_ref')).toBe(true);
  });

  it('rejects a provisional state from canonical promotion', () => {
    const current = relationship({ state: 'provisional' });
    const result = proposeCanonicalInteractionRelationship({
      current,
      review: reviewFor(current, {
        expected_snapshot: canonicalInteractionRelationshipSnapshot(current),
      }),
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'state_not_canonical')).toBe(true);
  });

  it('keeps the canonical interaction-relationship dataset empty unless a real review exists', async () => {
    const entries = await readdir(resolve(process.cwd(), 'data/interaction-relationships'));
    expect(entries).toEqual([]);
  });

  it('keeps deterministic replay and duplicate-id promotion blocked', async () => {
    const current = relationship({ id: 'g3.deterministic-replay' });
    const first = proposeCanonicalInteractionRelationship({
      current,
      review: reviewFor(current),
    });
    const second = proposeCanonicalInteractionRelationship({
      current,
      review: reviewFor(current),
    });

    expect(first.status).toBe('proposed');
    expect(second.status).toBe('proposed');
    expect(first.actual_snapshot).toBe(second.actual_snapshot);
    expect(first.serialized).toBe(second.serialized);

    const existing = {
      access: async () => undefined,
      readFile: async () =>
        `schema_version: "1.0"\nid: "g3.deterministic-replay"\nrelationship_kind: "information_sharing"\nparticipants:\n  - ref: "victron:smartshunt"\n    kind: "product_family"\n    role: "producer"\n  - ref: "victron:connected-chargers"\n    kind: "product_family"\n    role: "consumer"\nscope: "product_family"\ninformation:\n  - direction: "exposes"\n    participant_ref: "victron:smartshunt"\n    term: "battery voltage, current, and temperature"\nconditions:\n  - kind: "connection"\n    value: "connected chargers"\nevidence:\n  source_ids:\n    - "victron.g1.smart-battery-shunt"\n  fact_ids:\n    - "claim.epoch.bluetooth"\nstate: "verified"\n`,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      rename: async () => undefined,
      rm: async () => undefined,
    };

    const duplicateResult = await writeCanonicalInteractionRelationship({
      current,
      review: reviewFor(current),
      write: true,
      destinationRoot: '/tmp',
      filename: 'g3.deterministic-replay.yaml',
      filesystem: existing,
    });
    expect(duplicateResult.status).toBe('blocked');
    expect(
      duplicateResult.issues.some((issue) => issue.code === 'canonical_snapshot_mismatch'),
    ).toBe(true);
  });

  it('restores the previous canonical relationship when atomic write replacement fails', async () => {
    const current = relationship({ id: 'g3.atomic-failure' });
    const original = stringifyYaml(current, { sortMapEntries: true });
    let latestDisk = original;
    const filesystem = {
      access: async (path: string) => {
        if (path.endsWith('g3.atomic-failure.yaml')) return;
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      readFile: async () => latestDisk,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      rename: async (from: string, to: string) => {
        if (from.includes('.tmp') && to.endsWith('g3.atomic-failure.yaml')) {
          throw new Error('atomic replacement failed');
        }
        if (to.endsWith('.bak')) {
          latestDisk = original;
        }
      },
      rm: async () => undefined,
    };

    const result = await writeCanonicalInteractionRelationship({
      current,
      review: reviewFor(current),
      write: true,
      destinationRoot: '/tmp',
      filename: 'g3.atomic-failure.yaml',
      filesystem,
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'write_failed')).toBe(true);
    expect(latestDisk).toBe(original);
  });
});
