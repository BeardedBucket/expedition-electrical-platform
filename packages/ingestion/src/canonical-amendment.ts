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
  | 'amendment_candidate_validation_failed';

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
}

export interface CanonicalAmendmentCandidate {
  readonly component_data?: JsonObject;
  readonly field_evidence?: Readonly<Record<string, readonly string[]>>;
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
): JsonObject => ({
  review_id: review.id,
  candidate_id: review.candidate_id,
  expected_snapshot: expectedSnapshot,
  fields: changes.map((change) => ({ ...change, fact_ids: [...change.fact_ids] })),
  source_ids: [...(candidate?.source_ids ?? [])],
});

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

  changes.sort((left, right) => left.field.localeCompare(right.field));
  if (changes.length > 0 && candidate) {
    const history = Array.isArray(current.amendment_history) ? current.amendment_history : [];
    proposal.amendment_history = [
      ...history,
      amendmentHistoryEntry(review, expectedSnapshot ?? '', changes, candidate),
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
