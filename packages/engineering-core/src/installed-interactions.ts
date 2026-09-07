import type { ComponentLibraryRecord } from './component-library.js';
import type {
  ComponentInstance,
  ConnectionEndpoint,
  ReferenceConnection,
  ReferenceSource,
  ReferenceSystemIssue,
  ReferenceSystemIssueCode,
} from './reference-system.js';

export type InstalledInteractionState = 'connected' | 'disconnected';
export type InstalledInteractionMedium = 'wired' | 'wireless' | 'other';

export interface InstalledArtifact {
  readonly id: string;
  readonly kind: string;
  readonly label?: string | null;
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export interface InstalledInteractionEndpointRef {
  readonly instance_id: string;
  readonly endpoint_id: string;
}

export interface InstalledInteractionParticipant {
  readonly endpoint: InstalledInteractionEndpointRef;
  readonly role?: string | null;
}

export type InstalledInteractionPhysicalBindingTarget =
  | { readonly connection_id: string }
  | { readonly instance_id: string; readonly terminal_id: string };

export interface InstalledInteractionBinding {
  readonly id: string;
  readonly endpoint: InstalledInteractionEndpointRef;
  readonly target: InstalledInteractionPhysicalBindingTarget;
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export interface InstalledDirectInteractionRelationship {
  readonly id: string;
  readonly kind: 'direct';
  readonly participants: readonly InstalledInteractionParticipant[];
  readonly state: InstalledInteractionState;
  readonly medium?: InstalledInteractionMedium;
  readonly intermediate_object_ids?: readonly string[];
  readonly configuration_ids?: readonly string[];
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export interface InstalledInteractionNetwork {
  readonly id: string;
  readonly participants: readonly InstalledInteractionParticipant[];
  readonly state: InstalledInteractionState;
  readonly medium?: InstalledInteractionMedium;
  readonly intermediate_object_ids?: readonly string[];
  readonly configuration_ids?: readonly string[];
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export type InstalledInteractionConfigurationTarget =
  | { readonly endpoint: InstalledInteractionEndpointRef }
  | { readonly relationship_id: string }
  | { readonly network_id: string };

export type InstalledInteractionConfigurationValue = string | number | boolean | null;

export interface InstalledInteractionConfiguration {
  readonly id: string;
  readonly target: InstalledInteractionConfigurationTarget;
  readonly key: string;
  readonly value: InstalledInteractionConfigurationValue;
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export interface InstalledInteractionRelationshipGroup {
  readonly id: string;
  readonly relationship_ids: readonly string[];
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export interface InstalledInteractionValidationInput {
  readonly component_instances: readonly ComponentInstance[];
  readonly artifacts: readonly InstalledArtifact[];
  readonly connections: readonly ReferenceConnection[];
  readonly interaction_bindings: readonly InstalledInteractionBinding[];
  readonly interaction_relationships: readonly InstalledDirectInteractionRelationship[];
  readonly interaction_networks: readonly InstalledInteractionNetwork[];
  readonly interaction_configurations: readonly InstalledInteractionConfiguration[];
  readonly interaction_relationship_groups: readonly InstalledInteractionRelationshipGroup[];
  readonly catalogById: ReadonlyMap<string, ComponentLibraryRecord>;
}

const makeIssue = (
  code: ReferenceSystemIssueCode,
  category: ReferenceSystemIssue['category'],
  path: string,
  message: string,
): ReferenceSystemIssue => ({ code, category, path, message });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const isEndpoint = (value: unknown): value is InstalledInteractionEndpointRef =>
  isRecord(value) &&
  typeof value.instance_id === 'string' &&
  value.instance_id.length > 0 &&
  typeof value.endpoint_id === 'string' &&
  value.endpoint_id.length > 0;

const isBindingTarget = (value: unknown): value is InstalledInteractionPhysicalBindingTarget =>
  isRecord(value) &&
  ((typeof value.connection_id === 'string' && value.connection_id.length > 0) ||
    (typeof value.instance_id === 'string' &&
      value.instance_id.length > 0 &&
      typeof value.terminal_id === 'string' &&
      value.terminal_id.length > 0));

const addCollectionDuplicates = (
  issues: ReferenceSystemIssue[],
  collection: string,
  records: readonly { id: string }[],
  code: ReferenceSystemIssueCode,
) => {
  const seen = new Set<string>();
  records.forEach((record, index) => {
    if (typeof record?.id !== 'string' || record.id.length === 0) {
      issues.push(
        makeIssue(
          'invalid_schema_value',
          'invalid',
          `${collection}[${index}].id`,
          'must be a non-empty string.',
        ),
      );
    } else if (seen.has(record.id)) {
      issues.push(
        makeIssue(code, 'invalid', `${collection}[${index}].id`, `duplicate ID '${record.id}'.`),
      );
    } else {
      seen.add(record.id);
    }
  });
};

export const validateInstalledInteractionArchitecture = (
  input: InstalledInteractionValidationInput,
): ReferenceSystemIssue[] => {
  const issues: ReferenceSystemIssue[] = [];
  const instanceIds = new Set(input.component_instances.map((item) => item.id));
  const artifactIds = new Set(input.artifacts.map((item) => item.id));
  const connectionIds = new Set(input.connections.map((item) => item.id));
  const relationshipIds = new Set(input.interaction_relationships.map((item) => item.id));
  const networkIds = new Set(input.interaction_networks.map((item) => item.id));
  const configurationIds = new Set(input.interaction_configurations.map((item) => item.id));
  const objectIds = new Set<string>();
  input.component_instances.forEach((item) => objectIds.add(item.id));
  input.artifacts.forEach((item) => objectIds.add(item.id));

  addCollectionDuplicates(
    issues,
    'interaction_relationships',
    input.interaction_relationships,
    'duplicate_interaction_relationship_id',
  );
  addCollectionDuplicates(
    issues,
    'interaction_networks',
    input.interaction_networks,
    'duplicate_interaction_network_id',
  );
  addCollectionDuplicates(
    issues,
    'interaction_configurations',
    input.interaction_configurations,
    'duplicate_interaction_configuration_id',
  );
  addCollectionDuplicates(
    issues,
    'interaction_bindings',
    input.interaction_bindings,
    'duplicate_interaction_binding_id',
  );
  addCollectionDuplicates(
    issues,
    'interaction_relationship_groups',
    input.interaction_relationship_groups,
    'duplicate_interaction_group_id',
  );

  input.component_instances.forEach((item, index) => {
    if (artifactIds.has(item.id))
      issues.push(
        makeIssue(
          'duplicate_installed_object_id',
          'invalid',
          `component_instances[${index}].id`,
          `collides with installed artifact ID '${item.id}'.`,
        ),
      );
  });
  input.artifacts.forEach((item, index) => {
    if (typeof item.kind !== 'string' || item.kind.length === 0)
      issues.push(
        makeIssue(
          'invalid_schema_value',
          'invalid',
          `artifacts[${index}].kind`,
          'must be a non-empty string.',
        ),
      );
  });

  const validateEndpoint = (endpoint: unknown, path: string) => {
    if (!isEndpoint(endpoint)) {
      issues.push(
        makeIssue(
          'invalid_interaction_endpoint_reference',
          'invalid',
          path,
          'must contain instance_id and endpoint_id.',
        ),
      );
      return;
    }
    if (!instanceIds.has(endpoint.instance_id)) {
      issues.push(
        makeIssue(
          'missing_interaction_reference',
          'invalid',
          `${path}.instance_id`,
          `missing installed component instance '${endpoint.instance_id}'.`,
        ),
      );
      return;
    }
    const instance = input.component_instances.find((item) => item.id === endpoint.instance_id);
    const component = instance ? input.catalogById.get(instance.component_id) : undefined;
    if (!component) {
      issues.push(
        makeIssue(
          'unresolved_catalog_component',
          'unresolved',
          `${path}.instance_id`,
          'catalog component is unavailable.',
        ),
      );
      return;
    }
    if (!component.interaction_endpoints?.some((item) => item.id === endpoint.endpoint_id)) {
      issues.push(
        makeIssue(
          'invalid_interaction_endpoint_reference',
          'invalid',
          `${path}.endpoint_id`,
          `unknown interaction endpoint '${endpoint.endpoint_id}'.`,
        ),
      );
    }
  };

  const validateParticipantList = (
    participants: readonly InstalledInteractionParticipant[] | undefined,
    path: string,
    minimum: number,
    exact?: number,
  ) => {
    if (
      !Array.isArray(participants) ||
      (exact !== undefined ? participants.length !== exact : participants.length < minimum)
    ) {
      issues.push(
        makeIssue(
          'invalid_interaction_participants',
          'invalid',
          path,
          exact === undefined
            ? `must contain at least ${minimum} participants.`
            : `must contain exactly ${exact} participants.`,
        ),
      );
    }
    const safeParticipants = Array.isArray(participants) ? participants : [];
    const seen = new Set<string>();
    safeParticipants.forEach((participant, index) => {
      validateEndpoint(participant?.endpoint, `${path}[${index}].endpoint`);
      const key = isEndpoint(participant?.endpoint)
        ? `${participant.endpoint.instance_id}:${participant.endpoint.endpoint_id}`
        : '';
      if (key && seen.has(key))
        issues.push(
          makeIssue(
            'duplicate_interaction_participant',
            'invalid',
            `${path}[${index}]`,
            `duplicate participant '${key}'.`,
          ),
        );
      if (key) seen.add(key);
    });
  };

  const validateObjectRefs = (ids: readonly string[] | undefined, path: string) => {
    (ids ?? []).forEach((id, index) => {
      if (!objectIds.has(id))
        issues.push(
          makeIssue(
            'missing_interaction_reference',
            'invalid',
            `${path}[${index}]`,
            `missing installed object '${id}'.`,
          ),
        );
    });
  };

  input.interaction_relationships.forEach((relationship, index) => {
    if (relationship.kind !== 'direct')
      issues.push(
        makeIssue(
          'invalid_schema_value',
          'invalid',
          `interaction_relationships[${index}].kind`,
          'must be direct.',
        ),
      );
    if (!['connected', 'disconnected'].includes(relationship.state))
      issues.push(
        makeIssue(
          'invalid_interaction_state',
          'invalid',
          `interaction_relationships[${index}].state`,
          'must be connected or disconnected.',
        ),
      );
    if (
      relationship.medium !== undefined &&
      !['wired', 'wireless', 'other'].includes(relationship.medium)
    )
      issues.push(
        makeIssue(
          'invalid_interaction_medium',
          'invalid',
          `interaction_relationships[${index}].medium`,
          'invalid installed interaction medium.',
        ),
      );
    validateParticipantList(
      relationship.participants,
      `interaction_relationships[${index}].participants`,
      0,
      2,
    );
    validateObjectRefs(
      relationship.intermediate_object_ids,
      `interaction_relationships[${index}].intermediate_object_ids`,
    );
    (relationship.configuration_ids ?? []).forEach((id, refIndex) => {
      if (!configurationIds.has(id))
        issues.push(
          makeIssue(
            'missing_interaction_configuration',
            'invalid',
            `interaction_relationships[${index}].configuration_ids[${refIndex}]`,
            `missing configuration '${id}'.`,
          ),
        );
    });
  });

  input.interaction_networks.forEach((network, index) => {
    if (!['connected', 'disconnected'].includes(network.state))
      issues.push(
        makeIssue(
          'invalid_interaction_state',
          'invalid',
          `interaction_networks[${index}].state`,
          'must be connected or disconnected.',
        ),
      );
    if (network.medium !== undefined && !['wired', 'wireless', 'other'].includes(network.medium))
      issues.push(
        makeIssue(
          'invalid_interaction_medium',
          'invalid',
          `interaction_networks[${index}].medium`,
          'invalid installed interaction medium.',
        ),
      );
    validateParticipantList(network.participants, `interaction_networks[${index}].participants`, 2);
    validateObjectRefs(
      network.intermediate_object_ids,
      `interaction_networks[${index}].intermediate_object_ids`,
    );
    (network.configuration_ids ?? []).forEach((id, refIndex) => {
      if (!configurationIds.has(id))
        issues.push(
          makeIssue(
            'missing_interaction_configuration',
            'invalid',
            `interaction_networks[${index}].configuration_ids[${refIndex}]`,
            `missing configuration '${id}'.`,
          ),
        );
    });
  });

  input.interaction_bindings.forEach((binding, index) => {
    validateEndpoint(binding.endpoint, `interaction_bindings[${index}].endpoint`);
    if (!isBindingTarget(binding.target)) {
      issues.push(
        makeIssue(
          'invalid_interaction_binding_target',
          'invalid',
          `interaction_bindings[${index}].target`,
          'must reference a connection or installed terminal.',
        ),
      );
    } else if ('connection_id' in binding.target) {
      if (!connectionIds.has(binding.target.connection_id))
        issues.push(
          makeIssue(
            'missing_interaction_reference',
            'invalid',
            `interaction_bindings[${index}].target.connection_id`,
            `missing electrical connection '${binding.target.connection_id}'.`,
          ),
        );
    } else if ('instance_id' in binding.target) {
      const terminalTarget = binding.target;
      const instance = input.component_instances.find(
        (item) => item.id === terminalTarget.instance_id,
      );
      if (!instanceIds.has(terminalTarget.instance_id))
        issues.push(
          makeIssue(
            'missing_interaction_reference',
            'invalid',
            `interaction_bindings[${index}].target.instance_id`,
            `missing installed component instance '${terminalTarget.instance_id}'.`,
          ),
        );
      else if (
        !input.catalogById
          .get(instance?.component_id ?? '')
          ?.terminals?.some((item) => item.id === terminalTarget.terminal_id)
      )
        issues.push(
          makeIssue(
            'invalid_terminal_reference',
            'invalid',
            `interaction_bindings[${index}].target.terminal_id`,
            `unknown terminal '${terminalTarget.terminal_id}'.`,
          ),
        );
    }
  });

  input.interaction_configurations.forEach((configuration, index) => {
    if (typeof configuration.key !== 'string' || configuration.key.length === 0)
      issues.push(
        makeIssue(
          'invalid_schema_value',
          'invalid',
          `interaction_configurations[${index}].key`,
          'must be a non-empty string.',
        ),
      );
    if (typeof configuration.value === 'number' && !Number.isFinite(configuration.value))
      issues.push(
        makeIssue(
          'invalid_schema_value',
          'invalid',
          `interaction_configurations[${index}].value`,
          'numeric values must be finite.',
        ),
      );
    const target = configuration.target;
    const targetCount = isRecord(target)
      ? ['endpoint', 'relationship_id', 'network_id'].filter((key) => key in target).length
      : 0;
    if (targetCount !== 1) {
      issues.push(
        makeIssue(
          'invalid_interaction_configuration_target',
          'invalid',
          `interaction_configurations[${index}].target`,
          'must reference exactly one endpoint, relationship, or network.',
        ),
      );
    } else if (isRecord(target) && 'endpoint' in target) {
      validateEndpoint(target.endpoint, `interaction_configurations[${index}].target.endpoint`);
    } else if (
      isRecord(target) &&
      'relationship_id' in target &&
      !relationshipIds.has(target.relationship_id)
    ) {
      issues.push(
        makeIssue(
          'missing_interaction_relationship',
          'invalid',
          `interaction_configurations[${index}].target.relationship_id`,
          `missing relationship '${String(target.relationship_id)}'.`,
        ),
      );
    } else if (isRecord(target) && 'network_id' in target && !networkIds.has(target.network_id)) {
      issues.push(
        makeIssue(
          'missing_interaction_network',
          'invalid',
          `interaction_configurations[${index}].target.network_id`,
          `missing network '${String(target.network_id)}'.`,
        ),
      );
    }
  });

  input.interaction_relationship_groups.forEach((group, index) => {
    group.relationship_ids.forEach((id, refIndex) => {
      if (!relationshipIds.has(id))
        issues.push(
          makeIssue(
            'missing_interaction_relationship',
            'invalid',
            `interaction_relationship_groups[${index}].relationship_ids[${refIndex}]`,
            `missing relationship '${id}'.`,
          ),
        );
    });
  });

  return issues;
};
