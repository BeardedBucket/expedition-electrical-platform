import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import componentSchema from '../../../data/schemas/component.schema.json' with { type: 'json' };
import type { JsonObject, JsonValue, ProductFact } from './contracts.js';
import type { NormalizedProductFact } from './normalization-types.js';
import type { PromotionReview } from './promotion.js';
import { isSupportedCanonicalField } from './field-mapping.js';

export type CanonicalAmendmentStatus = 'proposed' | 'blocked' | 'invalid' | 'dry_run' | 'written';

export type CanonicalAmendmentIssueCode =
  | 'amendment_review_not_approved'
  | 'amendment_missing_required_field'
  | 'amendment_missing_expected_snapshot'
  | 'amendment_field_not_approved'
  | 'amendment_action_missing'
  | 'amendment_action_without_approval'
  | 'amendment_action_conflict'
  | 'amendment_operation_state_mismatch'
  | 'amendment_identity_field_prohibited'
  | 'amendment_verification_status_prohibited'
  | 'amendment_unsupported_operation'
  | 'canonical_snapshot_mismatch'
  | 'amendment_invalid_component'
  | 'amendment_write_not_authorized'
  | 'write_path_invalid'
  | 'write_failed'
  | 'amendment_component_not_found'
  | 'amendment_target_missing'
  | 'amendment_already_applied'
  | 'amendment_missing_field_evidence'
  | 'amendment_evidence_field_mismatch'
  | 'amendment_unsafe_field_path'
  | 'amendment_unresolved_evidence'
  | 'amendment_candidate_validation_failed'
  | 'amendment_topology_invalid_id'
  | 'amendment_topology_duplicate_id'
  | 'amendment_topology_value_mismatch'
  | 'amendment_topology_missing_evidence'
  | 'amendment_topology_evidence_mismatch'
  | 'amendment_topology_evidence_conflict'
  | 'amendment_topology_invalid_reference';

export interface CanonicalAmendmentIssue {
  readonly code: CanonicalAmendmentIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface CanonicalAmendmentReview extends PromotionReview {
  readonly component_id?: string;
  readonly canonical_id?: string;
  readonly expected_snapshot?: string;
  readonly expected_current_snapshot?: string;
  readonly rationale?: string;
  readonly field_actions?: Readonly<Record<string, 'add' | 'replace' | 'remove'>>;
  readonly field_changes?: Readonly<Record<string, 'add' | 'replace' | 'remove'>>;
  readonly field_evidence?: Readonly<Record<string, readonly string[]>>;
  readonly topology_evidence?: Readonly<Record<string, readonly string[]>>;
  readonly topology_operations?: readonly CanonicalTopologyAddOperation[];
}

export interface CanonicalAmendmentCandidate {
  readonly component_data?: JsonObject;
  readonly field_evidence?: Readonly<Record<string, readonly string[]>>;
  readonly topology_evidence?: Readonly<Record<string, readonly string[]>>;
  readonly fact_ids?: readonly string[];
  readonly source_ids?: readonly string[];
  readonly facts?: readonly ProductFact[];
  readonly normalized_facts?: readonly NormalizedProductFact[];
}

export interface CanonicalAmendmentChange {
  readonly field: string;
  readonly operation: 'add' | 'replace';
  readonly previous_value?: JsonValue;
  readonly new_value: JsonValue;
  readonly review_id: string;
  readonly fact_ids: readonly string[];
}

export type CanonicalTopologyKind =
  | 'capability'
  | 'port'
  | 'power_path'
  | 'connection_point'
  | 'conductive_relationship'
  | 'switching_configuration'
  | 'protection_instance'
  | 'measurement_instance';

export interface CanonicalTopologyAddOperation {
  readonly operation: 'add';
  readonly kind: CanonicalTopologyKind;
  readonly id: string;
  readonly value: JsonObject;
  readonly evidence?: readonly string[];
}

export interface CanonicalTopologyChange {
  readonly operation: 'add';
  readonly kind: CanonicalTopologyKind;
  readonly id: string;
  readonly value: JsonObject;
  readonly fact_ids: readonly string[];
  readonly review_id: string;
}

export interface CanonicalAmendmentRequest {
  readonly current: JsonObject;
  readonly candidate?: CanonicalAmendmentCandidate;
  readonly review: CanonicalAmendmentReview;
  readonly facts?: readonly ProductFact[];
  readonly write?: boolean;
  readonly destinationRoot?: string;
  readonly filename?: string;
  readonly filesystem?: CanonicalAmendmentFilesystem;
}

export interface CanonicalAmendmentFilesystem {
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

export interface CanonicalAmendmentResult {
  readonly status: CanonicalAmendmentStatus;
  readonly issues: readonly CanonicalAmendmentIssue[];
  readonly proposal?: JsonObject;
  readonly current?: JsonObject;
  readonly expected_snapshot?: string;
  readonly actual_snapshot?: string;
  readonly path?: string;
  readonly serialized?: string;
  readonly changes?: readonly CanonicalAmendmentChange[];
  readonly topology_changes?: readonly CanonicalTopologyChange[];
  readonly schema_valid: boolean;
}

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
const componentValidator = ajv.compile(componentSchema);

const IDENTITY_FIELDS = new Set([
  'id',
  'manufacturer',
  'model',
  'part_number',
  'product_family',
  'product_role',
  'category',
  'verification_status',
]);

const issue = (
  code: CanonicalAmendmentIssueCode,
  path: string,
  message: string,
): CanonicalAmendmentIssue => ({ code, path, message });

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const getPath = (root: JsonObject, path: string): JsonValue | undefined =>
  path.split('.').reduce<JsonValue | undefined>((value, segment) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as JsonObject)[segment];
  }, root as JsonValue);

