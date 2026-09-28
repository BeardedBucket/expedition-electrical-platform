import { describe, expect, it } from 'vitest';
import {
  artifactReference,
  buildDocumentExtractionArtifact,
  buildProductionProductCandidate,
  buildProductionSemanticProposals,
  normalizeProductFact,
  qualifyDocumentExtraction,
  reconcileQualifiedFactsForWholeIntake,
  resolveCanonicalField,
  type ProductFact,
  type ProductIntake,
  type ProductSource,
  type SourceAcquisitionArtifact,
  type SourceCaptureArtifact,
} from '../src/index.js';
import { extractHtmlDocument } from '../src/document-extraction.js';

const source: ProductSource = {
  schema_version: '1.0',
  id: 'source.example',
  uri: 'https://example.invalid/device',
  source_type: 'manufacturer_product_page',
  authority: 'manufacturer_product',
  publisher: 'Example',
  retrieved_at: '2026-09-28T00:00:00Z',
  applicability: 'direct_identity',
  product_identity_claim: { model: 'Device ZX' },
};
const normalize = (label: string, value: ProductFact['raw_value'], unit?: string) =>
  normalizeProductFact(
    {
      schema_version: '1.0',
      id: 'fact.example',
      source_id: source.id,
      field: 'unmapped',
      raw_label: label,
      raw_value: value,
      ...(unit !== undefined ? { raw_unit: unit } : {}),
      extraction_method: 'table',
      fact_state: 'provisional',
      review_required: true,
    },
    source,
  );

const mappings = [
  ['Supply voltage', 'electrical.input_voltage_range_v', '8–70 V', 'V', { min: 8, max: 70 }],
  [
    'Outer dimensions (h x w x d)',
    'dimensions_mm',
    '12 x 18 x 3 cm',
    'mm',
    { x: 180, y: 30, z: 120 },
  ],
] as const;

describe('explicit ordered existing-semantic mappings', () => {
  it.each(mappings)(
    'maps %s without changing source evidence',
    (label, target, raw, unit, value) => {
      expect(resolveCanonicalField(label)?.canonical_field).toBe(target);
      expect(resolveCanonicalField(`  ${label.toUpperCase()}  `)?.canonical_field).toBe(target);
      expect(normalize(label, raw)).toMatchObject({
        status: 'normalized',
        fact: {
          canonical_field: target,
          normalized_value: value,
          normalized_unit: unit,
          fact: {
            raw_label: label,
            raw_value: raw,
            fact_state: 'provisional',
            review_required: true,
          },
        },
      });
    },
  );
  it.each([
    ['Supply voltage', '8000 to 70000', 'mV', { min: 8, max: 70 }],
    ['Outer dimensions (h x w x d)', '120 × 180 × 30', 'mm', { x: 180, y: 30, z: 120 }],
  ])('uses an explicit source unit for %s', (label, raw, unit, value) => {
    expect(normalize(label, raw, unit).fact).toMatchObject({
      normalized_value: value,
      fact: { raw_unit: unit },
    });
  });
  it('does not discard an AC/DC source-unit qualifier behind an embedded plain V', () => {
    expect(
      normalize('Supply voltage', '8-70 V', 'VDC').fact?.fact.qualified_value?.qualifiers,
    ).toEqual({ electrical_domain: 'dc' });
    expect(
      normalize('Supply voltage', '8-70 V', 'VAC').fact?.fact.qualified_value?.qualifiers,
    ).toEqual({ electrical_domain: 'ac' });
  });
  it.each([
    ['Supply voltage', '8 / 70 V'],
    ['Supply voltage', '70-8 V'],
    ['Supply voltage', '-8 to 70 V'],
    ['Supply voltage', '8-70'],
    ['Supply voltage', '8-70 A'],
    ['Supply voltage', '8 V - 70 mV'],
    ['Supply voltage', '8-70 V typical'],
    ['Supply voltage', '8-70 V | 100-240 V'],
    ['Supply voltage', '24 V'],
    ['Outer dimensions (h x w x d)', '120 x 180 mm'],
    ['Outer dimensions (h x w x d)', '0 x 180 x 30 mm'],
    ['Outer dimensions (h x w x d)', '120 x 180 x 30'],
    ['Outer dimensions (h x w x d)', '120 x 180 x 30 pixels'],
    ['Outer dimensions (h x w x d)', '120 x 180 x 30 x 40 mm'],
  ])('rejects %s = %s', (label, raw) => {
    expect(normalize(label, raw).status).toBe('unresolved');
    expect(normalize(label, raw).fact).toBeUndefined();
  });
  it.each(mappings)('preserves missing/invalid data for %s', (label, _target, raw) => {
    for (const absent of [null, '', 'unknown', false, 0, [], {}, 'NaN', 'Infinity']) {
      expect(normalize(label, absent).fact).toBeUndefined();
    }
    expect(normalize(label, raw, 'A').fact).toBeUndefined();
    expect(
      normalize(label, '9'.repeat(400) + (label === 'Supply voltage' ? '-10 V' : ' x 1 x 1 mm'))
        .fact,
    ).toBeUndefined();
  });
  it.each([
    'Voltage',
    'Input voltage',
    'Supply nominal voltage',
    'Supply voltage maximum',
    'Dimensions',
    'Outer dimensions',
    'Outer dimensions (w x h x d)',
    'Display resolution',
    'Temperature',
    'Power',
    'Protection',
    'Ports',
    'Safety',
    'Other',
  ])('does not alias %s', (label) => {
    expect(resolveCanonicalField(label)).toBeUndefined();
  });
});

