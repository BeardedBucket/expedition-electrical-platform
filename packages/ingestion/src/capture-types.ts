import type {
  ProductFact,
  ProductSource,
  ProductSourceType,
  SourceAuthority,
} from './contracts.js';

export interface CapturedSource {
  readonly requested_uri: string;
  readonly final_uri: string;
  readonly media_type?: string;
  readonly retrieved_at: string;
  readonly response_status?: number;
  readonly redirect_chain?: readonly RedirectHop[];
  readonly title?: string;
  readonly body: {
    readonly bytes: Uint8Array;
    readonly text?: string;
  };
  readonly content_hash?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface RedirectHop {
  readonly requested_uri: string;
  readonly response_status: number;
  readonly location: string;
  readonly destination_uri: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CaptureRequest {
  readonly uri: string;
  readonly retrieved_at?: string;
  readonly timeout_ms?: number;
  readonly max_bytes?: number;
  readonly max_redirects?: number;
  readonly signal?: AbortSignal;
}

export interface CaptureIssue {
  readonly code: string;
  readonly message: string;
}

export interface CaptureResult {
  readonly status: 'success' | 'invalid' | 'failed';
  readonly source?: CapturedSource;
  readonly issues: readonly CaptureIssue[];
}

export interface SourceCaptureAdapter {
  capture(request: CaptureRequest): Promise<CaptureResult>;
}

export interface SourceClassification {
  readonly id: string;
  readonly source_type: ProductSourceType;
  readonly authority: SourceAuthority;
  readonly publisher: string;
  readonly manufacturer?: string;
  readonly schema_version?: string;
}

export type ExtractionStatus =
  | 'extracted'
  | 'partially_extracted'
  | 'no_extractable_content'
  | 'unsupported'
  | 'source_unavailable'
  | 'source_non_authoritative'
  | 'source_empty'
  | 'corrupt_source'
  | 'failed';

export type ExtractionCapabilityState =
  | 'automatic_extraction_available'
  | 'capability_not_implemented'
  | 'capability_not_enabled'
  | 'no_known_automatic_path'
  | 'unknown';

export type ExtractionRemediationState =
  | 'none_required'
  | 'implementation_required'
  | 'enable_capability'
  | 'source_reacquisition_required'
  | 'source_repair_required'
  | 'human_review_required';

export type DocumentItemKind =
  | 'document_title'
  | 'heading'
  | 'paragraph'
  | 'list_item'
  | 'definition_term'
  | 'definition_value'
  | 'table'
  | 'table_caption'
  | 'table_header'
  | 'table_row'
  | 'table_cell'
  | 'figure_caption'
  | 'note'
  | 'text_block'
  | 'link_reference'
  | 'unknown_text'
  | 'definition'
  | 'list';

export type DiagnosticCode =
  | 'unsupported_media_type'
  | 'missing_text_body'
  | 'snapshot_missing'
  | 'snapshot_digest_mismatch'
  | 'parser_failure'
  | 'no_extractable_text'
  | 'likely_image_only'
  | 'malformed_html_structure'
  | 'table_extraction_unsupported'
  | 'partial_table_extraction'
  | 'unsupported_embedded_content'
  | 'pdf_unsupported'
  | 'source_unavailable'
  | 'source_non_authoritative'
  | 'source_empty'
  | 'corrupt_source'
  | 'failed'
  | 'input_limit_reached'
  | 'item_limit_reached'
  | 'table_cell_limit_reached'
  | 'page_limit_reached'
  | 'text_limit_reached'
  | 'snapshot_read_failure';

export interface ExtractionSourceLocation {
  readonly kind: 'html' | 'pdf' | 'generic';
  readonly path?: string;
  readonly fragment?: string;
  readonly section?: string;
  readonly page?: number;
  readonly ordinal?: number;
  readonly row?: number;
  readonly column?: number;
  readonly table?: string;
}

export interface ExtractionDiagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly recoverable?: boolean;
}

export interface ExtractedBlock {
  readonly id?: string;
  readonly kind: DocumentItemKind;
  readonly text: string;
  readonly heading_level?: number;
  readonly section?: string;
  readonly locator: {
    readonly fragment: string;
    readonly section?: string;
    readonly table?: string;
    readonly row?: string;
    readonly paragraph?: string;
    readonly path?: string;
    readonly page?: number;
    readonly column?: number;
  };
  readonly rows?: readonly {
    readonly label: string;
    readonly value: string;
    readonly row?: number;
    readonly column?: number;
  }[];
  readonly cells?: readonly {
    readonly label: string;
    readonly value: string;
    readonly kind: 'header' | 'data';
    readonly row: number;
    readonly column: number;
    readonly source_location: ExtractionSourceLocation;
  }[];
  readonly source_location?: ExtractionSourceLocation;
}

export interface ExtractedDocument {
  readonly source: CapturedSource;
  readonly title?: string;
  readonly status?: ExtractionStatus;
  readonly capability_state?: ExtractionCapabilityState;
  readonly remediation_state?: ExtractionRemediationState;
  readonly blocks: readonly ExtractedBlock[];
  readonly warnings: readonly CaptureIssue[];
  readonly diagnostics?: readonly ExtractionDiagnostic[];
  readonly page_count?: number;
  readonly extractor?: string;
  readonly extractor_version?: string;
}

export interface FactExtractionResult {
  readonly status: 'success' | 'partial' | 'unsupported' | 'invalid';
  readonly facts: readonly ProductFact[];
  readonly warnings: readonly CaptureIssue[];
}

export interface ProductFactExtractionContext {
  readonly source_id: string;
  readonly schema_version?: string;
  readonly extraction_method?: 'structured' | 'table' | 'text' | 'other';
  readonly include_text_blocks?: boolean;
}

export const createProductSource = (
  captured: CapturedSource,
  classification: SourceClassification,
): ProductSource => ({
  schema_version: classification.schema_version ?? '1.0',
  id: classification.id,
  uri: captured.final_uri,
  source_type: classification.source_type,
  authority: classification.authority,
  publisher: classification.publisher,
  retrieved_at: captured.retrieved_at,
  ...(classification.manufacturer ? { manufacturer: classification.manufacturer } : {}),
  ...(captured.title ? { title: captured.title } : {}),
  ...(captured.content_hash ? { content_hash: captured.content_hash } : {}),
});
