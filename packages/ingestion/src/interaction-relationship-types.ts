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

export type InteractionEngineeringParticipantReference =
  | { readonly kind: 'component'; readonly component_id: string }
  | {
      readonly kind: 'interaction_endpoint';
      readonly component_id: string;
      readonly endpoint_id: string;
    }
  | { readonly kind: 'unresolved_external'; readonly reference: string };

export interface InteractionRelationshipParticipantV2 {
  readonly id: string;
  readonly reference: InteractionEngineeringParticipantReference;
  readonly role: string;
  readonly display_name?: string;
}

export type InteractionEvidenceScopeKind =
  | 'exact_product'
  | 'model'
  | 'family'
  | 'ecosystem'
  | 'product_series'
  | 'accessory_scope'
  | 'unresolved'
  | 'other';

export interface InteractionEvidenceScope {
  readonly id: string;
  readonly kind: InteractionEvidenceScopeKind;
  readonly source_reference: string;
  readonly source_wording?: string;
  readonly source_ids: readonly string[];
  readonly fact_ids: readonly string[];
  readonly resolution: 'resolved' | 'partially_resolved' | 'unresolved';
  readonly resolved_component_ids?: readonly string[];
}

export type InteractionApplicability =
  | {
      readonly id: string;
      readonly target_participant_id: string;
      readonly kind: 'firmware' | 'hardware_revision';
      readonly operator: 'equals';
      readonly value: string;
      readonly source_ids: readonly string[];
      readonly fact_ids: readonly string[];
      readonly raw_wording?: string;
    }
  | {
      readonly id: string;
      readonly target_participant_id?: string;
      readonly kind: 'other';
      readonly raw_value: string;
      readonly source_ids: readonly string[];
      readonly fact_ids: readonly string[];
    };

export type InteractionConfigurationValue = string | number | boolean | null;

export type InteractionPrerequisite =
  | {
      readonly id: string;
      readonly kind: 'intermediate';
      readonly participant_id: string;
      readonly source_ids: readonly string[];
      readonly fact_ids: readonly string[];
      readonly raw_wording?: string;
    }
  | {
      readonly id: string;
      readonly kind: 'configuration';
      readonly target:
        | { readonly kind: 'participant'; readonly participant_id: string }
        | { readonly kind: 'relationship' };
      readonly key: string;
      readonly operator: 'equals' | 'present';
      readonly value?: InteractionConfigurationValue;
      readonly source_ids: readonly string[];
      readonly fact_ids: readonly string[];
      readonly raw_wording?: string;
    }
  | {
      readonly id: string;
      readonly kind: 'connection';
      readonly participant_ids: readonly [string, string];
      readonly topology: 'direct' | 'shared_network' | 'direct_or_shared_network';
      readonly source_ids: readonly string[];
      readonly fact_ids: readonly string[];
      readonly raw_wording?: string;
    }
  | {
      readonly id: string;
      readonly kind: 'other';
      readonly raw_value: string;
      readonly source_ids: readonly string[];
      readonly fact_ids: readonly string[];
    };

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

export type InteractionEvidenceApplicabilityScope =
  | 'exact_product'
  | 'product_model'
  | 'product_family'
  | 'manufacturer_ecosystem'
  | 'accessory_class'
  | 'unresolved'
  | 'other';

export interface InteractionEvidenceApplicability {
  readonly scope: InteractionEvidenceApplicabilityScope;
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

export interface InteractionInformationClaimV2 {
  readonly id: string;
  readonly direction: 'exposes' | 'consumes';
  readonly participant_id: string;
  readonly term: string;
  readonly raw_wording?: string;
}

export type InteractionInformationDistribution =
  | {
      readonly id: string;
      readonly kind: 'explicit_consumers';
      readonly source_claim_id: string;
      readonly consumer_claim_ids: readonly string[];
      readonly source_ids: readonly string[];
      readonly fact_ids: readonly string[];
      readonly raw_wording?: string;
    }
  | {
      readonly id: string;
      readonly kind: 'shared_publication';
      readonly source_claim_id: string;
      readonly source_ids: readonly string[];
      readonly fact_ids: readonly string[];
      readonly raw_wording?: string;
    };

export interface InteractionControlClaim {
  readonly id: string;
  readonly controller_participant_id: string;
  readonly target_participant_id: string;
  readonly action: string;
  readonly source_ids: readonly string[];
  readonly fact_ids: readonly string[];
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
  readonly normalized_participants?: readonly InteractionRelationshipParticipantV2[];
  readonly required_intermediates?: readonly string[];
  readonly scope: InteractionRelationshipScope;
  readonly information?: readonly InteractionInformationClaim[];
  readonly normalized_information?: readonly InteractionInformationClaimV2[];
  readonly information_distributions?: readonly InteractionInformationDistribution[];
  readonly control_claims?: readonly InteractionControlClaim[];
  readonly conditions?: readonly InteractionRelationshipCondition[];
  readonly applicability?: readonly InteractionApplicability[];
  readonly prerequisites?: readonly InteractionPrerequisite[];
  readonly evidence_scopes?: readonly InteractionEvidenceScope[];
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
    | 'canonical_identity_unresolved'
    | 'duplicate_participant_id'
    | 'invalid_participant_id'
    | 'invalid_normalized_reference'
    | 'invalid_normalized_information_ref'
    | 'missing_normalized_information_id'
    | 'duplicate_normalized_information_id'
    | 'invalid_information_distribution'
    | 'duplicate_information_distribution_id'
    | 'invalid_information_distribution_ref'
    | 'duplicate_information_distribution_consumer_id'
    | 'invalid_control_claim'
    | 'duplicate_control_claim_id'
    | 'invalid_applicability_ref'
    | 'duplicate_applicability_id'
    | 'invalid_prerequisite_ref'
    | 'duplicate_prerequisite_id'
    | 'invalid_configuration_predicate'
    | 'invalid_connection_topology'
    | 'invalid_evidence_scope'
    | 'invalid_evidence_scope_component'
    | 'legacy_normalized_conflict';
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
  readonly componentReferenceResolver?: (componentId: string) => boolean;
  readonly endpointReferenceResolver?: (componentId: string, endpointId: string) => boolean;
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
