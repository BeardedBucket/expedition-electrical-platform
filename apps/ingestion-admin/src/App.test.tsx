import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, { Review, SourceResolution } from './App.js';
import type { OperatorApi, OperatorJobDetail } from './api.js';

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const detail: OperatorJobDetail = {
  source_resolution: undefined,
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
  review: vi.fn().mockResolvedValue(detail),
  finalize: vi.fn().mockResolvedValue(detail),
  submitSourceCandidate: vi.fn().mockResolvedValue(detail),
  acceptSource: vi.fn().mockResolvedValue(detail),
  rejectSource: vi.fn().mockResolvedValue(detail),
  suggestions: vi.fn().mockResolvedValue({ manufacturers: [], products: [] }),
  create: vi
    .fn()
    .mockResolvedValue({ ...detail, summary: { ...detail.summary, state: 'created' } }),
  prepare: vi.fn().mockResolvedValue(detail),
  get: vi.fn().mockResolvedValue(detail),
  list: vi.fn().mockResolvedValue({ jobs: [] }),
});
afterEach(async () => {
  cleanup();
  // Drain jsdom's deferred anchor navigation and its subsequent hashchange
  // before another App subscribes, then reset the URL without queuing an event.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  window.history.replaceState(null, '', window.location.pathname);
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
const intakeLabels = [
  'Manufacturer',
  'Product model',
  'Manufacturer part number',
  'Official product URL',
];
function expectBlankIntake() {
  for (const label of intakeLabels) expect(screen.getByLabelText(label)).toHaveValue('');
}
function expectEnteredIntake() {
  for (const [index, value] of [
    'Example',
    'Model',
    'EX-1',
    'https://example.test/product',
  ].entries())
    expect(screen.getByLabelText(intakeLabels[index])).toHaveValue(value);
}
describe('ingestion admin operator interface', () => {
  it('warns non-blockingly when suggestions fail and still creates a free-entry product', async () => {
    const api = client();
    vi.mocked(api.suggestions).mockRejectedValue(new Error('Unavailable'));
    render(<App client={api} />);
    await screen.findByText('Canonical suggestions unavailable. Free entry remains available.');
    fill();
    fireEvent.change(screen.getByLabelText('Manufacturer'), {
      target: { value: 'New Free Entry Maker' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create & Prepare' }));
    await screen.findByText('review_ready');
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ manufacturer: 'New Free Entry Maker' }),
    );
    expect(api.prepare).toHaveBeenCalledWith(id);
  });
  it('offers canonical spellings with exact manufacturer/model scoping while preserving free text', async () => {
    const api = client();
    vi.mocked(api.suggestions).mockResolvedValue({
      manufacturers: ['Victron Energy', 'Other'],
      products: [
        {
          manufacturer: 'Victron Energy',
          model: 'Model A',
          mpn: 'SKU-A',
          provenance: 'verified component: a',
        },
        {
          manufacturer: 'Victron Energy',
          model: 'Model B',
          mpn: 'SKU-B',
          provenance: 'verified component: b',
        },
        {
          manufacturer: 'Other',
          model: 'Foreign',
          mpn: 'FOREIGN',
          provenance: 'verified component: c',
        },
      ],
    });
    const { container } = render(<App client={api} />);
    const manufacturer = screen.getByLabelText('Manufacturer');
    fireEvent.change(manufacturer, { target: { value: ' vic ' } });
    await waitFor(() =>
      expect(container.querySelector('#suggest-manufacturer option')).toHaveAttribute(
        'value',
        'Victron Energy',
      ),
    );
    expect(manufacturer).toHaveValue(' vic ');
    expect(container.querySelector('#suggest-product_model option')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use Victron Energy' }));
    expect(manufacturer).toHaveValue('Victron Energy');
    expect(
      [...container.querySelectorAll('#suggest-product_model option')].map((o) =>
        o.getAttribute('value'),
      ),
    ).toEqual(['Model A', 'Model B']);
    fireEvent.change(screen.getByLabelText('Product model'), { target: { value: ' model a ' } });
    expect(
      [...container.querySelectorAll('#suggest-manufacturer_part_number option')].map((o) =>
        o.getAttribute('value'),
      ),
    ).toEqual(['SKU-A']);
    fireEvent.change(manufacturer, { target: { value: 'New Maker' } });
    expect(manufacturer).toHaveValue('New Maker');
    expect(container.querySelector('#suggest-product_model option')).toBeNull();
    fireEvent.change(screen.getByLabelText('Official product URL'), {
      target: { value: 'https://example.test/new' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create & Prepare' }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        expect.objectContaining({ manufacturer: 'New Maker', manufacturer_part_number: '' }),
      ),
    );
  });
  it('saves MPN-only intake without automatically preparing it', async () => {
    const api = client();
    vi.mocked(api.create).mockResolvedValue({
      ...detail,
      summary: {
        ...detail.summary,
        state: 'source_resolution_required',
        official_product_uri: undefined,
      },
    });
    vi.mocked(api.get).mockResolvedValue({
      ...detail,
      summary: {
        ...detail.summary,
        state: 'source_resolution_required',
        official_product_uri: undefined,
      },
    });
    render(<App client={api} />);
    fill();
    fireEvent.change(screen.getByLabelText('Official product URL'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & Prepare' }));
    await screen.findByText('source_resolution_required');
    expect(screen.getByText(/This job preserves your original request/)).toHaveTextContent(
      'Propose an official manufacturer URL for source identity review.',
    );
    expect(api.prepare).not.toHaveBeenCalled();
  });
  it('returns to a blank Add Product form after successful creation', async () => {
    const api = client();
    render(<App client={api} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create & Prepare' }));
    await screen.findByText('review_ready');
    fireEvent.click(screen.getByRole('link', { name: 'Add product' }));
    await screen.findByRole('heading', { name: 'Add product' });
    expectBlankIntake();
    expect(api.prepare).toHaveBeenCalledTimes(1);
  });
  it('discards an earlier draft when navigating from a job page to Add Product', async () => {
    render(<App client={client()} />);
    fill();
    act(() => {
      window.location.hash = `/jobs/${id}`;
    });
    await screen.findByText('review_ready');
    fireEvent.click(screen.getByRole('link', { name: 'Add product' }));
    await screen.findByRole('heading', { name: 'Add product' });
    expectBlankIntake();
  });
  it('discards an earlier draft when navigating from Recent Jobs to Add Product', async () => {
    render(<App client={client()} />);
    fill();
    fireEvent.click(screen.getByRole('link', { name: 'Recent jobs' }));
    await screen.findByText('No jobs yet. Add a product to begin.');
    fireEvent.click(screen.getByRole('link', { name: 'Add product' }));
    await screen.findByRole('heading', { name: 'Add product' });
    expectBlankIntake();
  });
  it('preserves an active draft during ordinary rerenders', () => {
    const api = client();
    const view = render(<App client={api} />);
    fill();
    view.rerender(<App client={api} />);
    expectEnteredIntake();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.prepare).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('resets on a deliberate Add Product click even when already on that route', async () => {
    window.location.hash = '/';
    render(<App client={client()} />);
    fill();
    fireEvent.click(screen.getByRole('link', { name: 'Add product' }));
    expectBlankIntake();
  });
  it('discourages product identity autofill on the form and all inputs', () => {
    render(<App client={client()} />);
    for (const label of intakeLabels) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute('autocomplete', 'off');
      expect(field.closest('form')).toHaveAttribute('autocomplete', 'off');
    }
  });
  it('issues one automatic prepare per submit under StrictMode, route transition and refresh', async () => {
    const api = client();
    render(
      <StrictMode>
        <App client={api} />
      </StrictMode>,
    );
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create & Prepare' }));
    await screen.findByText('review_ready');
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.prepare).toHaveBeenCalledTimes(1);
    const getCalls = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh job' }));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(getCalls));
    expect(api.prepare).toHaveBeenCalledTimes(1);
  });
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
    expectEnteredIntake();
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

function sourceJob(
  state: 'source_resolution_required' | 'source_resolution_review' | 'created',
): OperatorJobDetail {
  const pending = state === 'source_resolution_review';
  return {
    ...detail,
    summary: { ...detail.summary, state, official_product_uri: undefined },
    intake: { ...detail.intake, official_product_uri: undefined },
    source_resolution: {
      state,
      requested_identity: {
        manufacturer: 'Example',
        product_model: 'Model',
        manufacturer_part_number: 'EX-1',
      },
      accepted_reference: undefined,
      accepted_uri: state === 'created' ? 'https://example.test/product' : undefined,
      attempt_count: state === 'source_resolution_required' ? 0 : 1,
      history_truncated: false,
      attempts:
        state === 'source_resolution_required'
          ? []
          : [
              {
                attempt_id: 'attempt.test',
                candidate_uri: 'https://example.test/product',
                normalized_uri: 'https://example.test/product',
                final_uri: 'https://example.test/product',
                discovery_method: 'operator_supplied_url',
                domain_evidence: { state: 'no_reviewed_profile' },
                title: 'Example product',
                observations: [
                  { kind: 'exact_mpn', value: 'EX-1', locator: { kind: 'html', path: '/p[1]' } },
                ],
                diagnostics: [],
                disposition: pending ? 'pending' : 'accepted',
                review: pending
                  ? undefined
                  : { method: 'local_operator', reviewed_at: '2026-09-08T00:00:01.000Z' },
                captured_at: '2026-09-08T00:00:00.000Z',
                capture: {
                  reference: {
                    kind: 'source_capture',
                    reference: 'capture.test',
                    reference_schema_version: '1.0',
                    digest: `sha256:${'a'.repeat(64)}`,
                    digest_algorithm: 'sha256',
                  },
                  disposition: 'authoritative',
                  content_digest: undefined,
                  media_type: 'text/html',
                  response_status: 200,
                  reason_codes: undefined,
                  redirects: undefined,
                },
                can_accept: pending,
              },
            ],
    },
  };
}
it('renders required source review and submits the candidate URL for the existing job', async () => {
  const c = client();
  const update = vi.fn();
  render(
    <SourceResolution job={sourceJob('source_resolution_required')} client={c} onUpdate={update} />,
  );
  expect(screen.getByText('Official source required')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Candidate official manufacturer URL'), {
    target: { value: 'https://example.test/product' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit source candidate' }));
  await waitFor(() =>
    expect(c.submitSourceCandidate).toHaveBeenCalledWith(id, 'https://example.test/product'),
  );
  expect(c.prepare).not.toHaveBeenCalled();
});
it('shows the ordinary original official URL without a resolved-source row', () => {
  render(<Review job={detail} />);
  expect(screen.getByText('Official product URL').nextElementSibling).toHaveTextContent(
    'https://example.test/product',
  );
  expect(screen.queryByText('Original product URL')).not.toBeInTheDocument();
  expect(screen.queryByText('Resolved official source')).not.toBeInTheDocument();
});
it('shows an unresolved MPN-only original URL as not supplied without a resolved-source row', () => {
  render(<Review job={sourceJob('source_resolution_required')} />);
  expect(screen.getByText('Original product URL').nextElementSibling).toHaveTextContent(
    'Not supplied',
  );
  expect(screen.queryByText('Resolved official source')).not.toBeInTheDocument();
});
it.each(['created', 'review_ready'] as const)(
  'shows the accepted source separately in the %s Overview with a safe link',
  (state) => {
    const job = sourceJob('created');
    job.summary.state = state;
    job.source_resolution!.state = state;
    render(<Review job={job} />);
    expect(screen.getByText('Original product URL').nextElementSibling).toHaveTextContent(
      'Not supplied',
    );
    const row = screen.getByText('Resolved official source').nextElementSibling;
    const link = row?.querySelector('a');
    expect(link).toHaveTextContent('https://example.test/product');
    expect(link).toHaveAttribute('href', job.source_resolution!.accepted_uri);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(job.intake.official_product_uri).toBeUndefined();
  },
);
it('loads the resolved-source Overview when reopening a persisted review-ready job', async () => {
  const c = client();
  const job = sourceJob('created');
  job.summary.state = 'review_ready';
  job.source_resolution!.state = 'review_ready';
  vi.mocked(c.get).mockResolvedValue(job);
  window.location.hash = `#/jobs/${id}`;
  render(<App client={c} />);
  expect(await screen.findByText('Resolved official source')).toBeInTheDocument();
  expect(screen.getByText('Original product URL').nextElementSibling).toHaveTextContent(
    'Not supplied',
  );
  expect(c.get).toHaveBeenCalledWith(id);
  expect(c.prepare).not.toHaveBeenCalled();
});
it('renders pending identity evidence and invokes explicit source acceptance', async () => {
  const c = client();
  render(
    <SourceResolution job={sourceJob('source_resolution_review')} client={c} onUpdate={vi.fn()} />,
  );
  expect(
    screen.getByText('Operator-proposed source without reviewed-domain corroboration.'),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/product specifications require a separate later review/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Accept official source' }));
  await waitFor(() => expect(c.acceptSource).toHaveBeenCalledWith(id, 'attempt.test'));
  expect(c.prepare).not.toHaveBeenCalled();
});
it('opens literal candidate and final source URLs in safe external tabs', () => {
  const job = sourceJob('source_resolution_review');
  job.source_resolution!.attempts[0].final_uri = 'https://example.test/final-product';
  render(<SourceResolution job={job} client={client()} onUpdate={vi.fn()} />);
  for (const uri of ['https://example.test/product', 'https://example.test/final-product']) {
    const link = screen.getByRole('link', { name: uri });
    expect(link).toHaveAttribute('href', uri);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});
it('keeps an unavailable final URL as unknown without manufacturing a link', () => {
  const job = sourceJob('source_resolution_review');
  job.source_resolution!.attempts[0].final_uri = undefined;
  render(<SourceResolution job={job} client={client()} onUpdate={vi.fn()} />);
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByText('Unknown / not available')).toBeInTheDocument();
});
it('warns after off-domain acceptance that preparation may still fail officiality checks', () => {
  const job = sourceJob('created');
  job.source_resolution!.attempts[0].domain_evidence = { state: 'outside_reviewed_domains' };
  render(<SourceResolution job={job} client={client()} onUpdate={vi.fn()} />);
  expect(
    screen.getByText(/Human acceptance does not override acquisition domain policy/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Preparation may still fail officiality checks/)).toBeInTheDocument();
});
it('rejects a source and renders the returned state for another attempt', async () => {
  const c = client();
  const update = vi.fn();
  vi.mocked(c.rejectSource).mockResolvedValue(sourceJob('source_resolution_required'));
  render(
    <SourceResolution job={sourceJob('source_resolution_review')} client={c} onUpdate={update} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reject source' }));
  await waitFor(() => expect(c.rejectSource).toHaveBeenCalledWith(id, 'attempt.test'));
  expect(update).toHaveBeenCalledWith(sourceJob('source_resolution_required'));
});
it('shows accepted source separately, enables explicit preparation, and skips resolution for URL-present jobs', async () => {
  const c = client();
  vi.mocked(c.get).mockResolvedValue(sourceJob('created'));
  window.location.hash = `#/jobs/${id}`;
  render(<App client={c} />);
  expect(await screen.findByText('Accepted resolved source')).toBeInTheDocument();
  expect(
    screen.getByText('The original intake remains unchanged and has no official product URL.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start preparation' })).toBeEnabled();
  expect(c.prepare).not.toHaveBeenCalled();
  cleanup();
  render(<SourceResolution job={detail} client={c} onUpdate={vi.fn()} />);
  expect(screen.queryByText('Official source required')).not.toBeInTheDocument();
});
