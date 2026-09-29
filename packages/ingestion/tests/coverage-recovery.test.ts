import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractDocument, DEFAULT_DOCUMENT_EXTRACTION_LIMITS } from '../src/document-extraction.js';
import {
  artifactDigest,
  artifactReference,
  buildDocumentExtractionArtifact,
  qualifyDocumentExtraction,
  validateQualifiedFact,
  validateDocumentExtraction,
  validateProductionArtifactSchema,
  type ProductIntake,
  type SourceCaptureArtifact,
  type SourceAcquisitionArtifact,
} from '../src/production-contracts.js';
import {
  manufacturerAcquisitionProfileDigest,
  validateManufacturerAcquisitionProfile,
  type ManufacturerAcquisitionProfile,
} from '../src/manufacturer-acquisition.js';
import { prepareProfileQualifiedEvidence } from '../src/profile-qualified-evidence.js';
import { isReadOnlyEvidenceUri } from '../src/evidence-uri.js';
import { HttpSourceCaptureAdapter } from '../src/http-capture.js';
import { acquireOfficialSources } from '../src/source-acquisition.js';
import { resolveCanonicalField } from '../src/field-mapping.js';

const intake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'coverage.fixture',
  manufacturer: 'Example',
  product_model: 'Model X',
  manufacturer_part_number: 'EX-X',
  official_product_uri: 'https://example.com/products/x',
};
const profile = (
  kind: 'table' | 'definition' | 'label_value_lines' | 'label_value_list' = 'table',
): ManufacturerAcquisitionProfile => ({
  schema_version: '1.3',
  id: 'example.profile',
  profile_status: 'reviewed',
  manufacturer: 'Example',
  publisher: 'Example',
  official_domains: ['example.com'],
  strategies: [],
  provenance: {
    source_artifact: 'synthetic test fixture',
    observed_source_content_hash: artifactDigest('synthetic fixture'),
  },
  html_fact_rules: [
    {
      id: 'specifications',
      status: 'reviewed',
      path_prefix: '/products/',
      identity_kind: 'mpn',
      identity_selector: [{ id: 'sku' }],
      regions: [{ kind, selector: [{ id: 'spec' }] }],
    },
  ],
});
const fixture = (html: string, p = profile(), target = intake) => {
  const bytes = new TextEncoder().encode(html),
    digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const source = {
    requested_uri: target.official_product_uri,
    final_uri: target.official_product_uri,
    retrieved_at: '2026-09-29T00:00:00Z',
    media_type: 'text/html',
    response_status: 200,
    content_hash: digest,
    body: { bytes, text: html },
  };
  const capture: SourceCaptureArtifact = {
    schema_version: '1.0',
    artifact_kind: 'source_capture',
    id: 'coverage.capture',
    requested_uri: source.requested_uri,
    final_uri: source.final_uri,
    retrieved_at: source.retrieved_at,
    media_type: source.media_type,
    response_status: 200,
    disposition: 'authoritative',
    retention_status: 'retained',
    content_digest: digest,
    digest_algorithm: 'sha256',
  };
  const acquisition: SourceAcquisitionArtifact = {
    schema_version: '1.0',
    artifact_kind: 'source_acquisition',
    id: 'coverage.acquisition',
    intake: artifactReference('product_intake', target),
    seed_capture: artifactReference('source_capture', capture),
    profile_binding: {
      profile_id: p.id,
      profile_schema_version: p.schema_version,
      profile_digest: manufacturerAcquisitionProfileDigest(p),
    },
    officiality: 'official',
    status: 'acquired',
    candidates: [],
    deterministic_snapshot: artifactDigest('fixture'),
  };
  const document = buildDocumentExtractionArtifact(
    extractDocument(source),
    artifactReference('source_capture', capture),
    { source_acquisition: artifactReference('source_acquisition', acquisition) },
  );
  return { source, capture, acquisition, document, intake: target, profile: p };
};
const identity = '<span id="sku">EX-X</span>';
const table = '<table id="spec"><tr><th>Nominal voltage</th><td>12 V</td></tr></table>';
const facts = (html: string, p = profile()) =>
  prepareProfileQualifiedEvidence(fixture(html, p))?.qualification.facts ?? [];

