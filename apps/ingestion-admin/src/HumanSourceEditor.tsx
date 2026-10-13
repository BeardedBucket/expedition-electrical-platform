import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HumanAdjudicationIntent,
  HumanCitation,
  HumanMappingIntent,
  HumanSourceStatement,
} from '@expedition/ingestion';
import type { HumanDiscoveryRepresentation } from '@expedition/ingestion-runtime';
import {
  OperatorApiError,
  type HumanPreview,
  type OperatorApi,
  type OperatorJobDetail,
  type SemanticTargetResponse,
} from './api.js';
import { ReviewerPropertyPicker, propertyName } from './ReviewerProperties.js';
import { ReviewValue } from './ReviewValue.js';
import { CorrectionRecord, type CorrectionItem } from './CorrectionRecord.js';
import {
  SourceEvidenceNavigator,
  type EvidenceRole,
  type SourceEntry,
} from './SourceEvidenceNavigator.js';

type CorrectionType = '' | 'engineering' | 'source' | 'model' | 'combined' | 'add';
const blank = (): HumanSourceStatement => ({
  label: '',
  value: '',
  wording: '',
  citations: [],
  applicability: { relationship: 'unresolved' },
});
const modeNames: Record<Exclude<CorrectionType, ''>, string> = {
  engineering: 'Engineering property or interpretation is wrong or missing',
  source: 'Extracted value, unit or original statement is incorrect',
  model: 'Model or part-number applicability needs correction',
  combined: 'Combined specifications or duplicate observations need reconciliation',
  add: 'A specification was missed entirely',
};
const citation = (entry: SourceEntry): HumanCitation => ({
  document_id: entry.document_id,
  block_id: entry.block_id,
  ...('cell_id' in entry ? { cell_id: entry.cell_id } : {}),
  quote: entry.text,
});
const citationKey = (c: HumanCitation) => `${c.document_id}:${c.block_id}:${c.cell_id ?? ''}`;
const meaningMode = (s: HumanSourceStatement): HumanDiscoveryRepresentation =>
  s.mapping?.kind === 'engineering_profile_fact'
    ? { kind: s.mapping.kind, quantity: s.mapping.quantity }
    : s.mapping?.kind === 'source_rating'
      ? { kind: 'source_rating', qualifiers: s.mapping.qualifiers }
      : { kind: s.mapping?.kind ?? 'scalar' };
