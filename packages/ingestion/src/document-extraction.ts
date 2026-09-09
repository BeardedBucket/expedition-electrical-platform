import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DefaultTreeAdapterTypes } from 'parse5';
import type {
  CapturedSource,
  DiagnosticCode,
  DocumentItemKind,
  ExtractedBlock,
  ExtractedDocument,
  ExtractionDiagnostic,
} from './capture-types.js';
import { replaySourceCaptureSnapshot, type SnapshotStore } from './source-capture.js';
import {
  buildDocumentExtractionArtifact,
  artifactReference,
  type ArtifactReference,
  type DocumentExtractionArtifact,
  type DocumentExtractionArtifactOptions,
  type SourceCaptureArtifact,
} from './production-contracts.js';

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Document = DefaultTreeAdapterTypes.Document;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

const BOILERPLATE_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'nav',
  'footer',
  'header',
  'aside',
  'menu',
]);

export interface DocumentExtractionLimits {
  readonly max_input_bytes?: number;
  readonly max_items?: number;
  readonly max_pages?: number;
  readonly max_table_cells?: number;
  readonly max_text_length?: number;
}

export const DEFAULT_DOCUMENT_EXTRACTION_LIMITS: Required<DocumentExtractionLimits> = {
  max_input_bytes: 8 * 1024 * 1024,
  max_items: 10_000,
  max_pages: 1_000,
  max_table_cells: 50_000,
  max_text_length: 100_000,
};

export const extractPdfDocument = async (
  source: CapturedSource,
  suppliedLimits: DocumentExtractionLimits = {},
): Promise<ExtractedDocument> => {
  const limits = { ...DEFAULT_DOCUMENT_EXTRACTION_LIMITS, ...suppliedLimits };
  if (source.body.bytes.byteLength > limits.max_input_bytes) {
    const diagnostic = toDiagnostic(
      'input_limit_reached',
      `PDF input exceeded the ${limits.max_input_bytes}-byte extraction limit.`,
    );
    const diagnostics = [diagnostic];
    return {
      source,
      status: 'partially_extracted',
      capability_state: deriveCapabilityState('partially_extracted', diagnostics),
      remediation_state: deriveRemediationState('partially_extracted', diagnostics),
      blocks: [],
      warnings: [toWarning(diagnostic)],
      diagnostics,
      extractor: 'pdfjs',
      extractor_version: '5.4.149',
    };
  }
  try {
    const loadingTask = pdfjs.getDocument({
      data: source.body.bytes,
      isEvalSupported: false,
      useWorkerFetch: false,
      verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    const diagnostics: ExtractionDiagnostic[] = [
      toDiagnostic(
        'table_extraction_unsupported',
        'PDF table structure is not identified by the deterministic text extractor.',
      ),
    ];
    const blocks: ExtractedBlock[] = [];
    const pageLimit = Math.min(pdf.numPages, limits.max_pages);
    if (pdf.numPages > limits.max_pages) {
      diagnostics.push(
        toDiagnostic(
          'page_limit_reached',
          `PDF page count exceeded the ${limits.max_pages}-page extraction limit.`,
        ),
      );
    }
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const [ordinal, item] of content.items.entries()) {
        if (!('str' in item)) continue;
        const text = clean(item.str);
        if (!text) continue;
        if (blocks.length >= limits.max_items) {
          diagnostics.push(
            toDiagnostic(
              'item_limit_reached',
              `PDF extraction exceeded the ${limits.max_items}-item extraction limit.`,
            ),
          );
          break;
        }
        const locator = {
          kind: 'pdf' as const,
          fragment: `pdf-page-${pageNumber}-item-${ordinal + 1}`,
          path: `/pdf/page/${pageNumber}/text/${ordinal + 1}`,
          page: pageNumber,
          ordinal: ordinal + 1,
        };
        blocks.push({
          id: stableId('text_block', locator.fragment, locator.path),
          kind: 'text_block',
          text,
          locator,
          source_location: locator,
        });
      }
    }
    const status =
      blocks.length === 0
        ? 'no_extractable_content'
        : diagnostics.some((diagnostic) =>
              ['page_limit_reached', 'item_limit_reached'].includes(diagnostic.code),
            )
          ? 'partially_extracted'
          : 'extracted';
    if (blocks.length === 0) {
      diagnostics.push(
        toDiagnostic(
          'likely_image_only',
          'PDF pages were readable, but no extractable text items were present.',
        ),
      );
    }
    return {
      source,
      status,
      capability_state: deriveCapabilityState(status, diagnostics),
      remediation_state: deriveRemediationState(status, diagnostics),
      blocks,
      page_count: pdf.numPages,
      warnings: diagnostics.map(toWarning),
      diagnostics,
      extractor: 'pdfjs',
      extractor_version: '5.4.149',
    };
  } catch (error) {
    const diagnostic = toDiagnostic(
      'parser_failure',
      `PDF parsing failed: ${error instanceof Error ? error.message : 'unknown parser error'}`,
      false,
    );
    return {
      source,
      status: 'failed',
      capability_state: deriveCapabilityState('failed', [diagnostic]),
      remediation_state: deriveRemediationState('failed', [diagnostic]),
      blocks: [],
      warnings: [toWarning(diagnostic)],
      diagnostics: [diagnostic],
      extractor: 'pdfjs',
      extractor_version: '5.4.149',
    };
  }
};

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();
const textOf = (node: ChildNode): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(textOf).join(' ') : '';
const stableId = (...parts: readonly string[]): string =>
  `doc.${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)}`;

