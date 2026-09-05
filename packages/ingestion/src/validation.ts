import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import candidateSchema from '../../../data/schemas/product-candidate.schema.json' with { type: 'json' };
import factSchema from '../../../data/schemas/product-fact.schema.json' with { type: 'json' };
import sourceSchema from '../../../data/schemas/product-source.schema.json' with { type: 'json' };
import type { ProductCandidate, ProductFact, ProductSource } from './contracts.js';

export type IngestionIssueCategory = 'invalid' | 'unresolved';
export interface IngestionIssue {
  readonly code: string;
  readonly category: IngestionIssueCategory;
  readonly path: string;
  readonly message: string;
}
export type IngestionValidationStatus = 'valid' | 'unresolved' | 'invalid';
export interface IngestionValidation {
  readonly status: IngestionValidationStatus;
  readonly issues: readonly IngestionIssue[];
  readonly ok: boolean;
}

type Validator = ((_value: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string; keyword?: string }>;
};
const AjvCtor = Ajv2020 as unknown as new (options?: Record<string, unknown>) => {
  compile: (_value: unknown) => Validator;
};
const ajv = new AjvCtor({ allErrors: true, strict: false });
const registerFormats = addFormats as unknown as (instance: {
  addFormat?: (...args: unknown[]) => void;
}) => void;
registerFormats(ajv as unknown as { addFormat?: (...args: unknown[]) => void });
const sourceValidator = ajv.compile(sourceSchema);
const factValidator = ajv.compile(factSchema);
const candidateValidator = ajv.compile(candidateSchema);

const schemaIssues = (validator: Validator, _value: unknown): IngestionIssue[] =>
  validator.errors?.map((error) => ({
    code: `schema_${error.keyword ?? 'invalid'}`,
    category: 'invalid',
    path: error.instancePath || '/',
    message: error.message ?? 'does not match the schema.',
  })) ?? [];

const issue = (
  code: string,
  category: IngestionIssueCategory,
  path: string,
  message: string,
): IngestionIssue => ({ code, category, path, message });

const result = (issues: IngestionIssue[]): IngestionValidation => ({
  status: issues.some((item) => item.category === 'invalid')
    ? 'invalid'
    : issues.length > 0
      ? 'unresolved'
      : 'valid',
  issues,
  ok: !issues.some((item) => item.category === 'invalid'),
});

const duplicateIds = <T extends { id: string }>(
  items: readonly T[],
  collection: string,
): IngestionIssue[] => {
  const seen = new Set<string>();
  const issues: IngestionIssue[] = [];
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      issues.push(
        issue(
          'duplicate_id',
          'invalid',
          `${collection}[${index}].id`,
          `duplicate ID '${item.id}'.`,
        ),
      );
    }
    seen.add(item.id);
  });
  return issues;
};

export const validateProductSources = (sources: readonly ProductSource[]): IngestionValidation => {
  const issues = duplicateIds(sources, 'sources');
  sources.forEach((source, index) => {
    if (!sourceValidator(source))
      issues.push(
        ...schemaIssues(sourceValidator, source).map((item) => ({
          ...item,
          path: `sources[${index}]${item.path === '/' ? '' : item.path}`,
        })),
      );
  });
  return result(issues);
};

