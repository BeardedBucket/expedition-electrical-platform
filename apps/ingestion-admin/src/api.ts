import type { OperatorJobDetail, OperatorJobSummary } from '../server/operator-views.js';
import type { IntakeSuggestions } from '../server/suggestions.js';
import type { JsonValue, ProductionPromotionDecisions } from '@expedition/ingestion';
import type {
  ReviewedSemanticMappingPreview,
  ReviewedSemanticTargetDescriptor,
} from '@expedition/ingestion';
export interface HumanReviewInput {
  reviewer_id: string;
  reviewed_decisions?: string[];
  promotion_decisions?: ProductionPromotionDecisions;
  expected_lifecycle_snapshot?: string;
  defer_reason?: string;
}
export type { OperatorJobDetail, OperatorJobSummary };
export interface IntakeInput {
  manufacturer: string;
  product_model: string;
  manufacturer_part_number: string;
  official_product_uri: string;
}
export interface SemanticIntentBase {
  proposal_id: string;
  expected_review_snapshot: string;
  selected_fact_ids: readonly string[];
  actor_label: string;
}
export type SemanticDecisionInput =
  | (SemanticIntentBase & {
      outcome: 'map';
      target: string;
      normalized_value: JsonValue;
      normalized_unit: string;
      source_unit?: string;
      rationale: string;
    })
  | (SemanticIntentBase & {
      outcome: 'schema_gap';
      schema_gap: { concept_key: string; explanation: string };
      rationale: string;
    })
  | (SemanticIntentBase & {
      outcome: 'reject' | 'not_applicable';
      rationale: string;
    })
  | (SemanticIntentBase & {
      outcome: 'evidence_only' | 'unresolved';
      rationale?: string;
    });
export interface SemanticTargetRequest {
  expected_review_snapshot: string;
  selected_fact_ids: readonly string[];
}
export interface SemanticPreviewRequest extends SemanticTargetRequest {
  target: string;
  source_unit?: string;
}
export interface SemanticTargetResponse {
  proposal_id: string;
  targets: readonly ReviewedSemanticTargetDescriptor[];
}
export class OperatorApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly proposal_ids: readonly string[] = [],
  ) {
    super(message);
  }
}
// Mirrors the ingestion-runtime batch contract; the form blocks overflow rather than truncating.
export const MAX_BATCH_SIZE = 50;
export interface IngestionBatchJob {
  id: string;
  state: string;
}
export interface IngestionBatchSummary {
  id: string;
  created_at: string;
  updated_at: string;
  state: string;
  requested_count: number;
  job_count: number;
  counts: Record<string, number>;
  jobs: IngestionBatchJob[];
}
export interface IngestionBatchDetail {
  summary: IngestionBatchSummary;
  job_ids: string[];
}
async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`/api/ingestion/jobs${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new OperatorApiError(
      response.status,
      result.error?.message ?? `Request failed (${response.status}).`,
      Array.isArray(result.error?.proposal_ids)
        ? result.error.proposal_ids.filter((id: unknown): id is string => typeof id === 'string')
        : [],
    );
  return result as T;
}
async function batchRequest<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`/api/ingestion/batches${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message ?? `Request failed (${response.status}).`);
  return result as T;
}
const intakeRecord = (input: IntakeInput) => ({
  manufacturer: input.manufacturer,
  product_model: input.product_model,
  ...(input.manufacturer_part_number.trim()
    ? { manufacturer_part_number: input.manufacturer_part_number }
    : {}),
  ...(input.official_product_uri.trim()
    ? { official_product_uri: input.official_product_uri }
    : {}),
});
export const api = {
  suggestions: async (): Promise<IntakeSuggestions> => {
    const response = await fetch('/api/ingestion/suggestions');
    if (!response.ok) throw new Error('Canonical suggestions could not be loaded.');
    return response.json();
  },
  create: (input: IntakeInput) => request<OperatorJobDetail>('', 'POST', intakeRecord(input)),
  createBatch: (inputs: readonly IntakeInput[]) =>
    batchRequest<IngestionBatchDetail>('', 'POST', inputs.map(intakeRecord)),
  listBatches: () => batchRequest<{ batches: IngestionBatchSummary[] }>(''),
  getBatch: (id: string) => batchRequest<IngestionBatchDetail>(`/${encodeURIComponent(id)}`),
  prepareBatch: (id: string) =>
    batchRequest<IngestionBatchDetail>(`/${encodeURIComponent(id)}/prepare`, 'POST'),
  prepare: (id: string) => request<OperatorJobDetail>(`/${encodeURIComponent(id)}/prepare`, 'POST'),
  review: (id: string, action: 'approve' | 'reject' | 'defer', input: HumanReviewInput) =>
    request<OperatorJobDetail>(`/${encodeURIComponent(id)}/review/${action}`, 'POST', input),
  resumeDeferredReview: (id: string, expectedLifecycleSnapshot: string, actorLabel: string) =>
    request<OperatorJobDetail>(`/${encodeURIComponent(id)}/review/resume`, 'POST', {
      expected_lifecycle_snapshot: expectedLifecycleSnapshot,
      actor_label: actorLabel,
    }),
  semanticTargets: (id: string, proposalId: string, input: SemanticTargetRequest) =>
    request<SemanticTargetResponse>(
      `/${encodeURIComponent(id)}/review/semantic-proposals/${encodeURIComponent(proposalId)}/targets`,
      'POST',
      input,
    ),
  semanticPreview: (id: string, proposalId: string, input: SemanticPreviewRequest) =>
    request<ReviewedSemanticMappingPreview>(
      `/${encodeURIComponent(id)}/review/semantic-proposals/${encodeURIComponent(proposalId)}/preview`,
      'POST',
      input,
    ),
  semanticDecision: (id: string, input: SemanticDecisionInput) =>
    request<OperatorJobDetail>(
      `/${encodeURIComponent(id)}/review/semantic-decisions`,
      'POST',
      input,
    ),
  finalize: (id: string) =>
    request<OperatorJobDetail>(`/${encodeURIComponent(id)}/finalize`, 'POST', { write: true }),
  submitSourceCandidate: (id: string, uri: string) =>
    request<OperatorJobDetail>(`/${encodeURIComponent(id)}/source-resolution/candidates`, 'POST', {
      official_product_uri: uri,
    }),
  acceptSource: (id: string, attemptId: string) =>
    request<OperatorJobDetail>(`/${encodeURIComponent(id)}/source-resolution/accept`, 'POST', {
      attempt_id: attemptId,
    }),
  rejectSource: (id: string, attemptId: string) =>
    request<OperatorJobDetail>(`/${encodeURIComponent(id)}/source-resolution/reject`, 'POST', {
      attempt_id: attemptId,
    }),
  reopenSourceSelection: (id: string) =>
    request<OperatorJobDetail>(`/${encodeURIComponent(id)}/source-resolution/reopen`, 'POST', {}),
  reopenPreparation: (
    id: string,
    expectedReviewSnapshot: string,
    expectedLifecycleSnapshot?: string,
  ) =>
    request<OperatorJobDetail>(`/${encodeURIComponent(id)}/preparation/reopen`, 'POST', {
      expected_review_snapshot: expectedReviewSnapshot,
      ...(expectedLifecycleSnapshot
        ? { expected_lifecycle_snapshot: expectedLifecycleSnapshot }
        : {}),
    }),
  get: (id: string) => request<OperatorJobDetail>(`/${encodeURIComponent(id)}`),
  list: () => request<{ jobs: OperatorJobSummary[] }>(''),
};
export type OperatorApi = typeof api;