describe('reviewed page regions and complete evidence ownership', () => {
  it('retains exact seed scope, source paths, deterministic identity and excludes unrelated tables', () => {
    const input = fixture(
      identity + table + '<table><tr><td>Nominal voltage</td><td>999 V</td></tr></table>',
    );
    const first = prepareProfileQualifiedEvidence(input)!,
      second = prepareProfileQualifiedEvidence(input)!;
    expect(first).toEqual(second);
    expect(first.document.blocks.some((b) => b.kind === 'structured')).toBe(true);
    expect(validateDocumentExtraction(first.document)).toEqual([]);
    expect(validateProductionArtifactSchema(first.document)).toEqual([]);
    expect(first.qualification.facts).toHaveLength(1);
    const fact = first.qualification.facts[0];
    expect(validateQualifiedFact(fact)).toEqual([]);
    expect(validateProductionArtifactSchema(fact)).toEqual([]);
    expect(fact.metadata.raw_value).toBe('12 V');
    expect(fact.source_capture.digest).toBe(artifactDigest(input.capture));
    expect(
      fact.evidence.some((e) => e.role === 'value' && e.locator?.path?.includes('/cell[2]')),
    ).toBe(true);
  });
  it.each([
    table,
    identity.replace('EX-X', 'EX-Y') + table,
    identity + '<span id="sku">EX-Y</span>' + table,
    identity + table.replace('<td>', '<td colspan="2">'),
    identity + '<table id="spec"><tr><td>Model</td><td>EX-X</td></tr></table>',
  ])('rejects missing/competing identity and ambiguous tables', (html) =>
    expect(facts(html)).toHaveLength(0),
  );
  it('does not inherit seed scope on a sibling URI', () => {
    const input = fixture(identity + table);
    input.intake = { ...intake, official_product_uri: 'https://example.com/products/other' };
    input.acquisition = {
      ...input.acquisition,
      intake: artifactReference('product_intake', input.intake),
    };
    expect(prepareProfileQualifiedEvidence(input)).toBeUndefined();
  });
  it.each(['authority', 'profile', 'bytes', 'partial'] as const)(
    'rejects %s violations',
    (kind) => {
      const input = fixture(identity + table);
      if (kind === 'authority')
        input.capture = { ...input.capture, disposition: 'non_authoritative' };
      if (kind === 'profile') input.profile = { ...input.profile, profile_status: 'proposed' };
      if (kind === 'bytes') input.source.body.bytes = new TextEncoder().encode('other');
      if (kind === 'partial') input.document = { ...input.document, status: 'partially_extracted' };
      expect(prepareProfileQualifiedEvidence(input)).toBeUndefined();
    },
  );
  it('decodes captured bytes rather than trusting independent supplied text', () => {
    const input = fixture(identity + table);
    input.source.body.text = identity + table.replace('12 V', '999 V');
    expect(prepareProfileQualifiedEvidence(input)?.qualification.facts[0].metadata.raw_value).toBe(
      '12 V',
    );
  });
  it('preserves conditional table context and unknown empty values', () => {
    const result = facts(
      identity +
        '<table id="spec"><tr><th colspan="2">At 40 C</th></tr><tr><td>Current</td><td>15 A</td></tr><tr><td>Voltage</td><td></td></tr></table>',
    );
    expect(result).toHaveLength(1);
    expect(result[0].metadata.conditions).toEqual(['At 40 C']);
  });
  it.each([
    ['definition', '<dl id="spec"><dt>Nominal voltage</dt><dd>12 V</dd></dl>'],
    ['label_value_list', '<ul id="spec"><li>Nominal voltage: 12 V</li></ul>'],
    ['label_value_lines', '<div id="spec"><p>Nominal voltage: 12 V<br>Current: 15 A</p></div>'],
  ] as const)('supports explicit %s delimiters', (kind, html) =>
    expect(facts(identity + html, profile(kind))).toHaveLength(
      kind === 'label_value_lines' ? 2 : 1,
    ),
  );
  it.each([
    ['definition', '<dl id="spec"><dt>Voltage</dt><dt>Current</dt><dd>15 A</dd></dl>'],
    ['label_value_lines', '<div id="spec"><p>Nominal voltage: 12 V</p></div>'],
    ['label_value_lines', '<div id="spec"><p>Voltage: 12 V<br>missing value</p></div>'],
  ] as const)('rejects malformed %s without prose inference', (kind, html) =>
    expect(facts(identity + html, profile(kind))).toHaveLength(0),
  );
});