export const validateProductFacts = (
  facts: readonly ProductFact[],
  sources: readonly ProductSource[] = [],
): IngestionValidation => {
  const issues = duplicateIds(facts, 'facts');
  const sourceIds = new Set(sources.map((source) => source.id));
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  facts.forEach((fact, index) => {
    if (!factValidator(fact))
      issues.push(
        ...schemaIssues(factValidator, fact).map((item) => ({
          ...item,
          path: `facts[${index}]${item.path === '/' ? '' : item.path}`,
        })),
      );
    if (sources.length > 0 && !sourceIds.has(fact.source_id)) {
      issues.push(
        issue(
          'dangling_source_reference',
          'invalid',
          `facts[${index}].source_id`,
          `source '${fact.source_id}' does not exist.`,
        ),
      );
    }
    if (fact.fact_state === 'verified' && fact.normalized_value === undefined) {
      issues.push(
        issue(
          'verified_fact_missing_normalized_value',
          'invalid',
          `facts[${index}].normalized_value`,
          'verified facts require a normalized value.',
        ),
      );
    }
    if (fact.fact_state === 'unresolved' && fact.normalized_value !== undefined) {
      issues.push(
        issue(
          'unresolved_fact_has_normalized_value',
          'invalid',
          `facts[${index}].normalized_value`,
          'unresolved facts cannot contain a selected normalized value.',
        ),
      );
    }
    if (fact.fact_state === 'conflicting' && fact.review_required !== true) {
      issues.push(
        issue(
          'conflicting_fact_requires_review',
          'unresolved',
          `facts[${index}].review_required`,
          'conflicting facts require review.',
        ),
      );
    }
    if (fact.fact_state === 'provisional' && fact.review_required !== true) {
      issues.push(
        issue(
          'provisional_fact_requires_review',
          'unresolved',
          `facts[${index}].review_required`,
          'provisional facts require review.',
        ),
      );
    }
    if (fact.review_required === true) {
      issues.push(
        issue(
          'fact_review_required',
          'unresolved',
          `facts[${index}].review_required`,
          'fact is explicitly marked for review.',
        ),
      );
    }
    if (fact.extraction_method === 'ai_assisted' && fact.fact_state === 'verified') {
      issues.push(
        issue(
          'ai_assisted_fact_not_verified',
          'unresolved',
          `facts[${index}].fact_state`,
          'AI-assisted extraction cannot establish verification by itself.',
        ),
      );
    }
    const source = sourcesById.get(fact.source_id);
    if (source?.authority === 'community_or_social' && fact.fact_state === 'verified') {
      issues.push(
        issue(
          'community_fact_not_verified',
          'unresolved',
          `facts[${index}].fact_state`,
          'community or social evidence cannot establish a verified manufacturer specification.',
        ),
      );
    }
  });
  return result(issues);
};

