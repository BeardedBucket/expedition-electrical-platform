import type { OperatorJobDetail, OperatorJobSummary } from '../server/operator-views.js';
import type { IntakeSuggestions } from '../server/suggestions.js';
export type { OperatorJobDetail, OperatorJobSummary };
export interface IntakeInput {
  manufacturer: string;
  product_model: string;
  manufacturer_part_number: string;
  official_product_uri: string;
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
export const api = {
  suggestions: async (): Promise<IntakeSuggestions> => {
    const response = await fetch('/api/ingestion/suggestions');
    if (!response.ok) throw new Error('Canonical suggestions could not be loaded.');
    return response.json();
  },
  create: (input: IntakeInput) =>
    request<OperatorJobDetail>('', 'POST', {
      manufacturer: input.manufacturer,
      product_model: input.product_model,
      ...(input.manufacturer_part_number.trim()
        ? { manufacturer_part_number: input.manufacturer_part_number }
        : {}),
      ...(input.official_product_uri.trim()
        ? { official_product_uri: input.official_product_uri }
        : {}),
    }),
  prepare: (id: string) => request<OperatorJobDetail>(`/${encodeURIComponent(id)}/prepare`, 'POST'),
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