describe('reviewed model label/value DOM rows', () => {
  const load = (name: string): ManufacturerAcquisitionProfile =>
    JSON.parse(
      readFileSync(`data/ingestion/manufacturer-acquisition-profiles/${name}.json`, 'utf8'),
    );
  const target: ProductIntake = {
    ...intake,
    manufacturer: 'Xantrex',
    official_product_uri: 'https://xantrex.com/products/fixture',
  };
  const row =
    '<div class="xtable-row"><div class="xtable-cell" data-title="">Output power at 40 C</div><div class="xtable-cell" data-title="Model X">3000 W at 40 C</div></div>';
  const header =
    '<div class="xtable-row xtable-header"><div class="xtable-cell"></div><div class="xtable-cell">Model X</div></div>';
  const html = `<section class="table-section"><h2>Electrical Specifications – Inverter</h2><div class="xtable">${header}${row}</div></section>`;
  const prepare = (body = html, p = load('xantrex')) =>
    prepareProfileQualifiedEvidence(fixture(body, p, target));
  it('uses the actual declarative profile for two different models and retains source conditions and locators', () => {
    expect(validateManufacturerAcquisitionProfile(load('xantrex')).ok).toBe(true);
    const first = prepare()!;
    expect(first).toEqual(prepare());
    expect(first.qualification.facts).toHaveLength(1);
    const fact = first.qualification.facts[0];
    expect(fact.metadata.raw_value).toBe('3000 W at 40 C');
    expect(fact.metadata.conditions).toEqual([
      'Electrical Specifications – Inverter',
      'Output power at 40 C',
    ]);
    expect(fact.evidence.find((e) => e.role === 'value')?.locator?.path).toContain(
      '/div[2]/div[2]',
    );
    expect(validateProductionArtifactSchema(first.document)).toEqual([]);
    expect(validateProductionArtifactSchema(fact)).toEqual([]);
    const other = prepareProfileQualifiedEvidence(
      fixture(html.replaceAll('Model X', 'Model Y'), load('xantrex'), {
        ...target,
        product_model: 'Model Y',
      }),
    );
    expect(other?.qualification.facts).toHaveLength(1);
    expect(other?.qualification.facts[0].metadata.applicability.value).toBe('Model Y');
  });
  it.each([
    html.replace('data-title="Model X"', 'data-title="Model Y"'),
    html.replace(header, header + header),
    html.replace(
      row,
      row.replace('</div></div>', '</div><div class="xtable-cell">999 W</div></div>'),
    ),
    html.replace(row, row.replace('data-title="Model X"', 'colspan="2" data-title="Model X"')),
    html.replace(row, `<div>${row}</div>`),
    html.replace(row, row.replace('3000 W at 40 C', '<div class="xtable-cell">3000 W</div>')),
    html.replace(row, row.replace('Output power at 40 C', 'Part Number')),
    html.replace(header + row, row + header),
    html.replace('</h2>', '</h2><h2>Competing heading</h2>'),
    html + html,
    html.replace(row, 'note outside cells' + row),
  ])('rejects ambiguous structure atomically', (body) =>
    expect(prepare(body)?.qualification.facts ?? []).toHaveLength(0),
  );
  it('skips unknown values and preserves valid earlier rows only within a valid region', () => {
    const result = prepare(html.replace(row, row + row.replace('3000 W at 40 C', '')))!;
    expect(result.qualification.facts).toHaveLength(1);
    expect(result.qualification.diagnostics.some((d) => d.code === 'missing_value')).toBe(true);
  });
  it('keeps accessory/sibling headers outside identity scope and rejects their regions', () => {
    const body =
      html +
      html
        .replace('Electrical Specifications – Inverter', 'Accessories')
        .replaceAll('Model X', 'Other');
    const result = prepare(body)!;
    expect(result.qualification.facts).toHaveLength(1);
    expect(result.qualification.diagnostics.some((d) => d.code === 'unsupported_structure')).toBe(
      true,
    );
  });
  it('requires the structural configuration and rejects misplaced configuration in the schema', () => {
    const p = load('xantrex');
    const rule = p.html_fact_rules![0],
      region = rule.regions[0];
    expect(
      validateManufacturerAcquisitionProfile({
        ...p,
        html_fact_rules: [{ ...rule, regions: [{ ...region, model_rows: undefined }] }],
      }).ok,
    ).toBe(false);
    expect(
      validateManufacturerAcquisitionProfile({
        ...p,
        html_fact_rules: [{ ...rule, regions: [{ ...region, kind: 'table' }] }],
      }).ok,
    ).toBe(false);
  });
  it('uses the Eaton profile on a second synthetic SKU without granting sibling specifications scope', () => {
    const p = load('eaton');
    expect(validateManufacturerAcquisitionProfile(p).ok).toBe(true);
    const t = {
      ...intake,
      manufacturer: 'Eaton',
      manufacturer_part_number: 'OTHER-24',
      official_product_uri: 'https://www.eaton.com/us/en-us/skuPage.OTHER-24.html',
    };
    const body =
      '<h1 class="module-product-detail-card-v2__title">OTHER-24</h1><div class="product-specification-container"><table class="specifications-table"><tr><td>Voltage rating</td><td>24 Vdc</td></tr></table></div><table><tr><td>Voltage rating</td><td>999 V</td></tr></table>';
    expect(prepareProfileQualifiedEvidence(fixture(body, p, t))?.qualification.facts).toHaveLength(
      1,
    );
    expect(
      prepareProfileQualifiedEvidence(fixture(body.replace('>OTHER-24<', '>OTHER-48<'), p, t))
        ?.qualification.facts,
    ).toHaveLength(0);
  });
});

