import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, it, expect } from 'vitest';
import { AuthoredDraftView } from './AuthoredDraftView.js';
import type { OperatorJobDetail } from './api.js';
afterEach(cleanup);
it('shows source context, original units and explicit unreviewed authority without decision controls', () => {
  // Invented project-owned DTO tests presentation, not real manufacturer facts.
  const source = {
    id: 'synthetic',
    publisher: 'Test',
    content_digest: 'sha256:synthetic',
    document_revision: null,
    url: 'https://example.test/source',
  };
  const fact = {
    id: 'f',
    quantity: 'body_size',
    change: 'added',
    original: { value: '2', unit: 'in', presentation: 'source_literal' },
    normalized: { value: 50.8, unit: 'mm' },
    normalization: 'in_to_mm',
    basis: 'body',
    mode: 'all',
    direction: 'none',
    electrical_domain: 'none',
    source_id: 'synthetic',
    locator: 'Synthetic p1',
    context_digest: 'sha256:synthetic',
    conditions: [],
    unresolved_conditions: ['Orientation unknown'],
  };
  const job = {
    summary: { id: 'synthetic.job' },
    authored_drafts: [
      {
        proposal_digest: 'synthetic.digest',
        current_preparation: true,
        draft: {
          product: { model: 'Invented model' },
          intended_use: 'Synthetic review',
          sources: [source],
          holds: ['Human review'],
        },
        facts: [fact],
      },
    ],
  } as unknown as OperatorJobDetail;
  render(<AuthoredDraftView job={job} />);
  expect(screen.getByText(/Unreviewed proposals/)).toBeInTheDocument();
  expect(screen.getByText(/2 in/)).toHaveTextContent('50.8 mm');
  expect(screen.getByText(/Synthetic p1/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download exact private source' })).toHaveAttribute(
    'href',
    '/api/ingestion/jobs/synthetic.job/authored-source/synthetic.digest/synthetic',
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
