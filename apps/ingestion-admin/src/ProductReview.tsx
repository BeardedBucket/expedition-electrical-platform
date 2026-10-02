import { useState } from 'react';
import type { ProductionPromotionDecisions } from '@expedition/ingestion';
import type { HumanReviewInput, OperatorApi, OperatorJobDetail } from './api.js';
import { OperatorApiError } from './api.js';
import { SemanticAdjudication } from './SemanticAdjudication.js';
import { ReviewValue, SourceLink } from './ReviewValue.js';
export { ReviewValue, SourceLink } from './ReviewValue.js';

export function ProductReview({
  job,
  client,
  onUpdate,
}: {
  job: OperatorJobDetail;
  client: OperatorApi;
  onUpdate: (job: OperatorJobDetail) => void;
}) {
  const [reviewer, setReviewer] = useState('');
  const [category, setCategory] = useState('');
  const [role, setRole] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [qualifiedSelections, setQualifiedSelections] = useState<Record<string, boolean>>({});
  const [factDecisions, setFactDecisions] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<
    Record<string, { selected_fact_id: string; rationale: string }>
  >({});
  const [topology, setTopology] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState<{
    action: 'approve' | 'reject' | 'defer' | 'write';
    input?: HumanReviewInput;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const review = job.product_review;
  const editable = job.summary.state === 'review_ready';
  const approved = Object.keys(decisions).filter((field) => decisions[field] === 'approve');
  const approvedQualifiedIds = Object.keys(qualifiedSelections).filter(
    (id) => qualifiedSelections[id],
  );
  const canApprove =
    !!job.candidate?.present &&
    job.semantic_review?.complete !== false &&
    !review?.truncated &&
    !!reviewer.trim() &&
    !!category.trim() &&
    !!role &&
    acknowledged &&
    (approved.length > 0 || approvedQualifiedIds.length > 0);
  function confirm(action: 'approve' | 'reject' | 'defer') {
    const selections: ProductionPromotionDecisions = {
      approved_fields: approved,
      approved_qualified_value_ids: approvedQualifiedIds,
      excluded_fields: Object.keys(decisions).filter((field) => decisions[field] === 'exclude'),
      excluded_fact_ids: Object.keys(factDecisions).filter((id) => factDecisions[id] === 'exclude'),
      reviewed_evidence_fact_ids: Object.keys(factDecisions).filter(
        (id) => factDecisions[id] === 'reviewed',
      ),
      field_resolutions: Object.fromEntries(
        Object.entries(resolutions).filter(
          ([field, resolution]) => approved.includes(field) && !!resolution.selected_fact_id,
        ),
      ),
      topology_evidence: topology,
      evidence_acknowledged: acknowledged,
      product_role: role,
      category: category.trim(),
    };
    setError('');
    setPending({
      action,
      input: {
        reviewer_id: reviewer.trim(),
        ...(notes.trim() ? { reviewed_decisions: [notes.trim()] } : {}),
        ...(action === 'approve' ? { promotion_decisions: selections } : {}),
      },
    });
  }
  async function persist() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      onUpdate(
        pending.action === 'write'
          ? await client.finalize(job.summary.id)
          : await client.review(job.summary.id, pending.action, pending.input!),
      );
      setPending(undefined);
    } catch (caught) {
      if (caught instanceof OperatorApiError && caught.status === 409) {
        try {
          onUpdate(await client.get(job.summary.id));
          setError(
            caught.proposal_ids.length
              ? `Semantic review changed and is incomplete for: ${caught.proposal_ids.join(', ')}. Current job state was reloaded; review the listed proposals before approving.`
              : 'The review changed. Current job state was reloaded; inspect it before confirming another action.',
          );
        } catch {
          setError('The review changed. Reload the job before confirming another action.');
        }
      } else {
        setError(caught instanceof Error ? caught.message : 'Request failed.');
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Human product review</h2>
      <p>
        Compare each proposed field and qualified assertion with the authoritative source. Extracted
        claims remain provisional until you review them.
      </p>
      {job.candidate && !job.candidate.present && (
        <p>
          No promotable candidate was produced. Zero facts do not represent a successful empty
          product. Inspect preparation and source diagnostics below; reject or defer this job.
        </p>
      )}
      {review?.truncated && (
        <p role="alert">
          Review exceeds the browser display limits. Approval is unavailable here; complete evidence
          remains in the durable job.
        </p>
      )}
      <fieldset disabled={!editable || busy || !!pending}>
        {editable && (
          <>
            <label>
              Reviewer label
              <input
                value={reviewer}
                maxLength={200}
                onChange={(e) => setReviewer(e.target.value)}
              />
            </label>
            <p>This is an operator-entered label, not a verified or authenticated identity.</p>
          </>
        )}
        <SemanticAdjudication job={job} client={client} reviewer={reviewer} onUpdate={onUpdate} />
        {review?.qualified_values?.map((assertion) => (
          <article key={assertion.id}>
            <h3>Qualified assertion: {assertion.target}</h3>
            <p>ID: {assertion.id}</p>
            <div>
              Value: <ReviewValue value={assertion.value} />
            </div>
            <div>
              Qualifiers: <ReviewValue value={assertion.qualifiers} />
            </div>
            <div>
              Candidate supporting facts: <ReviewValue value={assertion.candidate_fact_ids} />
            </div>
            {assertion.proposals.map((proposal) => (
              <details className="source-evidence" key={proposal.id}>
                <summary>
                  Source evidence for proposal {proposal.id} · {proposal.disposition}
                </summary>
                <p>
                  Proposal: {proposal.id} · {proposal.disposition}
                </p>
                {proposal.evidence.map((fact) => (
                  <div key={fact.id}>
                    <SourceLink uri={fact.source_uri} />
                    <p>
                      {fact.document ?? 'Document title unavailable'} · {fact.label}
                    </p>
                    <ReviewValue value={fact.raw_value} />
                    <ReviewValue value={fact.locators} />
                    <p>
                      Supporting fact: {fact.id} · {fact.qualification}
                    </p>
                  </div>
                ))}
              </details>
            ))}
            <label>
              <input
                type="checkbox"
                checked={qualifiedSelections[assertion.id] ?? false}
                onChange={(event) =>
                  setQualifiedSelections({
                    ...qualifiedSelections,
                    [assertion.id]: event.target.checked,
                  })
                }
              />
              Approve qualified assertion {assertion.id}
            </label>
          </article>
        ))}
        {review?.fields.map((field) => (
          <article key={field.path}>
            <h3>Proposed field: {field.path}</h3>
            <p>
              Proposed canonical value: <ReviewValue value={field.value} />
            </p>
            {field.proposals.map((proposal) => (
              <details className="source-evidence" key={proposal.id}>
                <summary>
                  Source evidence for proposal {proposal.id} · {proposal.disposition}
                </summary>
                <p>
                  Proposal disposition: <strong>{proposal.disposition}</strong>
                  {!proposal.projected && ' · Excluded from candidate projection'}
                </p>
                <p>
                  Proposed value: <ReviewValue value={proposal.value} />
                </p>
                <h4>Source evidence</h4>
                {proposal.evidence.length === 0 && (
                  <p>No supporting qualified facts available. References remain unresolved.</p>
                )}
                {proposal.evidence.map((fact) => (
                  <div key={fact.id}>
                    <dl>
                      <dt>Source / document</dt>
                      <dd>
                        {fact.document ?? 'Document title unavailable'} ·{' '}
                        <SourceLink uri={fact.source_uri} />
                      </dd>
                      <dt>Source label</dt>
                      <dd>{fact.label ?? 'Unknown'}</dd>
                      <dt>Raw source value</dt>
                      <dd>
                        <ReviewValue value={fact.raw_value} />
                      </dd>
                      <dt>Unit</dt>
                      <dd>{fact.unit ?? 'Unknown'}</dd>
                      <dt>Applicability</dt>
                      <dd>
                        <ReviewValue value={fact.applicability} />
                      </dd>
                      <dt>Qualification</dt>
                      <dd>{fact.qualification ?? 'Unknown'}</dd>
                      <dt>Locator</dt>
                      <dd>
                        <ReviewValue value={fact.locators} />
                      </dd>
                      <dt>Supporting fact</dt>
                      <dd>{fact.id}</dd>
                    </dl>
                    {!!fact.conflicts.length && (
                      <div className="unresolved">
                        <strong>Unresolved evidence</strong>
                        <ReviewValue value={fact.conflicts} />
                      </div>
                    )}
                  </div>
                ))}
                <details>
                  <summary>Supporting references / proposal ID</summary>
                  <p>{proposal.id}</p>
                  <ReviewValue value={proposal.references} />
                </details>
              </details>
            ))}
            {field.selectable ? (
              <>
                <label>
                  Human decision for {field.path}
                  <select
                    value={decisions[field.path] ?? ''}
                    onChange={(e) => setDecisions({ ...decisions, [field.path]: e.target.value })}
                  >
                    <option value="">Not reviewed</option>
                    <option value="approve">Approve placement</option>
                    <option value="exclude">Exclude from promotion</option>
                  </select>
                </label>
                <details>
                  <summary>Optional field resolution for {field.path}</summary>
                  <label>
                    Selected supporting fact for {field.path}
                    <select
                      value={resolutions[field.path]?.selected_fact_id ?? ''}
                      onChange={(e) =>
                        setResolutions({
                          ...resolutions,
                          [field.path]: {
                            rationale: resolutions[field.path]?.rationale ?? '',
                            selected_fact_id: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="">Use all supporting evidence</option>
                      {field.candidate_fact_ids.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Resolution rationale for {field.path}
                    <textarea
                      value={resolutions[field.path]?.rationale ?? ''}
                      onChange={(e) =>
                        setResolutions({
                          ...resolutions,
                          [field.path]: {
                            selected_fact_id: resolutions[field.path]?.selected_fact_id ?? '',
                            rationale: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                </details>
              </>
            ) : (
              <p>Unresolved or non-projected proposal: placement approval is unavailable.</p>
            )}
          </article>
        ))}
        {!!review?.candidate_facts.length && (
          <details>
            <summary>Optional evidence-only and excluded fact selections</summary>
            {review.candidate_facts.map((fact) => (
              <label key={fact.id}>
                {fact.raw_label} · {fact.field} · {fact.id} ({fact.fact_state})
                <ReviewValue value={fact.raw_value} />
                <select
                  aria-label={`Evidence decision for ${fact.id}`}
                  value={factDecisions[fact.id] ?? ''}
                  onChange={(e) =>
                    setFactDecisions({ ...factDecisions, [fact.id]: e.target.value })
                  }
                >
                  <option value="">No additional fact decision</option>
                  <option value="reviewed">Reviewed as evidence only</option>
                  <option value="exclude">Exclude fact</option>
                </select>
              </label>
            ))}
          </details>
        )}
        {review?.topology_evidence && (
          <details>
            <summary>Topology supporting evidence</summary>
            {Object.entries(review.topology_evidence).map(([target, ids]) => (
              <div key={target}>
                <h4>{target}</h4>
                {ids.map((id) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={topology[target]?.includes(id) ?? false}
                      onChange={(e) =>
                        setTopology({
                          ...topology,
                          [target]: e.target.checked
                            ? [...(topology[target] ?? []), id]
                            : (topology[target] ?? []).filter((value) => value !== id),
                        })
                      }
                    />
                    {id}
                  </label>
                ))}
              </div>
            ))}
          </details>
        )}
        {editable && (
          <>
            {job.candidate?.present && (
              <>
                <label>
                  Product role
                  <select value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="">Choose product role</option>
                    {review?.roles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Category
                  <input
                    value={category}
                    maxLength={200}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </label>
                <p>Category is a human-entered name; the contract has no category enumeration.</p>
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  I reviewed the supporting source evidence for the fields and assertions I am
                  approving.
                </label>
              </>
            )}
            <label>
              Human review rationale (optional)
              <textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {job.candidate?.present && (
              <button disabled={!canApprove} onClick={() => confirm('approve')}>
                Approve selected assertions
              </button>
            )}
            <button disabled={!reviewer.trim()} onClick={() => confirm('reject')}>
              Reject product review
            </button>
            <button disabled={!reviewer.trim()} onClick={() => confirm('defer')}>
              Defer product review
            </button>
          </>
        )}
      </fieldset>
      {(!!job.review_package?.unresolved_items?.length ||
        !!job.review_package?.conflicts?.length) && (
        <div className="unresolved">
          <h3>Unresolved evidence / conflicts</h3>
          <ReviewValue value={job.review_package.unresolved_items} />
          <ReviewValue value={job.review_package.conflicts} />
        </div>
      )}
      {job.approval && (
        <article>
          <h3>Persisted human decision</h3>
          <dl>
            <dt>Decision</dt>
            <dd>{job.approval.decision}</dd>
            <dt>Reviewer label (operator entered)</dt>
            <dd>{job.approval.reviewer_label}</dd>
            <dt>Reviewed at</dt>
            <dd>{job.approval.reviewed_at}</dd>
          </dl>
          <ReviewValue value={job.approval.promotion_decisions} />
          <ReviewValue value={job.approval.reviewed_decisions} />
          <details>
            <summary>Exact source / review binding</summary>
            <ReviewValue value={job.approval.review_package} />
            <p>Review snapshot: {job.approval.review_package_snapshot}</p>
            <p>Semantic snapshot: {job.approval.semantic_snapshot}</p>
            <ReviewValue value={job.source_resolution?.accepted_reference} />
          </details>
          <p>The persisted decision is immutable for this job.</p>
        </article>
      )}
      {job.summary.state === 'approved' && (
        <article>
          <h3>Canonical write</h3>
          <p>
            Component: {review?.canonical_id ?? job.summary.product_model}. Destination:
            server-configured canonical component storage. Writes are create-only and collision
            protected.
          </p>
          <p>
            No canonical write has happened for this job. A reusable dry-run is unavailable:
            finalization is terminal even with write disabled.
          </p>
          <button disabled={busy || !!pending} onClick={() => setPending({ action: 'write' })}>
            Write canonical component
          </button>
        </article>
      )}
      {pending && (
        <div role="dialog" aria-label="Confirm operator decision" aria-modal="true">
          <h3>
            {pending.action === 'write'
              ? 'Confirm canonical write'
              : 'Confirm human review decision'}
          </h3>
          {pending.action === 'write' ? (
            <p>
              Write {review?.canonical_id} into server-configured canonical storage? This creates a
              new file only and never overwrites an existing component. Finalization ends this job,
              including blocked outcomes.
            </p>
          ) : (
            <>
              <p>
                {pending.action === 'approve'
                  ? 'Persist approval of the selected fields? No canonical write occurs with approval.'
                  : `${pending.action === 'reject' ? 'Reject' : 'Defer'} ends the current job. No canonical write occurs; this job cannot be reopened.`}
              </p>
              <ReviewValue value={pending.input} />
            </>
          )}
          <button disabled={busy} onClick={() => void persist()}>
            Confirm {pending.action === 'write' ? 'write' : pending.action}
          </button>
          <button disabled={busy} onClick={() => setPending(undefined)}>
            Cancel
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {job.finalization && (
        <article>
          <h3>Finalization outcome</h3>
          <p>Runtime state: {job.summary.state}</p>
          <p>
            Requested at: {job.finalization.requested_at}. Explicit write authorization:{' '}
            {String(job.finalization.write_authorized)}
          </p>
          <p>
            Promotion: {job.finalization.promotion_status ?? 'No result recorded'} · Canonical
            write: {job.finalization.write_status ?? 'No result recorded'}
          </p>
          {job.finalization.collision && (
            <p>Canonical path collision. No overwrite was performed.</p>
          )}
          <ReviewValue value={job.finalization.promotion_issues} />
          <ReviewValue value={job.finalization.write_issues} />
        </article>
      )}
      {['finalizing', 'finalization_failed'].includes(job.summary.state) && (
        <p>
          Finalization is {job.summary.state === 'finalizing' ? 'running or interrupted' : 'failed'}
          . Inspect local service diagnostics. The runtime does not support retry or recovery for
          this job.
        </p>
      )}
    </section>
  );
}