describe('reviewed explicit non-table specification blocks', () => {
  const ecoflow = (): ManufacturerAcquisitionProfile =>
    JSON.parse(
      readFileSync('data/ingestion/manufacturer-acquisition-profiles/ecoflow.json', 'utf8'),
    );
  const target: ProductIntake = {
    ...intake,
    manufacturer: 'EcoFlow',
    product_model: 'EF-FC-301-1',
    official_product_uri: 'https://us.ecoflow.com/products/800w-alternator-charger',
  };
  const block = (label: string, lines: string) =>
    `<div class="pdp-specs-block"><p class="pdp-specs-title">${label}</p><div class="pdp-specs-content">${lines}</div></div>`;
  const model = block('Model', '<p>EF-FC-301-1</p>');
  const flat = block('Fuse current', '<p>125A</p>');
  const nested = block('Charging Mode', '<p>Input: 11V-31V</p><p>Output: 800W Max.</p>');
  const page = (rows = model + flat + nested) =>
    `<section class="pdp-specs"><h2>Specs</h2><div class="pdp-specs-container">${rows}</div></section>`;
  const prepare = (html = page()) =>
    prepareProfileQualifiedEvidence(fixture(html, ecoflow(), target))!;

  it('binds one exact model and preserves flat and nested source context with locators', () => {
    expect(validateManufacturerAcquisitionProfile(ecoflow()).ok).toBe(true);
    const result = prepare(page() + '<section><p>Current: 999 A</p></section>');
    expect(result).toEqual(prepare(page() + '<section><p>Current: 999 A</p></section>'));
    expect(result.qualification.facts).toHaveLength(3);
    expect(result.qualification.facts.map((f) => f.metadata.raw_value)).toEqual([
      '125A',
      '11V-31V',
      '800W Max.',
    ]);
    expect(result.qualification.facts[1].metadata.source_label).toBe('Input');
    expect(result.qualification.facts[1].metadata.conditions).toEqual(['Specs', 'Charging Mode']);
    expect(result.qualification.facts[2].metadata.source_label).toBe('Output');
    expect(
      result.qualification.facts[1].evidence.find(
        (e) => e.role === 'qualifier' && e.text === 'Charging Mode',
      )?.locator?.path,
    ).toContain('/p[1]');
    expect(
      result.qualification.facts.every((f) => validateProductionArtifactSchema(f).length === 0),
    ).toBe(true);
  });
  it('keeps multiple unlabelled source lines as one ordered raw array', () => {
    const result = prepare(page(model + block('Dimensions', '<p>9.5 in</p><p>242 mm</p>')));
    expect(result.qualification.facts).toHaveLength(1);
    expect(result.qualification.facts[0].metadata.raw_value).toEqual(['9.5 in', '242 mm']);
  });
  it('requires a unique exact model and retains missing values as unknown', () => {
    expect(prepare(page().replace('EF-FC-301-1', 'Other')).qualification.facts).toHaveLength(0);
    expect(prepare(page(model + model + flat)).qualification.facts).toHaveLength(0);
    const result = prepare(page(model + flat + block('Unknown', '<p></p>')));
    expect(result.qualification.facts).toHaveLength(1);
    expect(result.qualification.diagnostics.some((d) => d.code === 'missing_value')).toBe(true);
  });
  it.each([
    page(model + flat + block('Other model', '<p>Other</p>')),
    page(model + flat + block('Voltage', '<p>12 V</p><span>24 V</span>')),
    page(model + flat + block('Voltage', '<p><strong>12 V</strong></p>')),
    page(model + flat + block('Voltage', '<p>Input: 12 V</p><p>24 V</p>')),
    page(model + flat + block('Charging Mode', '<p>Input:</p>')),
    page(model + flat + block('Voltage', '<p>Input: 12 V</p><p>Input: 24 V</p>')),
    page(model + flat + block('SKU', '<p>Other</p>')),
    page(model + flat + '<div class="unexpected">extra axis</div>'),
    page(
      model +
        flat +
        '<div class="pdp-specs-block"><p class="pdp-specs-title">Voltage</p><div class="pdp-specs-content"><p>12 V</p></div><span>extra</span></div>',
    ),
    page(
      model +
        flat +
        '<div class="pdp-specs-block"><p class="pdp-specs-title">Voltage</p><div class="pdp-specs-content"><div class="pdp-specs-block"></div></div></div>',
    ),
    page(model + flat + nested) + page(model + flat),
    page(model + flat).replace('</section>', '<div>unselected section axis</div></section>'),
  ])('rejects a whole region when later structure is ambiguous (%#)', (html) => {
    const result = prepare(html);
    expect(result.qualification.facts).toHaveLength(0);
    expect(
      result.qualification.diagnostics.some(
        (d) => d.code === 'unsupported_structure' || d.code === 'identity_unresolved',
      ),
    ).toBe(true);
  });
  it('rejects absent or misplaced structural profile configuration', () => {
    const p = ecoflow(),
      rule = p.html_fact_rules![0],
      region = rule.regions[0];
    expect(
      validateManufacturerAcquisitionProfile({
        ...p,
        html_fact_rules: [{ ...rule, regions: [{ ...region, explicit_blocks: undefined }] }],
      }).ok,
    ).toBe(false);
    expect(
      validateManufacturerAcquisitionProfile({
        ...p,
        html_fact_rules: [{ ...rule, regions: [{ ...region, kind: 'table' }] }],
      }).ok,
    ).toBe(false);
    expect(
      validateManufacturerAcquisitionProfile({
        ...p,
        html_fact_rules: [
          { ...rule, regions: [region, { kind: 'table', selector: [{ id: 'other' }] }] },
        ],
      }).ok,
    ).toBe(false);
  });
});

