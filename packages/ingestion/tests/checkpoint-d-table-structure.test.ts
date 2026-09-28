import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  artifactDigest,
  artifactReference,
  buildDocumentExtractionArtifact,
  validateDocumentExtraction,
  validateProductionArtifactSchema,
  type DocumentExtractionArtifact,
} from '../src/production-contracts.js';
import { extractHtmlDocument } from '../src/document-extraction.js';
import type { CapturedSource } from '../src/capture-types.js';

const source = (html: string): CapturedSource => ({
  requested_uri: 'https://example.invalid/device-zx',
  final_uri: 'https://example.invalid/device-zx',
  media_type: 'text/html',
  retrieved_at: '2026-09-28T00:00:00Z',
  body: { text: html, bytes: new TextEncoder().encode(html) },
});
const capture = artifactReference('source_capture', { id: 'capture.structure' });
const acquisition = artifactReference('source_acquisition', { id: 'acquisition.structure' });
const extract = (html: string, maxTextLength?: number) =>
  extractHtmlDocument(
    source(html),
    maxTextLength === undefined ? {} : { max_text_length: maxTextLength },
  );
const table = (html: string) => extract(html).blocks.find((block) => block.kind === 'table')!;
const cell = (markup: string) => table(`<table><tr>${markup}</tr></table>`).cells![0];
const artifact = (html: string) =>
  buildDocumentExtractionArtifact(extract(html), capture, { source_acquisition: acquisition });
const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'structured-table.html'),
  'utf8',
);

