import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  DEFAULT_PDF_EXTRACTION_MAX_INPUT_BYTES,
  DEFAULT_PDF_EXTRACTION_MAX_ITEMS,
  DEFAULT_PDF_EXTRACTION_MAX_TOTAL_TEXT_CODE_UNITS,
  DEFAULT_DOCUMENT_EXTRACTION_LIMITS,
  extractHtmlDocument,
  extractDocumentAsync,
  extractDocumentArtifactFromRetainedCapture,
  extractDocumentFromRetainedCapture,
  extractPdfDocument,
} from '../src/document-extraction.js';
import {
  artifactDigest,
  artifactReference,
  buildDocumentExtractionArtifact,
  qualifyDocumentExtraction,
  validateDocumentExtraction,
  validateProductionArtifactSchema,
  type SourceCaptureArtifact,
} from '../src/production-contracts.js';
import type { CapturedSource } from '../src/capture-types.js';
import { PDF_RESPONSE_MAX_BYTES } from '../src/http-capture.js';

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: vi.fn() }));
const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const source = (size: number): CapturedSource => {
  const bytes = new Uint8Array(size);
  return {
    requested_uri: 'https://manufacturer.example/manual.pdf',
    final_uri: 'https://manufacturer.example/manual.pdf',
    retrieved_at: '2026-09-28T00:00:00Z',
    media_type: 'application/pdf',
    body: { bytes },
    content_hash: digest(bytes),
  };
};
const parser = (pages = 1, chunks = [[{ str: 'source wording' }]], streamFailure = false) => {
  const cleanup = vi.fn();
  const cancel = vi.fn();
  const destroy = vi.fn().mockResolvedValue(undefined);
  const getPage = vi.fn(async () => ({
    cleanup,
    streamTextContent: () =>
      new ReadableStream(
        {
          start(controller) {
            if (streamFailure) {
              controller.error(new Error('synthetic stream failure'));
              return;
            }
            for (const items of chunks) controller.enqueue({ items });
            // Leave open so cancellation is observable when the item limit stops work.
          },
          pull(controller) {
            controller.close();
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
  }));
  vi.mocked(getDocument).mockImplementation((options) => {
    const data = (options as { data: Uint8Array }).data;
    // Exercise PDF.js's ownership transfer instead of silently hiding detachment.
    structuredClone(data, { transfer: [data.buffer] });
    return {
      promise: Promise.resolve({ numPages: pages, getPage }),
      destroy,
    } as unknown as ReturnType<typeof getDocument>;
  });
  return { cleanup, cancel, destroy, getPage };
};
beforeEach(() => {
  vi.mocked(getDocument).mockReset();
});

describe('large PDF extraction boundary', () => {
  it.each([10_100, 50_000, 50_001])(
    'bounds %i retained items with independent PDF defaults',
    async (count) => {
      const resources = parser(1, [Array.from({ length: count }, () => ({ str: 'x' }))]);
      const input = source(64);
      const result = await extractPdfDocument(input);
      expect(DEFAULT_PDF_EXTRACTION_MAX_ITEMS).toBe(50_000);
      expect(result.blocks).toHaveLength(Math.min(count, 50_000));
      expect(result.status).toBe(count > 50_000 ? 'partially_extracted' : 'extracted');
      expect(result.diagnostics?.some((d) => d.code === 'item_limit_reached')).toBe(count > 50_000);
      expect(resources.cancel).toHaveBeenCalledTimes(count > 50_000 ? 1 : 0);
      expect(resources.cleanup).toHaveBeenCalledOnce();
      expect(resources.destroy).toHaveBeenCalledOnce();
      expect(digest(input.body.bytes)).toBe(input.content_hash);
    },
  );
  it.each([2_000_000, 2_000_001])(
    'bounds %i total retained code units independently of count and per-block limits',
    async (codeUnits) => {
      const chunks = [Array.from({ length: 20 }, () => ({ str: 'x'.repeat(100_000) }))];
      if (codeUnits > 2_000_000) chunks.push([{ str: 'y' }]);
      // Exact EOF must not diagnose merely touching the budget.
      const resources = parser(1, chunks);
      const result = await extractPdfDocument(source(64));
      expect(DEFAULT_PDF_EXTRACTION_MAX_TOTAL_TEXT_CODE_UNITS).toBe(2_000_000);
      expect(result.blocks.reduce((sum, b) => sum + (b.text?.length ?? 0), 0)).toBe(2_000_000);
      expect(result.diagnostics?.some((d) => d.code === 'total_text_limit_reached')).toBe(
        codeUnits > 2_000_000,
      );
      expect(
        result.diagnostics?.some((d) =>
          ['item_limit_reached', 'text_limit_reached'].includes(d.code),
        ),
      ).toBe(false);
      expect(resources.cancel).toHaveBeenCalledTimes(codeUnits > 2_000_000 ? 1 : 0);
      expect(resources.cleanup).toHaveBeenCalledOnce();
      expect(resources.destroy).toHaveBeenCalledOnce();
    },
  );
  it('counts cleaned internal spaces and UTF-16 units, retains a prefix, and validates deterministic partial artifacts', async () => {
    const resources = parser(3, [
      [{ str: ' ' }, { str: ' A  \u{1F600} ' }],
      [{ str: '' }, { str: 'BCDE' }],
    ]);
    const input = source(64);
    const limits = { max_total_text_code_units: 7 };
    // Cleaned "A <supplementary scalar>" is 4 UTF-16 code units, not 3 code
    // points. Adding BCDE needs 8 units and crosses 7; code-point accounting
    // would incorrectly admit both blocks at exactly 7.
    const first = await extractDocumentAsync(input, limits);
    const second = await extractDocumentAsync(input, limits);
    expect(first).toEqual(second);
    expect(first.blocks.map((b) => [b.text, b.locator.ordinal])).toEqual([['A \u{1F600}', 2]]);
    expect(first.blocks.reduce((sum, block) => sum + (block.text?.length ?? 0), 0)).toBe(4);
    expect(first.status).toBe('partially_extracted');
    expect(first.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'total_text_limit_reached' }),
    );
    expect(resources.getPage).toHaveBeenCalledTimes(2);
    expect(resources.cancel).toHaveBeenCalledTimes(2);
    expect(resources.cleanup).toHaveBeenCalledTimes(2);
    expect(resources.destroy).toHaveBeenCalledTimes(2);
    const artifact = buildDocumentExtractionArtifact(
      first,
      artifactReference('source_capture', { id: 'capture.output' }),
      { source_acquisition: artifactReference('source_acquisition', { id: 'acquisition.output' }) },
    );
    expect(validateDocumentExtraction(artifact)).toEqual([]);
    expect(validateProductionArtifactSchema(artifact)).toEqual([]);
    const qualification = qualifyDocumentExtraction(artifact);
    expect(qualification.facts).toEqual([]);
    expect(qualification.completeness).toBe('partial');
    expect(digest(input.body.bytes)).toBe(input.content_hash);
  });
  it('applies the per-block cap before total accounting and does not mislabel empty bounded output as image-only', async () => {
    parser(1, [[{ str: 'abcdef' }, { str: 'gh' }]]);
    const result = await extractPdfDocument(source(64), {
      max_text_length: 3,
      max_total_text_code_units: 5,
    });
    expect(result.blocks.map((b) => b.text)).toEqual(['abc', 'gh']);
    expect(result.diagnostics?.map((d) => d.code)).toContain('text_limit_reached');
    expect(result.diagnostics?.map((d) => d.code)).not.toContain('total_text_limit_reached');
    parser();
    const empty = await extractPdfDocument(source(64), { max_total_text_code_units: 0 });
    expect(empty.status).toBe('partially_extracted');
    expect(empty.blocks).toEqual([]);
    expect(empty.diagnostics?.map((d) => d.code)).not.toContain('likely_image_only');
  });
  it('preserves the HTML structural-item default and ignores the PDF-only text budget', async () => {
    expect(DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_items).toBe(10_000);
    const text = '<p>x</p>'.repeat(10_001);
    const input = {
      ...source(64),
      media_type: 'text/html',
      body: { bytes: new TextEncoder().encode(text), text },
    };
    const result = await extractDocumentAsync(input, { max_total_text_code_units: 0 });
    expect(result.blocks).toHaveLength(10_000);
    expect(result).toEqual(extractHtmlDocument(input));
    expect(result.diagnostics?.map((d) => d.code)).toContain('item_limit_reached');
  });
  it('intentionally aligns independently owned PDF defaults today', () => {
    expect(DEFAULT_PDF_EXTRACTION_MAX_INPUT_BYTES).toBe(32_000_000);
    expect(PDF_RESPONSE_MAX_BYTES).toBe(32_000_000);
  });
  it.each(['streamTextContent', 'getReader', 'read', 'cancel', 'releaseLock', 'cleanup'])(
    'attempts owned cleanup after %s failure and returns an explicit failed result',
    async (failure) => {
      const resources = parser();
      const error = new Error(`synthetic ${failure} failure`);
      const releaseLock = vi.fn(() => {
        if (failure === 'releaseLock') throw error;
      });
      const cancel = vi.fn(async () => {
        if (failure === 'cancel') throw error;
      });
      const read = vi.fn(async () => {
        if (failure === 'read') throw error;
        return { done: false, value: { items: [{ str: 'one' }, { str: 'two' }] } };
      });
      const cleanup = vi.fn(() => {
        if (failure === 'cleanup') throw error;
      });
      const getReader = vi.fn(() => {
        if (failure === 'getReader') throw error;
        return { read, cancel, releaseLock };
      });
      const streamTextContent = vi.fn(() => {
        if (failure === 'streamTextContent') throw error;
        return { getReader };
      });
      // Restrict this structural parser seam to the failure ownership contract.
      resources.getPage.mockResolvedValueOnce({ cleanup, streamTextContent } as unknown as Awaited<
        ReturnType<typeof resources.getPage>
      >);
      const result = await extractPdfDocument(source(64), { max_items: 1 });
      expect(result.status).toBe('failed');
      expect(result.blocks).toEqual([]);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: 'parser_failure', recoverable: false }),
      ]);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(resources.destroy).toHaveBeenCalledOnce();
      if (!['streamTextContent', 'getReader'].includes(failure)) {
        expect(cancel).toHaveBeenCalledWith(expect.any(Error));
        expect(releaseLock).toHaveBeenCalledOnce();
        expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
          releaseLock.mock.invocationCallOrder[0],
        );
        expect(releaseLock.mock.invocationCallOrder[0]).toBeLessThan(
          cleanup.mock.invocationCallOrder[0],
        );
      } else {
        expect(cancel).not.toHaveBeenCalled();
        expect(releaseLock).not.toHaveBeenCalled();
      }
      expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(
        resources.destroy.mock.invocationCallOrder[0],
      );
    },
  );
  it.each([8_388_609, 28_630_824, 32_000_000])(
    'admits %i bytes and preserves captured source ownership',
    async (size) => {
      const resources = parser();
      const input = source(size);
      const result = await extractPdfDocument(input);
      expect(result.status).toBe('extracted');
      expect(result.blocks[0]).toMatchObject({
        text: 'source wording',
        source_location: { kind: 'pdf', page: 1, ordinal: 1 },
      });
      expect(result.diagnostics?.some((d) => d.code === 'input_limit_reached')).toBe(false);
      expect(getDocument).toHaveBeenCalledOnce();
      expect(input.body.bytes.byteLength).toBe(size);
      expect(digest(input.body.bytes)).toBe(input.content_hash);
      expect(resources.cleanup).toHaveBeenCalledOnce();
      expect(resources.destroy).toHaveBeenCalledOnce();
    },
  );
  it('rejects above the decimal ceiling without initializing the parser', async () => {
    expect(DEFAULT_PDF_EXTRACTION_MAX_INPUT_BYTES).toBe(32_000_000);
    const result = await extractPdfDocument(source(32_000_001));
    expect(result.status).toBe('partially_extracted');
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'input_limit_reached' })]);
    expect(getDocument).not.toHaveBeenCalled();
  });
  it('honors an independently supplied narrower input boundary', async () => {
    const result = await extractPdfDocument(source(11), { max_input_bytes: 10 });
    expect(result.diagnostics?.[0].code).toBe('input_limit_reached');
    expect(getDocument).not.toHaveBeenCalled();
  });
  it('leaves HTML and plain-text dispatch semantics unchanged', async () => {
    const input = source(8_388_609);
    expect(
      (await extractDocumentAsync({ ...input, media_type: 'text/html' })).diagnostics?.[0].code,
    ).toBe('input_limit_reached');
    expect((await extractDocumentAsync({ ...input, media_type: 'text/plain' })).status).toBe(
      'unsupported',
    );
    expect(getDocument).not.toHaveBeenCalled();
  });
  it('retains page bounds for larger inputs', async () => {
    const resources = parser(3);
    const result = await extractPdfDocument(source(8_388_609), { max_pages: 1 });
    expect(result).toMatchObject({ status: 'partially_extracted', page_count: 3 });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'page_limit_reached' }),
    );
    expect(resources.getPage).toHaveBeenCalledOnce();
  });
  it('bounds streamed items across chunks and stops later pages', async () => {
    const resources = parser(3, [[{ str: 'one' }], [{ str: 'two' }, { str: 'three' }]]);
    const result = await extractPdfDocument(source(8_388_609), { max_items: 1 });
    expect(result.status).toBe('partially_extracted');
    expect(result.blocks.map((b) => b.text)).toEqual(['one']);
    expect(result.diagnostics?.filter((d) => d.code === 'item_limit_reached')).toHaveLength(1);
    expect(resources.getPage).toHaveBeenCalledOnce();
    expect(resources.cancel).toHaveBeenCalledOnce();
    expect(resources.cancel).toHaveBeenCalledWith(expect.any(Error));
    expect(resources.cleanup).toHaveBeenCalledOnce();
    expect(resources.destroy).toHaveBeenCalledOnce();
  });
  it('enforces the declared per-item text cap and keeps ordinals across chunks', async () => {
    parser(1, [[{ str: 'abcdefgh' }], [{ str: '' }, { str: 'second' }]]);
    const result = await extractPdfDocument(source(8_388_609), { max_text_length: 4 });
    expect(result.status).toBe('partially_extracted');
    expect(result.blocks.map((b) => [b.text, b.locator.ordinal])).toEqual([
      ['abcd', 1],
      ['seco', 3],
    ]);
    expect(result.diagnostics?.filter((d) => d.code === 'text_limit_reached')).toHaveLength(1);
    expect(result.blocks.every((b) => b.kind === 'text_block' && !b.cells && !b.rows)).toBe(true);
  });
  it('contains large-input parser initialization failures and destroys resources', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.reject(new Error('synthetic parser failure')),
      destroy,
    } as unknown as ReturnType<typeof getDocument>);
    const result = await extractPdfDocument(source(28_630_824));
    expect(result.status).toBe('failed');
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'parser_failure', recoverable: false }),
    ]);
    expect(destroy).toHaveBeenCalledOnce();
  });
  it('contains page and cleanup failures without fabricated blocks', async () => {
    const resources = parser();
    resources.getPage.mockRejectedValueOnce(new Error('page failed'));
    const result = await extractPdfDocument(source(8_388_609));
    expect(result.status).toBe('failed');
    expect(result.blocks).toEqual([]);
    expect(resources.destroy).toHaveBeenCalledOnce();
    parser().destroy.mockRejectedValueOnce(new Error('cleanup failed'));
    expect((await extractPdfDocument(source(8_388_609))).diagnostics?.[0].code).toBe(
      'parser_failure',
    );
  });
  it('contains text-stream failures and cleans page and loading resources', async () => {
    const resources = parser(1, [], true);
    const result = await extractPdfDocument(source(8_388_609));
    expect(result.status).toBe('failed');
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics?.[0].code).toBe('parser_failure');
    expect(resources.cleanup).toHaveBeenCalledOnce();
    expect(resources.destroy).toHaveBeenCalledOnce();
  });
  it('preserves snapshot digest verification, references, and deterministic artifact identity', async () => {
    parser();
    const input = source(8_388_609);
    const capture: SourceCaptureArtifact = {
      schema_version: '1.0',
      artifact_kind: 'source_capture',
      id: 'capture.large-pdf',
      requested_uri: input.requested_uri,
      retrieved_at: input.retrieved_at,
      media_type: input.media_type,
      disposition: 'authoritative',
      retention_status: 'retained',
      content_digest: input.content_hash,
      digest_algorithm: 'sha256',
      snapshot: {
        kind: 'source_capture',
        reference_schema_version: '1.0',
        digest_algorithm: 'sha256',
        digest: input.content_hash!,
        reference: 'snapshot://large-pdf',
      },
    };
    const store = { writeSnapshot: vi.fn(), readSnapshot: vi.fn(async () => input.body.bytes) };
    const acquisition = artifactReference('source_acquisition', { id: 'acquisition.large-pdf' });
    const first = await extractDocumentArtifactFromRetainedCapture(capture, acquisition, store);
    const second = await extractDocumentArtifactFromRetainedCapture(capture, acquisition, store);
    expect(first).toEqual(second);
    expect(first.source_capture.reference).toBe(capture.id);
    expect(first.source_acquisition).toEqual(acquisition);
    expect(first.blocks[0].source_location).toMatchObject({ page: 1 });
    vi.mocked(getDocument).mockClear();
    const corrupt = await extractDocumentFromRetainedCapture(
      { ...capture, content_digest: artifactDigest('wrong') },
      store,
    );
    expect(corrupt.status).toBe('corrupt_source');
    const missing = await extractDocumentFromRetainedCapture(
      { ...capture, snapshot: undefined },
      store,
    );
    expect(missing.status).toBe('source_unavailable');
    expect(getDocument).not.toHaveBeenCalled();
  });
});
