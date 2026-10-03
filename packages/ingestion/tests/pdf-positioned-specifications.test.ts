import { describe, expect, it } from 'vitest';
import {
  artifactDigest,
  artifactReference,
  buildDocumentExtractionArtifact,
  qualifyDocumentExtraction,
  validateProductionArtifactSchema,
  type SourceCaptureArtifact,
} from '../src/production-contracts.js';
import { extractPdfDocument } from '../src/document-extraction.js';
import { prepareProductionIngestReview } from '../src/production-ingest-workflow.js';
import { PDF_POSITIONED_SPECIFICATIONS } from '../src/pdf-positioned-specifications.js';
import { positionedPdfSource as source } from './fixtures/positioned-pdf.js';

async function extract(
  options: Parameters<typeof source>[0] = {},
  limits: Parameters<typeof extractPdfDocument>[1] = {},
) {
  const captured = source(options);
  const capture: SourceCaptureArtifact = {
    schema_version: '1.0',
    artifact_kind: 'source_capture',
    id: 'capture.positioned-pdf',
    requested_uri: captured.requested_uri,
    retrieved_at: captured.retrieved_at,
    media_type: 'application/pdf',
    disposition: 'authoritative',
    retention_status: 'not_retained',
    content_digest: captured.content_hash,
    digest_algorithm: 'sha256',
  };
  const document = await extractPdfDocument(captured, limits);
  const artifact = buildDocumentExtractionArtifact(
    document,
    artifactReference('source_capture', capture),
    {
      source_acquisition: {
        kind: 'source_acquisition',
        reference_schema_version: '1.0',
        digest: artifactDigest('fixture acquisition'),
        digest_algorithm: 'sha256',
      },
    },
  );
  return { document, artifact };
}