const toDiagnostic = (
  code: DiagnosticCode,
  message: string,
  recoverable = true,
): ExtractionDiagnostic => ({
  code,
  message,
  recoverable,
});

const toWarning = (diagnostic: ExtractionDiagnostic): { code: string; message: string } => ({
  code: diagnostic.code,
  message: diagnostic.message,
});

const deriveCapabilityState = (
  status: ExtractedDocument['status'],
  diagnostics: readonly ExtractionDiagnostic[] = [],
): ExtractedDocument['capability_state'] => {
  const hasHumanReviewIndicator = diagnostics.some((diagnostic) =>
    ['likely_image_only', 'no_extractable_text'].includes(diagnostic.code),
  );
  switch (status) {
    case 'extracted':
      return 'automatic_extraction_available';
    case 'partially_extracted':
      return hasHumanReviewIndicator ? 'capability_not_enabled' : 'automatic_extraction_available';
    case 'no_extractable_content':
      return 'capability_not_enabled';
    case 'unsupported':
      return diagnostics.some((diagnostic) =>
        ['unsupported_media_type', 'pdf_unsupported'].includes(diagnostic.code),
      )
        ? 'capability_not_implemented'
        : 'capability_not_enabled';
    case 'source_unavailable':
    case 'source_empty':
      return 'no_known_automatic_path';
    case 'corrupt_source':
      return 'no_known_automatic_path';
    case 'failed':
      return diagnostics.some((diagnostic) => diagnostic.code === 'snapshot_missing')
        ? 'no_known_automatic_path'
        : hasHumanReviewIndicator
          ? 'capability_not_enabled'
          : 'capability_not_implemented';
    case 'source_non_authoritative':
      return 'automatic_extraction_available';
    default:
      return 'unknown';
  }
};

const deriveRemediationState = (
  status: ExtractedDocument['status'],
  diagnostics: readonly ExtractionDiagnostic[] = [],
): ExtractedDocument['remediation_state'] => {
  const hasHumanReviewIndicator = diagnostics.some((diagnostic) =>
    ['likely_image_only', 'no_extractable_text'].includes(diagnostic.code),
  );
  switch (status) {
    case 'extracted':
      return 'none_required';
    case 'partially_extracted':
      return hasHumanReviewIndicator ? 'human_review_required' : 'none_required';
    case 'no_extractable_content':
      return 'human_review_required';
    case 'unsupported':
      return diagnostics.some((diagnostic) =>
        ['unsupported_media_type', 'pdf_unsupported'].includes(diagnostic.code),
      )
        ? 'implementation_required'
        : hasHumanReviewIndicator
          ? 'human_review_required'
          : 'enable_capability';
    case 'source_unavailable':
    case 'source_empty':
      return 'source_reacquisition_required';
    case 'corrupt_source':
      return 'source_repair_required';
    case 'failed':
      return diagnostics.some((diagnostic) => diagnostic.code === 'snapshot_missing')
        ? 'source_reacquisition_required'
        : hasHumanReviewIndicator
          ? 'human_review_required'
          : 'implementation_required';
    case 'source_non_authoritative':
      return 'none_required';
    default:
      return 'human_review_required';
  }
};

