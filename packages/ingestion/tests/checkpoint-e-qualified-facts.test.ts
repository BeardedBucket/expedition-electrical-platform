import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_SCHEMA_VERSION,
  artifactReference,
  qualifyDocumentExtraction,
  type DocumentExtractionArtifact,
} from '../src/production-contracts.js';

const makeSourceCapture = (id: string, digest: string) =>
  artifactReference('source_capture', {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'source_capture',
    id,
    requested_uri: `https://example.com/${id}`,
    retrieved_at: '2026-09-08T00:00:00Z',
    disposition: 'authoritative',
    retention_status: 'retained',
    content_digest: digest,
    digest_algorithm: 'sha256',
  });

const makeSourceAcquisition = (capture: ReturnType<typeof makeSourceCapture>) =>
  artifactReference('source_acquisition', {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'source_acquisition',
    id: `${capture.digest}-acq`,
    intake: artifactReference('product_intake', {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'product_intake',
      id: 'intake.example',
      manufacturer: 'Example Manufacturer',
      product_model: 'Example Model',
      manufacturer_part_number: 'MODEL-B',
      official_product_uri: 'https://example.com/products/model-b',
    }),
    seed_capture: capture,
    officiality: 'official',
    status: 'acquired',
    candidates: [],
    deterministic_snapshot:
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });

const makeDocumentExtractionArtifact = (
  overrides: Partial<DocumentExtractionArtifact> = {},
): DocumentExtractionArtifact => {
  const sourceCapture = makeSourceCapture(
    'capture.doc',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  );
  const sourceAcquisition = makeSourceAcquisition(sourceCapture);
  return {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'document_extraction',
    id: 'document-extraction.aaaaaaaaaaaaaaaaaaaaaaaa',
    source_capture: sourceCapture,
    source_acquisition: sourceAcquisition,
    status: 'extracted',
    capability_state: 'automatic_extraction_available',
    remediation_state: 'none_required',
    extractor: 'synthetic',
    extractor_version: '1.0',
    blocks: [],
    ...overrides,
  };
};

