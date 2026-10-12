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
            canonical_unit: 'A',
            value_origin: 'normalized / converted',
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
            canonical_unit: 'Ah',
            value_origin: 'calculated / derived',
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
  const view = render(
    <SemanticAdjudication
      job={currentJob}
      client={client}
      reviewer="Local reviewer"
      onUpdate={onUpdate}
    />,
  );
  const advanced = screen
    .getByText('Product field approval and advanced proposal details')
    .closest('details')!;
  advanced.open = true;
  fireEvent(advanced, new Event('toggle'));
  return {
    client,
    onUpdate,
    updated,
    rerender: (next: OperatorJobDetail) =>
      view.rerender(
        <SemanticAdjudication
          job={next}
          client={client}
          reviewer="Local reviewer"
          onUpdate={onUpdate}
        />,
      ),
  };
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
  it('offers one correction entry on an automatic mapping and protects noneditable products', async () => {
    const current = automaticOnlyJob();
    current.human_adjudication = {
      editable: true,
      archived_history: undefined,
      documents: [],
      history: [],
      original_observations: [],
    };
    const view = setup(current);
    expect(screen.getAllByRole('button', { name: 'Correct or add information' })).toHaveLength(1);
    view.rerender({
      ...current,
      human_adjudication: { ...current.human_adjudication!, editable: false },
    });
    expect(
      screen.queryByRole('button', { name: 'Correct or add information' }),
    ).not.toBeInTheDocument();
  });
  it('returns a saved correction to its new durable proposal rather than the superseded item', async () => {
    const current = automaticOnlyJob();
    const statement = {
      label: 'Input current',
      value: '150 A',
      unit: 'A',
      wording: 'Example Model input current 150 A',
      citations: [
        { document_id: 'source', block_id: 'line', quote: 'Example Model input current 150 A' },
      ],
      applicability: {
        relationship: 'statement' as const,
        citation: {
          document_id: 'source',
          block_id: 'line',
          quote: 'Example Model input current 150 A',
        },
      },
    };
    Object.assign(current, {
      intake: { manufacturer: 'Example', product_model: 'Model', manufacturer_part_number: 'EX-1' },
    });
    current.human_adjudication = {
      editable: true,
      archived_history: undefined,
      documents: [],
      history: [],
      original_observations: [],
      correction_records: [
        {
          fact_id: fact.id,
          origin: 'automatic',
          source_ready: true,
          statement,
          warning: undefined,
        },
      ],
    };
    const next = structuredClone(current);
    const newFact = {
      ...current.semantic_review!.work.automatic[0].evidence[0],
      id: 'human.fact.current',
      label: 'Corrected source current',
    };
    const newItem = {
      ...next.semantic_review!.work.automatic[0],
      id: 'proposal.corrected',
      evidence: [newFact],
      automatic_target: alternateTarget.canonical_field,
    };
    next.semantic_review!.work.automatic = [newItem];
    next.human_adjudication!.history = [
      {
        id: 'correction.new',
        version: 'human-adjudication.v1',
        revision: 1,
        recorded_at: '2026-10-11T00:00:00Z',
        actor: { kind: 'local_operator_label', identifier: 'Local reviewer' },
        intent: {
          version: 'human-adjudication.v1',
          group_id: 'correction.group',
          action: 'correct',
          disposition: 'ready',
          statements: [statement],
          replaces_fact_ids: [fact.id],
          rationale: 'The source establishes input current.',
        },
        facts: [{ id: newFact.id }],
        original_fact_refs: [],
      },
    ] as unknown as NonNullable<OperatorJobDetail['human_adjudication']>['history'];
    const view = setup(current, {
      humanEvidence: vi.fn().mockResolvedValue({ entries: [], total: 0, offset: 0 }),
      humanProperties: vi.fn().mockResolvedValue({ targets: [alternateTarget] }),
      humanPreview: vi.fn().mockResolvedValue({ assertions: [], candidate: {}, non_projected: [] }),
      humanAdjudication: vi.fn().mockResolvedValue(next),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Correct or add information' }));
    fireEvent.change(screen.getByLabelText('What needs correcting?'), {
      target: { value: 'engineering' },
    });
    await screen.findByRole('option', { name: 'Continuous input current · A' });
    fireEvent.change(screen.getByLabelText('Engineering property'), {
      target: { value: alternateTarget.canonical_field },
    });
    fireEvent.change(screen.getByLabelText('Reason for correction (required)'), {
      target: { value: 'The source establishes input current.' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(view.onUpdate).toHaveBeenCalledWith(next));
    view.rerender(next);
    expect(
      screen.getByRole('heading', { name: 'Review: Corrected source current' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Correction saved. The current effective record is shown/),
    ).toBeInTheDocument();
  });
  it('shows automatic retained evidence and its lineage without requesting an engineering mapping', () => {
    const current = automaticOnlyJob();
    const item = current.semantic_review!.work.automatic[0];
    Object.assign(item, {
      automatic_target: 'source_label:warranty',
      automatic_value: undefined,
      automatic_disposition: 'evidence_only',
      automatic_retained_evidence: {
        policy_version: 'retained-evidence.v1',
        projection_authority: 'none',
        rules: [
          {
            id: 'retained.commercial.warranty',
            revision: 1,
            role: 'commercial',
            rule_digest: 'sha256:rule',
            source_fact_id: fact.id,
            source_fact_digest: 'sha256:fact',
          },
        ],
      },
      evidence: [{ ...fact, label: 'Warranty', raw_value: '2 years' }],
    });
    const { client } = setup(current);
    expect(screen.getByText('Automatically retained evidence')).toBeInTheDocument();
    const retainedSection = screen
      .getByRole('heading', { name: 'AUTOMATICALLY RETAINED EVIDENCE' })
      .closest('section')!;
    expect(
      within(retainedSection).getByText('Automatically retained evidence'),
    ).toBeInTheDocument();
    const mappedSection = screen
      .getByRole('heading', { name: 'AUTOMATICALLY MAPPED' })
      .closest('section')!;
    expect(
      within(mappedSection).queryByText('Automatically retained evidence'),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/No engineering projection/)).toBeInTheDocument();
    expect(screen.getByText(/retained.commercial.warranty/)).toBeInTheDocument();
    expect(screen.getAllByText('2 years').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Review decision')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review\/correct/ })).not.toBeInTheDocument();
    expect(client.semanticDecision).not.toHaveBeenCalled();
  });
  it('separates required work, automatic mappings and derived results and displays source evidence', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'REVIEW REQUIRED' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AUTOMATICALLY MAPPED' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'DERIVED / CALCULATED' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Mystery electrical rating/ })).toBeNull();
    expect(screen.getByText(/One already-bound source statement/)).toBeInTheDocument();
    expect(screen.getAllByText('150 A').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: fact.source_uri })[0]).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(screen.getAllByLabelText('Review decision')).toHaveLength(1);
  });

  it('submits Reject with the initially selected fact without a checkbox toggle', async () => {
    const { client, onUpdate, updated } = setup();
    const supportingFact = screen.getByText(/One already-bound source statement/);
    expect(supportingFact).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Review decision'), {
      target: { value: 'reject' },
    });
    const submit = screen.getByRole('button', { name: 'Save decision' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Rationale (required)'), {
      target: {
        value:
          '“Model / SKU” is a table/field label, not a product value or semantic product assertion.',
      },
    });

    expect(supportingFact).toBeInTheDocument();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(client.semanticDecision).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          proposal_id: proposalId,
          expected_review_snapshot: snapshot,
          selected_fact_ids: [fact.id],
          actor_label: 'Local reviewer',
          outcome: 'reject',
          rationale:
            '“Model / SKU” is a table/field label, not a product value or semantic product assertion.',
        }),
      ),
    );
    expect(onUpdate).toHaveBeenCalledWith(updated);
  });

  it('labels automatic normalization separately from actual derived results', () => {
    setup();
    const automaticCard = screen.getByText(/Proposal proposal\.automatic/).closest('article')!;
    expect(automaticCard).toHaveTextContent('Normalized / converted canonical value: 150 A');
    expect(automaticCard).toHaveTextContent('SOURCE-STATED');
    expect(automaticCard).toHaveTextContent('Mystery electrical rating: 150 A');

    const derivedSection = screen
      .getByRole('heading', { name: 'DERIVED / CALCULATED' })
      .closest('section')!;
    expect(derivedSection).toHaveTextContent('Calculated / derived result');
    expect(derivedSection).toHaveTextContent('battery.usable_capacity_ah');
    expect(derivedSection).toHaveTextContent('100 Ah');
    expect(derivedSection).not.toHaveTextContent('Normalized / converted canonical value');
  });

  it('labels and enforces every required Report a possible missing property field before enabling submission', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Review decision'), {
      target: { value: 'schema_gap' },
    });

    const conceptKey = screen.getByLabelText('Missing engineering concept or topic (required)');
    const explanation = screen.getByLabelText(
      'Explain the missing concept and why existing properties do not fit (required)',
    );
    const rationale = screen.getByLabelText('Rationale (required)');
    const submit = screen.getByRole('button', { name: 'Save decision' });

    expect(conceptKey).toBeRequired();
    expect(explanation).toBeRequired();
    expect(rationale).toBeRequired();
    expect(submit).toBeDisabled();

    fireEvent.change(conceptKey, { target: { value: '  ' } });
    fireEvent.change(explanation, { target: { value: 'A source-described rating.' } });
    fireEvent.change(rationale, { target: { value: 'Reviewed against source evidence.' } });
    expect(submit).toBeDisabled();

    fireEvent.change(conceptKey, { target: { value: 'electrical.unmodeled_rating' } });
    expect(submit).toBeEnabled();
  });

  it('loads target choices from the server and submits the exact server preview value', async () => {
    const { client, onUpdate, updated } = setup();
    fireEvent.change(screen.getByLabelText('Review decision'), {
      target: { value: 'map' },
    });
    await waitFor(() =>
      expect(client.semanticTargets).toHaveBeenCalledWith('job-1', proposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
      }),
    );
    expect(
      screen.getByRole('option', { name: 'Continuous output current · A' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Engineering property'), {
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
    expect(screen.getByText(/Selected engineering meaning:/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/normalized value/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Rationale (required)'), {
      target: { value: 'The source assertion is continuous output current.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
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
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'map' } });
    await waitFor(() => expect(client.semanticTargets).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Engineering property'), {
      target: { value: dimensionTarget.canonical_field },
    });
    await waitFor(() => expect(screen.getByText('292.1')).toBeInTheDocument());
    expect(screen.getAllByText('11.5 in').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/normalized value/i)).not.toBeInTheDocument();
  });

  it('offers optional correction for automatic mappings without opening an editor or changing completion', async () => {
    const { client } = setup(automaticOnlyJob());
    const automaticCard = screen.getByText(/Proposal proposal\.automatic/).closest('article');
    expect(screen.getByRole('status')).toHaveTextContent(/Required review decisions recorded/i);
    expect(automaticCard).toHaveTextContent('electrical.continuous_current_a');
    expect(automaticCard).toHaveTextContent('Normalized / converted canonical value: 150 A');
    expect(automaticCard).toHaveTextContent('150 A');
    expect(screen.queryByLabelText('Review decision')).not.toBeInTheDocument();
    const correctionAction = within(automaticCard!).getByRole('button', {
      name: 'Review / correct automatic mapping',
    });
    fireEvent.click(correctionAction);
    expect(screen.getByLabelText('Review decision')).toBeInTheDocument();
    expect(automaticCard!.querySelector('details.source-evidence')).not.toHaveAttribute('open');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(
      expect.arrayContaining([
        'Map this specification',
        'Keep as source evidence',
        'Report a possible missing property',
        'Reject this source interpretation',
        'Not applicable to this component',
        'Leave unresolved',
      ]),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/Required review decisions recorded/i);
    expect(client.semanticDecision).not.toHaveBeenCalled();
    expect(
      within(automaticCard!).getByRole('button', { name: 'Review / correct automatic mapping' }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Review / correct automatic mapping' }));
    fireEvent.change(screen.getByLabelText('Review decision'), {
      target: { value: 'map' },
    });
    await waitFor(() =>
      expect(client.semanticTargets).toHaveBeenCalledWith('job-1', automaticProposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
      }),
    );
    fireEvent.change(screen.getByLabelText('Engineering property'), {
      target: { value: alternateTarget.canonical_field },
    });
    await waitFor(() =>
      expect(client.semanticPreview).toHaveBeenCalledWith('job-1', automaticProposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
        target: alternateTarget.canonical_field,
      }),
    );
    fireEvent.change(screen.getByLabelText('Rationale (required)'), {
      target: { value: 'The source assertion is input current, not general current.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
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
    expect(automaticCard).toHaveTextContent('Normalized / converted canonical value: 150 A');
  });

  it('records a non-map disposition for an automatic mapping', async () => {
    const { client } = setup(automaticOnlyJob());
    const _automaticCard = screen.getByText(/Proposal proposal\.automatic/).closest('article')!;
    fireEvent.click(screen.getByRole('button', { name: 'Review / correct automatic mapping' }));
    fireEvent.change(screen.getByLabelText('Review decision'), {
      target: { value: 'evidence_only' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
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
    const _automaticCard = screen.getByText(/Proposal proposal\.automatic/).closest('article')!;
    fireEvent.click(screen.getByRole('button', { name: 'Review / correct automatic mapping' }));
    fireEvent.change(screen.getByLabelText('Review decision'), {
      target: { value: 'map' },
    });
    await waitFor(() =>
      expect(client.semanticTargets).toHaveBeenCalledWith('job-1', automaticProposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Engineering property')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Engineering property'), {
      target: { value: target.canonical_field },
    });
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText(/Normalized \/ converted value/)).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText('Rationale (required)'), {
      target: { value: 'The retained assertion supports this target.' },
    });
    const submit = screen.getByRole('button', { name: 'Save decision' });
    expect(submit).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Engineering property'), {
      target: { value: alternateTarget.canonical_field },
    });
    expect(submit).toBeDisabled();
    expect(screen.queryByText(/Normalized \/ converted value/)).not.toBeInTheDocument();
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
    const _automaticCard = screen.getByText(/Proposal proposal\.automatic/).closest('article')!;
    fireEvent.click(screen.getByRole('button', { name: 'Review / correct automatic mapping' }));
    fireEvent.change(screen.getByLabelText('Review decision'), {
      target: { value: 'map' },
    });
    await waitFor(() =>
      expect(client.semanticTargets).toHaveBeenCalledWith('job-1', automaticProposalId, {
        expected_review_snapshot: snapshot,
        selected_fact_ids: [fact.id],
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Engineering property')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Engineering property'), {
      target: { value: target.canonical_field },
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/Source unit clarification/)).toBeInTheDocument(),
    );
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText(/Normalized \/ converted value/)).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText('Rationale (required)'), {
      target: { value: 'The source unit is explicitly recovered.' },
    });
    const submit = screen.getByRole('button', { name: 'Save decision' });
    fireEvent.change(screen.getByLabelText(/Source unit clarification/), {
      target: { value: 'A' },
    });
    expect(submit).toBeDisabled();
    expect(screen.queryByText(/Normalized \/ converted value/)).not.toBeInTheDocument();
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(2));
    expect(submit).toBeDisabled();
    resolveNext(firstPreview);
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Engineering property'), {
      target: { value: alternateTarget.canonical_field },
    });
    expect(screen.getByLabelText(/Source unit clarification/)).toHaveValue('');
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(3));
  });

  it.each([
    ['evidence_only', 'Keep as source evidence'],
    ['schema_gap', 'Report a possible missing property'],
    ['reject', 'Reject this source interpretation'],
    ['not_applicable', 'Not applicable to this component'],
    ['unresolved', 'Leave unresolved'],
  ] as const)('submits the %s non-map disposition', async (outcome, _label) => {
    const { client } = setup();
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: outcome } });
    if (outcome === 'schema_gap') {
      fireEvent.change(screen.getByLabelText('Missing engineering concept or topic (required)'), {
        target: { value: 'electrical.unmodeled_rating' },
      });
      fireEvent.change(
        screen.getByLabelText(
          'Explain the missing concept and why existing properties do not fit (required)',
        ),
        {
          target: { value: 'The source states a distinct rating.' },
        },
      );
    }
    if (['schema_gap', 'reject', 'not_applicable'].includes(outcome))
      fireEvent.change(screen.getByLabelText('Rationale (required)'), {
        target: { value: 'Reviewed against retained source evidence.' },
      });
    fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
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
    fireEvent.change(screen.getByLabelText('Review decision'), {
      target: { value: 'unresolved' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((alert) => /reconfirm/i.test(alert.textContent ?? '')),
      ).toBe(true),
    );
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
    fireEvent.change(screen.getByLabelText('Review decision'), {
      target: { value: 'evidence_only' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
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
    expect(screen.queryByLabelText('Review decision')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Review / correct automatic mapping' }),
    ).not.toBeInTheDocument();
    expect(client.semanticTargets).not.toHaveBeenCalled();
  });

  it('shows server completion state and leaves automatically mapped proposals outside the required queue', () => {
    const current = automaticOnlyJob();
    setup(current);
    expect(screen.getByRole('status')).toHaveTextContent(/Required review decisions recorded/i);
    expect(screen.getByRole('heading', { name: 'AUTOMATICALLY MAPPED' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Review decision')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Review / correct automatic mapping' }),
    ).toBeInTheDocument();
  });
});

