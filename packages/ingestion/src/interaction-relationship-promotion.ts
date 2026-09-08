// Review/promotion gate, deterministic snapshotting, and promotion-history
// construction for interaction relationships.
//
// This module owns the "is this reviewed relationship eligible to become
// canonical" decision and the deterministic snapshot/serialization it
// depends on. It does not perform filesystem writes; persistence composes
// this module's proposal result.

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';
import interactionRelationshipSchema from '../../../data/schemas/interaction-relationship.schema.json' with { type: 'json' };
import {
  canonicalInteractionRelationshipIssue,
  type CanonicalInteractionRelationshipCandidate,
  type CanonicalInteractionRelationshipIssue,
  type CanonicalInteractionRelationshipRequest,
  type CanonicalInteractionRelationshipResult,
  type CanonicalInteractionRelationshipReview,
  type InteractionEvidenceApplicability,
  type InteractionRelationship,
  type InteractionRelationshipPromotionHistoryEntry,
} from './interaction-relationship-types.js';
import {
  usesNormalizedInteractionAuthority,
  validateInteractionRelationships,
} from './interaction-relationship-validation.js';

const stableInteractionRelationshipValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableInteractionRelationshipValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableInteractionRelationshipValue(child)]),
    );
  }
  return value;
};

export const canonicalInteractionRelationshipSnapshot = (
  relationship: InteractionRelationship,
): string =>
  `sha256:${createHash('sha256')
    .update(JSON.stringify(stableInteractionRelationshipValue(relationship)), 'utf8')
    .digest('hex')}`;

const interactionRelationshipValidator = (() => {
  const AjvCtor = Ajv2020 as unknown as new (options?: Record<string, unknown>) => {
    compile: (_value: unknown) => ((value: unknown) => boolean) & {
      errors?: Array<{ instancePath?: string; message?: string }>;
    };
  };
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  const registerFormats = addFormats as unknown as (instance: {
    addFormat?: (...args: unknown[]) => void;
  }) => void;
  registerFormats(ajv as unknown as { addFormat?: (...args: unknown[]) => void });
  return ajv.compile(interactionRelationshipSchema);
})();

const interactionRelationshipSchemaIssues = (
  proposal: InteractionRelationship,
): CanonicalInteractionRelationshipIssue[] => {
  interactionRelationshipValidator(proposal);
  return (interactionRelationshipValidator.errors ?? []).map((error) =>
    canonicalInteractionRelationshipIssue(
      'relationship_invalid',
      error.instancePath || '/',
      error.message ?? 'Interaction relationship does not match the schema.',
    ),
  );
};

const sourceAssertionBoundaryText = (relationship: InteractionRelationship): string => {
  const directText = [
    relationship.relationship_kind,
    relationship.scope,
    relationship.notes ?? '',
    (relationship.conditions ?? [])
      .map((condition) => `${condition.kind}:${condition.value}`)
      .join(' '),
    (relationship.information ?? []).map((claim) => `${claim.direction}:${claim.term}`).join(' '),
  ].join(' ');
  return directText;
};

const evidenceApplicabilitySupportsClaim = (
  applicability: readonly InteractionEvidenceApplicability[] | undefined,
  relationship: InteractionRelationship,
): boolean => {
  if (!applicability || applicability.length === 0) {
    return false;
  }

  const participantRefs = new Set(
    relationship.participants
      .filter((participant) => participant.kind !== 'unresolved_external')
      .map((participant) => participant.ref),
  );
  const relevantApplicability = applicability.filter(
    (entry) => entry.scope !== 'unresolved' && entry.scope !== 'other',
  );

  if (relevantApplicability.length === 0) {
    return false;
  }

  const coveredRefs = new Set<string>();
  for (const entry of relevantApplicability) {
    const refCandidates = [
      entry.ref,
      entry.model,
      entry.family,
      entry.ecosystem,
      entry.accessory,
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of refCandidates) {
      if (participantRefs.has(candidate)) {
        coveredRefs.add(candidate);
      }
    }
  }

  if (participantRefs.size > 0 && coveredRefs.size === 0) {
    return false;
  }

  for (const participantRef of participantRefs) {
    if (!coveredRefs.has(participantRef)) {
      const matchingScope = relevantApplicability.some((entry) => {
        if (entry.scope === 'product_family' && entry.family) {
          return relationship.participants.some(
            (participant) => participant.ref === entry.family || participant.ref === entry.ref,
          );
        }
        if (entry.scope === 'manufacturer_ecosystem' && entry.ecosystem) {
          return relationship.participants.some(
            (participant) => participant.ref === entry.ecosystem || participant.ref === entry.ref,
          );
        }
        if (entry.scope === 'accessory_class' && entry.accessory) {
          return relationship.participants.some(
            (participant) => participant.ref === entry.accessory || participant.ref === entry.ref,
          );
        }
        return false;
      });
      if (!matchingScope) {
        return false;
      }
    }
  }

  return true;
};