export const validateProductCandidate = (
  candidate: ProductCandidate,
  sources: readonly ProductSource[],
  facts: readonly ProductFact[],
): IngestionValidation => {
  const issues = candidateValidator(candidate) ? [] : schemaIssues(candidateValidator, candidate);
  const sourceIds = new Set(sources.map((source) => source.id));
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const candidateFactIds = new Set(candidate.fact_ids);
  const fieldPath = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

  candidate.source_ids.forEach((sourceId, index) => {
    if (!sourceIds.has(sourceId))
      issues.push(
        issue(
          'dangling_source_reference',
          'invalid',
          `source_ids[${index}]`,
          `source '${sourceId}' does not exist.`,
        ),
      );
  });
  candidate.identity_source_ids.forEach((sourceId, index) => {
    if (!sourceIds.has(sourceId))
      issues.push(
        issue(
          'dangling_identity_source_reference',
          'invalid',
          `identity_source_ids[${index}]`,
          `source '${sourceId}' does not exist.`,
        ),
      );
    if (!candidate.source_ids.includes(sourceId))
      issues.push(
        issue(
          'identity_source_not_in_candidate',
          'invalid',
          `identity_source_ids[${index}]`,
          `source '${sourceId}' is not listed in source_ids.`,
        ),
      );
  });
  candidate.fact_ids.forEach((factId, index) => {
    if (!factById.has(factId))
      issues.push(
        issue(
          'dangling_fact_reference',
          'invalid',
          `fact_ids[${index}]`,
          `fact '${factId}' does not exist.`,
        ),
      );
  });

  const referencedFactIds = new Set<string>();
  for (const [field, factIds] of Object.entries(candidate.field_evidence)) {
    if (!fieldPath.test(field))
      issues.push(
        issue(
          'malformed_field_path',
          'invalid',
          `field_evidence.${field}`,
          'must be a dot-separated canonical field path.',
        ),
      );
    if (factIds.length === 0)
      issues.push(
        issue(
          'empty_field_evidence',
          'invalid',
          `field_evidence.${field}`,
          'must reference at least one fact.',
        ),
      );
    factIds.forEach((factId, index) => {
      if (referencedFactIds.has(factId))
        issues.push(
          issue(
            'duplicate_fact_evidence_reference',
            'invalid',
            `field_evidence.${field}[${index}]`,
            `fact '${factId}' is referenced more than once.`,
          ),
        );
      referencedFactIds.add(factId);
      const fact = factById.get(factId);
      if (!fact) {
        issues.push(
          issue(
            'dangling_fact_reference',
            'invalid',
            `field_evidence.${field}[${index}]`,
            `fact '${factId}' does not exist.`,
          ),
        );
      } else {
        if (fact.field !== field)
          issues.push(
            issue(
              'fact_field_mismatch',
              'invalid',
              `field_evidence.${field}[${index}]`,
              `fact '${factId}' targets '${fact.field}', not '${field}'.`,
            ),
          );
        if (!candidateFactIds.has(factId))
          issues.push(
            issue(
              'fact_not_in_candidate',
              'invalid',
              `field_evidence.${field}[${index}]`,
              `fact '${factId}' is not listed in fact_ids.`,
            ),
          );
        if (fact.fact_state === 'conflicting' || fact.review_required === true) {
          issues.push(
            issue(
              'fact_requires_review',
              'unresolved',
              `field_evidence.${field}[${index}]`,
              `fact '${factId}' requires review.`,
            ),
          );
        }
        if (fact.fact_state === 'unresolved') {
          issues.push(
            issue(
              'unresolved_fact_evidence',
              'unresolved',
              `field_evidence.${field}[${index}]`,
              `fact '${factId}' is unresolved.`,
            ),
          );
        }
      }
    });
  }

  const populatedFields = (value: unknown, prefix = ''): string[] => {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return prefix ? [prefix] : [];
    return Object.entries(value).flatMap(([key, child]) =>
      populatedFields(child, prefix ? `${prefix}.${key}` : key),
    );
  };
  populatedFields(candidate.component_data).forEach((field) => {
    if (!fieldPath.test(field))
      issues.push(
        issue(
          'malformed_field_path',
          'invalid',
          `component_data.${field}`,
          'must be a dot-separated canonical field path.',
        ),
      );
    if (!candidate.field_evidence[field]) {
      issues.push(
        issue(
          'missing_field_evidence',
          'unresolved',
          `component_data.${field}`,
          'populated proposed fields require fact evidence.',
        ),
      );
    }
  });
  if (candidate.identity_status === 'unresolved' || candidate.identity_status === 'conflicting') {
    issues.push(
      issue(
        'identity_not_resolved',
        'unresolved',
        'identity_status',
        `identity status is '${candidate.identity_status}'.`,
      ),
    );
  }
  if (candidate.identity_source_ids.length === 0) {
    issues.push(
      issue(
        'missing_identity_evidence',
        'unresolved',
        'identity_source_ids',
        'candidate identity has no supporting source.',
      ),
    );
  }
  if (candidate.promotion_status === 'eligible' && issues.length > 0) {
    issues.push(
      issue(
        'ineligible_candidate_marked_eligible',
        'invalid',
        'promotion_status',
        'a candidate with unresolved or invalid conditions cannot be marked eligible.',
      ),
    );
  }
  if (
    candidate.review_status === 'not_required' &&
    candidate.promotion_status === 'review_required'
  ) {
    issues.push(
      issue(
        'review_status_contradiction',
        'invalid',
        'review_status',
        'review_required promotion status cannot have not_required review status.',
      ),
    );
  }
  return result(issues);
};

export const validateIngestionArtifacts = (
  sources: readonly ProductSource[],
  facts: readonly ProductFact[],
  candidate: ProductCandidate,
): IngestionValidation => {
  const sourceResult = validateProductSources(sources);
  const factResult = validateProductFacts(facts, sources);
  const candidateResult = validateProductCandidate(candidate, sources, facts);
  return result([...sourceResult.issues, ...factResult.issues, ...candidateResult.issues]);
};