const hasPath = (root: JsonObject, path: string): boolean => {
  const segments = path.split('.');
  let value: JsonValue | undefined = root;
  for (const segment of segments) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    if (!Object.prototype.hasOwnProperty.call(value, segment)) return false;
    value = (value as JsonObject)[segment];
  }
  return true;
};

const setPath = (root: JsonObject, path: string, value: JsonValue): void => {
  const segments = path.split('.');
  let cursor = root as { [key: string]: JsonValue };
  for (const segment of segments.slice(0, -1)) {
    const child = cursor[segment];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) cursor[segment] = {};
    cursor = cursor[segment] as { [key: string]: JsonValue };
  }
  cursor[segments[segments.length - 1]] = value;
};

const canonicalYaml = (value: JsonObject): string => stringifyYaml(value, { sortMapEntries: true });

export const canonicalSerializedSnapshot = (current: JsonObject): string =>
  `sha256:${createHash('sha256').update(canonicalYaml(current), 'utf8').digest('hex')}`;

export const canonicalSnapshotIdentity = canonicalSerializedSnapshot;
export const canonicalComponentSnapshot = canonicalSerializedSnapshot;
export const canonicalFingerprint = canonicalSerializedSnapshot;

const candidateData = (candidate: CanonicalAmendmentCandidate | undefined): JsonObject =>
  candidate?.component_data ?? (candidate as unknown as JsonObject) ?? {};

const candidateEvidence = (
  candidate: CanonicalAmendmentCandidate | undefined,
  review: CanonicalAmendmentReview,
  field: string,
): readonly string[] => review.field_evidence?.[field] ?? candidate?.field_evidence?.[field] ?? [];

const unsafeFieldPath = (field: string): boolean =>
  field.length === 0 ||
  field
    .split('.')
    .some(
      (segment) =>
        segment.length === 0 ||
        segment === '__proto__' ||
        segment === 'prototype' ||
        segment === 'constructor',
    );

const factIndex = (
  candidate: CanonicalAmendmentCandidate | undefined,
  facts: readonly ProductFact[],
): Map<string, ProductFact> =>
  new Map([...(candidate?.facts ?? []), ...facts].map((fact) => [fact.id, fact]));

const existingAmendmentIds = (current: JsonObject): Set<string> => {
  const history = current.amendment_history;
  if (!Array.isArray(history)) return new Set();
  return new Set(
    history.flatMap((entry) =>
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof entry.review_id === 'string'
        ? [entry.review_id]
        : [],
    ),
  );
};

const schemaIssues = (proposal: JsonObject): CanonicalAmendmentIssue[] => {
  componentValidator(proposal);
  return (componentValidator.errors ?? []).map((error) =>
    issue(
      'amendment_invalid_component',
      error.instancePath || '/',
      error.message ?? 'canonical component does not match the schema.',
    ),
  );
};

const safeCanonicalPath = (
  destinationRoot: string,
  filename: string,
): { path?: string; issue?: CanonicalAmendmentIssue } => {
  if (
    !filename ||
    !filename.endsWith('.yaml') ||
    isAbsolute(filename) ||
    win32.isAbsolute(filename) ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename === '.' ||
    filename === '..'
  ) {
    return {
      issue: issue(
        'write_path_invalid',
        'filename',
        'Canonical amendment filename must be a single .yaml filename.',
      ),
    };
  }
  const root = resolve(destinationRoot);
  const target = resolve(root, filename);
  const withinRoot = relative(root, target);
  if (!withinRoot || withinRoot.startsWith('..') || isAbsolute(withinRoot)) {
    return {
      issue: issue(
        'write_path_invalid',
        'filename',
        'Canonical amendment destination must remain inside the declared root directory.',
      ),
    };
  }
  return { path: target };
};

