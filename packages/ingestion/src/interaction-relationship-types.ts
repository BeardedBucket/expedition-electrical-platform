// Canonical interaction-relationship contracts/types.
//
// This module owns type/contract ownership only. It must not depend on
// validation, promotion, or persistence logic so that every other
// interaction-relationship module can depend on it without creating a cycle.

export type InteractionRelationshipKind =
  | 'manufacturer_interoperability'
  | 'required_intermediate'
  | 'information_sharing'
  | 'information_consumption'
  | 'control_interaction';

export type InteractionRelationshipScope =
  | 'exact_product'
  | 'model'
  | 'product_family'
  | 'manufacturer_ecosystem'
  | 'accessory_class'
  | 'unknown';

export type InteractionRelationshipParticipantKind =
  | 'interaction_endpoint'
  | 'exact_product'
  | 'product_model'
  | 'product_family'
  | 'manufacturer_ecosystem'
  | 'accessory_class'
  | 'unresolved_external';

export type InteractionParticipantReferenceResolver = (
  kind: InteractionRelationshipParticipantKind,
  ref: string,
) => boolean;

export interface InteractionRelationshipParticipant {
  readonly ref: string;
  readonly kind: InteractionRelationshipParticipantKind;
  readonly role: string;
  readonly endpoint_id?: string;
  readonly display_name?: string;
}

export interface InteractionRelationshipCondition {
  readonly kind:
    | 'accessory_required'
    | 'brand_dependent'
    | 'firmware'
    | 'hardware_revision'
    | 'connection'
    | 'configuration'
    | 'other';
  readonly value: string;
}

export type InteractionEvidenceScope =
  | 'exact_product'
  | 'product_model'
  | 'product_family'
  | 'manufacturer_ecosystem'
  | 'accessory_class'
  | 'unresolved'
  | 'other';

export interface InteractionEvidenceApplicability {
  readonly scope: InteractionEvidenceScope;
  readonly ref?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly family?: string;
  readonly ecosystem?: string;
  readonly accessory?: string;
}

export interface InteractionInformationClaim {
  readonly direction: 'exposes' | 'consumes';
  readonly participant_ref: string;
  readonly term: string;
  readonly raw_wording?: string;
}

export interface InteractionRelationshipPromotionHistoryEntry {
  readonly review_id: string;
  readonly candidate_id: string;
  readonly relationship_id: string;
  readonly reviewer_id: string;
  readonly reviewed_at: string;
  readonly expected_snapshot: string;
  readonly canonical_snapshot: string;
  readonly decision: 'approved' | 'rejected';
  readonly source_ids: readonly string[];
  readonly fact_ids: readonly string[];
}

export interface InteractionRelationship {
  readonly schema_version: string;
  readonly id: string;
  readonly relationship_kind: InteractionRelationshipKind;
  readonly assertion?: 'positive' | 'negative';
  readonly participants: readonly InteractionRelationshipParticipant[];
  readonly required_intermediates?: readonly string[];
  readonly scope: InteractionRelationshipScope;
  readonly information?: readonly InteractionInformationClaim[];
  readonly conditions?: readonly InteractionRelationshipCondition[];
  readonly notes?: string;
  readonly evidence: {
    readonly source_ids: readonly string[];
    readonly fact_ids: readonly string[];
    readonly applicability?: readonly InteractionEvidenceApplicability[];
  };
  readonly state: 'verified' | 'provisional' | 'unresolved' | 'conflicting';
  readonly promotion_history?: readonly InteractionRelationshipPromotionHistoryEntry[];
}

export interface InteractionRelationshipValidationIssue {
  readonly code:
    | 'invalid_relationship'
    | 'duplicate_id'
    | 'duplicate_participant_ref'
    | 'missing_participant'
    | 'invalid_intermediate_ref'
    | 'invalid_information_ref'
    | 'missing_evidence'
    | 'canonical_identity_unresolved';
  readonly path: string;
  readonly message: string;
}

