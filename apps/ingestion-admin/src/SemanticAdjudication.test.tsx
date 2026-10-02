import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperatorApi, OperatorJobDetail } from './api.js';
import { OperatorApiError } from './api.js';
import { SemanticAdjudication } from './SemanticAdjudication.js';

const proposalId = 'semantic-proposal.123456789012345678901234';
const snapshot = 'sha256:current-review';
const fact = {
  id: 'qualified-fact.1',
  label: 'Mystery electrical rating',
  raw_value: '150 A',
  unit: 'A',
  applicability: { kind: 'exact_mpn_or_sku', value: 'EX-1' },
  qualification: 'exact',
  source_uri: 'https://example.test/specifications',
  document: 'Product specifications',
  locators: [{ role: 'value', locator: { kind: 'html', path: '/table[1]/tr[1]/td[2]' } }],
};
const target = {
  canonical_field: 'electrical.continuous_output_current_a',
  value_shapes: ['number'],
  dimension: 'current',
  unit: 'A',
  allows_unit_conversion: true,
  human_adjudication: 'source_fact',
  normalizer_version: 'production-semantic-targets.v1',
} as const;
const alternateTarget = {
  ...target,
  canonical_field: 'electrical.continuous_input_current_a',
} as const;
const automaticProposalId = 'proposal.automatic';
const requiredItem = {
  id: proposalId,
  automatic_target: 'source_label:mystery electrical rating',
  automatic_disposition: 'unsupported',
  derived: false,
  state: 'automatic',
  required: true,
  decision_history: [],
  evidence: [fact],
};

function job(overrides: Record<string, unknown> = {}) {
  return {
    summary: { id: 'job-1', state: 'review_ready' },
    semantic_review: {
      complete: false,
      required_dispositions: [{ proposal_id: proposalId, reason: 'human_disposition_required' }],
      expected_review_snapshot: snapshot,
      interpretation: [],
      decisions: [],
      work: {
        required: [requiredItem],
        reviewed: [],
        automatic: [
          {
            id: automaticProposalId,
            automatic_target: 'electrical.continuous_current_a',
            automatic_value: 150,
            automatic_disposition: 'mapped',
            derived: false,
            state: 'automatic',
            required: false,
            decision_history: [],
            evidence: [fact],
          },
        ],
        derived: [
          {
            id: 'proposal.derived',
            automatic_target: 'battery.usable_capacity_ah',
            automatic_value: 100,
            automatic_disposition: 'mapped',
            derived: true,
            state: 'automatic',
            required: false,
            decision_history: [],
            evidence: [],
          },
        ],
      },
    },
    ...overrides,
  } as unknown as OperatorJobDetail;
}

function setup(currentJob = job(), overrides: Partial<OperatorApi> = {}) {
  const updated = job({
    semantic_review: {
      ...currentJob.semantic_review,
      complete: true,
      required_dispositions: [],
      work: { required: [], reviewed: [], automatic: [], derived: [] },
    },
  });
  const client = {
    semanticTargets: vi.fn().mockResolvedValue({ proposal_id: proposalId, targets: [target] }),
    semanticPreview: vi.fn().mockResolvedValue({
      target: target.canonical_field,
      selected_fact_ids: [fact.id],
      source_assertions: [{ fact_id: fact.id, raw_value: fact.raw_value, source_unit: 'A' }],
      normalized_value: 150,
      normalized_unit: 'A',
    }),
    semanticDecision: vi.fn().mockResolvedValue(updated),
    get: vi.fn().mockResolvedValue(currentJob),
    ...overrides,
  } as unknown as OperatorApi;
  const onUpdate = vi.fn();
  render(
    <SemanticAdjudication
      job={currentJob}
      client={client}
      reviewer="Local reviewer"
      onUpdate={onUpdate}
    />,
  );
  return { client, onUpdate, updated };
}

afterEach(cleanup);

function automaticOnlyJob() {
  return job({
    semantic_review: {
      ...job().semantic_review,
      complete: true,
      required_dispositions: [],
      work: {
        required: [],
        reviewed: [],
        automatic: [job().semantic_review!.work.automatic[0]],
        derived: [],
      },
    },
  });
}

