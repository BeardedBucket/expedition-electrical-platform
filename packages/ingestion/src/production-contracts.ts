import { createHash } from 'node:crypto';
import type { JsonObject, JsonValue } from './contracts.js';

export const PRODUCTION_SCHEMA_VERSION = '1.0';
export const PRODUCTION_HASH_ALGORITHM = 'sha256';

export type ArtifactKind =
  | 'product_intake'
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
  readonly manufacturer_part_number: string;
  readonly official_product_uri: string;
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

export type DocumentBlockKind = 'text' | 'table' | 'structured' | 'unsupported' | 'unresolved';

export interface DocumentBlock {
  readonly id: string;
  readonly kind: DocumentBlockKind;
  readonly locator: string;
  readonly content?: string;
  readonly rows?: readonly { readonly label: string; readonly value: string }[];
  readonly reason?: string;
}

export interface DocumentExtractionArtifact {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'document_extraction';
  readonly id: string;
  readonly source_capture: ArtifactReference;
  readonly extractor: string;
  readonly extractor_version: string;
  readonly blocks: readonly DocumentBlock[];
}

export type ApplicabilityKind =
  | 'exact_sku'
  | 'model'
  | 'family'
  | 'variant'
  | 'hardware_revision'
  | 'unresolved'
  | 'not_applicable';

export interface ApplicabilityBinding {
  readonly kind: ApplicabilityKind;
  readonly value?: string;
  readonly reason?: string;
}

export interface QualifiedFactMetadata {
  readonly source_wording: string;
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
}

export interface QualifiedFactArtifact {
  readonly schema_version: typeof PRODUCTION_SCHEMA_VERSION;
  readonly artifact_kind: 'qualified_fact';
  readonly id: string;
  readonly source_capture: ArtifactReference;
  readonly document_extraction?: ArtifactReference;
  readonly metadata: QualifiedFactMetadata;
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

export const validateProductIntake = (value: unknown): readonly string[] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return ['intake must be an object'];
  }
  const intake = value as Partial<ProductIntake>;
  const missing = (
    [
      'id',
      'manufacturer',
      'product_model',
      'manufacturer_part_number',
      'official_product_uri',
    ] as const
  ).filter((field) => typeof intake[field] !== 'string' || intake[field]?.trim() === '');
  return missing.map((field) => `${field} is required`);
};

export const reviewPackageSnapshot = (reviewPackage: ReviewPackage): string =>
  artifactDigest(reviewPackage);

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