// Synthetic label-set acceptance, not a retained Ekrano capture or verified corpus data.
const unsupportedLabels = [
  'Power draw display on (100% brightness)',
  'Power draw display off',
  'Relay',
  'VE.Direct ports (always isolated)',
  'VE.Bus (always isolated)',
  'VE.Can 1',
  'VE.Can 2',
  'Ethernet',
  'WiFi',
  'Wifi Frequencies and Power',
  'Bluetooth Smart',
  'Bluetooth Frequencies and Power',
  'USB Host ports',
  'MicroSD Card Slot',
  'Resistive tank level inputs',
  'Temperature sense inputs',
  'Digital inputs',
  'Display resolution',
  'Display max. backlight brightness',
  'Backlight dimming',
  'Touch toggle on/off button',
  'Operating temperature range',
  'Mounting',
  'Buzzer',
  'Protection category',
  'Safety',
  'EMC',
  'Automotive',
];
const separators = ['Communication ports', 'IO', 'Display', 'Dimensions', 'Other', 'Standards'];
const intake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'intake.synthetic',
  manufacturer: 'Example',
  product_model: 'Device ZX',
  manufacturer_part_number: 'INTAKE-ONLY',
  official_product_uri: source.uri,
};
const capture: SourceCaptureArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_capture',
  id: 'capture.synthetic',
  requested_uri: source.uri,
  final_uri: source.uri,
  retrieved_at: source.retrieved_at,
  disposition: 'authoritative',
  retention_status: 'not_retained',
  source_provenance: { publisher: 'Example' },
};
const acquisition: SourceAcquisitionArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_acquisition',
  id: 'acquisition.synthetic',
  intake: artifactReference('product_intake', intake),
  seed_capture: artifactReference('source_capture', capture),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: `sha256:${'a'.repeat(64)}`,
};
const run = (rows: readonly (readonly [string, string])[], categories: readonly string[] = []) => {
  const markup = `<table><tr><th colspan="4">Device ZX<sup>[1]</sup></th></tr>${categories
    .map((label) => `<tr><td colspan="4">${label}</td></tr>`)
    .join(
      '',
    )}${rows.map(([label, value]) => `<tr><td>${label}</td><td colspan="3">${value}</td></tr>`).join('')}</table>`;
  const document = buildDocumentExtractionArtifact(
    extractHtmlDocument({
      requested_uri: source.uri,
      final_uri: source.uri,
      retrieved_at: source.retrieved_at,
      media_type: 'text/html',
      body: { text: markup, bytes: new TextEncoder().encode(markup) },
    }),
    artifactReference('source_capture', capture),
    { source_acquisition: artifactReference('source_acquisition', acquisition) },
  );
  const facts = qualifyDocumentExtraction(document, intake).facts;
  const reconciliation = reconcileQualifiedFactsForWholeIntake({
    facts,
    source_acquisitions: [acquisition],
  });
  const proposals = buildProductionSemanticProposals({
    facts,
    source_acquisitions: [acquisition],
    reconciliation,
  });
  return {
    facts,
    reconciliation,
    ...buildProductionProductCandidate({
      intake,
      captures: [capture],
      source_acquisitions: [acquisition],
      facts,
      reconciliation,
      proposals,
    }),
  };
};

