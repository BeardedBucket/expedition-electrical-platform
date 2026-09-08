import type {
  InstalledInteractionEvaluationResult,
  InstalledInteractionParticipantMapping,
  InstalledInteractionParticipantTarget,
  ReviewedInteractionRelationship,
} from './installed-interaction-evaluation.js';

export interface InstalledCommunicationInteraction {
  readonly reviewed_relationship: ReviewedInteractionRelationship;
  readonly evaluation: InstalledInteractionEvaluationResult;
}

export interface InstalledCommunicationInterpretationInput {
  readonly interactions: readonly InstalledCommunicationInteraction[];
}

export interface InstalledCommunicationSupportPath {
  readonly reviewed_relationship_id: string;
  readonly source_claim_id?: string;
  readonly consumer_claim_id?: string;
  readonly distribution_id?: string;
  readonly control_claim_id?: string;
  readonly selected_relationship_id?: string;
  readonly selected_network_id?: string;
  readonly selected_prerequisite_topology_ids: readonly string[];
  readonly source_ids: readonly string[];
  readonly fact_ids: readonly string[];
}

export interface InstalledInformationAvailability {
  readonly id: string;
  readonly kind: 'information';
  readonly term: string;
  readonly source: {
    readonly reviewed_participant_id: string;
    readonly target: InstalledInteractionParticipantTarget;
  };
  readonly consumer: {
    readonly reviewed_participant_id: string;
    readonly target: InstalledInteractionParticipantTarget;
  };
  readonly support: readonly InstalledCommunicationSupportPath[];
}

export interface InstalledControlAvailability {
  readonly id: string;
  readonly kind: 'control';
  readonly action: string;
  readonly controller: {
    readonly reviewed_participant_id: string;
    readonly target: InstalledInteractionParticipantTarget;
  };
  readonly target: {
    readonly reviewed_participant_id: string;
    readonly target: InstalledInteractionParticipantTarget;
  };
  readonly support: readonly InstalledCommunicationSupportPath[];
}

export type InstalledCommunicationDiagnosticCode =
  | 'ambiguous_information_source'
  | 'invalid_relationship_evaluation'
  | 'missing_participant_mapping';

export interface InstalledCommunicationDiagnostic {
  readonly code: InstalledCommunicationDiagnosticCode;
  readonly relationship_id: string;
  readonly detail: string;
}

export interface InstalledCommunicationInterpretation {
  readonly information_availability: readonly InstalledInformationAvailability[];
  readonly control_availability: readonly InstalledControlAvailability[];
  readonly diagnostics: readonly InstalledCommunicationDiagnostic[];
}

const targetKey = (target: InstalledInteractionParticipantTarget): string =>
  target.kind === 'component_instance'
    ? `component_instance:${target.instance_id}`
    : target.kind === 'interaction_endpoint'
      ? `interaction_endpoint:${target.endpoint.instance_id}:${target.endpoint.endpoint_id}`
      : `installed_artifact:${target.artifact_id}`;

const supportKey = (support: InstalledCommunicationSupportPath): string =>
  [
    support.reviewed_relationship_id,
    support.source_claim_id ?? '',
    support.consumer_claim_id ?? '',
    support.distribution_id ?? '',
    support.control_claim_id ?? '',
  ].join('|');

const makeSupport = (
  relationship: ReviewedInteractionRelationship,
  evaluation: InstalledInteractionEvaluationResult,
  extra: Pick<
    InstalledCommunicationSupportPath,
    'source_claim_id' | 'consumer_claim_id' | 'distribution_id' | 'control_claim_id'
  >,
): InstalledCommunicationSupportPath => ({
  reviewed_relationship_id: relationship.id,
  ...extra,
  ...(evaluation.provenance.selected_relationship_id
    ? { selected_relationship_id: evaluation.provenance.selected_relationship_id }
    : {}),
  ...(evaluation.provenance.selected_network_id
    ? { selected_network_id: evaluation.provenance.selected_network_id }
    : {}),
  selected_prerequisite_topology_ids: [
    ...evaluation.provenance.selected_prerequisite_topology_ids,
  ].sort(),
  source_ids: [...relationship.evidence.source_ids].sort(),
  fact_ids: [...relationship.evidence.fact_ids].sort(),
});

const addSupport = <T extends { support: readonly InstalledCommunicationSupportPath[] }>(
  item: T,
  support: InstalledCommunicationSupportPath,
): T => ({
  ...item,
  support: [...item.support, support].sort((left, right) =>
    supportKey(left).localeCompare(supportKey(right)),
  ),
});

const mappingMap = (
  mappings: readonly InstalledInteractionParticipantMapping[],
): Map<string, InstalledInteractionParticipantMapping> => {
  const result = new Map<string, InstalledInteractionParticipantMapping>();
  for (const mapping of mappings) {
    if (result.has(mapping.participant_id)) {
      throw new Error(`Duplicate participant mapping '${mapping.participant_id}'.`);
    }
    result.set(mapping.participant_id, mapping);
  }
  return result;
};

