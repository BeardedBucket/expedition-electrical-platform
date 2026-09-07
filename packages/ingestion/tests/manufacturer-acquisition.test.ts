import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acquireManufacturerRecord,
  buildProposedManufacturerAcquisitionProfile,
  discoverOfficialDocuments,
  normalizeManufacturerIdentity,
  resolveManufacturerAcquisitionStrategy,
  resolveManufacturerAcquisitionProfile,
  selectJsonPath,
  serializeManufacturerAcquisitionResult,
  validateManufacturerAcquisitionProfile,
  type CapturedSource,
  type ManufacturerAcquisitionProfile,
} from '../src/index.js';

const repoPath = (...parts: string[]): string => join(process.cwd(), ...parts);
const fixture = readFileSync(
  join(__dirname, 'fixtures', 'victron-smartsolar-family-page.html'),
  'utf8',
);
const profile = JSON.parse(
  readFileSync(
    repoPath('data', 'ingestion', 'manufacturer-acquisition-profiles', 'victron-energy.json'),
    'utf8',
  ),
) as ManufacturerAcquisitionProfile;
const sourceHash = `sha256:${createHash('sha256').update(fixture).digest('hex')}`;

const captured = (overrides: Partial<CapturedSource> = {}): CapturedSource => ({
  requested_uri:
    'https://www.victronenergy.com/solar-charge-controllers/smartsolar-mppt-75-10-75-15-100-15-100-20',
  final_uri:
    'https://www.victronenergy.com/solar-charge-controllers/smartsolar-mppt-75-10-75-15-100-15-100-20',
  media_type: 'text/html',
  retrieved_at: '2026-09-07T06:05:12.490Z',
  content_hash: sourceHash,
  body: { bytes: new TextEncoder().encode(fixture), text: fixture },
  ...overrides,
});

const request = (manufacturerPartNumber: string) => ({
  profile,
  source_id: 'victron.smartsolar.family-page.fixture',
  requested_identity: {
    manufacturer: 'Victron Energy',
    manufacturer_part_number: manufacturerPartNumber,
  },
  captured_source: captured(),
});