const amendmentHistoryEntry = (
  review: CanonicalAmendmentReview,
  expectedSnapshot: string,
  changes: readonly CanonicalAmendmentChange[],
  candidate: CanonicalAmendmentCandidate | undefined,
  topologyChanges: readonly CanonicalTopologyChange[] = [],
): JsonObject => ({
  review_id: review.id,
  candidate_id: review.candidate_id,
  expected_snapshot: expectedSnapshot,
  fields: changes.map((change) => ({ ...change, fact_ids: [...change.fact_ids] })),
  source_ids: [...(candidate?.source_ids ?? [])],
  ...(topologyChanges.length > 0
    ? {
        topology_operations: topologyChanges.map((change) => ({
          operation: change.operation,
          kind: change.kind,
          id: change.id,
          value: clone(change.value),
          fact_ids: [...change.fact_ids],
          review_id: change.review_id,
        })),
      }
    : {}),
});

const topologyCollection = {
  capability: 'capabilities',
  port: 'ports',
  power_path: 'power_paths',
  connection_point: 'connection_points',
  conductive_relationship: 'conductive_relationships',
  switching_configuration: 'switching.configurations',
  protection_instance: 'protection.instances',
  measurement_instance: 'measurement.instances',
} as const;

const topologyTargetKey = (kind: CanonicalTopologyKind, id: string): string => `${kind}:${id}`;

