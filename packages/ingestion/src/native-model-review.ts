import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import { nativeModelGridObservations } from './native-model-grid.js';
import { DEFAULT_DOCUMENT_EXTRACTION_LIMITS } from './document-extraction.js';
import { qualifiedContext } from './qualified-context.js';
import {
  artifactDigest,
  artifactReference,
  buildDocumentExtractionArtifact,
  buildQualifiedFactArtifact,
  type DocumentExtractionArtifact,
  type ProductIntake,
  type SourceCaptureArtifact,
  type SourceAcquisitionArtifact,
  type QualifiedFactEvidence,
} from './production-contracts.js';
import type { CapturedSource } from './capture-types.js';
import type { SourceOwnedSpecification } from './source-owned-specification.js';

/** Native HTML spans assert source column membership; they do not assert tracker
 * grouping, hardware revision or engineering meaning. This independently versioned
 * review adapter retains the complete table and source document alongside each
 * selected row. It never repairs PDF geometry or aliases an intake to a header. */
export function prepareNativeModelReview(input: {
  source: CapturedSource;
  capture: SourceCaptureArtifact;
  acquisition: SourceAcquisitionArtifact;
  document: DocumentExtractionArtifact;
  intake: ProductIntake;
}) {
  const { source, capture, acquisition, document, intake } = input;
  const captureRef = artifactReference('source_capture', capture);
  const acquisitionRef = artifactReference('source_acquisition', acquisition);
  if (
    !source.media_type?.includes('html') ||
    capture.disposition !== 'authoritative' ||
    acquisition.officiality !== 'official' ||
    acquisition.intake.digest !== artifactDigest(intake) ||
    document.source_capture.digest !== captureRef.digest ||
    document.source_acquisition.digest !== acquisitionRef.digest ||
    document.status !== 'extracted' ||
    document.diagnostics?.some((d) => /limit_reached|partial|snapshot/.test(d.code)) ||
    source.body.bytes.length > DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_input_bytes ||
    source.content_hash !== capture.content_digest ||
    `sha256:${createHash('sha256').update(source.body.bytes).digest('hex')}` !==
      capture.content_digest ||
    source.requested_uri !== capture.requested_uri ||
    source.final_uri !== capture.final_uri ||
    !(
      acquisition.seed_capture.digest === captureRef.digest ||
      acquisition.candidates.some(
        (c) =>
          c.capture?.digest === captureRef.digest &&
          c.officiality === 'official' &&
          c.capture_outcome === 'authoritative',
      )
    )
  )
    return undefined;
  let observations: ReturnType<typeof nativeModelGridObservations>;
  try {
    observations = nativeModelGridObservations(source.body.bytes, intake.product_model);
  } catch {
    return undefined;
  }
  if (!observations.length) return undefined;
  const sourceText = (n: unknown): string => {
    const node = n as { value?: string; childNodes?: unknown[]; tagName?: string };
    if (['script', 'style'].includes(node.tagName ?? '')) return '';
    return node.value ?? node.childNodes?.map(sourceText).join(' ') ?? '';
  };
  const table = source.body.bytes.subarray(
    observations[0].table_start_byte,
    observations[0].table_end_byte,
  );
  const containing = sourceText(parse(new TextDecoder('utf-8', { fatal: true }).decode(table)))
    .replace(/\s+/g, ' ')
    .trim();
  // The complete retained document remains available for all headings/outside
  // notes. Include these conservatively: no guessed backward footnote scope.
  const surrounding = document.blocks
    .filter((b) => b.kind !== 'table')
    .map((b) => b.content ?? '')
    .filter(Boolean);
  const context = [containing, ...surrounding].join('\n');
  if (
    observations.length * 2 > DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_items ||
    [context, ...observations.flatMap((o) => [o.label, o.value])].some(
      (s) => s.length > DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_text_length,
    )
  )
    return undefined;
  const sourceTables = document.blocks.filter(
    (b) =>
      b.kind === 'table' &&
      b.cells?.some(
        (c) => c.row === 1 && c.kind === 'header' && c.value.trim() === intake.product_model,
      ),
  );
  const records: SourceOwnedSpecification[] = observations.map((o) => ({
    version: 'source-owned-specification.v1',
    label: o.label,
    value: o.value,
    statement: `${o.label} ${o.value}`,
    identity: o.model_literal,
    identity_kind: 'exact_product',
    label_locator: `utf8:${o.label_start_byte}:${o.label_end_byte}`,
    // Bridge native byte ownership to the ordinary extractor's already retained
    // DOM coordinates. Row and DOM-cell ordinal come from the source tree, not
    // matching labels/values or an oracle; ambiguity retains the byte locator.
    value_locator:
      sourceTables.length === 1
        ? (sourceTables[0].cells?.find(
            (c) => c.row === o.source_row && c.column === o.value_dom_column && c.value === o.value,
          )?.source_location.path ?? `utf8:${o.start_byte}:${o.end_byte}`)
        : `utf8:${o.start_byte}:${o.end_byte}`,
    value_byte_locator: `utf8:${o.start_byte}:${o.end_byte}`,
    identity_locator: `utf8:${o.model_start_byte}:${o.model_end_byte}`,
    containing_context: context,
    unresolved_context: [],
  }));
  // JSON escaping and locator metadata count toward the same per-block text cap.
  if (
    records.some(
      (r) => JSON.stringify(r).length > DEFAULT_DOCUMENT_EXTRACTION_LIMITS.max_text_length,
    )
  )
    return undefined;
  const supplemental = buildDocumentExtractionArtifact(
    {
      source,
      status: 'extracted',
      warnings: [],
      extractor: 'native-model-review',
      extractor_version: '1.0.0',
      blocks: records.map((r) => ({
        id: `native-model-row.${artifactDigest(r).slice(7, 31)}`,
        kind: 'structured',
        text: JSON.stringify(r),
        locator: { fragment: r.value_locator, path: r.value_locator },
        source_location: { kind: 'html', path: r.value_locator },
      })),
    },
    captureRef,
    {
      source_acquisition: acquisitionRef,
      acquisition_candidate_id: document.acquisition_candidate_id,
    },
  );
  const documentRef = artifactReference('document_extraction', supplemental);
  const evidence = (
    role: QualifiedFactEvidence['role'],
    text: string,
    path: string,
  ): QualifiedFactEvidence => ({
    role,
    text,
    locator: { kind: 'html', path },
    source_reference: captureRef,
    ...(role === 'qualifier'
      ? { context: qualifiedContext('source_semantic', 'document-qualification') }
      : {}),
  });
  const facts = records.map((r) =>
    buildQualifiedFactArtifact({
      source_capture: captureRef,
      source_acquisition: acquisitionRef,
      document_extraction: documentRef,
      acquisition_candidate_id: document.acquisition_candidate_id,
      metadata: {
        source_label: r.label,
        source_wording: r.label,
        raw_value: r.value,
        raw_identifier: r.identity,
        applicability: {
          kind: 'exact_product',
          value: r.identity,
          reason:
            'native-model-review.v1: literal exact header and source-declared HTML spans; full context retained, retail MPN/revision and semantic interpretation unresolved',
        },
        conditions: [r.containing_context],
      },
      evidence: [
        evidence('subject', r.identity, r.identity_locator),
        evidence('applicability', r.identity, r.identity_locator),
        evidence('label', r.label, r.label_locator),
        evidence('value', r.value, r.value_locator),
        evidence(
          'qualifier',
          r.containing_context,
          `utf8-table:${observations[0].table_start_byte}:${observations[0].table_end_byte}`,
        ),
      ],
      qualifier: 'native-model-review',
      qualifier_version: '1.0.0',
      qualification_state: 'structurally_supported',
    }),
  );
  return {
    document: supplemental,
    qualification: {
      outcome: 'qualified' as const,
      completeness: 'complete' as const,
      diagnostics: [],
      facts,
    },
  };
}