export const interpretInstalledCommunicationSystem = (
  input: InstalledCommunicationInterpretationInput,
): InstalledCommunicationInterpretation => {
  const information = new Map<string, InstalledInformationAvailability>();
  const controls = new Map<string, InstalledControlAvailability>();
  const diagnostics: InstalledCommunicationDiagnostic[] = [];

  for (const interaction of input.interactions) {
    const { reviewed_relationship: relationship, evaluation } = interaction;
    if (
      evaluation.relationship_id !== relationship.id ||
      evaluation.provenance.reviewed_relationship_id !== relationship.id
    ) {
      throw new Error(
        `Evaluation relationship_id '${evaluation.relationship_id}' does not match relationship '${relationship.id}'.`,
      );
    }
    if (evaluation.status !== 'satisfied') continue;

    const mappings = mappingMap(evaluation.provenance.participant_mappings);
    const requiredParticipantIds = new Set(
      relationship.normalized_participants.map((item) => item.id),
    );
    const missing = [...requiredParticipantIds].filter((id) => !mappings.has(id)).sort();
    if (missing.length > 0) {
      throw new Error(
        `Satisfied evaluation is missing participant mappings: ${missing.join(', ')}.`,
      );
    }

    const claims = relationship.normalized_information ?? [];
    const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
    const exposersByTerm = new Map<string, typeof claims>();
    const consumersByTerm = new Map<string, typeof claims>();
    for (const claim of claims) {
      const collection = claim.direction === 'exposes' ? exposersByTerm : consumersByTerm;
      collection.set(claim.term, [...(collection.get(claim.term) ?? []), claim]);
    }

    const pairs: Array<{
      source: (typeof claims)[number];
      consumer: (typeof claims)[number];
      distribution_id?: string;
    }> = [];
    const distributions = relationship.information_distributions ?? [];
    for (const distribution of distributions) {
      const source = claimsById.get(distribution.source_claim_id);
      if (!source || source.direction !== 'exposes') continue;
      if (distribution.kind === 'explicit_consumers') {
        for (const consumerId of distribution.consumer_claim_ids ?? []) {
          const consumer = claimsById.get(consumerId);
          if (consumer?.direction === 'consumes' && consumer.term === source.term) {
            pairs.push({ source, consumer, distribution_id: distribution.id });
          }
        }
      } else {
        for (const consumer of consumersByTerm.get(source.term) ?? []) {
          pairs.push({ source, consumer, distribution_id: distribution.id });
        }
      }
    }
    if (distributions.length === 0) {
      for (const [term, sources] of exposersByTerm) {
        const consumers = consumersByTerm.get(term) ?? [];
        if (sources.length === 1 && consumers.length === 1) {
          pairs.push({ source: sources[0]!, consumer: consumers[0]! });
        } else if (sources.length > 1 && consumers.length > 0) {
          diagnostics.push({
            code: 'ambiguous_information_source',
            relationship_id: relationship.id,
            detail: `Multiple exposing claims could supply term '${term}'.`,
          });
        }
      }
    }
    for (const pair of pairs) {
      if (pair.source.participant_id === pair.consumer.participant_id) continue;
      const sourceMapping = mappings.get(pair.source.participant_id);
      const consumerMapping = mappings.get(pair.consumer.participant_id);
      if (!sourceMapping || !consumerMapping) continue;
      const key = `${pair.source.term}|${targetKey(sourceMapping.target)}|${targetKey(consumerMapping.target)}`;
      const support = makeSupport(relationship, evaluation, {
        source_claim_id: pair.source.id,
        consumer_claim_id: pair.consumer.id,
        ...(pair.distribution_id ? { distribution_id: pair.distribution_id } : {}),
      });
      const existing = information.get(key);
      information.set(
        key,
        existing
          ? addSupport(existing, support)
          : {
              id: `information:${encodeURIComponent(key)}`,
              kind: 'information',
              term: pair.source.term,
              source: {
                reviewed_participant_id: pair.source.participant_id,
                target: sourceMapping.target,
              },
              consumer: {
                reviewed_participant_id: pair.consumer.participant_id,
                target: consumerMapping.target,
              },
              support: [support],
            },
      );
    }

    for (const claim of relationship.control_claims ?? []) {
      const controller = mappings.get(claim.controller_participant_id);
      const target = mappings.get(claim.target_participant_id);
      if (!controller || !target || claim.controller_participant_id === claim.target_participant_id)
        continue;
      const key = `${claim.action}|${targetKey(controller.target)}|${targetKey(target.target)}`;
      const support = makeSupport(relationship, evaluation, { control_claim_id: claim.id });
      const existing = controls.get(key);
      controls.set(
        key,
        existing
          ? addSupport(existing, support)
          : {
              id: `control:${encodeURIComponent(key)}`,
              kind: 'control',
              action: claim.action,
              controller: {
                reviewed_participant_id: claim.controller_participant_id,
                target: controller.target,
              },
              target: {
                reviewed_participant_id: claim.target_participant_id,
                target: target.target,
              },
              support: [support],
            },
      );
    }
  }

  const sortFact = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id);
  return {
    information_availability: [...information.values()].sort(sortFact),
    control_availability: [...controls.values()].sort(sortFact),
    diagnostics: diagnostics.sort((left, right) =>
      `${left.relationship_id}|${left.code}|${left.detail}`.localeCompare(
        `${right.relationship_id}|${right.code}|${right.detail}`,
      ),
    ),
  };
};