describe('bounded positioned PDF specifications', () => {
  it('extracts deterministic rows with original per-item label/value provenance', async () => {
    const first = await extract();
    const second = await extract();
    expect(first.artifact).toEqual(second.artifact);
    expect(validateProductionArtifactSchema(first.artifact)).toEqual([]);
    const table = first.artifact.blocks.find(
      (block) => block.locator.section === PDF_POSITIONED_SPECIFICATIONS,
    )!;
    expect(table.cells).toHaveLength(6);
    for (const cell of table.cells!) {
      const raw = first.artifact.blocks.find(
        (block) => block.kind === 'text_block' && block.locator.path === cell.source_location.path,
      );
      expect(raw?.content).toBe(cell.value);
      expect(cell.source_location).toMatchObject({ kind: 'pdf', page: 1 });
    }
    expect(table.cells?.[2].source_location).not.toEqual(table.cells?.[3].source_location);
  });

  it('qualifies only explicit pairs for each exact shared identifier and retains duration wording', async () => {
    const { artifact } = await extract();
    for (const mpn of ['EX-1', 'EX-2']) {
      const qualified = qualifyDocumentExtraction(artifact, { manufacturer_part_number: mpn });
      expect(qualified.facts).toHaveLength(2);
      expect(qualified.facts[0].metadata).toMatchObject({
        source_label: 'Continuous current: 5 min.',
        raw_value: '120',
        source_unit: 'A',
        applicability: { kind: 'exact_mpn_or_sku', value: mpn },
      });
      expect(
        qualified.facts[0].evidence?.filter((evidence) => evidence.role === 'qualifier'),
      ).not.toEqual([]);
      qualified.facts.forEach((fact) => expect(validateProductionArtifactSchema(fact)).toEqual([]));
    }
    for (const mpn of ['EX', 'EX-10', 'OTHER-1', 'ex-1'])
      expect(qualifyDocumentExtraction(artifact, { manufacturer_part_number: mpn }).facts).toEqual(
        [],
      );
    expect(qualifyDocumentExtraction(artifact).facts).toEqual([]);
    expect(
      qualifyDocumentExtraction(artifact, {
        target_identifier: 'EX-1',
        manufacturer_part_number: 'OTHER-1',
      }).facts,
    ).toEqual([]);
  });

  it('preserves source footnote text and its own locator as review-required context', async () => {
    const { artifact } = await extract({ footnote: true });
    const qualified = qualifyDocumentExtraction(artifact, { manufacturer_part_number: 'EX-1' });
    expect(qualified.facts).toHaveLength(2);
    for (const fact of qualified.facts) {
      const note = fact.evidence?.find(
        (evidence) => evidence.text === 'Ratings depend on the stated installation condition.',
      );
      expect(note?.role).toBe('qualifier');
      expect(
        artifact.blocks.find((block) => block.locator.path === note?.locator?.path)?.content,
      ).toBe(note?.text);
    }
  });

  it.each([{ max_items: 2 }, { max_text_length: 5 }, { max_total_text_code_units: 10 }])(
    'does not scope truncated text under shared limits: %j',
    async (limits) => {
      const { artifact } = await extract({}, limits);
      expect(artifact.status).toBe('partially_extracted');
      expect(artifact.blocks.every((block) => block.kind === 'text_block')).toBe(true);
      expect(
        qualifyDocumentExtraction(artifact, { manufacturer_part_number: 'EX-1' }).facts,
      ).toEqual([]);
    },
  );

  it('uses the normal workflow without automatically projecting contextual assertions or approving facts', async () => {
    const captured = source();
    const result = await prepareProductionIngestReview({
      intake: {
        schema_version: '1.0',
        artifact_kind: 'product_intake',
        id: 'intake.positioned-pdf',
        manufacturer: 'Synthetic Manufacturer',
        product_model: 'Example Model',
        manufacturer_part_number: 'EX-1',
        official_product_uri: captured.requested_uri,
      },
      adapter: {
        async capture() {
          return { status: 'success', source: captured, issues: [] };
        },
      },
      policy: { now: () => '2026-10-03T00:00:00Z' },
    });
    expect(result.status).toBe('review_ready');
    if (result.status !== 'review_ready') throw new Error('Expected provisional review.');
    expect(result.qualified_facts).toHaveLength(2);
    expect(result.proposals.every((proposal) => proposal.disposition !== 'mapped')).toBe(true);
    expect(result.bridge.candidate).toBeUndefined();
    expect(result.bridge.reviewed_semantic_decisions).toEqual([]);
  });

  it.each([
    { thirdColumn: true },
    { wrapped: true },
    { overlap: true },
    { extraIdentity: true },
    { tail: 'label' as const },
    { tail: 'value' as const },
  ])('leaves ambiguous structure as text without inventing facts: %j', async (options) => {
    const { artifact } = await extract(options);
    expect(artifact.blocks.every((block) => block.kind === 'text_block')).toBe(true);
    expect(qualifyDocumentExtraction(artifact, { manufacturer_part_number: 'EX-1' }).facts).toEqual(
      [],
    );
  });

  it('is manufacturer-neutral and does not assign structure to ordinary unsupported PDFs', async () => {
    const changed = await extract({
      identity: 'AB-9 / AB-10',
      manufacturer: 'Another Manufacturer',
    });
    expect(
      qualifyDocumentExtraction(changed.artifact, { manufacturer_part_number: 'AB-9' }).facts,
    ).toHaveLength(2);
    const unsupported = await extract({ identity: 'Descriptive title without an identifier list' });
    expect(unsupported.artifact.blocks.every((block) => block.kind === 'text_block')).toBe(true);
    expect(
      qualifyDocumentExtraction(unsupported.artifact, { manufacturer_part_number: 'EX-1' }).facts,
    ).toEqual([]);
  });

  it('fails closed at existing output budgets and rejects source-unlinked cell values', async () => {
    const limited = await extract({}, { max_table_cells: 1 });
    expect(limited.artifact.status).toBe('partially_extracted');
    expect(limited.artifact.blocks.every((block) => block.kind === 'text_block')).toBe(true);
    const { artifact } = await extract();
    const altered = {
      ...artifact,
      blocks: artifact.blocks.map((block) =>
        block.kind === 'table'
          ? {
              ...block,
              cells: block.cells?.map((cell, index) =>
                index === 3 ? { ...cell, label: '999 A', value: '999 A' } : cell,
              ),
            }
          : block,
      ),
    };
    expect(qualifyDocumentExtraction(altered, { manufacturer_part_number: 'EX-1' }).facts).toEqual(
      [],
    );
  });
});