const validateProposedTopology = (proposal: JsonObject): CanonicalAmendmentIssue[] => {
  const issues: CanonicalAmendmentIssue[] = [];
  const capabilities = Array.isArray(proposal.capabilities) ? proposal.capabilities : undefined;
  const ports = Array.isArray(proposal.ports) ? proposal.ports : undefined;
  const paths = Array.isArray(proposal.power_paths) ? proposal.power_paths : undefined;
  const connectionPoints = Array.isArray(proposal.connection_points)
    ? proposal.connection_points
    : undefined;
  const conductiveRelationships = Array.isArray(proposal.conductive_relationships)
    ? proposal.conductive_relationships
    : undefined;
  const ids = (items: JsonValue[] | undefined): Set<string> =>
    new Set(
      (items ?? []).flatMap((item) =>
        item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string'
          ? [item.id]
          : [],
      ),
    );
  const capabilityIds = ids(capabilities);
  const portDirections = new Map<string, string>(
    (ports ?? []).flatMap((item) =>
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof item.id === 'string' &&
      typeof item.direction === 'string'
        ? [[item.id, item.direction]]
        : [],
    ),
  );
  const pathIds = ids(paths);
  const connectionPointIds = ids(connectionPoints);
  const conductiveRelationshipIds = ids(conductiveRelationships);
  const portIds = ids(ports);
  const switching = proposal.switching;
  const switchingConfigurations =
    switching && typeof switching === 'object' && !Array.isArray(switching)
      ? Array.isArray(switching.configurations)
        ? switching.configurations
        : undefined
      : undefined;
  const switchingConfigurationIds = ids(switchingConfigurations);
  const protection = proposal.protection;
  const protectionInstances =
    protection && typeof protection === 'object' && !Array.isArray(protection)
      ? Array.isArray(protection.instances)
        ? protection.instances
        : undefined
      : undefined;
  const protectionInstanceIds = ids(protectionInstances);
  const measurement = proposal.measurement;
  const measurementInstances =
    measurement && typeof measurement === 'object' && !Array.isArray(measurement)
      ? Array.isArray(measurement.instances)
        ? measurement.instances
        : undefined
      : undefined;
  const measurementInstanceIds = ids(measurementInstances);
  if (capabilities && capabilityIds.size !== capabilities.length) {
    issues.push(
      issue('amendment_topology_duplicate_id', 'capabilities', 'Capability IDs must be unique.'),
    );
  }
  if (ports && ids(ports).size !== ports.length) {
    issues.push(issue('amendment_topology_duplicate_id', 'ports', 'Port IDs must be unique.'));
  }
  if (paths && pathIds.size !== paths.length) {
    issues.push(
      issue('amendment_topology_duplicate_id', 'power_paths', 'Power path IDs must be unique.'),
    );
  }
  if (connectionPoints && connectionPointIds.size !== connectionPoints.length) {
    issues.push(
      issue(
        'amendment_topology_duplicate_id',
        'connection_points',
        'Connection point IDs must be unique.',
      ),
    );
  }
  if (
    conductiveRelationships &&
    conductiveRelationshipIds.size !== conductiveRelationships.length
  ) {
    issues.push(
      issue(
        'amendment_topology_duplicate_id',
        'conductive_relationships',
        'Conductive relationship IDs must be unique.',
      ),
    );
  }
  if (
    switchingConfigurations &&
    switchingConfigurationIds.size !== switchingConfigurations.length
  ) {
    issues.push(
      issue(
        'amendment_topology_duplicate_id',
        'switching.configurations',
        'Switching configuration IDs must be unique.',
      ),
    );
  }
  if (protectionInstances && protectionInstanceIds.size !== protectionInstances.length) {
    issues.push(
      issue(
        'amendment_topology_duplicate_id',
        'protection.instances',
        'Protection instance IDs must be unique.',
      ),
    );
  }
  if (measurementInstances && measurementInstanceIds.size !== measurementInstances.length) {
    issues.push(
      issue(
        'amendment_topology_duplicate_id',
        'measurement.instances',
        'Measurement instance IDs must be unique.',
      ),
    );
  }
  (connectionPoints ?? []).forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const portId = item.port_id;
    if (typeof portId === 'string' && !portIds.has(portId)) {
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `connection_points[${index}].port_id`,
          `Unknown port '${portId}'.`,
        ),
      );
    }
  });
  (conductiveRelationships ?? []).forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const participants = item.participants;
    if (!Array.isArray(participants)) return;
    participants.forEach((participant, participantIndex) => {
      if (!participant || typeof participant !== 'object' || Array.isArray(participant)) return;
      const kind = participant.kind;
      const id = participant.id;
      const known =
        (kind === 'port' && portIds.has(id as string)) ||
        (kind === 'connection_point' && connectionPointIds.has(id as string));
      if (!known) {
        issues.push(
          issue(
            'amendment_topology_invalid_reference',
            `conductive_relationships[${index}].participants[${participantIndex}]`,
            `Unknown ${String(kind)} '${String(id)}'.`,
          ),
        );
      }
    });
  });
  (paths ?? []).forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const capabilityId = item.capability_id;
    const fromPort = item.from_port;
    const toPort = item.to_port;
    if (typeof capabilityId === 'string' && !capabilityIds.has(capabilityId))
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `power_paths[${index}].capability_id`,
          `Unknown capability '${capabilityId}'.`,
        ),
      );
    if (typeof fromPort === 'string' && !portDirections.has(fromPort))
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `power_paths[${index}].from_port`,
          `Unknown port '${fromPort}'.`,
        ),
      );
    else if (typeof fromPort === 'string' && portDirections.get(fromPort) === 'output')
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `power_paths[${index}].from_port`,
          'from_port must be input or bidirectional.',
        ),
      );
    if (typeof toPort === 'string' && !portDirections.has(toPort))
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `power_paths[${index}].to_port`,
          `Unknown port '${toPort}'.`,
        ),
      );
    else if (typeof toPort === 'string' && portDirections.get(toPort) === 'input')
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `power_paths[${index}].to_port`,
          'to_port must be output or bidirectional.',
        ),
      );
    if (typeof fromPort === 'string' && fromPort === toPort)
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `power_paths[${index}]`,
          'A power path cannot connect a port to itself.',
        ),
      );
  });
  (protectionInstances ?? []).forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const application = item.application;
    const target = item.target;
    if (application !== 'external_circuit' && application !== 'internal_device') {
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `protection.instances[${index}].application`,
          'Protection application must be external_circuit or internal_device.',
        ),
      );
    }
    if (item.function !== 'overcurrent') {
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `protection.instances[${index}].function`,
          'Protection function must be overcurrent.',
        ),
      );
    }
    if (application === 'external_circuit' && (!target || typeof target !== 'object')) {
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `protection.instances[${index}].target`,
          'External circuit protection requires a topology target.',
        ),
      );
    }
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      const targetKind = target.kind;
      const targetId = target.id;
      const known =
        typeof targetId === 'string' &&
        ((targetKind === 'conductive_relationship' && conductiveRelationshipIds.has(targetId)) ||
          (targetKind === 'connection_point' && connectionPointIds.has(targetId)) ||
          (targetKind === 'port' && portIds.has(targetId)));
      if (!known) {
        issues.push(
          issue(
            'amendment_topology_invalid_reference',
            `protection.instances[${index}].target`,
            `Unknown protection topology target '${String(targetKind)}:${String(targetId)}'.`,
          ),
        );
      }
    }
  });
  (measurementInstances ?? []).forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const quantity = item.quantity;
    const target = item.target;
    const targetKind =
      target && typeof target === 'object' && !Array.isArray(target) ? target.kind : undefined;
    const targetId =
      target && typeof target === 'object' && !Array.isArray(target) ? target.id : undefined;
    const known =
      typeof targetId === 'string' &&
      ((quantity === 'current' &&
        targetKind === 'conductive_relationship' &&
        conductiveRelationshipIds.has(targetId)) ||
        (quantity === 'voltage' &&
          targetKind === 'connection_point' &&
          connectionPointIds.has(targetId)) ||
        (quantity === 'voltage' && targetKind === 'port' && portIds.has(targetId)));
    if (!known) {
      issues.push(
        issue(
          'amendment_topology_invalid_reference',
          `measurement.instances[${index}].target`,
          `Measurement ${String(quantity)} target must reference a compatible existing topology object.`,
        ),
      );
    }
  });
  return issues;
};

