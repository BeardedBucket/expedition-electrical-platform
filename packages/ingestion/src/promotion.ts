import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import componentSchema from '../../../data/schemas/component.schema.json' with { type: 'json' };
import type {
  JsonObject,
  JsonValue,
  ProductCandidate,
  ProductFact,
  ProductSource,
} from './contracts.js';
import { validateProductCandidate } from './validation.js';

export type PromotionResultStatus = 'success' | 'blocked' | 'invalid';
export type PromotionIssueCode =
  | 'promotion_review_not_approved'
  | 'promotion_candidate_conflicting'
  | 'promotion_identity_unresolved'
  | 'promotion_missing_required_field'
  | 'promotion_unresolved_field'
  | 'promotion_invalid_component'
  | 'promotion_evidence_missing'
  | 'promotion_dangling_resolution'
  | 'promotion_candidate_validation_failed'
  | 'promotion_snapshot_missing'
  | 'promotion_snapshot_mismatch'
  | 'promotion_already_exists'
  | 'write_not_authorized'
  | 'write_path_invalid'
  | 'write_failed';

export interface PromotionIssue {
  readonly code: PromotionIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface PromotionFieldResolution {
  readonly selected_fact_id: string;
  readonly rationale: string;
}

export interface PromotionReview {
  readonly schema_version: string;
  readonly id: string;
  readonly candidate_id: string;
  readonly candidate_snapshot?: string;
  readonly decision: 'approved' | 'rejected';
  readonly reviewer_id: string;
  readonly reviewed_at: string;
  readonly approved_fields: readonly string[];
  readonly excluded_fields?: readonly string[];
  readonly excluded_fact_ids?: readonly string[];
  readonly field_resolutions?: Readonly<Record<string, PromotionFieldResolution>>;
  readonly evidence_acknowledged: boolean;
  readonly product_role: string;
  readonly category: string;
  readonly notes?: string;
}

export interface PromotionCatalogContext {
  readonly components?: readonly JsonObject[];
}

export interface PromotionOptions {
  readonly allowLegacyReview?: boolean;
}

export interface PromotionAudit {
  readonly candidate_id: string;
  readonly review_id: string;
  readonly reviewer_id: string;
  readonly reviewed_at: string;
  readonly source_ids: readonly string[];
  readonly field_evidence: Readonly<Record<string, readonly string[]>>;
  readonly omitted_fields: readonly string[];
  readonly unverified_fact_ids: readonly string[];
}

export interface PromotionResult {
  readonly status: PromotionResultStatus;
  readonly issues: readonly PromotionIssue[];
  readonly proposal?: JsonObject;
  readonly audit?: PromotionAudit;
}

type Validator = ((_value: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }>;
};
const AjvCtor = Ajv2020 as unknown as new (options?: Record<string, unknown>) => {
  compile: (_value: unknown) => Validator;
};
const ajv = new AjvCtor({ allErrors: true, strict: false });
const registerFormats = addFormats as unknown as (instance: {
  addFormat?: (...args: unknown[]) => void;
}) => void;
registerFormats(ajv as unknown as { addFormat?: (...args: unknown[]) => void });
const componentValidator = ajv.compile(componentSchema);

const issue = (code: PromotionIssueCode, path: string, message: string): PromotionIssue => ({
  code,
  path,
  message,
});

const populatedFields = (value: unknown, prefix = ''): string[] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) =>
    populatedFields(child, prefix ? `${prefix}.${key}` : key),
  );
};

const getPath = (root: JsonObject, path: string): JsonValue | undefined =>
  path
    .split('.')
    .reduce<JsonValue | undefined>(
      (value, segment) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as JsonObject)[segment]
          : undefined,
      root,
    );

const setPath = (root: JsonObject, path: string, value: JsonValue): void => {
  const segments = path.split('.');
  let cursor = root as { [key: string]: JsonValue };
  segments.slice(0, -1).forEach((segment) => {
    const child = cursor[segment];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) cursor[segment] = {};
    cursor = cursor[segment] as { [key: string]: JsonValue };
  });
  cursor[segments[segments.length - 1]] = value;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
};

