import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceEvidenceNavigator } from './SourceEvidenceNavigator.js';
import { api, OperatorApiError } from './api.js';
afterEach(cleanup);
function show(count = 2, failure = false) {
  const client = {
    ...api,
    humanEvidence: vi.fn().mockImplementation(async (_id, request) => {
      if (failure) throw new OperatorApiError(400, 'Retained document unavailable.');
      const entries = Array.from({ length: count }, (_, i) => ({
        document_id: 'document',
        block_id: `block.${i}`,
        text: i ? `Other retained passage ${i}` : 'Example Model current 500 mA at 25°C',
        kind: 'paragraph' as const,
        locator: { kind: 'html' as const, section: 'Example Model' },
      }));
      const filtered = entries.filter((entry) =>
        entry.text.toLowerCase().includes(request.query.toLowerCase()),
      );
      return {
        document_id: 'document',
        document_total: count,
        total: filtered.length,
        offset: 0,
        entries: filtered,
      };
    }),
  };
  const onUse = vi.fn();
  render(
    <SourceEvidenceNavigator
      jobId="job"
      snapshot="snapshot"
      client={client}
      documents={[{ id: 'document', title: 'Retained specifications' }]}
      disabled={false}
      onUse={onUse}
      onStale={vi.fn()}
    />,
  );
  return { client, onUse };
}
describe('retained source navigator', () => {
  it('searches the selected document and shows positive and empty source-specific results', async () => {
    const { client } = show();
    await screen.findByText(/2 source matches/);
    fireEvent.change(screen.getByLabelText('Search source evidence'), {
      target: { value: '500 mA' },
    });
    await screen.findByText(/1 source match/);
    expect(client.humanEvidence).toHaveBeenLastCalledWith(
      'job',
      expect.objectContaining({ document_id: 'document', offset: 0, query: '500 mA' }),
    );
    fireEvent.change(screen.getByLabelText('Search source evidence'), {
      target: { value: 'no such text' },
    });
    await screen.findByText(/No retained passages match/);
    expect(screen.queryByRole('button', { name: /Example Model current/ })).not.toBeInTheDocument();
  });
  it('requires explicit roles and does not confer model authority from passage selection', async () => {
    const { onUse } = show();
    fireEvent.click(await screen.findByRole('button', { name: /Example Model current/ }));
    expect(screen.getByRole('button', { name: 'Use selected evidence' })).toBeDisabled();
    expect(onUse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Value or original statement'));
    fireEvent.click(screen.getByLabelText('Model or part-number relationship'));
    fireEvent.click(screen.getByRole('button', { name: 'Use selected evidence' }));
    expect(onUse).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Example Model current 500 mA at 25°C' }),
      ['statement', 'model'],
    );
  });
  it('uses a compact inline list but exposes all matches in the full browser', async () => {
    show(35);
    await screen.findByText(/35 source matches/);
    expect(
      within(screen.getByRole('list', { name: 'Source evidence results' })).getAllByRole('button'),
    ).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Browse source evidence' }));
    expect(
      within(screen.getByRole('dialog')).getAllByRole('button', {
        name: /Original retained source/,
      }),
    ).toHaveLength(35);
  });
  it('preserves query, selected passage and claimed roles on close and restores trigger focus', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Example Model current/ }));
    fireEvent.click(screen.getByLabelText('Applicable condition'));
    const trigger = screen.getByRole('button', { name: 'Browse source evidence' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Search all source evidence'), {
      target: { value: '500' },
    });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByLabelText('Search source evidence')).toHaveValue('500');
    expect(screen.getByLabelText('Applicable condition')).toBeChecked();
  });
  it('shows actual search failure and an explicit retry', async () => {
    const { client } = show(2, true);
    await screen.findByText('Retained document unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry source search' }));
    await waitFor(() => expect(client.humanEvidence).toHaveBeenCalledTimes(2));
  });
});