const relationshipEvidenceFacts = (
  candidate: CanonicalInteractionRelationshipCandidate | undefined,
  review: CanonicalInteractionRelationshipReview,
): Set<string> => {
  const reviewSet = new Set<string>(review.fact_ids ?? []);
  const candidateSet = new Set<string>(candidate?.fact_ids ?? []);
  const factIds = new Set<string>([...reviewSet, ...candidateSet]);
  for (const [key, values] of Object.entries(candidate?.source_evidence ?? {})) {
    if (key) values.forEach((value) => factIds.add(value));
  }
  return factIds;
};

export const proposeCanonicalInteractionRelationship = ({
  current,
  candidate,
  review,
  participantReferenceResolver,
  componentReferenceResolver,
  endpointReferenceResolver,
}: CanonicalInteractionRelationshipRequest): CanonicalInteractionRelationshipResult => {
  const issues: CanonicalInteractionRelationshipIssue[] = [];
  const expectedSnapshot = review.expected_snapshot ?? review.expected_current_snapshot;
  const relationshipId = review.relationship_id || current.id;
  const actualSnapshot = canonicalInteractionRelationshipSnapshot(current);

  if (
    review.decision !== 'approved' ||
    !review.id.trim() ||
    !review.reviewer_id.trim() ||
    !review.reviewed_at.trim()
  ) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'review_not_approved',
        'review',
        'Canonical relationship promotion requires an explicit approved review with identity and timestamp.',
      ),
    );
  }
  if (!review.evidence_acknowledged) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'review_not_approved',
        'review.evidence_acknowledged',
        'Evidence must be acknowledged before promotion.',
      ),
    );
  }
  if (!relationshipId.trim()) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'relationship_id_mismatch',
        'review.relationship_id',
        'Interaction relationship ID is required.',
      ),
    );
  }
  if (current.id !== relationshipId) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'relationship_id_mismatch',
        'review.relationship_id',
        'Review relationship ID must match the current record.',
      ),
    );
  }
  if (!current.assertion) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'assertion_missing',
        'assertion',
        'Canonical relationship promotion requires an explicit positive or negative assertion.',
      ),
    );
  }
  if (!expectedSnapshot) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'missing_expected_snapshot',
        'review.expected_snapshot',
        'An explicit reviewed snapshot is required.',
      ),
    );
  } else if (expectedSnapshot !== actualSnapshot) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'canonical_snapshot_mismatch',
        'review.expected_snapshot',
        'The reviewed snapshot does not match the current canonical relationship snapshot.',
      ),
    );
  }
  if (
    current.state === 'provisional' ||
    current.state === 'unresolved' ||
    current.state === 'conflicting'
  ) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'state_not_canonical',
        'state',
        'Only reviewed/accepted canonical relationship state is eligible for promotion.',
      ),
    );
  }
  if (candidate?.relationship && candidate.relationship.id !== current.id) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'relationship_id_mismatch',
        'candidate.relationship.id',
        'Candidate relationship ID must match the current record.',
      ),
    );
  }

  const sourceIds = new Set<string>(candidate?.source_ids ?? review.source_ids ?? []);
  const factIds = relationshipEvidenceFacts(candidate, review);
  if (sourceIds.size === 0 || factIds.size === 0) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'source_or_fact_missing',
        'evidence',
        'Canonical promoted relationships require source and fact evidence.',
      ),
    );
  }

  if (
    current.evidence.source_ids.length > 0 &&
    current.evidence.fact_ids.length > 0 &&
    (!current.evidence.applicability || current.evidence.applicability.length === 0)
  ) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'source_evidence_scope_mismatch',
        'evidence.applicability',
        'Evidence applicability is required to prove the relationship scope matches the promoted claim.',
      ),
    );
  }

  const evidenceScopeSupported = evidenceApplicabilitySupportsClaim(
    current.evidence.applicability,
    current,
  );
  if (
    current.evidence.applicability &&
    current.evidence.applicability.length > 0 &&
    !evidenceScopeSupported
  ) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'source_evidence_scope_mismatch',
        'evidence.applicability',
        'Evidence applicability must support the relationship participants, scope, and claim being promoted.',
      ),
    );
  }

  const boundaryText = sourceAssertionBoundaryText(current);
  if (
    /(compatible|compatibility|works with|supports|approved installation|system ready)/i.test(
      boundaryText,
    )
  ) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'derived_compatibility_rejected',
        'notes',
        'Canonical source-assertion promotion rejects derived compatibility or installation conclusion language.',
      ),
    );
  }
  if (
    /(installed|runtime state|presently connected|currently connected|system instance)/i.test(
      boundaryText,
    )
  ) {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'installed_system_rejected',
        'notes',
        'Canonical source-assertion promotion rejects installed-system or runtime-instance claims.',
      ),
    );
  }
  if (!usesNormalizedInteractionAuthority(current)) {
    const participantRefs = new Set(current.participants.map((participant) => participant.ref));
    current.required_intermediates?.forEach((ref, index) => {
      if (!participantRefs.has(ref)) {
        issues.push(
          canonicalInteractionRelationshipIssue(
            'invalid_intermediate_ref',
            `required_intermediates[${index}]`,
            `Required intermediate '${ref}' is not a participant in the relationship.`,
          ),
        );
      }
    });
    current.information?.forEach((claim, index) => {
      if (!participantRefs.has(claim.participant_ref)) {
        issues.push(
          canonicalInteractionRelationshipIssue(
            'invalid_information_ref',
            `information[${index}].participant_ref`,
            `Information participant '${claim.participant_ref}' is not a participant in the relationship.`,
          ),
        );
      }
    });
  }

  const proposal = JSON.parse(JSON.stringify(current)) as InteractionRelationship;
  const invalidState =
    proposal.state === 'provisional' ||
    proposal.state === 'unresolved' ||
    proposal.state === 'conflicting';
  if (!invalidState && proposal.state !== 'verified') {
    issues.push(
      canonicalInteractionRelationshipIssue(
        'state_not_canonical',
        'state',
        'Canonical relationship state must be verified after review.',
      ),
    );
  }
  const validationIssues = validateInteractionRelationships([proposal], {
    participantReferenceResolver,
    componentReferenceResolver,
    endpointReferenceResolver,
  });
  if (validationIssues.status === 'invalid') {
    issues.push(
      ...validationIssues.issues.map((issueItem) =>
        canonicalInteractionRelationshipIssue(
          issueItem.code === 'missing_evidence'
            ? 'relationship_missing_evidence'
            : issueItem.code === 'duplicate_id'
              ? 'duplicate_relationship_id'
              : issueItem.code === 'invalid_intermediate_ref'
                ? 'invalid_intermediate_ref'
                : issueItem.code === 'invalid_information_ref'
                  ? 'invalid_information_ref'
                  : issueItem.code === 'canonical_identity_unresolved'
                    ? 'canonical_identity_unresolved'
                    : 'relationship_invalid',
          issueItem.path,
          issueItem.message,
        ),
      ),
    );
  }

  const schemaErrors = interactionRelationshipSchemaIssues(proposal);
  issues.push(...schemaErrors);

  if (issues.length > 0) {
    return {
      status: 'blocked',
      issues,
      proposal,
      current,
      expected_snapshot: expectedSnapshot,
      actual_snapshot: actualSnapshot,
      schema_valid: false,
    };
  }

  const reviewSnapshot = expectedSnapshot ?? actualSnapshot;
  const currentHistory = Array.isArray(current.promotion_history)
    ? [...current.promotion_history]
    : [];
  const nextHistoryEntry: InteractionRelationshipPromotionHistoryEntry = {
    review_id: review.id,
    candidate_id: review.candidate_id,
    relationship_id: relationshipId,
    reviewer_id: review.reviewer_id,
    reviewed_at: review.reviewed_at,
    expected_snapshot: reviewSnapshot,
    canonical_snapshot: actualSnapshot,
    decision: review.decision,
    source_ids: [...new Set(sourceIds)],
    fact_ids: [...new Set(factIds)],
  };
  const proposalWithHistory: InteractionRelationship = {
    ...proposal,
    promotion_history: [...currentHistory, nextHistoryEntry],
  };

  return {
    status: 'proposed',
    issues: [],
    proposal: proposalWithHistory,
    current,
    expected_snapshot: reviewSnapshot,
    actual_snapshot: actualSnapshot,
    serialized: stringifyYaml(proposalWithHistory, { sortMapEntries: true }),
    schema_valid: true,
  };
};

export const canonicalInteractionRelationshipProposal = proposeCanonicalInteractionRelationship;
export const validateCanonicalInteractionRelationship = proposeCanonicalInteractionRelationship;