describe('Checkpoint D source table structure', () => {
  it('preserves each cell tag in a mixed header/data row', () => {
    expect(
      table('<table><tr><th>Label</th><td>Value</td></tr></table>').cells!.map((cell) => cell.kind),
    ).toEqual(['header', 'data']);
  });
  it('does not infer header role from bold text or first position', () => {
    expect(cell('<td><strong>Device ZX</strong></td>').kind).toBe('data');
  });
  it('retains declared spans without expanding or duplicating DOM cells', () => {
    const cells = table(
      '<table><tr><th colspan="4" rowspan="2">Device ZX</th><td>Other</td></tr><tr><td>Value</td></tr></table>',
    ).cells!;
    expect(cells).toHaveLength(3);
    expect(cells[0]).toMatchObject({ colspan: 4, rowspan: 2, row: 1, column: 1 });
    expect(cells.map((cell) => [cell.row, cell.column])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ]);
  });
  it.each(['col', 'row', 'colgroup', 'rowgroup'] as const)(
    'preserves declared scope %s',
    (scope) => {
      expect(cell(`<th scope="${scope}">Label</th>`).scope).toBe(scope);
    },
  );
  it('preserves case-insensitive scope keywords', () => {
    expect(cell('<th scope="COL">Label</th>').scope).toBe('col');
  });
  it('omits absent spans and scope rather than asserting defaults', () => {
    const result = cell('<td>24 V</td>');
    for (const name of ['colspan', 'rowspan', 'scope', 'inline_segments'])
      expect(result).not.toHaveProperty(name);
  });
  it('preserves explicitly published span one', () => {
    expect(cell('<td colspan="1" rowspan="1">Value</td>')).toMatchObject({
      colspan: 1,
      rowspan: 1,
    });
  });
  it.each(['0', '-2', '1.5', '4x', '+4', 'Infinity', '9007199254740992', ''])(
    'does not fabricate valid spans from %j',
    (value) => {
      const result = cell(`<td colspan="${value}" rowspan="${value}">Value</td>`);
      expect(result).not.toHaveProperty('colspan');
      expect(result).not.toHaveProperty('rowspan');
    },
  );
  it.each(['unknown', '', ' col '])('omits invalid scope %j', (scope) => {
    expect(cell(`<th scope="${scope}">Label</th>`)).not.toHaveProperty('scope');
  });
  it('keeps ordinary cell label/value text unchanged without adding inline assertions', () => {
    const result = cell('<td>  Nominal   voltage </td>');
    expect(result.label).toBe('Nominal voltage');
    expect(result.value).toBe('Nominal voltage');
    expect(result).not.toHaveProperty('inline_segments');
  });
  it('preserves superscript raw text and structural runs in the generic fixture', () => {
    const header = table(fixture).cells![0];
    expect(header).toMatchObject({
      kind: 'header',
      colspan: 4,
      label: 'Device ZX [1]',
      value: 'Device ZX [1]',
      inline_segments: [
        { kind: 'text', text: 'Device ZX' },
        { kind: 'superscript', text: '[1]' },
      ],
    });
    expect(header).not.toHaveProperty('identity');
    expect(header).not.toHaveProperty('footnote');
  });
  it('retains subscript text without interpreting its meaning', () => {
    const result = cell('<td>H<sub>2</sub>O</td>');
    expect(result.value).toBe('H 2 O');
    expect(result.inline_segments).toEqual([
      { kind: 'text', text: 'H' },
      { kind: 'subscript', text: '2' },
      { kind: 'text', text: 'O' },
    ]);
  });
  it('preserves ordinary, superscript and subscript order across multiple annotations', () => {
    expect(cell('<td>A<sup>1</sup>B<sub>2</sub>C<sup>3</sup></td>').inline_segments).toEqual([
      { kind: 'text', text: 'A' },
      { kind: 'superscript', text: '1' },
      { kind: 'text', text: 'B' },
      { kind: 'subscript', text: '2' },
      { kind: 'text', text: 'C' },
      { kind: 'superscript', text: '3' },
    ]);
  });
  it('keeps adjacent separate annotation elements as separate runs', () => {
    expect(cell('<td>A<sup>1</sup><sup>2</sup></td>').inline_segments).toEqual([
      { kind: 'text', text: 'A' },
      { kind: 'superscript', text: '1' },
      { kind: 'superscript', text: '2' },
    ]);
  });
  it('does not duplicate or lose text through ordinary formatting wrappers', () => {
    expect(
      cell(
        '<td><strong>Device</strong> <em>ZX</em><sup><abbr>[</abbr><code>1</code>]</sup> tail</td>',
      ).inline_segments,
    ).toEqual([
      { kind: 'text', text: 'Device ZX' },
      { kind: 'superscript', text: '[1]' },
      { kind: 'text', text: 'tail' },
    ]);
  });
  it('records the nearest script role in nested script elements', () => {
    expect(cell('<td>A<sup>B<sub>C</sub>D</sup>E</td>').inline_segments).toEqual([
      { kind: 'text', text: 'A' },
      { kind: 'superscript', text: 'B' },
      { kind: 'subscript', text: 'C' },
      { kind: 'superscript', text: 'D' },
      { kind: 'text', text: 'E' },
    ]);
  });
  it('binds annotation runs only to their owning cell', () => {
    const cells = table(
      '<table><tr><td>First<sup>1</sup></td><td>Second<sub>2</sub></td></tr></table>',
    ).cells!;
    expect(cells[0].inline_segments).toEqual([
      { kind: 'text', text: 'First' },
      { kind: 'superscript', text: '1' },
    ]);
    expect(cells[1].inline_segments).toEqual([
      { kind: 'text', text: 'Second' },
      { kind: 'subscript', text: '2' },
    ]);
    expect(cells[0].source_location.path).not.toBe(cells[1].source_location.path);
    expect(cells[0].inline_segments![0]).not.toHaveProperty('locator');
  });
  it('keeps existing DOM ordinal locators despite spans', () => {
    const cells = table(
      '<table><tr><th colspan="4">Device ZX<sup>1</sup></th></tr><tr><td>Voltage</td><td>24 V</td></tr></table>',
    ).cells!;
    expect(cells[0].source_location).toEqual({
      kind: 'html',
      path: 'root/html[1]/body[1]/table[1]/tr[1]/cell[1]',
      section: undefined,
      table: 'table-1',
      row: 1,
      column: 1,
    });
    expect(cells[2].source_location.path).toBe('root/html[1]/body[1]/table[1]/tr[2]/cell[2]');
  });
  it('propagates enrichment into production artifacts and validates both contracts', () => {
    const result = artifact(fixture);
    expect(result.blocks.find((block) => block.kind === 'table')!.cells).toEqual(
      table(fixture).cells,
    );
    expect(validateDocumentExtraction(result)).toEqual([]);
    expect(validateProductionArtifactSchema(result)).toEqual([]);
    expect(result.schema_version).toBe('1.0');
    expect(result.extractor_version).toBe('1.2.0');
  });
  it('replays identical artifacts and hashes from the same source', () => {
    expect(artifact(fixture)).toEqual(artifact(fixture));
    expect(artifactDigest(artifact(fixture))).toBe(artifactDigest(artifact(fixture)));
    expect(artifactDigest(artifact(fixture))).not.toBe(
      artifactDigest(artifact(fixture.replace('colspan="4"', 'colspan="3"'))),
    );
  });
  it('bounds inline text with the existing text limit and exposes truncation', () => {
    const result = extract('<table><tr><td>AB<sup>123456</sup>tail</td></tr></table>', 5);
    const segments = result.blocks.find((block) => block.kind === 'table')!.cells![0]
      .inline_segments!;
    expect(segments).toEqual([
      { kind: 'text', text: 'AB' },
      { kind: 'superscript', text: '123' },
    ]);
    expect(result.status).toBe('partially_extracted');
    expect(result.diagnostics!.some((diagnostic) => diagnostic.code === 'text_limit_reached')).toBe(
      true,
    );
  });
  it('continues accepting legacy cells with no optional structural evidence', () => {
    const result = artifact('<table><tr><td>Label</td><td>Value</td></tr></table>');
    expect(validateDocumentExtraction(result)).toEqual([]);
    expect(validateProductionArtifactSchema(result)).toEqual([]);
  });
  it('rejects invalid enriched production cells rather than normalizing them', () => {
    const result = artifact(fixture);
    const block = result.blocks.find((block) => block.kind === 'table')!;
    const bad = {
      ...result,
      blocks: [
        {
          ...block,
          cells: [
            {
              ...block.cells![0],
              colspan: 0,
              scope: 'unknown',
              inline_segments: [{ kind: 'footnote', text: '1' }],
            },
          ],
        },
      ],
    } as unknown as DocumentExtractionArtifact;
    expect(validateDocumentExtraction(bad)).not.toHaveLength(0);
    expect(validateProductionArtifactSchema(bad)).not.toHaveLength(0);
  });
});
