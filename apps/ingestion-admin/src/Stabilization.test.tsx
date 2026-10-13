import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ReviewValue } from './ReviewValue.js';
import { ReviewDemo } from '../demo/ReviewDemo.js';
import { ReviewHelp } from './ReviewHelp.js';
import { SemanticAdjudication } from './SemanticAdjudication.js';
import { createDemoController, demoScenarios } from '../demo/scenarios.js';

afterEach(cleanup);
describe('Stabilized review presentation', () => {
  it('keeps nested exact technical values in full-width entries with local scrolling', () => {
    const path = '/' + 'table[100]/tr[200]/td[300]/'.repeat(20);
    render(
      <ReviewValue
        value={{ locator: { kind: 'html', path }, digest: 'sha256:' + 'd'.repeat(64) }}
      />,
    );
    for (const list of document.querySelectorAll('dl.review-value-object')) {
      expect([...list.children].every((entry) => ['DT', 'DD'].includes(entry.tagName))).toBe(true);
    }
    expect(screen.getByText(path)).toHaveClass('review-value-text');
    expect(screen.getByText(path)).toHaveAttribute('tabindex', '0');
    const css = readFileSync('apps/ingestion-admin/src/styles.css', 'utf8');
    expect(css).toMatch(/\.review-value-object\s*{\s*display: block/);
    expect(css).toMatch(/overflow-x: auto;\s*white-space: pre-wrap;\s*overflow-wrap: normal/);
    expect(css).toContain('@container (min-width: 48rem)');
    expect(css).not.toContain('word-break: break-all');
    // Structural/CSS checks do not claim browser measurements at any viewport.
  });
  it('toggles shared help explicitly and supports Escape, Close and leaving focus', () => {
    render(
      <>
        <ReviewHelp topic="Decision meaning">
          Keep original evidence; saving does not approve a component.
        </ReviewHelp>
        <button>Outside</button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Help: Decision meaning' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.focus(trigger);
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('note')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }));
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.focus(trigger);
    fireEvent.blur(trigger, { relatedTarget: screen.getByRole('button', { name: 'Outside' }) });
    expect(screen.queryByRole('note')).toBeNull();
  });
  it('renders a 240-item queue with one editor, one evidence panel and lazy advanced cards', () => {
    const controller = createDemoController(
      demoScenarios.find((scenario) => scenario.id === 'layout')!,
    );
    render(
      <SemanticAdjudication
        job={controller.current()}
        client={controller.client}
        reviewer="Synthetic reviewer"
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText('Review decision')).toHaveLength(1);
    expect(screen.getAllByRole('complementary', { name: 'Manufacturer evidence' })).toHaveLength(1);
    expect(document.querySelectorAll('article')).toHaveLength(0);
    expect(
      within(screen.getByRole('navigation', { name: 'Specification work queue' })).getAllByRole(
        'button',
      ),
    ).toHaveLength(240);
    fireEvent.change(screen.getByLabelText('Find a specification'), {
      target: { value: 'Source specification 239 ' },
    });
    expect(
      within(screen.getByRole('navigation', { name: 'Specification work queue' })).getAllByRole(
        'button',
      ),
    ).toHaveLength(1);
    const locations = screen
      .getByText('Source locations and exact evidence identifiers')
      .closest('details')!;
    expect(locations.open).toBe(false);
    locations.open = true;
    fireEvent(locations, new Event('toggle'));
    expect(within(locations).getByText(/table\[100\]/)).toHaveClass('review-value-text');
  });
  it('explains decisions in ordinary language and keeps the authority boundary visible', () => {
    const controller = createDemoController(demoScenarios[0]);
    render(
      <SemanticAdjudication
        job={controller.current()}
        client={controller.client}
        reviewer="Reviewer"
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText(/does not approve, publish or engineering-verify/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'unresolved' } });
    expect(
      screen.getByText(/cannot safely establish its meaning, conditions or model applicability/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Review decision'), {
      target: { value: 'not_applicable' },
    });
    expect(screen.getByText(/valid for a sibling model/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'reject' } });
    expect(screen.getByText(/extracted interpretation is wrong or unreliable/)).toBeInTheDocument();
  });
});
describe('Isolated representative demonstration', () => {
  it('covers 15 distinct risks, preserves source fixtures and denies authority operations', async () => {
    expect(demoScenarios).toHaveLength(15);
    const before = JSON.stringify(demoScenarios);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const scenario of demoScenarios) {
      const controller = createDemoController(scenario);
      const job = controller.current();
      const selected = [
        ...job.semantic_review!.work.required,
        ...job.semantic_review!.work.reviewed,
      ][0];
      await controller.client.semanticDecision(scenario.id, {
        proposal_id: selected.id,
        expected_review_snapshot: job.semantic_review!.expected_review_snapshot,
        selected_fact_ids: selected.evidence.map((fact) => fact.id),
        actor_label: 'Synthetic reviewer',
        outcome: 'unresolved',
      });
      for (const action of ['review', 'finalize', 'prepare', 'reopenPreparation']) {
        const commands = controller.client as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >;
        await expect(commands[action](scenario.id)).rejects.toThrow(
          'Unavailable in the isolated synthetic lab',
        );
      }
    }
    expect(JSON.stringify(demoScenarios)).toBe(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it('refuses conditioned/ambiguous fixtures and preserves an explicit 500 A shunt basis', async () => {
    for (const id of ['duration', 'table', 'layout']) {
      const scenario = demoScenarios.find((scenario) => scenario.id === id)!;
      const controller = createDemoController(scenario);
      const job = controller.current();
      const selected = job.semantic_review!.work.required[id === 'duration' ? 1 : 0];
      await expect(
        controller.client.semanticPreview(id, selected.id, {
          expected_review_snapshot: job.semantic_review!.expected_review_snapshot,
          selected_fact_ids: selected.evidence.map((fact) => fact.id),
          target: 'electrical.continuous_output_current_a',
        }),
      ).rejects.toThrow(/conditions or uncertain applicability/);
    }
    const measurement = demoScenarios.find((scenario) => scenario.id === 'measurement')!;
    expect(JSON.stringify(measurement.items)).toContain('500 A shunt');
    expect(measurement.targets).toHaveLength(0);
  });
  it('shows exact evidence and scripted conversion independently of sibling candidate applicability', async () => {
    for (const id of ['conversion', 'sibling']) {
      const scenario = demoScenarios.find((scenario) => scenario.id === id)!;
      const controller = createDemoController(scenario);
      const job = controller.current();
      const selected = job.semantic_review!.work.required[0];
      const preview = await controller.client.semanticPreview(id, selected.id, {
        expected_review_snapshot: job.semantic_review!.expected_review_snapshot,
        selected_fact_ids: selected.evidence.map((fact) => fact.id),
        target: scenario.targets[0].canonical_field,
      });
      expect(preview.source_assertions[0].raw_value).toBe(selected.evidence[0].raw_value);
      expect(preview.normalized_value).toBe(id === 'conversion' ? 292.1 : 80);
    }
  });
  it('retains current history after failed save and failed stale reload without replay', async () => {
    const controller = createDemoController(
      demoScenarios.find((scenario) => scenario.id === 'recovery')!,
    );
    const job = controller.current();
    const selected = job.semantic_review!.work.reviewed[0];
    const intent = {
      proposal_id: selected.id,
      expected_review_snapshot: job.semantic_review!.expected_review_snapshot,
      selected_fact_ids: selected.evidence.map((fact) => fact.id),
      actor_label: 'Synthetic reviewer',
      outcome: 'unresolved' as const,
      rationale: 'Keep my input.',
    };
    controller.failNext('save');
    await expect(controller.client.semanticDecision('recovery', intent)).rejects.toThrow(
      'Synthetic save failed',
    );
    expect(controller.current().semantic_review!.work.reviewed[0].decision_history).toHaveLength(1);
    controller.failNext('reload');
    await expect(controller.client.semanticDecision('recovery', intent)).rejects.toThrow(
      'Synthetic concurrent',
    );
    await expect(controller.client.get('recovery')).rejects.toThrow('Synthetic reload failed');
    const current = await controller.client.get('recovery');
    expect(current.semantic_review!.work.reviewed[0].decision_history).toHaveLength(1);
    const saved = await controller.client.semanticDecision('recovery', {
      ...intent,
      expected_review_snapshot: current.semantic_review!.expected_review_snapshot,
    });
    expect(saved.semantic_review!.work.reviewed[0].decision_history).toHaveLength(2);
    expect(saved.semantic_review!.work.reviewed[0].decision_history[0].active).toBe(false);
  });
});

it('opens a different synthetic scenario explicitly without a blocking native dialog', () => {
  const confirm = vi.spyOn(window, 'confirm');
  render(<ReviewDemo />);
  fireEvent.change(screen.getByLabelText('Reviewer label'), {
    target: { value: 'Unsaved synthetic label' },
  });
  fireEvent.change(screen.getByLabelText('Review scenario'), { target: { value: '3' } });
  expect(
    screen.getByRole('heading', { name: 'Review: Continuous output current' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open selected scenario' }));
  expect(
    screen.getByRole('heading', { name: 'Review: Current measurement accuracy' }),
  ).toBeInTheDocument();
  expect(screen.getAllByText('500 A shunt basis; resolution 0.1 A')[0]).toBeVisible();
  expect(screen.getByLabelText('Reviewer label')).toHaveValue('');
  expect(confirm).not.toHaveBeenCalled();
  confirm.mockRestore();
});
