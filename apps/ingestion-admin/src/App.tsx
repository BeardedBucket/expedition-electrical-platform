import { useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type IntakeInput,
  type OperatorApi,
  type OperatorJobDetail,
  type OperatorJobSummary,
} from './api.js';

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
                <td key={key}>{display((row as Record<string, unknown>)[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Review({ job }: { job: OperatorJobDetail }) {
  const { summary: s } = job;
  return (
    <>
      <section>
        <div className="eyebrow">Job {s.id}</div>
        <h1>{s.product_model}</h1>
        <p className={`state state-${s.state}`}>{s.state}</p>
        {s.state === 'preparing' && (
          <p role="status">
            Preparation is running. Acquiring, extracting, and qualifying official evidence can take
            several minutes.
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
      </section>
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
      <section>
        <h2>Extraction</h2>
        <p>
          Not captured sources have no extraction. Captured sources may be unsupported or have no
          extractable content; extraction and qualification are separate outcomes.
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
                Extraction: <strong>{e.status}</strong> · Capability: {e.capability} · Remediation:{' '}
                {e.remediation}
              </p>
              <p>
                Pages: {display(e.page_count)} · Blocks: {e.block_count} · Tables: {e.table_count}
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
                ['proposed_value', 'Proposed value'],
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
      <section>
        <h2>Diagnostics</h2>
        {job.diagnostics.length ? (
          <Values value={job.diagnostics} />
        ) : (
          <p>No terminal runtime diagnostics recorded.</p>
        )}
      </section>
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
        Source identity review. Accepting a source confirms which product you intended; product
        specifications require a separate later review.
      </p>
      <h3>Requested product</h3>
      <Values value={section.requested_identity} />
      <p>The original intake remains unchanged and has no official product URL.</p>
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
      {job ? <Review job={job} /> : <p role="status">Loading persisted job…</p>}
      {job && <SourceResolution job={job} client={client} onUpdate={setJob} />}
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
        </nav>
      </header>
      <main>
        {error && <p role="alert">{error}</p>}
        {id ? (
          <JobPage key={id} id={id} client={client} />
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