const element = (node: ChildNode, name: string): node is Element =>
  'tagName' in node && node.tagName.toLowerCase() === name.toLowerCase();

const children = (node: ParentNode, name: string): Element[] =>
  node.childNodes.filter((child): child is Element => element(child, name));

const walk = (
  node: ParentNode,
  visit: (node: Element, path: string) => void,
  path = 'root',
): void => {
  const siblingOrdinals = new Map<string, number>();
  for (const child of node.childNodes) {
    if (!('tagName' in child)) continue;
    if (BOILERPLATE_TAGS.has(String(child.tagName).toLowerCase())) continue;
    const tagName = String(child.tagName).toLowerCase();
    const ordinal = (siblingOrdinals.get(tagName) ?? 0) + 1;
    siblingOrdinals.set(tagName, ordinal);
    const nextPath = `${path}/${tagName}[${ordinal}]`;
    visit(child, nextPath);
    walk(child, visit, nextPath);
  }
};

const pickTitle = (node: ParentNode): string | undefined => {
  for (const child of node.childNodes) {
    if (!('tagName' in child)) continue;
    if (child.tagName.toLowerCase() === 'title') {
      const text = clean(textOf(child));
      if (text) return text;
    }
    const nested = pickTitle(child as ParentNode);
    if (nested) return nested;
  }
  return undefined;
};

const compactTableRows = (
  rowCells: readonly { label: string; value: string }[],
): { label: string; value: string }[] =>
  rowCells.filter((row) => row.label || row.value).map(({ label, value }) => ({ label, value }));

