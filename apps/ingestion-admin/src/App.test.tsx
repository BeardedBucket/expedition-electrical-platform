import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, { Review } from './App.js';
import type { OperatorApi, OperatorJobDetail } from './api.js';

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const detail: OperatorJobDetail = {
  summary: {
    id,
    state: 'review_ready',
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:01Z',
    manufacturer: 'Example',
    product_model: 'Model',
    manufacturer_part_number: 'EX-1',
    official_product_uri: 'https://example.test/product',
    preparation_status: 'review_ready',
    candidate_present: false,
    fact_count: 0,
    proposal_count: 0,
    unresolved_count: 0,
    conflict_count: 0,
    final_result_status: undefined,
    write_status: undefined,
  },
  intake: {
    manufacturer: 'Example',
    product_model: 'Model',
    manufacturer_part_number: 'EX-1',
    official_product_uri: 'https://example.test/product',
  },
  acquisition: undefined,
  sources: undefined,
  extractions: [],
  facts: [],
  reconciliation: undefined,
  proposals: [],
  candidate: {
    present: false,
    id: undefined,
    projected_fields: undefined,
    field_evidence: undefined,
    non_projected: [],
  },
  review_package: undefined,
  diagnostics: [],
};
const client = (): OperatorApi => ({
  create: vi.fn().mockResolvedValue(detail),
  prepare: vi.fn().mockResolvedValue(detail),
  get: vi.fn().mockResolvedValue(detail),
  list: vi.fn().mockResolvedValue({ jobs: [] }),
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.restoreAllMocks();
});
function fill() {
  for (const [label, value] of [
    ['Manufacturer', 'Example'],
    ['Product model', 'Model'],
    ['Manufacturer part number', 'EX-1'],
    ['Official product URL', 'https://example.test/product'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
describe('ingestion admin operator interface', () => {
  it('submits all four fields, invokes prepare and navigates to persisted review', async () => {
    const api = client();
    render(<App client={api} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create & Prepare' }));
    await screen.findByText('review_ready');
    expect(api.create).toHaveBeenCalledWith(detail.intake);
    expect(api.prepare).toHaveBeenCalledWith(id);
    expect(window.location.hash).toBe(`#/jobs/${id}`);
    expect(
      screen.getByText('No product candidate was produced from the currently qualified evidence.'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 semantic proposals')).toBeInTheDocument();
    expect(screen.getByText(/^0 facts\./)).toBeInTheDocument();
  });
  it('renders preparing prominently without fabricated progress', () => {
    render(
      <Review
        job={{
          ...detail,
          summary: {
            ...detail.summary,
            state: 'preparing',
            fact_count: undefined,
            proposal_count: undefined,
            candidate_present: undefined,
          },
          candidate: undefined,
        }}
      />,
    );
    expect(screen.getByText('preparing')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preparation is running');
    expect(screen.getByText('Candidate projection is not available yet.')).toBeInTheDocument();
  });
  it('distinguishes capture, extraction capability, and qualification outcomes', () => {
    render(
      <Review
        job={{
          ...detail,
          sources: [
            {
              id: 'not-captured',
              label: 'Manual',
              uri: 'https://example.test/manual',
              role: 'manual',
              officiality: 'official',
              selection: 'duplicate_uri',
              capture_outcome: 'not_attempted',
              capture_disposition: undefined,
              media_type: undefined,
              parent_uri: 'https://example.test/product',
              duplicate_of: 'seed',
              equivalent_content_of: undefined,
              reason_codes: undefined,
            },
          ],
          extractions: [
            {
              id: 'extract',
              source_capture: {
                kind: 'source_capture',
                reference: 'capture',
                reference_schema_version: '1.0',
                digest: 'sha256:a',
                digest_algorithm: 'sha256',
              },
              acquisition_candidate_id: undefined,
              status: 'unsupported',
              capability: 'capability_not_implemented',
              remediation: 'implementation_required',
              page_count: undefined,
              block_count: 0,
              table_count: 0,
              diagnostics: [],
              qualification: {
                status: 'no_qualifiable_facts',
                completeness: 'incomplete',
                fact_count: 0,
                diagnostics: [],
              },
            },
          ],
        }}
      />,
    );
    for (const text of ['not_attempted', 'duplicate_uri', 'unsupported', 'no_qualifiable_facts'])
      expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(/Capability: capability_not_implemented/)).toBeInTheDocument();
  });
  it('shows create and preparation request errors to the operator', async () => {
    const api = client();
    vi.mocked(api.create).mockRejectedValueOnce(new Error('Invalid intake URI'));
    render(<App client={api} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create & Prepare' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid intake URI');
    vi.mocked(api.prepare).mockRejectedValueOnce(new Error('Connection interrupted'));
    fireEvent.click(screen.getByRole('button', { name: 'Create & Prepare' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Connection interrupted'),
    );
  });
  it('reopens an existing job from its URL and reports retrieval errors', async () => {
    window.location.hash = `/jobs/${id}`;
    const api = client();
    vi.mocked(api.get).mockRejectedValue(new Error('Unknown ingestion job ID'));
    render(<App client={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown ingestion job ID');
    expect(api.get).toHaveBeenCalledWith(id);
  });
  it('shows recent jobs with unknown counts preserved', async () => {
    window.location.hash = '/jobs';
    const api = client();
    vi.mocked(api.list).mockResolvedValue({ jobs: [{ ...detail.summary, fact_count: undefined }] });
    render(<App client={api} />);
    expect(await screen.findByRole('link', { name: 'Model / EX-1' })).toHaveAttribute(
      'href',
      `#/jobs/${id}`,
    );
    expect(screen.getByText('Unknown / not available')).toBeInTheDocument();
  });
});