describe('semantic adjudication operator workflow', () => {
  it('separates required work, automatic mappings and derived results and displays source evidence', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'REVIEW REQUIRED' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AUTOMATICALLY MAPPED' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'DERIVED / CALCULATED' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Mystery electrical rating/ })).toBeChecked();
    expect(screen.getAllByText('150 A').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: fact.source_uri })[0]).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(screen.getAllByLabelText('Semantic disposition')).toHaveLength(1);
  });

  it('loads target choices from the server and submits the exact server preview value', async () => {
    const { client, onUpdate, updated } = setup();
    fireEvent.change(screen.getByLabelText('Semantic disposition'), {
      target: { value: 'map' },
    });
    await waitFor(() =>
      expect(client.semanticTargets).toHaveBeenCalledWith('job-1', proposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
      }),
    );
    expect(
      screen.getByRole('option', { name: 'electrical.continuous_output_current_a · current · A' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Canonical target from the server contract'), {
      target: { value: target.canonical_field },
    });
    await waitFor(() =>
      expect(client.semanticPreview).toHaveBeenCalledWith('job-1', proposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
        target: target.canonical_field,
      }),
    );
    expect(screen.getByText(/Source-stated value/)).toBeInTheDocument();
    expect(screen.getByText(/Normalized \/ converted value/)).toBeInTheDocument();
    expect(screen.getByText('Human-adjudicated meaning:')).toBeInTheDocument();
    expect(screen.queryByLabelText(/normalized value/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Rationale (required)'), {
      target: { value: 'The source assertion is continuous output current.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record semantic disposition' }));
    await waitFor(() =>
      expect(client.semanticDecision).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          proposal_id: proposalId,
          outcome: 'map',
          target: target.canonical_field,
          normalized_value: 150,
          normalized_unit: 'A',
          rationale: 'The source assertion is continuous output current.',
        }),
      ),
    );
    expect(onUpdate).toHaveBeenCalledWith(updated);
  });

  it('renders server-converted inches and submits the returned millimetre value without editing', async () => {
    const dimensionTarget = {
      ...target,
      canonical_field: 'dimensions_mm.x',
      dimension: 'length',
      unit: 'mm',
    };
    const { client } = setup(
      job({
        semantic_review: {
          ...job().semantic_review,
          work: {
            ...job().semantic_review!.work,
            required: [
              { ...requiredItem, evidence: [{ ...fact, raw_value: '11.5 in', unit: undefined }] },
            ],
          },
        },
      }),
      {
        semanticTargets: vi.fn().mockResolvedValue({
          proposal_id: proposalId,
          targets: [dimensionTarget],
        }),
        semanticPreview: vi.fn().mockResolvedValue({
          target: dimensionTarget.canonical_field,
          selected_fact_ids: [fact.id],
          source_assertions: [{ fact_id: fact.id, raw_value: '11.5 in' }],
          normalized_value: 292.1,
          normalized_unit: 'mm',
        }),
      },
    );
    fireEvent.change(screen.getByLabelText('Semantic disposition'), { target: { value: 'map' } });
    await waitFor(() => expect(client.semanticTargets).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Canonical target from the server contract'), {
      target: { value: dimensionTarget.canonical_field },
    });
    await waitFor(() => expect(screen.getByText('292.1')).toBeInTheDocument());
    expect(screen.getAllByText('11.5 in').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/normalized value/i)).not.toBeInTheDocument();
  });

  it('offers optional correction for automatic mappings without opening an editor or changing completion', async () => {
    const { client } = setup(automaticOnlyJob());
    const automaticCard = screen.getByText(/Proposal proposal\.automatic/).closest('article');
    expect(screen.getByRole('status')).toHaveTextContent(/semantic review complete/i);
    expect(automaticCard).toHaveTextContent('electrical.continuous_current_a');
    expect(automaticCard).toHaveTextContent('Original automatic value: 150');
    expect(automaticCard).toHaveTextContent('150 A');
    expect(within(automaticCard!).queryByLabelText('Semantic disposition')).not.toBeInTheDocument();
    const correctionAction = within(automaticCard!).getByRole('button', {
      name: 'Review / correct automatic mapping',
    });
    fireEvent.click(correctionAction);
    expect(within(automaticCard!).getByLabelText('Semantic disposition')).toBeInTheDocument();
    expect(automaticCard!.querySelector('details.source-evidence')).toHaveAttribute('open');
    expect(
      within(automaticCard!)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(
      expect.arrayContaining([
        'Map to canonical field',
        'Evidence only',
        'Schema gap',
        'Reject assertion',
        'Not applicable',
        'Leave unresolved',
      ]),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/semantic review complete/i);
    expect(client.semanticDecision).not.toHaveBeenCalled();
    expect(
      within(automaticCard!).getByRole('button', { name: 'Hide correction controls' }),
    ).toBeInTheDocument();
  });

  it('corrects an automatic mapping through server target discovery and preview', async () => {
    const { client } = setup(automaticOnlyJob(), {
      semanticTargets: vi.fn().mockResolvedValue({
        proposal_id: automaticProposalId,
        targets: [target, alternateTarget],
      }),
    });
    const automaticCard = screen.getByText(/Proposal proposal\.automatic/).closest('article')!;
    fireEvent.click(
      within(automaticCard).getByRole('button', { name: 'Review / correct automatic mapping' }),
    );
    fireEvent.change(within(automaticCard).getByLabelText('Semantic disposition'), {
      target: { value: 'map' },
    });
    await waitFor(() =>
      expect(client.semanticTargets).toHaveBeenCalledWith('job-1', automaticProposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
      }),
    );
    fireEvent.change(
      within(automaticCard).getByLabelText('Canonical target from the server contract'),
      { target: { value: alternateTarget.canonical_field } },
    );
    await waitFor(() =>
      expect(client.semanticPreview).toHaveBeenCalledWith('job-1', automaticProposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
        target: alternateTarget.canonical_field,
      }),
    );
    fireEvent.change(within(automaticCard).getByLabelText('Rationale (required)'), {
      target: { value: 'The source assertion is input current, not general current.' },
    });
    fireEvent.click(
      within(automaticCard).getByRole('button', { name: 'Record semantic disposition' }),
    );
    await waitFor(() =>
      expect(client.semanticDecision).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          proposal_id: automaticProposalId,
          outcome: 'map',
          target: alternateTarget.canonical_field,
          normalized_value: 150,
          normalized_unit: 'A',
        }),
      ),
    );
    expect(automaticCard).toHaveTextContent('electrical.continuous_current_a');
    expect(automaticCard).toHaveTextContent('Original automatic value: 150');
  });

  it('records a non-map disposition for an automatic mapping', async () => {
    const { client } = setup(automaticOnlyJob());
    const automaticCard = screen.getByText(/Proposal proposal\.automatic/).closest('article')!;
    fireEvent.click(
      within(automaticCard).getByRole('button', { name: 'Review / correct automatic mapping' }),
    );
    fireEvent.change(within(automaticCard).getByLabelText('Semantic disposition'), {
      target: { value: 'evidence_only' },
    });
    fireEvent.click(
      within(automaticCard).getByRole('button', { name: 'Record semantic disposition' }),
    );
    await waitFor(() =>
      expect(client.semanticDecision).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          proposal_id: automaticProposalId,
          outcome: 'evidence_only',
          selected_fact_ids: [fact.id],
        }),
      ),
    );
  });

  it('invalidates a target preview immediately and waits for the new target preview', async () => {
    let resolveSecond!: (value: {
      target: string;
      selected_fact_ids: string[];
      source_assertions: { fact_id: string; raw_value: string }[];
      normalized_value: number;
      normalized_unit: string;
    }) => void;
    const secondPreview = new Promise<{
      target: string;
      selected_fact_ids: string[];
      source_assertions: { fact_id: string; raw_value: string }[];
      normalized_value: number;
      normalized_unit: string;
    }>((resolve) => {
      resolveSecond = resolve;
    });
    const previewRequest = vi
      .fn()
      .mockResolvedValueOnce({
        target: target.canonical_field,
        selected_fact_ids: [fact.id],
        source_assertions: [{ fact_id: fact.id, raw_value: fact.raw_value }],
        normalized_value: 150,
        normalized_unit: 'A',
      })
      .mockReturnValueOnce(secondPreview);
    const { client } = setup(automaticOnlyJob(), {
      semanticTargets: vi.fn().mockResolvedValue({
        proposal_id: automaticProposalId,
        targets: [target, alternateTarget],
      }),
      semanticPreview: previewRequest,
    });
    const automaticCard = screen.getByText(/Proposal proposal\.automatic/).closest('article')!;
    fireEvent.click(
      within(automaticCard).getByRole('button', { name: 'Review / correct automatic mapping' }),
    );
    fireEvent.change(within(automaticCard).getByLabelText('Semantic disposition'), {
      target: { value: 'map' },
    });
    await waitFor(() =>
      expect(client.semanticTargets).toHaveBeenCalledWith('job-1', automaticProposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
      }),
    );
    await waitFor(() =>
      expect(
        within(automaticCard).getByLabelText('Canonical target from the server contract'),
      ).toBeEnabled(),
    );
    fireEvent.change(
      within(automaticCard).getByLabelText('Canonical target from the server contract'),
      { target: { value: target.canonical_field } },
    );
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(automaticCard).getByText(/Normalized \/ converted value/)).toBeInTheDocument(),
    );
    fireEvent.change(within(automaticCard).getByLabelText('Rationale (required)'), {
      target: { value: 'The retained assertion supports this target.' },
    });
    const submit = within(automaticCard).getByRole('button', {
      name: 'Record semantic disposition',
    });
    expect(submit).toBeEnabled();
    fireEvent.change(
      within(automaticCard).getByLabelText('Canonical target from the server contract'),
      { target: { value: alternateTarget.canonical_field } },
    );
    expect(submit).toBeDisabled();
    expect(
      within(automaticCard).queryByText(/Normalized \/ converted value/),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(2));
    expect(submit).toBeDisabled();
    resolveSecond({
      target: alternateTarget.canonical_field,
      selected_fact_ids: [fact.id],
      source_assertions: [{ fact_id: fact.id, raw_value: fact.raw_value }],
      normalized_value: 150,
      normalized_unit: 'A',
    });
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('invalidates previews on source-unit changes and clears source recovery on target changes', async () => {
    const firstPreview = {
      target: target.canonical_field,
      selected_fact_ids: [fact.id],
      source_assertions: [{ fact_id: fact.id, raw_value: fact.raw_value }],
      normalized_value: 150,
      normalized_unit: 'A',
    };
    let resolveNext!: (value: typeof firstPreview) => void;
    const pendingPreview = new Promise<typeof firstPreview>((resolve) => {
      resolveNext = resolve;
    });
    const previewRequest = vi
      .fn()
      .mockResolvedValueOnce(firstPreview)
      .mockReturnValueOnce(pendingPreview)
      .mockResolvedValueOnce({
        ...firstPreview,
        target: alternateTarget.canonical_field,
      });
    const { client } = setup(
      job({
        semantic_review: {
          ...automaticOnlyJob().semantic_review,
          work: {
            ...automaticOnlyJob().semantic_review!.work,
            automatic: [
              {
                ...automaticOnlyJob().semantic_review!.work.automatic[0],
                evidence: [{ ...fact, unit: undefined }],
              },
            ],
          },
        },
      }),
      {
        semanticTargets: vi.fn().mockResolvedValue({
          proposal_id: automaticProposalId,
          targets: [target, alternateTarget],
        }),
        semanticPreview: previewRequest,
      },
    );
    const automaticCard = screen.getByText(/Proposal proposal\.automatic/).closest('article')!;
    fireEvent.click(
      within(automaticCard).getByRole('button', { name: 'Review / correct automatic mapping' }),
    );
    fireEvent.change(within(automaticCard).getByLabelText('Semantic disposition'), {
      target: { value: 'map' },
    });
    await waitFor(() =>
      expect(client.semanticTargets).toHaveBeenCalledWith('job-1', automaticProposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
      }),
    );
    await waitFor(() =>
      expect(
        within(automaticCard).getByLabelText('Canonical target from the server contract'),
      ).toBeEnabled(),
    );
    fireEvent.change(
      within(automaticCard).getByLabelText('Canonical target from the server contract'),
      { target: { value: target.canonical_field } },
    );
    await waitFor(() =>
      expect(within(automaticCard).getByLabelText(/Explicit source unit/)).toBeInTheDocument(),
    );
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(automaticCard).getByText(/Normalized \/ converted value/)).toBeInTheDocument(),
    );
    fireEvent.change(within(automaticCard).getByLabelText('Rationale (required)'), {
      target: { value: 'The source unit is explicitly recovered.' },
    });
    const submit = within(automaticCard).getByRole('button', {
      name: 'Record semantic disposition',
    });
    fireEvent.change(within(automaticCard).getByLabelText(/Explicit source unit/), {
      target: { value: 'A' },
    });
    expect(submit).toBeDisabled();
    expect(
      within(automaticCard).queryByText(/Normalized \/ converted value/),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(2));
    expect(submit).toBeDisabled();
    resolveNext(firstPreview);
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(
      within(automaticCard).getByLabelText('Canonical target from the server contract'),
      { target: { value: alternateTarget.canonical_field } },
    );
    expect(within(automaticCard).getByLabelText(/Explicit source unit/)).toHaveValue('');
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(3));
  });

  it.each([
    ['evidence_only', 'Evidence only'],
    ['schema_gap', 'Schema gap'],
    ['reject', 'Reject assertion'],
    ['not_applicable', 'Not applicable'],
    ['unresolved', 'Leave unresolved'],
  ] as const)('submits the %s non-map disposition', async (outcome, _label) => {
    const { client } = setup();
    fireEvent.change(screen.getByLabelText('Semantic disposition'), { target: { value: outcome } });
    if (outcome === 'schema_gap') {
      fireEvent.change(screen.getByLabelText('Schema concept key'), {
        target: { value: 'electrical.unmodeled_rating' },
      });
      fireEvent.change(screen.getByLabelText('Explain the missing concept'), {
        target: { value: 'The source states a distinct rating.' },
      });
    }
    if (['schema_gap', 'reject', 'not_applicable'].includes(outcome))
      fireEvent.change(screen.getByLabelText('Rationale (required)'), {
        target: { value: 'Reviewed against retained source evidence.' },
      });
    fireEvent.click(screen.getByRole('button', { name: 'Record semantic disposition' }));
    await waitFor(() =>
      expect(client.semanticDecision).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          outcome,
          proposal_id: proposalId,
          selected_fact_ids: [fact.id],
          ...(outcome === 'schema_gap'
            ? {
                schema_gap: {
                  concept_key: 'electrical.unmodeled_rating',
                  explanation: 'The source states a distinct rating.',
                },
              }
            : {}),
        }),
      ),
    );
    if (outcome === 'evidence_only' || outcome === 'unresolved')
      expect(client.semanticDecision).toHaveBeenCalledWith(
        'job-1',
        expect.not.objectContaining({ rationale: expect.any(String) }),
      );
    expect(screen.getByRole('heading', { name: 'REVIEW REQUIRED' })).toBeInTheDocument();
  });

  it('reloads stale review state and never replays a disposition automatically', async () => {
    const refreshed = job({
      semantic_review: {
        ...job().semantic_review,
        expected_review_snapshot: 'sha256:new-review',
      },
    });
    const decision = vi.fn().mockRejectedValue(new OperatorApiError(409, 'Review changed.'));
    const { client, onUpdate } = setup(job(), {
      semanticDecision: decision,
      get: vi.fn().mockResolvedValue(refreshed),
    });
    fireEvent.change(screen.getByLabelText('Semantic disposition'), {
      target: { value: 'unresolved' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record semantic disposition' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/reconfirm/i));
    expect(decision).toHaveBeenCalledOnce();
    expect(client.get).toHaveBeenCalledWith('job-1');
    expect(onUpdate).toHaveBeenCalledWith(refreshed);
  });

  it('allows a correction as a new revision while preserving the prior decision history', async () => {
    const reviewed = {
      ...requiredItem,
      required: false,
      state: 'unresolved',
      active_decision: {
        id: 'decision.1',
        proposal_id: proposalId,
        revision: 1,
        active: true,
        outcome: 'unresolved',
        actor_label: 'First reviewer',
        recorded_at: '2026-09-01T00:00:00Z',
        selected_fact_ids: [fact.id],
      },
      decision_history: [
        {
          id: 'decision.1',
          proposal_id: proposalId,
          revision: 1,
          active: true,
          outcome: 'unresolved',
          actor_label: 'First reviewer',
          recorded_at: '2026-09-01T00:00:00Z',
          selected_fact_ids: [fact.id],
        },
      ],
    };
    const current = job({
      semantic_review: {
        ...job().semantic_review,
        complete: true,
        required_dispositions: [],
        work: { required: [], reviewed: [reviewed], automatic: [], derived: [] },
      },
    });
    const { client } = setup(current);
    expect(screen.getByText(/revision 1, unresolved by First reviewer/)).toBeInTheDocument();
    expect(screen.getByText(/correction appends a new revision/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Semantic disposition'), {
      target: { value: 'evidence_only' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record semantic disposition' }));
    await waitFor(() =>
      expect(client.semanticDecision).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ outcome: 'evidence_only', proposal_id: proposalId }),
      ),
    );
  });

  it('does not offer semantic adjudication controls for derived proposals', () => {
    const current = job({
      semantic_review: {
        ...job().semantic_review,
        complete: true,
        required_dispositions: [],
        work: {
          required: [],
          reviewed: [],
          automatic: [],
          derived: [{ ...requiredItem, id: 'proposal.derived', derived: true, required: false }],
        },
      },
    });
    const { client } = setup(current);
    expect(
      screen.getByText(/derived proposals are not human semantic evidence/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Semantic disposition')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Review / correct automatic mapping' }),
    ).not.toBeInTheDocument();
    expect(client.semanticTargets).not.toHaveBeenCalled();
  });

  it('shows server completion state and leaves automatically mapped proposals outside the required queue', () => {
    const current = automaticOnlyJob();
    setup(current);
    expect(screen.getByRole('status')).toHaveTextContent(/semantic review complete/i);
    expect(screen.getByRole('heading', { name: 'AUTOMATICALLY MAPPED' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Semantic disposition')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Review / correct automatic mapping' }),
    ).toBeInTheDocument();
  });
});
