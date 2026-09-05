import type {
  ProductFact,
  ProductSource,
  ProductSourceType,
  SourceAuthority,
} from './contracts.js';

export interface CapturedSource {
  readonly requested_uri: string;
  readonly final_uri: string;
  readonly media_type: string;
  readonly retrieved_at: string;
  readonly response_status?: number;
  readonly title?: string;
  readonly body: {
    readonly bytes: Uint8Array;
    readonly text?: string;
  };
  readonly content_hash?: string;
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

export interface ExtractedBlock {
  readonly kind: 'heading' | 'paragraph' | 'table' | 'definition' | 'list';
  readonly text: string;
  readonly section?: string;
  readonly locator: {
    readonly fragment: string;
    readonly section?: string;
    readonly table?: string;
    readonly row?: string;
  };
  readonly rows?: readonly {
    readonly label: string;
    readonly value: string;
  }[];
}

export interface ExtractedDocument {
  readonly source: CapturedSource;
  readonly title?: string;
  readonly blocks: readonly ExtractedBlock[];
  readonly warnings: readonly CaptureIssue[];
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