export function HumanSourceEditor({
  job,
  client,
  reviewer,
  factIds,
  priorEventId,
  currentItem,
  onSaved,
  onDirty,
  onBusy,
  onClose,
}: {
  job: OperatorJobDetail;
  client: OperatorApi;
  reviewer: string;
  factIds: string[];
  priorEventId?: string;
  currentItem?: CorrectionItem;
  onSaved: (job: OperatorJobDetail) => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
}) {
  const [currentJob, setCurrentJob] = useState(job);
  const data = currentJob.human_adjudication!;
  const prior = priorEventId
    ? data.history.find((e) => e.id === priorEventId)
    : data.history.filter((e) => e.facts.some((f) => factIds.includes(f.id))).at(-1);
  const seeds = data.correction_records?.filter((r) => factIds.includes(r.fact_id)) ?? [];
  const sharedSeed =
    seeds.length > 1 &&
    seeds.every(
      (record) =>
        record.statement.value === seeds[0].statement.value &&
        record.statement.unit === seeds[0].statement.unit &&
        record.statement.wording === seeds[0].statement.wording &&
        record.statement.citations.some((c) =>
          seeds[0].statement.citations.some((first) => citationKey(first) === citationKey(c)),
        ),
    );
  const [group] = useState(() => prior?.intent.group_id ?? `source-group.${crypto.randomUUID()}`);
  const [addGroup] = useState(() => `source-group.${crypto.randomUUID()}`);
  const [previous, setPrevious] = useState(prior?.id);
  const [snapshot, setSnapshot] = useState(job.semantic_review!.expected_review_snapshot);
  const [boundFactIds, setBoundFactIds] = useState(factIds);
  const [mode, setMode] = useState<CorrectionType>('');
  const [action, setAction] = useState<HumanAdjudicationIntent['action']>(
    factIds.length > 1 ? (sharedSeed ? 'group' : 'split') : factIds.length ? 'correct' : 'add',
  );
  const [regular, setRegular] = useState<HumanSourceStatement[]>(() =>
    structuredClone([
      ...(prior?.intent.statements ??
        (sharedSeed
          ? [seeds[0].statement]
          : seeds.length
            ? seeds.map((r) => r.statement)
            : [blank()])),
    ]),
  );
  const [additions, setAdditions] = useState<HumanSourceStatement[]>([blank()]);
  const [index, setIndex] = useState(0);
  const addingSeparate = mode === 'add' && factIds.length > 0;
  const rows = addingSeparate ? additions : regular;
  const setRows = addingSeparate ? setAdditions : setRegular;
  const s = rows[index] ?? rows[0];
  const slot = `${addingSeparate ? 'new' : 'existing'}:${index}`;
  const [mappingWanted, setMappingWanted] = useState<Record<string, boolean>>({});
  const [representations, setRepresentations] = useState<
    Record<string, HumanDiscoveryRepresentation>
  >({});
  const representation = representations[slot] ?? meaningMode(s);
  const incomplete = mode === 'combined' && action === 'incomplete';
  const wantsMeaning =
    !incomplete && (mode === 'engineering' || (mappingWanted[slot] ?? !!s.mapping));
  const [rationale, setRationale] = useState('');
  const [targets, setTargets] = useState<SemanticTargetResponse['targets']>([]);
  const [discovery, setDiscovery] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [preview, setPreview] = useState<{ key: string; value: HumanPreview }>();
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [revision, setRevision] = useState(0);
  const currentKey = useRef('');
  const pendingFocus = useRef<string>();
  const [focusRevision, setFocusRevision] = useState(0);
  useEffect(() => {
    if (pendingFocus.current) {
      focus(pendingFocus.current);
      pendingFocus.current = undefined;
    }
  }, [index, focusRevision]);
  const patch = (change: Partial<HumanSourceStatement>) => {
    setRows((old) => old.map((row, i) => (i === index ? { ...row, ...change } : row)));
    onDirty(true);
    setError('');
  };
  const activeAction =
    addingSeparate || !factIds.length
      ? 'add'
      : mode === 'combined'
        ? action
        : rows.length > 1
          ? 'split'
          : boundFactIds.length > 1
            ? 'group'
            : 'correct';
  const activeRows = rows.map((row, i) => ({
    ...row,
    mapping:
      mode === 'engineering' ||
      (mappingWanted[`${addingSeparate ? 'new' : 'existing'}:${i}`] ?? !!row.mapping)
        ? row.mapping
        : undefined,
  }));
  // Each requested interpretation needs its own explicit target. A selection on
  // another assertion must not make a partially mapped split look complete.
  const missingMeaningIndex = incomplete
    ? -1
    : rows.findIndex(
        (row, i) =>
          (mode === 'engineering' ||
            (mappingWanted[`${addingSeparate ? 'new' : 'existing'}:${i}`] ?? !!row.mapping)) &&
          !row.mapping,
      );
  const intent: HumanAdjudicationIntent = {
    version: 'human-adjudication.v1',
    group_id: addingSeparate ? addGroup : group,
    ...(!addingSeparate && previous ? { previous_event_id: previous } : {}),
    replaces_fact_ids: activeAction === 'add' ? [] : boundFactIds,
    action: activeAction,
    disposition: activeAction === 'incomplete' ? 'draft' : 'ready',
    statements: activeRows,
    rationale,
  };
  // Rationale does not alter source normalization. Reuse read-only validation
  // while typing the reason; the durable save always submits the actual reason.
  const validationIntent = { ...intent, rationale: '' };
  const key = JSON.stringify({ intent: validationIntent, snapshot, reviewer, wantsMeaning });
  currentKey.current = key;
  const failure = (e: unknown) => {
    setError(e instanceof Error ? e.message : 'The service could not validate this correction.');
    if (e instanceof OperatorApiError && e.status === 409) setStale(true);
  };
  const sourceComplete = rows.every(
    (row) =>
      row.label.trim() &&
      row.value.trim() &&
      row.wording.trim() &&
      row.citations.length &&
      row.applicability.citation &&
      row.applicability.relationship !== 'unresolved',
  );
  const sourceKey = JSON.stringify({
    rows: activeRows.map((row) => ({ ...row, mapping: undefined })),
    representation,
    index,
    snapshot,
    reviewer,
    activeAction,
    boundFactIds,
    previous,
    addingSeparate,
  });
  // A mapping recheck waits for renewed discovery; firing immediately with
  // the previous eligible set would dispatch two previews for one user action.
  const directPreviewRevision = wantsMeaning ? 0 : revision;
  const previewEligibilityKey = wantsMeaning
    ? JSON.stringify({ discovery, targets: targets.map((target) => target.canonical_field) })
    : '';
  useEffect(() => {
    let active = true;
    setTargets([]);
    setDiscovery('idle');
    if (
      !mode ||
      !wantsMeaning ||
      !sourceComplete ||
      !reviewer.trim() ||
      stale ||
      activeAction === 'incomplete'
    )
      return;
    setDiscovery('loading');
    // A representation is a discovery filter, never a hidden property selection.
    void client
      .humanProperties(job.summary.id, {
        expected_review_snapshot: snapshot,
        actor_label: reviewer,
        intent: {
          ...intent,
          statements: activeRows.map((row) => ({ ...row, mapping: undefined })),
        },
        statement_index: index,
        representation,
      })
      .then((result) => {
        if (active) {
          setTargets(result.targets);
          setDiscovery('ready');
        }
      })
      .catch((e) => {
        if (active) {
          setDiscovery('failed');
          failure(e);
        }
      });
    return () => {
      active = false;
    };
  }, [client, job.summary.id, sourceKey, stale, revision, mode, wantsMeaning, sourceComplete]);
  useEffect(() => {
    let active = true;
    setPreview(undefined);
    setPending(false);
    if (
      !mode ||
      !sourceComplete ||
      !reviewer.trim() ||
      stale ||
      activeAction === 'incomplete' ||
      missingMeaningIndex !== -1 ||
      (wantsMeaning &&
        (!s.mapping ||
          !targets.some((t) => t.canonical_field === s.mapping!.target) ||
          discovery !== 'ready'))
    )
      return;
    const requested = key;
    setPending(true);
    setError('');
    void client
      .humanPreview(job.summary.id, {
        expected_review_snapshot: snapshot,
        actor_label: reviewer,
        intent: validationIntent,
      })
      .then((value) => {
        if (active && currentKey.current === requested) setPreview({ key: requested, value });
      })
      .catch((e) => {
        if (active) failure(e);
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [
    client,
    job.summary.id,
    key,
    previewEligibilityKey,
    stale,
    directPreviewRevision,
    mode,
    wantsMeaning,
    sourceComplete,
    missingMeaningIndex,
  ]);
  const ready =
    preview?.key === key &&
    !pending &&
    !stale &&
    sourceComplete &&
    missingMeaningIndex === -1 &&
    activeAction !== 'incomplete' &&
    (!wantsMeaning ||
      (s.mapping &&
        discovery === 'ready' &&
        targets.some((target) => target.canonical_field === s.mapping!.target)));
  const currentPreview = ready ? preview.value : undefined;
  const staleEvidence = useCallback(() => setStale(true), []);
  const useEvidence = (entry: SourceEntry, roles: EvidenceRole[]) => {
    const c = citation(entry);
    const changes: { -readonly [K in keyof HumanSourceStatement]?: HumanSourceStatement[K] } = {};
    if (roles.includes('statement') || roles.includes('condition'))
      changes.citations = [...s.citations.filter((old) => citationKey(old) !== citationKey(c)), c];
    if (roles.includes('statement') && !s.wording) changes.wording = entry.text;
    if (roles.includes('condition'))
      changes.conditions = [...new Set([...(s.conditions ?? []), entry.text])];
    if (roles.includes('model')) changes.applicability = { ...s.applicability, citation: c };
    patch(changes);
  };
  const changeMode = (value: CorrectionType) => {
    if (mode === 'engineering' && value !== 'add')
      setMappingWanted((old) => ({ ...old, [slot]: true }));
    setMode(value);
    setIndex(0);
    setError('');
    onDirty(true);
    if (value === 'combined' && action === 'correct') setAction('split');
  };
  const changeRepresentation = (kind: HumanDiscoveryRepresentation['kind']) => {
    const next: HumanDiscoveryRepresentation =
      kind === 'source_rating'
        ? {
            kind,
            qualifiers: {
              ...(representation.kind === 'source_rating' ? representation.qualifiers : {}),
              ...(s.duration ? { duration: s.duration } : {}),
              ...(s.temperature ? { temperature_context: s.temperature } : {}),
            },
          }
        : { kind };
    setRepresentations((old) => ({ ...old, [slot]: next }));
    // The prior selection stays inspectable in the current record; a changed
    // representation requires an explicit eligible target, never a default.
    patch({ mapping: undefined });
  };
  const changeQualifier = (field: string, value: string) => {
    if (representation.kind !== 'source_rating') return;
    const qualifiers = { ...representation.qualifiers, [field]: value || undefined };
    setRepresentations((old) => ({ ...old, [slot]: { kind: 'source_rating', qualifiers } }));
    if (s.mapping?.kind === 'source_rating') patch({ mapping: { ...s.mapping, qualifiers } });
    else {
      onDirty(true);
      setError('');
    }
  };
  const changeContext = (field: 'duration' | 'temperature' | 'revision', value: string) => {
    patch({ [field]: value || undefined });
    if (representation.kind === 'source_rating')
      changeQualifier(
        field === 'temperature'
          ? 'temperature_context'
          : field === 'revision'
            ? 'revision_context'
            : field,
        value,
      );
  };
  function focus(id: string) {
    const node = document.getElementById(id);
    const parent = node?.closest('details');
    if (parent) parent.open = true;
    const control = node?.matches('input,select,textarea,button')
      ? node
      : (node?.querySelector<HTMLElement>('input,select,textarea,button') ?? node);
    control?.focus();
    node?.scrollIntoView?.({ block: 'nearest' });
  }
  async function save(draft: boolean) {
    if (
      !data.editable ||
      busy ||
      stale ||
      !rationale.trim() ||
      !reviewer.trim() ||
      (!draft && !ready)
    )
      return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const returned = await client.humanAdjudication(job.summary.id, {
        expected_review_snapshot: snapshot,
        actor_label: reviewer,
        intent: { ...intent, disposition: draft ? 'draft' : 'ready' },
      });
      onDirty(false);
      onSaved(returned);
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    onBusy(true);
    try {
      const next = await client.get(job.summary.id);
      if (!next.human_adjudication?.editable)
        throw new Error(
          'This product is no longer editable. Your input is retained; return to product review.',
        );
      const latest = next.human_adjudication.history
        .filter((e) => e.intent.group_id === group)
        .at(-1);
      const ids = latest?.facts.length ? latest.facts.map((f) => f.id) : boundFactIds;
      const currentIds = [
        ...(next.semantic_review?.work.required ?? []),
        ...(next.semantic_review?.work.reviewed ?? []),
        ...(next.semantic_review?.work.automatic ?? []),
      ].flatMap((item) => item.evidence.map((f) => f.id));
      if (activeAction !== 'add' && ids.some((id) => !currentIds.includes(id)))
        throw new Error(
          'This source group was replaced elsewhere. Input is retained; reopen the current record before saving.',
        );
      setCurrentJob(next);
      setBoundFactIds(ids);
      setPrevious(latest?.id);
      setSnapshot(next.semantic_review!.expected_review_snapshot);
      setPreview(undefined);
      setStale(false);
      setRevision((n) => n + 1);
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  const missingIndex = rows.findIndex(
    (row) =>
      !row.label.trim() ||
      !row.value.trim() ||
      !row.wording.trim() ||
      (!incomplete &&
        (!row.citations.length ||
          !row.applicability.citation ||
          row.applicability.relationship === 'unresolved')),
  );
  const missing = rows[missingIndex] ?? s;
  const focusBlocker = (blocker: { id: string; index?: number }) => {
    if (blocker.index !== undefined) setIndex(blocker.index);
    pendingFocus.current = blocker.id;
    setFocusRevision((n) => n + 1);
  };
  const blockers: { label: string; id: string; index?: number }[] = [
    ...(!mode ? [{ label: 'Choose what needs correcting', id: 'human-correction-type' }] : []),
    ...(missingIndex !== -1 && mode
      ? [
          {
            label: 'Complete the source statement and evidence',
            index: missingIndex,
            id: !missing.label.trim()
              ? 'human-source-label'
              : !missing.value.trim()
                ? 'human-source-value'
                : !missing.wording.trim()
                  ? 'human-source-wording'
                  : !missing.citations.length
                    ? 'human-source-evidence'
                    : 'human-model-scope',
          },
        ]
      : []),
    ...(missingMeaningIndex !== -1
      ? [
          {
            label: 'Select an eligible engineering property',
            id: 'human-property-picker',
            index: missingMeaningIndex,
          },
        ]
      : []),
    ...(!reviewer.trim()
      ? [{ label: 'Enter your local reviewer label', id: 'reviewer-label' }]
      : []),
    ...(!rationale.trim()
      ? [{ label: 'Explain the correction', id: 'human-source-rationale' }]
      : []),
  ];
  const related = (data.correction_records ?? []).filter((record) =>
    seeds
      .slice(0, 1)
      .some(
        (seed) =>
          record.statement.value === seed.statement.value &&
          record.statement.unit === seed.statement.unit &&
          record.statement.wording === seed.statement.wording &&
          record.statement.citations.some((c) =>
            seed.statement.citations.some((old) => citationKey(old) === citationKey(c)),
          ),
      ),
  );
  const currentWork = currentJob.semantic_review?.work;
  const effectiveItem =
    (currentWork &&
      [...currentWork.required, ...currentWork.reviewed, ...currentWork.automatic].find((item) =>
        item.evidence.some((f) => boundFactIds.includes(f.id)),
      )) ||
    currentItem;
  const sourceFields = (
    <div id="human-source-fields" tabIndex={-1}>
      <p className="muted">
        {prior
          ? 'Prepopulated from the previous human correction.'
          : seeds.length
            ? 'Prepopulated source data retains its automatic origin; compare it with the original passage.'
            : 'Enter only what the retained manufacturer passage establishes.'}
      </p>
      <div className="source-value-grid">
        <label>
          Corrected source label (required)
          <input
            id="human-source-label"
            value={s.label}
            onChange={(e) => patch({ label: e.target.value })}
          />
        </label>
        <label>
          Exact source value (required)
          <input
            id="human-source-value"
            value={s.value}
            onChange={(e) => patch({ value: e.target.value })}
          />
        </label>
        <label>
          Source-stated unit
          <input
            value={s.unit ?? ''}
            onChange={(e) => patch({ unit: e.target.value || undefined })}
          />
        </label>
      </div>
      <label>
        Original manufacturer wording (required)
        <textarea
          id="human-source-wording"
          value={s.wording}
          onChange={(e) => patch({ wording: e.target.value })}
        />
      </label>
    </div>
  );
  const modelFields = (
    <div id="human-model-fields">
      <p>
        Requested model: <strong>{job.intake.product_model}</strong> · Part:{' '}
        <strong>{job.intake.manufacturer_part_number || 'Unknown'}</strong>
      </p>
      <label>
        {incomplete
          ? 'Model relationship (optional for unresolved draft)'
          : 'Model relationship (required)'}
        <select
          id="human-model-scope"
          value={s.applicability.relationship}
          onChange={(e) =>
            patch({
              applicability: {
                ...s.applicability,
                relationship: e.target
                  .value as HumanSourceStatement['applicability']['relationship'],
              },
            })
          }
        >
          <option value="unresolved">Not established — unresolved</option>
          <option value="statement">Requested model in the same statement</option>
          <option value="text_heading">Exact model heading governing this passage</option>
          <option value="table_row">Exact model cell in this specification row</option>
          <option value="table_column">Exact model header owning this specification column</option>
          <option value="shared_statement">Explicit shared statement naming this model</option>
        </select>
      </label>
      {s.applicability.citation ? (
        <label>
          Manufacturer text establishing model scope
          <textarea
            value={s.applicability.citation.quote}
            onChange={(e) =>
              patch({
                applicability: {
                  ...s.applicability,
                  citation: { ...s.applicability.citation!, quote: e.target.value },
                },
              })
            }
          />
        </label>
      ) : (
        <p className="inline-warning">
          Select original source evidence for the model relationship. Choosing a relationship alone
          grants no scope.
        </p>
      )}
    </div>
  );
  return (
    <div className="human-correction-flow">
      <CorrectionRecord job={currentJob} item={effectiveItem} factIds={boundFactIds} />
      {data.profile_suggestions?.length ? (
        <details>
          <summary>Proposed PV/controller source facts ({data.profile_suggestions.length})</summary>
          <p>
            Unreviewed suggestions. Add or correct the statement with the source editor; missing
            revision, temperature and installation context remain unknown.
          </p>
          {data.profile_suggestions.map((p, i) => (
            <div key={i}>
              <strong>
                {p.statement.label}: {p.statement.value} {p.statement.unit}
              </strong>
              <p>{p.statement.wording}</p>
              <p>Missing: {p.missing.join(', ')}</p>
            </div>
          ))}
        </details>
      ) : null}
      <div className="source-correction-workspace">
        <SourceEvidenceNavigator
          jobId={job.summary.id}
          snapshot={snapshot}
          client={client}
          documents={data.documents}
          initialDocumentId={s.citations[0]?.document_id}
          disabled={busy || stale || !data.editable}
          onUse={useEvidence}
          onStale={staleEvidence}
        />
        <fieldset className="semantic-editor human-source-editor" disabled={busy || !data.editable}>
          <h4>3 · Choose and make your correction</h4>
          <label>
            What needs correcting?
            <select
              id="human-correction-type"
              value={mode}
              onChange={(e) => changeMode(e.target.value as CorrectionType)}
            >
              <option value="">Choose a correction type</option>
              {(Object.keys(modeNames) as Exclude<CorrectionType, ''>[])
                .filter((choice) => factIds.length || choice === 'add')
                .map((choice) => (
                  <option key={choice} value={choice}>
                    {modeNames[choice]}
                  </option>
                ))}
            </select>
          </label>
          <p className="muted">
            Changing the correction type preserves entered work. A missed specification uses a
            separate addition; returning restores the existing-record draft.
          </p>
          {mode && (
            <>
              {(rows.length > 1 || mode === 'combined' || mode === 'add') && (
                <nav aria-label="Corrected source assertions">
                  {rows.map((row, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-current={index === i ? 'true' : undefined}
                      onClick={() => setIndex(i)}
                    >
                      {row.label || `Assertion ${i + 1}`}
                    </button>
                  ))}
                  {(mode === 'combined' || mode === 'add') && (
                    <button
                      type="button"
                      onClick={() => {
                        setRows((old) => [...old, blank()]);
                        setIndex(rows.length);
                        setAction(factIds.length ? 'split' : 'add');
                        onDirty(true);
                      }}
                    >
                      Add separate assertion
                    </button>
                  )}
                </nav>
              )}
              {mode === 'combined' && (
                <>
                  <label>
                    How should these observations be repaired?
                    <select
                      value={action}
                      onChange={(e) => {
                        setAction(e.target.value as typeof action);
                        onDirty(true);
                      }}
                    >
                      <option value="split">Separate genuinely different specifications</option>
                      {related.length > 1 && (
                        <option value="group">
                          Associate duplicate observations of this same specification
                        </option>
                      )}
                      <option value="incomplete">Retain incomplete extraction as unresolved</option>
                    </select>
                  </label>
                  {action === 'group' &&
                    related.map((record) => (
                      <label key={record.fact_id} className="evidence-role">
                        <input
                          type="checkbox"
                          checked={boundFactIds.includes(record.fact_id)}
                          onChange={(e) => {
                            setBoundFactIds((ids) =>
                              e.target.checked
                                ? [...new Set([...ids, record.fact_id])]
                                : ids.filter((id) => id !== record.fact_id),
                            );
                            onDirty(true);
                          }}
                        />
                        {record.statement.label} · {record.statement.value} {record.statement.unit}
                      </label>
                    ))}
                  <p className="muted">
                    The server checks shared source positions. Different specifications and
                    conflicting values cannot be silently merged.
                  </p>
                </>
              )}
              {mode === 'engineering' ? (
                <>
                  <p>
                    Reuse the current retained statement and model proof. Only the engineering
                    meaning changes.
                  </p>
                  {!seeds.every((seed) => seed.source_ready) || !sourceComplete ? (
                    <p className="inline-warning">
                      This source needs evidence review before mapping.
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => changeMode('source')}
                      >
                        Review source information
                      </button>
                      Your intended property selection is retained.
                    </p>
                  ) : null}
                  <details>
                    <summary>Inspect reused source fields</summary>
                    {sourceFields}
                    {modelFields}
                  </details>
                </>
              ) : mode === 'model' ? (
                <>
                  {modelFields}
                  <details>
                    <summary>Existing value and source statement</summary>
                    {sourceFields}
                  </details>
                </>
              ) : (
                <>
                  {sourceFields}
                  <details open={!incomplete && !s.applicability.citation}>
                    <summary>
                      {incomplete
                        ? 'Retained model context (optional for this draft)'
                        : 'Exact model applicability'}
                    </summary>
                    {modelFields}
                  </details>
                </>
              )}
              <details open={!incomplete && !s.citations.length}>
                <summary>Supporting source quotations ({s.citations.length})</summary>
                <p className="muted">
                  Exact excerpts remain separate from your correction. The server independently
                  retains containing statements, headings and notes; cropping cannot erase
                  conditions.
                </p>
                {s.citations.map((c, i) => (
                  <div key={i}>
                    <label>
                      Exact retained quote {i + 1}
                      <textarea
                        value={c.quote}
                        onChange={(e) =>
                          patch({
                            citations: s.citations.map((old, j) =>
                              j === i ? { ...old, quote: e.target.value } : old,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => patch({ citations: s.citations.filter((_, j) => j !== i) })}
                    >
                      Remove quotation {i + 1}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        if (
                          !s.wording ||
                          s.wording === c.quote ||
                          window.confirm(
                            'Replace the current manufacturer wording with this exact retained quotation? Other correction fields are preserved.',
                          )
                        )
                          patch({ wording: c.quote });
                      }}
                    >
                      Reuse this quotation as manufacturer wording
                    </button>
                    <details>
                      <summary>Exact citation identifiers</summary>
                      <ReviewValue
                        value={{ document: c.document_id, block: c.block_id, cell: c.cell_id }}
                      />
                    </details>
                  </div>
                ))}
              </details>
              {mode !== 'engineering' && !incomplete && (
                <label className="evidence-role">
                  <input
                    type="checkbox"
                    checked={wantsMeaning}
                    onChange={(e) => {
                      setMappingWanted((old) => ({ ...old, [slot]: e.target.checked }));
                      onDirty(true);
                    }}
                  />
                  Also correct or assign engineering meaning
                </label>
              )}
              {wantsMeaning && (
                <>
                  <label>
                    Engineering representation
                    <select
                      value={representation.kind}
                      onChange={(e) =>
                        changeRepresentation(e.target.value as HumanDiscoveryRepresentation['kind'])
                      }
                    >
                      <option value="scalar">Direct value — no material conditions</option>
                      <option value="source_rating">Rating with source conditions</option>
                      <option value="engineering_profile_fact">
                        PV or controller profile fact — source-bound atomic review
                      </option>
                      <option value="source_observation">
                        Supported range, body dimensions or operating consumption
                      </option>
                    </select>
                  </label>
                  {representation.kind === 'source_rating' && (
                    <div className="source-value-grid">
                      {(['direction', 'electrical_domain', 'rating_basis'] as const).map(
                        (field) => (
                          <label key={field}>
                            {
                              {
                                direction: 'Direction',
                                electrical_domain: 'Electrical domain',
                                rating_basis: 'Rating basis',
                              }[field]
                            }
                            <select
                              value={representation.qualifiers[field] ?? ''}
                              onChange={(e) => changeQualifier(field, e.target.value)}
                            >
                              <option value="">Unknown / not asserted</option>
                              {{
                                direction: ['input', 'output'],
                                electrical_domain: ['ac', 'dc'],
                                rating_basis: [
                                  'maximum',
                                  'rated',
                                  'rated_maximum',
                                  'continuous',
                                  'nominal',
                                  'peak',
                                  'surge',
                                ],
                              }[field].map((v) => (
                                <option key={v} value={v}>
                                  {v.replace(/_/g, ' ')}
                                </option>
                              ))}
                            </select>
                          </label>
                        ),
                      )}
                    </div>
                  )}
                  {representation.kind === 'engineering_profile_fact' && (
                    <label>
                      Profile quantity
                      <select
                        aria-label="Profile quantity"
                        value={representation.quantity ?? ''}
                        onChange={(e) => {
                          setRepresentations((old) => ({
                            ...old,
                            [slot]: {
                              kind: 'engineering_profile_fact',
                              quantity: e.target.value as Extract<
                                HumanMappingIntent,
                                { kind: 'engineering_profile_fact' }
                              >['quantity'],
                            },
                          }));
                          patch({ mapping: undefined });
                        }}
                      >
                        <option value="">Choose exact source quantity</option>
                        {[
                          'voc_v',
                          'vmp_v',
                          'isc_a',
                          'imp_a',
                          'pmax_w',
                          'max_system_v',
                          'pv_absolute_voc_v',
                          'pv_max_isc_a',
                        ].map((q) => (
                          <option key={q} value={q}>
                            {q.replaceAll('_', ' ')}
                          </option>
                        ))}
                      </select>
                      <span>
                        Every member retains source context. The composed profile is reviewed
                        atomically; missing reference, tracker and installation facts remain
                        unresolved.
                      </span>
                    </label>
                  )}
                  <div id="human-property-picker">
                    <ReviewerPropertyPicker
                      targets={targets}
                      loading={discovery === 'loading'}
                      discoveryState={discovery}
                      value={s.mapping?.target ?? ''}
                      onChange={(target) =>
                        patch({ mapping: { ...representation, target } as HumanMappingIntent })
                      }
                    />
                  </div>
                  {representation.kind === 'source_rating' && (
                    <details>
                      <summary>Measurement basis, comparison and product role</summary>
                      {(['measurement_basis', 'comparison', 'product_role'] as const).map(
                        (field) => (
                          <label key={field}>
                            {
                              {
                                measurement_basis: 'Measurement basis',
                                comparison: 'Source comparison',
                                product_role: 'Source product role',
                              }[field]
                            }
                            <select
                              value={representation.qualifiers[field] ?? ''}
                              onChange={(e) => changeQualifier(field, e.target.value)}
                            >
                              <option value="">Unknown / not asserted</option>
                              {{
                                measurement_basis: ['rms'],
                                comparison: [
                                  'less_than',
                                  'less_than_or_equal',
                                  'greater_than',
                                  'greater_than_or_equal',
                                ],
                                product_role: ['battery'],
                              }[field].map((v) => (
                                <option key={v} value={v}>
                                  {v.replace(/_/g, ' ')}
                                </option>
                              ))}
                            </select>
                          </label>
                        ),
                      )}
                    </details>
                  )}
                </>
              )}
              {(mode !== 'engineering' ||
                representation.kind !== 'scalar' ||
                s.duration ||
                s.temperature ||
                s.conditions?.length) && (
                <details open={representation.kind === 'source_rating' && wantsMeaning}>
                  <summary>Applicable source conditions</summary>
                  <div className="source-value-grid">
                    <label>
                      Duration (exact wording)
                      <input
                        value={s.duration ?? ''}
                        onChange={(e) => changeContext('duration', e.target.value)}
                      />
                    </label>
                    <label>
                      Temperature (exact wording)
                      <input
                        value={s.temperature ?? ''}
                        onChange={(e) => changeContext('temperature', e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    Other source conditions
                    <textarea
                      value={s.conditions?.join('\n') ?? ''}
                      onChange={(e) =>
                        patch({ conditions: e.target.value.split('\n').filter(Boolean) })
                      }
                    />
                  </label>
                  <label>
                    Source revision context
                    <input
                      value={s.revision ?? ''}
                      onChange={(e) => changeContext('revision', e.target.value)}
                    />
                  </label>
                  <p className="muted">
                    Retain operating state and source notes. Missing or uncertain qualifier
                    ownership stays unresolved.
                  </p>
                </details>
              )}
            </>
          )}
        </fieldset>
      </div>
      <section className="correction-comparison" aria-label="Current versus proposed correction">
        <h4>4 · Validation and comparison</h4>
        <div className="correction-compare-grid">
          <article>
            <h5>What Expedition currently has</h5>
            {effectiveItem ? (
              <>
                <strong>
                  {propertyName(effectiveItem.target ?? effectiveItem.automatic_target)}
                </strong>
                <ReviewValue
                  value={
                    effectiveItem.value ??
                    effectiveItem.automatic_value ??
                    effectiveItem.evidence[0]?.raw_value
                  }
                />
                <p className="muted">
                  Units:{' '}
                  {effectiveItem.normalized_unit ??
                    effectiveItem.canonical_unit ??
                    effectiveItem.evidence[0]?.unit ??
                    'Unknown / not retained'}
                </p>
              </>
            ) : (
              <p>No existing engineering mapping for this addition.</p>
            )}
            <p className="muted">Original source and previous decisions remain in history.</p>
          </article>
          <article>
            <h5>What this correction proposes</h5>
            {rows.map((row, i) => (
              <div key={i}>
                <strong>{row.label || 'Source specification not yet identified'}</strong>
                <p>
                  {row.value || 'Value required'} {row.unit ?? ''}
                </p>
                <p className="muted">
                  Evidence: {row.citations.length} retained quotation(s) · Model relationship:{' '}
                  {row.applicability.relationship === 'unresolved'
                    ? 'not established'
                    : 'supplied, subject to server validation'}
                </p>
                {[row.duration, row.temperature, row.revision, ...(row.conditions ?? [])].filter(
                  Boolean,
                ).length > 0 && (
                  <p>
                    Source context:{' '}
                    {[row.duration, row.temperature, row.revision, ...(row.conditions ?? [])]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
            ))}
            <p>
              {wantsMeaning
                ? 'Source interpretation and engineering meaning'
                : 'Source interpretation only; engineering meaning may remain unresolved'}
            </p>
            {currentPreview ? (
              <>
                <p role="status">
                  {currentPreview.assertions.some(
                    (assertion) => assertion.mapping && !assertion.projected,
                  )
                    ? 'Source assertions validated · engineering projection remains unresolved'
                    : 'Server-validated · still provisional'}
                </p>
                {currentPreview.assertions.map((assertion, i) => (
                  <div key={i}>
                    {assertion.mapping && <strong>{propertyName(assertion.mapping.target)}</strong>}
                    {assertion.mapping && !assertion.projected && (
                      <p className="inline-warning">
                        Not included in the engineering candidate.{' '}
                        {assertion.restriction_reasons?.join(' ') ||
                          'Inspect the returned unresolved restrictions.'}
                      </p>
                    )}
                    {assertion.normalized_value !== undefined && (
                      <p>
                        <ReviewValue value={assertion.normalized_value} />{' '}
                        {assertion.normalized_unit}
                      </p>
                    )}
                    {assertion.qualified_value && (
                      <details>
                        <summary>Validated conditions</summary>
                        <ReviewValue value={assertion.qualified_value.qualifiers} />
                      </details>
                    )}
                  </div>
                ))}
                <details>
                  <summary>Full validated candidate and unresolved restrictions</summary>
                  <ReviewValue value={currentPreview.candidate} />
                  <ReviewValue value={currentPreview.non_projected} />
                </details>
              </>
            ) : (
              <p className="muted">
                {stale
                  ? 'Stale — no proposed result is valid until explicit reload/recheck.'
                  : pending
                    ? 'Waiting for server validation…'
                    : 'No current validated engineering result. An unresolved draft records review evidence only.'}
              </p>
            )}
          </article>
        </div>
      </section>
      <section className="correction-save-panel" aria-label="Correction readiness">
        <h4>5 · Reason and save</h4>
        <label>
          Reason for correction (required)
          <textarea
            id="human-source-rationale"
            value={rationale}
            onChange={(e) => {
              setRationale(e.target.value);
              onDirty(true);
            }}
          />
        </label>
        <p className="muted">
          Describe what was wrong or missing, what the manufacturer evidence establishes, and why
          your corrected interpretation is appropriate.
        </p>
        <div className="readiness-summary">
          <strong>
            {stale
              ? 'Stale review — explicit reload needed'
              : error
                ? 'Validation refused — input retained'
                : pending
                  ? 'Validation pending'
                  : blockers.length
                    ? `${blockers.length} requirements remain`
                    : incomplete
                      ? 'Ready to retain an unresolved extraction draft'
                      : ready
                        ? 'Ready to record a correction'
                        : 'Server validation needed'}
          </strong>
          <ul>
            {blockers.slice(0, 3).map((blocker) => (
              <li key={blocker.id}>
                <button
                  type="button"
                  className="requirement-link"
                  onClick={() => focusBlocker(blocker)}
                >
                  {blocker.label}
                </button>
              </li>
            ))}
          </ul>
          {blockers.length > 3 && (
            <details>
              <summary>Other requirements</summary>
              {blockers.slice(3).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="requirement-link"
                  onClick={() => focusBlocker(b)}
                >
                  {b.label}
                </button>
              ))}
            </details>
          )}
        </div>
        {error && (
          <p role="alert">{error} Your input is retained; no automatic save or retry occurred.</p>
        )}
        {mode && (
          <button
            type="button"
            className="secondary"
            disabled={pending || busy || stale}
            onClick={() => setRevision((n) => n + 1)}
          >
            Recheck source and selected property
          </button>
        )}
        {stale && (
          <button type="button" disabled={busy} onClick={() => void reload()}>
            Reload and recheck evidence
          </button>
        )}
        <details>
          <summary>What saving records</summary>
          <p>
            The original manufacturer evidence remains unchanged. Earlier automatic observations and
            human decisions remain in history. This correction appends a traceable review event.
            Your local reviewer label identifies the actor; it is not authenticated identity. Saving
            does not approve, publish, promote or engineering-verify this product.
          </p>
        </details>
        <p className="save-accountability">
          Saving appends a traceable review event under your local label, which is not authenticated
          identity. Original manufacturer evidence and earlier decisions stay in history. This save
          does not approve, publish, promote or engineering-verify the product.
        </p>
        <div className="correction-save-actions">
          <button
            type="button"
            disabled={
              !data.editable ||
              (!incomplete && !ready) ||
              (incomplete && missingIndex !== -1) ||
              !reviewer.trim() ||
              !rationale.trim() ||
              busy ||
              stale ||
              !mode
            }
            onClick={() => void save(incomplete)}
          >
            {incomplete ? 'Save unresolved draft' : 'Save correction'}
          </button>
          {!incomplete && (
            <button
              type="button"
              className="secondary"
              disabled={
                !mode ||
                !data.editable ||
                !reviewer.trim() ||
                !rationale.trim() ||
                busy ||
                stale ||
                !rows.every((row) => row.label.trim() && row.value.trim() && row.wording.trim())
              }
              onClick={() => void save(true)}
            >
              Save unresolved draft
            </button>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            Return to specification decision
          </button>
        </div>
      </section>
      {!!data.history.length && (
        <details className="correction-history">
          <summary>Correction revision history</summary>
          {data.history
            .filter((event) => event.intent.group_id === group)
            .map((event, i, events) => (
              <article key={event.id}>
                <strong>
                  {event.intent.disposition === 'draft'
                    ? i === events.length - 1
                      ? 'Latest unresolved draft — not applied'
                      : 'Earlier unresolved draft — not applied'
                    : event.facts.some((fact) =>
                          data.correction_records?.some((record) => record.fact_id === fact.id),
                        )
                      ? 'Effective current revision'
                      : 'Superseded revision'}{' '}
                  {event.revision}
                </strong>
                <p>
                  {event.actor.identifier} · {event.recorded_at}
                </p>
                <p>{event.intent.rationale}</p>
                {event.intent.statements.map((row, n) => (
                  <p key={n}>
                    {row.label}: {row.value} {row.unit} ·{' '}
                    {event.intent.disposition === 'draft'
                      ? 'Retained review intent — no engineering authority'
                      : row.mapping
                        ? propertyName(row.mapping.target)
                        : 'Unresolved engineering meaning'}
                  </p>
                ))}
                <details>
                  <summary>Source statements and citations</summary>
                  <ReviewValue
                    value={event.intent.statements.map((row) => ({
                      wording: row.wording,
                      conditions: row.conditions,
                      evidence: row.citations,
                    }))}
                  />
                </details>
              </article>
            ))}
        </details>
      )}
    </div>
  );
}
