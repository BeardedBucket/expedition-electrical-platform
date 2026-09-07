import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import interactionRelationshipSchema from '../../../data/schemas/interaction-relationship.schema.json' with { type: 'json' };
import type { JsonObject, JsonValue } from './contracts.js';

export type InteractionRelationshipKind =
  | 'manufacturer_interoperability'
  | 'required_intermediate'
  | 'information_sharing'
  | 'information_consumption'
  | 'control_interaction';

export type InteractionRelationshipScope =
  | 'exact_product'
  | 'model'
  | 'product_family'
  | 'manufacturer_ecosystem'
  | 'accessory_class'
  | 'unknown';

export type InteractionRelationshipParticipantKind =
  | 'interaction_endpoint'
  | 'exact_product'
  | 'product_model'
  | 'product_family'
  | 'manufacturer_ecosystem'
  | 'accessory_class'
  | 'unresolved_external';

export type InteractionParticipantReferenceResolver = (
  kind: InteractionRelationshipParticipantKind,
  ref: string,
) => boolean;

export interface InteractionRelationshipParticipant {
  readonly ref: string;
  readonly kind: InteractionRelationshipParticipantKind;
  readonly role: string;
  readonly endpoint_id?: string;
  readonly display_name?: string;
}

export interface InteractionRelationshipCondition {
  readonly kind:
    | 'accessory_required'
    | 'brand_dependent'
    | 'firmware'
    | 'hardware_revision'
    | 'connection'
    | 'configuration'
    | 'other';
  readonly value: string;
}

export type InteractionEvidenceScope =
  | 'exact_product'
  | 'product_model'
  | 'product_family'
  | 'manufacturer_ecosystem'
  | 'accessory_class'
  | 'unresolved'
  | 'other';

export interface InteractionEvidenceApplicability {
  readonly scope: InteractionEvidenceScope;
  readonly ref?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly family?: string;
  readonly ecosystem?: string;
  readonly accessory?: string;
}

export interface InteractionInformationClaim {
  readonly direction: 'exposes' | 'consumes';
  readonly participant_ref: string;
  readonly term: string;
  readonly raw_wording?: string;
}

export interface InteractionRelationshipPromotionHistoryEntry {
  readonly review_id: string;
  readonly candidate_id: string;
  readonly relationship_id: string;
  readonly reviewer_id: string;
  readonly reviewed_at: string;
  readonly expected_snapshot: string;
  readonly canonical_snapshot: string;
  readonly decision: 'approved' | 'rejected';
  readonly source_ids: readonly string[];
  readonly fact_ids: readonly string[];
}

export interface InteractionRelationship {
  readonly schema_version: string;
  readonly id: string;
  readonly relationship_kind: InteractionRelationshipKind;
  readonly participants: readonly InteractionRelationshipParticipant[];
  readonly required_intermediates?: readonly string[];
  readonly scope: InteractionRelationshipScope;
  readonly information?: readonly InteractionInformationClaim[];
  readonly conditions?: readonly InteractionRelationshipCondition[];
  readonly notes?: string;
  readonly evidence: {
    readonly source_ids: readonly string[];
    readonly fact_ids: readonly string[];
    readonly applicability?: readonly InteractionEvidenceApplicability[];
  };
  readonly state: 'verified' | 'provisional' | 'unresolved' | 'conflicting';
  readonly promotion_history?: readonly InteractionRelationshipPromotionHistoryEntry[];
}

export interface InteractionRelationshipValidationIssue {
  readonly code:
    | 'invalid_relationship'
    | 'duplicate_id'
    | 'duplicate_participant_ref'
    | 'missing_participant'
    | 'invalid_intermediate_ref'
    | 'invalid_information_ref'
    | 'missing_evidence'
    | 'canonical_identity_unresolved';
  readonly path: string;
  readonly message: string;
}

export interface InteractionRelationshipValidation {
  readonly status: 'valid' | 'invalid' | 'unresolved';
  readonly issues: readonly InteractionRelationshipValidationIssue[];
  readonly ok: boolean;
}

const issue = (
  code: InteractionRelationshipValidationIssue['code'],
  path: string,
  message: string,
): InteractionRelationshipValidationIssue => ({ code, path, message });

