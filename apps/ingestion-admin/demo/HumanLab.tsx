import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, OperatorApiError, type OperatorJobDetail } from '../src/api.js';
import { ProductReview } from '../src/ProductReview.js';

function HumanLab() {
  const [job, setJob] = useState<OperatorJobDetail>();
  const [error, setError] = useState('');
  const [width, setWidth] = useState('');
  const [scenarios, setScenarios] = useState<
    { id: string; label: string; instruction: string; automatic_fault?: string }[]
  >([]);
  const failPreview = useRef(false);
  const client = useMemo(
    () => ({
      ...api,
      humanPreview: async (...args: Parameters<typeof api.humanPreview>) => {
        if (failPreview.current) {
          failPreview.current = false;
          throw new OperatorApiError(
            503,
            'Controlled lab transport failure. Input is retained; recheck to use the real server.',
          );
        }
        return api.humanPreview(...args);
      },
    }),
    [],
  );
  useEffect(() => {
    void fetch('/lab/scenarios')
      .then((response) => {
        if (!response.ok) throw new Error('Lab scenarios unavailable.');
        return response.json();
      })
      .then(setScenarios)
      .catch((e) => setError(String(e)));
    void api
      .get(new URLSearchParams(location.search).get('job') ?? '')
      .then(setJob)
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <>
      <header>
        <div className="brand">
          Expedition <span>Human specification review lab</span>
        </div>
        <span>Controlled synthetic source · real review API</span>
      </header>
      <main>
        <div className="demo-controls">
          <p>
            Fresh TEMP storage. Source corrections are durable; approval, promotion and verification
            are unavailable.
          </p>
          <label>
            Controlled review scenario
            <select
              value={job?.summary.id ?? ''}
              onChange={(e) => {
                if (
                  !window.confirm(
                    'Open another controlled scenario? Unsaved review input will be discarded.',
                  )
                )
                  return;
                setError('');
                void api
                  .get(e.target.value)
                  .then(setJob)
                  .catch((error) => setError(String(error)));
              }}
            >
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Review width
            <select value={width} onChange={(e) => setWidth(e.target.value)}>
              <option value="">Available desktop width</option>
              <option value="390">390 CSS pixels</option>
            </select>
          </label>
        </div>
        <p className="human-correction-notice">
          All interactive evidence is synthetic.{' '}
          {scenarios.find((entry) => entry.id === job?.summary.id)?.instruction}{' '}
          {scenarios.find((entry) => entry.id === job?.summary.id)?.automatic_fault
            ? 'This example deliberately scripts a provisional automatic observation fault; original retained source and all successful server validation remain real.'
            : ''}{' '}
          Genuine frozen manufacturer-wording tests are separate; this lab establishes no original
          PDF/table qualification.
        </p>
        <div className="source-entry-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              failPreview.current = true;
              setError(
                'One simulated transport failure is armed. Recheck or change a selected property; subsequent retries use the real API.',
              );
            }}
          >
            Arm one preview transport failure
          </button>
          <button
            type="button"
            className="secondary"
            disabled={
              !job?.human_adjudication?.correction_records?.some((record) => record.source_ready)
            }
            onClick={() => {
              const record = job?.human_adjudication?.correction_records?.find(
                (entry) => entry.source_ready,
              );
              if (!job || !record) return;
              const prior = job.human_adjudication!.history.find((event) =>
                event.facts.some((fact) => fact.id === record.fact_id),
              );
              void api
                .humanAdjudication(job.summary.id, {
                  expected_review_snapshot: job.semantic_review!.expected_review_snapshot,
                  actor_label: 'Controlled lab second operator',
                  intent: {
                    version: 'human-adjudication.v1',
                    group_id: prior?.intent.group_id ?? `lab.concurrent.${crypto.randomUUID()}`,
                    ...(prior ? { previous_event_id: prior.id } : {}),
                    action: 'correct',
                    replaces_fact_ids: [record.fact_id],
                    disposition: 'ready',
                    rationale:
                      'Controlled concurrent review to exercise stale-state recovery, using the same retained source.',
                    statements: [{ ...record.statement, mapping: undefined }],
                  },
                })
                .then(() =>
                  setError(
                    'A real concurrent TEMP correction was recorded. This view is intentionally stale; input stays visible. Recheck/save must refuse stale intent before explicit reload.',
                  ),
                )
                .catch((e) => setError(String(e)));
            }}
          >
            Record concurrent TEMP correction
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        <div
          style={
            width ? { width: Number(width), maxWidth: '100%', marginInline: 'auto' } : undefined
          }
        >
          {job ? (
            <ProductReview key={job.summary.id} job={job} client={client} onUpdate={setJob} />
          ) : (
            <p role="status">Preparing review workspace…</p>
          )}
        </div>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<HumanLab />);
