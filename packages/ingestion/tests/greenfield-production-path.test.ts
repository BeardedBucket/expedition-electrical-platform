import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { classifyCapturePriority } from '../src/capture-priority.js';
import {
  prepareProductionIngestReview,
  evaluateSemanticReviewCompletion,
  type ProductIntake,
  type SourceCaptureAdapter,
  recognizeSemanticAssertion,
  replaySemanticAssertion,
  semanticRulesFor,
  captureSourceForProduction,
} from '../src/index.js';

// Project-authored source shapes, not redistributed manufacturer documents.
// These fixtures enter at capture and never construct QualifiedFacts manually.
const uri = 'https://example.test/products/device';
const intake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'greenfield.fixture',
  manufacturer: 'Independent Example',
  product_model: 'Example Device',
  manufacturer_part_number: 'EX-42',
  official_product_uri: uri,
};
const html = (spec: string, sku = 'EX-42', extra = '') => `<html><body>
<script type="application/ld+json">${JSON.stringify([
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Example Publisher',
    url: 'https://example.test',
  },
  { '@context': 'https://schema.org', '@type': 'Product', name: 'Example Device', sku },
])}</script>
<main><h1>Example Device</h1><section><h2>Specifications</h2>${spec}</section>${extra}</main></body></html>`;
const prepare = (body: string) => {
  const bytes = new TextEncoder().encode(body);
  const adapter: SourceCaptureAdapter = {
    async capture(request) {
      return {
        status: 'success',
        issues: [],
        source: {
          requested_uri: request.uri,
          final_uri: request.uri,
          media_type: 'text/html',
          response_status: 200,
          retrieved_at: '2026-10-05T00:00:00.000Z',
          body: { bytes, text: body },
          content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        },
      };
    },
  };
  return prepareProductionIngestReview({ intake, adapter, policy: { max_captured_candidates: 0 } });
};

