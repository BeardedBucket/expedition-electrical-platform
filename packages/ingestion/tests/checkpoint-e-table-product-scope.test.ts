import { describe, expect, it } from 'vitest';
import { extractHtmlDocument } from '../src/document-extraction.js';
import {
  artifactReference,
  buildDocumentExtractionArtifact,
  qualifyDocumentExtraction,
  type DocumentExtractionArtifact,
} from '../src/production-contracts.js';

const target = { product_model: 'Device ZX', manufacturer_part_number: 'PN-42' };
const specification = '<tr><td>Nominal voltage</td><td colspan="3">24 V</td></tr>';
const html = (
  title = 'Device ZX<sup>[1]</sup>',
  body = specification,
  attributes = 'colspan="4"',
) => `<table><tr><th ${attributes}>${title}</th></tr>${body}</table>`;
const document = (markup = html()): DocumentExtractionArtifact => {
  const source = {
    requested_uri: 'https://example.invalid/device-zx',
    final_uri: 'https://example.invalid/device-zx',
    retrieved_at: '2026-09-28T00:00:00Z',
    media_type: 'text/html',
    body: { text: markup, bytes: new TextEncoder().encode(markup) },
  };
  return buildDocumentExtractionArtifact(
    extractHtmlDocument(source),
    artifactReference('source_capture', { id: 'capture.synthetic' }),
    {
      source_acquisition: artifactReference('source_acquisition', { id: 'acquisition.synthetic' }),
    },
  );
};
const qualify = (markup = html()) => qualifyDocumentExtraction(document(markup), target);
const unresolved = (markup: string) => {
  const result = qualify(markup);
  expect(result.facts).toHaveLength(0);
  expect(
    result.diagnostics.some((diagnostic) => diagnostic.code === 'applicability_unresolved'),
  ).toBe(true);
};

