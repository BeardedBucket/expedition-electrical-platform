import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductReview } from './ProductReview.js';
import type { OperatorApi, OperatorJobDetail } from './api.js';

const fact = {
  id: 'qualified.1',
  label: 'Nominal voltage',
  raw_value: '24 V',
  unit: 'V',
  applicability: { kind: 'direct_identity', value: 'EX-1' },
  qualification: 'exact',
  source_uri: 'https://example.test/spec.pdf',
  document: 'Official specifications',
  locators: [
    {
      role: 'value',
      locator: { kind: 'pdf', page: 2, section: 'Specifications' },
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
                  projected: true,
                  references: [],
                  evidence: [fact],
                },
                {
                  id: 'proposal.2',
                  disposition: 'mapped',
                  value: 24,
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
function setup(job = detail()) {
  const client = {
    review: vi.fn().mockResolvedValue({ ...job, summary: { ...job.summary, state: 'approved' } }),
    finalize: vi.fn().mockResolvedValue(job),
  } as unknown as OperatorApi;
  const onUpdate = vi.fn();
  render(<ProductReview job={job} client={client} onUpdate={onUpdate} />);
  return { job, client, onUpdate };
}
function selectApproval() {
  fireEvent.change(screen.getByLabelText('Reviewer label'), {
    target: { value: 'Local reviewer' },
  });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'battery' } });
  fireEvent.change(screen.getByLabelText('Product role'), { target: { value: 'battery' } });
  fireEvent.change(screen.getByLabelText('Human decision for electrical.nominal_voltage'), {
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
        fireEvent.click(screen.getByLabelText(`Approve qualified assertion ${id}`));
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
        fireEvent.change(screen.getByLabelText('Human decision for electrical.nominal_voltage'), {
          target: { value: '' },
        });
      if (selection !== 'field')
        fireEvent.click(screen.getByLabelText('Approve qualified assertion assertion.dc'));
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
  it('links official sources safely and preserves multiple supporting proposals', () => {
    setup();
    const links = screen.getAllByRole('link', { name: fact.source_uri });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.getByText('24.0 V')).toBeInTheDocument();
    expect(screen.getByText('qualified.2')).toBeInTheDocument();
  });
  it('has no selected fields, category, role or acknowledgement by default', () => {
    setup();
    expect(screen.getByLabelText('Product role')).toHaveValue('');
    expect(screen.getByLabelText('Category')).toHaveValue('');
    expect(screen.getByLabelText('Human decision for electrical.nominal_voltage')).toHaveValue('');
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
    expect(screen.queryByLabelText('Human decision for electrical.nominal_voltage')).toBeNull();
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
      fireEvent.click(
        screen.getByRole('button', {
          name: action === 'reject' ? 'Reject product review' : 'Defer product review',
        }),
      );
      expect(client.review).not.toHaveBeenCalled();
      expect(screen.getByText(/ends the current job/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: `Confirm ${action}` }));
      await waitFor(() =>
        expect(client.review).toHaveBeenCalledWith('test', action, { reviewer_id: 'Human' }),
      );
      expect(client.finalize).not.toHaveBeenCalled();
    },
  );
  it('requires approval confirmation and persists exact selected fields without finalizing', async () => {
    const { client } = setup();
    selectApproval();
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected assertions' }));
    expect(client.review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    await waitFor(() =>
      expect(client.review).toHaveBeenCalledWith(
        'test',
        'approve',
        expect.objectContaining({
          reviewer_id: 'Local reviewer',
          promotion_decisions: expect.objectContaining({
            approved_fields: ['electrical.nominal_voltage'],
            evidence_acknowledged: true,
            category: 'battery',
            product_role: 'battery',
          }),
        }),
      ),
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
  it('keeps explicit exclusion, evidence-only selections and rationale in the actual contract', async () => {
    const { client } = setup();
    selectApproval();
    fireEvent.change(screen.getByLabelText('Evidence decision for product-fact.1'), {
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
