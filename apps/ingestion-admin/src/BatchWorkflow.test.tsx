import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchCreate, BatchList, BatchPage } from './BatchWorkflow.js';
import type { IngestionBatchDetail, IngestionBatchSummary, OperatorApi } from './api.js';

const batchId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const batch = (overrides: Partial<IngestionBatchSummary> = {}): IngestionBatchSummary => ({
  id: batchId,
  created_at: '2026-09-28T10:00:00Z',
  updated_at: '2026-09-28T10:05:00Z',
  state: 'pending',
  requested_count: 2,
  job_count: 2,
  counts: { pending: 2, created: 2 },
  jobs: [
    { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', state: 'created' },
    { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', state: 'created' },
  ],
  ...overrides,
});
const detail = (summary: IngestionBatchSummary): IngestionBatchDetail => ({
  summary,
  job_ids: summary.jobs.map((job) => job.id),
});
const apiClient = (overrides: Partial<OperatorApi> = {}) =>
  ({
    createBatch: vi.fn().mockResolvedValue(detail(batch())),
    listBatches: vi.fn().mockResolvedValue({ batches: [batch()] }),
    getBatch: vi.fn().mockResolvedValue(detail(batch())),
    prepareBatch: vi.fn().mockResolvedValue(
      detail(
        batch({
          state: 'mixed',
          updated_at: '2026-09-28T10:10:00Z',
          counts: { review_ready: 1, preparation_failed: 1, failed: 1, pending: 0 },
          jobs: [
            { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', state: 'review_ready' },
            { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', state: 'preparation_failed' },
          ],
        }),
      ),
    ),
    ...overrides,
  }) as unknown as OperatorApi;

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', window.location.pathname);
  vi.restoreAllMocks();
});

describe('batch operator workflow', () => {
  it('creates a batch from ordinary intake fields without truncating products', async () => {
    const client = apiClient();
    render(<BatchCreate client={client} />);
    fireEvent.change(screen.getByLabelText('Product 1 Manufacturer'), {
      target: { value: 'Maker A' },
    });
    fireEvent.change(screen.getByLabelText('Product 1 Product model'), {
      target: { value: 'Model A' },
    });
    fireEvent.change(screen.getByLabelText('Product 1 Manufacturer part number'), {
      target: { value: 'A-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Product 2 Manufacturer'), {
      target: { value: 'Maker B' },
    });
    fireEvent.change(screen.getByLabelText('Product 2 Product model'), {
      target: { value: 'Model B' },
    });
    fireEvent.change(screen.getByLabelText('Product 2 Official product URL'), {
      target: { value: 'https://example.test/b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create batch' }));
    await waitFor(() =>
      expect(client.createBatch).toHaveBeenCalledWith([
        {
          manufacturer: 'Maker A',
          product_model: 'Model A',
          manufacturer_part_number: 'A-1',
          official_product_uri: '',
        },
        {
          manufacturer: 'Maker B',
          product_model: 'Model B',
          manufacturer_part_number: '',
          official_product_uri: 'https://example.test/b',
        },
      ]),
    );
    expect(window.location.hash).toBe(`#/batches/${batchId}`);
    expect(screen.getByText(/1–50 products/)).toBeInTheDocument();
  });

  it('accepts a one-product batch at the lower size bound', async () => {
    const client = apiClient();
    render(<BatchCreate client={client} />);
    fireEvent.change(screen.getByLabelText('Product 1 Manufacturer'), {
      target: { value: 'Maker' },
    });
    fireEvent.change(screen.getByLabelText('Product 1 Product model'), {
      target: { value: 'Model' },
    });
    fireEvent.change(screen.getByLabelText('Product 1 Manufacturer part number'), {
      target: { value: 'M-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create batch' }));
    await waitFor(() =>
      expect(client.createBatch).toHaveBeenCalledWith([
        {
          manufacturer: 'Maker',
          product_model: 'Model',
          manufacturer_part_number: 'M-1',
          official_product_uri: '',
        },
      ]),
    );
  });

  it('presents and enforces the 1–50 entry bound without hiding entries', () => {
    const client = apiClient();
    render(<BatchCreate client={client} />);
    for (let index = 0; index < 49; index++)
      fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    expect(screen.getByRole('status')).toHaveTextContent('50 of 50 products');
    expect(screen.getByRole('button', { name: 'Maximum batch size reached' })).toBeDisabled();
    expect(screen.getByLabelText('Product 50 Manufacturer')).toBeInTheDocument();
    expect(client.createBatch).not.toHaveBeenCalled();
  });

  it('shows missing intake identity and API create failures to the operator', async () => {
    const client = apiClient();
    render(<BatchCreate client={client} />);
    fireEvent.change(screen.getByLabelText('Product 1 Manufacturer'), {
      target: { value: 'Maker' },
    });
    fireEvent.change(screen.getByLabelText('Product 1 Product model'), {
      target: { value: 'Model' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create batch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'at least a part number or official product URL',
    );
    expect(client.createBatch).not.toHaveBeenCalled();

    vi.mocked(client.createBatch).mockRejectedValue(new Error('Batch request rejected'));
    fireEvent.change(screen.getByLabelText('Product 1 Manufacturer part number'), {
      target: { value: 'M-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create batch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Batch request rejected');
  });

  it('lists API-provided batches and reports list/network failures', async () => {
    const client = apiClient();
    render(<BatchList client={client} />);
    expect(await screen.findByRole('link', { name: batchId })).toHaveAttribute(
      'href',
      `#/batches/${batchId}`,
    );
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(client.listBatches).toHaveBeenCalledTimes(1);

    cleanup();
    render(
      <BatchList
        client={apiClient({ listBatches: vi.fn().mockRejectedValue(new Error('Offline')) })}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  });

  it('preserves batch state counts, exact child states, and stored child ordering', async () => {
    const mixed = batch({
      state: 'mixed',
      counts: {
        review_ready: 1,
        preparation_failed: 1,
        review_rejected: 0,
        review_deferred: 0,
        other: 0,
      },
      jobs: [
        { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', state: 'review_ready' },
        { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', state: 'preparation_failed' },
      ],
    });
    render(
      <BatchPage
        id={batchId}
        client={apiClient({ getBatch: vi.fn().mockResolvedValue(detail(mixed)) })}
      />,
    );
    expect(await screen.findByText('mixed')).toBeInTheDocument();
    expect(screen.getAllByText('preparation_failed')).toHaveLength(2);
    expect(screen.getByText('review_rejected')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'dddddddd-dddd-dddd-dddd-ddddddddddddreview_ready',
      'cccccccc-cccc-cccc-cccc-ccccccccccccpreparation_failed',
    ]);
    expect(screen.getByText('2026-09-28T10:00:00Z')).toBeInTheDocument();
    expect(screen.getByText('2026-09-28T10:05:00Z')).toBeInTheDocument();
  });

  it('prepares through the batch endpoint and refreshes aggregate and child state', async () => {
    const prepared = detail(
      batch({
        state: 'mixed',
        updated_at: '2026-09-28T10:10:00Z',
        counts: { review_ready: 1, preparation_failed: 1, failed: 1 },
        jobs: [
          { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', state: 'review_ready' },
          { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', state: 'preparation_failed' },
        ],
      }),
    );
    const getBatch = vi.fn().mockResolvedValueOnce(detail(batch())).mockResolvedValueOnce(prepared);
    const client = apiClient({ getBatch, prepareBatch: vi.fn().mockResolvedValue(prepared) });
    render(<BatchPage id={batchId} client={client} />);
    await waitFor(() => expect(getBatch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare batch' }));
    await waitFor(() => expect(screen.getAllByText('preparation_failed')).toHaveLength(2));
    await waitFor(() => expect(getBatch).toHaveBeenCalledTimes(2));
    expect(client.prepareBatch).toHaveBeenCalledWith(batchId);
    expect(screen.getByText('mixed')).toBeInTheDocument();
    expect(
      screen.getByText(/does not approve, finalize, write canonical product data/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /approve|finalize|write/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
    ).toHaveAttribute('href', '#/jobs/dddddddd-dddd-dddd-dddd-dddddddddddd');
  });

  it('shows missing-batch and prepare request errors without inventing child states', async () => {
    const missing = apiClient({
      getBatch: vi.fn().mockRejectedValue(new Error('Batch not found')),
    });
    render(<BatchPage id={batchId} client={missing} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Batch not found');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    cleanup();
    const failed = apiClient({
      prepareBatch: vi.fn().mockRejectedValue(new Error('Prepare conflict')),
    });
    render(<BatchPage id={batchId} client={failed} />);
    await screen.findByText('dddddddd-dddd-dddd-dddd-dddddddddddd');
    fireEvent.click(screen.getByRole('button', { name: 'Prepare batch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Prepare conflict');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
