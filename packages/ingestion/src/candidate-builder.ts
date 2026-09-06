import type {
  JsonObject,
  JsonValue,
  ProductCandidate,
  ProductIdentity,
  ProductFact,
  ProductSource,
} from './contracts.js';
import { validateProductCandidate, validateProductFacts } from './validation.js';
import { reconcileProductFacts } from './reconciliation.js';
import type { NormalizedProductFact } from './normalization-types.js';

export interface ProductCandidateBuildInput {
  readonly id: string;
  readonly schema_version?: string;
  readonly identity: ProductIdentity;
  readonly sources: readonly ProductSource[];
  readonly facts: readonly ProductFact[];
  readonly normalized_facts: readonly NormalizedProductFact[];
  /**
   * Explicit legacy compatibility boundary passed through to
   * reconcileProductFacts(). Strict by default (undefined applicability is
   * not eligible). Only an intentionally identified legacy replay/caller
   * should set this to `true`.
   */
  readonly legacy_undefined_applicability?: boolean;
}

type MutableJsonObject = { [key: string]: JsonValue };

const setPath = (root: MutableJsonObject, path: string, value: JsonValue): void => {
  const segments = path.split('.');
  let cursor = root;
  segments.slice(0, -1).forEach((segment) => {
    const child = cursor[segment];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) cursor[segment] = {};
    cursor = cursor[segment] as MutableJsonObject;
  });
  cursor[segments[segments.length - 1]] = value;
};

export const buildProductCandidate = (input: ProductCandidateBuildInput): ProductCandidate => {
  const normalizedById = new Map(input.normalized_facts.map((item) => [item.fact.id, item.fact]));
  const candidateFacts = input.facts.map((fact) => normalizedById.get(fact.id) ?? fact);
  const factValidation = validateProductFacts(candidateFacts, input.sources);
  const reconciliation = reconcileProductFacts({
    candidate_id: input.id,
    identity: input.identity,
    sources: input.sources,
    facts: input.facts,
    normalized_facts: input.normalized_facts,
    legacy_undefined_applicability: input.legacy_undefined_applicability,
  });
  const componentData: JsonObject = {};
  const fieldEvidence: Record<string, readonly string[]> = {};
  reconciliation.fields.forEach((field) => {
    if (field.target_kind === 'canonical') {
      setPath(componentData as MutableJsonObject, field.field, field.value);
      fieldEvidence[field.field] = field.fact_ids;
    }
  });
  const identitySources = input.sources
    .filter(
      (source) =>
        source.product_identity_claim && Object.keys(source.product_identity_claim).length > 0,
    )
    .map((source) => source.id)
    .sort();
  const reviewRequired =
    reconciliation.review_required ||
    factValidation.issues.length > 0 ||
    reconciliation.identity_status !== 'verified' ||
    input.facts.some(
      (fact) => fact.fact_state === 'unresolved' || fact.fact_state === 'conflicting',
    );
  const blocked =
    reconciliation.identity_status === 'unresolved' ||
    reconciliation.identity_status === 'conflicting' ||
    reconciliation.conflicts.length > 0 ||
    factValidation.issues.some((item) => item.category === 'invalid');
  const reviewReasons = [
    ...reconciliation.issues.map((item) => item.code),
    ...factValidation.issues.map((item) => item.code),
  ];
  const candidate: ProductCandidate = {
    schema_version: input.schema_version ?? '1.0',
    id: input.id,
    identity_status: reconciliation.identity_status,
    identity: input.identity,
    review_status: reviewRequired ? 'pending' : 'not_required',
    promotion_status: blocked ? 'blocked' : reviewRequired ? 'review_required' : 'eligible',
    source_ids: input.sources.map((source) => source.id).sort(),
    identity_source_ids: identitySources,
    fact_ids: input.facts.map((fact) => fact.id).sort(),
    component_data: componentData,
    field_evidence: fieldEvidence,
    ...(reviewReasons.length ? { review_reasons: reviewReasons } : {}),
  };
  const validation = validateProductCandidate(candidate, input.sources, candidateFacts);
  if (!validation.ok) {
    return {
      ...candidate,
      review_status: 'pending',
      promotion_status: 'blocked',
      review_reasons: [
        ...(candidate.review_reasons ?? []),
        ...factValidation.issues.map((item) => item.code),
        ...validation.issues.map((item) => item.code),
      ],
    };
  }
  return candidate;
};
