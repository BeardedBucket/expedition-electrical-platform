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

export const usesNormalizedInteractionAuthority = (
  relationship: InteractionRelationship,
): boolean => relationship.normalized_participants !== undefined;

export const validateInteractionRelationships = (
  relationships: readonly InteractionRelationship[],
  options: {
    participantReferenceResolver?: InteractionParticipantReferenceResolver;
    componentReferenceResolver?: (componentId: string) => boolean;
    endpointReferenceResolver?: (componentId: string, endpointId: string) => boolean;
  } = {},
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
        !usesNormalizedInteractionAuthority(relationship) &&
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
    const normalizedParticipants = relationship.normalized_participants ?? [];
    const normalizedIds = new Set<string>();
    normalizedParticipants.forEach((participant, participantIndex) => {
      const participantPath = `${path}.normalized_participants[${participantIndex}]`;
      if (!participant.id.trim()) {
        issues.push(
          issue('invalid_participant_id', `${participantPath}.id`, 'Participant id is required.'),
        );
      }
      if (normalizedIds.has(participant.id)) {
        issues.push(
          issue(
            'duplicate_participant_id',
            `${participantPath}.id`,
            `Participant id '${participant.id}' is duplicated.`,
          ),
        );
      }
      normalizedIds.add(participant.id);
      const reference = participant.reference;
      const componentId =
        reference.kind === 'component' || reference.kind === 'interaction_endpoint'
          ? reference.component_id
          : undefined;
      if (
        componentId &&
        options.componentReferenceResolver &&
        !options.componentReferenceResolver(componentId)
      ) {
        issues.push(
          issue(
            'invalid_normalized_reference',
            `${participantPath}.reference.component_id`,
            `Canonical component '${componentId}' could not be resolved.`,
          ),
        );
      }
      if (
        reference.kind === 'interaction_endpoint' &&
        options.endpointReferenceResolver &&
        !options.endpointReferenceResolver(reference.component_id, reference.endpoint_id)
      ) {
        issues.push(
          issue(
            'invalid_normalized_reference',
            `${participantPath}.reference.endpoint_id`,
            `Canonical interaction endpoint '${reference.endpoint_id}' could not be resolved.`,
          ),
        );
      }
    });
    const normalizedInformation = relationship.normalized_information ?? [];
    normalizedInformation.forEach((claim, claimIndex) => {
      if (!normalizedIds.has(claim.participant_id)) {
        issues.push(
          issue(
            'invalid_normalized_information_ref',
            `${path}.normalized_information[${claimIndex}].participant_id`,
            `Information participant '${claim.participant_id}' is not a normalized participant.`,
          ),
        );
      }
    });
    const applicabilityIds = new Set<string>();
    (relationship.applicability ?? []).forEach((applicability, applicabilityIndex) => {
      const applicabilityPath = `${path}.applicability[${applicabilityIndex}]`;
      if (applicabilityIds.has(applicability.id)) {
        issues.push(
          issue(
            'duplicate_applicability_id',
            `${applicabilityPath}.id`,
            `Applicability id '${applicability.id}' is duplicated.`,
          ),
        );
      }
      applicabilityIds.add(applicability.id);
      if (
        applicability.target_participant_id &&
        !normalizedIds.has(applicability.target_participant_id)
      ) {
        issues.push(
          issue(
            'invalid_applicability_ref',
            `${applicabilityPath}.target_participant_id`,
            `Applicability target '${applicability.target_participant_id}' is not a normalized participant.`,
          ),
        );
      }
      if (
        (applicability.kind === 'firmware' || applicability.kind === 'hardware_revision') &&
        applicability.operator !== 'equals'
      ) {
        issues.push(
          issue(
            'invalid_configuration_predicate',
            `${applicabilityPath}.operator`,
            'Firmware and hardware revision applicability support equality only.',
          ),
        );
      }
    });
    const prerequisiteIds = new Set<string>();
    (relationship.prerequisites ?? []).forEach((prerequisite, prerequisiteIndex) => {
      const prerequisitePath = `${path}.prerequisites[${prerequisiteIndex}]`;
      if (prerequisiteIds.has(prerequisite.id)) {
        issues.push(
          issue(
            'duplicate_prerequisite_id',
            `${prerequisitePath}.id`,
            `Prerequisite id '${prerequisite.id}' is duplicated.`,
          ),
        );
      }
      prerequisiteIds.add(prerequisite.id);
      const refs =
        prerequisite.kind === 'intermediate'
          ? [prerequisite.participant_id]
          : prerequisite.kind === 'configuration' && prerequisite.target.kind === 'participant'
            ? [prerequisite.target.participant_id]
            : prerequisite.kind === 'connection'
              ? prerequisite.participant_ids
              : [];
      refs.forEach((participantId) => {
        if (!normalizedIds.has(participantId)) {
          issues.push(
            issue(
              'invalid_prerequisite_ref',
              prerequisitePath,
              `Prerequisite participant '${participantId}' is not a normalized participant.`,
            ),
          );
        }
      });
      if (
        prerequisite.kind === 'configuration' &&
        prerequisite.operator === 'present' &&
        'value' in prerequisite
      ) {
        issues.push(
          issue(
            'invalid_configuration_predicate',
            `${prerequisitePath}.value`,
            'Presence configuration prerequisites must not include a value.',
          ),
        );
      }
      if (
        prerequisite.kind === 'configuration' &&
        prerequisite.operator === 'equals' &&
        !Object.prototype.hasOwnProperty.call(prerequisite, 'value')
      ) {
        issues.push(
          issue(
            'invalid_configuration_predicate',
            `${prerequisitePath}.value`,
            'Equality configuration prerequisites require a value.',
          ),
        );
      }
    });
    (relationship.evidence_scopes ?? []).forEach((scope, scopeIndex) => {
      const scopePath = `${path}.evidence_scopes[${scopeIndex}]`;
      if (!scope.id.trim() || !scope.source_reference.trim()) {
        issues.push(
          issue(
            'invalid_evidence_scope',
            scopePath,
            'Evidence scope id and source reference are required.',
          ),
        );
      }
      if (
        scope.resolution === 'resolved' &&
        (!scope.resolved_component_ids || scope.resolved_component_ids.length === 0)
      ) {
        issues.push(
          issue(
            'invalid_evidence_scope',
            `${scopePath}.resolved_component_ids`,
            'Resolved evidence scopes require at least one canonical component id.',
          ),
        );
      }
      if (
        scope.resolution === 'partially_resolved' &&
        (!scope.resolved_component_ids || scope.resolved_component_ids.length === 0)
      ) {
        issues.push(
          issue(
            'invalid_evidence_scope',
            `${scopePath}.resolved_component_ids`,
            'Partially resolved evidence scopes require at least one canonical component id.',
          ),
        );
      }
      if (scope.resolution === 'unresolved' && scope.resolved_component_ids !== undefined) {
        issues.push(
          issue(
            'invalid_evidence_scope',
            `${scopePath}.resolved_component_ids`,
            'Unresolved evidence scopes must not contain canonical component ids.',
          ),
        );
      }
      if (
        scope.resolved_component_ids &&
        new Set(scope.resolved_component_ids).size !== scope.resolved_component_ids.length
      ) {
        issues.push(
          issue(
            'invalid_evidence_scope',
            `${scopePath}.resolved_component_ids`,
            'Resolved component ids must be unique.',
          ),
        );
      }
      if (!scope.source_ids.length || !scope.fact_ids.length) {
        issues.push(
          issue('missing_evidence', scopePath, 'Evidence scopes require source and fact evidence.'),
        );
      }
      scope.resolved_component_ids?.forEach((componentId, componentIndex) => {
        if (
          options.componentReferenceResolver &&
          !options.componentReferenceResolver(componentId)
        ) {
          issues.push(
            issue(
              'invalid_evidence_scope_component',
              `${scopePath}.resolved_component_ids[${componentIndex}]`,
              `Canonical component '${componentId}' could not be resolved.`,
            ),
          );
        }
      });
    });
    if (!usesNormalizedInteractionAuthority(relationship)) {
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
    }
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