describe('unique model-column applicability', () => {
  const matrix =
    '<table><tr><th>Model</th><th>EX-X</th><th>EX-Y</th></tr><tr><th>Voltage</th><td>12 / 24 V</td><td>999 V</td></tr></table>';
  const qualify = (html: string) => {
    const f = fixture(html);
    return qualifyDocumentExtraction(f.document, {
      manufacturer_part_number: 'EX-X',
      product_model: 'Model X',
    });
  };
  it('selects only the exact header column and preserves compound raw values', () => {
    const result = qualify(matrix);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].metadata.raw_value).toBe('12 / 24 V');
    expect(result.facts[0].metadata.applicability.reason).toContain('model-column-scope.v1');
  });
  it.each([
    matrix.replace('EX-Y', 'EX-X'),
    matrix.replace('EX-X', 'EX-Z'),
    matrix.replace('<td>12', '<td colspan="2">12'),
    matrix.replace('<th>Voltage</th>', '<th>Model</th>'),
    matrix.replace('<td>12 / 24 V</td>', '<td></td>'),
  ])('rejects competing, spanned, repeated axes and missing target values', (html) =>
    expect(qualify(html).facts).toHaveLength(0),
  );
  it('keeps unattached notes as forward qualifier evidence without assigning them backwards', () => {
    const result = qualify(
      matrix.replace(
        '</table>',
        '<tr><td></td><td>At 40 C only</td></tr><tr><th>Current</th><td>15 A</td><td>20 A</td></tr></table>',
      ),
    );
    expect(result.facts[0].evidence.some((e) => e.role === 'qualifier')).toBe(false);
    expect(
      result.facts[1].evidence.some((e) => e.role === 'qualifier' && e.text === 'At 40 C only'),
    ).toBe(true);
  });
  it('keeps label-only separator rows as qualifier context', () => {
    const result = qualify(
      matrix.replace('</tr><tr><th>Voltage', '</tr><tr><th>Charger mode</th></tr><tr><th>Voltage'),
    );
    expect(result.facts).toHaveLength(1);
    expect(
      result.facts[0].evidence.some((e) => e.role === 'qualifier' && e.text === 'Charger mode'),
    ).toBe(true);
  });
  it('snapshots repeated separators only for subsequent observations deterministically', () => {
    const html = matrix.replace(
      '</table>',
      '<tr><th>Charger mode</th></tr><tr><th>Current</th><td>15 A</td><td>20 A</td></tr><tr><th>At 40 C</th></tr><tr><th>Power</th><td>100 W</td><td>200 W</td></tr></table>',
    );
    const result = qualify(html);
    expect(result).toEqual(qualify(html));
    expect(result.facts).toHaveLength(3);
    expect(
      result.facts.map((f) => f.evidence.filter((e) => e.role === 'qualifier').map((e) => e.text)),
    ).toEqual([[], ['Charger mode'], ['Charger mode', 'At 40 C']]);
  });
});

