import type { ComponentLibraryRecord } from './component-library.js';
import type { ReferenceSource, ReferenceSystem } from './reference-system.js';
import type {
  InstalledInteractionEndpointRef,
  InstalledInteractionNetwork,
  InstalledDirectInteractionRelationship,
  InstalledInteractionConfiguration,
} from './installed-interactions.js';

export type InstalledInteractionEvaluationStatus = 'satisfied' | 'not_satisfied' | 'unknown';

export type InstalledInteractionParticipantTarget =
  | { readonly kind: 'component_instance'; readonly instance_id: string }
  | { readonly kind: 'interaction_endpoint'; readonly endpoint: InstalledInteractionEndpointRef }
  | { readonly kind: 'installed_artifact'; readonly artifact_id: string };

export interface InstalledInteractionParticipantMapping {
  readonly participant_id: string;
  readonly target: InstalledInteractionParticipantTarget;
}

export type InstalledInteractionSelectedTopology =
  | { readonly kind: 'direct'; readonly relationship_id: string }
  | { readonly kind: 'network'; readonly network_id: string };

export interface InstalledInteractionPrerequisiteTopologySelection {
  readonly prerequisite_id: string;
  readonly topology: InstalledInteractionSelectedTopology;
}

export interface InstalledInteractionQualifier {
  readonly target:
    | { readonly kind: 'component_instance'; readonly instance_id: string }
    | { readonly kind: 'interaction_endpoint'; readonly endpoint: InstalledInteractionEndpointRef };
  readonly kind: 'firmware' | 'hardware_revision';
  readonly value: string;
  readonly source_refs: readonly ReferenceSource[];
}

export interface InstalledInteractionEvaluationContext {
  readonly qualifiers?: readonly InstalledInteractionQualifier[];
}

export type InstalledInteractionEvaluationReasonCode =
  | 'reviewed_assertion_positive'
  | 'reviewed_assertion_negative'
  | 'reviewed_assertion_unknown'
  | 'reviewed_evidence_conflicting'
  | 'participant_mapping_missing'
  | 'participant_mapping_ambiguous'
  | 'participant_component_mismatch'
  | 'participant_endpoint_mismatch'
  | 'participant_target_kind_mismatch'
  | 'unresolved_participant'
  | 'installed_relationship_connected'
  | 'installed_relationship_disconnected'
  | 'installed_relationship_missing'
  | 'topology_requirement_satisfied'
  | 'topology_requirement_not_satisfied'
  | 'topology_requirement_unknown'
  | 'applicability_satisfied'
  | 'applicability_mismatch'
  | 'applicability_unknown'
  | 'configuration_satisfied'
  | 'configuration_not_satisfied'
  | 'configuration_unknown'
  | 'required_intermediate_present'
  | 'required_intermediate_missing'
  | 'required_intermediate_unknown'
  | 'unresolved_prerequisite'
  | 'prerequisite_satisfied'
  | 'prerequisite_not_satisfied'
  | 'prerequisite_unknown'
  | 'qualifier_conflicting';

export interface InstalledInteractionEvaluationReason {
  readonly code: InstalledInteractionEvaluationReasonCode;
  readonly subject_id?: string;
  readonly detail: string;
}

export interface InstalledInteractionEvaluationProvenance {
  readonly reviewed_relationship_id: string;
  readonly reviewed_assertion: 'positive' | 'negative' | 'unknown';
  readonly reviewed_state: ReviewedInteractionState;
  readonly reviewed_source_ids: readonly string[];
  readonly reviewed_fact_ids: readonly string[];
  readonly participant_mappings: readonly InstalledInteractionParticipantMapping[];
  readonly selected_relationship_id?: string;
  readonly selected_network_id?: string;
  readonly selected_prerequisite_topology_ids: readonly string[];
  readonly applicability_ids: readonly string[];
  readonly prerequisite_ids: readonly string[];
  readonly configuration_ids: readonly string[];
  readonly intermediate_object_ids: readonly string[];
  readonly qualifier_source_refs: readonly string[];
}

