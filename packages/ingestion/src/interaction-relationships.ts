import type { JsonObject, JsonValue } from './contracts.js';

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

export interface InteractionInformationClaim {
  readonly direction: 'exposes' | 'consumes';
  readonly participant_ref: string;
  readonly term: string;
  readonly raw_wording?: string;
}

export interface InteractionRelationship {
  readonly schema_version: string;
  readonly id: string;
  readonly relationship_kind: InteractionRelationshipKind;
  readonly participants: readonly InteractionRelationshipParticipant[];
  readonly required_intermediates?: readonly string[];
  readonly scope: InteractionRelationshipScope;
  readonly information?: readonly InteractionInformationClaim[];
  readonly conditions?: readonly InteractionRelationshipCondition[];
  readonly notes?: string;
  readonly evidence: {
    readonly source_ids: readonly string[];
    readonly fact_ids: readonly string[];
  };
  readonly state: 'verified' | 'provisional' | 'unresolved' | 'conflicting';
}

export interface InteractionRelationshipValidationIssue {
  readonly code:
    | 'invalid_relationship'
    | 'duplicate_id'
    | 'duplicate_participant_ref'
    | 'missing_participant'
    | 'invalid_intermediate_ref'
    | 'invalid_information_ref'
    | 'missing_evidence';
  readonly path: string;
  readonly message: string;
}

export interface InteractionRelationshipValidation {
  readonly status: 'valid' | 'invalid' | 'unresolved';
  readonly issues: readonly InteractionRelationshipValidationIssue[];
  readonly ok: boolean;
}

const issue = (
  code: InteractionRelationshipValidationIssue['code'],
  path: string,
  message: string,
): InteractionRelationshipValidationIssue => ({ code, path, message });

const isObject = (value: JsonValue | unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const validateInteractionRelationships = (
  relationships: readonly InteractionRelationship[],
): InteractionRelationshipValidation => {
  const issues: InteractionRelationshipValidationIssue[] = [];
  const ids = new Set<string>();
  relationships.forEach((relationship, index) => {
    const path = `relationships[${index}]`;
    if (!isObject(relationship) || !relationship.id || !relationship.relationship_kind) {
      issues.push(
        issue('invalid_relationship', path, 'Relationship identity and kind are required.'),
      );
      return;
    }
    if (ids.has(relationship.id)) {
      issues.push(
        issue('duplicate_id', `${path}.id`, `Relationship id '${relationship.id}' is duplicated.`),
      );
    }
    ids.add(relationship.id);
    if (relationship.participants.length < 2) {
      issues.push(
        issue(
          'missing_participant',
          `${path}.participants`,
          'At least two participants are required.',
        ),
      );
    }
    const participantRefs = new Set<string>();
    relationship.participants.forEach((participant, participantIndex) => {
      const participantPath = `${path}.participants[${participantIndex}]`;
      if (participantRefs.has(participant.ref)) {
        issues.push(
          issue(
            'duplicate_participant_ref',
            `${participantPath}.ref`,
            `Participant ref '${participant.ref}' is duplicated.`,
          ),
        );
      }
      participantRefs.add(participant.ref);
    });
    (relationship.required_intermediates ?? []).forEach((ref, intermediateIndex) => {
      if (!participantRefs.has(ref)) {
        issues.push(
          issue(
            'invalid_intermediate_ref',
            `${path}.required_intermediates[${intermediateIndex}]`,
            `Required intermediate '${ref}' is not a participant.`,
          ),
        );
      }
    });
    (relationship.information ?? []).forEach((claim, claimIndex) => {
      if (!participantRefs.has(claim.participant_ref)) {
        issues.push(
          issue(
            'invalid_information_ref',
            `${path}.information[${claimIndex}].participant_ref`,
            `Information participant '${claim.participant_ref}' is not a participant.`,
          ),
        );
      }
    });
    if (!relationship.evidence.source_ids.length || !relationship.evidence.fact_ids.length) {
      issues.push(
        issue(
          'missing_evidence',
          `${path}.evidence`,
          'Source and fact evidence are both required.',
        ),
      );
    }
  });
  const status = issues.length ? 'invalid' : 'valid';
  return { status, issues, ok: status === 'valid' };
};
