import { validateCaptureUri } from './http-capture.js';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import productionIngestionSchema from '../../../data/schemas/production-ingestion.schema.json' with { type: 'json' };
import type { CanonicalQualifiedValue, JsonObject, JsonValue } from './contracts.js';
import type {
  ExtractionCapabilityState,
  ExtractionRemediationState,
  ExtractedDocument,
  TableCellStructure,
} from './capture-types.js';

export const PRODUCTION_SCHEMA_VERSION = '1.0';
export const PRODUCTION_HASH_ALGORITHM = 'sha256';

type ProductionArtifactValidator = ((_value: unknown) => boolean) & {
  errors?: readonly { instancePath?: string; message?: string }[];
};
const ProductionAjv = Ajv2020 as unknown as new (options?: Record<string, unknown>) => {
  compile: (_schema: unknown) => ProductionArtifactValidator;
};
const productionAjv = new ProductionAjv({ allErrors: true, strict: false, strictNumbers: true });
const registerProductionFormats = addFormats as unknown as (instance: {
  addFormat?: (...args: unknown[]) => void;
}) => void;
registerProductionFormats(productionAjv as unknown as { addFormat?: (...args: unknown[]) => void });
const validateProductionArtifact = productionAjv.compile(productionIngestionSchema);

export const validateProductionArtifactSchema = (value: unknown): readonly string[] =>
  validateProductionArtifact(value)
    ? []
    : ['Artifact does not satisfy production-ingestion schema.'];

export type ArtifactKind =
  | 'product_intake'
  | 'source_resolution'
  | 'source_acquisition'
  | 'source_capture'
  | 'source_revision'
  | 'document_extraction'
  | 'qualified_fact'
  | 'semantic_proposal'
  | 'product_candidate'
  | 'product_source'
  | 'product_fact'
  | 'review_package'
  | 'approval'
  | 'ingestion_job'
  | 'product_run';

export interface ArtifactReference<K extends ArtifactKind = ArtifactKind> {
  readonly kind: K;
  readonly reference_schema_version: string;
  readonly referenced_artifact_schema_version?: string;
  readonly digest: string;
  readonly digest_algorithm: typeof PRODUCTION_HASH_ALGORITHM;
  readonly reference?: string;
}

export type ProductIntakeReference = ArtifactReference<'product_intake'>;
export type SourceAcquisitionReference = ArtifactReference<'source_acquisition'>;
export type ProductCandidateReference = ArtifactReference<'product_candidate'>;
export type SourceReference = ArtifactReference<
  'source_capture' | 'source_revision' | 'product_source'
>;
export type FactReference = ArtifactReference<'qualified_fact' | 'product_fact'>;
export type ProposalReference = ArtifactReference<'semantic_proposal'>;
export type SourceRevisionReference = ArtifactReference<
  'source_capture' | 'source_revision' | 'product_source'
>;
export type SourceRevisionRelationTarget =
  | {
      readonly relation: 'predecessor' | 'supersedes';
      readonly artifact: ArtifactReference<'source_revision'>;
    }
  | {
      readonly relation: 'same_content' | 'related';
      readonly artifact: SourceRevisionReference;
    };

export interface ProductIntake {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'product_intake';
  readonly id: string;
  readonly manufacturer: string;
  readonly product_model: string;
  readonly manufacturer_part_number?: string;
  readonly official_product_uri?: string;
  readonly submitted_at?: string;
  readonly additional_official_source_uris?: readonly string[];
}

export type SourceRole =
  | 'product_page'
  | 'datasheet'
  | 'manual'
  | 'installation_manual'
  | 'technical_manual'
  | 'specification_sheet'
  | 'technical_drawing'
  | 'dimensional_drawing'
  | 'support_article'
  | 'certificate'
  | 'firmware_document'
  | 'unknown';

export type SourceOfficiality = 'official' | 'unresolved' | 'blocked' | 'unofficial';
export type SourceAcquisitionStatus =
  | 'acquired'
  | 'partially_acquired'
  | 'insufficient_sources'
  | 'unresolved_officiality'
  | 'seed_failed'
  | 'blocked'
  | 'failed';
export type SourceCandidateSelectionStatus =
  'discovered' | 'selected' | 'excluded_by_policy' | 'duplicate_uri';
export type SourceCandidateCaptureOutcome =
  'not_attempted' | 'authoritative' | 'non_authoritative' | 'failed';
export type SourceCandidateContentEquivalence = 'unknown' | 'unique' | 'equivalent';
export type SourceDiscoveryMethod =
  | 'seed_page_anchor'
  | 'html_link_element'
  | 'structured_application_state'
  | 'profile_rule'
  | 'maintainer_hint';

export interface SourceDiscoveryProvenance {
  readonly parent_capture_id: string;
  readonly parent_uri: string;
  readonly raw_discovered_uri: string;
  readonly normalized_uri: string;
  readonly method: SourceDiscoveryMethod;
  readonly locator?: string;
  readonly source_label?: string;
  readonly profile_id?: string;
  readonly profile_rule_id?: string;
}

export interface SourceAcquisitionProfileBinding {
  readonly profile_id: string;
  readonly profile_schema_version: string;
  readonly profile_digest: string;
}

export interface SourceAcquisitionCandidate {
  readonly id: string;
  readonly raw_discovered_uri: string;
  readonly normalized_uri: string;
  readonly discovery: SourceDiscoveryProvenance;
  readonly officiality: SourceOfficiality;
  readonly role: SourceRole;
  readonly role_evidence?: readonly string[];
  readonly selection_status: SourceCandidateSelectionStatus;
  readonly capture_outcome: SourceCandidateCaptureOutcome;
  readonly content_equivalence: SourceCandidateContentEquivalence;
  readonly duplicate_of_candidate_id?: string;
  readonly equivalent_content_of_candidate_id?: string;
  readonly capture?: ArtifactReference<'source_capture'>;
  readonly capture_disposition?: CaptureDisposition;
  readonly capture_reason_codes?: readonly CaptureReasonCode[];
  readonly content_digest?: string;
}

export interface SourceAcquisitionArtifact {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'source_acquisition';
  readonly id: string;
  readonly intake: ProductIntakeReference;
  readonly source_resolution?: ArtifactReference<'source_resolution'>;
  readonly seed_capture: ArtifactReference<'source_capture'>;
  readonly profile_binding?: SourceAcquisitionProfileBinding;
  readonly officiality: SourceOfficiality;
  readonly status: SourceAcquisitionStatus;
  readonly candidates: readonly SourceAcquisitionCandidate[];
  readonly unresolved_candidate_ids?: readonly string[];
  readonly blocked_candidate_ids?: readonly string[];
  readonly deterministic_snapshot: string;
}

export type CaptureDisposition = 'authoritative' | 'non_authoritative' | 'failed' | 'empty';
export type RetentionStatus = 'retained' | 'not_retained' | 'not_permitted' | 'unknown';
export type CaptureReasonCode =
  | 'invalid_uri'
  | 'unsupported_scheme'
  | 'blocked_host'
  | 'network_error'
  | 'aborted'
  | 'response_too_large'
  | 'redirect_limit_exceeded'
  | 'invalid_redirect'
  | 'missing_body'
  | 'http_status'
  | 'content_type_mismatch'
  | 'challenge_detected'
  | 'authentication_wall'
  | 'consent_interstitial'
  | 'soft_404'
  | 'empty_content'
  | 'expected_content_missing'
  | 'snapshot_write_failure'
  | 'snapshot_digest_mismatch';

