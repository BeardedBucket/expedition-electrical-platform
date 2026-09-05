import type { ComponentLibraryRecord } from './component-library.js';

export type InstallationStatus =
  'requirement' | 'candidate' | 'selected' | 'installed' | 'deferred';
export type FactBasis =
  | 'measured'
  | 'owner_supplied'
  | 'design_assumption'
  | 'manufacturer_requirement'
  | 'calculated'
  | 'reviewed_installation'
  | 'unknown';
export type ElectricalDomain = 'dc' | 'ac' | 'pv_dc';
export type NodeKind = 'node' | 'bus' | 'distribution' | 'source' | 'load_terminal';

export interface ReferenceSource {
  readonly id: string;
  readonly title: string;
  readonly uri?: string | null;
  readonly note?: string | null;
  readonly [key: string]: unknown;
}

export interface ReferenceLocation {
  readonly id: string;
  readonly parent_id?: string | null;
  readonly label: string;
  readonly kind?: string | null;
  readonly status: InstallationStatus;
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export interface ComponentInstance {
  readonly id: string;
  readonly component_id: string;
  readonly role?: string | null;
  readonly label?: string | null;
  readonly quantity?: number | null;
  readonly installation_location_id?: string | null;
  readonly status: InstallationStatus;
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export interface ReferenceNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly domain: ElectricalDomain;
  readonly nominal_voltage_v?: number | null;
  readonly polarity?: string | null;
  readonly phase?: string | null;
  readonly label?: string | null;
  readonly status: InstallationStatus;
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export type ConnectionEndpoint =
  { readonly instance_id: string; readonly terminal_id: string } | { readonly node_id: string };

export interface ReferenceConnection {
  readonly id: string;
  readonly from: ConnectionEndpoint;
  readonly to: ConnectionEndpoint;
  readonly conductor_id?: string | null;
  readonly protection_instance_ids?: readonly string[];
  readonly disconnect_instance_ids?: readonly string[];
  readonly domain?: ElectricalDomain;
  readonly nominal_voltage_v?: number | null;
  readonly phase?: string | null;
  readonly status: InstallationStatus;
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export interface ReferenceConductor {
  readonly id: string;
  readonly one_way_length_m?: number | null;
  readonly conductor_material?: string | null;
  readonly gauge?: string | null;
  readonly cross_section_mm2?: number | null;
  readonly parallel_count?: number | null;
  readonly installation_condition_id?: string | null;
  readonly expected_current_a?: number | null;
  readonly nominal_voltage_v?: number | null;
  readonly maximum_voltage_drop_percent?: number | null;
  readonly protection_instance_ids?: readonly string[];
  readonly status: InstallationStatus;
  readonly fact_basis?: FactBasis;
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export interface ReferencePath {
  readonly id: string;
  readonly kind: string;
  readonly label?: string | null;
  readonly source_instance_ids?: readonly string[];
  readonly disconnect_instance_ids?: readonly string[];
  readonly controller_instance_ids?: readonly string[];
  readonly destination_node_ids?: readonly string[];
  readonly status: InstallationStatus;
  readonly notes?: string | null;
  readonly source_refs?: readonly ReferenceSource[];
}

export interface OpenQuestion {
  readonly id: string;
  readonly question: string;
  readonly status: 'open' | 'resolved' | 'deferred';
  readonly notes?: string | null;
}

export interface ReferenceSystem {
  readonly schema_version: string;
  readonly id: string;
  readonly name: string;
  readonly status: InstallationStatus;
  readonly nominal_system_voltage_v?: number | null;
  readonly locations?: readonly ReferenceLocation[];
  readonly component_instances?: readonly ComponentInstance[];
  readonly nodes?: readonly ReferenceNode[];
  readonly connections?: readonly ReferenceConnection[];
  readonly conductors?: readonly ReferenceConductor[];
  readonly paths?: readonly ReferencePath[];
  readonly source_refs?: readonly ReferenceSource[];
  readonly open_questions?: readonly OpenQuestion[];
}

export interface ReferenceSystemCatalog {
  readonly components: readonly ComponentLibraryRecord[];
}

export interface ReferenceSystemValidation {
  readonly status: 'valid' | 'unresolved' | 'invalid';
  readonly issues: readonly ReferenceSystemIssue[];
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export type ReferenceSystemIssueCode =
  | 'duplicate_id'
  | 'missing_reference'
  | 'unresolved_catalog_component'
  | 'unresolved_terminal_data'
  | 'invalid_terminal_reference'
  | 'invalid_endpoint'
  | 'invalid_status'
  | 'invalid_numeric_value'
  | 'location_cycle'
  | 'invalid_schema_value';

export interface ReferenceSystemIssue {
  readonly code: ReferenceSystemIssueCode;
  readonly category: 'invalid' | 'unresolved';
  readonly path: string;
  readonly message: string;
}

const statuses = new Set<InstallationStatus>([
  'requirement',
  'candidate',
  'selected',
  'installed',
  'deferred',
]);
const factBases = new Set<FactBasis>([
  'measured',
  'owner_supplied',
  'design_assumption',
  'manufacturer_requirement',
  'calculated',
  'reviewed_installation',
  'unknown',
]);
const domains = new Set<ElectricalDomain>(['dc', 'ac', 'pv_dc']);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isPositive = (value: unknown): boolean => isFiniteNumber(value) && value > 0;
const isNonNegative = (value: unknown): boolean => isFiniteNumber(value) && value >= 0;

const addDuplicateErrors = (
  issues: ReferenceSystemIssue[],
  collection: string,
  records: readonly { id: string }[],
): Map<string, number> => {
  const counts = new Map<string, number>();
  records.forEach((record, index) => {
    if (typeof record?.id !== 'string' || record.id.length === 0) {
      issues.push(
        issue(
          'invalid_schema_value',
          'invalid',
          `${collection}[${index}].id`,
          'must be a non-empty string.',
        ),
      );
      return;
    }
    const count = (counts.get(record.id) ?? 0) + 1;
    counts.set(record.id, count);
    if (count > 1)
      issues.push(
        issue(
          'duplicate_id',
          'invalid',
          `${collection}[${index}].id`,
          `duplicate ID '${record.id}'.`,
        ),
      );
  });
  return counts;
};

const issue = (
  code: ReferenceSystemIssueCode,
  category: ReferenceSystemIssue['category'],
  path: string,
  message: string,
): ReferenceSystemIssue => ({ code, category, path, message });

const checkStatus = (issues: ReferenceSystemIssue[], path: string, value: unknown) => {
  if (typeof value !== 'string' || !statuses.has(value as InstallationStatus)) {
    issues.push(issue('invalid_status', 'invalid', path, 'invalid installation status.'));
  }
};

const checkReferenceIds = (
  issues: ReferenceSystemIssue[],
  path: string,
  ids: readonly string[] | undefined,
  validIds: ReadonlySet<string>,
) => {
  for (const id of ids ?? []) {
    if (!validIds.has(id))
      issues.push(issue('missing_reference', 'invalid', path, `missing reference '${id}'.`));
  }
};

const endpointIsInstance = (
  endpoint: unknown,
): endpoint is { instance_id: string; terminal_id: string } =>
  endpoint !== null &&
  typeof endpoint === 'object' &&
  typeof (endpoint as Record<string, unknown>).instance_id === 'string' &&
  typeof (endpoint as Record<string, unknown>).terminal_id === 'string';

const endpointIsNode = (endpoint: unknown): endpoint is { node_id: string } =>
  endpoint !== null &&
  typeof endpoint === 'object' &&
  typeof (endpoint as Record<string, unknown>).node_id === 'string';

export const validateReferenceSystem = (
  input: ReferenceSystem,
  catalog: ReferenceSystemCatalog = { components: [] },
): ReferenceSystemValidation => {
  const issues: ReferenceSystemIssue[] = [];
  const addInvalid = (
    path: string,
    message: string,
    code: ReferenceSystemIssueCode = 'invalid_schema_value',
  ) => issues.push(issue(code, 'invalid', path, message));
  const addUnresolved = (path: string, message: string, code: ReferenceSystemIssueCode) =>
    issues.push(issue(code, 'unresolved', path, message));
  const locations = input.locations ?? [];
  const instances = input.component_instances ?? [];
  const nodes = input.nodes ?? [];
  const connections = input.connections ?? [];
  const conductors = input.conductors ?? [];
  const paths = input.paths ?? [];
  const catalogById = new Map<string, ComponentLibraryRecord>();
  catalog.components.forEach((component, index) => {
    if (catalogById.has(component.id)) {
      addInvalid(
        `catalog.components[${index}].id`,
        `duplicate ID '${component.id}'.`,
        'duplicate_id',
      );
    } else {
      catalogById.set(component.id, component);
    }
  });

  addDuplicateErrors(issues, 'locations', locations);
  addDuplicateErrors(issues, 'component_instances', instances);
  addDuplicateErrors(issues, 'nodes', nodes);
  addDuplicateErrors(issues, 'connections', connections);
  addDuplicateErrors(issues, 'conductors', conductors);
  addDuplicateErrors(issues, 'paths', paths);
  const questions = input.open_questions ?? [];
  addDuplicateErrors(issues, 'open_questions', questions);

  if (typeof input.schema_version !== 'string' || input.schema_version.length === 0)
    addInvalid('schema_version', 'must be a non-empty string.');
  if (typeof input.id !== 'string' || input.id.length === 0)
    addInvalid('id', 'must be a non-empty string.');
  if (typeof input.name !== 'string' || input.name.length === 0)
    addInvalid('name', 'must be a non-empty string.');
  checkStatus(issues, 'status', input.status);

  const locationIds = new Set(locations.map((item) => item.id));
  const instanceIds = new Set(instances.map((item) => item.id));
  const nodeIds = new Set(nodes.map((item) => item.id));
  const conductorIds = new Set(conductors.map((item) => item.id));

  if (
    input.nominal_system_voltage_v !== undefined &&
    input.nominal_system_voltage_v !== null &&
    !isPositive(input.nominal_system_voltage_v)
  ) {
    addInvalid(
      'nominal_system_voltage_v',
      'must be positive when provided.',
      'invalid_numeric_value',
    );
  }

  locations.forEach((location, index) => {
    checkStatus(issues, `locations[${index}].status`, location.status);
    if (location.parent_id && !locationIds.has(location.parent_id)) {
      addInvalid(
        `locations[${index}].parent_id`,
        `missing reference '${location.parent_id}'.`,
        'missing_reference',
      );
    }
  });

  const visit = (id: string, visiting: Set<string>, visited: Set<string>) => {
    if (visiting.has(id)) {
      addInvalid('locations', `parent cycle includes '${id}'.`, 'location_cycle');
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const parent = locations.find((location) => location.id === id)?.parent_id;
    if (parent && locationIds.has(parent)) visit(parent, visiting, visited);
    visiting.delete(id);
    visited.add(id);
  };
  const visitedLocations = new Set<string>();
  locations.forEach((location) => visit(location.id, new Set(), visitedLocations));

  instances.forEach((instance, index) => {
    checkStatus(issues, `component_instances[${index}].status`, instance.status);
    if (typeof instance.component_id !== 'string' || instance.component_id.length === 0) {
      addInvalid(`component_instances[${index}].component_id`, 'required.');
    } else if (!catalogById.has(instance.component_id)) {
      addUnresolved(
        `component_instances[${index}].component_id`,
        `unresolved catalog reference '${instance.component_id}'.`,
        'unresolved_catalog_component',
      );
    }
    if (
      instance.quantity !== undefined &&
      instance.quantity !== null &&
      (!Number.isInteger(instance.quantity) || instance.quantity < 1)
    ) {
      addInvalid(
        `component_instances[${index}].quantity`,
        'must be a positive integer.',
        'invalid_numeric_value',
      );
    }
    if (instance.installation_location_id && !locationIds.has(instance.installation_location_id)) {
      addInvalid(
        `component_instances[${index}].installation_location_id`,
        `missing reference '${instance.installation_location_id}'.`,
        'missing_reference',
      );
    }
  });

  nodes.forEach((node, index) => {
    checkStatus(issues, `nodes[${index}].status`, node.status);
    if (!domains.has(node.domain))
      addInvalid(`nodes[${index}].domain`, 'invalid electrical domain.');
    if (
      node.nominal_voltage_v !== undefined &&
      node.nominal_voltage_v !== null &&
      !isPositive(node.nominal_voltage_v)
    ) {
      addInvalid(
        `nodes[${index}].nominal_voltage_v`,
        'must be positive when provided.',
        'invalid_numeric_value',
      );
    }
  });

  conductors.forEach((conductor, index) => {
    checkStatus(issues, `conductors[${index}].status`, conductor.status);
    if (conductor.fact_basis !== undefined && !factBases.has(conductor.fact_basis)) {
      addInvalid(`conductors[${index}].fact_basis`, 'invalid fact basis.');
    }
    const nonNegativeFields = [
      'one_way_length_m',
      'expected_current_a',
      'maximum_voltage_drop_percent',
    ] as const;
    for (const field of nonNegativeFields) {
      const value = conductor[field];
      if (value !== undefined && value !== null && !isNonNegative(value)) {
        addInvalid(
          `conductors[${index}].${field}`,
          'must be finite and non-negative.',
          'invalid_numeric_value',
        );
      }
    }
    for (const field of ['nominal_voltage_v', 'cross_section_mm2'] as const) {
      const value = conductor[field];
      if (value !== undefined && value !== null && !isPositive(value)) {
        addInvalid(
          `conductors[${index}].${field}`,
          'must be finite and positive.',
          'invalid_numeric_value',
        );
      }
    }
    if (
      conductor.parallel_count !== undefined &&
      conductor.parallel_count !== null &&
      (!Number.isInteger(conductor.parallel_count) || conductor.parallel_count < 1)
    ) {
      addInvalid(
        `conductors[${index}].parallel_count`,
        'must be a positive integer.',
        'invalid_numeric_value',
      );
    }
    checkReferenceIds(
      issues,
      `conductors[${index}].protection_instance_ids`,
      conductor.protection_instance_ids,
      instanceIds,
    );
  });

  connections.forEach((connection, index) => {
    checkStatus(issues, `connections[${index}].status`, connection.status);
    for (const endpointName of ['from', 'to'] as const) {
      const endpoint = connection[endpointName];
      if ((endpointIsInstance(endpoint) ? 1 : 0) + (endpointIsNode(endpoint) ? 1 : 0) !== 1) {
        addInvalid(
          `connections[${index}].${endpointName}`,
          'must reference exactly one target.',
          'invalid_endpoint',
        );
      } else if (endpointIsInstance(endpoint)) {
        if (!instanceIds.has(endpoint.instance_id)) {
          addInvalid(
            `connections[${index}].${endpointName}.instance_id`,
            `missing reference '${endpoint.instance_id}'.`,
            'missing_reference',
          );
        } else {
          const component = catalogById.get(
            instances.find((instance) => instance.id === endpoint.instance_id)?.component_id ?? '',
          );
          if (!component) {
            addUnresolved(
              `connections[${index}].${endpointName}.terminal_id`,
              'catalog component is unavailable.',
              'unresolved_catalog_component',
            );
          } else if (
            !component.terminals?.length ||
            component.terminals.every((terminal) => !terminal.id)
          ) {
            addUnresolved(
              `connections[${index}].${endpointName}.terminal_id`,
              'stable terminal IDs are unavailable.',
              'unresolved_terminal_data',
            );
          } else if (
            !component.terminals.some((terminal) => terminal.id === endpoint.terminal_id)
          ) {
            addInvalid(
              `connections[${index}].${endpointName}.terminal_id`,
              `unknown terminal '${endpoint.terminal_id}'.`,
              'invalid_terminal_reference',
            );
          }
        }
      } else if (endpointIsNode(endpoint) && !nodeIds.has(endpoint.node_id)) {
        addInvalid(
          `connections[${index}].${endpointName}.node_id`,
          `missing reference '${endpoint.node_id}'.`,
          'missing_reference',
        );
      }
    }
    if (connection.conductor_id && !conductorIds.has(connection.conductor_id)) {
      addInvalid(
        `connections[${index}].conductor_id`,
        `missing reference '${connection.conductor_id}'.`,
        'missing_reference',
      );
    }
    checkReferenceIds(
      issues,
      `connections[${index}].protection_instance_ids`,
      connection.protection_instance_ids,
      instanceIds,
    );
    checkReferenceIds(
      issues,
      `connections[${index}].disconnect_instance_ids`,
      connection.disconnect_instance_ids,
      instanceIds,
    );
    if (connection.domain !== undefined && !domains.has(connection.domain)) {
      addInvalid(`connections[${index}].domain`, 'invalid electrical domain.');
    }
    if (
      connection.nominal_voltage_v !== undefined &&
      connection.nominal_voltage_v !== null &&
      !isPositive(connection.nominal_voltage_v)
    ) {
      addInvalid(
        `connections[${index}].nominal_voltage_v`,
        'must be positive when provided.',
        'invalid_numeric_value',
      );
    }
  });

  paths.forEach((path, index) => {
    checkStatus(issues, `paths[${index}].status`, path.status);
    checkReferenceIds(
      issues,
      `paths[${index}].source_instance_ids`,
      path.source_instance_ids,
      instanceIds,
    );
    checkReferenceIds(
      issues,
      `paths[${index}].disconnect_instance_ids`,
      path.disconnect_instance_ids,
      instanceIds,
    );
    checkReferenceIds(
      issues,
      `paths[${index}].controller_instance_ids`,
      path.controller_instance_ids,
      instanceIds,
    );
    checkReferenceIds(
      issues,
      `paths[${index}].destination_node_ids`,
      path.destination_node_ids,
      nodeIds,
    );
  });

  questions.forEach((question, index) => {
    if (typeof question.question !== 'string' || question.question.length === 0) {
      addInvalid(`open_questions[${index}].question`, 'must be a non-empty string.');
    }
    if (!['open', 'resolved', 'deferred'].includes(question.status)) {
      addInvalid(`open_questions[${index}].status`, 'invalid open-question status.');
    }
  });
  const sortedIssues = [...issues].sort((left, right) =>
    `${left.category}|${left.code}|${left.path}|${left.message}`.localeCompare(
      `${right.category}|${right.code}|${right.path}|${right.message}`,
    ),
  );
  const status = sortedIssues.some((item) => item.category === 'invalid')
    ? 'invalid'
    : sortedIssues.length > 0
      ? 'unresolved'
      : 'valid';
  return {
    status,
    issues: sortedIssues,
    ok: status === 'valid',
    errors: sortedIssues.map((item) => `${item.path}: ${item.message}`),
  };
};