describe('greenfield production source-to-candidate path', () => {
  it('selects an exact native variant, retains family properties, and uses explicit unitText', async () => {
    const group = {
      '@type': 'ProductGroup',
      name: 'Example Device',
      additionalProperty: [{ '@type': 'PropertyValue', name: 'Weight', value: '2 kg' }],
      hasVariant: [
        {
          '@type': 'Product',
          name: 'Example Device selected',
          sku: 'EX-42',
          additionalProperty: [
            { '@type': 'PropertyValue', name: 'DC output voltage', value: 24, unitText: 'VDC' },
          ],
        },
        {
          '@type': 'Product',
          name: 'Example Device sibling',
          sku: 'EX-99',
          additionalProperty: [
            { '@type': 'PropertyValue', name: 'DC output voltage', value: 48, unitText: 'VDC' },
          ],
        },
      ],
    };
    const body = html('').replace(
      '{"@context":"https://schema.org","@type":"Product","name":"Example Device","sku":"EX-42"}',
      JSON.stringify(group),
    );
    const result = await prepare(body);
    if (result.status !== 'review_ready') throw Error('unexpected failure');
    expect(
      result.qualified_facts.find((f) => f.metadata.source_label === 'Weight')?.metadata
        .applicability.kind,
    ).toBe('family');
    expect(
      result.qualified_facts.find((f) => f.metadata.source_label === 'DC output voltage')?.metadata,
    ).toMatchObject({
      raw_value: '24',
      source_unit: 'VDC',
      applicability: { kind: 'exact_mpn_or_sku', value: 'EX-42' },
    });
    expect(result.bridge.projected_proposal_ids).toHaveLength(1);
    const ambiguous = await prepare(body.replace('"sku":"EX-99"', '"sku":"EX-42"'));
    if (ambiguous.status !== 'review_ready') throw Error('unexpected failure');
    expect(ambiguous.qualified_facts).toEqual([]);
  });
  it('qualifies a literal-code-owned two-column list group and rejects a competing code', async () => {
    const list =
      '<div><ul><li><span>Product Code</span><span>EX-42</span></li><li><span>DC output voltage</span><span>24 VDC</span></li></ul><ul><li><span>Weight</span><span>2 kg</span></li><li><span>Continuous DC power</span><span>400 W</span></li></ul></div>';
    const result = await prepare(
      html(list).replace('<h2>Specifications</h2>', '<h2>Unrelated marketing heading</h2>'),
    );
    if (result.status !== 'review_ready') throw Error('unexpected failure');
    expect(result.qualified_facts).toHaveLength(4);
    expect(result.bridge.projected_proposal_ids).toHaveLength(3);
    const negative = await prepare(
      html(list.replace('Product Code', 'SKU').replace('<span>EX-42</span>', '<span>EX-99</span>')),
    );
    if (negative.status !== 'review_ready') throw Error('unexpected failure');
    expect(negative.bridge.projected_proposal_ids).toEqual([]);
  });
  it('preserves photovoltaic operating points and short-circuit basis from independently owned module properties', async () => {
    const props = [
      ['Cells', 'Monocrystalline'],
      ['Module Weight', '24.68 lbs'],
      ['Maximum Power (Pmax)', '200 W'],
      ['Voltage at Pmax (Vmp)', '20.74 V'],
      ['Current at Pmax (Imp)', '9.68 A'],
      ['Open-Circuit Voltage (Voc)', '24.34 V'],
      ['Short-Circuit Current (Isc)', '10.31 A'],
    ];
    const body = html('').replace(
      '"sku":"EX-42"',
      '"sku":"EX-42","additionalProperty":' +
        JSON.stringify(props.map(([name, value]) => ({ '@type': 'PropertyValue', name, value }))),
    );
    const result = await prepare(body);
    if (result.status !== 'review_ready') throw Error('unexpected failure');
    expect(result.bridge.projected_proposal_ids).toHaveLength(6);
    expect(
      result.proposals.find((p) => p.target === 'electrical.output_power_w')?.qualified_value,
    ).toMatchObject({
      value: 200,
      qualifiers: { rating_basis: 'maximum', direction: 'output', electrical_domain: 'dc' },
    });
    expect(
      result.proposals.find((p) => p.target === 'electrical.output_voltage_v')?.qualified_value
        ?.qualifiers.source_conditions,
    ).toEqual(['Voltage at Pmax (Vmp)']);
    expect(result.proposals.filter((p) => p.target === 'electrical.output_current_a')).toHaveLength(
      2,
    );
    expect(
      result.proposals.find((p) => p.target === 'electrical.pv_open_circuit_voltage_v')
        ?.qualified_value?.qualifiers.direction,
    ).toBe('output');
    const negative = await prepare(body.replace('"Cells"', '"Compatible cells"'));
    if (negative.status !== 'review_ready') throw Error('unexpected failure');
    expect(
      negative.proposals.filter(
        (p) => p.disposition === 'mapped' && p.target.startsWith('electrical.'),
      ),
    ).toEqual([]);
    const fact = result.qualified_facts.find(
      (f) => f.metadata.source_label === 'Maximum Power (Pmax)',
    )!;
    expect(
      recognizeSemanticAssertion(
        fact,
        result.qualified_facts,
        semanticRulesFor('semantic-assertions.v5'),
        'semantic-assertions.v5',
      ),
    ).toBeUndefined();
  });
  it('retains an explicit publishing-site label bound to the exact captured canonical page', async () => {
    const source = html('<div><span>DC output voltage: </span>24 VDC</div>')
      .replace('"@type":"Organization"', '"@type":"UnrecognizedPublisher"')
      .replace(
        '<html>',
        '<html><head><meta property="og:site_name" content="Independent Publication"><meta property="og:url" content="https://example.test/products/device"></head>',
      );
    const result = await prepare(source);
    if (result.status !== 'review_ready') throw Error('unexpected failure');
    expect(result.bridge.projected_proposal_ids).toHaveLength(1);
    expect(result.captures[0].source_provenance).toMatchObject({
      publisher: 'Independent Publication',
      publisher_label_scope: 'publishing_site_display_name',
    });
    const negative = await prepare(
      source.replace(
        'content="https://example.test/products/device"',
        'content="https://other.test/products/device"',
      ),
    );
    if (negative.status !== 'review_ready') throw Error('unexpected failure');
    expect(negative.bridge.projected_proposal_ids).toEqual([]);
  });
  it('blocks action endpoints before invoking a custom capture adapter', async () => {
    let called = false;
    const result = await captureSourceForProduction(
      {
        async capture() {
          called = true;
          throw new Error('must not perform I/O');
        },
      },
      {
        uri: 'https://example.test/cart.php?action=add&product_id=162',
        capture_id: 'action-boundary',
        retention_status: 'not_retained',
      },
    );
    expect(called).toBe(false);
    expect(result.disposition).toBe('failed');
    expect(result.reasons[0].code).toBe('invalid_uri');
  });
  it('withholds secondary measurements without changing the archived v4 interpretation', async () => {
    const result = await prepare(
      html(
        '<div><span>Weight: </span>33.9 oz (0.96 kg)</div><div><span>Peak power: </span>2000 W (5 seconds)</div>',
      ),
    );
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    const fact = result.qualified_facts.find((f) => f.metadata.source_label === 'Weight')!;
    const current = recognizeSemanticAssertion(fact, result.qualified_facts);
    expect(current?.review_required_reasons).toContain('secondary_quantity_requires_comparison');
    expect(result.bridge.projected_proposal_ids).toHaveLength(1);
    const archived = recognizeSemanticAssertion(
      fact,
      result.qualified_facts,
      semanticRulesFor('semantic-assertions.v4'),
      'semantic-assertions.v4',
    )!;
    expect(archived.review_required_reasons).not.toContain(
      'secondary_quantity_requires_comparison',
    );
    expect(replaySemanticAssertion(fact, result.qualified_facts, archived)).toEqual(archived);
  });
  it('refuses competing explicit source units without overriding label evidence', async () => {
    const result = await prepare(html('<div><span>Net weight, [lbs]: </span>4</div>'));
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    // Boundary perturbation of an actual producer artifact, not a greenfield
    // observation or a replacement for the complete integration path.
    const produced = result.qualified_facts[0];
    const competing = { ...produced, metadata: { ...produced.metadata, source_unit: 'kg' } };
    expect(recognizeSemanticAssertion(competing, [competing])?.review_required_reasons).toContain(
      'competing_source_units',
    );
  });
  it('uses exact model scope without attesting a different source SKU and interprets postfix quantity basis', async () => {
    const result = await prepare(
      html(
        '<div><span>Power (Continuous): </span>1000 W</div><div><span>Power (Peak): </span>2000 W (5 seconds)</div><div><span>Charger current: </span>40 A</div><div><span>Inverter standby current: </span>&lt; 1.5 A</div>',
        'EX-42-OTHER',
      ),
    );
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(
      result.qualified_facts.every((f) => f.metadata.applicability.kind === 'exact_product'),
    ).toBe(true);
    expect(result.bridge.projected_proposal_ids).toHaveLength(4);
    expect(
      result.bridge.sources.every(
        (s) => s.product_identity_claim?.manufacturer_part_number === undefined,
      ),
    ).toBe(true);
    expect(
      result.proposals.find((p) => p.target === 'electrical.peak_power_w')?.qualified_value
        ?.qualifiers,
    ).toMatchObject({ rating_basis: 'peak', source_conditions: ['5 seconds'] });
  });
  it('retains explicit Product properties without granting unmatched intake identity', async () => {
    const source = html('')
      .replaceAll('Example Device', 'Different Source Device')
      .replace(
        '"sku":"EX-42"',
        '"sku":"OTHER","additionalProperty":[{"@type":"PropertyValue","name":"DC output voltage","value":"24 VDC"},{"@type":"PropertyValue","name":"Input voltage","value":"12 V","description":"Only in service mode"}]',
      );
    const result = await prepare(source);
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.qualified_facts).toHaveLength(1);
    expect(result.qualified_facts[0].qualification_state).toBe('unresolved');
    expect(result.qualified_facts[0].metadata.applicability.kind).toBe('unresolved');
    expect(result.qualified_facts[0].metadata.raw_identifier).toBe('Different Source Device');
    expect(result.bridge.projected_proposal_ids).toEqual([]);
    expect(result.bridge.candidate).toBeUndefined();
  });

  it('projects exactly owned Product PropertyValue quantities through the actual producers', async () => {
    const result = await prepare(
      html('').replace(
        '"sku":"EX-42"',
        '"sku":"EX-42","additionalProperty":[{"@type":"PropertyValue","name":"DC output voltage","value":"24 VDC"}]',
      ),
    );
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.qualified_facts).toHaveLength(1);
    expect(result.bridge.projected_proposal_ids).toHaveLength(1);
    expect(result.bridge.candidate).toBeDefined();
  });

  it('qualifies native source Product table sections without borrowing a merged quantity', async () => {
    const table =
      '<table><tr><th colspan="2">Dimensions and weight</th></tr><tr><th>Width</th><td>20 mm</td></tr><tr><th>Height</th><td>30 mm</td></tr></table>';
    const result = await prepare(html(table));
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.qualified_facts).toHaveLength(2);
    expect(result.bridge.projected_proposal_ids).toHaveLength(2);
    expect(
      result.qualified_facts.every((f) =>
        f.evidence?.some((e) => e.context?.physical_scope === 'product_body'),
      ),
    ).toBe(true);
    const merged = await prepare(
      html(table.replace('<th>Width</th><td>20 mm</td>', '<td colspan="2">Width 20 mm</td>')),
    );
    if (merged.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(merged.qualified_facts).toEqual([]);
    expect(merged.bridge.projected_proposal_ids).toEqual([]);
  });

  it('uses an explicit owned battery-type assertion, never supported chemistry or a product name', async () => {
    const table = (label: string, value: string) =>
      `<table><tr><th colspan="2">General</th></tr><tr><th>${label}</th><td>${value}</td></tr><tr><th>Ah Capacity</th><td>200 Ah</td></tr></table>`;
    const result = await prepare(
      html(table('Battery type', 'Heated Bluetooth deep-cycle LiFePO4 battery')),
    );
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(
      result.proposals.find((p) => p.target === 'battery.nominal_capacity_ah')?.disposition,
    ).toBe('mapped');
    expect(result.bridge.projected_proposal_ids).toHaveLength(1);
    for (const [label, value] of [
      ['Compatible battery types', 'LiFePO4 battery'],
      ['Battery type', 'LiFePO4'],
      ['Battery type', 'For a LiFePO4 battery'],
    ]) {
      const negative = await prepare(html(table(label, value)));
      if (negative.status !== 'review_ready') throw new Error('unexpected preparation failure');
      expect(negative.bridge.projected_proposal_ids).toEqual([]);
    }
  });

  it('reads a closed label unit while refusing unknown or competing unit metadata', async () => {
    const positive = await prepare(html('<div><span>Net weight, [lbs]: </span>4</div>'));
    if (positive.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(positive.bridge.projected_proposal_ids).toHaveLength(1);
    const negative = await prepare(html('<div><span>Net weight, [not shipping]: </span>4</div>'));
    if (negative.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(negative.bridge.projected_proposal_ids).toEqual([]);
  });

  it('retains recommendations and refuses a charge quantity with the wrong unit dimension', async () => {
    const result = await prepare(
      html(
        '<div><span>Recommended discharge current: </span>15 A</div><div><span>Max continuous charge: </span>20 A</div><div><span>Max continuous discharge: </span>400 W</div>',
      ),
    );
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.bridge.projected_proposal_ids).toHaveLength(2);
    expect(
      result.proposals.find(
        (p) => p.target === 'electrical.discharge_current_a' && p.disposition === 'mapped',
      )?.qualified_value?.qualifiers.source_conditions,
    ).toContain('Recommended discharge current');
    expect(
      result.proposals.find((p) => p.disposition === 'unresolved')?.semantic_assertions?.[0]
        ?.review_required_reasons,
    ).toContain('value_or_unit_unresolved');
  });

  it('schedules technical-data documents without granting fact applicability', () => {
    const base = { parent_uri: uri, depth: 0 as const, max_depth: 1, role: 'unknown' as const };
    expect(
      classifyCapturePriority(
        { ...base, normalized_uri: 'https://example.test/EX-42/technical-data.html' },
        intake,
      ).category,
    ).toBe('technical_specification');
    expect(
      classifyCapturePriority(
        { ...base, normalized_uri: 'https://example.test/technical-support.html' },
        intake,
      ).category,
    ).toBe('support_product');
  });
  it('qualifies source-owned inline pairs and grouped DL without a manufacturer profile', async () => {
    const result = await prepare(
      html(`<div><span>DC output voltage: </span>24 VDC</div>
      <div><strong>Continuous DC power: </strong>400 W</div>
      <dl><div><dt>Weight</dt><dd>2 kg</dd></div><div><dt>Standby current</dt><dd>&lt; 5 mA</dd></div></dl>`),
    );
    expect(result.status).toBe('review_ready');
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.qualified_facts).toHaveLength(4);
    expect(
      result.qualified_facts.every((f) =>
        f.evidence?.some((e) => e.context?.kind === 'qualification_provenance'),
      ),
    ).toBe(true);
    expect(result.reconciliation.groups).toHaveLength(4);
    expect(result.proposals.filter((p) => p.disposition === 'mapped')).toHaveLength(4);
    expect(result.bridge.projected_proposal_ids).toHaveLength(4);
    expect(result.bridge.candidate).toBeDefined();
    expect(result.bridge.sources[0]?.publisher).toBe('Example Publisher');
    const standby = result.proposals.find((p) => p.target === 'electrical.standby_current_a');
    expect(standby?.qualified_value?.qualifiers).toMatchObject({ comparison: 'less_than' });
    expect(
      evaluateSemanticReviewCompletion(
        result.proposals,
        result.bridge.reviewed_semantic_interpretation,
      ).required_dispositions,
    ).toEqual([]);
  });

  it.each([
    [
      'foreign exact identity',
      html('<div><span>DC output voltage: </span>24 VDC</div>', 'EX-420').replaceAll(
        'Example Device',
        'Foreign Device',
      ),
    ],
    [
      'competing visible owner',
      html('<div><span>DC output voltage: </span>24 VDC</div>', 'EX-42', '<h1>Other Product</h1>'),
    ],
    ['plain colon prose', html('<p>DC output voltage: 24 VDC</p>')],
    [
      'nested block in inline pair',
      html('<div><span>DC output voltage: </span><span><p>24 VDC</p></span></div>'),
    ],
    ['misordered DL group', html('<dl><div><dd>24 VDC</dd><dt>DC output voltage</dt></div></dl>')],
    ['unknown unit', html('<div><span>DC output voltage: </span>24 mystery</div>')],
  ])('does not project %s', async (_name, body) => {
    const result = await prepare(body);
    expect(result.status).toBe('review_ready');
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.bridge.projected_proposal_ids).toEqual([]);
    expect(result.bridge.candidate).toBeUndefined();
  });

  it('keeps an explicitly scoped charging-settings condition typed and qualified', async () => {
    const result = await prepare(
      html(
        '',
        'EX-42',
        '<section><h2>Recommended Charging Settings</h2><div><span>Maximum charge current: </span>20 A</div></section>',
      ),
    );
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(
      result.qualified_facts[0]?.evidence?.some((e) => e.context?.kind === 'source_semantic'),
    ).toBe(true);
    expect(
      result.proposals.find((p) => p.target === 'electrical.charge_current_a')?.qualified_value
        ?.qualifiers,
    ).toMatchObject({
      source_conditions: ['Recommended Charging Settings'],
      rating_basis: 'maximum',
    });
  });

  it('handles exact ordinary quantity grammar while preserving v3 replay', async () => {
    const result = await prepare(
      html(
        '<div><span>Input: </span>12 VDC</div><div><span>Surge: </span>800 W</div><div><span>Max Charge Current Amps: </span>40 A</div><div><span>Weight: </span>4 (lbs)</div>',
      ),
    );
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.bridge.projected_proposal_ids).toHaveLength(4);
    const weight = result.qualified_facts.find((f) => f.metadata.source_label === 'Weight')!;
    const archived = recognizeSemanticAssertion(
      weight,
      result.qualified_facts,
      semanticRulesFor('semantic-assertions.v3'),
      'semantic-assertions.v3',
    )!;
    expect(archived.review_required_reasons).toContain('value_or_unit_unresolved');
    expect(replaySemanticAssertion(weight, result.qualified_facts, archived)).toEqual(archived);
    const bareInput = result.qualified_facts.find((f) => f.metadata.source_label === 'Input')!;
    expect(
      recognizeSemanticAssertion(
        bareInput,
        result.qualified_facts,
        semanticRulesFor('semantic-assertions.v3'),
        'semantic-assertions.v3',
      ),
    ).toBeUndefined();
  });

  it('maps product-owned dimension axes with source heading retained and no installed envelope', async () => {
    const result = await prepare(
      html(
        '',
        'EX-42',
        '<section><div><h2>Dimensions &amp; weight</h2></div><dl><div><dt>Width</dt><dd>20 mm</dd></div><div><dt>Height</dt><dd>30 mm</dd></div></dl></section>',
      ),
    );
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.bridge.projected_proposal_ids).toHaveLength(2);
    expect(
      result.qualified_facts.every((f) =>
        f.evidence?.some((e) => e.context?.physical_scope === 'product_body'),
      ),
    ).toBe(true);
    expect(
      result.proposals.every((p) => p.qualified_value?.qualifiers.kind === 'source_rating'),
    ).toBe(true);
    expect(result.proposals.map((p) => p.target).sort()).toEqual([
      'dimensions_mm.x',
      'dimensions_mm.z',
    ]);
  });

  it('withholds bare input without electrical domain and connected-battery ownership', async () => {
    const result = await prepare(
      html(
        '<div><span>Input: </span>12 V</div><div><span>Nominal Battery Voltage: </span>12 V</div>',
      ),
    );
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.bridge.projected_proposal_ids).toEqual([]);
    expect(result.proposals.every((p) => p.disposition === 'unresolved')).toBe(true);
    expect(
      result.proposals
        .flatMap((p) => p.semantic_assertions ?? [])
        .flatMap((a) => a.review_required_reasons),
    ).toEqual(
      expect.arrayContaining(['electrical_domain_required', 'battery_property_owner_required']),
    );
  });

  it('qualifies exact model columns with a source-spanned footnote without borrowing values', async () => {
    const result =
      await prepare(`<html><body><script type="application/ld+json">{"@type":"Organization","name":"Example Publisher","url":"https://example.test"}</script><table><tr><th>Model</th><th>EX-42</th><th>EX-43</th></tr>
      <tr><td></td><td colspan="2">*Requires a connected battery.</td></tr>
      <tr><th>Maximum output current</th><td>20 A</td><td>40 A</td></tr>
      <tr><th>Minimum input voltage</th><td>9 V*</td><td>18 V*</td></tr></table></body></html>`);
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.qualified_facts).toHaveLength(2);
    expect(
      result.qualified_facts.find((f) => f.metadata.source_label === 'Maximum output current')
        ?.metadata.raw_value,
    ).toBe('20');
    const marked = result.qualified_facts.find(
      (f) => f.metadata.source_label === 'Minimum input voltage',
    )!;
    expect(
      marked.evidence?.some(
        (e) => e.text === '*Requires a connected battery.' && e.context?.kind === 'source_semantic',
      ),
    ).toBe(true);
    expect(result.bridge.projected_proposal_ids).toHaveLength(1);
  });

  it.each([
    ['spanned quantity', '<tr><th>Maximum output current</th><td colspan="2">20 A</td></tr>'],
    ['unmarked merged condition', '<tr><td></td><td colspan="2">Only in inverter mode</td></tr>'],
    ['dangling marker', '<tr><th>Maximum output current</th><td>20 A*</td><td>40 A</td></tr>'],
    [
      'repeated marker',
      '<tr><td></td><td colspan="2">*First note</td></tr><tr><td></td><td colspan="2">*Second note</td></tr>',
    ],
  ])('rejects ambiguous matrix %s', async (_name, rows) => {
    const result = await prepare(
      `<html><body><table><tr><th>Model</th><th>EX-42</th><th>EX-43</th></tr>${rows}</table></body></html>`,
    );
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.qualified_facts).toEqual([]);
    expect(result.bridge.projected_proposal_ids).toEqual([]);
  });

  it('qualifies a sole device/model header and keeps later section context forward', async () => {
    const result =
      await prepare(`<html><body><script type="application/ld+json">{"@type":"Organization","name":"Example Publisher","url":"https://example.test"}</script>
      <table><tr><th>Battery monitor</th><th>Example Device</th></tr>
      <tr><td>Supply voltage range</td><td>6.5 - 70 Vdc</td></tr>
      <tr><td>Current draw (backlight off)</td><td>&lt; 1 mA</td></tr>
      <tr><td colspan="2">Measurement accuracy at 20°C</td></tr>
      <tr><td>Current</td><td>± 0.01 A</td></tr></table></body></html>`);
    if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
    expect(result.qualified_facts).toHaveLength(3);
    expect(result.bridge.projected_proposal_ids).toHaveLength(2);
    const current = result.qualified_facts.find((f) => f.metadata.source_label === 'Current')!;
    expect(current.evidence?.some((e) => e.text === 'Measurement accuracy at 20°C')).toBe(true);
    const supply = result.qualified_facts.find(
      (f) => f.metadata.source_label === 'Supply voltage range',
    )!;
    expect(supply.evidence?.some((e) => e.text === 'Measurement accuracy at 20°C')).toBe(false);
    expect(supply.metadata.applicability).toMatchObject({
      kind: 'exact_product',
      value: 'Example Device',
    });
    expect(
      result.bridge.sources.every(
        (source) => source.product_identity_claim?.manufacturer_part_number === undefined,
      ),
    ).toBe(true);
  });

  it.each(['Supported battery monitor', 'Battery monitor accessory', 'Other class'])(
    'rejects a non-owning paired model header %s',
    async (label) => {
      const result = await prepare(
        `<html><body><table><tr><th>${label}</th><th>Example Device</th></tr><tr><td>Supply voltage range</td><td>6.5 - 70 Vdc</td></tr></table></body></html>`,
      );
      if (result.status !== 'review_ready') throw new Error('unexpected preparation failure');
      expect(result.qualified_facts).toEqual([]);
      expect(result.bridge.candidate).toBeUndefined();
    },
  );
});