describe('whole-table-product-scope.v1', () => {
  it('qualifies single-product spanning-header evidence despite an intake MPN', () => {
    const result = qualify();
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].metadata).toMatchObject({
      source_label: 'Nominal voltage',
      source_wording: 'Nominal voltage',
      raw_value: '24',
      source_unit: 'V',
      raw_identifier: 'Device ZX',
      applicability: { kind: 'exact_product', value: 'Device ZX' },
    });
    expect(result.facts[0].qualification_state).toBe('structurally_supported');
    expect(JSON.stringify(result.facts)).not.toContain('PN-42');
  });
  it('retains exact MPN row evidence as narrower than a model title', () => {
    const result = qualify(
      html(
        'Device ZX',
        '<tr><th>Model</th><th>Nominal voltage</th></tr><tr><td>PN-42</td><td colspan="3">24 V</td></tr>',
      ),
    );
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].metadata.applicability).toEqual({
      kind: 'exact_mpn_or_sku',
      value: 'PN-42',
    });
    expect(result.facts[0].metadata.raw_value).toBe('24');
  });
  it('keeps exact target rows usable in a multi-product table', () => {
    const result = qualify(
      '<table><tr><th>MPN</th><th>Nominal voltage</th></tr><tr><td>PN-43</td><td>48 V</td></tr><tr><td>PN-42</td><td>24 V</td></tr></table>',
    );
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].metadata.raw_value).toBe('24');
    expect(result.facts[0].metadata.applicability.kind).toBe('exact_mpn_or_sku');
  });
  it('does not fall back to model scope when multiple exact MPN rows exist', () => {
    unresolved(
      html(
        'Device ZX',
        '<tr><td>PN-42</td><td colspan="3">24 V</td></tr><tr><td>PN-42</td><td colspan="3">48 V</td></tr>',
      ),
    );
  });
  it('does not emit product title or full-span section separators as facts', () => {
    const result = qualify(
      html('Device ZX<sup>[1]</sup>', '<tr><td colspan="4">Electrical</td></tr>' + specification),
    );
    expect(result.facts.map((fact) => fact.metadata.source_label)).toEqual(['Nominal voltage']);
  });
  it('uses structured ordinary text without mutating raw source evidence', () => {
    const input = document();
    const before = structuredClone(input);
    const result = qualifyDocumentExtraction(input, target);
    expect(input).toEqual(before);
    expect(input.blocks[0].cells![0].value).toBe('Device ZX [1]');
    expect(result.facts[0].evidence!.find((evidence) => evidence.role === 'context')!.text).toBe(
      'Device ZX [1]',
    );
    expect(result.facts[0].evidence!.find((evidence) => evidence.role === 'subject')!.text).toBe(
      'Device ZX',
    );
  });
  it('accepts a plain exact product header without annotation', () => {
    expect(qualify(html('Device ZX')).facts).toHaveLength(1);
  });
  it('accepts only trailing positive bracketed numeric superscript references', () => {
    expect(qualify(html('Device ZX<sup>[1]</sup><sup>[12]</sup>')).facts).toHaveLength(1);
  });
  it.each(['2', 'Pro', 'X', 'TM', '+', '[0]', '[x]', '[1,2]'])(
    'does not ignore superscript %s',
    (residual) => {
      unresolved(html(`Device ZX<sup>${residual}</sup>`));
    },
  );
  it('does not ignore even bracketed subscript content', () => {
    unresolved(html('Device ZX<sub>[1]</sub>'));
  });
  it('does not strip bracketed raw text without script structure', () => {
    unresolved(html('Device ZX [1]'));
  });
  it.each(['Device ZX Pro', 'device zx', 'Other Device'])(
    'does not normalize model %s into the target',
    (title) => {
      unresolved(html(title));
    },
  );
  it('does not collapse internal whitespace in the requested model', () => {
    expect(
      qualifyDocumentExtraction(document(), {
        product_model: 'Device  ZX',
        manufacturer_part_number: 'PN-42',
      }).facts,
    ).toHaveLength(0);
  });
  it('retains existing trim-only exact identity normalization', () => {
    const result = qualifyDocumentExtraction(document(html('Device ZX')), {
      product_model: ' Device ZX ',
      manufacturer_part_number: 'PN-42',
    });
    expect(result.facts[0].metadata.applicability.value).toBe('Device ZX');
  });
  it('rejects peer model headers', () => {
    unresolved(
      '<table><tr><th colspan="2">Device ZX</th><th colspan="2">Device ZX Plus</th></tr><tr><td>Voltage</td><td colspan="3">24 V</td></tr></table>',
    );
  });
  it('rejects a product header covering less than the contents width', () => {
    unresolved(html('Device ZX', specification, 'colspan="2"'));
  });
  it('rejects a product header wider than its published contents', () => {
    unresolved(html('Device ZX', specification, 'colspan="5"'));
  });
  it('requires an explicit whole-table span', () => {
    unresolved(html('Device ZX', specification, ''));
  });
  it('rejects repeated or competing full-span headers', () => {
    unresolved(
      html(
        'Device ZX',
        specification + '<tr><th colspan="4">Device ZX Plus</th></tr>' + specification,
      ),
    );
    unresolved(
      html('Device ZX', specification + '<tr><th colspan="4">Device ZX</th></tr>' + specification),
    );
  });
  it('rejects repeated target-like data identity locations', () => {
    unresolved(html('Device ZX', '<tr><td colspan="4">Device ZX Plus</td></tr>' + specification));
  });
  it('rejects variant-labelled rows even under a matching product title', () => {
    unresolved(
      html(
        'Device ZX',
        '<tr><td>Variant A</td><td colspan="3">24 V</td></tr><tr><td>Variant B</td><td colspan="3">48 V</td></tr>',
      ),
    );
  });
  it('rejects comparison rows containing multiple value columns', () => {
    unresolved(
      html('Device ZX', '<tr><td>Voltage</td><td>24 V</td><td colspan="2">48 V</td></tr>'),
    );
  });
  it('rejects nested table structures instead of projecting their rows into the parent scope', () => {
    unresolved(
      html(
        'Device ZX',
        '<tr><td>Voltage</td><td colspan="3"><table><tr><td>Other product</td><td colspan="3">24 V</td></tr></table></td></tr>',
      ),
    );
  });
  it('rejects contradictory part-number evidence', () => {
    unresolved(
      html('Device ZX', '<tr><td>Part number</td><td colspan="3">PN-43</td></tr>' + specification),
    );
  });
  it('respects header/data roles and explicit row scope', () => {
    unresolved(html().replace('<th ', '<td ').replace('</th>', '</td>'));
    unresolved(html('Device ZX', specification, 'colspan="4" scope="row"'));
  });
  it('does not infer product identity from a heading or acquisition URI', () => {
    unresolved('<h1>Device ZX</h1>' + html('Specifications'));
  });
  it('leaves missing model identity unresolved', () => {
    expect(
      qualifyDocumentExtraction(document(), { manufacturer_part_number: 'PN-42' }).facts,
    ).toHaveLength(0);
  });
  it('rejects rowspan layouts without invoking grid reconstruction', () => {
    unresolved(html('Device ZX', specification, 'colspan="4" rowspan="2"'));
  });
  it('requires table/cell structural locator binding', () => {
    const input = document();
    const block = input.blocks[0];
    const foreign = {
      ...input,
      blocks: [
        {
          ...block,
          cells: block.cells!.map((cell, index) =>
            index === 1
              ? { ...cell, source_location: { ...cell.source_location, table: 'table-other' } }
              : cell,
          ),
        },
      ],
    };
    expect(qualifyDocumentExtraction(foreign, target).facts).toHaveLength(0);
  });
  it('rejects conflicting raw and inline header evidence', () => {
    const input = document();
    const block = input.blocks[0];
    const foreign = {
      ...input,
      blocks: [
        {
          ...block,
          cells: block.cells!.map((cell, index) =>
            index === 0 ? { ...cell, value: 'Device ZX Pro [1]' } : cell,
          ),
        },
      ],
    };
    expect(qualifyDocumentExtraction(foreign, target).facts).toHaveLength(0);
  });
  it('preserves each fact locator and all artifact bindings', () => {
    const input = document();
    const fact = qualifyDocumentExtraction(input, target).facts[0];
    expect(fact.source_capture).toEqual(input.source_capture);
    expect(fact.source_acquisition).toEqual(input.source_acquisition);
    expect(fact.document_extraction).toEqual(artifactReference('document_extraction', input));
    expect(fact.evidence!.find((evidence) => evidence.role === 'value')!.locator).toEqual(
      input.blocks[0].cells![2].source_location,
    );
    expect(fact.evidence!.find((evidence) => evidence.role === 'subject')!.locator).toEqual(
      input.blocks[0].cells![0].source_location,
    );
  });
  it('does not turn missing values into defaults', () => {
    expect(
      qualify(html('Device ZX', '<tr><td>Voltage</td><td colspan="3"></td></tr>')).facts,
    ).toHaveLength(0);
  });
  it('keeps units absent when the source has no native unit', () => {
    const result = qualify(html('Device ZX', '<tr><td>Buzzer</td><td colspan="3">Yes</td></tr>'));
    expect(result.facts[0].metadata.raw_value).toBe('Yes');
    expect(result.facts[0].metadata).not.toHaveProperty('source_unit');
  });
  it('does not use partial or truncated evidence for whole-table scope', () => {
    expect(
      qualifyDocumentExtraction({ ...document(), status: 'partially_extracted' }, target).facts,
    ).toHaveLength(0);
    expect(
      qualifyDocumentExtraction(
        {
          ...document(),
          diagnostics: [{ code: 'table_cell_limit_reached', message: 'truncated' }],
        },
        target,
      ).facts,
    ).toHaveLength(0);
  });
  it('does not qualify non-authoritative documents', () => {
    expect(
      qualifyDocumentExtraction({ ...document(), status: 'source_non_authoritative' }, target)
        .facts,
    ).toHaveLength(0);
  });
  it('does not expand ordinary prose or PDF ordinal adjacency', () => {
    expect(qualify('<h1>Device ZX</h1><p>Nominal voltage: 24 V</p>').facts).toHaveLength(0);
    const input = document();
    expect(
      qualifyDocumentExtraction(
        {
          ...input,
          blocks: [
            {
              id: 'pdf-1',
              kind: 'heading',
              content: 'Device ZX',
              locator: { kind: 'pdf', page: 1, ordinal: 1 },
            },
            {
              id: 'pdf-2',
              kind: 'text_block',
              content: 'Voltage: 24 V',
              locator: { kind: 'pdf', page: 1, ordinal: 2 },
            },
          ],
        },
        target,
      ).facts,
    ).toHaveLength(0);
  });
  it('replays identical facts deterministically', () => {
    expect(qualifyDocumentExtraction(document(), target)).toEqual(
      qualifyDocumentExtraction(document(), target),
    );
  });
});
