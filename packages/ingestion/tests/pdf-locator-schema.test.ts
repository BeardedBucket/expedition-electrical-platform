import { describe, expect, it } from 'vitest';
import type { ExtractedDocument } from '../src/capture-types.js';
import {
  artifactDigest,
  artifactReference,
  buildDocumentExtractionArtifact,
  validateDocumentExtraction,
  validateProductionArtifactSchema,
  type DocumentExtractionArtifact,
} from '../src/production-contracts.js';

const document = (
  kind: 'pdf' | 'html' | 'generic' = 'pdf',
  ordinal?: number,
): ExtractedDocument => {
  const location = {
    kind,
    page: 2,
    fragment: `${kind}-page-2-item-${ordinal ?? 'unspecified'}`,
    path: `/${kind}/page/2/text/${ordinal ?? 'unspecified'}`,
    ...(ordinal !== undefined ? { ordinal } : {}),
  };
  return {
    source: {
      requested_uri: 'https://manufacturer.example/manual.pdf',
      media_type: kind === 'pdf' ? 'application/pdf' : 'text/html',
      retrieved_at: '2026-09-28T00:00:00Z',
      body: { bytes: new Uint8Array() },
    },
    status: 'extracted',
    warnings: [],
    extractor: 'synthetic',
    extractor_version: '1.0',
    blocks: [
      {
        id: 'block.source-position',
        kind: 'text_block',
        text: 'Source wording',
        locator: location,
        source_location: location,
      },
    ],
  };
};
const artifact = (input = document('pdf', 10_001)) =>
  buildDocumentExtractionArtifact(
    input,
    artifactReference('source_capture', { id: 'capture.pdf' }),
    {
      source_acquisition: artifactReference('source_acquisition', { id: 'acquisition.pdf' }),
    },
  );

describe('serialized PDF source ordinal contract', () => {
  it('permits a page-local ordinal above the retained-block count', () => {
    const result = artifact();
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].locator.ordinal).toBe(10_001);
    expect(result.blocks[0].source_location).toEqual(result.blocks[0].locator);
    expect(validateDocumentExtraction(result)).toEqual([]);
    expect(validateProductionArtifactSchema(result)).toEqual([]);
  });

  it.each(['html', 'generic'] as const)('keeps ordinal optional for %s locations', (kind) => {
    const result = artifact(document(kind));
    expect(result.blocks[0].locator).not.toHaveProperty('ordinal');
    expect(result.blocks[0].source_location).not.toHaveProperty('ordinal');
    expect(validateDocumentExtraction(result)).toEqual([]);
    expect(validateProductionArtifactSchema(result)).toEqual([]);
  });

  describe.each(['locator', 'source_location'] as const)('%s', (field) => {
    it.each([0, -1, 1.5, '1'])(
      'rejects invalid ordinal %s at runtime and serialized boundaries',
      (ordinal) => {
        const valid = artifact();
        const invalid = {
          ...valid,
          blocks: [{ ...valid.blocks[0], [field]: { ...valid.blocks[0][field], ordinal } }],
        } as unknown as DocumentExtractionArtifact;
        expect(validateDocumentExtraction(invalid)).toContain(
          `blocks[0].${field}.ordinal must be a positive integer`,
        );
        expect(validateProductionArtifactSchema(invalid)).not.toEqual([]);
      },
    );

    it('preserves closed serialized locations', () => {
      const valid = artifact();
      const invalid = {
        ...valid,
        blocks: [
          { ...valid.blocks[0], [field]: { ...valid.blocks[0][field], arbitrary_metadata: true } },
        ],
      };
      expect(validateProductionArtifactSchema(invalid)).not.toEqual([]);
    });
  });

  it('keeps artifact identity deterministic and independent of schema validation', () => {
    const input = document('pdf', 10_001);
    const first = artifact(input);
    const digest = artifactDigest(first);
    expect(validateProductionArtifactSchema(first)).toEqual([]);
    const second = artifact(input);
    expect(second).toEqual(first);
    expect(artifactDigest(second)).toBe(digest);
    expect(first.blocks[0].source_location).toEqual(input.blocks[0].source_location);
  });
});
