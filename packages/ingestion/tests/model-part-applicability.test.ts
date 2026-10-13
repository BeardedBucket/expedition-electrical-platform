import { describe, expect, it } from 'vitest';
import {
  artifactReference,
  exactModelPartRelation,
  qualifyDocumentExtraction,
  type DocumentExtractionArtifact,
  type DocumentBlock,
} from '../src/index.js';
const table = (
  id: string,
  data: string[][],
  headers = ['Model', 'Part Number', 'Output Current'],
): DocumentBlock => ({
  id,
  kind: 'table',
  locator: { kind: 'html', path: `/table[${id}]`, table: Number(id) },
  cells: [headers, ...data].flatMap((values, i) =>
    values.map((value, j) => ({
      label: value,
      value,
      kind: i === 0 ? ('header' as const) : ('data' as const),
      row: i + 1,
      column: j + 1,
      source_location: {
        kind: 'html' as const,
        path: `/table[${id}]/tr[${i + 1}]/cell[${j + 1}]`,
        table: Number(id),
        row: i + 1,
        column: j + 1,
      },
    })),
  ),
});
const doc = (blocks: DocumentBlock[]): DocumentExtractionArtifact => ({
  schema_version: '1.0',
  artifact_kind: 'document_extraction',
  id: 'synthetic.document',
  source_capture: artifactReference('source_capture', { id: 'capture' }),
  source_acquisition: artifactReference('source_acquisition', { id: 'acquisition' }),
  status: 'extracted',
  capability_state: 'automatic_extraction_available',
  remediation_state: 'none_required',
  extractor: 'synthetic',
  extractor_version: '1',
  blocks,
});
const target = { product_model: 'Exact Model', manufacturer_part_number: 'EX-1' };
describe('source-backed exact model/part relation', () => {
  it('qualifies model-labelled rows only with a unique exact source ordering relation', () => {
    const document = doc([
      table(
        '1',
        [
          ['Exact Model', 'EX-1'],
          ['Other Model', 'EX-2'],
        ],
        ['Model', 'Part Number'],
      ),
      table(
        '2',
        [
          ['Exact Model', '40 A'],
          ['Other Model', '50 A'],
        ],
        ['Model', 'Output Current'],
      ),
    ]);
    expect(exactModelPartRelation(document, target)).toHaveLength(2);
    const qualified = qualifyDocumentExtraction(document, target);
    const current = qualified.facts.find((f) => f.metadata.source_label === 'Output Current');
    expect(current?.metadata).toMatchObject({
      raw_value: '40',
      source_unit: 'A',
      applicability: { kind: 'exact_mpn_or_sku', value: 'EX-1' },
    });
    expect(
      current?.evidence?.filter((e) => e.note?.startsWith('exact-model-part-relation.v1')),
    ).toHaveLength(2);
    expect(qualified.facts.some((f) => f.metadata.raw_value === '50')).toBe(false);
  });
  it.each(
    [
      [['Exact Model(V)', 'EX-1', '40 A']],
      [['Exact Model', 'EX-1R', '40 A']],
      [
        ['Exact Model', 'EX-1', '40 A'],
        ['Exact Model', 'EX-2', '50 A'],
      ],
      [
        ['Exact Model', 'EX-1', '40 A'],
        ['Other Model', 'EX-1', '50 A'],
      ],
      [
        ['Exact Model', 'EX-1', '40 A'],
        ['Exact Model', 'EX-1', '40 A'],
      ],
    ].map((rows) => ({ rows })),
  )('abstains on variant, packaging, ambiguous and duplicate identity rows: %j', ({ rows }) => {
    expect(exactModelPartRelation(doc([table('1', rows)]), target)).toBeUndefined();
  });
  it('refuses truncated, duplicate-path, spanned and partial source structures', () => {
    const good = doc([table('1', [['Exact Model', 'EX-1', '40 A']])]);
    expect(
      exactModelPartRelation({ ...good, status: 'partially_extracted' }, target),
    ).toBeUndefined();
    expect(
      exactModelPartRelation(
        { ...good, diagnostics: [{ code: 'table_cell_limit_reached', message: 'bounded' }] },
        target,
      ),
    ).toBeUndefined();
    const block = good.blocks[0];
    expect(
      exactModelPartRelation(
        doc([
          { ...block, cells: block.cells!.map((c, i) => (i === 0 ? { ...c, colspan: 2 } : c)) },
        ]),
        target,
      ),
    ).toBeUndefined();
    expect(
      exactModelPartRelation(
        doc([{ ...block, cells: [...block.cells!, block.cells![0]] }]),
        target,
      ),
    ).toBeUndefined();
    expect(
      exactModelPartRelation(
        doc([
          {
            ...block,
            cells: block.cells!.map((c, i) =>
              i === 4
                ? { ...c, source_location: { ...c.source_location, path: '/other/table' } }
                : c,
            ),
          },
        ]),
        target,
      ),
    ).toBeUndefined();
  });
  it('does not borrow identity from another document or URL', () => {
    const specs = doc([table('1', [['Exact Model', 'unknown', '40 A']])]);
    expect(exactModelPartRelation(specs, target)).toBeUndefined();
    expect(
      qualifyDocumentExtraction(specs, target).facts.every(
        (f) => f.metadata.applicability.kind !== 'exact_mpn_or_sku',
      ),
    ).toBe(true);
  });
});