describe('one supplementary retained-item envelope', () => {
  // Split lines among 100 small regions to exercise the real 10,000-item cap
  // without hitting the independent per-block text bound or ordinary parser cap.
  // No production limit is mocked or increased to reach this boundary.
  it.each([0, 1])('handles the combined exact-bound + %i case atomically', (extra) => {
    const regionCount = 100;
    const blockCount = regionCount + 1; // Region blocks plus the retained identity block.
    const observationCount = DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_items - blockCount + extra;
    const p = profile('label_value_lines');
    const configured = {
      ...p,
      html_fact_rules: p.html_fact_rules!.map((rule) => ({
        ...rule,
        regions: [{ kind: 'label_value_lines' as const, selector: [{ class_name: 'spec' }] }],
      })),
    };
    const html =
      identity +
      Array.from({ length: regionCount }, (_, index) => {
        const count =
          Math.floor(observationCount / regionCount) +
          (index < observationCount % regionCount ? 1 : 0);
        return (
          '<div class="spec"><p>' +
          Array.from({ length: count }, () => 'Voltage: 12 V').join('<br>') +
          '</p></div>'
        );
      }).join('');
    const input = fixture(html, configured);
    expect(input.document.status).toBe('extracted');
    expect(input.source.body.bytes.length).toBeLessThan(
      DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_input_bytes,
    );
    const result = prepareProfileQualifiedEvidence(input)!;
    expect(validateDocumentExtraction(result.document)).toEqual([]);
    expect(validateProductionArtifactSchema(result.document)).toEqual([]);
    if (extra === 0) {
      expect(result.qualification.outcome).toBe('qualified');
      expect(result.document.blocks).toHaveLength(blockCount);
      expect(result.qualification.facts).toHaveLength(observationCount);
      expect(result.document.blocks.length + result.qualification.facts.length).toBe(
        DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_items,
      );
    } else {
      expect(result.qualification.outcome).toBe('source_incomplete');
      expect(result.qualification.completeness).toBe('partial');
      expect(result.document.blocks).toEqual([]);
      expect(result.qualification.facts).toEqual([]);
      expect(result.qualification.diagnostics.some((d) => d.code === 'partial_source')).toBe(true);
    }
  });
});