describe('checkpoint-e-qualified-facts', () => {
  it('qualifies an exact target table row without attaching sibling rows', () => {
    const document = makeDocumentExtractionArtifact({
      status: 'extracted',
      blocks: [
        {
          id: 'table-1',
          kind: 'table',
          locator: { kind: 'generic', page: 1 },
          rows: [
            { label: 'MODEL-A', value: '12 V' },
            { label: 'MODEL-B', value: '24 V' },
            { label: 'MODEL-C', value: '48 V' },
          ],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].metadata.applicability.kind).toBe('exact_mpn_or_sku');
    expect(result.facts[0].metadata.raw_value).toBe('24');
    expect(result.facts[0].metadata.source_unit).toBe('V');
  });

  it('keeps family-only and missing identity applicability unresolved or non-exact', () => {
    const familyDocument = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'family-1',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          rows: [{ label: 'Series', value: 'ALPHA Series' }],
        },
      ],
    });
    const familyResult = qualifyDocumentExtraction(familyDocument, {
      target_identifier: 'MODEL-B',
    });
    expect(familyResult.facts).toHaveLength(1);
    expect(familyResult.facts[0].metadata.applicability.kind).toBe('unresolved');

    const missingTargetResult = qualifyDocumentExtraction(familyDocument, {});
    expect(missingTargetResult.facts[0].metadata.applicability.kind).toBe('unresolved');
  });

  it('does not use prefix fuzzy nearest-name or first-row matching', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'table-2',
          kind: 'table',
          locator: { kind: 'generic', page: 1 },
          rows: [
            { label: 'MODEL-B PLUS', value: '30 A' },
            { label: 'MODEL-B', value: '24 A' },
            { label: 'MODEL-BETA', value: '28 A' },
          ],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].metadata.source_wording).toBe('MODEL-B');
    expect(result.facts[0].metadata.raw_value).toBe('24');
  });

  it('creates multi-location evidence from table header row identity and value cell', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'table-3',
          kind: 'table',
          locator: { kind: 'generic', page: 1 },
          cells: [
            {
              label: 'Model',
              value: 'MODEL-B',
              kind: 'header',
              row: 1,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 1, column: 1 },
            },
            {
              label: 'Max current',
              value: '50 A',
              kind: 'header',
              row: 1,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 1, column: 2 },
            },
            {
              label: 'MODEL-B',
              value: '50 A',
              kind: 'data',
              row: 2,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 2, column: 1 },
            },
            {
              label: 'Max current',
              value: '50 A',
              kind: 'data',
              row: 2,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 2, column: 2 },
            },
          ],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].evidence?.map((part) => part.role)).toContain('label');
    expect(result.facts[0].evidence?.map((part) => part.role)).toContain('subject');
    expect(result.facts[0].evidence?.map((part) => part.role)).toContain('value');
  });

  it('does not reinterpret arbitrary colon prose as a qualified fact', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'prose-1',
          kind: 'paragraph',
          locator: { kind: 'generic', page: 1 },
          content: 'Warning: disconnect before servicing',
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(0);
    expect(result.facts.some((fact) => fact.metadata.source_wording === 'Warning')).toBe(false);
  });

  it('does not reinterpret arbitrary two-line prose as a definition fact', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'prose-2',
          kind: 'paragraph',
          locator: { kind: 'generic', page: 1 },
          content: 'Disconnect power\nWait five minutes',
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(0);
  });

  it('uses D-preserved definition rows instead of reparsing definition text', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'def-1',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          content: 'Warning: this prose text must not be reparsed',
          rows: [{ label: 'Grounding lug', value: 'M6' }],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].metadata.source_wording).toBe('Grounding lug');
    expect(result.facts[0].metadata.raw_value).toBe('M6');
  });

  it('preserves raw wording units decimal comma and electrical terminology', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'raw-1',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          rows: [
            { label: 'Nominal voltage', value: '12,5 V' },
            { label: 'Grounding lug', value: 'M6' },
            { label: 'PE', value: 'available' },
          ],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts[0].metadata.raw_value).toBe('12,5');
    expect(result.facts[0].metadata.source_unit).toBe('V');
    expect(result.facts[1].metadata.source_wording).toBe('Grounding lug');
    expect(result.facts[2].metadata.source_wording).toBe('PE');
  });

  it('preserves missing value unit and applicability as unknown', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'missing-1',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          rows: [{ label: 'Nominal voltage', value: '' }],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(0);
    expect(result.outcome).toBe('no_qualifiable_facts');
    expect(result.diagnostics[0].code).toBe('source_not_qualifiable');
  });

  it('keeps duplicate and conflicting facts provenance-distinct', () => {
    const docA = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'dup-a',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          rows: [{ label: 'Maximum current', value: '50 A' }],
        },
      ],
    });
    const docB = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'dup-b',
          kind: 'definition',
          locator: { kind: 'generic', page: 2 },
          rows: [{ label: 'Maximum current', value: '50 A' }],
        },
      ],
    });
    const docC = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'conflict-c',
          kind: 'definition',
          locator: { kind: 'generic', page: 3 },
          rows: [{ label: 'Maximum current', value: '60 A' }],
        },
      ],
    });

    const resultA = qualifyDocumentExtraction(docA, { target_identifier: 'MODEL-B' });
    const resultB = qualifyDocumentExtraction(docB, { target_identifier: 'MODEL-B' });
    const resultC = qualifyDocumentExtraction(docC, { target_identifier: 'MODEL-B' });
    expect(resultA.facts[0].id).not.toBe(resultB.facts[0].id);
    expect(resultA.facts[0].id).not.toBe(resultC.facts[0].id);
    expect(resultB.facts[0].id).not.toBe(resultC.facts[0].id);
  });

  it('returns zero fabricated facts for unsupported and non-extractable sources', () => {
    const unsupported = makeDocumentExtractionArtifact({ status: 'unsupported', blocks: [] });
    const noContent = makeDocumentExtractionArtifact({
      status: 'no_extractable_content',
      blocks: [],
    });

    expect(
      qualifyDocumentExtraction(unsupported, { target_identifier: 'MODEL-B' }).facts,
    ).toHaveLength(0);
    expect(
      qualifyDocumentExtraction(noContent, { target_identifier: 'MODEL-B' }).facts,
    ).toHaveLength(0);
  });

  it('allows partial-source facts while preserving incomplete coverage', () => {
    const document = makeDocumentExtractionArtifact({
      status: 'partially_extracted',
      blocks: [
        {
          id: 'partial-1',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          rows: [{ label: 'Nominal voltage', value: '24 V' }],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(1);
    expect(result.outcome).toBe('source_incomplete');
    expect(result.completeness).toBe('partial');
  });

  it('does not silently make non-authoritative evidence authoritative', () => {
    const document = makeDocumentExtractionArtifact({
      status: 'source_non_authoritative',
      blocks: [
        {
          id: 'nonauth-1',
          kind: 'paragraph',
          locator: { kind: 'generic', page: 1 },
          content: 'Nominal voltage: 24 V',
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.outcome).toBe('non_authoritative_source');
    expect(result.facts).toHaveLength(0);
  });

  it('produces deterministic ids and ordering from identical inputs', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'order-1',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          rows: [
            { label: 'Nominal voltage', value: '24 V' },
            { label: 'Grounding lug', value: 'M6' },
          ],
        },
      ],
    });

    const first = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    const second = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(first.facts.map((fact) => fact.id)).toEqual(second.facts.map((fact) => fact.id));
    expect(first.facts.map((fact) => fact.metadata.source_wording)).toEqual(
      second.facts.map((fact) => fact.metadata.source_wording),
    );
  });

  it('keeps identical text at different source locations distinct', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'same-1',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          rows: [{ label: 'Maximum current', value: '50 A' }],
        },
        {
          id: 'same-2',
          kind: 'definition',
          locator: { kind: 'generic', page: 2 },
          rows: [{ label: 'Maximum current', value: '50 A' }],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(2);
    expect(result.facts[0].id).not.toBe(result.facts[1].id);
  });

  it('qualifies structured table cells before coarse row values', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'table-cells-1',
          kind: 'table',
          locator: { kind: 'generic', page: 1 },
          rows: [
            { label: 'MODEL-A', value: '12 V 20 A' },
            { label: 'MODEL-B', value: '24 V 30 A' },
          ],
          cells: [
            {
              label: 'Model',
              value: 'Model',
              kind: 'header',
              row: 1,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 1, column: 1 },
            },
            {
              label: 'Voltage',
              value: 'Voltage',
              kind: 'header',
              row: 1,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 1, column: 2 },
            },
            {
              label: 'Current',
              value: 'Current',
              kind: 'header',
              row: 1,
              column: 3,
              source_location: { kind: 'generic', page: 1, row: 1, column: 3 },
            },
            {
              label: 'MODEL-A',
              value: 'MODEL-A',
              kind: 'data',
              row: 2,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 2, column: 1 },
            },
            {
              label: '12 V',
              value: '12 V',
              kind: 'data',
              row: 2,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 2, column: 2 },
            },
            {
              label: '20 A',
              value: '20 A',
              kind: 'data',
              row: 2,
              column: 3,
              source_location: { kind: 'generic', page: 1, row: 2, column: 3 },
            },
            {
              label: 'MODEL-B',
              value: 'MODEL-B',
              kind: 'data',
              row: 3,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 3, column: 1 },
            },
            {
              label: '24 V',
              value: '24 V',
              kind: 'data',
              row: 3,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 3, column: 2 },
            },
            {
              label: '30 A',
              value: '30 A',
              kind: 'data',
              row: 3,
              column: 3,
              source_location: { kind: 'generic', page: 1, row: 3, column: 3 },
            },
          ],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(2);
    expect(result.facts.map((fact) => fact.metadata.source_wording)).toEqual([
      'Voltage',
      'Current',
    ]);
    expect(result.facts[0].metadata.raw_value).toBe('24');
    expect(result.facts[0].metadata.source_unit).toBe('V');
    expect(result.facts[1].metadata.raw_value).toBe('30');
    expect(result.facts[1].metadata.source_unit).toBe('A');
    expect(result.facts.some((fact) => String(fact.metadata.raw_value).includes('24 V 30 A'))).toBe(
      false,
    );
    expect(
      result.facts.every((fact) => fact.metadata.applicability.kind === 'exact_mpn_or_sku'),
    ).toBe(true);
    expect(
      result.facts.some((fact) =>
        fact.evidence?.some((part) => part.role === 'subject' && part.text === 'MODEL-A'),
      ),
    ).toBe(false);
  });

  it('creates header subject and value evidence for each structured table fact', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'table-cells-2',
          kind: 'table',
          locator: { kind: 'generic', page: 1 },
          cells: [
            {
              label: 'Model',
              value: 'Model',
              kind: 'header',
              row: 1,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 1, column: 1 },
            },
            {
              label: 'Voltage',
              value: 'Voltage',
              kind: 'header',
              row: 1,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 1, column: 2 },
            },
            {
              label: 'Current',
              value: 'Current',
              kind: 'header',
              row: 1,
              column: 3,
              source_location: { kind: 'generic', page: 1, row: 1, column: 3 },
            },
            {
              label: 'MODEL-A',
              value: 'MODEL-A',
              kind: 'data',
              row: 2,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 2, column: 1 },
            },
            {
              label: '12 V',
              value: '12 V',
              kind: 'data',
              row: 2,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 2, column: 2 },
            },
            {
              label: '20 A',
              value: '20 A',
              kind: 'data',
              row: 2,
              column: 3,
              source_location: { kind: 'generic', page: 1, row: 2, column: 3 },
            },
            {
              label: 'MODEL-B',
              value: 'MODEL-B',
              kind: 'data',
              row: 3,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 3, column: 1 },
            },
            {
              label: '24 V',
              value: '24 V',
              kind: 'data',
              row: 3,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 3, column: 2 },
            },
            {
              label: '30 A',
              value: '30 A',
              kind: 'data',
              row: 3,
              column: 3,
              source_location: { kind: 'generic', page: 1, row: 3, column: 3 },
            },
          ],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(2);
    for (const fact of result.facts) {
      const roles = fact.evidence?.map((part) => part.role) ?? [];
      expect(roles).toContain('label');
      expect(roles).toContain('subject');
      expect(roles).toContain('value');
      expect(fact.evidence?.find((part) => part.role === 'subject')?.text).toBe('MODEL-B');
      expect(fact.evidence?.find((part) => part.role === 'label')?.locator?.column).toBeDefined();
      expect(fact.evidence?.find((part) => part.role === 'value')?.locator?.column).toBeDefined();
    }
    expect(result.facts[0].evidence?.find((part) => part.role === 'label')?.text).toBe('Voltage');
    expect(result.facts[1].evidence?.find((part) => part.role === 'label')?.text).toBe('Current');
  });

  it('falls back to structured rows only when usable table cells are absent', () => {
    const rowOnlyDocument = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'table-rows-only',
          kind: 'table',
          locator: { kind: 'generic', page: 1 },
          rows: [
            { label: 'MODEL-A', value: '12 V' },
            { label: 'MODEL-B', value: '24 V' },
          ],
        },
      ],
    });
    const rowResult = qualifyDocumentExtraction(rowOnlyDocument, { target_identifier: 'MODEL-B' });
    expect(rowResult.facts).toHaveLength(1);
    expect(rowResult.facts[0].metadata.raw_value).toBe('24');
    expect(rowResult.facts[0].metadata.source_unit).toBe('V');

    const cellDocument = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'table-rows-and-cells',
          kind: 'table',
          locator: { kind: 'generic', page: 2 },
          rows: [{ label: 'MODEL-B', value: '24 V 30 A' }],
          cells: [
            {
              label: 'Model',
              value: 'Model',
              kind: 'header',
              row: 1,
              column: 1,
              source_location: { kind: 'generic', page: 2, row: 1, column: 1 },
            },
            {
              label: 'Voltage',
              value: 'Voltage',
              kind: 'header',
              row: 1,
              column: 2,
              source_location: { kind: 'generic', page: 2, row: 1, column: 2 },
            },
            {
              label: 'Current',
              value: 'Current',
              kind: 'header',
              row: 1,
              column: 3,
              source_location: { kind: 'generic', page: 2, row: 1, column: 3 },
            },
            {
              label: 'MODEL-B',
              value: 'MODEL-B',
              kind: 'data',
              row: 2,
              column: 1,
              source_location: { kind: 'generic', page: 2, row: 2, column: 1 },
            },
            {
              label: '24 V',
              value: '24 V',
              kind: 'data',
              row: 2,
              column: 2,
              source_location: { kind: 'generic', page: 2, row: 2, column: 2 },
            },
            {
              label: '30 A',
              value: '30 A',
              kind: 'data',
              row: 2,
              column: 3,
              source_location: { kind: 'generic', page: 2, row: 2, column: 3 },
            },
          ],
        },
      ],
    });
    const cellResult = qualifyDocumentExtraction(cellDocument, { target_identifier: 'MODEL-B' });
    expect(cellResult.facts).toHaveLength(2);
    expect(cellResult.facts.map((fact) => fact.metadata.source_wording)).toEqual([
      'Voltage',
      'Current',
    ]);
    expect(
      cellResult.facts.some((fact) => String(fact.metadata.raw_value).includes('24 V 30 A')),
    ).toBe(false);
  });

  it('keeps missing table identity unresolved rather than mismatch', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'table-no-identity',
          kind: 'table',
          locator: { kind: 'generic', page: 1 },
          cells: [
            {
              label: 'Property',
              value: 'Property',
              kind: 'header',
              row: 1,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 1, column: 1 },
            },
            {
              label: 'Value',
              value: 'Value',
              kind: 'header',
              row: 1,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 1, column: 2 },
            },
            {
              label: 'Voltage',
              value: 'Voltage',
              kind: 'data',
              row: 2,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 2, column: 1 },
            },
            {
              label: '24 V',
              value: '24 V',
              kind: 'data',
              row: 2,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 2, column: 2 },
            },
          ],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'identity_mismatch')).toBe(
      false,
    );
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'applicability_unresolved'),
    ).toBe(true);
  });

  it('marks qualification coverage incomplete when D reports truncated extraction', () => {
    const document = makeDocumentExtractionArtifact({
      status: 'extracted',
      diagnostics: [
        { code: 'item_limit_reached', message: 'HTML extraction reached the 1000-item limit.' },
      ],
      blocks: [
        {
          id: 'trunc-1',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          rows: [{ label: 'Nominal voltage', value: '24 V' }],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(1);
    expect(result.outcome).not.toBe('qualification_failed');
    expect(result.completeness).toBe('partial');
    expect(result.completeness).not.toBe('complete');
  });

  it('keeps fully extracted unbounded qualification coverage complete', () => {
    const document = makeDocumentExtractionArtifact({
      status: 'extracted',
      blocks: [
        {
          id: 'full-1',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          rows: [{ label: 'Nominal voltage', value: '24 V' }],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(1);
    expect(result.outcome).toBe('qualified');
    expect(result.completeness).toBe('complete');
  });

  it('preserves source identity mismatch without forcing target applicability', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'match-1',
          kind: 'table',
          locator: { kind: 'generic', page: 1 },
          rows: [{ label: 'MODEL-X', value: '50 A' }],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(0);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'applicability_unresolved'),
    ).toBe(true);
  });

  it('checkpoint e populates value-independent labels from structured source labels', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'def-label',
          kind: 'definition',
          locator: { kind: 'generic', page: 1 },
          rows: [{ label: 'Maximum voltage', value: '24 V' }],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].metadata.source_wording).toBe('Maximum voltage');
    expect(result.facts[0].metadata.source_label).toBe('Maximum voltage');
    expect(result.facts[0].metadata.raw_value).toBe('24');
  });

  it('checkpoint e populates value-independent labels from table headers', () => {
    const document = makeDocumentExtractionArtifact({
      blocks: [
        {
          id: 'table-label',
          kind: 'table',
          locator: { kind: 'generic', page: 1 },
          cells: [
            {
              label: 'Model',
              value: 'MODEL-B',
              kind: 'header',
              row: 1,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 1, column: 1 },
            },
            {
              label: 'Max voltage',
              value: 'Max voltage',
              kind: 'header',
              row: 1,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 1, column: 2 },
            },
            {
              label: 'MODEL-B',
              value: 'MODEL-B',
              kind: 'data',
              row: 2,
              column: 1,
              source_location: { kind: 'generic', page: 1, row: 2, column: 1 },
            },
            {
              label: 'Max voltage',
              value: '24 V',
              kind: 'data',
              row: 2,
              column: 2,
              source_location: { kind: 'generic', page: 1, row: 2, column: 2 },
            },
          ],
        },
      ],
    });

    const result = qualifyDocumentExtraction(document, { target_identifier: 'MODEL-B' });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].metadata.source_wording).toBe('Max voltage');
    expect(result.facts[0].metadata.source_label).toBe('Max voltage');
    expect(result.facts[0].metadata.raw_value).toBe('24');
  });
});
