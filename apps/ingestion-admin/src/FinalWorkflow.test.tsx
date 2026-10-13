import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SemanticAdjudication } from './SemanticAdjudication.js';
import { ProductReview } from './ProductReview.js';
import {
  ReviewerPropertyPicker,
  explorerConcepts,
  searchPropertyConcepts,
} from './ReviewerProperties.js';
import { createDemoController, demoScenarios } from '../demo/scenarios.js';
import type { OperatorApi } from './api.js';
afterEach(cleanup);
const scenario = (id: string) => demoScenarios.find((entry) => entry.id === id)!;
const output = 'electrical.continuous_output_current_a';
function show(id = 'scalar', reviewer = 'Reviewer', overrides: Partial<OperatorApi> = {}) {
  const controller = createDemoController(scenario(id));
  const client = { ...controller.client, ...overrides } as OperatorApi;
  const view = render(
    <SemanticAdjudication
      job={controller.current()}
      client={client}
      reviewer={reviewer}
      onUpdate={vi.fn()}
    />,
  );
  return { ...view, controller, client };
}
const outcome = (value: string) =>
  fireEvent.change(screen.getByLabelText('Review decision'), { target: { value } });
const chooseOutput = async () => {
  await screen.findByRole('option', { name: 'Continuous output current · A' });
  fireEvent.change(screen.getByLabelText('Engineering property'), { target: { value: output } });
};
describe('Final source-first maintainer workflow', () => {
  it('keeps safe single evidence read-only and in DOM order before the decision editor', () => {
    show();
    const source = screen.getByRole('complementary', { name: 'Manufacturer evidence' });
    expect(within(source).queryByRole('checkbox')).toBeNull();
    expect(within(source).getByText(/One already-bound source statement/)).toBeInTheDocument();
    expect(within(source).getByText(/does not map, approve or verify/)).toBeInTheDocument();
    const queue = screen.getByRole('complementary', { name: 'Review queue' });
    const decision = screen.getByRole('region', { name: 'Current engineering interpretation' });
    expect(queue.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      source.compareDocumentPosition(decision) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(decision).getByText('No engineering property assigned')).toBeInTheDocument();
  });
  it('requires explicit competing source choice beside its wording and invalidates target/preview when binding changes', async () => {
    const controller = createDemoController(scenario('conflict'));
    const targets = vi.fn(controller.client.semanticTargets);
    const preview = vi.fn(controller.client.semanticPreview);
    show('conflict', 'Reviewer', { semanticTargets: targets, semanticPreview: preview });
    const source = within(screen.getByRole('complementary', { name: 'Manufacturer evidence' }));
    const boxes = source.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    outcome('map');
    expect(targets).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Choose at least one current source statement in manufacturer evidence.',
      }),
    );
    expect(boxes[0]).toHaveFocus();
    fireEvent.click(boxes[0]);
    await chooseOutput();
    await screen.findByText(/Normalized \/ converted value:/);
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    expect(screen.getByLabelText('Engineering property')).toHaveValue('');
    expect(screen.queryByText(/Normalized \/ converted value:/)).toBeNull();
    await waitFor(() =>
      expect(targets).toHaveBeenLastCalledWith(
        'conflict',
        scenario('conflict').items[0].id,
        expect.objectContaining({
          selected_fact_ids: [scenario('conflict').items[0].evidence[1].id],
        }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Save decision' })).toBeDisabled();
  });
  it.each(['scalar', 'measurement', 'layout'])(
    'searches all source values/labels and shows positive and empty match counts in %s',
    (id) => {
      show(id);
      const queue = within(screen.getByRole('complementary', { name: 'Review queue' }));
      const query =
        id === 'layout' ? 'Source specification 239 ' : id === 'measurement' ? '500 A' : '60 A';
      fireEvent.change(screen.getByLabelText('Find a specification'), { target: { value: query } });
      expect(queue.getByText(/specifications match/)).toHaveTextContent(/1 of/);
      const selection = screen.getByLabelText('Review decision');
      outcome('unresolved');
      fireEvent.change(screen.getByLabelText('Rationale (optional)'), {
        target: { value: 'Preserve draft through search' },
      });
      fireEvent.change(screen.getByLabelText('Find a specification'), {
        target: { value: 'no-such-source-qz' },
      });
      expect(queue.getByText(/No specifications match/)).toBeInTheDocument();
      expect(selection).toHaveValue('unresolved');
      expect(screen.getByLabelText('Rationale (optional)')).toHaveValue(
        'Preserve draft through search',
      );
      fireEvent.click(queue.getByRole('button', { name: 'Clear queue search' }));
      expect(queue.queryByText(/No specifications match/)).toBeNull();
    },
  );
  it('discovers reviewed unresolved status even when its group was collapsed', () => {
    show('recovery');
    fireEvent.change(screen.getByLabelText('Find a specification'), {
      target: { value: 'unresolved' },
    });
    const group = screen
      .getByText(/Reviewed but engineering meaning unresolved/)
      .closest('details')!;
    expect(group.open).toBe(true);
    expect(screen.getByText(/1 of 1 specifications match/)).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Current engineering interpretation' }),
    ).toHaveTextContent('revision 1');
    expect(
      screen.getByRole('button', { name: 'Review / correct interpretation' }),
    ).toBeInTheDocument();
  });
  it('shows provisional automatic interpretation separately from a durable reviewed map', () => {
    const controller = createDemoController(scenario('scalar'));
    const job = controller.current();
    const item = job.semantic_review!.work.required[0];
    item.automatic_disposition = 'mapped';
    item.automatic_value = 40;
    item.automatic_target = output;
    const { rerender } = render(
      <SemanticAdjudication
        job={job}
        client={controller.client}
        reviewer="Reviewer"
        onUpdate={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Current engineering interpretation' }),
    ).toHaveTextContent('Automatic suggestion');
    expect(
      screen.getByRole('region', { name: 'Current engineering interpretation' }),
    ).toHaveTextContent('no human mapping decision');
    const mapped = controller.current();
    const target = mapped.semantic_review!.work.required[0];
    target.target = output;
    target.value = 40;
    target.active_decision = {
      id: 'human-map',
      revision: 2,
      active: true,
      outcome: 'map',
      proposal_id: target.id,
      actor_label: 'Reviewer',
      recorded_at: '2026-10-10T00:00:00Z',
      selected_fact_ids: [target.evidence[0].id],
      target: output,
    };
    rerender(
      <SemanticAdjudication
        job={mapped}
        client={controller.client}
        reviewer="Reviewer"
        onUpdate={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Current engineering interpretation' }),
    ).toHaveTextContent('Human-reviewed mapping');
    expect(
      screen.getByRole('region', { name: 'Current engineering interpretation' }),
    ).toHaveTextContent('not currently represented');
  });
  it.each(['map', 'schema_gap', 'reject', 'not_applicable', 'unresolved', 'evidence_only'])(
    'derives readiness and rationale requirements for %s from the actual decision contract',
    async (decision) => {
      show();
      outcome(decision);
      const readiness = within(screen.getByRole('region', { name: 'Review readiness' }));
      const required = ['map', 'schema_gap', 'reject', 'not_applicable'].includes(decision);
      if (required)
        expect(
          readiness.getByRole('button', { name: 'Explain this decision before saving.' }),
        ).toBeInTheDocument();
      else {
        expect(screen.getByLabelText('Rationale (optional)')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save decision' })).toBeEnabled();
      }
      if (decision === 'map') {
        await chooseOutput();
        await screen.findByText(/Normalized \/ converted value:/);
        fireEvent.change(screen.getByLabelText('Rationale (required)'), {
          target: { value: 'Source directly supports this meaning' },
        });
        await waitFor(() =>
          expect(screen.getByRole('button', { name: 'Save decision' })).toBeEnabled(),
        );
      }
      if (decision === 'schema_gap')
        expect(
          readiness.getByRole('button', { name: 'Describe the possible missing concept.' }),
        ).toBeInTheDocument();
    },
  );
  it('links missing reviewer readiness to the compact product header and separates product authority controls', () => {
    const controller = createDemoController(scenario('scalar'));
    render(
      <ProductReview job={controller.current()} client={controller.client} onUpdate={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Enter your local reviewer label in the product header.',
      }),
    );
    expect(screen.getByLabelText('Reviewer label')).toHaveFocus();
    expect(screen.getByLabelText('Reviewer label').closest('.review-identity')).toBeInTheDocument();
    expect(
      screen
        .getByRole('button', { name: 'Reject product review' })
        .closest('.product-review-actions'),
    ).toBeInTheDocument();
  });
  it('shows requested-versus-source model mismatch before preview without changing server authority', async () => {
    show('sibling');
    expect(screen.getByRole('complementary', { name: 'Manufacturer evidence' })).toHaveTextContent(
      'requested DEMO-1; source names DEMO-2',
    );
    expect(
      screen.getByRole('region', { name: 'Current engineering interpretation' }),
    ).toHaveTextContent('Normalization cannot establish applicability');
    outcome('map');
    await chooseOutput();
    await screen.findByText(/Normalized \/ converted value:/);
    expect(screen.getByRole('complementary', { name: 'Manufacturer evidence' })).toHaveTextContent(
      'requested DEMO-1',
    );
    // Conversion may be valid while candidate projection still rejects exact-model scope.
  });
  it('distinguishes failed discovery from valid empty targets and never grants selection through browsing', async () => {
    show('scalar', 'Reviewer', {
      semanticTargets: vi.fn().mockRejectedValue(new Error('Discovery unavailable')),
    });
    outcome('map');
    await screen.findByText(/Target discovery failed/);
    expect(screen.getByRole('button', { name: 'Retry property discovery' })).toBeInTheDocument();
    expect(screen.getByLabelText('Engineering property')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Browse all engineering properties' }));
    expect(
      within(screen.getByRole('dialog')).queryByRole('button', {
        name: 'Select Continuous output current',
      }),
    ).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
describe('Shared authoritative property discovery', () => {
  it.each(['output amps', 'current', 'voltage', 'dimensions'])(
    'shows immediate text matches for %s without creating eligibility',
    (query) => {
      expect(searchPropertyConcepts(query, scenario('scalar').targets).length).toBeGreaterThan(0);
      expect(searchPropertyConcepts('unknown-qz-word', scenario('scalar').targets)).toEqual([]);
    },
  );
  it('includes real qualified and structured canonical concepts beyond the 34 direct targets', () => {
    expect(
      explorerConcepts.some(
        (entry) =>
          entry.path === 'electrical.output_current_a' && entry.representation === 'qualified',
      ),
    ).toBe(true);
    expect(
      explorerConcepts.some(
        (entry) => entry.path === 'measurement' && entry.representation === 'canonical',
      ),
    ).toBe(true);
    expect(explorerConcepts.some((entry) => entry.path === 'service_clearances_mm')).toBe(true);
    expect(explorerConcepts.some((entry) => entry.path === 'measurement.accuracy')).toBe(false);
  });
  it('synchronizes explorer search, preserves inline choice on cancel, and returns only an eligible exact property', () => {
    const change = vi.fn();
    render(
      <ReviewerPropertyPicker
        targets={scenario('scalar').targets}
        value=""
        loading={false}
        onChange={change}
      />,
    );
    fireEvent.change(screen.getByLabelText('Search engineering properties'), {
      target: { value: 'output amps' },
    });
    const trigger = screen.getByRole('button', { name: 'Browse all engineering properties' });
    fireEvent.click(trigger);
    const explorer = screen.getByRole('dialog', { name: 'Engineering property explorer' });
    expect(within(explorer).getByLabelText('Search full property catalog')).toHaveValue(
      'output amps',
    );
    expect(within(explorer).getAllByText(/Known qualified representation/).length).toBeGreaterThan(
      0,
    );
    expect(
      within(explorer).queryByRole('button', { name: /Select Output current · qualified/ }),
    ).toBeNull();
    fireEvent.click(within(explorer).getByRole('button', { name: 'Electrical output' }));
    fireEvent.click(within(explorer).getByRole('button', { name: 'Close explorer' }));
    expect(trigger).toHaveFocus();
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Search engineering properties')).toHaveValue('output amps');
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Select Continuous output current',
      }),
    );
    expect(change).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledWith(output);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