describe('read-only evidence URI eligibility', () => {
  it.each([
    '/cart/',
    '/?add-to-cart=1',
    '/?do=edit',
    '/?do=backlink',
    '/?action=delete',
    '/checkout',
    '/?do=index',
    '/?message=send',
    '/?do=plugin_bookcreator__addtobook',
  ])('excludes explicit actions %s', (path) =>
    expect(isReadOnlyEvidenceUri('https://example.com' + path)).toBe(false),
  );
  it.each([
    '/index/manuals',
    '/?do=export_pdf&id=manual',
    '/?_document_product=EX-X',
    '/downloads/manual.pdf?version=2',
    '/products/charge-controller',
  ])('keeps technical endpoints %s', (path) =>
    expect(isReadOnlyEvidenceUri('https://example.com' + path)).toBe(true),
  );
  it('preserves action discovery metadata without spending a capture slot', async () => {
    const requests: string[] = [];
    const adapter = new HttpSourceCaptureAdapter(
      async (request) => {
        requests.push(String(request));
        return new Response(
          '<html><body>' +
            'Technical product information. '.repeat(50) +
            '<a href="/?add-to-cart=1">Manual download</a><a href="/manual.pdf?version=2">Datasheet</a></body></html>',
          { headers: { 'content-type': 'text/html' } },
        );
      },
      () => '2026-09-29T00:00:00Z',
      async () => ['93.184.216.34'],
    );
    const result = await acquireOfficialSources({
      intake,
      adapter,
      policy: { max_captured_candidates: 1 },
    });
    expect(
      result.candidates.some(
        (c) =>
          c.candidate.normalized_uri.includes('add-to-cart') &&
          c.candidate.selection_status === 'excluded_by_policy',
      ),
    ).toBe(true);
    expect(requests).toContain('https://example.com/manual.pdf?version=2');
    expect(requests.some((u) => u.includes('add-to-cart'))).toBe(false);
  });
  it('rejects action redirects before fetching their destination', async () => {
    const requests: string[] = [];
    const adapter = new HttpSourceCaptureAdapter(
      async (request) => {
        requests.push(String(request));
        return new Response(null, { status: 302, headers: { location: '/checkout' } });
      },
      () => '2026-09-29T00:00:00Z',
      async () => ['93.184.216.34'],
    );
    const result = await adapter.capture({ uri: intake.official_product_uri });
    expect(result.status).toBe('invalid');
    expect(requests).toHaveLength(1);
  });
});

