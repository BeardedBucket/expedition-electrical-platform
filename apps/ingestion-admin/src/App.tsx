import { useEffect, useState, type FormEvent } from 'react';
import { ProductReview, SourceLink } from './ProductReview.js';
import {
  api,
  type IntakeInput,
  type OperatorApi,
  type OperatorJobDetail,
  type OperatorJobSummary,
} from './api.js';
import { BatchCreate, BatchList, BatchPage } from './BatchWorkflow.js';

const display = (value: unknown): string =>
  value === undefined
    ? 'Unknown / not available'
    : typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : String(value);
const message = (error: unknown): string =>
  error instanceof Error ? error.message : 'Request failed.';
function Values({ value }: { value: unknown }) {
  return <pre>{display(value)}</pre>;
}
function Table({
  rows,
  columns,
}: {
  rows: readonly object[];
  columns: readonly [string, string][];
}) {
  if (!rows.length) return <p className="empty">No rows were produced.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map(([key, label]) => (
              <th key={key}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map(([key]) => (
                <td key={key}>
                  {key === 'uri' ? (
                    <SourceLink uri={(row as Record<string, string>)[key]} />
                  ) : (
                    display((row as Record<string, unknown>)[key])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
type ReviewSection = 'overview' | 'unresolved' | 'evidence' | 'sources' | 'diagnostics';
export function Review({
  job,
  section = 'overview',
}: {
  job: OperatorJobDetail;
  section?: ReviewSection;
}) {
  const { summary: s } = job;
  const pipeline = job.pipeline_summary;
  const reviewable = job.product_review?.fields.filter((field) => field.selectable) ?? [];
  const qualified = job.product_review?.qualified_values ?? [];
  return (
    <>
      {section === 'overview' && (
        <section>
          <div className="eyebrow">Job {s.id}</div>
          <h1>{s.product_model}</h1>
          <p className={`state state-${s.state}`}>{s.state}</p>
          {s.state === 'preparing' && (
            <p role="status">
              Preparation is running. Acquiring, extracting, and qualifying official evidence can
              take several minutes.
            </p>
          )}
          {s.state === 'source_resolution_required' && (
            <p>
              Official source resolution is required before preparation. This job preserves your
              original request. Propose an official manufacturer URL for source identity review.
            </p>
          )}
          {s.state === 'created' && (
            <p>Job created. Preparation has not yet been persisted as running.</p>
          )}
          {s.state === 'preparation_failed' && (
            <p>Preparation failed. Inspect the diagnostics below.</p>
          )}
          <h2>Overview</h2>
          <dl>
            <dt>Manufacturer</dt>
            <dd>{s.manufacturer}</dd>
            <dt>MPN</dt>
            <dd>{s.manufacturer_part_number ?? 'Not supplied'}</dd>
            <dt>{s.official_product_uri ? 'Official product URL' : 'Original product URL'}</dt>
            <dd>{s.official_product_uri ?? 'Not supplied'}</dd>
            {!s.official_product_uri && job.source_resolution?.accepted_uri && (
              <>
                <dt>Resolved official source</dt>
                <dd>
                  <a
                    href={job.source_resolution.accepted_uri}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {job.source_resolution.accepted_uri}
                  </a>
                </dd>
              </>
            )}
            <dt>Created</dt>
            <dd>{s.created_at}</dd>
            <dt>Updated</dt>
            <dd>{s.updated_at}</dd>
            <dt>Facts</dt>
            <dd>{display(s.fact_count)}</dd>
            <dt>Proposals</dt>
            <dd>{display(s.proposal_count)}</dd>
            <dt>Candidate present</dt>
            <dd>{display(s.candidate_present)}</dd>
            <dt>Conflicts / unresolved</dt>
            <dd>
              {display(s.conflict_count)} / {display(s.unresolved_count)}
            </dd>
            {s.write_status !== undefined && (
              <>
                <dt>Write status</dt>
                <dd>{s.write_status}</dd>
                <dt>Final result</dt>
                <dd>{display(s.final_result_status)}</dd>
              </>
            )}
          </dl>
          {s.state === 'review_ready' && (
            <p>Preparation is ready for human review. Evidence and proposals remain provisional.</p>
          )}
          <h2>Pipeline health</h2>
          {pipeline ? (
            <div className="pipeline-grid">
              <p>
                <strong>Acquisition</strong>
                <br />
                {job.acquisition?.status ?? 'Unknown'}
                <br />
                {pipeline.capture_dispositions.authoritative} authoritative ·{' '}
                {pipeline.capture_dispositions.non_authoritative} non-authoritative ·{' '}
                {pipeline.capture_dispositions.failed} failed ·{' '}
                {pipeline.capture_dispositions.empty} empty
              </p>
              <p>
                <strong>Extraction</strong>
                <br />
                {pipeline.extraction_results} results · {pipeline.extracted_observations} retained
                blocks
              </p>
              <p>
                <strong>Qualified facts</strong>
                <br />
                {pipeline.qualified_facts}
              </p>
              <p>
                <strong>Reconciliation</strong>
                <br />
                {display(pipeline.reconciliation_groups)} groups
                <br />
                {display(pipeline.reconciliation_dispositions)}
              </p>
              <p>
                <strong>Semantic proposals</strong>
                <br />
                {display(pipeline.semantic_proposals)}
                <br />
                {display(pipeline.proposal_dispositions)}
              </p>
              <p>
                <strong>Candidate projection</strong>
                <br />
                {display(pipeline.projected_fields)} fields · {display(pipeline.qualified_values)}{' '}
                qualified values
              </p>
            </div>
          ) : (
            <p>Preparation has not produced pipeline artifacts.</p>
          )}
          {pipeline?.capture_dispositions.failed ? (
            <p role="status">
              {pipeline.capture_dispositions.authoritative
                ? 'Some sources failed. Check Sources for their identities; retained authoritative evidence remains available for review.'
                : 'Source capture failed and no authoritative capture was retained. Check Sources and Diagnostics.'}
            </p>
          ) : null}
          <h2>Human review</h2>
          <p>
            {job.product_review ? reviewable.length : 'Unknown'} ordinary fields and{' '}
            {job.product_review ? qualified.length : 'Unknown'} qualified assertions are selectable
            for human review. {display(job.review_package?.unresolved_count)} review package items
            remain unresolved.
          </p>
          {reviewable.length || qualified.length ? (
            <ul>
              {reviewable.map((field) => (
                <li key={field.path}>
                  {field.path}: {display(field.value)}
                  {field.canonical_unit ? ` ${field.canonical_unit}` : ''}
                </li>
              ))}
              {qualified.map((assertion) => (
                <li key={assertion.id}>
                  {assertion.target}: {display(assertion.value)} ({assertion.id})
                </li>
              ))}
            </ul>
          ) : s.state === 'review_ready' ? (
            <p className="empty">
              No promotable fields are currently available. Inspect Unresolved and Evidence to
              locate the stage where evidence stopped.
            </p>
          ) : null}
          {pipeline?.qualified_facts &&
          pipeline.semantic_proposals &&
          !pipeline.projected_fields ? (
            <p>
              Facts were recovered, but no fields reached candidate projection. Inspect proposal
              dispositions and non-projected reasons in Unresolved.
            </p>
          ) : null}
          <h2>Next action</h2>
          <p>
            {s.state === 'created'
              ? 'Start preparation.'
              : s.state === 'review_ready'
                ? reviewable.length || qualified.length
                  ? 'Inspect source evidence, then make an explicit human decision in Reviewable fields.'
                  : 'Inspect unresolved evidence; defer or reject the review if it cannot be resolved.'
                : s.state === 'approved'
                  ? 'A separate confirmed finalization action is available in Reviewable fields.'
                  : s.state === 'review_deferred'
                    ? 'Product review is paused. Explicitly resume it in Reviewable fields when ready; no automatic re-preparation occurs.'
                    : s.state === 'preparation_failed'
                      ? 'Inspect Diagnostics and Sources. This failed preparation is not eligible for approval.'
                      : s.state === 'source_resolution_required'
                        ? 'Provide an official source candidate.'
                        : 'Inspect the current job state and diagnostics.'}
          </p>
        </section>
      )}
      {section === 'sources' && (
        <section>
          <h2>Sources</h2>
          {job.acquisition ? (
            <>
              <Values value={job.acquisition} />
              <p>
                Captured count includes the intake seed. Duplicate and excluded sources can remain
                not_attempted.
              </p>
            </>
          ) : (
            <p>Acquisition is not available yet.</p>
          )}
          {job.sources && (
            <Table
              rows={job.sources}
              columns={[
                ['role', 'Role'],
                ['label', 'Label'],
                ['uri', 'URI'],
                ['officiality', 'Officiality'],
                ['selection', 'Selection'],
                ['capture_outcome', 'Capture'],
                ['capture_disposition', 'Disposition'],
                ['media_type', 'Media type'],
                ['parent_uri', 'Parent'],
                ['duplicate_of', 'Duplicate of'],
                ['equivalent_content_of', 'Equivalent content'],
                ['reason_codes', 'Reason codes'],
              ]}
            />
          )}
        </section>
      )}
      {section === 'evidence' && (
        <>
          <section>
            <h2>Extraction</h2>
            <p>
              Not captured sources have no extraction. Captured sources may be unsupported or have
              no extractable content; extraction and qualification are separate outcomes.
            </p>
            {job.extractions === undefined ? (
              <p>Extraction is not available yet.</p>
            ) : job.extractions.length === 0 ? (
              <p>No extraction results were produced.</p>
            ) : (
              job.extractions.map((e) => (
                <article key={e.id}>
                  <h3>{e.id}</h3>
                  <p>
                    Extraction: <strong>{e.status}</strong> · Capability: {e.capability} ·
                    Remediation: {e.remediation}
                  </p>
                  <p>
                    Pages: {display(e.page_count)} · Blocks: {e.block_count} · Tables:{' '}
                    {e.table_count}
                  </p>
                  <details>
                    <summary>Source / capture identity</summary>
                    <Values value={e.source_capture} />
                    <p>Candidate: {display(e.acquisition_candidate_id)}</p>
                  </details>
                  {e.diagnostics && <Values value={e.diagnostics} />}
                  <h4>Qualification</h4>
                  {e.qualification ? (
                    <>
                      <p>
                        <strong>{e.qualification.status}</strong> · {e.qualification.completeness} ·{' '}
                        {e.qualification.fact_count} facts
                      </p>
                      <Values value={e.qualification.diagnostics} />
                    </>
                  ) : (
                    <p>Qualification is not available.</p>
                  )}
                </article>
              ))
            )}
          </section>
          <section>
            <h2>Qualified Evidence</h2>
            {job.facts ? (
              <>
                <p>
                  {job.facts.length} facts. Qualification preserves source wording, units,
                  applicability, and uncertainty.
                </p>
                <Table
                  rows={job.facts}
                  columns={[
                    ['id', 'Fact ID'],
                    ['source_label', 'Source label'],
                    ['raw_value', 'Raw value'],
                    ['source_unit', 'Source unit'],
                    ['applicability', 'Applicability'],
                    ['qualification_state', 'Qualification state'],
                    ['source_reference', 'Source reference'],
                  ]}
                />
              </>
            ) : (
              <p>Qualified evidence is not available yet.</p>
            )}
          </section>
          <section>
            <h2>Reconciliation / Proposals</h2>
            {job.reconciliation ? (
              <>
                <p>
                  {job.reconciliation.agreement_count} agreement groups ·{' '}
                  {job.reconciliation.conflict_count} conflict groups ·{' '}
                  {job.reconciliation.unresolved_count} unresolved groups
                </p>
                <Values value={job.reconciliation} />
              </>
            ) : (
              <p>Reconciliation is not available.</p>
            )}
            {job.proposals && (
              <>
                <p>{job.proposals.length} semantic proposals</p>
                <Table
                  rows={job.proposals}
                  columns={[
                    ['id', 'Proposal ID'],
                    ['target', 'Target'],
                    ['disposition', 'Disposition'],
                    ['value_origin', 'Value treatment'],
                    ['proposed_value', 'Canonical value'],
                    ['canonical_unit', 'Canonical unit'],
                    ['evidence_refs', 'Evidence references'],
                    ['fact_refs', 'Fact references'],
                  ]}
                />
              </>
            )}
          </section>
          <section>
            <h2>Candidate</h2>
            {job.candidate === undefined ? (
              <p>Candidate projection is not available yet.</p>
            ) : (
              <>
                {job.candidate.present ? (
                  <>
                    <h3>Projected canonical fields</h3>
                    <p>
                      These are candidate canonical values, not verbatim source assertions. For
                      measurements, compare them with the SOURCE-STATED assertion and its NORMALIZED
                      / CONVERTED canonical-unit value in Human product review. Simple unit
                      conversions are not calculated / derived facts.
                    </p>
                    <Values value={job.candidate.projected_fields} />
                    <h3>Field evidence</h3>
                    <Values value={job.candidate.field_evidence} />
                  </>
                ) : (
                  <p className="empty">
                    No product candidate was produced from the currently qualified evidence.
                  </p>
                )}
                <h3>Non-projected diagnostics</h3>
                <Values value={job.candidate.non_projected} />
              </>
            )}
          </section>
          <section>
            <h2>Review Package</h2>
            {job.review_package ? (
              <Values value={job.review_package} />
            ) : (
              <p>No review package is available yet.</p>
            )}
          </section>
        </>
      )}
      {section === 'unresolved' && (
        <section>
          <h2>Unresolved and unsupported</h2>
          <p>
            These dispositions and reasons come from persisted preparation artifacts. Unknown values
            remain unknown; unsupported proposals are not eligible for projection.
          </p>
          {job.proposals?.filter((proposal) => proposal.disposition !== 'mapped').length ? (
            <Table
              rows={job.proposals.filter((proposal) => proposal.disposition !== 'mapped')}
              columns={[
                ['id', 'Proposal ID'],
                ['target', 'Target'],
                ['disposition', 'Disposition'],
                ['value_origin', 'Value treatment'],
                ['proposed_value', 'Canonical value'],
                ['canonical_unit', 'Canonical unit'],
                ['fact_refs', 'Fact references'],
              ]}
            />
          ) : (
            <p>No unresolved or unsupported semantic proposals are recorded.</p>
          )}
          <h3>Candidate projection reasons</h3>
          <Values value={job.candidate?.non_projected} />
          <h3>Review package unresolved items and conflicts</h3>
          <Values value={job.review_package?.unresolved_items} />
          <Values value={job.review_package?.conflicts} />
        </section>
      )}
      {section === 'diagnostics' && (
        <section>
          <h2>Diagnostics</h2>
          {job.diagnostics.length ? (
            <Values value={job.diagnostics} />
          ) : (
            <p>No terminal runtime diagnostics recorded.</p>
          )}
        </section>
      )}
    </>
  );
}
export function SourceResolution({
  job,
  client,
  onUpdate,
}: {
  job: OperatorJobDetail;
  client: OperatorApi;
  onUpdate: (job: OperatorJobDetail) => void;
}) {
  const [uri, setUri] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const section = job.source_resolution;
  if (!section) return null;
  async function run(action: () => Promise<OperatorJobDetail>) {
    setBusy(true);
    setError('');
    try {
      onUpdate(await action());
      setUri('');
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Official source required</h2>
      <p>
        Source identity review is separate from capture success. Accepting confirms which product
        you intended; product specifications require a separate later review.
      </p>
      <h3>Requested product</h3>
      <Values value={section.requested_identity} />
      <p>The original intake remains unchanged and has no official product URL.</p>
      {section.recovery?.can_reopen && (
        <section aria-label="Source-selection recovery">
          <h3>Acquisition failed for the accepted source</h3>
          <p>
            The accepted source decision remains in history. Choosing another source does not reject
            that decision. A new URI must be captured and accepted separately, and acquisition must
            succeed before extraction.
          </p>
          <dl>
            <dt>Accepted source</dt>
            <dd>Accepted</dd>
            <dt>Selected URI</dt>
            <dd>{section.accepted_uri ?? 'Unknown / not available'}</dd>
            <dt>Acquisition</dt>
            <dd>
              Failed
              {section.recovery.acquisition_response_status
                ? ` — HTTP ${section.recovery.acquisition_response_status}`
                : ` — ${section.recovery.acquisition_status ?? 'unknown'}`}
            </dd>
            <dt>Preparation</dt>
            <dd>Failed at acquisition</dd>
          </dl>
          <button
            disabled={busy}
            onClick={() => void run(() => client.reopenSourceSelection(job.summary.id))}
          >
            Choose another official source
          </button>
        </section>
      )}
      {!!section.recovery_history?.length && (
        <section aria-label="Previous source-selection recoveries">
          <h3>Previous acquisition failures retained in history</h3>
          {section.recovery_history.map((recovery, index) => (
            <article key={`${recovery.requested_at}-${index}`}>
              <p>Source-selection recovery recorded at {recovery.requested_at}.</p>
              <p>Previous accepted source: {recovery.previous_source_uri ?? 'Unknown'}</p>
              <p>
                Preparation: {recovery.preparation_status} / {recovery.preparation_reason}
              </p>
              <p>
                Acquisition: {recovery.acquisition_status}; seed capture{' '}
                {recovery.seed_capture_disposition}
                {recovery.seed_response_status ? ` (HTTP ${recovery.seed_response_status})` : ''}
              </p>
              <p>{recovery.acquisition_issues.join('; ')}</p>
            </article>
          ))}
        </section>
      )}
      {job.summary.state === 'source_resolution_required' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => client.submitSourceCandidate(job.summary.id, uri));
          }}
        >
          <label>
            Candidate official manufacturer URL
            <input
              type="url"
              required
              maxLength={4096}
              value={uri}
              onChange={(event) => setUri(event.target.value)}
            />
          </label>
          <button disabled={busy} type="submit">
            {busy ? 'Capturing candidate…' : 'Submit source candidate'}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {section.history_truncated && (
        <p>
          Showing the latest 50 of {section.attempt_count} attempts. Complete history remains in the
          durable job.
        </p>
      )}
      {section.attempts.map((attempt) => (
        <article key={attempt.attempt_id}>
          <h3>
            {attempt.disposition === 'accepted' ? 'Accepted resolved source' : 'Candidate source'}
          </h3>
          <p>Disposition: {attempt.disposition}</p>
          <dl>
            <dt>Candidate URL</dt>
            <dd>
              <a href={attempt.candidate_uri} target="_blank" rel="noopener noreferrer">
                {attempt.candidate_uri}
              </a>
            </dd>
            <dt>Final URL</dt>
            <dd>
              {attempt.final_uri ? (
                <a href={attempt.final_uri} target="_blank" rel="noopener noreferrer">
                  {attempt.final_uri}
                </a>
              ) : (
                display(attempt.final_uri)
              )}
            </dd>
            <dt>Title</dt>
            <dd>{display(attempt.title)}</dd>
          </dl>
          <h4>Official-domain / profile evidence</h4>
          <p>
            {attempt.domain_evidence.state === 'profile_supported'
              ? 'Reviewed profile supports the requested and final official domains.'
              : attempt.domain_evidence.state === 'no_reviewed_profile'
                ? 'Operator-proposed source without reviewed-domain corroboration.'
                : attempt.domain_evidence.state === 'final_domain_unobserved'
                  ? 'Requested domain is supported by a reviewed profile. The final domain is unknown because capture did not supply a final URL.'
                  : 'Outside reviewed official domains. Human acceptance does not override acquisition domain policy.'}
          </p>
          <Values value={attempt.domain_evidence} />
          {attempt.disposition === 'accepted' &&
            attempt.domain_evidence.state === 'outside_reviewed_domains' && (
              <p>
                This accepted source is outside reviewed official domains. Preparation may still
                fail officiality checks.
              </p>
            )}
          <h4>Identity observations</h4>
          <p>
            Exact occurrences are observations, not proof of product identity. Inspect the source
            and distinguish variants.
          </p>
          <Values value={attempt.observations} />
          <h4>Capture evidence and diagnostics</h4>
          <Values value={attempt.capture} />
          <Values value={attempt.diagnostics} />
          {attempt.disposition === 'pending' && attempt.capture.disposition !== 'authoritative' && (
            <p>
              Capture has not produced authoritative evidence
              {attempt.capture.response_status ? ` (HTTP ${attempt.capture.response_status})` : ''}.
              Accepting confirms source identity only; acquisition must still succeed before
              extraction.
            </p>
          )}
          {attempt.review && <p>Reviewed at {attempt.review.reviewed_at} by local operator.</p>}
          {attempt.disposition === 'pending' &&
            job.summary.state === 'source_resolution_review' && (
              <>
                <button
                  disabled={busy || !attempt.can_accept}
                  onClick={() =>
                    void run(() => client.acceptSource(job.summary.id, attempt.attempt_id))
                  }
                >
                  Accept official source
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => client.rejectSource(job.summary.id, attempt.attempt_id))
                  }
                >
                  Reject source
                </button>
              </>
            )}
        </article>
      ))}
      {section.accepted_reference && (
        <p>
          Source accepted. Use Start preparation to continue. Capture and manufacturer domain checks
          still apply.
        </p>
      )}
    </section>
  );
}

function JobPage({ id, client }: { id: string; client: OperatorApi }) {
  const [job, setJob] = useState<OperatorJobDetail>();
  const [section, setSection] = useState<ReviewSection | 'reviewable'>('overview');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    setJob(undefined);
    setError('');
    async function poll() {
      try {
        const next = await client.get(id);
        if (stopped) return;
        setJob(next);
        setError('');
        if (next.summary.state === 'created' || next.summary.state === 'preparing')
          timer = setTimeout(() => void poll(), 1000);
      } catch (error) {
        if (!stopped) setError(message(error));
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, client, refresh]);
  async function prepare() {
    setStarting(true);
    setError('');
    try {
      await client.prepare(id);
      setRefresh((r) => r + 1);
    } catch (error) {
      setError(message(error));
    } finally {
      setStarting(false);
    }
  }
  async function reopenPreparation() {
    if (!job?.preparation_recovery) return;
    setStarting(true);
    setError('');
    try {
      const recovery = job.preparation_recovery;
      const updated = recovery.expected_lifecycle_snapshot
        ? await client.reopenPreparation(
            id,
            recovery.expected_review_snapshot,
            recovery.expected_lifecycle_snapshot,
          )
        : await client.reopenPreparation(id, recovery.expected_review_snapshot);
      setJob(updated);
    } catch (error) {
      setError(message(error));
    } finally {
      setStarting(false);
    }
  }
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <button className="secondary" onClick={() => setRefresh((r) => r + 1)}>
        Refresh job
      </button>
      {job?.summary.state === 'created' && (
        <button disabled={starting} onClick={() => void prepare()}>
          {starting ? 'Starting preparation…' : 'Start preparation'}
        </button>
      )}
      {job?.preparation_recovery && (
        <section>
          <p>
            {job.preparation_recovery.expected_lifecycle_snapshot
              ? 'This resumed review may be explicitly re-prepared after capability changes. Reopening archives the complete reviewed result, including all semantic decisions; it does not reinterpret them. Start preparation remains a separate action using the accepted source.'
              : 'This preparation produced no qualified facts or product candidate. Reopening preserves the complete previous result and the accepted source. It does not start capture, approve facts, or write a component. Use only after an extraction capability has been corrected.'}
          </p>
          <button disabled={starting} onClick={() => void reopenPreparation()}>
            {job.preparation_recovery.expected_lifecycle_snapshot
              ? 'Archive reviewed preparation for explicit re-preparation'
              : 'Reopen empty preparation'}
          </button>
        </section>
      )}
      {job?.preparation_recovery_history?.map((entry) => (
        <p key={entry.previous_review_snapshot + entry.requested_at}>
          Previous preparation preserved: {entry.requested_at}; {entry.fact_count} facts;{' '}
          {entry.extraction_count} extractions; source {entry.source_uri ?? 'not asserted'}.
        </p>
      ))}
      {job ? (
        <>
          <nav className="review-nav" aria-label="Job review sections">
            {(
              [
                'overview',
                'reviewable',
                'unresolved',
                'evidence',
                'sources',
                'diagnostics',
              ] as const
            ).map((item) => (
              <button
                key={item}
                type="button"
                className={section === item ? 'active' : 'secondary'}
                aria-current={section === item ? 'page' : undefined}
                onClick={() => setSection(item)}
              >
                {item === 'reviewable'
                  ? 'Reviewable fields'
                  : item === 'evidence'
                    ? 'Evidence / facts'
                    : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </nav>
          {section !== 'reviewable' && <Review job={job} section={section} />}
          {job.candidate && (
            <div hidden={section !== 'reviewable'}>
              <ProductReview key={job.summary.id} job={job} client={client} onUpdate={setJob} />
            </div>
          )}
          {section === 'reviewable' && !job.candidate && (
            <section>
              <h2>Reviewable fields</h2>
              <p>Candidate projection is not available; no product approval action is available.</p>
            </section>
          )}
          {section === 'sources' && (
            <SourceResolution job={job} client={client} onUpdate={setJob} />
          )}
        </>
      ) : (
        <p role="status">Loading persisted job…</p>
      )}
    </>
  );
}
function RecentJobs({ client }: { client: OperatorApi }) {
  const [jobs, setJobs] = useState<OperatorJobSummary[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void client
      .list()
      .then((r) => {
        if (active) setJobs(r.jobs);
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [client]);
  return (
    <section>
      <h1>Recent jobs</h1>
      {error && <p role="alert">{error}</p>}
      {!jobs ? (
        <p>Loading jobs…</p>
      ) : !jobs.length ? (
        <p>No jobs yet. Add a product to begin.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  'Model / MPN',
                  'Manufacturer',
                  'State',
                  'Updated',
                  'Candidate',
                  'Facts',
                  'Proposals',
                ].map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <a href={`#/jobs/${j.id}`}>
                      {j.product_model}
                      {j.manufacturer_part_number ? ` / ${j.manufacturer_part_number}` : ''}
                    </a>
                  </td>
                  <td>{j.manufacturer}</td>
                  <td>{j.state}</td>
                  <td>{j.updated_at}</td>
                  <td>{display(j.candidate_present)}</td>
                  <td>{display(j.fact_count)}</td>
                  <td>{display(j.proposal_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
const emptyIntake = (): IntakeInput => ({
  manufacturer: '',
  product_model: '',
  manufacturer_part_number: '',
  official_product_uri: '',
});

export default function App({ client = api }: { client?: OperatorApi }) {
  const [route, setRoute] = useState(window.location.hash);
  const [input, setInput] = useState<IntakeInput>(emptyIntake);
  const [suggestions, setSuggestions] = useState<{
    manufacturers: string[];
    products: { manufacturer: string; model: string; mpn?: string }[];
  }>({ manufacturers: [], products: [] });
  useEffect(() => {
    let active = true;
    void client
      .suggestions()
      .then((value) => {
        if (active) setSuggestions(value);
      })
      .catch(() => {
        if (active) setError('Canonical suggestions unavailable. Free entry remains available.');
      });
    return () => {
      active = false;
    };
  }, [client]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const changed = () => {
      const nextRoute = window.location.hash;
      if (nextRoute === '' || nextRoute === '#' || nextRoute === '#/') setInput(emptyIntake());
      setRoute(nextRoute);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      if (!input.manufacturer_part_number.trim() && !input.official_product_uri.trim())
        throw new Error('Provide at least a manufacturer part number or an official product URL.');
      const job = await client.create(input);
      setInput(emptyIntake());
      window.location.hash = `/jobs/${job.summary.id}`;
      setRoute(`#/jobs/${job.summary.id}`);
      if (job.summary.state === 'created')
        void client
          .prepare(job.summary.id)
          .catch((error: unknown) =>
            setError(
              `Preparation request: ${message(error)} The job remains retrievable; refresh to inspect its persisted state.`,
            ),
          );
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }
  const id = /^#\/jobs\/([^/]+)$/.exec(route)?.[1];
  const batchId = /^#\/batches\/([^/]+)$/.exec(route)?.[1];
  return (
    <>
      <header>
        <a className="brand" href="#/" onClick={() => setInput(emptyIntake())}>
          Expedition <span>Ingestion Admin</span>
        </a>
        <nav>
          <a href="#/" onClick={() => setInput(emptyIntake())}>
            Add product
          </a>
          <a href="#/jobs">Recent jobs</a>
          <a href="#/batches">Batches</a>
        </nav>
      </header>
      <main>
        {error && <p role="alert">{error}</p>}
        {id ? (
          <JobPage key={id} id={id} client={client} />
        ) : route === '#/batches/new' ? (
          <BatchCreate client={client} />
        ) : batchId ? (
          <BatchPage key={batchId} id={batchId} client={client} />
        ) : route === '#/batches' ? (
          <BatchList client={client} />
        ) : route === '#/jobs' ? (
          <RecentJobs client={client} />
        ) : (
          <section className="intake">
            <div className="eyebrow">Local maintainer workspace</div>
            <h1>Add product</h1>
            <p>Prepare official evidence for review. Enter the product identity.</p>
            <form autoComplete="off" onSubmit={(event) => void submit(event)}>
              {(
                [
                  ['manufacturer', 'Manufacturer'],
                  ['product_model', 'Product model'],
                  ['manufacturer_part_number', 'Manufacturer part number'],
                  ['official_product_uri', 'Official product URL'],
                ] as const
              ).map(([field, label]) => (
                <label key={field}>
                  {label}
                  {(field === 'manufacturer' || field === 'product_model') && ' *'}
                  <input
                    aria-label={label}
                    list={field !== 'official_product_uri' ? `suggest-${field}` : undefined}
                    required={field === 'manufacturer' || field === 'product_model'}
                    autoComplete="off"
                    type={field === 'official_product_uri' ? 'url' : 'text'}
                    value={input[field]}
                    onChange={(e) => setInput({ ...input, [field]: e.target.value })}
                  />
                </label>
              ))}
              <p>
                Provide at least a manufacturer part number or an official product URL. Providing
                both gives the reviewer more identity evidence.
              </p>
              <p className="muted">
                Without an official product URL, the job is saved awaiting official source
                resolution.
              </p>
              {(['manufacturer', 'product_model', 'manufacturer_part_number'] as const).map(
                (field) => {
                  const same = (a: string, b: string) =>
                    a.trim().toLowerCase() === b.trim().toLowerCase();
                  const products = suggestions.products.filter((p) =>
                    same(p.manufacturer, input.manufacturer),
                  );
                  const values =
                    field === 'manufacturer'
                      ? suggestions.manufacturers
                      : field === 'product_model'
                        ? products.map((p) => p.model)
                        : products
                            .filter((p) => same(p.model, input.product_model))
                            .flatMap((p) => (p.mpn ? [p.mpn] : []));
                  const matched = [...new Set(values)].filter((value) =>
                    value.toLowerCase().includes(input[field].trim().toLowerCase()),
                  );
                  return (
                    <div key={field}>
                      <datalist id={`suggest-${field}`}>
                        {matched.map((value) => (
                          <option key={value} value={value} />
                        ))}
                      </datalist>
                      {matched.length > 0 && input[field].trim() && (
                        <div className="suggestions" aria-label={`${field} canonical suggestions`}>
                          {matched.slice(0, 12).map((value) => (
                            <button
                              type="button"
                              key={value}
                              onClick={() => setInput({ ...input, [field]: value })}
                            >
                              Use {value}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                },
              )}
              <button disabled={pending}>
                {pending ? 'Creating durable job…' : 'Create & Prepare'}
              </button>
            </form>
            <p className="muted">
              Preparation may take several minutes. Jobs and review results are stored locally and
              can be reopened after a reload.
            </p>
          </section>
        )}
      </main>
      <footer>Evidence preparation · Human review required · Local maintainer tool</footer>
    </>
  );
}
