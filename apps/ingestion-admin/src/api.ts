import type { OperatorJobDetail, OperatorJobSummary } from '../server/operator-views.js';
export type { OperatorJobDetail, OperatorJobSummary };
export interface IntakeInput {
  manufacturer: string;
  product_model: string;
  manufacturer_part_number: string;
  official_product_uri: string;
}
async function request<T>(path: string, method = 'GET', body?: IntakeInput): Promise<T> {
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
  create: (input: IntakeInput) => request<OperatorJobDetail>('', 'POST', input),
  prepare: (id: string) => request<OperatorJobDetail>(`/${encodeURIComponent(id)}/prepare`, 'POST'),
  get: (id: string) => request<OperatorJobDetail>(`/${encodeURIComponent(id)}`),
  list: () => request<{ jobs: OperatorJobSummary[] }>(''),
};
export type OperatorApi = typeof api;