describe('manufacturer acquisition profiles', () => {
  it('validates reviewed mechanics while excluding product and engineering semantics', () => {
    expect(validateManufacturerAcquisitionProfile(profile)).toEqual({
      status: 'valid',
      issues: [],
      ok: true,
    });

    const invalid = validateManufacturerAcquisitionProfile({
      ...profile,
      capabilities: [{ id: 'not-permitted' }],
      strategies: [
        {
          ...profile.strategies[0],
          embedded_json: {
            ...profile.strategies[0].embedded_json,
            json_path: '$.constructor.prototype',
          },
        },
      ],
    });
    expect(invalid.status).toBe('invalid');
    expect(invalid.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'schema_additionalProperties',
        'forbidden_profile_semantics',
        'unsafe_json_path',
      ]),
    );
    expect(
      validateManufacturerAcquisitionProfile({
        ...profile,
        strategies: [
          { ...profile.strategies[0], reference_uri: 'https://not-victron.example/family' },
        ],
      }).issues.map((item) => item.code),
    ).toContain('strategy_reference_not_official');
  });

  it('only accepts declarative JSON path selectors and never evaluates selectors', () => {
    expect(selectJsonPath({ products: [{ sku: 'SCC075015060R' }] }, '$.products[0].sku')).toBe(
      'SCC075015060R',
    );
    expect(
      selectJsonPath({ constructor: { prototype: 'unsafe' } }, '$.constructor.prototype'),
    ).toBe(undefined);
    expect(selectJsonPath({ products: [] }, '$.products.filter(Boolean)')).toBeUndefined();
    expect(selectJsonPath({ value: 'safe' }, '$.value[0]')).toBeUndefined();
  });

  it('selects exactly one reviewed strategy and leaves zero or multiple matches explicit', () => {
    expect(
      resolveManufacturerAcquisitionStrategy(
        profile,
        'https://www.victronenergy.com/other/product',
      ),
    ).toEqual({ status: 'none', path: '/other/product' });
    expect(
      resolveManufacturerAcquisitionStrategy(
        profile,
        'https://www.victronenergy.com/solar-charge-controllers/item',
      ),
    ).toMatchObject({ status: 'resolved', strategy: { id: profile.strategies[0].id } });
    const overlapping = {
      ...profile,
      strategies: [
        profile.strategies[0],
        { ...profile.strategies[0], id: 'z-overlap', path_prefix: '/solar-charge-controllers/' },
      ],
    };
    expect(
      resolveManufacturerAcquisitionStrategy(
        overlapping,
        'https://www.victronenergy.com/solar-charge-controllers/item',
      ),
    ).toEqual({
      status: 'ambiguous',
      path: '/solar-charge-controllers/item',
      strategy_ids: ['solar-controller-family-application-state', 'z-overlap'],
    });
  });

  it('resolves profiles by exact manufacturer identity with deterministic unknown and ambiguity states', () => {
    expect(normalizeManufacturerIdentity('  VICTRON   Energy ')).toBe('victron energy');
    expect(
      resolveManufacturerAcquisitionProfile([profile], { manufacturer: 'Unknown Manufacturer' }),
    ).toEqual({
      status: 'unknown_manufacturer',
      manufacturer: 'Unknown Manufacturer',
      generic_discovery_required: true,
      review_required: true,
    });
    expect(
      resolveManufacturerAcquisitionProfile([profile], { manufacturer: ' victron energy ' }),
    ).toMatchObject({ status: 'resolved' });
    expect(
      resolveManufacturerAcquisitionProfile(
        [
          { ...profile, id: 'z-profile' },
          { ...profile, id: 'a-profile' },
        ],
        { manufacturer: 'Victron Energy' },
      ),
    ).toEqual({
      status: 'ambiguous_manufacturer',
      manufacturer: 'Victron Energy',
      profile_ids: ['a-profile', 'z-profile'],
    });
  });

  it('acquires only the exact SmartSolar raw record and preserves source evidence', () => {
    const result = acquireManufacturerRecord(request('SCC075015060R'));
    expect(result.status).toBe('matched');
    if (result.status !== 'matched') throw new Error('Expected an exact raw identity match.');

    expect(result.source).toMatchObject({
      id: 'victron.smartsolar.family-page.fixture',
      applicability: 'direct_identity',
      product_identity_claim: { manufacturer_part_number: 'SCC075015060R' },
      content_hash: sourceHash,
    });
    expect(result.raw_structured_evidence).toMatchObject({
      representation: 'application_state',
      requested_identity: { manufacturer_part_number: 'SCC075015060R' },
      matched_identity: { property: 'sku', raw_value: 'SCC075015060R' },
      raw_record: { sku: 'SCC075015060R', title: 'SmartSolar MPPT 75/15 Retail' },
      locator: {
        script_id: '__NEXT_DATA__',
        json_path: '$.props.pageProps',
        record_collection_path: '$.products',
        record_index: 0,
      },
    });
    expect(result.documents.map((document) => document.uri)).toEqual([
      'https://www.victronenergy.com/upload/documents/SmartSolar-MPPT-75-10-up-to-100-20-Datasheet.pdf',
      'https://www.victronenergy.com/upload/documents/SmartSolar-MPPT-75-10-up-to-100-20-Manual.pdf',
    ]);
    expect('facts' in result).toBe(false);
  });

  it('does not treat a second existing Victron product as applicable without an exact raw match', () => {
    const result = acquireManufacturerRecord(request('PMP242200100'));
    expect(result).toMatchObject({
      status: 'unmatched',
      source: {
        applicability: 'unresolved',
        product_identity_claim: { manufacturer_part_number: 'PMP242200100' },
      },
    });
    expect('facts' in result).toBe(false);
  });

  it('returns explicit ambiguous matches and enforces official source domains', () => {
    const ambiguousHtml = fixture.replace(
      ']}}}</script>',
      ',{"sku":"SCC075015060R","title":"Duplicate raw record"}]}}}</script>',
    );
    const ambiguous = acquireManufacturerRecord({
      ...request('SCC075015060R'),
      captured_source: captured({
        body: {
          bytes: new TextEncoder().encode(ambiguousHtml),
          text: ambiguousHtml,
        },
      }),
    });
    expect(ambiguous.status).toBe('ambiguous');

    expect(
      acquireManufacturerRecord({
        ...request('SCC075015060R'),
        captured_source: captured({ final_uri: 'https://not-victron.example/product' }),
      }),
    ).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'official_domain_required' }],
    });
    expect(
      acquireManufacturerRecord({
        ...request('SCC075015060R'),
        captured_source: captured({
          final_uri: 'http://www.victronenergy.com/solar-charge-controllers/item',
        }),
      }),
    ).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'official_domain_required' }],
    });
    expect(
      acquireManufacturerRecord({
        ...request('SCC075015060R'),
        captured_source: captured({
          final_uri: 'https://www.victronenergy.com.attacker.example/solar-charge-controllers/item',
        }),
      }),
    ).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'official_domain_required' }],
    });
    expect(
      acquireManufacturerRecord({
        ...request('SCC075015060R'),
        captured_source: captured({ media_type: 'application/json' }),
      }),
    ).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'unsupported_source_media_type' }],
    });
    expect(
      acquireManufacturerRecord({
        ...request('SCC075015060R'),
        captured_source: captured({
          body: {
            bytes: new TextEncoder().encode(
              fixture.replace(
                /<script[\s\S]*?<\/script>/,
                '<script id="__NEXT_DATA__" type="application/json">{bad}</script>',
              ),
            ),
            text: fixture.replace(
              /<script[\s\S]*?<\/script>/,
              '<script id="__NEXT_DATA__" type="application/json">{bad}</script>',
            ),
          },
        }),
      }),
    ).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'embedded_json_invalid' }],
    });
  });

  it('discovers only configured official document links in deterministic order', () => {
    expect(discoverOfficialDocuments(profile, profile.strategies[0], captured())).toEqual([
      {
        uri: 'https://www.victronenergy.com/upload/documents/SmartSolar-MPPT-75-10-up-to-100-20-Datasheet.pdf',
        locator: { attribute: 'href', link_index: 1 },
      },
      {
        uri: 'https://www.victronenergy.com/upload/documents/SmartSolar-MPPT-75-10-up-to-100-20-Manual.pdf',
        locator: { attribute: 'href', link_index: 0 },
      },
    ]);
  });

  it('supports embedded JSON representation and permits building proposed profiles only', () => {
    const embeddedProfile = {
      ...profile,
      strategies: [
        {
          ...profile.strategies[0],
          embedded_json: {
            ...profile.strategies[0].embedded_json,
            representation: 'embedded_json' as const,
            script: { id: 'catalog-data', media_type: 'application/json' },
          },
        },
      ],
    };
    const embeddedFixture = fixture.replace(/__NEXT_DATA__/g, 'catalog-data');
    expect(
      acquireManufacturerRecord({
        ...request('SCC075015060R'),
        profile: embeddedProfile,
        captured_source: captured({
          body: { bytes: new TextEncoder().encode(embeddedFixture), text: embeddedFixture },
        }),
      }).status,
    ).toBe('matched');
    const jsonWithCharsetFixture = embeddedFixture.replace(
      'type="application/json"',
      'type="application/json; charset=utf-8"',
    );
    const jsonLdWithCharsetFixture = embeddedFixture.replace(
      'type="application/json"',
      'type="application/ld+json; charset=utf-8"',
    );
    expect(
      acquireManufacturerRecord({
        ...request('SCC075015060R'),
        profile: embeddedProfile,
        captured_source: captured({
          body: {
            bytes: new TextEncoder().encode(jsonWithCharsetFixture),
            text: jsonWithCharsetFixture,
          },
        }),
      }).status,
    ).toBe('matched');
    expect(
      acquireManufacturerRecord({
        ...request('SCC075015060R'),
        profile: {
          ...embeddedProfile,
          strategies: [
            {
              ...embeddedProfile.strategies[0],
              embedded_json: {
                ...embeddedProfile.strategies[0].embedded_json,
                script: { id: 'catalog-data', media_type: 'application/ld+json' },
              },
            },
          ],
        },
        captured_source: captured({
          body: {
            bytes: new TextEncoder().encode(jsonLdWithCharsetFixture),
            text: jsonLdWithCharsetFixture,
          },
        }),
      }).status,
    ).toBe('matched');
    const proposedProfile = { ...embeddedProfile, profile_status: 'proposed' as const };
    expect(buildProposedManufacturerAcquisitionProfile(proposedProfile)).toMatchObject({
      status: 'valid',
      proposed_profile: proposedProfile,
    });
    expect(buildProposedManufacturerAcquisitionProfile(profile)).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'profile_not_proposed' }],
    });
    expect(
      acquireManufacturerRecord({
        ...request('SCC075015060R'),
        profile: {
          ...embeddedProfile,
          strategies: [
            {
              ...embeddedProfile.strategies[0],
              embedded_json: {
                ...embeddedProfile.strategies[0].embedded_json,
                json_path: '$.missing',
              },
            },
          ],
        },
        captured_source: captured({
          body: { bytes: new TextEncoder().encode(embeddedFixture), text: embeddedFixture },
        }),
      }),
    ).toMatchObject({ status: 'invalid', issues: [{ code: 'record_collection_not_found' }] });
  });

  it('serializes outcomes deterministically and preserves the Phase 9B-3N blocker artifact', () => {
    const first = acquireManufacturerRecord(request('SCC075015060R'));
    const second = acquireManufacturerRecord(request('SCC075015060R'));
    expect(serializeManufacturerAcquisitionResult(first)).toBe(
      serializeManufacturerAcquisitionResult(second),
    );
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            repoPath('data', 'ingestion', 'victron-smartsolar-scc075015060r.json'),
            'utf8',
          ),
        )
        .digest('hex'),
    ).toBe('4bbe763c8f376a6fd65a4e340f30914d1f24b876705c46365e08b4779a034217');
  });
});