export const extractHtmlDocument = (
  source: CapturedSource,
  suppliedLimits: DocumentExtractionLimits = {},
): ExtractedDocument => {
  const limits = { ...DEFAULT_DOCUMENT_EXTRACTION_LIMITS, ...suppliedLimits };
  if (source.body.bytes.byteLength > limits.max_input_bytes) {
    const diagnostic = toDiagnostic(
      'input_limit_reached',
      `HTML input exceeded the ${limits.max_input_bytes}-byte extraction limit.`,
    );
    const diagnostics = [diagnostic];
    return {
      source,
      status: 'partially_extracted',
      capability_state: deriveCapabilityState('partially_extracted', diagnostics),
      remediation_state: deriveRemediationState('partially_extracted', diagnostics),
      blocks: [],
      warnings: [toWarning(diagnostic)],
      diagnostics,
      extractor: 'html-parser',
      extractor_version: '1.1.0',
    };
  }
  if (!source.media_type?.includes('html')) {
    const diagnostics = [
      toDiagnostic(
        source.media_type === 'application/pdf' ? 'pdf_unsupported' : 'unsupported_media_type',
        source.media_type === 'application/pdf'
          ? 'PDF extraction is not implemented in this phase.'
          : `No HTML extractor supports '${source.media_type ?? 'unknown'}'.`,
      ),
    ];
    return {
      source,
      status: 'unsupported',
      capability_state: deriveCapabilityState('unsupported', diagnostics),
      remediation_state: deriveRemediationState('unsupported', diagnostics),
      blocks: [],
      warnings: diagnostics.map(toWarning),
      diagnostics,
      extractor: 'html-parser',
      extractor_version: '1.0.0',
    };
  }
  if (source.body.text === undefined && source.body.bytes?.byteLength) {
    const bodyText = new TextDecoder('utf-8', { fatal: false }).decode(source.body.bytes);
    source = {
      ...source,
      body: { ...source.body, text: bodyText },
    };
  }
  if (source.body.text === undefined) {
    const diagnostic = toDiagnostic(
      'missing_text_body',
      'HTML extraction requires a text body.',
      true,
    );
    const diagnostics = [diagnostic];
    return {
      source,
      status: 'source_unavailable',
      capability_state: deriveCapabilityState('source_unavailable', diagnostics),
      remediation_state: deriveRemediationState('source_unavailable', diagnostics),
      blocks: [],
      warnings: [toWarning(diagnostic)],
      diagnostics,
      extractor: 'html-parser',
      extractor_version: '1.0.0',
    };
  }

  const document = parse(source.body.text) as Document;
  const blocks: ExtractedBlock[] = [];
  let section: string | undefined;
  let tableNumber = 0;
  let paragraphNumber = 0;
  let listNumber = 0;
  let definitionNumber = 0;
  let itemLimitReached = false;
  let textLimitReached = false;
  let tableCellLimitReached = false;

  const addBlock = (
    kind: DocumentItemKind,
    text: string,
    locator: ExtractedBlock['locator'],
    rows?: readonly { label: string; value: string; row?: number; column?: number }[],
    cells?: ExtractedBlock['cells'],
    sourceLocation?: {
      kind: 'html' | 'pdf' | 'generic';
      path?: string;
      section?: string;
      page?: number;
      row?: number;
      column?: number;
    },
    headingLevel?: number,
  ): void => {
    if (!text) return;
    if (blocks.length >= limits.max_items) {
      itemLimitReached = true;
      return;
    }
    const boundedText = text.slice(0, limits.max_text_length);
    if (boundedText.length !== text.length) textLimitReached = true;
    const id = stableId(kind, locator.fragment, locator.path ?? '');
    blocks.push({
      id,
      kind,
      text: boundedText,
      ...(headingLevel !== undefined ? { heading_level: headingLevel } : {}),
      section,
      locator,
      ...(rows && rows.length ? { rows } : {}),
      ...(cells && cells.length ? { cells } : {}),
      ...(sourceLocation ? { source_location: sourceLocation } : {}),
    });
  };

  walk(document, (node, path) => {
    const tag = String(node.tagName).toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const text = clean(textOf(node));
      if (text) {
        section = text;
        const locator = { fragment: `heading-${blocks.length + 1}`, section, path };
        addBlock(
          'heading',
          text,
          locator,
          undefined,
          undefined,
          { kind: 'html', path, section },
          Number(tag.slice(1)),
        );
      }
      return;
    }
    if (tag === 'p') {
      const text = clean(textOf(node));
      if (text) {
        paragraphNumber += 1;
        const locator = { fragment: `paragraph-${paragraphNumber}`, section, path };
        addBlock('paragraph', text, locator, undefined, undefined, { kind: 'html', path, section });
      }
      return;
    }
    if (tag === 'table') {
      tableNumber += 1;
      const rowNodes = [] as Array<{ label: string; value: string; row: number; column: number }>;
      const cellNodes: Array<NonNullable<ExtractedBlock['cells']>[number]> = [];
      const tableRows: Element[] = [];
      const collectRows = (current: ParentNode): void => {
        for (const child of current.childNodes) {
          if (!('tagName' in child)) continue;
          const tag = String(child.tagName).toLowerCase();
          if (tag === 'tr') {
            tableRows.push(child as Element);
          }
          if ('childNodes' in child && child.childNodes) {
            collectRows(child as ParentNode);
          }
        }
      };
      collectRows(node);
      tableRows.forEach((row, rowIndex) => {
        const cells = Array.from(row.childNodes).filter(
          (child): child is Element =>
            'tagName' in child && ['th', 'td'].includes(String(child.tagName).toLowerCase()),
        );
        const cellTexts = cells.map((cell) => clean(textOf(cell)));
        if (!cellTexts.some(Boolean)) return;
        cellTexts.forEach((cellText, cellIndex) => {
          if (!cellText) return;
          if (cellNodes.length >= limits.max_table_cells) {
            tableCellLimitReached = true;
            return;
          }
          cellNodes.push({
            label: cellText,
            value: cellText,
            kind: row.childNodes.some(
              (child) => 'tagName' in child && String(child.tagName).toLowerCase() === 'th',
            )
              ? 'header'
              : 'data',
            row: rowIndex + 1,
            column: cellIndex + 1,
            source_location: {
              kind: 'html',
              path: `${path}/tr[${rowIndex + 1}]/cell[${cellIndex + 1}]`,
              section,
              table: `table-${tableNumber}`,
              row: rowIndex + 1,
              column: cellIndex + 1,
            },
          });
        });
        if (cellTexts.length >= 2) {
          rowNodes.push({
            label: cellTexts[0],
            value: cellTexts.slice(1).join(' '),
            row: rowIndex + 1,
            column: 1,
          });
        } else if (cellTexts.length === 1) {
          rowNodes.push({
            label: cellTexts[0],
            value: cellTexts[0],
            row: rowIndex + 1,
            column: 1,
          });
        }
      });
      const tableText = clean(textOf(node));
      if (tableText) {
        addBlock(
          'table',
          tableText,
          { fragment: `table-${tableNumber}`, table: `table-${tableNumber}`, section, path },
          compactTableRows(rowNodes),
          cellNodes,
          { kind: 'html', path, section },
        );
      }
      return;
    }
    if (tag === 'dl') {
      definitionNumber += 1;
      const pairs: { label: string; value: string }[] = [];
      const terms = children(node, 'dt');
      for (const term of terms) {
        const termText = clean(textOf(term));
        if (!termText) continue;
        const siblings = node.childNodes;
        const nextIndex = siblings.indexOf(term);
        const definition = siblings.slice(nextIndex + 1).find((child) => element(child, 'dd'));
        if (!definition || !element(definition, 'dd')) continue;
        const value = clean(textOf(definition));
        if (!value) continue;
        pairs.push({ label: termText, value });
      }
      if (pairs.length) {
        addBlock(
          'definition',
          pairs.map((pair) => `${pair.label}: ${pair.value}`).join(' '),
          { fragment: `definition-${definitionNumber}`, section, path },
          pairs,
          undefined,
          { kind: 'html', path, section },
        );
      }
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = children(node, 'li')
        .map((item) => clean(textOf(item)))
        .filter(Boolean);
      if (items.length) {
        listNumber += 1;
        addBlock(
          'list',
          items.join(' '),
          { fragment: `list-${listNumber}`, section, path },
          undefined,
          undefined,
          {
            kind: 'html',
            path,
            section,
          },
        );
      }
      return;
    }
    if (tag === 'figcaption' || tag === 'caption') {
      const text = clean(textOf(node));
      if (text) {
        addBlock(tag === 'figcaption' ? 'figure_caption' : 'table_caption', text, {
          fragment: `${tag}-${blocks.length + 1}`,
          section,
          path,
        });
      }
      return;
    }
    if (tag === 'note') {
      const text = clean(textOf(node));
      if (text) {
        addBlock(
          'note',
          text,
          { fragment: `note-${blocks.length + 1}`, section, path },
          undefined,
          undefined,
          {
            kind: 'html',
            path,
            section,
          },
        );
      }
      return;
    }
    if (tag === 'li') {
      const text = clean(textOf(node));
      if (text) {
        addBlock('list_item', text, { fragment: `list-item-${blocks.length + 1}`, section, path });
      }
    }
  });

  const title = pickTitle(document) ?? undefined;
  const diagnostics: ExtractionDiagnostic[] = [];
  if (itemLimitReached)
    diagnostics.push(
      toDiagnostic(
        'item_limit_reached',
        `HTML extraction reached the ${limits.max_items}-item limit.`,
      ),
    );
  if (tableCellLimitReached)
    diagnostics.push(
      toDiagnostic(
        'table_cell_limit_reached',
        `Table extraction reached the ${limits.max_table_cells}-cell limit.`,
      ),
    );
  if (textLimitReached)
    diagnostics.push(
      toDiagnostic(
        'text_limit_reached',
        `One or more items exceeded the ${limits.max_text_length}-character limit.`,
      ),
    );
  if (!blocks.length && diagnostics.length === 0)
    diagnostics.push(
      toDiagnostic('no_extractable_text', 'The HTML document contained no extractable text.', true),
    );
  const status = blocks.length && diagnostics.length === 0 ? 'extracted' : 'partially_extracted';
  return {
    source,
    ...(title ? { title } : {}),
    status,
    capability_state: deriveCapabilityState(status, diagnostics),
    remediation_state: deriveRemediationState(status, diagnostics),
    blocks,
    warnings: diagnostics.map(toWarning),
    diagnostics,
    extractor: 'html-parser',
    extractor_version: '1.1.0',
  };
};