export interface InstalledInteractionEvaluationResult {
  readonly status: InstalledInteractionEvaluationStatus;
  readonly relationship_id: string;
  readonly assertion: 'positive' | 'negative' | 'unknown';
  readonly reasons: readonly InstalledInteractionEvaluationReason[];
  readonly provenance: InstalledInteractionEvaluationProvenance;
}

export type ReviewedInteractionState = 'verified' | 'provisional' | 'unresolved' | 'conflicting';
export type ReviewedParticipantReference =
  | { readonly kind: 'component'; readonly component_id: string }
  | {
      readonly kind: 'interaction_endpoint';
      readonly component_id: string;
      readonly endpoint_id: string;
    }
  | { readonly kind: 'unresolved_external'; readonly reference: string };

export interface ReviewedInteractionParticipant {
  readonly id: string;
  readonly reference: ReviewedParticipantReference;
}

export type ReviewedConfigurationValue = string | number | boolean | null;
export type ReviewedInteractionPrerequisite =
  | { readonly id: string; readonly kind: 'intermediate'; readonly participant_id: string }
  | {
      readonly id: string;
      readonly kind: 'configuration';
      readonly target:
        | { readonly kind: 'participant'; readonly participant_id: string }
        | { readonly kind: 'relationship' };
      readonly key: string;
      readonly operator: 'equals' | 'present';
      readonly value?: ReviewedConfigurationValue;
    }
  | {
      readonly id: string;
      readonly kind: 'connection';
      readonly participant_ids: readonly [string, string];
      readonly topology: 'direct' | 'shared_network' | 'direct_or_shared_network';
    }
  | { readonly id: string; readonly kind: 'other'; readonly raw_value: string };

export interface ReviewedInteractionApplicability {
  readonly id: string;
  readonly target_participant_id?: string;
  readonly kind: 'firmware' | 'hardware_revision' | 'other';
  readonly operator?: 'equals';
  readonly value?: string;
  readonly raw_value?: string;
}

export interface ReviewedInteractionRelationship {
  readonly id: string;
  readonly assertion?: 'positive' | 'negative';
  readonly state: ReviewedInteractionState;
  readonly normalized_participants: readonly ReviewedInteractionParticipant[];
  readonly normalized_information?: readonly {
    readonly direction: 'exposes' | 'consumes';
    readonly participant_id: string;
    readonly term: string;
  }[];
  readonly applicability?: readonly ReviewedInteractionApplicability[];
  readonly prerequisites?: readonly ReviewedInteractionPrerequisite[];
  readonly evidence: {
    readonly source_ids: readonly string[];
    readonly fact_ids: readonly string[];
  };
}

export interface InstalledInteractionEvaluationInput {
  readonly relationship: ReviewedInteractionRelationship;
  readonly reference_system: ReferenceSystem;
  readonly catalog: readonly ComponentLibraryRecord[];
  readonly mappings: readonly InstalledInteractionParticipantMapping[];
  readonly selected_topology?: InstalledInteractionSelectedTopology;
  readonly prerequisite_topology_selections?: readonly InstalledInteractionPrerequisiteTopologySelection[];
  readonly context?: InstalledInteractionEvaluationContext;
}

const reason = (
  code: InstalledInteractionEvaluationReasonCode,
  detail: string,
  subject_id?: string,
): InstalledInteractionEvaluationReason => ({
  code,
  detail,
  ...(subject_id ? { subject_id } : {}),
});

const sameValue = (left: unknown, right: unknown): boolean =>
  typeof left === typeof right && left === right;

const endpointKey = (endpoint: InstalledInteractionEndpointRef): string =>
  `${endpoint.instance_id}:${endpoint.endpoint_id}`;

const targetEndpoint = (
  target: InstalledInteractionParticipantTarget,
): InstalledInteractionEndpointRef | undefined =>
  target.kind === 'interaction_endpoint' ? target.endpoint : undefined;

const targetInstanceId = (target: InstalledInteractionParticipantTarget): string | undefined =>
  target.kind === 'component_instance'
    ? target.instance_id
    : target.kind === 'interaction_endpoint'
      ? target.endpoint.instance_id
      : undefined;

