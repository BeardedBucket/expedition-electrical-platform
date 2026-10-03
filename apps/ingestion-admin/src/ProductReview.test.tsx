import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductReview } from './ProductReview.js';
import type { OperatorApi, OperatorJobDetail } from './api.js';

const fact = {
  id: 'qualified.1',
  label: 'Nominal voltage',
  raw_value: '24 V',
  unit: 'V',
  applicability: { kind: 'exact_mpn_or_sku' as const, value: 'EX-1' },
  qualification: 'exact' as const,
  source_uri: 'https://example.test/spec.pdf',
  document: 'Official specifications',
  locators: [
    {
      role: 'value' as const,
      locator: { kind: 'pdf' as const, page: 2, section: 'Specifications' },
      block_id: 'block.1',
    },
  ],
  conflicts: [],
};
function detail(candidate = true): OperatorJobDetail {
  return {
    summary: {
      id: 'test',
      state: 'review_ready',
      created_at: '',
      updated_at: '',
      manufacturer: 'Example',
      product_model: 'EX-1',
    },
    intake: { manufacturer: 'Example', product_model: 'EX-1' },
    product_review_lifecycle: {
      expected_lifecycle_snapshot: 'lifecycle.snapshot',
      resumable: false,
      history: [],
    },
    candidate: { present: candidate, non_projected: [] },
    product_review: {
      roles: ['battery', 'monitor'],
      canonical_id: candidate ? 'example.ex-1' : undefined,
      truncated: false,
      fields: candidate
        ? [
            {
              path: 'electrical.nominal_voltage',
              value: 24,
              selectable: true,
              candidate_fact_ids: ['product-fact.1'],
              proposals: [
                {
                  id: 'proposal.1',
                  disposition: 'mapped',
                  value: 24,
                  value_origin: 'normalized / converted',
                  canonical_unit: 'V',
                  projected: true,
                  references: [],
                  evidence: [fact],
                },
                {
                  id: 'proposal.2',
                  disposition: 'mapped',
                  value: 24,
                  value_origin: 'normalized / converted',
                  canonical_unit: 'V',
                  projected: true,
                  references: [],
                  evidence: [{ ...fact, id: 'qualified.2', raw_value: '24.0 V' }],
                },
              ],
            },
          ]
        : [],
      candidate_facts: candidate
        ? [
            {
              id: 'product-fact.1',
              field: 'electrical.nominal_voltage',
              raw_label: 'Nominal voltage',
              raw_value: '24 V',
              fact_state: 'provisional',
            },
          ]
        : [],
    },
    diagnostics: [],
  } as unknown as OperatorJobDetail;
}
function withAutomaticSemanticItem(job = detail()) {
  const field = job.product_review!.fields[0];
  const proposal = field.proposals[0];
  job.semantic_review = {
    complete: true,
    required_dispositions: [],
    expected_review_snapshot: 'semantic.snapshot.1',
    interpretation: [],
    decisions: [],
    work: {
      required: [],
      reviewed: [],
      automatic: [
        {
          id: proposal.id,
          projected_field: field.path,
          automatic_target: field.path,
          automatic_disposition: proposal.disposition,
          automatic_value: proposal.value,
          display_value: proposal.display_value ?? proposal.value,
          canonical_unit: proposal.canonical_unit,
          value_origin: proposal.value_origin,
          derived: false,
          state: 'automatic',
          required: false,
          decision_history: [],
          evidence: proposal.evidence,
        },
      ],
      derived: [],
    },
  } as unknown as NonNullable<OperatorJobDetail['semantic_review']>;
  return job;
}
function setup(job = detail()) {
  const client = {
    review: vi.fn().mockResolvedValue({ ...job, summary: { ...job.summary, state: 'approved' } }),
    finalize: vi.fn().mockResolvedValue(job),
    resumeDeferredReview: vi.fn().mockResolvedValue(job),
    semanticPreview: vi.fn(),
  } as unknown as OperatorApi;
  const onUpdate = vi.fn();
  const view = render(<ProductReview job={job} client={client} onUpdate={onUpdate} />);
  return {
    job,
    client,
    onUpdate,
    rerender: (nextJob: OperatorJobDetail) =>
      view.rerender(<ProductReview job={nextJob} client={client} onUpdate={onUpdate} />),
  };
}
function selectApproval() {
  fireEvent.change(screen.getByLabelText('Reviewer label'), {
    target: { value: 'Local reviewer' },
  });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'battery' } });
  fireEvent.change(screen.getByLabelText('Product role'), { target: { value: 'battery' } });
  fireEvent.change(screen.getByLabelText('Product field decision for electrical.nominal_voltage'), {
    target: { value: 'approve' },
  });
  fireEvent.click(
    screen.getByLabelText(
      'I reviewed the supporting source evidence for the fields and assertions I am approving.',
    ),
  );
}
afterEach(cleanup);
describe('field oriented human product review', () => {
  it('does not require optional field resolution for a single supporting fact', () => {
    setup();
    expect(
      screen.queryByText('Resolve multiple supporting facts for electrical.nominal_voltage'),
    ).toBeNull();
  });
  it('keeps a projected automatic proposal in one semantic card with source and both decisions', () => {
    const job = withAutomaticSemanticItem();
    setup(job);
    const card = screen
      .getByRole('heading', { name: 'electrical.nominal_voltage' })
      .closest('article')!;
    expect(
      within(card).getByText('Source-stated evidence · Nominal voltage · qualified.1'),
    ).toBeInTheDocument();
    expect(within(card).getByText('24 V')).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: 'Review / correct automatic mapping' }),
    ).toBeInTheDocument();
    expect(
      within(card).getByLabelText('Product field decision for electrical.nominal_voltage'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByLabelText('Product field decision for electrical.nominal_voltage'),
    ).toHaveLength(1);
    expect(
      screen.queryByRole('heading', { name: 'Proposed field: electrical.nominal_voltage' }),
    ).toBeNull();
    expect(screen.queryByText('Source evidence for proposal proposal.1 · mapped')).toBeNull();
  });
  it('keeps product field decisions independent when semantic correction is opened', () => {
    const job = withAutomaticSemanticItem();
    setup(job);
    const fieldDecision = screen.getByLabelText(
      'Product field decision for electrical.nominal_voltage',
    );
    fireEvent.change(fieldDecision, { target: { value: 'approve' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review / correct automatic mapping' }));
    expect(fieldDecision).toHaveValue('approve');
    expect(screen.getByLabelText('Semantic disposition')).toHaveValue('');
  });
  it('keeps a human-mapped projected proposal in REVIEWED / DISPOSITIONED with product approval there', () => {
    const job = withAutomaticSemanticItem();
    const mapped = job.semantic_review!.work.automatic[0];
    job.semantic_review!.work.automatic = [];
    job.semantic_review!.work.reviewed = [
      {
        ...mapped,
        state: 'human_mapped',
        target: 'electrical.nominal_voltage',
        active_decision: {
          id: 'decision.1',
          proposal_id: mapped.id,
          revision: 1,
          active: true,
          outcome: 'map',
          actor_label: 'Reviewer',
          recorded_at: 'now',
          selected_fact_ids: [fact.id],
        },
      },
    ];
    setup(job);
    expect(screen.getByRole('heading', { name: 'REVIEWED / DISPOSITIONED' })).toBeInTheDocument();
    const card = screen
      .getByRole('heading', { name: 'electrical.nominal_voltage' })
      .closest('article')!;
    expect(
      within(card).getByLabelText('Product field decision for electrical.nominal_voltage'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Proposed field: electrical.nominal_voltage' }),
    ).toBeNull();
  });
  it.each(['evidence_only', 'schema_gap', 'reject', 'not_applicable', 'unresolved'] as const)(
    'keeps non-projecting %s in reviewed semantic work without product field approval',
    (outcome) => {
      const job = withAutomaticSemanticItem();
      const nonProjecting = job.semantic_review!.work.automatic[0];
      const field = job.product_review!.fields[0];
      field.selectable = false;
      field.proposals[0].projected = false;
      job.semantic_review!.work.automatic = [];
      job.semantic_review!.work.reviewed = [
        {
          ...nonProjecting,
          projected_field: undefined,
          automatic_disposition: 'unsupported',
          state: outcome,
          active_decision: {
            id: 'decision.1',
            proposal_id: nonProjecting.id,
            revision: 1,
            active: true,
            outcome,
            actor_label: 'Reviewer',
            recorded_at: 'now',
            selected_fact_ids: [fact.id],
          },
        },
      ];
      setup(job);
      const card = screen.getByRole('heading', { name: field.path }).closest('article')!;
      expect(within(card).getByText(new RegExp(`${outcome} by Reviewer`))).toBeInTheDocument();
      expect(within(card).queryByLabelText(`Product field decision for ${field.path}`)).toBeNull();
      expect(screen.queryByRole('heading', { name: `Proposed field: ${field.path}` })).toBeNull();
    },
  );
  it('keeps projected derived fields in DERIVED / CALCULATED with product approval', () => {
    const job = detail();
    job.product_review!.fields = [
      {
        path: 'battery.usable_capacity_ah',
        value: 100,
        canonical_unit: 'Ah',
        selectable: true,
        candidate_fact_ids: ['derived-fact.1'],
        proposals: [
          {
            id: 'proposal.derived',
            disposition: 'mapped',
            value: 100,
            value_origin: 'calculated / derived',
            canonical_unit: 'Ah',
            projected: true,
            references: [],
            evidence: [],
          },
        ],
      },
    ];
    job.semantic_review = {
      complete: true,
      required_dispositions: [],
      expected_review_snapshot: 'semantic.snapshot.1',
      interpretation: [],
      decisions: [],
      work: {
        required: [],
        reviewed: [],
        automatic: [],
        derived: [
          {
            id: 'proposal.derived',
            projected_field: 'battery.usable_capacity_ah',
            automatic_target: 'battery.usable_capacity_ah',
            automatic_disposition: 'mapped',
            automatic_value: 100,
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
    } as unknown as NonNullable<OperatorJobDetail['semantic_review']>;
    setup(job);
    const card = screen
      .getByRole('heading', { name: 'battery.usable_capacity_ah' })
      .closest('article')!;
    expect(screen.getByRole('heading', { name: 'DERIVED / CALCULATED' })).toBeInTheDocument();
    expect(
      within(card).getByLabelText('Product field decision for battery.usable_capacity_ah'),
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole('button', { name: 'Review / correct automatic mapping' }),
    ).toBeNull();
  });
  it('refreshes product field approval controls when a semantic correction changes projection', async () => {
    const job = withAutomaticSemanticItem();
    const { rerender } = setup(job);
    fireEvent.change(
      screen.getByLabelText('Product field decision for electrical.nominal_voltage'),
      {
        target: { value: 'approve' },
      },
    );
    const corrected = withAutomaticSemanticItem();
    corrected.semantic_review!.expected_review_snapshot = 'semantic.snapshot.2';
    corrected.product_review!.fields[0].selectable = false;
    corrected.product_review!.fields[0].proposals[0].projected = false;
    corrected.semantic_review!.work.automatic[0].automatic_disposition = 'unsupported';
    corrected.semantic_review!.work.automatic[0].projected_field = undefined;
    await waitFor(() => rerender(corrected));
    expect(
      screen.queryByLabelText('Product field decision for electrical.nominal_voltage'),
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Proposed field: electrical.nominal_voltage' }),
    ).toBeNull();
  });
  it('retains human-reviewed source evidence without creating a lower duplicate', () => {
    const job = withAutomaticSemanticItem();
    const reviewed = job.semantic_review!.work.automatic[0];
    job.semantic_review!.work.automatic = [];
    job.semantic_review!.work.reviewed = [
      {
        ...reviewed,
        projected_field: undefined,
        active_decision: {
          id: 'decision.1',
          proposal_id: reviewed.id,
          revision: 1,
          active: true,
          outcome: 'evidence_only',
          actor_label: 'Reviewer',
          recorded_at: 'now',
          selected_fact_ids: [fact.id],
        },
      },
    ];
    job.product_review!.fields[0].selectable = false;
    job.product_review!.fields[0].proposals[0].projected = false;
    setup(job);
    expect(screen.getAllByRole('heading', { name: 'REVIEWED / DISPOSITIONED' })).toHaveLength(1);
    expect(screen.queryByText('Proposed field: electrical.nominal_voltage')).toBeNull();
  });
  it.each(['first', 'second', 'both'] as const)(
    'independently approves same-target qualified assertions: %s',
    async (selected) => {
      const job = detail();
      job.product_review!.fields = [];
      job.product_review!.qualified_values = ['dc', 'ac'].map((domain, index) => ({
        id: `assertion.${index}`,
        target: 'electrical.input_voltage_range_v',
        value: { min: 8, max: 70 },
        qualifiers: { electrical_domain: domain },
        candidate_fact_ids: [`fact.${index}`],
        proposals: [
          {
            id: `proposal.${index}`,
            disposition: 'mapped',
            value: { min: 8, max: 70 },
            value_origin: 'normalized / converted',
            canonical_unit: 'V',
            projected: true,
            references: [],
            evidence: [fact],
          },
        ],
      })) as NonNullable<OperatorJobDetail['product_review']>['qualified_values'];
      const { client } = setup(job);
      fireEvent.change(screen.getByLabelText('Reviewer label'), { target: { value: 'Human' } });
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'monitor' } });
      fireEvent.change(screen.getByLabelText('Product role'), { target: { value: 'monitor' } });
      fireEvent.click(
        screen.getByLabelText(
          'I reviewed the supporting source evidence for the fields and assertions I am approving.',
        ),
      );
      expect(screen.getByRole('button', { name: 'Approve selected assertions' })).toBeDisabled();
      expect(screen.getByText('dc')).toBeInTheDocument();
      expect(screen.getByText('ac')).toBeInTheDocument();
      expect(screen.getAllByText('70')).toHaveLength(2);
      expect(screen.getAllByRole('link', { name: fact.source_uri })).toHaveLength(2);
      const ids =
        selected === 'both'
          ? ['assertion.0', 'assertion.1']
          : [selected === 'first' ? 'assertion.0' : 'assertion.1'];
      for (const id of ids)
        fireEvent.click(
          screen.getByLabelText(`Include qualified candidate assertion ${id} in product approval`),
        );
      fireEvent.click(screen.getByRole('button', { name: 'Approve selected assertions' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
      await waitFor(() =>
        expect(client.review).toHaveBeenCalledWith(
          'test',
          'approve',
          expect.objectContaining({
            promotion_decisions: expect.objectContaining({
              approved_fields: [],
              approved_qualified_value_ids: ids,
            }),
          }),
        ),
      );
      expect(client.finalize).not.toHaveBeenCalled();
    },
  );

  it.each(['field', 'qualified', 'both'] as const)(
    'mixed UI submits only explicit %s selections',
    async (selection) => {
      const job = detail();
      job.product_review!.qualified_values = [
        {
          id: 'assertion.dc',
          target: 'electrical.input_voltage_range_v',
          value: { min: 8, max: 70 },
          qualifiers: { electrical_domain: 'dc' },
          candidate_fact_ids: ['product-fact.2'],
          proposals: [],
        },
      ];
      const { client } = setup(job);
      selectApproval();
      if (selection === 'qualified')
        fireEvent.change(
          screen.getByLabelText('Product field decision for electrical.nominal_voltage'),
          {
            target: { value: '' },
          },
        );
      if (selection !== 'field')
        fireEvent.click(
          screen.getByLabelText(
            'Include qualified candidate assertion assertion.dc in product approval',
          ),
        );
      fireEvent.click(screen.getByRole('button', { name: 'Approve selected assertions' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
      await waitFor(() =>
        expect(client.review).toHaveBeenCalledWith(
          'test',
          'approve',
          expect.objectContaining({
            promotion_decisions: expect.objectContaining({
              approved_fields: selection === 'qualified' ? [] : ['electrical.nominal_voltage'],
              approved_qualified_value_ids: selection === 'field' ? [] : ['assertion.dc'],
            }),
          }),
        ),
      );
    },
  );
  it('renders canonical field, values, source wording, units, applicability and locators', () => {
    setup();
    expect(screen.getByText('Proposed field: electrical.nominal_voltage')).toBeInTheDocument();
    for (const label of ['24 V', 'Nominal voltage', 'V', 'EX-1', 'Specifications', '2'])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });
  it('shows exact source measurements separately from server-normalized canonical values', () => {
    const job = detail();
    job.product_review!.fields = [
      {
        path: 'dimensions_mm.z',
        value: 334.01,
        display_value: 334.01,
        canonical_unit: 'mm',
        selectable: true,
        candidate_fact_ids: ['fact.height'],
        proposals: [
          {
            id: 'proposal.height',
            disposition: 'mapped',
            value: 334.01,
            display_value: 334.01,
            canonical_unit: 'mm',
            value_origin: 'normalized / converted',
            projected: true,
            references: [],
            evidence: [
              {
                ...fact,
                id: 'fact.height',
                label: 'Height',
                raw_value: '13.15 in',
                unit: undefined,
              },
            ],
          },
        ],
      },
      {
        path: 'weight_kg',
        value: 36.650263496,
        canonical_unit: 'kg',
        selectable: true,
        candidate_fact_ids: ['fact.weight'],
        proposals: [
          {
            id: 'proposal.weight',
            disposition: 'mapped',
            value: 36.650263496,
            canonical_unit: 'kg',
            value_origin: 'normalized / converted',
            projected: true,
            references: [],
            evidence: [
              {
                ...fact,
                id: 'fact.weight',
                label: 'Weight',
                raw_value: '80.8 lb',
                unit: undefined,
              },
            ],
          },
        ],
      },
      {
        path: 'electrical.nominal_voltage_v',
        value: 12,
        canonical_unit: 'V',
        selectable: true,
        candidate_fact_ids: ['fact.voltage'],
        proposals: [
          {
            id: 'proposal.voltage',
            disposition: 'mapped',
            value: 12,
            canonical_unit: 'V',
            value_origin: 'normalized / converted',
            projected: true,
            references: [],
            evidence: [
              {
                ...fact,
                id: 'fact.voltage',
                label: 'Nominal voltage',
                raw_value: '12 V',
                unit: 'V',
              },
            ],
          },
        ],
      },
    ];
    const { client } = setup(job);

    const dimensions = screen
      .getByRole('heading', { name: 'Proposed field: dimensions_mm.z' })
      .closest('article')!;
    expect(dimensions).toHaveTextContent('SOURCE-STATED');
    expect(dimensions).toHaveTextContent('Height: 13.15 in');
    expect(dimensions).toHaveTextContent('Normalized / converted value: 334.01 mm');

    const weight = screen
      .getByRole('heading', { name: 'Proposed field: weight_kg' })
      .closest('article')!;
    expect(weight).toHaveTextContent('Weight: 80.8 lb');
    expect(weight).toHaveTextContent('Normalized / converted value: 36.650263496 kg');

    const voltage = screen
      .getByRole('heading', { name: 'Proposed field: electrical.nominal_voltage_v' })
      .closest('article')!;
    expect(voltage).toHaveTextContent('Nominal voltage: 12 V');
    expect(voltage).toHaveTextContent('Normalized / converted value: 12 V');
    expect(client.semanticPreview).not.toHaveBeenCalled();
  });
  it('renders floating-point conversion noise through the server-provided canonical presentation', () => {
    const job = detail();
    job.product_review!.fields = [
      {
        path: 'dimensions_mm.x',
        value: 180.08599999999998,
        display_value: 180.086,
        canonical_unit: 'mm',
        selectable: true,
        candidate_fact_ids: ['fact.width'],
        proposals: [
          {
            id: 'proposal.width',
            disposition: 'mapped',
            value: 180.08599999999998,
            display_value: 180.086,
            canonical_unit: 'mm',
            value_origin: 'normalized / converted',
            projected: true,
            references: [],
            evidence: [{ ...fact, id: 'fact.width', label: 'Width', raw_value: '7.09 in' }],
          },
        ],
      },
    ];
    setup(withAutomaticSemanticItem(job));
    expect(screen.getAllByText('180.086').length).toBeGreaterThan(0);
    expect(screen.queryByText('180.08599999999998')).toBeNull();
    expect(screen.getByText('7.09 in')).toBeInTheDocument();
  });
  it('links official sources safely and preserves multiple supporting proposals', () => {
    setup();
    const links = screen.getAllByRole('link', { name: fact.source_uri });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.getAllByText('24.0 V').length).toBeGreaterThan(0);
    expect(screen.getByText('qualified.2')).toBeInTheDocument();
  });
  it('has no selected fields, category, role or acknowledgement by default', () => {
    setup();
    expect(screen.getByLabelText('Product role')).toHaveValue('');
    expect(screen.getByLabelText('Category')).toHaveValue('');
    expect(
      screen.getByLabelText('Product field decision for electrical.nominal_voltage'),
    ).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Approve selected assertions' })).toBeDisabled();
  });
  it('shows conflicts and unresolved proposals without permitting their placement', () => {
    const job = detail();
    job.product_review!.fields[0].selectable = false;
    job.product_review!.fields[0].proposals[0].disposition = 'unresolved';
    job.review_package = {
      id: 'pkg',
      candidate_present: true,
      source_reference_count: 1,
      fact_reference_count: 2,
      proposal_reference_count: 2,
      unresolved_count: 1,
      conflict_count: 1,
      semantic_snapshot: 'snapshot',
      unresolved_items: ['Unresolved source applicability'],
      conflicts: ['Conflicting voltage'],
    };
    setup(job);
    expect(screen.getByText('Conflicting voltage')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Product field decision for electrical.nominal_voltage'),
    ).toBeNull();
  });
  it('renders Ekrano-style zero-fact preparation without a fake approval action', () => {
    setup(detail(false));
    expect(screen.getByText(/No promotable candidate was produced/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve selected assertions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Defer product review' })).toBeInTheDocument();
  });
  it.each(['reject', 'defer'] as const)(
    'confirms and persists no-candidate %s without role or category',
    async (action) => {
      const { client } = setup(detail(false));
      fireEvent.change(screen.getByLabelText('Reviewer label'), { target: { value: 'Human' } });
      if (action === 'defer')
        fireEvent.change(screen.getByLabelText('Human review rationale (required for Defer)'), {
          target: { value: 'Await schema support' },
        });
      fireEvent.click(
        screen.getByRole('button', {
          name: action === 'reject' ? 'Reject product review' : 'Defer product review',
        }),
      );
      expect(client.review).not.toHaveBeenCalled();
      expect(
        screen.getByText(
          action === 'defer'
            ? /Pause this job without promotion/
            : /Reject is a terminal review decision/,
        ),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: `Confirm ${action}` }));
      await waitFor(() =>
        expect(client.review).toHaveBeenCalledWith('test', action, {
          reviewer_id: 'Human',
          ...(action === 'defer'
            ? {
                reviewed_decisions: ['Await schema support'],
                expected_lifecycle_snapshot: 'lifecycle.snapshot',
              }
            : {}),
        }),
      );
      expect(client.finalize).not.toHaveBeenCalled();
    },
  );
  it('requires confirmation and submits the exact promotion-decision shape without finalizing', async () => {
    const { client } = setup(withAutomaticSemanticItem());
    selectApproval();
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected assertions' }));
    expect(client.review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    await waitFor(() =>
      expect(client.review).toHaveBeenCalledWith('test', 'approve', {
        reviewer_id: 'Local reviewer',
        promotion_decisions: {
          approved_fields: ['electrical.nominal_voltage'],
          approved_qualified_value_ids: [],
          excluded_fields: [],
          excluded_fact_ids: [],
          reviewed_evidence_fact_ids: [],
          field_resolutions: {},
          topology_evidence: {},
          evidence_acknowledged: true,
          category: 'battery',
          product_role: 'battery',
        },
      }),
    );
    expect(client.finalize).not.toHaveBeenCalled();
  });
  it('canceling confirmation makes no mutation', () => {
    const { client } = setup();
    selectApproval();
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected assertions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(client.review).not.toHaveBeenCalled();
  });
  it('requires a rationale for Defer, preserves operator reason and never describes pause as terminal', async () => {
    const { client } = setup(detail(false));
    fireEvent.change(screen.getByLabelText('Reviewer label'), { target: { value: 'Human' } });
    expect(screen.getByRole('button', { name: 'Defer product review' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Human review rationale (required for Defer)'), {
      target: { value: 'Await qualified rating schema' },
    });
    fireEvent.change(screen.getByLabelText('Defer reason (optional; operator selected)'), {
      target: { value: 'schema_gap' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Defer product review' }));
    expect(screen.getByText(/job may be explicitly resumed later/)).toBeInTheDocument();
    expect(screen.queryByText(/Defer ends the current job/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm defer' }));
    await waitFor(() =>
      expect(client.review).toHaveBeenCalledWith('test', 'defer', {
        reviewer_id: 'Human',
        reviewed_decisions: ['Await qualified rating schema'],
        defer_reason: 'schema_gap',
        expected_lifecycle_snapshot: 'lifecycle.snapshot',
      }),
    );
    expect(client.finalize).not.toHaveBeenCalled();
  });
  it('offers explicit confirmed resume only on a paused child without auto-resuming', async () => {
    const job = detail(false);
    job.summary.state = 'review_deferred';
    job.product_review_lifecycle!.resumable = true;
    const { client } = setup(job);
    expect(client.resumeDeferredReview).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Defer product review' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Resume operator label'), {
      target: { value: 'Human' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resume deferred review' }));
    expect(screen.getByText(/without changing evidence or semantic decisions/)).toBeInTheDocument();
    expect(client.resumeDeferredReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resume' }));
    await waitFor(() =>
      expect(client.resumeDeferredReview).toHaveBeenCalledWith(
        'test',
        'lifecycle.snapshot',
        'Human',
      ),
    );
    expect(client.review).not.toHaveBeenCalled();
    expect(client.finalize).not.toHaveBeenCalled();
  });
  it('keeps resume confirmation bound to the displayed lifecycle even if a newer job arrives', async () => {
    const job = detail(false);
    job.summary.state = 'review_deferred';
    job.product_review_lifecycle!.resumable = true;
    const { client, rerender } = setup(job);
    fireEvent.change(screen.getByLabelText('Resume operator label'), {
      target: { value: 'Human' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resume deferred review' }));
    rerender({
      ...job,
      product_review_lifecycle: {
        ...job.product_review_lifecycle!,
        expected_lifecycle_snapshot: 'newer.snapshot',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resume' }));
    await waitFor(() =>
      expect(client.resumeDeferredReview).toHaveBeenCalledWith(
        'test',
        'lifecycle.snapshot',
        'Human',
      ),
    );
  });
  it('keeps explicit exclusion, evidence-only selections and rationale in the actual contract', async () => {
    const job = detail();
    job.product_review!.fields[0].candidate_fact_ids = ['product-fact.1', 'product-fact.2'];
    const { client } = setup(job);
    selectApproval();
    fireEvent.change(screen.getByLabelText('Product evidence handling for product-fact.1'), {
      target: { value: 'reviewed' },
    });
    fireEvent.change(
      screen.getByLabelText('Selected supporting fact for electrical.nominal_voltage'),
      { target: { value: 'product-fact.1' } },
    );
    fireEvent.change(screen.getByLabelText('Resolution rationale for electrical.nominal_voltage'), {
      target: { value: 'Checked page 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected assertions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    await waitFor(() =>
      expect(client.review).toHaveBeenCalledWith(
        'test',
        'approve',
        expect.objectContaining({
          promotion_decisions: expect.objectContaining({
            reviewed_evidence_fact_ids: ['product-fact.1'],
            field_resolutions: {
              'electrical.nominal_voltage': {
                selected_fact_id: 'product-fact.1',
                rationale: 'Checked page 2',
              },
            },
          }),
        }),
      ),
    );
  });
  it('shows immutable approval and requires a separate confirmed write', async () => {
    const job = detail();
    job.summary.state = 'approved';
    job.approval = {
      decision: 'approved',
      reviewer_label: 'Human',
      reviewed_at: '2026-09-01',
      reviewed_decisions: undefined,
      review_package: {
        kind: 'review_package',
        reference: 'pkg',
        reference_schema_version: '1.0',
        digest: 'snapshot',
        digest_algorithm: 'sha256',
      },
      review_package_snapshot: 'snapshot',
      semantic_snapshot: 'semantic',
      promotion_decisions: {
        approved_fields: ['electrical.nominal_voltage'],
        category: 'battery',
        product_role: 'battery',
        evidence_acknowledged: true,
      },
    };
    const { client } = setup(job);
    expect(screen.getByText('Human')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reviewer label')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Write canonical component' }));
    expect(client.finalize).not.toHaveBeenCalled();
    expect(screen.getByText(/This creates a new file only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm write' }));
    await waitFor(() => expect(client.finalize).toHaveBeenCalledWith('test'));
  });
  it.each(['blocked', 'invalid'] as const)(
    'displays %s finalization distinctly with collision information',
    (status) => {
      const job = detail();
      job.summary.state = 'finalized';
      job.finalization = {
        requested_at: 'now',
        write_authorized: true,
        promotion_status: status,
        write_status: status,
        collision: status === 'blocked',
        schema_valid: false,
        promotion_issues: [],
        write_issues: [],
      };
      setup(job);
      expect(
        screen.getByText(`Promotion: ${status} · Canonical write: ${status}`),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Write canonical component' })).toBeNull();
      if (status === 'blocked')
        expect(
          screen.getByText('Canonical path collision. No overwrite was performed.'),
        ).toBeInTheDocument();
    },
  );
  it.each(['finalizing', 'finalization_failed'] as const)(
    'displays %s without retry or write actions',
    (state) => {
      const job = detail();
      job.summary.state = state;
      setup(job);
      expect(screen.getByText(/runtime does not support retry/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Write canonical component' })).toBeNull();
    },
  );
  it('leaves persisted state intact and shows useful API validation errors', async () => {
    const { client, onUpdate } = setup();
    vi.mocked(client.review).mockRejectedValue(
      new Error('Selection is outside reviewed evidence.'),
    );
    selectApproval();
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected assertions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Selection is outside reviewed evidence.',
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