export const extractDocument = (
  source: CapturedSource,
  limits: DocumentExtractionLimits = {},
): ExtractedDocument => {
  const mediaType = source.media_type ?? 'unknown';
  if (source.body.bytes?.byteLength === 0) {
    const diagnostic = toDiagnostic(
      'source_empty',
      'The source body was empty and cannot be extracted.',
      true,
    );
    const diagnostics = [diagnostic];
    return {
      source,
      status: 'source_empty',
      capability_state: deriveCapabilityState('source_empty', diagnostics),
      remediation_state: deriveRemediationState('source_empty', diagnostics),
      blocks: [],
      warnings: [toWarning(diagnostic)],
      diagnostics,
      extractor: 'generic',
      extractor_version: '1.0.0',
    };
  }
  if (source.media_type?.includes('html')) return extractHtmlDocument(source, limits);
  const diagnostic = toDiagnostic(
    'unsupported_media_type',
    `The synchronous extractor supports HTML only; use extractDocumentAsync for '${mediaType}'.`,
  );
  return {
    source,
    status: 'unsupported',
    capability_state: deriveCapabilityState('unsupported', [diagnostic]),
    remediation_state: deriveRemediationState('unsupported', [diagnostic]),
    blocks: [],
    warnings: [toWarning(diagnostic)],
    diagnostics: [diagnostic],
    extractor: 'generic',
    extractor_version: '1.0.0',
  };
};

