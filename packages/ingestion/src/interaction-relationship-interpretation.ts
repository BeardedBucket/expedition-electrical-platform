import type {
  InteractionInformationClaim,
  InteractionRelationship,
  InteractionRelationshipCondition,
  InteractionRelationshipKind,
  InteractionRelationshipParticipant,
  InteractionRelationshipScope,
} from './interaction-relationship-types.js';

export type InteractionInterpretationStatus = 'positive' | 'explicit_negative' | 'unknown';

export type InteractionInterpretationReason =
  | 'positive_assertion'
  | 'explicit_negative_assertion'
  | 'no_applicable_reviewed_relationship'
  | 'relationship_state_not_verified'
  | 'relationship_assertion_missing'
  | 'relationship_unresolved'
  | 'relationship_conflicting'
  | 'relationship_provisional';

export interface InteractionInterpretationQuery {
  readonly relationship_kind?: InteractionRelationshipKind;
  readonly participant_refs?: readonly string[];
  readonly scope?: InteractionRelationshipScope;
}

export interface InteractionInterpretationResult {
  readonly status: InteractionInterpretationStatus;
  readonly reason: InteractionInterpretationReason;
  readonly relationship_id?: string;
  readonly relationship_kind?: InteractionRelationshipKind;
  readonly participants: readonly InteractionRelationshipParticipant[];
  readonly scope?: InteractionRelationshipScope;
  readonly information: readonly InteractionInformationClaim[];
  readonly required_intermediates: readonly string[];
  readonly conditions: readonly InteractionRelationshipCondition[];
  readonly unresolved: readonly string[];
  readonly evidence: {
    readonly source_ids: readonly string[];
    readonly fact_ids: readonly string[];
  };
}

const matchesParticipantQuery = (
  relationship: InteractionRelationship,
  participantRefs?: readonly string[],
): boolean => {
  if (!participantRefs || participantRefs.length === 0) return true;
  const refs = new Set(
    relationship.participants.map((participant) => participant.ref.toLowerCase()),
  );
  return participantRefs.some((ref) => refs.has(ref.toLowerCase()));
};

const matchesScopeQuery = (
  relationship: InteractionRelationship,
  scope?: InteractionRelationshipScope,
): boolean => {
  if (!scope) return true;
  return relationship.scope === scope;
};

const matchesKindQuery = (
  relationship: InteractionRelationship,
  kind?: InteractionRelationshipKind,
): boolean => {
  if (!kind) return true;
  return relationship.relationship_kind === kind;
};

const matchesInterpretationQuery = (
  relationship: InteractionRelationship,
  query?: InteractionInterpretationQuery,
): boolean => {
  if (!query) return true;
  return (
    matchesKindQuery(relationship, query.relationship_kind) &&
    matchesScopeQuery(relationship, query.scope) &&
    matchesParticipantQuery(relationship, query.participant_refs)
  );
};

const buildUnresolved = (relationship: InteractionRelationship): readonly string[] => {
  const unresolved: string[] = [];
  const information = relationship.information ?? [];

  if (information.length === 0) {
    unresolved.push('assertion_content_unavailable');
  }

  const exposes = information.some((claim) => claim.direction === 'exposes');
  const consumes = information.some((claim) => claim.direction === 'consumes');
  if (exposes && !consumes) {
    unresolved.push('consumption_not_established');
  }

  if (relationship.required_intermediates?.length) {
    for (const intermediate of relationship.required_intermediates) {
      if (!relationship.participants.some((participant) => participant.ref === intermediate)) {
        unresolved.push(`required_intermediate_not_in_participants:${intermediate}`);
      }
    }
  }

  return unresolved;
};

export const interpretInteractionRelationship = (
  relationship: InteractionRelationship,
): InteractionInterpretationResult => {
  const evidence = {
    source_ids: [...(relationship.evidence?.source_ids ?? [])],
    fact_ids: [...(relationship.evidence?.fact_ids ?? [])],
  };

  if (relationship.state !== 'verified') {
    return {
      status: 'unknown',
      reason:
        relationship.state === 'provisional'
          ? 'relationship_provisional'
          : relationship.state === 'conflicting'
            ? 'relationship_conflicting'
            : 'relationship_unresolved',
      relationship_id: relationship.id,
      relationship_kind: relationship.relationship_kind,
      participants: [...relationship.participants],
      scope: relationship.scope,
      information: [...(relationship.information ?? [])],
      required_intermediates: [...(relationship.required_intermediates ?? [])],
      conditions: [...(relationship.conditions ?? [])],
      unresolved: buildUnresolved(relationship),
      evidence,
    };
  }

  if (!relationship.assertion) {
    return {
      status: 'unknown',
      reason: 'relationship_assertion_missing',
      relationship_id: relationship.id,
      relationship_kind: relationship.relationship_kind,
      participants: [...relationship.participants],
      scope: relationship.scope,
      information: [...(relationship.information ?? [])],
      required_intermediates: [...(relationship.required_intermediates ?? [])],
      conditions: [...(relationship.conditions ?? [])],
      unresolved: ['relationship_assertion_missing', ...buildUnresolved(relationship)],
      evidence,
    };
  }

  if (relationship.assertion === 'negative') {
    return {
      status: 'explicit_negative',
      reason: 'explicit_negative_assertion',
      relationship_id: relationship.id,
      relationship_kind: relationship.relationship_kind,
      participants: [...relationship.participants],
      scope: relationship.scope,
      information: [...(relationship.information ?? [])],
      required_intermediates: [...(relationship.required_intermediates ?? [])],
      conditions: [...(relationship.conditions ?? [])],
      unresolved: buildUnresolved(relationship),
      evidence,
    };
  }

  return {
    status: 'positive',
    reason: 'positive_assertion',
    relationship_id: relationship.id,
    relationship_kind: relationship.relationship_kind,
    participants: [...relationship.participants],
    scope: relationship.scope,
    information: [...(relationship.information ?? [])],
    required_intermediates: [...(relationship.required_intermediates ?? [])],
    conditions: [...(relationship.conditions ?? [])],
    unresolved: buildUnresolved(relationship),
    evidence,
  };
};

export const interpretInteractionRelationships = (
  relationships: readonly InteractionRelationship[],
  query?: InteractionInterpretationQuery,
): readonly InteractionInterpretationResult[] => {
  const matchingRelationships = [...relationships]
    .filter((relationship) => matchesInterpretationQuery(relationship, query))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (matchingRelationships.length === 0) {
    return [
      {
        status: 'unknown',
        reason: 'no_applicable_reviewed_relationship',
        participants: [],
        information: [],
        required_intermediates: [],
        conditions: [],
        unresolved: ['no_applicable_reviewed_relationship'],
        evidence: { source_ids: [], fact_ids: [] },
      },
    ];
  }

  return matchingRelationships.map((relationship) =>
    interpretInteractionRelationship(relationship),
  );
};