export const promotionCandidateSnapshot = (
  candidate: ProductCandidate,
  sources: readonly ProductSource[],
  facts: readonly ProductFact[],
): string => {
  const relevantFactIds = new Set(Object.values(candidate.field_evidence).flat());
  const snapshot = {
    candidate: {
      id: candidate.id,
      identity: candidate.identity,
      identity_status: candidate.identity_status,
      review_status: candidate.review_status,
      promotion_status: candidate.promotion_status,
      component_data: candidate.component_data,
      fact_ids: candidate.fact_ids,
      field_evidence: candidate.field_evidence,
    },
    facts: facts
      .filter((fact) => relevantFactIds.has(fact.id))
      .map((fact) => ({
        id: fact.id,
        source_id: fact.source_id,
        field: fact.field,
        raw_value: fact.raw_value,
        normalized_value: fact.normalized_value ?? null,
        normalized_unit: fact.normalized_unit ?? null,
        fact_state: fact.fact_state,
        review_required: fact.review_required ?? false,
      })),
    sources: sources
      .filter((source) => candidate.source_ids.includes(source.id))
      .map((source) => ({
        id: source.id,
        content_hash: source.content_hash ?? null,
        applicability: source.applicability ?? null,
      })),
  };
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(stableValue(snapshot)), 'utf8')
    .digest('hex')}`;
};

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const canonicalIdFor = (candidate: ProductCandidate): string => {
  const identity = candidate.identity;
  const key = identity.manufacturer_part_number ?? `${identity.manufacturer}-${identity.model}`;
  return `${slug(identity.manufacturer ?? 'component')}.${slug(key)}`;
};

export const canonicalProposalSchemaIssues = (proposal: JsonObject): PromotionIssue[] => {
  componentValidator(proposal);
  return (componentValidator.errors ?? []).map((error) =>
    issue(
      'promotion_invalid_component',
      error.instancePath || '/',
      error.message ?? 'canonical component does not match the schema.',
    ),
  );
};

export const canonicalProposalSchemaValid = (proposal: JsonObject): boolean =>
  componentValidator(proposal);

export const canonicalIdentityCollision = (
  proposal: JsonObject,
  components: readonly JsonObject[],
): boolean =>
  components.some(
    (component) =>
      component.id === proposal.id ||
      (proposal.part_number !== null &&
        proposal.part_number !== undefined &&
        component.manufacturer === proposal.manufacturer &&
        component.part_number === proposal.part_number),
  );

const schemaIssues = (): PromotionIssue[] =>
  (componentValidator.errors ?? []).map((error) =>
    issue(
      'promotion_invalid_component',
      error.instancePath || '/',
      error.message ?? 'canonical component does not match the schema.',
    ),
  );

const sourceRefsFor = (
  sources: readonly ProductSource[],
  candidate: ProductCandidate,
  review: PromotionReview,
  selectedFieldEvidence: Readonly<Record<string, readonly string[]>>,
): JsonValue[] =>
  sources
    .filter((source) => candidate.source_ids.includes(source.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((source) => ({
      id: source.id,
      type: source.source_type,
      uri: source.uri,
      publisher: source.publisher,
      retrieved_at: source.retrieved_at,
      ...(source.content_hash ? { content_hash: source.content_hash } : {}),
      candidate_id: candidate.id,
      review_id: review.id,
      fact_ids: [...new Set(Object.values(selectedFieldEvidence).flat())]
        .filter((factId) => candidate.fact_ids.includes(factId))
        .sort(),
    }));

const factsForCandidateValidation = (
  candidate: ProductCandidate,
  facts: readonly ProductFact[],
): ProductFact[] => {
  const fieldByFactId = new Map(
    Object.entries(candidate.field_evidence).flatMap(([field, factIds]) =>
      factIds.map((factId) => [factId, field] as const),
    ),
  );
  return facts.map((fact) => {
    const field = fieldByFactId.get(fact.id);
    return field ? { ...fact, field } : fact;
  });
};

export const promoteCandidate = (
  candidate: ProductCandidate,
  sources: readonly ProductSource[],
  facts: readonly ProductFact[],
  review: PromotionReview,
  catalogContext: PromotionCatalogContext = {},
  options: PromotionOptions = {},
): PromotionResult => {
  const issues: PromotionIssue[] = [];
  const snapshot = promotionCandidateSnapshot(candidate, sources, facts);
  if (!review.candidate_snapshot) {
    if (!options.allowLegacyReview) {
      issues.push(
        issue(
          'promotion_snapshot_missing',
          'review.candidate_snapshot',
          'New promotion reviews must bind the exact reviewed candidate snapshot.',
        ),
      );
    }
  } else if (review.candidate_snapshot !== snapshot) {
    issues.push(
      issue(
        'promotion_snapshot_mismatch',
        'review.candidate_snapshot',
        'The candidate or promotion-relevant evidence changed after review.',
      ),
    );
  }
  const candidateValidation = validateProductCandidate(
    candidate,
    sources,
    factsForCandidateValidation(candidate, facts),
  );
  if (candidateValidation.status === 'invalid') {
    issues.push(
      ...candidateValidation.issues
        .filter((item) => item.category === 'invalid')
        .map((item) => issue('promotion_candidate_validation_failed', item.path, item.message)),
    );
    return { status: 'invalid', issues };
  }
  if (review.candidate_id !== candidate.id || review.decision !== 'approved') {
    issues.push(
      issue(
        'promotion_review_not_approved',
        'review',
        'Promotion requires an explicit approved review for this candidate.',
      ),
    );
  }
  if (!review.id.trim() || !review.reviewer_id.trim() || !review.reviewed_at.trim()) {
    issues.push(
      issue(
        'promotion_review_not_approved',
        'review',
        'Approved reviews require an ID, reviewer, and explicit review timestamp.',
      ),
    );
  }
  if (candidate.identity_status === 'unresolved') {
    issues.push(
      issue(
        'promotion_identity_unresolved',
        'identity_status',
        'Candidate identity is unresolved.',
      ),
    );
  } else if (candidate.identity_status === 'conflicting') {
    issues.push(
      issue(
        'promotion_candidate_conflicting',
        'identity_status',
        'Candidate identity contains conflicting claims.',
      ),
    );
  }
  if (!review.evidence_acknowledged) {
    issues.push(
      issue(
        'promotion_evidence_missing',
        'review.evidence_acknowledged',
        'The review must explicitly acknowledge the candidate evidence.',
      ),
    );
  }
  const sourceIds = new Set(sources.map((source) => source.id));
  if (candidate.identity_source_ids.some((sourceId) => !sourceIds.has(sourceId))) {
    issues.push(
      issue(
        'promotion_evidence_missing',
        'identity_source_ids',
        'Candidate identity evidence references a missing source.',
      ),
    );
  }

  const candidateFields = [
    ...new Set([
      ...populatedFields(candidate.component_data),
      ...Object.keys(candidate.field_evidence).filter(
        (field) => getPath(candidate.component_data, field) !== undefined,
      ),
    ]),
  ];
  const approvedFields = new Set(review.approved_fields);
  const resolutions = review.field_resolutions ?? {};
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const selectedFieldEvidence: Record<string, readonly string[]> = {};
  const omittedFields = candidateFields.filter((field) => !approvedFields.has(field)).sort();
  const proposalData: JsonObject = {};

  candidateFields
    .filter((field) => approvedFields.has(field))
    .sort()
    .forEach((field) => {
      const evidenceIds = candidate.field_evidence[field];
      if (!evidenceIds || evidenceIds.length === 0) {
        issues.push(
          issue(
            'promotion_evidence_missing',
            `field_evidence.${field}`,
            `Approved field '${field}' has no evidence.`,
          ),
        );
        return;
      }
      const resolution = resolutions[field];
      const selectedFactIds = resolution ? [resolution.selected_fact_id] : evidenceIds;
      if (
        resolution &&
        (!resolution.rationale.trim() || !factById.has(resolution.selected_fact_id))
      ) {
        issues.push(
          issue(
            'promotion_dangling_resolution',
            `field_resolutions.${field}`,
            `Resolution for '${field}' must select an existing fact and include rationale.`,
          ),
        );
        return;
      }
      if (selectedFactIds.some((factId) => !candidate.fact_ids.includes(factId))) {
        issues.push(
          issue(
            'promotion_dangling_resolution',
            `field_resolutions.${field}`,
            `Resolution for '${field}' references a fact outside the candidate.`,
          ),
        );
        return;
      }
      const selectedFacts = selectedFactIds
        .map((factId) => factById.get(factId))
        .filter((fact): fact is ProductFact => fact !== undefined);
      if (selectedFacts.some((fact) => fact.fact_state === 'unresolved')) {
        issues.push(
          issue(
            'promotion_unresolved_field',
            field,
            `Approved field '${field}' selects unresolved evidence.`,
          ),
        );
        return;
      }
      selectedFieldEvidence[field] = [...selectedFactIds].sort();
      const value = getPath(candidate.component_data, field);
      if (value !== undefined) setPath(proposalData, field, value);
    });

  const manufacturer = candidate.identity.manufacturer;
  const model = candidate.identity.model;
  if (!manufacturer)
    issues.push(
      issue('promotion_missing_required_field', 'manufacturer', 'Manufacturer is required.'),
    );
  if (!model) issues.push(issue('promotion_missing_required_field', 'model', 'Model is required.'));
  if (!review.category.trim())
    issues.push(
      issue('promotion_missing_required_field', 'review.category', 'Category is required.'),
    );
  if (!review.product_role.trim())
    issues.push(
      issue('promotion_missing_required_field', 'review.product_role', 'Product role is required.'),
    );

  const canonicalManufacturer = manufacturer ?? '';
  const canonicalModel = model ?? '';
  const canonicalId = canonicalIdFor(candidate);
  const proposalIdentity: JsonObject = {
    id: canonicalId,
    manufacturer: canonicalManufacturer,
    part_number: candidate.identity.manufacturer_part_number ?? null,
  };
  if (canonicalIdentityCollision(proposalIdentity, catalogContext.components ?? [])) {
    issues.push(
      issue(
        'promotion_already_exists',
        'catalogContext.components',
        `A canonical component already exists for '${canonicalId}'.`,
      ),
    );
  }

  if (issues.length > 0)
    return {
      status: issues.some((item) => item.code === 'promotion_candidate_validation_failed')
        ? 'invalid'
        : 'blocked',
      issues,
    };

  const proposal: JsonObject = {
    id: canonicalId,
    manufacturer: canonicalManufacturer,
    model: canonicalModel,
    part_number: candidate.identity.manufacturer_part_number ?? null,
    product_role: review.product_role,
    category: review.category,
    product_family: candidate.identity.product_family ?? null,
    verification_status: 'unverified',
    source_refs: sourceRefsFor(sources, candidate, review, selectedFieldEvidence),
    ...proposalData,
  };
  if (!componentValidator(proposal)) return { status: 'invalid', issues: schemaIssues() };

  const audit: PromotionAudit = {
    candidate_id: candidate.id,
    review_id: review.id,
    reviewer_id: review.reviewer_id,
    reviewed_at: review.reviewed_at,
    source_ids: [...candidate.source_ids].sort(),
    field_evidence: selectedFieldEvidence,
    omitted_fields: omittedFields,
    unverified_fact_ids: facts
      .filter((fact) => fact.fact_state !== 'verified')
      .map((fact) => fact.id)
      .sort(),
  };
  return { status: 'success', issues: [], proposal, audit };
};