export interface PersistedRedirectHop {
  readonly requested_uri: string;
  readonly response_status: number;
  readonly location: string;
  readonly destination_uri: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface SourceCaptureArtifact {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'source_capture';
  readonly id: string;
  readonly requested_uri: string;
  readonly final_uri?: string;
  readonly retrieved_at: string;
  readonly media_type?: string;
  readonly response_status?: number;
  readonly disposition: CaptureDisposition;
  readonly redirect_chain?: readonly PersistedRedirectHop[];
  readonly reason_codes?: readonly CaptureReasonCode[];
  readonly content_digest?: string;
  readonly digest_algorithm?: typeof PRODUCTION_HASH_ALGORITHM;
  readonly snapshot?: ArtifactReference;
  readonly retention_status: RetentionStatus;
  readonly source_provenance?: JsonObject;
  readonly document_revision?: string;
  readonly publication_date?: string;
  readonly etag?: string;
  readonly last_modified?: string;
}

export type SourceRevisionRelation = 'predecessor' | 'supersedes' | 'same_content' | 'related';

export interface SourceRevisionArtifact {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'source_revision';
  readonly id: string;
  readonly capture: ArtifactReference<'source_capture'>;
  readonly content_digest: string;
  readonly digest_algorithm: typeof PRODUCTION_HASH_ALGORITHM;
  readonly relations?: readonly SourceRevisionRelationTarget[];
}

export type DocumentBlockKind =
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
  | 'list'
  | 'text'
  | 'structured'
  | 'unsupported'
  | 'unresolved';

export type DocumentExtractionStatus =
  | 'extracted'
  | 'partially_extracted'
  | 'no_extractable_content'
  | 'unsupported'
  | 'source_unavailable'
  | 'source_non_authoritative'
  | 'source_empty'
  | 'corrupt_source'
  | 'failed'
  | 'input_limit_reached'
  | 'item_limit_reached'
  | 'table_cell_limit_reached'
  | 'text_limit_reached'
  | 'snapshot_read_failure';

export type DocumentDiagnosticCode =
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
  | 'page_limit_reached'
  | 'text_limit_reached'
  | 'snapshot_read_failure';

export interface DocumentSourceLocation {
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

export interface DocumentDiagnostic {
  readonly code: DocumentDiagnosticCode;
  readonly message: string;
  readonly recoverable?: boolean;
}

export interface DocumentBlock {
  readonly id: string;
  readonly kind: DocumentBlockKind;
  readonly locator: DocumentSourceLocation;
  readonly content?: string;
  readonly heading_level?: number;
  readonly rows?: readonly { readonly label: string; readonly value: string }[];
  readonly cells?: readonly (TableCellStructure & {
    readonly label: string;
    readonly value: string;
    readonly kind: 'header' | 'data';
    readonly row: number;
    readonly column: number;
    readonly source_location: DocumentSourceLocation;
  })[];
  readonly reason?: string;
  readonly source_location?: DocumentSourceLocation;
}

export type DocumentCapabilityState = ExtractionCapabilityState;
export type DocumentRemediationState = ExtractionRemediationState;

export interface DocumentExtractionArtifact {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'document_extraction';
  readonly id: string;
  readonly source_capture: ArtifactReference<'source_capture'>;
  readonly source_acquisition: ArtifactReference<'source_acquisition'>;
  readonly acquisition_candidate_id?: string;
  readonly observed_media_type?: string;
  readonly title?: string;
  readonly page_count?: number;
  readonly status: DocumentExtractionStatus;
  readonly capability_state: DocumentCapabilityState;
  readonly remediation_state: DocumentRemediationState;
  readonly extractor: string;
  readonly extractor_version: string;
  readonly diagnostics?: readonly DocumentDiagnostic[];
  readonly blocks: readonly DocumentBlock[];
}

export interface DocumentExtractionArtifactOptions {
  readonly source_acquisition: ArtifactReference<'source_acquisition'>;
  readonly acquisition_candidate_id?: string;
  readonly source_authoritative?: boolean;
}

const documentLocation = (
  location: ExtractedDocument['blocks'][number]['source_location'],
  locator: ExtractedDocument['blocks'][number]['locator'],
): DocumentSourceLocation => ({
  kind: location?.kind ?? 'generic',
  ...((location?.path ?? locator.path) ? { path: location?.path ?? locator.path } : {}),
  ...((location?.fragment ?? locator.fragment)
    ? { fragment: location?.fragment ?? locator.fragment }
    : {}),
  ...((location?.section ?? locator.section)
    ? { section: location?.section ?? locator.section }
    : {}),
  ...((location?.page ?? locator.page) ? { page: location?.page ?? locator.page } : {}),
  ...(location?.ordinal !== undefined ? { ordinal: location.ordinal } : {}),
  ...(location?.row !== undefined ? { row: location.row } : {}),
  ...((location?.column ?? locator.column) ? { column: location?.column ?? locator.column } : {}),
  ...((location?.table ?? locator.table) ? { table: location?.table ?? locator.table } : {}),
});

const inferCapabilityState = (
  status: DocumentExtractionStatus | undefined,
  diagnostics: readonly DocumentDiagnostic[] | undefined,
): DocumentCapabilityState => {
  const hasHumanReviewIndicator = diagnostics?.some((diagnostic) =>
    ['likely_image_only', 'no_extractable_text'].includes(diagnostic.code),
  );
  switch (status) {
    case 'extracted':
      return 'automatic_extraction_available';
    case 'partially_extracted':
      return hasHumanReviewIndicator ? 'capability_not_enabled' : 'automatic_extraction_available';
    case 'unsupported':
      return diagnostics?.some((diagnostic) =>
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
      return diagnostics?.some((diagnostic) => diagnostic.code === 'snapshot_missing')
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

const inferRemediationState = (
  status: DocumentExtractionStatus | undefined,
  diagnostics: readonly DocumentDiagnostic[] | undefined,
): DocumentRemediationState => {
  const hasHumanReviewIndicator = diagnostics?.some((diagnostic) =>
    ['likely_image_only', 'no_extractable_text'].includes(diagnostic.code),
  );
  switch (status) {
    case 'extracted':
      return 'none_required';
    case 'partially_extracted':
      return hasHumanReviewIndicator ? 'human_review_required' : 'none_required';
    case 'unsupported':
      return diagnostics?.some((diagnostic) =>
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
      return diagnostics?.some((diagnostic) => diagnostic.code === 'snapshot_missing')
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

export const buildDocumentExtractionArtifact = (
  document: ExtractedDocument,
  sourceCapture: ArtifactReference<'source_capture'>,
  options: DocumentExtractionArtifactOptions,
): DocumentExtractionArtifact => {
  const status =
    options.source_authoritative === false
      ? 'source_non_authoritative'
      : (document.status ?? (document.blocks.length ? 'extracted' : 'partially_extracted'));
  const capability_state =
    document.capability_state ?? inferCapabilityState(status, document.diagnostics);
  const remediation_state =
    document.remediation_state ?? inferRemediationState(status, document.diagnostics);
  const identity = artifactDigest({
    source_capture: sourceCapture.digest,
    source_acquisition: options.source_acquisition.digest,
    acquisition_candidate_id: options.acquisition_candidate_id,
    extractor: document.extractor ?? 'unknown',
    extractor_version: document.extractor_version ?? 'unknown',
    status,
    capability_state,
    remediation_state,
    observed_media_type: document.source.media_type,
    title: document.title,
    page_count: document.page_count,
    diagnostics: document.diagnostics,
    blocks: document.blocks,
  });
  return {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'document_extraction',
    id: `document-extraction.${identity.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    source_capture: sourceCapture,
    source_acquisition: options.source_acquisition,
    ...(options.acquisition_candidate_id
      ? { acquisition_candidate_id: options.acquisition_candidate_id }
      : {}),
    ...(document.source.media_type ? { observed_media_type: document.source.media_type } : {}),
    ...(document.title ? { title: document.title } : {}),
    ...(document.page_count !== undefined ? { page_count: document.page_count } : {}),
    status,
    capability_state,
    remediation_state,
    extractor: document.extractor ?? 'unknown',
    extractor_version: document.extractor_version ?? 'unknown',
    ...(document.diagnostics?.length ? { diagnostics: document.diagnostics } : {}),
    blocks: document.blocks.map((block) => ({
      id: block.id ?? `block.${identity}`,
      kind: block.kind,
      locator: documentLocation(block.source_location, block.locator),
      content: block.text,
      ...(block.heading_level !== undefined ? { heading_level: block.heading_level } : {}),
      ...(block.rows?.length
        ? { rows: block.rows.map(({ label, value }) => ({ label, value })) }
        : {}),
      ...(block.cells?.length
        ? {
            cells: block.cells.map((cell) => ({
              label: cell.label,
              value: cell.value,
              kind: cell.kind,
              ...(cell.colspan !== undefined ? { colspan: cell.colspan } : {}),
              ...(cell.rowspan !== undefined ? { rowspan: cell.rowspan } : {}),
              ...(cell.scope !== undefined ? { scope: cell.scope } : {}),
              ...(cell.inline_segments !== undefined
                ? { inline_segments: cell.inline_segments }
                : {}),
              row: cell.row,
              column: cell.column,
              source_location: cell.source_location,
            })),
          }
        : {}),
      ...(block.source_location
        ? { source_location: documentLocation(block.source_location, block.locator) }
        : {}),
    })),
  };
};

export type IdentityQualificationKind =
  | 'exact_product'
  | 'exact_mpn_or_sku'
  | 'named_variant'
  | 'family'
  | 'document_global'
  | 'explicitly_multiple_products'
  | 'unresolved';

export type LegacyApplicabilityKind =
  'exact_sku' | 'model' | 'variant' | 'hardware_revision' | 'not_applicable';

export type ApplicabilityKind = IdentityQualificationKind | LegacyApplicabilityKind;

export interface ApplicabilityBinding {
  readonly kind: ApplicabilityKind;
  readonly value?: string;
  readonly reason?: string;
}

export type QualifiedFactEvidenceRole =
  'value' | 'label' | 'subject' | 'applicability' | 'qualifier' | 'context';

export interface QualifiedFactEvidence {
  readonly role: QualifiedFactEvidenceRole;
  readonly source_reference?: ArtifactReference<
    'document_extraction' | 'source_capture' | 'source_acquisition'
  >;
  readonly block_id?: string;
  readonly cell_id?: string;
  readonly locator?: DocumentSourceLocation;
  readonly text?: string;
  readonly note?: string;
}

export type QualifiedFactQualificationState =
  'exact' | 'structurally_supported' | 'ambiguous' | 'unresolved' | 'rejected';

export interface QualifiedFactMetadata {
  readonly source_wording: string;
  /**
   * The exact manufacturer label / structural statement identity that excludes
   * the value being asserted (e.g. the extracted label or table header only).
   * This field exists so reconciliation can group facts for comparison without
   * risking that a value-bearing `source_wording` accidentally separates two
   * facts that assert different values for the same manufacturer statement.
   * `source_wording` is preserved unchanged as broader source evidence; this
   * field is not a replacement for it and may be absent when no safe
   * value-independent label could be established.
   */
  readonly source_label?: string;
  readonly raw_value: JsonValue;
  readonly source_unit?: string;
  readonly conditions?: readonly string[];
  readonly duration?: string;
  readonly temperature_context?: string;
  readonly applicability: ApplicabilityBinding;
  readonly revision_context?: string;
  readonly derived_value?: JsonValue;
  readonly derivation?: string;
  readonly alternative_interpretations?: readonly string[];
  readonly raw_identifier?: string;
  readonly normalized_identifier?: string;
  readonly normalization_method?: string;
}

export interface QualifiedFactArtifact {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'qualified_fact';
  readonly id: string;
  readonly source_capture: ArtifactReference;
  readonly source_acquisition?: ArtifactReference<'source_acquisition'>;
  readonly document_extraction?: ArtifactReference<'document_extraction'>;
  readonly acquisition_candidate_id?: string;
  readonly metadata: QualifiedFactMetadata;
  readonly evidence?: readonly QualifiedFactEvidence[];
  readonly qualifier?: string;
  readonly qualifier_version?: string;
  readonly qualification_state?: QualifiedFactQualificationState;
}

export type QualificationOutcome =
  | 'qualified'
  | 'no_qualifiable_facts'
  | 'source_incomplete'
  | 'identity_unresolved'
  | 'identity_mismatch'
  | 'non_authoritative_source'
  | 'qualification_failed';

export interface QualificationDiagnostic {
  readonly code:
    | 'missing_value'
    | 'missing_label'
    | 'source_not_qualifiable'
    | 'unsupported_structure'
    | 'partial_source'
    | 'non_authoritative_source'
    | 'identity_mismatch'
    | 'identity_unresolved'
    | 'applicability_unresolved';
  readonly message: string;
}

export interface DocumentQualificationResult {
  readonly outcome: QualificationOutcome;
  readonly completeness: 'complete' | 'partial' | 'incomplete';
  readonly facts: readonly QualifiedFactArtifact[];
  readonly diagnostics: readonly QualificationDiagnostic[];
}

export interface DocumentQualificationTarget {
  readonly manufacturer_part_number?: string;
  readonly product_model?: string;
  readonly target_identifier?: string;
}

export type ProposalDisposition =
  | 'mapped'
  | 'evidence_only'
  | 'ambiguous'
  | 'unresolved'
  | 'conflicting'
  | 'unsupported'
  | 'rejected';

export interface ProposalProvenance {
  readonly method: 'rule' | 'machine' | 'human' | 'other';
  readonly rule_version?: string;
  readonly provider?: string;
  readonly provider_version?: string;
  readonly rationale?: string;
}

export interface SemanticProposal {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'semantic_proposal';
  readonly id: string;
  readonly target: string;
  readonly proposed_value?: JsonValue;
  readonly qualified_value?: CanonicalQualifiedValue;
  readonly evidence_refs: readonly ArtifactReference[];
  readonly fact_refs?: readonly ArtifactReference[];
  readonly disposition: ProposalDisposition;
  readonly alternatives?: readonly {
    readonly value?: JsonValue;
    readonly rationale: string;
  }[];
  readonly provenance: ProposalProvenance;
  readonly input_artifact_digests: readonly string[];
}

export interface ReviewPackage {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'review_package';
  readonly id: string;
  readonly intake: ProductIntakeReference;
  readonly source_resolution?: ArtifactReference<'source_resolution'>;
  readonly candidate?: ProductCandidateReference;
  readonly source_refs: readonly SourceReference[];
  readonly fact_refs: readonly FactReference[];
  readonly applicability?: readonly ApplicabilityBinding[];
  readonly proposal_refs: readonly ProposalReference[];
  readonly topology_proposal_refs?: readonly ProposalReference[];
  readonly unresolved_items?: readonly string[];
  readonly conflicts?: readonly string[];
  readonly assumptions?: readonly string[];
  readonly semantic_snapshot: string;
  readonly prior_reviewed_revision?: ArtifactReference;
  readonly semantic_diff?: JsonValue;
}

export type ApprovalDecision = 'approved' | 'rejected' | 'deferred';

/** Human selections for a later new-product promotion review. */
export interface ProductionPromotionDecisions {
  readonly approved_fields: readonly string[];
  readonly approved_qualified_value_ids?: readonly string[];
  readonly excluded_fields?: readonly string[];
  readonly excluded_fact_ids?: readonly string[];
  readonly reviewed_evidence_fact_ids?: readonly string[];
  readonly field_resolutions?: Readonly<
    Record<string, { readonly selected_fact_id: string; readonly rationale: string }>
  >;
  readonly topology_evidence?: Readonly<Record<string, readonly string[]>>;
  readonly evidence_acknowledged: boolean;
  readonly product_role: string;
  readonly category: string;
}

export interface ProductionApproval {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'approval';
  readonly id: string;
  readonly review_package: ArtifactReference<'review_package'>;
  readonly review_package_snapshot: string;
  readonly semantic_snapshot: string;
  readonly reviewer_id: string;
  readonly decision: ApprovalDecision;
  readonly reviewed_at: string;
  readonly reviewed_decisions?: readonly string[];
  readonly promotion_decisions?: ProductionPromotionDecisions;
}

export type ProductRunState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'promotable'
  | 'unresolved_awaiting_human_review'
  | 'insufficient_evidence'
  | 'conflicting_evidence'
  | 'existing_product_update'
  | 'blocked'
  | 'failed';

export interface ProductRun {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'product_run';
  readonly id: string;
  readonly intake: ProductIntakeReference;
  readonly state: ProductRunState;
  readonly current_stage?: string;
  readonly attempt: number;
  readonly retryable?: boolean;
  readonly artifact_refs: readonly ArtifactReference[];
  readonly input_hash?: string;
  readonly output_hash?: string;
  readonly failure_code?: string;
}

export interface IngestionJob {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'ingestion_job';
  readonly id: string;
  readonly created_at: string;
  readonly state: 'queued' | 'running' | 'completed' | 'failed' | 'partially_completed';
  readonly product_runs: readonly ArtifactReference<'product_run'>[];
  readonly manifest_ref?: ArtifactReference;
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
};

export const deterministicSerialize = (value: unknown): string =>
  JSON.stringify(stableValue(value));

export const artifactDigest = (value: unknown): string =>
  `${PRODUCTION_HASH_ALGORITHM}:${createHash(PRODUCTION_HASH_ALGORITHM)
    .update(deterministicSerialize(value), 'utf8')
    .digest('hex')}`;

export const artifactReference = <K extends ArtifactKind, T extends object>(
  kind: K,
  value: T,
  reference?: string,
  referencedArtifactSchemaVersion?: string,
): ArtifactReference<K> => ({
  kind,
  reference_schema_version: PRODUCTION_SCHEMA_VERSION,
  digest: artifactDigest(value),
  digest_algorithm: PRODUCTION_HASH_ALGORITHM,
  ...(reference ? { reference } : {}),
  ...(referencedArtifactSchemaVersion
    ? { referenced_artifact_schema_version: referencedArtifactSchemaVersion }
    : {}),
});

export const hasArtifactKind = <K extends ArtifactKind>(
  reference: ArtifactReference,
  expected: K,
): reference is ArtifactReference<K> => reference.kind === expected;

export const sourceContentIdentity = (
  capture: Pick<SourceCaptureArtifact, 'content_digest'>,
): string | undefined => capture.content_digest;

export const buildQualifiedFactArtifact = ({
  source_capture,
  source_acquisition,
  document_extraction,
  acquisition_candidate_id,
  metadata,
  evidence,
  qualifier = 'production-qualified-fact',
  qualifier_version = PRODUCTION_SCHEMA_VERSION,
  qualification_state = 'structurally_supported',
}: {
  readonly source_capture: ArtifactReference<'source_capture'>;
  readonly source_acquisition?: ArtifactReference<'source_acquisition'>;
  readonly document_extraction?: ArtifactReference<'document_extraction'>;
  readonly acquisition_candidate_id?: string;
  readonly metadata: QualifiedFactMetadata;
  readonly evidence?: readonly QualifiedFactEvidence[];
  readonly qualifier?: string;
  readonly qualifier_version?: string;
  readonly qualification_state?: QualifiedFactQualificationState;
}): QualifiedFactArtifact => {
  const artifact: QualifiedFactArtifact = {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'qualified_fact',
    id: `qualified-fact.${artifactDigest({
      source_capture: source_capture.digest,
      source_acquisition: source_acquisition?.digest,
      document_extraction: document_extraction?.digest,
      acquisition_candidate_id,
      metadata,
      evidence,
      qualifier,
      qualifier_version,
      qualification_state,
    }).slice('sha256:'.length, 'sha256:'.length + 24)}`,
    source_capture,
    ...(source_acquisition ? { source_acquisition } : {}),
    ...(document_extraction ? { document_extraction } : {}),
    ...(acquisition_candidate_id ? { acquisition_candidate_id } : {}),
    metadata,
    ...(evidence?.length ? { evidence } : {}),
    qualifier,
    qualifier_version,
    qualification_state,
  };
  return artifact;
};

export const validateQualifiedFact = (fact: QualifiedFactArtifact): readonly string[] => {
  const issues: string[] = [];
  if (fact.artifact_kind !== 'qualified_fact')
    issues.push('qualified fact artifact_kind must be qualified_fact');
  if (fact.schema_version !== PRODUCTION_SCHEMA_VERSION)
    issues.push('qualified fact schema_version is not supported');
  if (!/^qualified-fact\.[a-f0-9]{24}$/.test(fact.id))
    issues.push('qualified fact id is not a deterministic qualified fact ID');
  if (!fact.source_capture || fact.source_capture.kind !== 'source_capture')
    issues.push('qualified fact requires a source_capture reference');
  if (
    fact.source_acquisition !== undefined &&
    fact.source_acquisition.kind !== 'source_acquisition'
  )
    issues.push('qualified fact source_acquisition must reference source_acquisition');
  if (
    fact.document_extraction !== undefined &&
    fact.document_extraction.kind !== 'document_extraction'
  )
    issues.push('qualified fact document_extraction must reference document_extraction');
  if (!fact.metadata?.source_wording || !fact.metadata.source_wording.trim())
    issues.push('qualified fact source_wording is required');
  if (fact.metadata?.source_label !== undefined && !fact.metadata.source_label.trim())
    issues.push('qualified fact source_label must be non-empty when present');
  if (fact.metadata?.raw_value === undefined) issues.push('qualified fact raw_value is required');
  const validApplicabilityKinds = new Set<ApplicabilityKind>([
    'exact_product',
    'exact_mpn_or_sku',
    'named_variant',
    'family',
    'document_global',
    'explicitly_multiple_products',
    'unresolved',
    'exact_sku',
    'model',
    'variant',
    'hardware_revision',
    'not_applicable',
  ]);
  if (!validApplicabilityKinds.has(fact.metadata.applicability.kind))
    issues.push('qualified fact applicability.kind is not recognized');
  if (fact.qualification_state !== undefined) {
    const validStates = new Set<QualifiedFactQualificationState>([
      'exact',
      'structurally_supported',
      'ambiguous',
      'unresolved',
      'rejected',
    ]);
    if (!validStates.has(fact.qualification_state))
      issues.push('qualified fact qualification_state is not recognized');
  }
  fact.evidence?.forEach((evidence, index) => {
    if (
      !['value', 'label', 'subject', 'applicability', 'qualifier', 'context'].includes(
        evidence.role,
      )
    )
      issues.push(`evidence[${index}].role is not recognized`);
    if (
      evidence.source_reference &&
      !['document_extraction', 'source_capture', 'source_acquisition'].includes(
        evidence.source_reference.kind,
      )
    )
      issues.push(`evidence[${index}].source_reference.kind is not recognized`);
  });
  return issues;
};

export const validateSourceCapture = (capture: SourceCaptureArtifact): readonly string[] => {
  const issues: string[] = [];
  if (capture.retention_status === 'retained' && capture.snapshot === undefined)
    issues.push('retained captures require a snapshot reference');
  if (capture.retention_status !== 'retained' && capture.snapshot !== undefined)
    issues.push('non-retained captures cannot have a snapshot reference');
  if (
    (capture.disposition === 'authoritative' || capture.disposition === 'non_authoritative') &&
    capture.content_digest === undefined
  )
    issues.push('captured content requires a digest');
  const rejectionReasons = new Set<CaptureReasonCode>([
    'content_type_mismatch',
    'challenge_detected',
    'authentication_wall',
    'consent_interstitial',
    'soft_404',
    'empty_content',
    'expected_content_missing',
  ]);
  if (
    capture.disposition === 'authoritative' &&
    capture.reason_codes?.some((reason) => rejectionReasons.has(reason))
  )
    issues.push('authoritative captures cannot carry content rejection reasons');
  return issues;
};

export const validateSourceAcquisition = (
  acquisition: SourceAcquisitionArtifact,
): readonly string[] => {
  const issues: string[] = [];
  if (acquisition.artifact_kind !== 'source_acquisition')
    issues.push('source acquisition artifact_kind must be source_acquisition');
  if (!acquisition.seed_capture || acquisition.seed_capture.kind !== 'source_capture')
    issues.push('source acquisition requires a source_capture seed reference');
  if (!acquisition.deterministic_snapshot.startsWith(`${PRODUCTION_HASH_ALGORITHM}:`))
    issues.push('source acquisition deterministic_snapshot must be a sha256 digest');
  if (
    acquisition.profile_binding &&
    (!acquisition.profile_binding.profile_id ||
      !acquisition.profile_binding.profile_schema_version ||
      !acquisition.profile_binding.profile_digest.startsWith(`${PRODUCTION_HASH_ALGORITHM}:`))
  )
    issues.push('source acquisition profile_binding must identify a digest-bound reviewed profile');
  const ids = acquisition.candidates.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length)
    issues.push('source acquisition candidate IDs must be unique');
  const candidateIds = new Set(ids);
  acquisition.candidates.forEach((candidate) => {
    if (
      candidate.capture_outcome === 'not_attempted' &&
      (candidate.capture !== undefined || candidate.capture_disposition !== undefined)
    )
      issues.push(`unattempted candidate '${candidate.id}' cannot carry capture evidence`);
    if (
      candidate.capture_outcome !== 'not_attempted' &&
      (!candidate.capture || candidate.capture_disposition === undefined)
    )
      issues.push(`captured candidate '${candidate.id}' requires capture evidence`);
    if (
      candidate.capture_outcome === 'authoritative' &&
      candidate.capture_disposition !== 'authoritative'
    )
      issues.push(`authoritative candidate '${candidate.id}' requires authoritative disposition`);
    if (
      candidate.capture_outcome === 'non_authoritative' &&
      candidate.capture_disposition !== 'non_authoritative'
    )
      issues.push(
        `non-authoritative candidate '${candidate.id}' requires non-authoritative disposition`,
      );
    if (
      candidate.capture_outcome === 'failed' &&
      candidate.capture_disposition !== 'failed' &&
      candidate.capture_disposition !== 'empty'
    )
      issues.push(`failed candidate '${candidate.id}' requires failed or empty disposition`);
    if (candidate.selection_status === 'duplicate_uri' && !candidate.duplicate_of_candidate_id)
      issues.push(`duplicate candidate '${candidate.id}' requires a duplicate reference`);
    if (
      candidate.duplicate_of_candidate_id &&
      !candidateIds.has(candidate.duplicate_of_candidate_id)
    )
      issues.push(`duplicate candidate '${candidate.id}' references an unknown candidate`);
    if (
      candidate.content_equivalence === 'equivalent' &&
      !candidate.equivalent_content_of_candidate_id
    )
      issues.push(`equivalent candidate '${candidate.id}' requires an equivalence reference`);
    if (
      candidate.equivalent_content_of_candidate_id &&
      !candidateIds.has(candidate.equivalent_content_of_candidate_id)
    )
      issues.push(`equivalent candidate '${candidate.id}' references an unknown candidate`);
  });
  return issues;
};

export const validateDocumentExtraction = (
  artifact: DocumentExtractionArtifact,
): readonly string[] => {
  const issues: string[] = [];
  const statuses = new Set<DocumentExtractionStatus>([
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
  const capabilityStates = new Set<DocumentCapabilityState>([
    'automatic_extraction_available',
    'capability_not_implemented',
    'capability_not_enabled',
    'no_known_automatic_path',
    'unknown',
  ]);
  const remediationStates = new Set<DocumentRemediationState>([
    'none_required',
    'implementation_required',
    'enable_capability',
    'source_reacquisition_required',
    'source_repair_required',
    'human_review_required',
  ]);
  const diagnosticCodes = new Set<DocumentDiagnosticCode>([
    'unsupported_media_type',
    'missing_text_body',
    'snapshot_missing',
    'snapshot_digest_mismatch',
    'parser_failure',
    'no_extractable_text',
    'likely_image_only',
    'malformed_html_structure',
    'table_extraction_unsupported',
    'partial_table_extraction',
    'unsupported_embedded_content',
    'pdf_unsupported',
    'source_unavailable',
    'source_non_authoritative',
    'source_empty',
    'corrupt_source',
    'failed',
    'input_limit_reached',
    'item_limit_reached',
    'table_cell_limit_reached',
    'text_limit_reached',
    'snapshot_read_failure',
  ]);
  const blockKinds = new Set<DocumentBlockKind>([
    'document_title',
    'heading',
    'paragraph',
    'list_item',
    'definition_term',
    'definition_value',
    'table',
    'table_caption',
    'table_header',
    'table_row',
    'table_cell',
    'figure_caption',
    'note',
    'text_block',
    'link_reference',
    'unknown_text',
    'definition',
    'list',
    'text',
    'structured',
    'unsupported',
    'unresolved',
  ]);
  const validateLocation = (location: DocumentSourceLocation | undefined, path: string): void => {
    if (!location) return;
    if (!['html', 'pdf', 'generic'].includes(location.kind))
      issues.push(`${path}.kind is not recognized`);
    for (const [name, value] of [
      ['page', location.page],
      ['ordinal', location.ordinal],
      ['row', location.row],
      ['column', location.column],
    ] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1))
        issues.push(`${path}.${name} must be a positive integer`);
    }
  };
  if (artifact.artifact_kind !== 'document_extraction') {
    issues.push('document extraction artifact_kind must be document_extraction');
  }
  if (artifact.schema_version !== PRODUCTION_SCHEMA_VERSION)
    issues.push('document extraction schema_version is not supported');
  if (!/^document-extraction\.[a-f0-9]{24}$/.test(artifact.id))
    issues.push('document extraction id is not a deterministic extraction ID');
  if (!artifact.source_capture || artifact.source_capture.kind !== 'source_capture') {
    issues.push('document extraction requires a source_capture reference');
  }
  if (
    artifact.source_acquisition !== undefined &&
    artifact.source_acquisition.kind !== 'source_acquisition'
  )
    issues.push('document extraction source_acquisition must reference source_acquisition');
  if (
    artifact.acquisition_candidate_id !== undefined &&
    !/^[A-Za-z0-9._-]+$/.test(artifact.acquisition_candidate_id)
  )
    issues.push('document extraction acquisition_candidate_id has invalid shape');
  if (!artifact.extractor.trim() || !artifact.extractor_version.trim()) {
    issues.push('document extraction requires extractor identity and version');
  }
  if (!statuses.has(artifact.status)) {
    issues.push('document extraction status is not recognized');
  }
  if (artifact.capability_state !== undefined && !capabilityStates.has(artifact.capability_state)) {
    issues.push('document extraction capability_state is not recognized');
  }
  if (
    artifact.remediation_state !== undefined &&
    !remediationStates.has(artifact.remediation_state)
  ) {
    issues.push('document extraction remediation_state is not recognized');
  }
  artifact.diagnostics?.forEach((diagnostic, index) => {
    if (!diagnostic.message.trim()) issues.push(`diagnostics[${index}].message is required`);
    if (!diagnosticCodes.has(diagnostic.code))
      issues.push(`diagnostics[${index}].code is not recognized`);
  });
  artifact.blocks.forEach((block, index) => {
    if (!block.id.trim()) issues.push(`blocks[${index}].id is required`);
    if (!blockKinds.has(block.kind)) issues.push(`blocks[${index}].kind is not recognized`);
    validateLocation(block.locator, `blocks[${index}].locator`);
    validateLocation(block.source_location, `blocks[${index}].source_location`);
    block.cells?.forEach((cell, cellIndex) => {
      const cellPath = `blocks[${index}].cells[${cellIndex}]`;
      if (!['header', 'data'].includes(cell.kind))
        issues.push(`${cellPath}.kind is not recognized`);
      for (const name of ['colspan', 'rowspan'] as const) {
        const span = cell[name];
        if (span !== undefined && (!Number.isSafeInteger(span) || span < 1))
          issues.push(`${cellPath}.${name} must be a positive safe integer`);
      }
      if (cell.scope !== undefined && !['row', 'col', 'rowgroup', 'colgroup'].includes(cell.scope))
        issues.push(`${cellPath}.scope is not recognized`);
      cell.inline_segments?.forEach((segment, segmentIndex) => {
        if (!['text', 'superscript', 'subscript'].includes(segment.kind) || !segment.text.trim())
          issues.push(
            `${cellPath}.inline_segments[${segmentIndex}] requires a known kind and text`,
          );
      });
      if (!Number.isInteger(cell.row) || cell.row < 1)
        issues.push(`blocks[${index}].cells[${cellIndex}].row must be positive`);
      if (!Number.isInteger(cell.column) || cell.column < 1)
        issues.push(`blocks[${index}].cells[${cellIndex}].column must be positive`);
      validateLocation(
        cell.source_location,
        `blocks[${index}].cells[${cellIndex}].source_location`,
      );
    });
  });
  if (artifact.status === 'extracted' && artifact.blocks.length === 0)
    issues.push('extracted document extraction requires blocks');
  if (artifact.status === 'unsupported' && artifact.blocks.length > 0)
    issues.push('unsupported document extraction cannot contain blocks');
  return issues;
};

const normalizeIdentityForComparison = (value?: string): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value.trim();
};

const parseRawValueAndUnit = (
  value: string,
): { readonly raw_value: string; readonly source_unit?: string } => {
  const trimmed = value.trim();
  if (!trimmed) return { raw_value: '' };
  const match = trimmed.match(/^([-+]?\d[\d.,]*)\s*([A-Za-z°%ΩµmWVAJFp]?[A-Za-z°%ΩµmWVAJFp]*)$/);
  if (match) {
    const rawValue = match[1];
    const unit = match[2]?.trim();
    return { raw_value: rawValue, ...(unit ? { source_unit: unit } : {}) };
  }
  return { raw_value: trimmed };
};

const buildEvidence = (
  role: QualifiedFactEvidenceRole,
  text: string,
  document: DocumentExtractionArtifact,
  locator?: DocumentSourceLocation,
): QualifiedFactEvidence => ({
  role,
  text,
  source_reference: document.source_capture,
  locator,
});

const determineApplicability = (
  target: DocumentQualificationTarget,
  rowIdentity?: string,
  explicitSourceIdentity?: string,
): {
  readonly applicability: ApplicabilityBinding;
  readonly diagnostic?: QualificationDiagnostic;
} => {
  const directTarget =
    normalizeIdentityForComparison(target.target_identifier) ??
    normalizeIdentityForComparison(target.manufacturer_part_number) ??
    normalizeIdentityForComparison(target.product_model);

  if (!directTarget) {
    return {
      applicability: { kind: 'unresolved', reason: 'missing target identity' },
      diagnostic: { code: 'identity_unresolved', message: 'target identity is missing' },
    };
  }

  if (typeof explicitSourceIdentity === 'string' && explicitSourceIdentity.trim()) {
    const normalizedSource = normalizeIdentityForComparison(explicitSourceIdentity);
    if (normalizedSource && normalizedSource !== directTarget) {
      return {
        applicability: { kind: 'unresolved', reason: 'explicit source identity mismatch' },
        diagnostic: {
          code: 'identity_mismatch',
          message: `source identity '${normalizedSource}' does not match target '${directTarget}'`,
        },
      };
    }
  }

  if (!rowIdentity) {
    return {
      applicability: { kind: 'unresolved', reason: 'no row-level identity evidence' },
      diagnostic: {
        code: 'applicability_unresolved',
        message: 'no explicit row/identity applicability could be proven',
      },
    };
  }

  const normalizedRow = normalizeIdentityForComparison(rowIdentity);
  if (normalizedRow === directTarget) {
    return {
      applicability: {
        kind:
          target.manufacturer_part_number || target.target_identifier
            ? 'exact_mpn_or_sku'
            : 'exact_product',
        value: directTarget,
      },
    };
  }

  if (normalizedRow && normalizedRow.toLowerCase().startsWith(directTarget.toLowerCase())) {
    return {
      applicability: { kind: 'unresolved', reason: 'prefix-only match is not exact identity' },
      diagnostic: {
        code: 'applicability_unresolved',
        message: 'prefix similarity is not exact target identity',
      },
    };
  }

  return {
    applicability: { kind: 'unresolved', reason: 'target row not matched' },
    diagnostic: {
      code: 'applicability_unresolved',
      message: `row identity '${rowIdentity}' does not match requested target '${directTarget}'`,
    },
  };
};

/** whole-table-product-scope.v1: source DOM spans, never an expanded grid or URL identity. */
const wholeTableProductScope = (
  document: DocumentExtractionArtifact,
  block: DocumentBlock,
  target: DocumentQualificationTarget,
):
  | {
      readonly model: string;
      readonly header: NonNullable<DocumentBlock['cells']>[number];
      readonly width: number;
    }
  | undefined => {
  const model = normalizeIdentityForComparison(target.product_model);
  const cells = block.cells;
  if (
    !model ||
    !cells?.length ||
    target.target_identifier ||
    document.status !== 'extracted' ||
    document.source_acquisition?.kind !== 'source_acquisition' ||
    document.source_capture.kind !== 'source_capture' ||
    block.locator.kind !== 'html' ||
    !block.locator.path ||
    !block.locator.table ||
    document.blocks.some(
      (other) =>
        other !== block &&
        other.kind === 'table' &&
        other.locator.path?.startsWith(`${block.locator.path}/`),
    ) ||
    document.diagnostics?.some((diagnostic) =>
      /limit_reached|partial_table_extraction|snapshot_read_failure/.test(diagnostic.code),
    )
  )
    return undefined;

  const rows = new Map<number, (typeof cells)[number][]>();
  for (const cell of cells) {
    const location = cell.source_location;
    if (
      !Number.isSafeInteger(cell.row) ||
      cell.row < 1 ||
      !Number.isSafeInteger(cell.column) ||
      cell.column < 1 ||
      cell.label.trim() !== cell.value.trim() ||
      location.kind !== 'html' ||
      location.table !== block.locator.table ||
      location.row !== cell.row ||
      location.column !== cell.column ||
      location.path !== `${block.locator.path}/tr[${cell.row}]/cell[${cell.column}]` ||
      (cell.rowspan !== undefined && cell.rowspan !== 1) ||
      (cell.colspan !== undefined && (!Number.isSafeInteger(cell.colspan) || cell.colspan < 1))
    )
      return undefined;
    const row = rows.get(cell.row) ?? [];
    row.push(cell);
    rows.set(cell.row, row);
  }
  const orderedRows = [...rows.entries()].sort(([left], [right]) => left - right);
  if (orderedRows.some(([row], index) => row !== index + 1)) return undefined;
  const titleRow = orderedRows[0][1];
  if (titleRow.length !== 1) return undefined;
  const header = titleRow[0];
  if (
    header.kind !== 'header' ||
    header.column !== 1 ||
    !header.colspan ||
    header.colspan < 2 ||
    (header.scope !== undefined && header.scope !== 'col' && header.scope !== 'colgroup')
  )
    return undefined;

  if (header.inline_segments !== undefined) {
    const [ordinary, ...residual] = header.inline_segments;
    if (
      !ordinary ||
      ordinary.kind !== 'text' ||
      normalizeIdentityForComparison(ordinary.text) !== model ||
      residual.some(
        (segment) => segment.kind !== 'superscript' || !/^\[[1-9]\d*\]$/.test(segment.text),
      ) ||
      normalizeIdentityForComparison(header.value) !==
        header.inline_segments.map((segment) => segment.text).join(' ')
    )
      return undefined;
  } else if (normalizeIdentityForComparison(header.value) !== model) return undefined;

  let width = 0;
  let specifications = 0;
  for (const [, row] of orderedRows.slice(1)) {
    row.sort((left, right) => left.column - right.column);
    if (row.some((cell, index) => cell.column !== index + 1 || cell.kind !== 'data'))
      return undefined;
    const rowWidth = row.reduce((sum, cell) => sum + (cell.colspan ?? 1), 0);
    if (!Number.isSafeInteger(rowWidth) || rowWidth !== header.colspan) return undefined;
    width = Math.max(width, rowWidth);
    // Single full-span data cells are section separators, never specification facts.
    // Multi-value layouts require row/column identity evidence instead of table scope.
    if (row.length !== 1 && (row.length !== 2 || (row[0].colspan ?? 1) !== 1)) return undefined;
    const label = row[0].value.trim();
    if (
      /^(?:manufacturer\s+)?(?:variants?|models?|mpn|sku|part\s*(?:number|no\.?))(?:\b|:)/i.test(
        label,
      )
    )
      return undefined;
    for (const cell of row) {
      const text = cell.value.trim();
      if (
        text === model ||
        text.startsWith(model) ||
        (target.manufacturer_part_number && text === target.manufacturer_part_number.trim())
      )
        return undefined;
    }
    if (row.length === 2) specifications += 1;
  }
  return width === header.colspan && specifications > 0 ? { model, header, width } : undefined;
};

const qualifyFromBlock = (
  document: DocumentExtractionArtifact,
  block: DocumentBlock,
  target: DocumentQualificationTarget,
  qualifiers: { readonly qualifier: string; readonly qualifier_version: string },
): { readonly facts: QualifiedFactArtifact[]; readonly diagnostics: QualificationDiagnostic[] } => {
  const facts: QualifiedFactArtifact[] = [];
  const diagnostics: QualificationDiagnostic[] = [];

  const addFact = (
    label: string,
    value: string,
    rowIdentity?: string,
    explicitSourceIdentity?: string,
    locator?: DocumentSourceLocation,
    evidenceOverride?: readonly QualifiedFactEvidence[],
    scopeBinding?: ApplicabilityBinding,
  ): void => {
    if (!label?.trim()) {
      diagnostics.push({ code: 'missing_label', message: 'a fact label is missing' });
      return;
    }
    if (!value?.trim()) {
      diagnostics.push({ code: 'missing_value', message: `missing raw value for '${label}'` });
      return;
    }
    const { raw_value, source_unit } = parseRawValueAndUnit(value);
    const result = scopeBinding
      ? { applicability: scopeBinding }
      : determineApplicability(target, rowIdentity, explicitSourceIdentity);
    const evidence: QualifiedFactEvidence[] = evidenceOverride
      ? [...evidenceOverride]
      : [
          buildEvidence('label', label, document, locator),
          buildEvidence('value', value, document, locator),
          ...(rowIdentity ? [buildEvidence('subject', rowIdentity, document, locator)] : []),
          ...(explicitSourceIdentity
            ? [buildEvidence('applicability', explicitSourceIdentity, document, locator)]
            : []),
        ];
    const metadata: QualifiedFactMetadata = {
      source_wording: label,
      source_label: label,
      raw_value,
      ...(source_unit ? { source_unit } : {}),
      applicability: result.applicability,
      ...(explicitSourceIdentity ? { raw_identifier: explicitSourceIdentity } : {}),
    };
    facts.push(
      buildQualifiedFactArtifact({
        source_capture: document.source_capture,
        source_acquisition: document.source_acquisition,
        document_extraction: artifactReference('document_extraction', document),
        acquisition_candidate_id: document.acquisition_candidate_id,
        metadata,
        evidence,
        qualifier: qualifiers.qualifier,
        qualifier_version: qualifiers.qualifier_version,
        qualification_state: 'structurally_supported',
      }),
    );
    if (result.diagnostic) diagnostics.push(result.diagnostic);
  };

  if (block.kind === 'table' && block.cells?.length) {
    const directTarget =
      normalizeIdentityForComparison(target.target_identifier) ??
      normalizeIdentityForComparison(target.manufacturer_part_number) ??
      normalizeIdentityForComparison(target.product_model);
    const matchingRows = new Set(
      block.cells
        .filter(
          (cell) =>
            cell.kind === 'data' &&
            (normalizeIdentityForComparison(cell.value) === directTarget ||
              normalizeIdentityForComparison(cell.label) === directTarget),
        )
        .map((cell) => cell.row),
    );
    if (matchingRows.size > 1) {
      diagnostics.push({
        code: 'applicability_unresolved',
        message: 'multiple exact identity rows require human applicability review',
      });
      return { facts, diagnostics };
    }
    const identityCell = directTarget
      ? block.cells.find(
          (cell) =>
            cell.kind === 'data' &&
            (normalizeIdentityForComparison(cell.value) === directTarget ||
              normalizeIdentityForComparison(cell.label) === directTarget),
        )
      : undefined;
    if (!directTarget || !identityCell) {
      const scope = wholeTableProductScope(document, block, target);
      if (scope) {
        const applicability: ApplicabilityBinding = {
          kind: 'exact_product',
          value: scope.model,
          reason: `whole-table-product-scope.v1: sole model header covers all ${scope.width} source-declared columns; no competing header or variant layout; MPN not independently confirmed`,
        };
        const rows = new Map<number, NonNullable<DocumentBlock['cells']>[number][]>();
        for (const cell of block.cells) {
          const row = rows.get(cell.row) ?? [];
          row.push(cell);
          rows.set(cell.row, row);
        }
        for (const [rowNumber, row] of [...rows.entries()].sort(
          ([left], [right]) => left - right,
        )) {
          if (rowNumber === scope.header.row || row.length !== 2) continue;
          row.sort((left, right) => left.column - right.column);
          const [labelCell, valueCell] = row;
          addFact(
            labelCell.value,
            valueCell.value,
            scope.model,
            scope.model,
            valueCell.source_location,
            [
              buildEvidence('subject', scope.model, document, scope.header.source_location),
              buildEvidence('context', scope.header.value, document, scope.header.source_location),
              {
                ...buildEvidence('applicability', scope.header.value, document, block.locator),
                note: applicability.reason,
              },
              buildEvidence('label', labelCell.value, document, labelCell.source_location),
              buildEvidence('value', valueCell.value, document, valueCell.source_location),
            ],
            applicability,
          );
        }
        return { facts, diagnostics };
      }
      diagnostics.push({
        code: 'applicability_unresolved',
        message: directTarget
          ? `no exact target identity cell match for '${directTarget}' in table evidence`
          : 'no target identity available for table qualification',
      });
      return { facts, diagnostics };
    }
    const identityText =
      normalizeIdentityForComparison(identityCell.value) === directTarget
        ? identityCell.value
        : identityCell.label;
    const valueCells = block.cells.filter(
      (cell) =>
        cell.kind === 'data' &&
        cell.row === identityCell.row &&
        cell !== identityCell &&
        cell.value.trim(),
    );
    for (const valueCell of valueCells) {
      const headerCell = block.cells.find(
        (cell) => cell.kind === 'header' && cell.column === valueCell.column && cell.value.trim(),
      );
      const label =
        (headerCell?.label ?? '').trim() || (headerCell?.value ?? '').trim() || 'table value';
      const evidence: QualifiedFactEvidence[] = [
        buildEvidence('subject', identityText, document, identityCell.source_location),
        buildEvidence('label', label, document, headerCell?.source_location ?? block.locator),
        buildEvidence('value', valueCell.value, document, valueCell.source_location),
      ];
      addFact(
        label,
        valueCell.value,
        directTarget,
        directTarget,
        valueCell.source_location,
        evidence,
      );
    }
    return { facts, diagnostics };
  }

  if (block.rows?.length) {
    const directTarget =
      normalizeIdentityForComparison(target.target_identifier) ??
      normalizeIdentityForComparison(target.manufacturer_part_number) ??
      normalizeIdentityForComparison(target.product_model);
    if (block.kind === 'table' && directTarget) {
      const exactTargetRow = block.rows.find(
        (row) => normalizeIdentityForComparison(row.label) === directTarget,
      );
      if (exactTargetRow) {
        addFact(
          exactTargetRow.label,
          exactTargetRow.value,
          exactTargetRow.label,
          exactTargetRow.label,
          block.locator,
        );
        return { facts, diagnostics };
      }
      diagnostics.push({
        code: 'applicability_unresolved',
        message: `no exact target row match for '${directTarget}' in table evidence`,
      });
      return { facts, diagnostics };
    }
    for (const row of block.rows) {
      addFact(row.label, row.value, undefined, undefined, block.locator);
    }
    return { facts, diagnostics };
  }

  return { facts, diagnostics };
};

export const qualifyDocumentExtraction = (
  document: DocumentExtractionArtifact,
  target: DocumentQualificationTarget = {},
  qualifiers: { readonly qualifier?: string; readonly qualifier_version?: string } = {},
): DocumentQualificationResult => {
  const outcomeByStatus: Partial<
    Record<
      DocumentExtractionStatus,
      {
        outcome: QualificationOutcome;
        completeness: 'complete' | 'partial' | 'incomplete';
        diagnostics: QualificationDiagnostic[];
      }
    >
  > = {
    extracted: { outcome: 'qualified', completeness: 'complete', diagnostics: [] },
    partially_extracted: {
      outcome: 'source_incomplete',
      completeness: 'partial',
      diagnostics: [
        {
          code: 'partial_source',
          message: 'partial document extraction preserved only usable structures',
        },
      ],
    },
    no_extractable_content: {
      outcome: 'no_qualifiable_facts',
      completeness: 'incomplete',
      diagnostics: [
        { code: 'source_not_qualifiable', message: 'document has no extractable content' },
      ],
    },
    unsupported: {
      outcome: 'no_qualifiable_facts',
      completeness: 'incomplete',
      diagnostics: [
        {
          code: 'source_not_qualifiable',
          message: 'document format is unsupported for automatic qualification',
        },
      ],
    },
    source_unavailable: {
      outcome: 'no_qualifiable_facts',
      completeness: 'incomplete',
      diagnostics: [
        {
          code: 'source_not_qualifiable',
          message: 'source is unavailable for automatic qualification',
        },
      ],
    },
    source_non_authoritative: {
      outcome: 'non_authoritative_source',
      completeness: 'incomplete',
      diagnostics: [
        {
          code: 'non_authoritative_source',
          message:
            'source provenance is non-authoritative and not promoted as authoritative evidence',
        },
      ],
    },
    source_empty: {
      outcome: 'no_qualifiable_facts',
      completeness: 'incomplete',
      diagnostics: [{ code: 'source_not_qualifiable', message: 'source content is empty' }],
    },
    corrupt_source: {
      outcome: 'no_qualifiable_facts',
      completeness: 'incomplete',
      diagnostics: [
        { code: 'source_not_qualifiable', message: 'source content is corrupt and not qualified' },
      ],
    },
    failed: {
      outcome: 'qualification_failed',
      completeness: 'incomplete',
      diagnostics: [
        {
          code: 'source_not_qualifiable',
          message: 'document extraction failed and no facts were fabricated',
        },
      ],
    },
  };

  const statusResult = outcomeByStatus[document.status];
  if (statusResult) {
    if (document.status === 'source_non_authoritative') return { ...statusResult, facts: [] };
    if (
      document.status === 'unsupported' ||
      document.status === 'no_extractable_content' ||
      document.status === 'source_unavailable' ||
      document.status === 'source_empty' ||
      document.status === 'corrupt_source' ||
      document.status === 'failed'
    ) {
      return { ...statusResult, facts: [] };
    }
  }

  const truncationSignals = new Set<string>([
    'input_limit_reached',
    'item_limit_reached',
    'table_cell_limit_reached',
    'page_limit_reached',
    'text_limit_reached',
    'snapshot_read_failure',
  ]);
  const coverageTruncated =
    truncationSignals.has(document.status) ||
    (document.diagnostics?.some((diagnostic) => truncationSignals.has(diagnostic.code)) ?? false);

  const facts: QualifiedFactArtifact[] = [];
  const diagnostics: QualificationDiagnostic[] = [];
  for (const block of document.blocks) {
    const qualified = qualifyFromBlock(document, block, target, {
      qualifier: qualifiers.qualifier ?? 'production-qualified-fact',
      qualifier_version: qualifiers.qualifier_version ?? PRODUCTION_SCHEMA_VERSION,
    });
    facts.push(...qualified.facts);
    diagnostics.push(...qualified.diagnostics);
  }

  if (coverageTruncated) {
    diagnostics.push({
      code: 'partial_source',
      message: 'document extraction was bounded or truncated; qualification coverage is incomplete',
    });
  }

  const baseOutcome = facts.length ? 'qualified' : 'no_qualifiable_facts';
  const statusOutcome =
    document.status === 'partially_extracted'
      ? 'source_incomplete'
      : document.status === 'source_non_authoritative'
        ? 'non_authoritative_source'
        : baseOutcome;
  const statusCompleteness =
    document.status === 'partially_extracted' || (coverageTruncated && facts.length)
      ? 'partial'
      : facts.length
        ? 'complete'
        : 'incomplete';
  const resultDiagnostics: QualificationDiagnostic[] = facts.length
    ? diagnostics
    : [
        {
          code: 'source_not_qualifiable',
          message: 'document blocks did not yield a deterministically qualifiable fact',
        },
        ...diagnostics,
      ];

  return {
    outcome: statusOutcome,
    completeness: statusCompleteness,
    facts,
    diagnostics: resultDiagnostics,
  };
};

export const validateProductIntake = (value: unknown): readonly string[] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return ['intake must be an object'];
  }
  const intake = value as Partial<ProductIntake>;
  const missing = (['id', 'manufacturer', 'product_model'] as const).filter(
    (field) => typeof intake[field] !== 'string' || intake[field]?.trim() === '',
  );
  const issues = missing.map((field) => field + ' is required');
  for (const field of ['manufacturer_part_number', 'official_product_uri'] as const) {
    if (
      Object.hasOwn(intake, field) &&
      (typeof intake[field] !== 'string' || !intake[field]?.trim())
    )
      issues.push(field + ' must be non-empty when supplied');
  }
  if (
    !(
      typeof intake.manufacturer_part_number === 'string' && intake.manufacturer_part_number.trim()
    ) &&
    !(typeof intake.official_product_uri === 'string' && intake.official_product_uri.trim())
  )
    issues.push('manufacturer_part_number or official_product_uri is required');
  if (
    typeof intake.official_product_uri === 'string' &&
    !(validateCaptureUri(intake.official_product_uri.trim()) instanceof URL)
  )
    issues.push('official_product_uri must be a supported HTTP(S) source URI');
  return issues;
};

export const reviewPackageSnapshot = (reviewPackage: ReviewPackage): string =>
  artifactDigest(reviewPackage);

const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const stringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(nonempty);

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate the optional human selections without treating package approval as field approval. */
export const validateProductionApproval = (value: unknown): readonly string[] => {
  const errors: string[] = validateProductionArtifact(value)
    ? []
    : ['approval does not satisfy production-ingestion schema'];
  if (!record(value)) return [...errors, 'approval must be an object'];
  if (value.artifact_kind !== 'approval') errors.push('artifact_kind must be approval');
  if (!['approved', 'rejected', 'deferred'].includes(value.decision as string))
    errors.push('decision must be approved, rejected, or deferred');
  const decisions = value.promotion_decisions;
  if (decisions === undefined) return errors;
  if (!record(decisions)) return [...errors, 'promotion_decisions must be an object'];
  const requiredKeys = ['approved_fields', 'evidence_acknowledged', 'product_role', 'category'];
  const allowedKeys = new Set([
    ...requiredKeys,
    'approved_qualified_value_ids',
    'excluded_fields',
    'excluded_fact_ids',
    'reviewed_evidence_fact_ids',
    'field_resolutions',
    'topology_evidence',
  ]);
  for (const key of Object.keys(decisions)) {
    if (!allowedKeys.has(key)) errors.push(`promotion_decisions.${key} is not supported`);
  }
  for (const key of [
    'approved_fields',
    'approved_qualified_value_ids',
    'excluded_fields',
    'excluded_fact_ids',
    'reviewed_evidence_fact_ids',
  ]) {
    if ((key === 'approved_fields' || decisions[key] !== undefined) && !stringArray(decisions[key]))
      errors.push(`promotion_decisions.${key} must be an array of nonempty strings`);
  }
  if (typeof decisions.evidence_acknowledged !== 'boolean')
    errors.push('promotion_decisions.evidence_acknowledged must be a boolean');
  for (const key of ['product_role', 'category']) {
    if (!nonempty(decisions[key])) errors.push(`promotion_decisions.${key} must be nonempty`);
  }
  if (decisions.field_resolutions !== undefined) {
    if (!record(decisions.field_resolutions))
      errors.push('promotion_decisions.field_resolutions must be an object');
    else
      for (const [field, resolution] of Object.entries(decisions.field_resolutions)) {
        if (
          !nonempty(field) ||
          !record(resolution) ||
          !nonempty(resolution.selected_fact_id) ||
          !nonempty(resolution.rationale) ||
          Object.keys(resolution).some((key) => !['selected_fact_id', 'rationale'].includes(key))
        )
          errors.push(`promotion_decisions.field_resolutions.${field} is invalid`);
      }
  }
  if (decisions.topology_evidence !== undefined) {
    if (!record(decisions.topology_evidence))
      errors.push('promotion_decisions.topology_evidence must be an object');
    else
      for (const [target, factIds] of Object.entries(decisions.topology_evidence)) {
        if (!nonempty(target) || !stringArray(factIds))
          errors.push(`promotion_decisions.topology_evidence.${target} is invalid`);
      }
  }
  return errors;
};

/** An approved package remains insufficient for promotion until selections are explicit. */
export const validateProductionApprovalForPromotion = (value: unknown): readonly string[] => {
  const errors = validateProductionApproval(value);
  if (record(value)) {
    if (value.decision !== 'approved')
      return [...errors, 'approval decision must be approved for promotion'];
    if (value.promotion_decisions === undefined)
      return [...errors, 'promotion_decisions are required for approved promotion'];
  }
  return errors;
};

export const approvalMatchesReviewPackage = (
  approval: ProductionApproval,
  reviewPackage: ReviewPackage,
): boolean =>
  approval.review_package.digest === artifactDigest(reviewPackage) &&
  approval.review_package_snapshot === reviewPackageSnapshot(reviewPackage) &&
  approval.semantic_snapshot === reviewPackage.semantic_snapshot;

export const validateArtifactReferences = (
  references: readonly ArtifactReference[],
  available: ReadonlySet<string>,
): readonly string[] =>
  references
    .filter((reference) => !available.has(reference.digest))
    .map((reference) => reference.digest);