describe('Slice A source-first review', () => {
  it('searches eligible properties in ordinary language without selecting by resemblance', async () => {
    setup(job(), {
      semanticTargets: vi
        .fn()
        .mockResolvedValue({ proposal_id: proposalId, targets: [target, alternateTarget] }),
    });
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'map' } });
    await screen.findByRole('option', { name: 'Continuous output current · A' });
    expect(screen.getByLabelText('Engineering property')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Search engineering properties'), {
      target: { value: 'output amps' },
    });
    expect(
      screen.getByRole('option', { name: 'Continuous output current · A' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Continuous input current · A' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Peak/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Engineering property')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Engineering property'), {
      target: { value: target.canonical_field },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Help: Similar engineering properties' }));
    expect(
      within(screen.getByRole('note')).getByText(/Output differs from input; peak current/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Quantity: current · Normal units: A/)).toBeInTheDocument();
  });
  it('keeps condition, measurement context and capture references immutable during refused mapping and unresolved save', async () => {
    const evidence = {
      ...fact,
      conflicts: [{ id: 'conflict.1', outcome: 'unresolved' }],
      source_context: {
        wording: '150 A for 5 seconds at 25°C',
        conditions: ['At specified test temperature'],
        duration: '5 seconds',
        temperature: '25°C',
        alternatives: ['Peak, not continuous'],
        capture_id: 'capture.fixture',
        capture: {
          kind: 'source_capture',
          reference: 'capture.fixture',
          digest: 'sha256:artifact',
          digest_algorithm: 'sha256',
          reference_schema_version: '1.0',
        },
        content_digest: 'sha256:bytes',
        content_digest_algorithm: 'sha256',
      },
      locators: [
        {
          role: 'qualifier',
          text: 'Measurement basis: source fixture shunt',
          locator: { kind: 'pdf', page: 2, table: 'Specifications', row: 3, column: 'Current' },
        },
      ],
    };
    const current = job({
      semantic_review: {
        ...job().semantic_review,
        work: {
          required: [{ ...requiredItem, evidence: [evidence] }],
          reviewed: [],
          automatic: [],
          derived: [],
        },
      },
    });
    const before = JSON.stringify(current);
    const { client } = setup(current, {
      semanticPreview: vi
        .fn()
        .mockRejectedValue(
          new OperatorApiError(
            422,
            'Material source conditions require a qualifier-preserving semantic rule; scalar map cannot discard source context.',
          ),
        ),
    });
    const panel = within(screen.getByRole('complementary', { name: 'Manufacturer evidence' }));
    expect(panel.getByText('150 A for 5 seconds at 25°C')).toBeInTheDocument();
    expect(panel.getByText('5 seconds')).toBeInTheDocument();
    expect(panel.getByText('25°C')).toBeInTheDocument();
    expect(panel.getAllByText('Measurement basis: source fixture shunt')).toHaveLength(2);
    expect(panel.getByText(/content digest identifies captured bytes/i)).toBeInTheDocument();
    expect(panel.getByText(/sha256:bytes/)).toBeInTheDocument();
    expect(panel.getByRole('checkbox', { name: /Mystery electrical rating/ })).not.toBeChecked();
    fireEvent.click(panel.getByRole('checkbox', { name: /Mystery electrical rating/ }));
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'map' } });
    await screen.findByRole('option', { name: 'Continuous output current · A' });
    fireEvent.change(screen.getByLabelText('Engineering property'), {
      target: { value: target.canonical_field },
    });
    fireEvent.change(screen.getByLabelText('Rationale (required)'), {
      target: { value: 'Review the source rating' },
    });
    await waitFor(() =>
      expect(screen.getByText(/scalar map cannot discard source context/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Save decision' })).toBeDisabled();
    expect(client.semanticDecision).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'unresolved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
    await waitFor(() =>
      expect(client.semanticDecision).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ outcome: 'unresolved', selected_fact_ids: [fact.id] }),
      ),
    );
    expect(JSON.stringify(current)).toBe(before);
  });
  it('labels missing evidence context explicitly instead of presenting an unconditional rating', () => {
    setup();
    const panel = within(screen.getByRole('complementary', { name: 'Manufacturer evidence' }));
    expect(panel.getByText('Exact wording not available')).toBeInTheDocument();
    expect(panel.getByText(/does not establish an unconditional rating/)).toBeInTheDocument();
    expect(
      panel.getByText(/do not independently confirm manufacturer table boundaries/),
    ).toBeInTheDocument();
  });
  it('retains failed-save input and requires explicit discard before changing the selected specification', async () => {
    const second = {
      ...requiredItem,
      id: 'second',
      evidence: [{ ...fact, id: 'fact.second', label: 'Second rating' }],
    };
    const current = job({
      semantic_review: {
        ...job().semantic_review,
        work: { ...job().semantic_review!.work, required: [requiredItem, second] },
      },
    });
    const { client } = setup(current, {
      semanticDecision: vi.fn().mockRejectedValue(new Error('Temporary store failure')),
    });
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'unresolved' } });
    fireEvent.change(screen.getByLabelText('Rationale (optional)'), {
      target: { value: 'Retain my review notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and next outstanding item' }));
    await screen.findByText(/Temporary store failure/);
    expect(screen.getByLabelText('Rationale (optional)')).toHaveValue('Retain my review notes');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Specification work queue' })).getByRole(
        'button',
        { name: 'Second rating' },
      ),
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Rationale (optional)')).toHaveValue('Retain my review notes');
    expect(client.semanticDecision).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });
  it('distinguishes a missing search match from a contract gap and withholds undescribed properties', async () => {
    setup(job(), {
      semanticTargets: vi.fn().mockResolvedValue({
        proposal_id: proposalId,
        targets: [target, { ...target, canonical_field: 'future.unreviewed' }],
      }),
    });
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'map' } });
    await screen.findByRole('option', { name: 'Continuous output current · A' });
    expect(screen.getByText(/lacks a reviewed description/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /future/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search engineering properties'), {
      target: { value: 'accuracy' },
    });
    expect(screen.getByText(/does not prove a missing engineering concept/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'schema_gap' } });
    expect(screen.getByText(/creates no engineering property/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save decision' })).toBeDisabled();
  });
});