export interface InteractionRelationshipValidation {
  readonly status: 'valid' | 'invalid' | 'unresolved';
  readonly issues: readonly InteractionRelationshipValidationIssue[];
  readonly ok: boolean;
}

export type CanonicalInteractionRelationshipStatus =
  'proposed' | 'blocked' | 'invalid' | 'dry_run' | 'written';

export type CanonicalInteractionRelationshipIssueCode =
  | 'review_not_approved'
  | 'missing_expected_snapshot'
  | 'canonical_snapshot_mismatch'
  | 'relationship_id_mismatch'
  | 'relationship_already_exists'
  | 'relationship_invalid'
  | 'relationship_missing_evidence'
  | 'reviewed_evidence_missing'
  | 'source_or_fact_missing'
  | 'invalid_intermediate_ref'
  | 'invalid_information_ref'
  | 'state_not_canonical'
  | 'write_not_authorized'
  | 'write_path_invalid'
  | 'write_failed'
  | 'write_target_missing'
  | 'review_conflicting'
  | 'duplicate_relationship_id'
  | 'canonical_identity_unresolved'
  | 'source_evidence_scope_mismatch'
  | 'derived_compatibility_rejected'
  | 'installed_system_rejected'
  | 'assertion_missing';

export interface CanonicalInteractionRelationshipIssue {
  readonly code: CanonicalInteractionRelationshipIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface CanonicalInteractionRelationshipReview {
  readonly schema_version: string;
  readonly id: string;
  readonly relationship_id: string;
  readonly candidate_id: string;
  readonly decision: 'approved' | 'rejected';
  readonly reviewer_id: string;
  readonly reviewed_at: string;
  readonly expected_snapshot?: string;
  readonly expected_current_snapshot?: string;
  readonly evidence_acknowledged: boolean;
  readonly rationale?: string;
  readonly notes?: string;
  readonly source_ids?: readonly string[];
  readonly fact_ids?: readonly string[];
}

export interface CanonicalInteractionRelationshipCandidate {
  readonly relationship?: InteractionRelationship;
  readonly source_ids?: readonly string[];
  readonly fact_ids?: readonly string[];
  readonly source_evidence?: Readonly<Record<string, readonly string[]>>;
  readonly facts?: ReadonlyArray<{
    readonly id: string;
    readonly source_id?: string;
    readonly fact_state?: InteractionRelationship['state'];
  }>;
}

export interface CanonicalInteractionRelationshipFilesystem {
  readonly access: (path: string) => Promise<void>;
  readonly readFile: (path: string, encoding: 'utf8') => Promise<string>;
  readonly mkdir: (path: string, options: { recursive: true }) => Promise<void>;
  readonly writeFile: (
    path: string,
    data: string,
    options: { encoding: 'utf8'; flag: 'wx' },
  ) => Promise<void>;
  readonly rename: (oldPath: string, newPath: string) => Promise<void>;
  readonly rm: (path: string, options: { force: true }) => Promise<void>;
}

export interface CanonicalInteractionRelationshipRequest {
  readonly current: InteractionRelationship;
  readonly candidate?: CanonicalInteractionRelationshipCandidate;
  readonly review: CanonicalInteractionRelationshipReview;
  readonly write?: boolean;
  readonly destinationRoot?: string;
  readonly filename?: string;
  readonly filesystem?: CanonicalInteractionRelationshipFilesystem;
  readonly participantReferenceResolver?: InteractionParticipantReferenceResolver;
}

export interface CanonicalInteractionRelationshipResult {
  readonly status: CanonicalInteractionRelationshipStatus;
  readonly issues: readonly CanonicalInteractionRelationshipIssue[];
  readonly proposal?: InteractionRelationship;
  readonly current?: InteractionRelationship;
  readonly expected_snapshot?: string;
  readonly actual_snapshot?: string;
  readonly path?: string;
  readonly serialized?: string;
  readonly schema_valid: boolean;
}

export const canonicalInteractionRelationshipIssue = (
  code: CanonicalInteractionRelationshipIssueCode,
  path: string,
  message: string,
): CanonicalInteractionRelationshipIssue => ({ code, path, message });
