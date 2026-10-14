import type { OperatorJobDetail } from './api.js';

/** Read-only proposals: rendering never saves a source decision or candidate. */
export function AuthoredDraftView({ job }: { job: OperatorJobDetail }) {
  return job.authored_drafts?.length ? (
    <section>
      <h2>Codex-prepared product drafts</h2>
      <p>
        Unreviewed proposals. These values have not replaced the pending candidate or recorded a
        human decision.
      </p>
      {job.authored_drafts.map((entry) => (
        <details key={entry.proposal_digest}>
          <summary>
            {entry.draft.product.model} — {entry.facts.length} proposed facts{' '}
            {entry.current_preparation
              ? '(current source preparation)'
              : '(historical source preparation)'}
          </summary>
          <p>Intended use: {entry.draft.intended_use}</p>
          <p>Proposal snapshot: {entry.proposal_digest}</p>
          <ul>
            {entry.draft.sources.map((source) => (
              <li key={source.id}>
                {source.publisher} · {source.id} · {source.content_digest} · document revision{' '}
                {source.document_revision ?? 'unknown'}{' '}
                <a
                  href={`/api/ingestion/jobs/${encodeURIComponent(job.summary.id)}/authored-source/${encodeURIComponent(entry.proposal_digest)}/${encodeURIComponent(source.id)}`}
                >
                  Download exact private source
                </a>{' '}
                <a href={source.url} target="_blank" rel="noreferrer">
                  Publisher locator (may have changed)
                </a>
              </li>
            ))}
          </ul>
          {entry.facts.map((f) => (
            <article key={f.id}>
              <h3>
                {f.quantity} · {f.change}
              </h3>
              <p>
                Source value ({f.original.presentation}): {f.original.value} {f.original.unit} ·
                normalized: {JSON.stringify(f.normalized.value)} {f.normalized.unit} (
                {f.normalization})
              </p>
              <p>
                {f.basis} · {f.mode} · {f.direction} · {f.electrical_domain}
              </p>
              <p>
                Source: {f.source_id} · {f.locator} · complete-context hash {f.context_digest}
              </p>
              <p>
                Applicable conditions: {JSON.stringify(f.conditions)}. Unresolved:{' '}
                {f.unresolved_conditions.join('; ') ||
                  'none declared by author; human context review still required'}
              </p>
            </article>
          ))}
          <p>Withheld requirements: {entry.draft.holds.join('; ')}</p>
        </details>
      ))}
    </section>
  ) : null;
}
