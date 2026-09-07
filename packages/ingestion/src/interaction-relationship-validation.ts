// Structural and participant validation for interaction relationships,
// including generic (manufacturer-neutral) concrete-identity resolution
// requirements. This module owns validation only; it must not perform
// promotion, snapshotting, or filesystem work.

import type { JsonObject, JsonValue } from './contracts.js';
import type {
  InteractionParticipantReferenceResolver,
  InteractionRelationship,
  InteractionRelationshipParticipantKind,
  InteractionRelationshipValidation,
  InteractionRelationshipValidationIssue,
} from './interaction-relationship-types.js';

const issue = (
  code: InteractionRelationshipValidationIssue['code'],
  path: string,
  message: string,
): InteractionRelationshipValidationIssue => ({ code, path, message });

const isObject = (value: JsonValue | unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const requiresConcreteIdentityResolution = (
  kind: InteractionRelationshipParticipantKind,
): boolean =>
  kind === 'interaction_endpoint' || kind === 'exact_product' || kind === 'product_model';

export const validateInteractionRelationships = (
  relationships: readonly InteractionRelationship[],
  options: { participantReferenceResolver?: InteractionParticipantReferenceResolver } = {},
): InteractionRelationshipValidation => {
  const issues: InteractionRelationshipValidationIssue[] = [];
  const ids = new Set<string>();
  const participantReferenceResolver = options.participantReferenceResolver;
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
      if (
        requiresConcreteIdentityResolution(participant.kind) &&
        !participantReferenceResolver?.(participant.kind, participant.ref)
      ) {
        issues.push(
          issue(
            'canonical_identity_unresolved',
            `${participantPath}.ref`,
            `Concrete participant reference '${participant.ref}' for kind '${participant.kind}' must resolve to a canonical identity.`,
          ),
        );
      }
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
