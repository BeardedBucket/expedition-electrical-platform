import { describe, expect, it, vi } from 'vitest';
import {
  artifactDigest,
  artifactReference,
  buildDocumentExtractionArtifact,
  validateDocumentExtraction,
  type SourceCaptureArtifact,
} from '../src/production-contracts.js';
import {
  extractDocument,
  extractDocumentAsync,
  extractDocumentArtifactFromRetainedCapture,
  extractDocumentFromRetainedCapture,
  type CapturedSource,
  type SnapshotStore,
} from '../src/index.js';
import { createHash } from 'node:crypto';

const htmlSource = (body: string): CapturedSource => ({
  requested_uri: 'https://manufacturer.example/product',
  final_uri: 'https://manufacturer.example/product',
  media_type: 'text/html',
  retrieved_at: '2026-09-08T00:00:00Z',
  body: { bytes: new TextEncoder().encode(body), text: body },
});

const bytesDigest = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const minimalPdf = (text: string, pageCount = 1): Uint8Array => {
  const pageObjectIds = Array.from({ length: pageCount }, (_, index) => index + 3);
  const contentObjectId = pageCount + 3;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`,
    ...pageObjectIds.map(
      (id) =>
        `${id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjectId} 0 R /Resources << >> >>\nendobj\n`,
    ),
    `${contentObjectId} 0 obj\n<< /Length ${text.length + 37} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream\nendobj\n`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(output.length);
    output += object;
  }
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(output);
};

const replayCapture = (
  bytes: Uint8Array,
  digest = bytesDigest(bytes),
  media_type = 'text/html',
): SourceCaptureArtifact => ({
  ...capture,
  media_type,
  content_digest: digest,
  snapshot: { ...capture.snapshot!, digest, reference: 'snapshot://test' },
});

const memoryStore = (bytes: Uint8Array, error?: Error): SnapshotStore => ({
  async writeSnapshot() {
    return { reference: 'snapshot://test', digest: bytesDigest(bytes) };
  },
  async readSnapshot() {
    if (error) throw error;
    return bytes.slice();
  },
});

const capture: SourceCaptureArtifact = {
  schema_version: '1.0',
  artifact_kind: 'source_capture',
  id: 'capture.checkpoint-d',
  requested_uri: 'https://manufacturer.example/product',
  retrieved_at: '2026-09-08T00:00:00Z',
  disposition: 'authoritative',
  retention_status: 'retained',
  content_digest: artifactDigest('checkpoint-d-capture'),
  digest_algorithm: 'sha256',
  snapshot: artifactReference(
    'source_capture',
    {
      schema_version: '1.0',
      artifact_kind: 'source_capture',
      id: 'snapshot.checkpoint-d',
      requested_uri: 'https://manufacturer.example/product',
      retrieved_at: '2026-09-08T00:00:00Z',
      disposition: 'authoritative',
      retention_status: 'not_permitted',
      content_digest: artifactDigest('checkpoint-d-capture'),
      digest_algorithm: 'sha256',
    },
    'cas://checkpoint-d-capture',
  ),
};

const acquisition = artifactReference('source_acquisition', {
  schema_version: '1.0',
  artifact_kind: 'source_acquisition',
  id: 'acquisition.checkpoint-d',
  intake: artifactReference('product_intake', {
    schema_version: '1.0',
    artifact_kind: 'product_intake',
    id: 'intake.checkpoint-d',
    manufacturer: 'Synthetic Manufacturer',
    product_model: 'Synthetic Model',
    manufacturer_part_number: 'SYN-1',
    official_product_uri: 'https://manufacturer.example/product',
  }),
  seed_capture: artifactReference('source_capture', capture),
  officiality: 'official',
  status: 'acquired',
  candidates: [],
  deterministic_snapshot: artifactDigest('acquisition.checkpoint-d'),
});

describe('Checkpoint D document extraction', () => {
  it('preserves HTML structure and literal fidelity without semantic interpretation', () => {
    const source = htmlSource(`
      <title>Exact Product Title</title>
      <nav>Navigation boilerplate</nav>
      <menu>Menu boilerplate</menu>
      <h1>Main heading</h1>
      <h2>Technical heading</h2>
      <p>Exact paragraph wording: ground, grounding lug, chassis ground, earth, PE, negative, DC negative; 12,5 V; 12 V; recommendation and hard limit.</p>
      <ol><li>First ordered</li><li>Second ordered</li><li>Third ordered</li></ol>
      <ul><li>First unordered</li><li>Second unordered</li><li>Third unordered</li></ul>
      <dl><dt>Definition term</dt><dd>Definition value</dd></dl>
      <script>globalThis.shouldNotRun = true</script>
      <style>.hidden { display: none }</style>
      <template><p>Template boilerplate</p></template>
      <figure><figcaption>Figure caption</figcaption></figure>
      <note>Footnote: inspect source wording.</note>
      <table>
        <caption>Variant table caption</caption>
        <thead><tr><th>Model</th><th>Rating</th></tr></thead>
        <tbody>
          <tr><td>Same visible text</td><td>12,5 V</td></tr>
          <tr><td>Same visible text</td><td>24 V</td></tr>
        </tbody>
      </table>
      <footer>Footer boilerplate</footer>
    `);
    const document = extractDocument(source);
    const artifact = buildDocumentExtractionArtifact(
      document,
      artifactReference('source_capture', capture),
      { source_acquisition: acquisition },
    );
    expect(document.title).toBe('Exact Product Title');
    expect(document.blocks.find((block) => block.kind === 'heading')).toMatchObject({
      text: 'Main heading',
      heading_level: 1,
    });
    expect(document.blocks.find((block) => block.text === 'Technical heading')).toMatchObject({
      heading_level: 2,
    });
    expect(document.blocks.find((block) => block.kind === 'paragraph')?.text).toBe(
      'Exact paragraph wording: ground, grounding lug, chassis ground, earth, PE, negative, DC negative; 12,5 V; 12 V; recommendation and hard limit.',
    );
    expect(document.blocks.find((block) => block.kind === 'list')?.text).toBe(
      'First ordered Second ordered Third ordered',
    );
    expect(document.blocks.filter((block) => block.kind === 'list')[1]?.text).toBe(
      'First unordered Second unordered Third unordered',
    );
    expect(document.blocks.find((block) => block.kind === 'definition')?.text).toBe(
      'Definition term: Definition value',
    );
    expect(document.blocks.find((block) => block.kind === 'figure_caption')?.text).toBe(
      'Figure caption',
    );
    expect(document.blocks.find((block) => block.kind === 'note')?.text).toBe(
      'Footnote: inspect source wording.',
    );
    expect(document.blocks.some((block) => block.text.includes('boilerplate'))).toBe(false);
    const table = document.blocks.find((block) => block.kind === 'table');
    expect(table?.locator.table).toBe('table-1');
    expect(table?.text).toContain('Variant table caption');
    expect(table?.cells?.filter((cell) => cell.kind === 'header')).toHaveLength(2);
    expect(table?.cells?.filter((cell) => cell.kind === 'data')).toHaveLength(4);
    expect(table?.cells?.map((cell) => cell.value)).toEqual([
      'Model',
      'Rating',
      'Same visible text',
      '12,5 V',
      'Same visible text',
      '24 V',
    ]);
    const repeated = table?.cells?.filter((cell) => cell.value === 'Same visible text') ?? [];
    expect(repeated[0].source_location.path).not.toBe(repeated[1].source_location.path);
    expect(repeated[0].row).not.toBe(repeated[1].row);
    expect(repeated[0].column).toBe(repeated[1].column);
    expect(JSON.stringify(artifact.blocks)).not.toContain('"field"');
    expect(JSON.stringify(artifact.blocks)).not.toContain('"topology"');
  });

  it('recovers malformed HTML deterministically without total failure', () => {
    const malformed = htmlSource('<h1>Recovered</h1><p>first<p>second<ul><li>one<li>two');
    const first = extractDocument(malformed);
    const second = extractDocument(malformed);
    expect(first.status).not.toBe('failed');
    expect(first.blocks.some((block) => block.text === 'Recovered')).toBe(true);
    expect(first.blocks.some((block) => block.text === 'first')).toBe(true);
    expect(first.blocks).toEqual(second.blocks);
    expect(first.diagnostics).toEqual(second.diagnostics);
  });

  it('extracts thead and tbody rows in document and column order without MPN selection', () => {
    const document = extractDocument(
      htmlSource(`
        <h1>Family variants</h1>
        <table>
          <thead><tr><th>Model</th><th>Voltage</th><th>Capacity</th></tr></thead>
          <tbody>
            <tr><td>ALPHA-1</td><td>12 V</td><td>100 Ah</td></tr>
            <tr><td>ALPHA-2</td><td>24 V</td><td>100 Ah</td></tr>
          </tbody>
        </table>
      `),
    );
    const table = document.blocks.find((block) => block.kind === 'table');
    expect(table?.rows).toEqual([
      { label: 'Model', value: 'Voltage Capacity' },
      { label: 'ALPHA-1', value: '12 V 100 Ah' },
      { label: 'ALPHA-2', value: '24 V 100 Ah' },
    ]);
    expect(table?.cells?.map((cell) => [cell.row, cell.column, cell.value])).toEqual([
      [1, 1, 'Model'],
      [1, 2, 'Voltage'],
      [1, 3, 'Capacity'],
      [2, 1, 'ALPHA-1'],
      [2, 2, '12 V'],
      [2, 3, '100 Ah'],
      [3, 1, 'ALPHA-2'],
      [3, 2, '24 V'],
      [3, 3, '100 Ah'],
    ]);
    expect(new Set(table?.cells?.map((cell) => cell.source_location.path))).toHaveProperty(
      'size',
      9,
    );
  });

  it('preserves rich production locations while legacy projection remains narrow', () => {
    const document = extractDocument(
      htmlSource('<table><tbody><tr><td>Same</td><td>Same</td></tr></tbody></table>'),
    );
    const table = document.blocks.find((block) => block.kind === 'table');
    const artifact = buildDocumentExtractionArtifact(
      document,
      artifactReference('source_capture', capture),
      { source_acquisition: acquisition },
    );
    expect(table?.locator.path).toContain('/html');
    expect(table?.cells?.[0].source_location).toMatchObject({
      kind: 'html',
      row: 1,
      column: 1,
    });
    expect(table?.cells?.[1].source_location).toMatchObject({
      kind: 'html',
      row: 1,
      column: 2,
    });
    expect(artifact.blocks[0].locator).toMatchObject({
      kind: 'html',
      path: expect.any(String),
    });
    expect(artifact.blocks[0].cells?.[0].source_location).toMatchObject({ column: 1 });
    expect(artifact.blocks[0].cells?.[1].source_location).toMatchObject({ column: 2 });
  });

  it('extracts captured PDF bytes with page provenance and fails malformed PDFs explicitly', async () => {
    const opaque = extractDocument(htmlSource('opaque bytes'));
    expect(
      extractDocument({ ...opaque.source, media_type: 'application/octet-stream' }),
    ).toMatchObject({
      status: 'unsupported',
      diagnostics: [{ code: 'unsupported_media_type' }],
    });

    const pdf = await extractDocumentAsync({
      ...htmlSource(''),
      media_type: 'application/pdf',
      body: { bytes: minimalPdf('PDF wording', 2) },
    });
    expect(pdf).toMatchObject({
      status: 'extracted',
      page_count: 2,
      extractor: 'pdfjs',
    });
    expect(pdf.diagnostics).toEqual([
      expect.objectContaining({ code: 'table_extraction_unsupported' }),
    ]);
    expect(pdf.blocks[0].source_location).toMatchObject({ kind: 'pdf', page: 1 });
    expect(pdf.blocks.some((block) => block.source_location?.page === 2)).toBe(true);
    const repeatedPdf = pdf.blocks.filter((block) => block.text === 'PDF wording');
    expect(repeatedPdf).toHaveLength(2);
    expect(repeatedPdf[0].id).not.toBe(repeatedPdf[1].id);
    expect(repeatedPdf[0].source_location?.page).not.toBe(repeatedPdf[1].source_location?.page);
    expect(repeatedPdf).toEqual(
      (
        await extractDocumentAsync({
          ...htmlSource(''),
          media_type: 'application/pdf',
          body: { bytes: minimalPdf('PDF wording', 2) },
        })
      ).blocks.filter((block) => block.text === 'PDF wording'),
    );
    const retainedPdf = await extractDocumentFromRetainedCapture(
      replayCapture(
        minimalPdf('Retained PDF'),
        bytesDigest(minimalPdf('Retained PDF')),
        'application/pdf',
      ),
      memoryStore(minimalPdf('Retained PDF')),
    );
    expect(retainedPdf.status).toBe('extracted');
    const imageOnly = await extractDocumentAsync({
      ...htmlSource(''),
      media_type: 'application/pdf',
      body: { bytes: minimalPdf('') },
    });
    expect(imageOnly.status).toBe('no_extractable_content');
    expect(
      imageOnly.diagnostics?.some((diagnostic) => diagnostic.code === 'likely_image_only'),
    ).toBe(true);
    const malformed = await extractDocumentAsync({
      ...htmlSource(''),
      media_type: 'application/pdf',
      body: { bytes: new TextEncoder().encode('%PDF-not-valid') },
    });
    expect(malformed).toMatchObject({
      status: 'failed',
      diagnostics: [{ code: 'parser_failure' }],
    });
  });

  it('records capability and remediation states for unsupported and image-only sources', () => {
    const unsupported = extractDocument({
      ...htmlSource(''),
      media_type: 'application/octet-stream',
      body: { bytes: new Uint8Array([1, 2, 3]) },
    });
    expect(unsupported.capability_state).toBe('capability_not_implemented');
    expect(unsupported.remediation_state).toBe('implementation_required');

    const imageOnly = extractDocumentAsync({
      ...htmlSource(''),
      media_type: 'application/pdf',
      body: { bytes: minimalPdf('') },
    });
    return imageOnly.then((document) => {
      expect(document.status).toBe('no_extractable_content');
      expect(document.capability_state).toBe('capability_not_enabled');
      expect(document.remediation_state).toBe('human_review_required');
      expect(
        document.diagnostics?.some((diagnostic) => diagnostic.code === 'likely_image_only'),
      ).toBe(true);
      const artifact = buildDocumentExtractionArtifact(
        document,
        artifactReference('source_capture', capture),
        { source_acquisition: acquisition },
      );
      expect(artifact.capability_state).toBe('capability_not_enabled');
      expect(artifact.remediation_state).toBe('human_review_required');
      expect(artifact.id).not.toBe('document-extraction.undefined');
    });
  });

  it('derives non-authoritative status without changing extracted structure', () => {
    const document = extractDocument(htmlSource('<p>Technical wording</p>'));
    const artifact = buildDocumentExtractionArtifact(
      document,
      artifactReference('source_capture', capture),
      { source_acquisition: acquisition, source_authoritative: false },
    );
    expect(artifact.status).toBe('source_non_authoritative');
    expect(artifact.capability_state).toBe('automatic_extraction_available');
    expect(artifact.remediation_state).toBe('none_required');
    expect(artifact.blocks).toHaveLength(1);
    expect(validateDocumentExtraction(artifact)).toEqual([]);
  });

  it('replays retained bytes and verifies digest before parsing', async () => {
    const bytes = new TextEncoder().encode('<p>Retained wording</p>');
    let reads = 0;
    const store: SnapshotStore = {
      async writeSnapshot() {
        return { reference: 'snapshot://test', digest: bytesDigest(bytes) };
      },
      async readSnapshot() {
        reads += 1;
        return bytes.slice();
      },
    };
    const document = await extractDocumentFromRetainedCapture(replayCapture(bytes), store);
    expect(reads).toBe(1);
    expect(document.status).toBe('extracted');
    expect(document.blocks[0].text).toBe('Retained wording');
    expect(bytes).toEqual(new TextEncoder().encode('<p>Retained wording</p>'));
    const artifact = await extractDocumentArtifactFromRetainedCapture(
      replayCapture(bytes),
      acquisition,
      store,
    );
    expect(artifact.source_acquisition.kind).toBe('source_acquisition');
    expect(artifact.status).toBe('extracted');
  });

  it.each([
    ['source_unavailable', { snapshot: undefined }, undefined],
    [
      'corrupt_source',
      replayCapture(
        new TextEncoder().encode('bad'),
        bytesDigest(new TextEncoder().encode('expected')),
      ),
      undefined,
    ],
    [
      'failed',
      replayCapture(new TextEncoder().encode('unused')),
      new Error('snapshot read failed'),
    ],
  ] as const)('reaches retained replay terminal status %s', async (status, captureValue, error) => {
    const bytes = new TextEncoder().encode('<p>never parsed</p>');
    const document = await extractDocumentFromRetainedCapture(
      (captureValue ?? replayCapture(bytes)) as SourceCaptureArtifact,
      memoryStore(bytes, error),
    );
    expect(document.status).toBe(status);
    expect(document.blocks).toEqual([]);
  });

  it('reaches source_empty and bounded partial extraction deterministically', () => {
    expect(
      extractDocument({
        ...htmlSource(''),
        body: { bytes: new Uint8Array() },
      }).status,
    ).toBe('source_empty');
    const partial = extractDocument(htmlSource('<p>abcdefgh</p><p>second</p>'), {
      max_text_length: 4,
      max_items: 1,
    });
    expect(partial.status).toBe('partially_extracted');
    expect(partial.diagnostics?.map((item) => item.code)).toEqual([
      'item_limit_reached',
      'text_limit_reached',
    ]);
  });

  it('enforces PDF page and HTML table-cell bounds with deterministic diagnostics', async () => {
    const boundedPdf = await extractDocumentAsync(
      {
        ...htmlSource(''),
        media_type: 'application/pdf',
        body: { bytes: minimalPdf('bounded page', 3) },
      },
      { max_pages: 1 },
    );
    expect(boundedPdf.status).toBe('partially_extracted');
    expect(boundedPdf.blocks.every((block) => block.source_location?.page === 1)).toBe(true);
    expect(boundedPdf.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'page_limit_reached' })]),
    );
    const tableSource = htmlSource(
      '<table><tr><td>one</td><td>two</td></tr><tr><td>three</td><td>four</td></tr></table>',
    );
    const first = extractDocument(tableSource, { max_table_cells: 2 });
    const second = extractDocument(tableSource, { max_table_cells: 2 });
    expect(first.status).toBe('partially_extracted');
    expect(first.blocks[0].cells).toHaveLength(2);
    expect(first.diagnostics).toEqual([
      expect.objectContaining({ code: 'table_cell_limit_reached' }),
    ]);
    expect(first.blocks).toEqual(second.blocks);
    expect(first.diagnostics).toEqual(second.diagnostics);
  });

  it('reaches every declared final extraction status explicitly', async () => {
    const extracted = extractDocument(htmlSource('<p>ok</p>'));
    const partial = extractDocument(htmlSource('<p>ok</p><p>more</p>'), { max_items: 1 });
    const noContent = await extractDocumentAsync({
      ...htmlSource(''),
      media_type: 'application/pdf',
      body: { bytes: minimalPdf('') },
    });
    const unsupported = extractDocument({
      ...htmlSource('x'),
      media_type: 'application/octet-stream',
    });
    const unavailable = await extractDocumentFromRetainedCapture(
      { ...replayCapture(new TextEncoder().encode('x')), snapshot: undefined },
      memoryStore(new TextEncoder().encode('x')),
    );
    const nonAuthoritative = buildDocumentExtractionArtifact(
      extracted,
      artifactReference('source_capture', capture),
      { source_acquisition: acquisition, source_authoritative: false },
    );
    const empty = extractDocument({ ...htmlSource(''), body: { bytes: new Uint8Array() } });
    const corrupt = await extractDocumentFromRetainedCapture(
      replayCapture(
        new TextEncoder().encode('bad'),
        bytesDigest(new TextEncoder().encode('expected')),
      ),
      memoryStore(new TextEncoder().encode('bad')),
    );
    const failed = await extractDocumentAsync({
      ...htmlSource(''),
      media_type: 'application/pdf',
      body: { bytes: new TextEncoder().encode('%PDF-invalid') },
    });
    expect([
      extracted.status,
      partial.status,
      noContent.status,
      unsupported.status,
      unavailable.status,
      nonAuthoritative.status,
      empty.status,
      corrupt.status,
      failed.status,
    ]).toEqual([
      'extracted',
      'partially_extracted',
      'no_extractable_content',
      'unsupported',
      'source_unavailable',
      'source_non_authoritative',
      'source_empty',
      'corrupt_source',
      'failed',
    ]);
  });

  it('proves deterministic structural IDs and explicit metadata non-fabrication', () => {
    const source = htmlSource('<p>Same</p><p>Same</p>');
    const first = extractDocument(source);
    const second = extractDocument(source);
    expect(first.blocks.map((block) => block.id)).toEqual(second.blocks.map((block) => block.id));
    expect(first.blocks[0].id).not.toBe(first.blocks[1].id);
    expect(first.blocks[0].locator.path).not.toBe(first.blocks[1].locator.path);
    const artifact = buildDocumentExtractionArtifact(
      first,
      artifactReference('source_capture', capture),
      { source_acquisition: acquisition },
    );
    expect(artifact).not.toHaveProperty('publication_date');
    expect(artifact).not.toHaveProperty('document_revision');
    expect(artifact).not.toHaveProperty('applicability');
  });

  it('accepts only the canonical document_extraction artifact kind', () => {
    const document = extractDocument(htmlSource('<p>Valid</p>'));
    const artifact = buildDocumentExtractionArtifact(
      document,
      artifactReference('source_capture', capture),
      { source_acquisition: acquisition },
    );
    expect(validateDocumentExtraction(artifact)).toEqual([]);
    expect(
      validateDocumentExtraction({
        ...artifact,
        artifact_kind: 'parallel_document_extraction',
      } as never),
    ).toContain('document extraction artifact_kind must be document_extraction');
  });

  it('validates schema-parity constraints at the runtime boundary', () => {
    const document = extractDocument(htmlSource('<p>Valid</p>'));
    const artifact = buildDocumentExtractionArtifact(
      document,
      artifactReference('source_capture', capture),
      { source_acquisition: acquisition },
    );
    expect(validateDocumentExtraction(artifact)).toEqual([]);
    expect(
      validateDocumentExtraction({
        ...artifact,
        id: 'not-deterministic',
        blocks: [
          {
            ...artifact.blocks[0],
            locator: { ...artifact.blocks[0].locator, page: 0 },
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        'document extraction id is not a deterministic extraction ID',
        'blocks[0].locator.page must be a positive integer',
      ]),
    );
  });

  it('isolates extraction failures and keeps equivalent captures provenance-distinct', async () => {
    const bytes = new TextEncoder().encode('<p>Same content</p>');
    const first = await extractDocumentFromRetainedCapture(
      { ...replayCapture(bytes), id: 'capture.first' },
      memoryStore(bytes),
    );
    const second = await extractDocumentFromRetainedCapture(
      { ...replayCapture(bytes), id: 'capture.second' },
      memoryStore(bytes),
    );
    const firstArtifact = buildDocumentExtractionArtifact(
      first,
      artifactReference('source_capture', { ...capture, id: 'capture.first' }),
      { source_acquisition: acquisition },
    );
    const secondArtifact = buildDocumentExtractionArtifact(
      second,
      artifactReference('source_capture', { ...capture, id: 'capture.second' }),
      { source_acquisition: acquisition },
    );
    expect(firstArtifact.id).not.toBe(secondArtifact.id);
    expect(second.status).toBe('extracted');
  });

  it('performs inert extraction without executing scripts, following links, or fetching resources', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network forbidden'));
    const document = extractDocument(
      htmlSource(`
        <script>globalThis.__checkpointDExecuted = true</script>
        <img src="https://remote.example/image.png">
        <link rel="stylesheet" href="https://remote.example/style.css">
        <a href="https://remote.example/next">Follow me</a>
        <p>Visible content</p>
      `),
    );
    expect(document.blocks.some((block) => block.text.includes('checkpointDExecuted'))).toBe(false);
    expect(document.blocks.some((block) => block.text.includes('Visible content'))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