const isObject = (value: JsonValue | unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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

export type CanonicalInteractionRelationshipStatus =
  'proposed' | 'blocked' | 'invalid' | 'dry_run' | 'written';

export type CanonicalInteractionRelationshipIssueCode =
  | 'review_not_approved'
  | 'missing_expected_snapshot'
  | 'canonical_snapshot_mismatch'
  | 'relationship_id_mismatch'
  | 'relationship_already_exists'
  | 'relationship_invalid'
  | 'relationship_missing_evidence'
  | 'reviewed_evidence_missing'
  | 'source_or_fact_missing'
  | 'invalid_intermediate_ref'
  | 'invalid_information_ref'
  | 'state_not_canonical'
  | 'write_not_authorized'
  | 'write_path_invalid'
  | 'write_failed'
  | 'write_target_missing'
  | 'review_conflicting'
  | 'duplicate_relationship_id'
  | 'canonical_identity_unresolved'
  | 'source_evidence_scope_mismatch'
  | 'derived_compatibility_rejected'
  | 'installed_system_rejected';

export interface CanonicalInteractionRelationshipIssue {
  readonly code: CanonicalInteractionRelationshipIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface CanonicalInteractionRelationshipReview {
  readonly schema_version: string;
  readonly id: string;
  readonly relationship_id: string;
  readonly candidate_id: string;
  readonly decision: 'approved' | 'rejected';
  readonly reviewer_id: string;
  readonly reviewed_at: string;
  readonly expected_snapshot?: string;
  readonly expected_current_snapshot?: string;
  readonly evidence_acknowledged: boolean;
  readonly rationale?: string;
  readonly notes?: string;
  readonly source_ids?: readonly string[];
  readonly fact_ids?: readonly string[];
}

export interface CanonicalInteractionRelationshipCandidate {
  readonly relationship?: InteractionRelationship;
  readonly source_ids?: readonly string[];
  readonly fact_ids?: readonly string[];
  readonly source_evidence?: Readonly<Record<string, readonly string[]>>;
  readonly facts?: ReadonlyArray<{
    readonly id: string;
    readonly source_id?: string;
    readonly fact_state?: InteractionRelationship['state'];
  }>;
}

export interface CanonicalInteractionRelationshipFilesystem {
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

export interface CanonicalInteractionRelationshipRequest {
  readonly current: InteractionRelationship;
  readonly candidate?: CanonicalInteractionRelationshipCandidate;
  readonly review: CanonicalInteractionRelationshipReview;
  readonly write?: boolean;
  readonly destinationRoot?: string;
  readonly filename?: string;
  readonly filesystem?: CanonicalInteractionRelationshipFilesystem;
  readonly participantReferenceResolver?: InteractionParticipantReferenceResolver;
}

export interface CanonicalInteractionRelationshipResult {
  readonly status: CanonicalInteractionRelationshipStatus;
  readonly issues: readonly CanonicalInteractionRelationshipIssue[];
  readonly proposal?: InteractionRelationship;
  readonly current?: InteractionRelationship;
  readonly expected_snapshot?: string;
  readonly actual_snapshot?: string;
  readonly path?: string;
  readonly serialized?: string;
  readonly schema_valid: boolean;
}

const canonicalInteractionRelationshipIssue = (
  code: CanonicalInteractionRelationshipIssueCode,
  path: string,
  message: string,
): CanonicalInteractionRelationshipIssue => ({ code, path, message });

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

const safeInteractionRelationshipPath = (
  destinationRoot: string,
  filename: string,
): { path?: string; issue?: CanonicalInteractionRelationshipIssue } => {
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
      issue: canonicalInteractionRelationshipIssue(
        'write_path_invalid',
        'filename',
        'Interaction relationship filename must be a single .yaml filename.',
      ),
    };
  }
  const root = resolve(destinationRoot);
  const target = resolve(root, filename);
  const withinRoot = relative(root, target);
  if (!withinRoot || withinRoot.startsWith('..') || isAbsolute(withinRoot)) {
    return {
      issue: canonicalInteractionRelationshipIssue(
        'write_path_invalid',
        'filename',
        'Canonical relationship destination must remain inside the declared root directory.',
      ),
    };
  }
  return { path: target };
};

const requiresConcreteIdentityResolution = (
  kind: InteractionRelationshipParticipantKind,
): boolean =>
  kind === 'interaction_endpoint' || kind === 'exact_product' || kind === 'product_model';

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
          `Information participant '${claim.participant_ref}' is not a participant.`,
        ),
      );
    }
  });

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