export const extractDocumentAsync = async (
  source: CapturedSource,
  limits: DocumentExtractionLimits = {},
): Promise<ExtractedDocument> => {
  if (source.media_type === 'application/pdf') return extractPdfDocument(source, limits);
  return extractDocument(source, limits);
};

export const extractDocumentFromRetainedCapture = async (
  capture: SourceCaptureArtifact,
  snapshotStore: SnapshotStore,
  limits: DocumentExtractionLimits = {},
): Promise<ExtractedDocument> => {
  const replay = await replaySourceCaptureSnapshot(capture, snapshotStore);
  if (replay.status !== 'replayed' || !replay.bytes) {
    const code = replay.issue?.code;
    const diagnosticCode: DiagnosticCode =
      code === 'snapshot_missing'
        ? 'source_unavailable'
        : code === 'snapshot_digest_mismatch'
          ? 'corrupt_source'
          : 'failed';
    const diagnostic = toDiagnostic(
      diagnosticCode,
      replay.issue?.message ?? 'Retained source replay failed.',
      false,
    );
    return {
      source: {
        requested_uri: capture.requested_uri,
        final_uri: capture.final_uri ?? capture.requested_uri,
        media_type: capture.media_type,
        retrieved_at: capture.retrieved_at,
        body: { bytes: new Uint8Array() },
        content_hash: capture.content_digest,
      },
      status: diagnosticCode,
      capability_state: deriveCapabilityState(diagnosticCode, [diagnostic]),
      remediation_state: deriveRemediationState(diagnosticCode, [diagnostic]),
      blocks: [],
      warnings: [toWarning(diagnostic)],
      diagnostics: [diagnostic],
      extractor: 'retained-source-replay',
      extractor_version: '1.0.0',
    };
  }
  const source: CapturedSource = {
    requested_uri: capture.requested_uri,
    final_uri: capture.final_uri ?? capture.requested_uri,
    media_type: capture.media_type,
    retrieved_at: capture.retrieved_at,
    body: { bytes: replay.bytes },
    content_hash: capture.content_digest,
  };
  return extractDocumentAsync(source, limits);
};

export const extractDocumentArtifactFromRetainedCapture = async (
  capture: SourceCaptureArtifact,
  sourceAcquisition: ArtifactReference<'source_acquisition'>,
  snapshotStore: SnapshotStore,
  options: Omit<DocumentExtractionArtifactOptions, 'source_acquisition'> = {},
  limits: DocumentExtractionLimits = {},
): Promise<DocumentExtractionArtifact> => {
  const document = await extractDocumentFromRetainedCapture(capture, snapshotStore, limits);
  const captureReference = artifactReference('source_capture', capture, capture.id);
  return buildDocumentExtractionArtifact(document, captureReference, {
    ...options,
    source_acquisition: sourceAcquisition,
  });
};