export const proposeCanonicalAmendment = ({
  current,
  candidate,
  facts = [],
  review,
}: CanonicalAmendmentRequest): CanonicalAmendmentResult => {
  const issues: CanonicalAmendmentIssue[] = [];
  const actions = { ...(review.field_actions ?? {}), ...(review.field_changes ?? {}) };
  const approved = new Set(review.approved_fields ?? []);
  const expectedSnapshot = review.expected_snapshot ?? review.expected_current_snapshot;
  const componentId =
    review.component_id ??
    review.canonical_id ??
    (typeof current.id === 'string' ? current.id : '');
  const data = candidateData(candidate);
  const evidenceFacts = factIndex(candidate, facts);
  const changes: CanonicalAmendmentChange[] = [];
  const topologyChanges: CanonicalTopologyChange[] = [];
  const actualSnapshot = canonicalSerializedSnapshot(current);
  for (const field of Object.keys(review.field_actions ?? {})) {
    const primary = review.field_actions?.[field];
    const alias = review.field_changes?.[field];
    if (primary && alias && primary !== alias) {
      issues.push(
        issue(
          'amendment_action_conflict',
          field,
          'Conflicting amendment action aliases are not accepted.',
        ),
      );
    }
  }

  if (
    review.decision !== 'approved' ||
    !review.id.trim() ||
    !review.reviewer_id.trim() ||
    !review.reviewed_at.trim()
  ) {
    issues.push(
      issue(
        'amendment_review_not_approved',
        'review',
        'Canonical amendment requires an explicit approved review with identity and timestamp.',
      ),
    );
  }
  if (!review.evidence_acknowledged) {
    issues.push(
      issue(
        'amendment_review_not_approved',
        'review.evidence_acknowledged',
        'Evidence must be acknowledged.',
      ),
    );
  }
  if (!componentId.trim()) {
    issues.push(
      issue(
        'amendment_missing_required_field',
        'review.component_id',
        'Canonical component ID is required.',
      ),
    );
  }
  if (current.id !== componentId) {
    issues.push(
      issue(
        'amendment_component_not_found',
        'review.component_id',
        'Review component ID does not match the current record.',
      ),
    );
  }
  if (!expectedSnapshot) {
    issues.push(
      issue(
        'amendment_missing_expected_snapshot',
        'review.expected_snapshot',
        'An explicit reviewed canonical snapshot is required.',
      ),
    );
  } else if (expectedSnapshot !== actualSnapshot) {
    issues.push(
      issue(
        'canonical_snapshot_mismatch',
        'review.expected_snapshot',
        'The reviewed snapshot does not match the current canonical snapshot.',
      ),
    );
  }
  if (existingAmendmentIds(current).has(review.id)) {
    issues.push(
      issue(
        'amendment_already_applied',
        'review.id',
        `Amendment review '${review.id}' has already been applied.`,
      ),
    );
  }

  const proposal = clone(current) as { [key: string]: JsonValue };
  const fields = new Set([...approved, ...Object.keys(actions)]);
  for (const field of [...fields].sort()) {
    const action = actions[field];
    const isApproved = approved.has(field);
    if (!isApproved && action) {
      issues.push(
        issue('amendment_action_without_approval', field, `Action for '${field}' is not approved.`),
      );
      continue;
    }
    if (isApproved && !action) {
      issues.push(
        issue(
          'amendment_action_missing',
          field,
          `Approved field '${field}' has no explicit action.`,
        ),
      );
      continue;
    }
    if (unsafeFieldPath(field) || !isSupportedCanonicalField(field)) {
      issues.push(
        issue(
          'amendment_unsafe_field_path',
          field,
          `Amendment field '${field}' is not a safe schema-backed canonical field.`,
        ),
      );
      continue;
    }
    if (IDENTITY_FIELDS.has(field) || field.startsWith('id.') || field.includes('.id')) {
      issues.push(
        issue(
          field === 'verification_status'
            ? 'amendment_verification_status_prohibited'
            : 'amendment_identity_field_prohibited',
          field,
          `Routine amendments cannot change '${field}'.`,
        ),
      );
      continue;
    }
    if (action === 'remove') {
      issues.push(
        issue(
          'amendment_unsupported_operation',
          field,
          'Remove is not supported in this amendment workflow.',
        ),
      );
      continue;
    }
    if (action !== 'add' && action !== 'replace') {
      issues.push(
        issue(
          'amendment_unsupported_operation',
          field,
          `Unsupported amendment action '${String(action)}'.`,
        ),
      );
      continue;
    }
    const exists = hasPath(current, field);
    if ((action === 'add' && exists) || (action === 'replace' && !exists)) {
      issues.push(
        issue(
          'amendment_operation_state_mismatch',
          field,
          `Action '${action}' does not match the current field state.`,
        ),
      );
      continue;
    }
    if (!hasPath(data, field)) {
      issues.push(
        issue(
          'amendment_candidate_validation_failed',
          field,
          `Candidate value for '${field}' is missing.`,
        ),
      );
      continue;
    }
    const factIds = candidateEvidence(candidate, review, field);
    if (factIds.length === 0) {
      issues.push(
        issue(
          'amendment_missing_field_evidence',
          field,
          `Reviewed evidence is required for '${field}'.`,
        ),
      );
      continue;
    }
    const normalizedById = new Map(
      (candidate?.normalized_facts ?? []).map((normalized) => [normalized.fact.id, normalized]),
    );
    if (
      factIds.some((id) => {
        const normalized = normalizedById.get(id);
        return (
          normalized === undefined ||
          normalized.target_kind !== 'canonical' ||
          normalized.canonical_field !== field
        );
      })
    ) {
      issues.push(
        issue(
          'amendment_evidence_field_mismatch',
          field,
          `Reviewed evidence must target canonical field '${field}'.`,
        ),
      );
      continue;
    }
    if (factIds.some((id) => !evidenceFacts.has(id))) {
      issues.push(
        issue(
          'amendment_missing_field_evidence',
          field,
          `Evidence for '${field}' references an unknown fact.`,
        ),
      );
      continue;
    }
    if (
      factIds.some(
        (id) =>
          evidenceFacts.get(id)?.fact_state === 'unresolved' ||
          evidenceFacts.get(id)?.fact_state === 'conflicting',
      )
    ) {
      issues.push(
        issue(
          'amendment_unresolved_evidence',
          field,
          `Unresolved or conflicting evidence cannot amend '${field}'.`,
        ),
      );
      continue;
    }
    const newValue = getPath(data, field);
    if (newValue === undefined) continue;
    setPath(proposal, field, newValue);
    changes.push({
      field,
      operation: action,
      ...(action === 'replace' ? { previous_value: getPath(current, field) } : {}),
      new_value: newValue,
      review_id: review.id,
      fact_ids: [...factIds].sort(),
    });
  }

  const topologyOperations = review.topology_operations ?? [];
  const proposedTopologyIds = new Map<CanonicalTopologyKind, Set<string>>();
  for (const operation of topologyOperations) {
    const collection = topologyCollection[operation.kind];
    const operationPath = `topology_operations.${operation.kind}:${operation.id}`;
    if (
      !collection ||
      !/^[a-z0-9][a-z0-9._-]+$/i.test(operation.id) ||
      /^\d+$/.test(operation.id) ||
      operation.id.includes('[') ||
      operation.id.includes(']')
    ) {
      issues.push(
        issue(
          'amendment_topology_invalid_id',
          operationPath,
          'Topology operation IDs must be stable component-local identifiers, not array indexes.',
        ),
      );
      continue;
    }
    if (
      !operation.value ||
      Array.isArray(operation.value) ||
      typeof operation.value !== 'object' ||
      operation.value.id !== operation.id
    ) {
      issues.push(
        issue(
          'amendment_topology_value_mismatch',
          operationPath,
          'The topology operation ID must match the object id.',
        ),
      );
      continue;
    }
    const existing =
      operation.kind === 'switching_configuration' ||
      operation.kind === 'protection_instance' ||
      operation.kind === 'measurement_instance'
        ? (() => {
            const container =
              operation.kind === 'switching_configuration'
                ? proposal.switching
                : operation.kind === 'protection_instance'
                  ? proposal.protection
                  : proposal.measurement;
            if (!container || typeof container !== 'object' || Array.isArray(container)) return [];
            const nestedKey =
              operation.kind === 'switching_configuration' ? 'configurations' : 'instances';
            return Array.isArray(container[nestedKey]) ? container[nestedKey] : [];
          })()
        : Array.isArray(proposal[collection])
          ? proposal[collection]
          : [];
    const existingIds = new Set(
      existing.flatMap((item) =>
        item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string'
          ? [item.id]
          : [],
      ),
    );
    const seen = proposedTopologyIds.get(operation.kind) ?? new Set<string>();
    if (existingIds.has(operation.id) || seen.has(operation.id)) {
      issues.push(
        issue(
          'amendment_topology_duplicate_id',
          operationPath,
          `Topology object '${operation.id}' already exists or is added more than once.`,
        ),
      );
      continue;
    }
    seen.add(operation.id);
    proposedTopologyIds.set(operation.kind, seen);

    const evidenceKey = topologyTargetKey(operation.kind, operation.id);
    const evidenceRepresentations = [
      operation.evidence,
      review.topology_evidence?.[evidenceKey],
      candidate?.topology_evidence?.[evidenceKey],
    ].filter((value): value is readonly string[] => value !== undefined);
    const normalizedEvidence = evidenceRepresentations.map((value) => [...new Set(value)].sort());
    if (
      normalizedEvidence.length > 1 &&
      normalizedEvidence.some(
        (value) => JSON.stringify(value) !== JSON.stringify(normalizedEvidence[0]),
      )
    ) {
      issues.push(
        issue(
          'amendment_topology_evidence_conflict',
          operationPath,
          `Evidence representations for '${evidenceKey}' must agree exactly.`,
        ),
      );
      continue;
    }
    const factIds = normalizedEvidence[0] ?? [];
    if (factIds.length === 0) {
      issues.push(
        issue(
          'amendment_topology_missing_evidence',
          operationPath,
          `Reviewed topology evidence is required for '${evidenceKey}'.`,
        ),
      );
      continue;
    }
    const invalidEvidence = factIds.some((factId) => {
      const fact = evidenceFacts.get(factId);
      return (
        !fact ||
        !candidate?.fact_ids?.includes(factId) ||
        fact.fact_state === 'unresolved' ||
        fact.fact_state === 'conflicting' ||
        fact.topology_target?.kind !== operation.kind ||
        fact.topology_target.id !== operation.id ||
        fact.topology_target.field !== undefined
      );
    });
    if (invalidEvidence) {
      issues.push(
        issue(
          'amendment_topology_evidence_mismatch',
          operationPath,
          `Evidence must target the reviewed ${evidenceKey} object exactly.`,
        ),
      );
      continue;
    }
    const nextCollection = [...existing, operation.value];
    if (
      operation.kind === 'switching_configuration' ||
      operation.kind === 'protection_instance' ||
      operation.kind === 'measurement_instance'
    ) {
      const rootKey =
        operation.kind === 'switching_configuration'
          ? 'switching'
          : operation.kind === 'protection_instance'
            ? 'protection'
            : 'measurement';
      const nestedKey =
        operation.kind === 'switching_configuration' ? 'configurations' : 'instances';
      const currentContainer =
        proposal[rootKey] &&
        typeof proposal[rootKey] === 'object' &&
        !Array.isArray(proposal[rootKey])
          ? proposal[rootKey]
          : {};
      proposal[rootKey] = { ...currentContainer, [nestedKey]: nextCollection };
    } else {
      proposal[collection] = nextCollection;
    }
    topologyChanges.push({
      operation: 'add',
      kind: operation.kind,
      id: operation.id,
      value: operation.value,
      fact_ids: [...factIds].sort(),
      review_id: review.id,
    });
  }

  issues.push(...validateProposedTopology(proposal));

  changes.sort((left, right) => left.field.localeCompare(right.field));
  if ((changes.length > 0 || topologyChanges.length > 0) && candidate) {
    const history = Array.isArray(current.amendment_history) ? current.amendment_history : [];
    proposal.amendment_history = [
      ...history,
      amendmentHistoryEntry(review, expectedSnapshot ?? '', changes, candidate, topologyChanges),
    ];
  }
  issues.push(...schemaIssues(proposal));

  if (issues.length > 0) {
    const blocking = issues.some((item) => item.code !== 'amendment_invalid_component');
    return {
      status: blocking ? 'blocked' : 'invalid',
      issues,
      proposal,
      current,
      expected_snapshot: expectedSnapshot,
      actual_snapshot: actualSnapshot,
      changes,
      topology_changes: topologyChanges,
      schema_valid: false,
    };
  }
  return {
    status: 'proposed',
    issues: [],
    proposal,
    current,
    expected_snapshot: expectedSnapshot,
    actual_snapshot: actualSnapshot,
    serialized: canonicalYaml(proposal),
    changes,
    topology_changes: topologyChanges,
    schema_valid: true,
  };
};