it('retains input but requires explicit current evidence binding after facts change on refresh', async () => {
  const { client, rerender } = setup();
  fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'unresolved' } });
  fireEvent.change(screen.getByLabelText('Rationale (optional)'), {
    target: { value: 'Preserve my rationale' },
  });
  const refreshed = job({
    semantic_review: {
      ...job().semantic_review,
      expected_review_snapshot: 'snapshot.new-facts',
      work: {
        required: [
          {
            ...requiredItem,
            evidence: [{ ...fact, id: 'fact.replacement', label: 'Replacement observation' }],
          },
        ],
        reviewed: [],
        automatic: [],
        derived: [],
      },
    },
  });
  rerender(refreshed);
  expect(screen.getByLabelText('Rationale (optional)')).toHaveValue('Preserve my rationale');
  expect(screen.getByRole('button', { name: 'Save decision' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Review current evidence and recheck' }));
  expect(screen.getByRole('button', { name: 'Save decision' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Use current supporting facts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  await waitFor(() =>
    expect(client.semanticDecision).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        expected_review_snapshot: 'snapshot.new-facts',
        selected_fact_ids: ['fact.replacement'],
        rationale: 'Preserve my rationale',
      }),
    ),
  );
});

it('freezes input during durable reload and retains it when retrieval fails', async () => {
  let failReload!: (error: Error) => void;
  const pending = new Promise<OperatorJobDetail>((_resolve, reject) => {
    failReload = reject;
  });
  setup(job(), { get: vi.fn().mockReturnValue(pending) });
  fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'unresolved' } });
  fireEvent.change(screen.getByLabelText('Rationale (optional)'), {
    target: { value: 'Retained local notes' },
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Return to saved review' }));
  expect(screen.getByLabelText('Rationale (optional)')).toBeDisabled();
  failReload(new Error('Durable review unavailable'));
  await screen.findByText('Durable review unavailable');
  expect(screen.getByLabelText('Rationale (optional)')).toBeEnabled();
  expect(screen.getByLabelText('Rationale (optional)')).toHaveValue('Retained local notes');
  confirm.mockRestore();
});