export const writeCanonicalInteractionRelationship = async (
  request: CanonicalInteractionRelationshipRequest,
): Promise<CanonicalInteractionRelationshipResult> => {
  const proposalResult = proposeCanonicalInteractionRelationship(request);
  if (proposalResult.status !== 'proposed') return proposalResult;
  const destinationRoot = request.destinationRoot ?? process.cwd();
  const relationshipId = String(
    request.review.relationship_id ?? proposalResult.proposal?.id ?? '',
  );
  const targetFilename = request.filename ?? `${relationshipId}.yaml`;
  const safePath = safeInteractionRelationshipPath(destinationRoot, targetFilename);
  if (safePath.issue || !safePath.path) {
    return {
      ...proposalResult,
      status: 'blocked',
      issues: safePath.issue ? [safePath.issue] : [],
    };
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
        canonicalInteractionRelationshipIssue(
          'write_not_authorized',
          'write',
          'Explicit write authorization is required to persist canonical relationship data.',
        ),
      ],
    };
  }

  try {
    await filesystem.access(targetPath);
    const raw = await filesystem.readFile(targetPath, 'utf8');
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Canonical relationship target is not an object.');
    }
    const diskCurrent = parsed as InteractionRelationship;
    const expected = request.review.expected_snapshot ?? request.review.expected_current_snapshot;
    const diskSnapshot = canonicalInteractionRelationshipSnapshot(diskCurrent);
    if (diskCurrent.id !== relationshipId) {
      return {
        ...proposalResult,
        status: 'blocked',
        issues: [
          canonicalInteractionRelationshipIssue(
            'relationship_already_exists',
            'path',
            'On-disk canonical relationship ID does not match the review target.',
          ),
        ],
      };
    }
    if (
      diskSnapshot !== expected ||
      canonicalInteractionRelationshipSnapshot(request.current) !== diskSnapshot
    ) {
      return {
        ...proposalResult,
        status: 'blocked',
        actual_snapshot: diskSnapshot,
        issues: [
          canonicalInteractionRelationshipIssue(
            'canonical_snapshot_mismatch',
            'expected_snapshot',
            'The on-disk canonical relationship snapshot is stale relative to the reviewed and supplied records.',
          ),
        ],
      };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // New relationship; continue with atomic write.
    } else {
      return {
        ...proposalResult,
        status: 'blocked',
        issues: [
          canonicalInteractionRelationshipIssue(
            'write_target_missing',
            'path',
            `Unable to read canonical relationship target: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ],
      };
    }
  }

  const serialized = stringifyYaml(proposalResult.proposal, { sortMapEntries: true });
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
    try {
      await filesystem.access(targetPath);
      await filesystem.rename(targetPath, backupPath);
      backupCreated = true;
    } catch {
      // Create a new file if we are writing a canonical relationship for the first time.
    }
    try {
      await filesystem.rename(tempPath, targetPath);
      replacementCompleted = true;
      await filesystem.access(targetPath);
      if (backupCreated) await filesystem.rm(backupPath, { force: true });
    } catch (error) {
      if (backupCreated && !replacementCompleted) {
        try {
          await filesystem.rename(backupPath, targetPath);
          await removeTempSafely();
          return {
            ...proposalResult,
            status: 'blocked',
            issues: [
              canonicalInteractionRelationshipIssue(
                'write_failed',
                'path',
                `Canonical relationship replacement failed; rollback restored the original target: ${error instanceof Error ? error.message : String(error)}`,
              ),
            ],
          };
        } catch (rollbackError) {
          await removeTempSafely();
          return {
            ...proposalResult,
            status: 'blocked',
            issues: [
              canonicalInteractionRelationshipIssue(
                'write_failed',
                'path',
                `Canonical relationship replacement failed and rollback also failed. Backup preserved at '${backupPath}' for recovery. Replacement error: ${error instanceof Error ? error.message : String(error)}. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
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
      ...proposalResult,
      status: 'blocked',
      issues: [
        canonicalInteractionRelationshipIssue(
          'write_failed',
          'path',
          `Unable to atomically replace canonical relationship: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }

  return {
    ...proposalResult,
    status: 'written',
    path: targetPath,
    serialized,
    issues: [],
  };
};

export const applyCanonicalInteractionRelationship = writeCanonicalInteractionRelationship;