describe('reviewed structured records enter production qualification', () => {
  const p: ManufacturerAcquisitionProfile = {
    ...profile(),
    html_fact_rules: [],
    strategies: [
      {
        id: 'exact-record',
        status: 'reviewed',
        reference_uri: intake.official_product_uri,
        path_prefix: '/products/',
        document_link_discovery: {
          link_attribute: 'href',
          allowed_extensions: ['.pdf'],
          path_prefix: '/docs/',
        },
        embedded_json: {
          representation: 'application_state',
          script: { id: 'STATE', media_type: 'application/json' },
          json_path: '$.props',
          record_collection_path: '$.products',
          identity_property: 'sku',
          fact_mappings: [
            { source_path: 'battery_voltage', raw_label: 'Supported battery voltage' },
            {
              source_path: 'rated_charge_current',
              raw_label: 'Continuous charge current',
              source_unit: 'A',
            },
            { source_path: 'absent', raw_label: 'Missing current', source_unit: 'A' },
          ],
        },
      },
    ],
  };
  const record = { sku: 'EX-X', battery_voltage: ['12V', '24V'], rated_charge_current: 15 };
  const script = (records: unknown[]) =>
    `<p>${identity}</p><script id="STATE" type="application/json">${JSON.stringify({ props: { products: records } })}</script>`;
  it('keeps exact raw JSON types, array values, units and record/property locators', () => {
    expect(validateManufacturerAcquisitionProfile(p).ok).toBe(true);
    const input = fixture(script([{ sku: 'EX-Y', rated_charge_current: 999 }, record]), p),
      result = prepareProfileQualifiedEvidence(input)!;
    expect(result.qualification.facts).toHaveLength(2);
    expect(
      result.qualification.facts.find(
        (f) => f.metadata.source_label === 'Supported battery voltage',
      )?.metadata.raw_value,
    ).toEqual(['12V', '24V']);
    const current = result.qualification.facts.find((f) => f.metadata.source_unit === 'A')!;
    expect(current.metadata.raw_value).toBe(15);
    expect(
      current.evidence.some((e) => e.locator?.path?.includes('[1].rated_charge_current')),
    ).toBe(true);
    expect(result.qualification.diagnostics.some((d) => d.code === 'missing_value')).toBe(true);
    expect(prepareProfileQualifiedEvidence(input)).toEqual(result);
  });
  it.each([
    script([record, record]),
    script([{ ...record, sku: 'EX-X extra' }]),
    script([record]) + script([record]),
    '<script id="STATE" type="application/json">broken</script>',
  ])('rejects duplicate/missing/ambiguous structured identity or script', (html) =>
    expect(facts(html, p)).toHaveLength(0),
  );
});

describe('source-supported voltage sets remain atomic', () => {
  it('normalizes the complete explicit unit-bearing set', () =>
    expect(
      resolveCanonicalField('Supported battery voltage')?.normalize_value?.('12V, 24V'),
    ).toEqual([12, 24]));
  it.each(['12V, unknown', '12V,', '12, 24', ''])(
    'does not silently drop missing/invalid members: %s',
    (value) =>
      expect(
        resolveCanonicalField('Supported battery voltage')?.normalize_value?.(value),
      ).toBeUndefined(),
  );
  it('retains label conditions despite a recognized semantic alias', () =>
    expect(
      facts(
        identity + table.replace('Nominal voltage', 'Continuous inverter AC output power at 25°C'),
      )[0].metadata.conditions,
    ).toEqual(['Continuous inverter AC output power at 25°C']));
});