describe('real-label synthetic production acceptance', () => {
  it.each(unsupportedLabels)('keeps %s unsupported without creating an evidence alias', (label) => {
    expect(resolveCanonicalField(label)).toBeUndefined();
    const result = run([[label, 'synthetic source-native statement']]);
    expect(result.proposals[0].disposition).toBe('unsupported');
    expect(result.candidate).toBeUndefined();
  });
  it('accounts for 30 fact labels and excludes category rows using current qualification', () => {
    const result = run(
      [
        ...unsupportedLabels.map((label) => [label, 'synthetic source-native statement'] as const),
        ['Supply voltage', '8 - 70V DC'],
        [
          'Outer dimensions (h x w x d)',
          '124 x 187 x 29.8 mm | 4.88 x 7.36 x 1.17 in (without connectors and mounting accessories)',
        ],
      ],
      separators,
    );
    expect(result.qualified_facts).toHaveLength(30);
    expect(
      result.reconciliation.group_reconciliations.every(
        (group) => group.outcome === 'single_observation',
      ),
    ).toBe(true);
    expect(
      result.proposals.filter((proposal) => proposal.disposition === 'unsupported'),
    ).toHaveLength(28);
    expect(result.proposals.filter((proposal) => proposal.disposition === 'mapped')).toHaveLength(
      2,
    );
    expect(
      result.proposals.every((proposal) =>
        proposal.provenance?.rationale?.includes('F group single_observation'),
      ),
    ).toBe(true);
    expect(result.projected_proposal_ids).toHaveLength(2);
    expect(result.non_projected).toHaveLength(28);
    expect(result.candidate?.component_data.qualified_values).toHaveLength(2);
    expect(result.candidate?.component_data.dimensions_mm).toBeUndefined();
    expect(result.candidate?.component_data.electrical).toBeUndefined();
    expect(result.normalized_facts).toHaveLength(2);
  });
  it.each(mappings)(
    'projects safe %s singleton with model-only identity and traceable evidence',
    (label, target, raw, unit, value) => {
      const result = run([[label, raw]]);
      expect(result.projected_proposal_ids).toHaveLength(1);
      expect(result.non_projected).toHaveLength(0);
      expect(result.proposals[0]).toMatchObject({
        target,
        disposition: 'mapped',
        proposed_value: value,
        provenance: { rationale: expect.stringContaining('F group single_observation') },
      });
      expect(result.proposals[0].fact_refs).toHaveLength(1);
      expect(result.proposals[0].evidence_refs?.length).toBeGreaterThan(0);
      expect(result.sources[0].product_identity_claim).toEqual({ model: 'Device ZX' });
      expect(result.candidate).toMatchObject({
        identity_status: 'provisional',
        review_status: 'pending',
        promotion_status: 'review_required',
        identity: { manufacturer_part_number: 'INTAKE-ONLY' },
      });
      expect(result.candidate?.component_data).toEqual(
        target === 'dimensions_mm'
          ? { dimensions_mm: value }
          : { electrical: { input_voltage_range_v: value } },
      );
      expect(result.candidate?.field_evidence[target]).toEqual([result.facts[0].id]);
      expect(result.normalized_facts[0]).toMatchObject({
        normalized_value: value,
        normalized_unit: unit,
        fact: { raw_value: raw, fact_state: 'provisional', review_required: true },
      });
    },
  );
  it.each(mappings)('does not emit a default candidate for empty %s', (label) => {
    const result = run([[label, '']]);
    expect(result.projected_proposal_ids).toHaveLength(0);
    expect(result.candidate).toBeUndefined();
  });
});
