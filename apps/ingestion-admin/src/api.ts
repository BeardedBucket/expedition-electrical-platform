import type { OperatorJobDetail, OperatorJobSummary } from '../server/operator-views.js';
import type { IntakeSuggestions } from '../server/suggestions.js';
import type { ProductionPromotionDecisions } from '@expedition/ingestion';
export interface HumanReviewInput {
  reviewer_id: string;
  reviewed_decisions?: string[];
  promotion_decisions?: ProductionPromotionDecisions;
}
export type { OperatorJobDetail, OperatorJobSummary };
export interface IntakeInput {
  manufacturer: string;
  product_model: string;
  manufacturer_part_number: string;
  official_product_uri: string;
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
    throw new Error(result.error?.message ?? `Request failed (${response.status}).`);
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
  get: (id: string) => request<OperatorJobDetail>(`/${encodeURIComponent(id)}`),
  list: () => request<{ jobs: OperatorJobSummary[] }>(''),
};
export type OperatorApi = typeof api;