export const proposedAmendedCanonicalComponent = (
  request: CanonicalAmendmentRequest,
): CanonicalAmendmentResult => proposeCanonicalAmendment(request);

export const writeCanonicalAmendment = async (
  request: CanonicalAmendmentRequest,
): Promise<CanonicalAmendmentResult> => {
  const proposalResult = proposeCanonicalAmendment(request);
  if (proposalResult.status !== 'proposed') return proposalResult;
  const destinationRoot = request.destinationRoot ?? process.cwd();
  const componentId = String(
    request.review.component_id ?? request.review.canonical_id ?? proposalResult.proposal?.id ?? '',
  );
  const targetFilename = request.filename ?? `${componentId}.yaml`;
  if (targetFilename !== `${componentId}.yaml`) {
    return {
      ...proposalResult,
      status: 'blocked',
      issues: [
        issue(
          'write_path_invalid',
          'filename',
          `Amendment filename must be '${componentId}.yaml'.`,
        ),
      ],
    };
  }
  const safePath = safeCanonicalPath(destinationRoot, targetFilename);
  if (safePath.issue || !safePath.path) {
    return { ...proposalResult, status: 'blocked', issues: safePath.issue ? [safePath.issue] : [] };
  }
  const targetPath = safePath.path;
  const filesystem = request.filesystem ?? {
    access,
    readFile: async (path: string, encoding: 'utf8') => readFile(path, encoding),
    mkdir,
    writeFile,
    rename,
    rm,
  };
  if (!request.write) {
    return {
      ...proposalResult,
      status: 'dry_run',
      path: targetPath,
      serialized: proposalResult.serialized,
      issues: [
        issue(
          'amendment_write_not_authorized',
          'write',
          'Explicit write authorization is required.',
        ),
      ],
    };
  }

  let diskCurrent: JsonObject;
  try {
    await filesystem.access(targetPath);
    const raw = await filesystem.readFile(targetPath, 'utf8');
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Canonical target is not an object.');
    diskCurrent = parsed as JsonObject;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ...proposalResult,
      status: 'blocked',
      issues: [
        issue(
          'amendment_target_missing',
          'path',
          code === 'ENOENT' ? 'Canonical amendment target does not exist.' : String(error),
        ),
      ],
    };
  }
  if (diskCurrent.id !== componentId) {
    return {
      ...proposalResult,
      status: 'blocked',
      issues: [
        issue(
          'amendment_component_not_found',
          'path',
          'On-disk component ID does not match the review.',
        ),
      ],
    };
  }
  const diskSnapshot = canonicalSerializedSnapshot(diskCurrent);
  const expected = request.review.expected_snapshot ?? request.review.expected_current_snapshot;
  if (diskSnapshot !== expected || canonicalSerializedSnapshot(request.current) !== diskSnapshot) {
    return {
      ...proposalResult,
      status: 'blocked',
      actual_snapshot: diskSnapshot,
      issues: [
        issue(
          'canonical_snapshot_mismatch',
          'expected_snapshot',
          'The on-disk canonical snapshot is stale relative to the reviewed and supplied records.',
        ),
      ],
    };
  }
  const diskProposal = proposeCanonicalAmendment({ ...request, current: diskCurrent });
  if (diskProposal.status !== 'proposed' || !diskProposal.proposal) return diskProposal;
  const schemaErrors = schemaIssues(diskProposal.proposal);
  if (schemaErrors.length > 0) return { ...diskProposal, status: 'invalid', issues: schemaErrors };
  const serialized = canonicalYaml(diskProposal.proposal);
  const tempPath = join(dirname(targetPath), `.${targetFilename}.${process.pid}.${Date.now()}.tmp`);
  const backupPath = `${targetPath}.${process.pid}.${Date.now()}.bak`;
  let backupCreated = false;
  let replacementCompleted = false;
  const removeTempSafely = async (): Promise<void> => {
    try {
      await filesystem.rm(tempPath, { force: true });
    } catch {
      // A failed temporary cleanup must not obscure the canonical recovery state.
    }
  };
  try {
    await filesystem.mkdir(dirname(targetPath), { recursive: true });
    await filesystem.writeFile(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });
    await filesystem.rename(targetPath, backupPath);
    backupCreated = true;
    try {
      await filesystem.rename(tempPath, targetPath);
      replacementCompleted = true;
      await filesystem.access(targetPath);
      await filesystem.rm(backupPath, { force: true });
    } catch (error) {
      if (backupCreated && !replacementCompleted) {
        try {
          await filesystem.rename(backupPath, targetPath);
          backupCreated = false;
          await removeTempSafely();
          return {
            ...diskProposal,
            status: 'blocked',
            issues: [
              issue(
                'write_failed',
                'path',
                `Canonical replacement failed; rollback restored the original target: ${error instanceof Error ? error.message : String(error)}`,
              ),
            ],
          };
        } catch (rollbackError) {
          await removeTempSafely();
          return {
            ...diskProposal,
            status: 'blocked',
            issues: [
              issue(
                'write_failed',
                'path',
                `Canonical replacement failed and rollback also failed. Backup preserved at '${backupPath}' for recovery. Replacement error: ${error instanceof Error ? error.message : String(error)}. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
              ),
            ],
          };
        }
      }
      throw error;
    }
  } catch (error) {
    await removeTempSafely();
    return {
      ...diskProposal,
      status: 'blocked',
      issues: [
        issue(
          'write_failed',
          'path',
          `Unable to atomically replace canonical component: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }
  return { ...diskProposal, status: 'written', path: targetPath, serialized, issues: [] };
};

export const applyCanonicalAmendment = writeCanonicalAmendment;