const topologyParticipants = (
  topology: InstalledDirectInteractionRelationship | InstalledInteractionNetwork,
): readonly InstalledInteractionEndpointRef[] => topology.participants.map((item) => item.endpoint);

const findConfiguration = (
  configurations: readonly InstalledInteractionConfiguration[],
  prerequisite: Extract<ReviewedInteractionPrerequisite, { kind: 'configuration' }>,
  mappings: ReadonlyMap<string, InstalledInteractionParticipantMapping>,
  topology: InstalledInteractionSelectedTopology | undefined,
): InstalledInteractionConfiguration | undefined =>
  configurations.find((configuration) => {
    if (configuration.key !== prerequisite.key) return false;
    if (prerequisite.target.kind === 'relationship') {
      return (
        topology?.kind === 'direct' &&
        'relationship_id' in configuration.target &&
        configuration.target.relationship_id === topology.relationship_id
      );
    }
    const mapping = mappings.get(prerequisite.target.participant_id);
    const endpoint = mapping && targetEndpoint(mapping.target);
    return (
      endpoint !== undefined &&
      'endpoint' in configuration.target &&
      endpointKey(configuration.target.endpoint) === endpointKey(endpoint)
    );
  });

const evaluate = (
  input: InstalledInteractionEvaluationInput,
): InstalledInteractionEvaluationResult => {
  const { relationship, reference_system: system, catalog } = input;
  const reasons: InstalledInteractionEvaluationReason[] = [];
  const mappings = new Map<string, InstalledInteractionParticipantMapping>();
  const instances = new Map((system.component_instances ?? []).map((item) => [item.id, item]));
  const artifacts = new Map((system.artifacts ?? []).map((item) => [item.id, item]));
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const applicabilityIds = (relationship.applicability ?? []).map((item) => item.id);
  const prerequisiteIds = (relationship.prerequisites ?? []).map((item) => item.id);
  const configurationIds: string[] = [];
  const intermediateObjectIds: string[] = [];
  const qualifierSourceRefs: string[] = [];
  let definitiveFailure = false;
  let unresolved = false;
  let applicabilityUnknown = false;

  for (const mapping of input.mappings) {
    if (mappings.has(mapping.participant_id)) {
      reasons.push(
        reason(
          'participant_mapping_ambiguous',
          'Duplicate participant mapping.',
          mapping.participant_id,
        ),
      );
      unresolved = true;
    } else mappings.set(mapping.participant_id, mapping);
  }

  const endpointValid = (endpoint: InstalledInteractionEndpointRef): boolean => {
    const instance = instances.get(endpoint.instance_id);
    const component = instance && catalogById.get(instance.component_id);
    return Boolean(
      component?.interaction_endpoints?.some((item) => item.id === endpoint.endpoint_id),
    );
  };

  for (const participant of relationship.normalized_participants) {
    const mapping = mappings.get(participant.id);
    if (!mapping) {
      reasons.push(
        reason(
          'participant_mapping_missing',
          'Required participant mapping is missing.',
          participant.id,
        ),
      );
      unresolved = true;
      continue;
    }
    const reference = participant.reference;
    if (reference.kind === 'unresolved_external') {
      reasons.push(
        reason('unresolved_participant', 'Canonical participant is unresolved.', participant.id),
      );
      unresolved = true;
      continue;
    }
    const instanceId = targetInstanceId(mapping.target);
    const instance = instanceId && instances.get(instanceId);
    if (!instance) {
      reasons.push(
        reason(
          'participant_mapping_missing',
          'Mapped installed object does not exist.',
          participant.id,
        ),
      );
      unresolved = true;
      continue;
    }
    if (reference.kind === 'component') {
      if (mapping.target.kind !== 'component_instance') {
        reasons.push(
          reason(
            'participant_target_kind_mismatch',
            'Component participants require component instances.',
            participant.id,
          ),
        );
        unresolved = true;
      } else if (instance.component_id !== reference.component_id) {
        reasons.push(
          reason(
            'participant_component_mismatch',
            'Installed component does not match canonical component.',
            participant.id,
          ),
        );
        unresolved = true;
      }
    } else if (
      mapping.target.kind !== 'interaction_endpoint' ||
      instance.component_id !== reference.component_id ||
      mapping.target.endpoint.endpoint_id !== reference.endpoint_id ||
      !endpointValid(mapping.target.endpoint)
    ) {
      reasons.push(
        reason(
          'participant_endpoint_mismatch',
          'Installed endpoint does not match canonical endpoint.',
          participant.id,
        ),
      );
      unresolved = true;
    }
  }

  const qualifierFor = (participantId: string, kind: 'firmware' | 'hardware_revision') => {
    const mapping = mappings.get(participantId);
    const targetInstance = mapping && targetInstanceId(mapping.target);
    const endpoint = mapping && targetEndpoint(mapping.target);
    const matches = (input.context?.qualifiers ?? []).filter(
      (qualifier) =>
        qualifier.kind === kind &&
        ((qualifier.target.kind === 'component_instance' &&
          qualifier.target.instance_id === targetInstance) ||
          (qualifier.target.kind === 'interaction_endpoint' &&
            endpoint !== undefined &&
            endpointKey(qualifier.target.endpoint) === endpointKey(endpoint))),
    );
    matches.forEach((qualifier) =>
      qualifier.source_refs.forEach((source) => qualifierSourceRefs.push(source.id)),
    );
    return matches;
  };

  let applicabilityInapplicable = false;
  for (const applicability of relationship.applicability ?? []) {
    if (
      applicability.kind === 'other' ||
      !applicability.target_participant_id ||
      !applicability.value
    ) {
      reasons.push(
        reason('applicability_unknown', 'Applicability cannot be evaluated.', applicability.id),
      );
      unresolved = true;
      applicabilityUnknown = true;
      continue;
    }
    const qualifiers = qualifierFor(applicability.target_participant_id, applicability.kind);
    if (qualifiers.length === 0) {
      reasons.push(
        reason(
          'applicability_unknown',
          'Required installed qualifier is missing.',
          applicability.id,
        ),
      );
      unresolved = true;
      applicabilityUnknown = true;
    } else if (new Set(qualifiers.map((item) => item.value)).size > 1) {
      reasons.push(
        reason(
          'qualifier_conflicting',
          'Contradictory installed qualifier values exist.',
          applicability.id,
        ),
      );
      unresolved = true;
      applicabilityUnknown = true;
    } else if (qualifiers[0]?.value !== applicability.value) {
      reasons.push(
        reason(
          'applicability_mismatch',
          'Reviewed applicability does not match installed qualifier.',
          applicability.id,
        ),
      );
      applicabilityInapplicable = true;
    } else
      reasons.push(
        reason(
          'applicability_satisfied',
          'Reviewed applicability matches installed qualifier.',
          applicability.id,
        ),
      );
  }

  if (relationship.state === 'conflicting')
    reasons.push(reason('reviewed_evidence_conflicting', 'Reviewed evidence is conflicting.'));
  else if (relationship.state !== 'verified' || !relationship.assertion) {
    reasons.push(
      reason('reviewed_assertion_unknown', 'Reviewed assertion is not verified and explicit.'),
    );
  } else if (relationship.assertion === 'positive')
    reasons.push(reason('reviewed_assertion_positive', 'Verified positive reviewed assertion.'));
  else reasons.push(reason('reviewed_assertion_negative', 'Verified negative reviewed assertion.'));

  const selectedTopology = input.selected_topology;
  const selected =
    selectedTopology?.kind === 'direct'
      ? system.interaction_relationships?.find(
          (item) => item.id === selectedTopology.relationship_id,
        )
      : selectedTopology?.kind === 'network'
        ? system.interaction_networks?.find((item) => item.id === selectedTopology.network_id)
        : undefined;
  if (!selected) {
    reasons.push(
      reason('installed_relationship_missing', 'No selected installed topology was supplied.'),
    );
    unresolved = true;
  } else if (selected.state === 'connected')
    reasons.push(
      reason(
        'installed_relationship_connected',
        'Selected topology is explicitly connected.',
        selected.id,
      ),
    );
  else
    reasons.push(
      reason(
        'installed_relationship_disconnected',
        'Selected topology is explicitly disconnected.',
        selected.id,
      ),
    );
  if (selected) {
    for (const mapping of mappings.values()) {
      const mappedInstanceId =
        mapping.target.kind === 'component_instance' ? mapping.target.instance_id : undefined;
      if (
        mappedInstanceId &&
        !topologyParticipants(selected).some(
          (endpoint) => endpoint.instance_id === mappedInstanceId,
        )
      ) {
        reasons.push(
          reason(
            'topology_requirement_unknown',
            'Selected topology does not represent a mapped component instance.',
            mapping.participant_id,
          ),
        );
        unresolved = true;
      }
    }
  }

  const topologyFor = (prerequisiteId: string) => {
    const selection = input.prerequisite_topology_selections?.find(
      (item) => item.prerequisite_id === prerequisiteId,
    );
    if (!selection) return undefined;
    const selectedPrerequisiteTopology = selection.topology;
    return selectedPrerequisiteTopology.kind === 'direct'
      ? system.interaction_relationships?.find(
          (item) => item.id === selectedPrerequisiteTopology.relationship_id,
        )
      : system.interaction_networks?.find(
          (item) => item.id === selectedPrerequisiteTopology.network_id,
        );
  };

  const mappedTargets = (ids: readonly string[]) => ids.map((id) => mappings.get(id)?.target);

  const topologyContainsTargets = (
    topology: InstalledDirectInteractionRelationship | InstalledInteractionNetwork,
    targets: readonly (InstalledInteractionParticipantTarget | undefined)[],
  ): boolean => {
    const endpoints = topologyParticipants(topology);
    return targets.every((target) => {
      if (!target) return false;
      if (target.kind === 'component_instance') {
        return endpoints.some((endpoint) => endpoint.instance_id === target.instance_id);
      }
      if (target.kind === 'interaction_endpoint') {
        return endpoints.some((endpoint) => endpointKey(endpoint) === endpointKey(target.endpoint));
      }
      return false;
    });
  };

  if (
    !applicabilityInapplicable &&
    !applicabilityUnknown &&
    relationship.state === 'verified' &&
    relationship.assertion
  ) {
    for (const prerequisite of relationship.prerequisites ?? []) {
      if (prerequisite.kind === 'other') {
        reasons.push(reason('unresolved_prerequisite', prerequisite.raw_value, prerequisite.id));
        unresolved = true;
      } else if (prerequisite.kind === 'configuration') {
        const configuration = findConfiguration(
          system.interaction_configurations ?? [],
          prerequisite,
          mappings,
          input.selected_topology,
        );
        if (!configuration) {
          reasons.push(
            reason(
              'configuration_unknown',
              'Matching installed configuration is missing.',
              prerequisite.id,
            ),
          );
          unresolved = true;
        } else {
          configurationIds.push(configuration.id);
          if (
            prerequisite.operator === 'present' ||
            sameValue(configuration.value, prerequisite.value)
          ) {
            reasons.push(
              reason(
                'configuration_satisfied',
                'Installed configuration satisfies prerequisite.',
                prerequisite.id,
              ),
            );
          } else {
            reasons.push(
              reason(
                'configuration_not_satisfied',
                'Installed configuration value differs.',
                prerequisite.id,
              ),
            );
            definitiveFailure = true;
          }
        }
      } else if (prerequisite.kind === 'intermediate') {
        const mapping = mappings.get(prerequisite.participant_id);
        const target = mapping?.target;
        const objectId =
          target?.kind === 'installed_artifact'
            ? target.artifact_id
            : targetInstanceId(target as InstalledInteractionParticipantTarget);
        if (
          !objectId ||
          (target?.kind === 'installed_artifact'
            ? !artifacts.has(objectId)
            : !instances.has(objectId))
        ) {
          reasons.push(
            reason(
              'required_intermediate_unknown',
              'Intermediate mapping is unavailable.',
              prerequisite.id,
            ),
          );
          unresolved = true;
        } else {
          const topology = topologyFor(prerequisite.id);
          if (!topology || topology.intermediate_object_ids === undefined) {
            reasons.push(
              reason(
                'required_intermediate_unknown',
                'Installed intermediate list is missing.',
                prerequisite.id,
              ),
            );
            unresolved = true;
          } else if (topology.intermediate_object_ids.includes(objectId)) {
            intermediateObjectIds.push(objectId);
            reasons.push(
              reason(
                'required_intermediate_present',
                'Required intermediate is explicitly listed.',
                prerequisite.id,
              ),
            );
          } else {
            reasons.push(
              reason(
                'required_intermediate_unknown',
                'Installed intermediate list is not defined as complete.',
                prerequisite.id,
              ),
            );
            unresolved = true;
          }
        }
      } else if (prerequisite.kind === 'connection') {
        const targets = mappedTargets(prerequisite.participant_ids);
        if (targets.some((target) => target === undefined)) {
          reasons.push(
            reason(
              'topology_requirement_unknown',
              'Connection participant mapping is unavailable.',
              prerequisite.id,
            ),
          );
          unresolved = true;
          continue;
        }
        const selection = input.prerequisite_topology_selections?.find(
          (item) => item.prerequisite_id === prerequisite.id,
        );
        const topology = selection && topologyFor(prerequisite.id);
        if (
          !topology ||
          (prerequisite.topology === 'direct' && selection?.topology.kind !== 'direct') ||
          (prerequisite.topology === 'shared_network' && selection?.topology.kind !== 'network')
        ) {
          reasons.push(
            reason(
              'topology_requirement_unknown',
              'Required topology form was not selected.',
              prerequisite.id,
            ),
          );
          unresolved = true;
        } else if (topologyContainsTargets(topology, targets)) {
          if (topology.state === 'connected')
            reasons.push(
              reason(
                'topology_requirement_satisfied',
                'Required topology is explicitly connected.',
                prerequisite.id,
              ),
            );
          else {
            reasons.push(
              reason(
                'topology_requirement_not_satisfied',
                'Required topology is explicitly disconnected.',
                prerequisite.id,
              ),
            );
            definitiveFailure = true;
          }
        } else {
          reasons.push(
            reason(
              'topology_requirement_unknown',
              'Selected topology does not represent the required participant pair.',
              prerequisite.id,
            ),
          );
          unresolved = true;
        }
      }
    }
    if (
      selected?.state === 'disconnected' &&
      !applicabilityInapplicable &&
      !applicabilityUnknown &&
      relationship.state === 'verified' &&
      relationship.assertion
    ) {
      definitiveFailure = true;
    }
  }

  const assertion = relationship.assertion ?? 'unknown';
  let status: InstalledInteractionEvaluationStatus = 'unknown';
  if (
    relationship.state === 'verified' &&
    relationship.assertion &&
    !applicabilityInapplicable &&
    !applicabilityUnknown
  ) {
    if (definitiveFailure || relationship.assertion === 'negative') status = 'not_satisfied';
    else if (!unresolved) status = 'satisfied';
  }
  return {
    status,
    relationship_id: relationship.id,
    assertion,
    reasons,
    provenance: {
      reviewed_relationship_id: relationship.id,
      reviewed_assertion: assertion,
      reviewed_state: relationship.state,
      reviewed_source_ids: relationship.evidence.source_ids,
      reviewed_fact_ids: relationship.evidence.fact_ids,
      participant_mappings: input.mappings,
      ...(input.selected_topology?.kind === 'direct'
        ? { selected_relationship_id: input.selected_topology.relationship_id }
        : {}),
      ...(input.selected_topology?.kind === 'network'
        ? { selected_network_id: input.selected_topology.network_id }
        : {}),
      selected_prerequisite_topology_ids: (input.prerequisite_topology_selections ?? []).map(
        (item) => {
          if (item.topology.kind === 'direct') return item.topology.relationship_id;
          return item.topology.network_id;
        },
      ),
      applicability_ids: applicabilityIds,
      prerequisite_ids: prerequisiteIds,
      configuration_ids: configurationIds,
      intermediate_object_ids: intermediateObjectIds,
      qualifier_source_refs: [...new Set(qualifierSourceRefs)],
    },
  };
};

export const evaluateInstalledInteraction = (
  input: InstalledInteractionEvaluationInput,
): InstalledInteractionEvaluationResult => evaluate(input);
