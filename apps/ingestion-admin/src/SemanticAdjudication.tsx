import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  OperatorApi,
  OperatorJobDetail,
  SemanticDecisionInput,
  SemanticTargetResponse,
} from './api.js';
import { OperatorApiError } from './api.js';
import type { ReviewedSemanticMappingPreview } from '@expedition/ingestion';
import { ReviewValue, SourceLink } from './ReviewValue.js';
import { ReviewerPropertyPicker, propertyName } from './ReviewerProperties.js';
import {
  SourceEvidencePanel,
  initialEvidenceBinding,
  sourceScopeWarning,
} from './SourceEvidencePanel.js';
import { ReviewHelp } from './ReviewHelp.js';
import { HumanSourceEditor } from './HumanSourceEditor.js';

type SemanticReview = NonNullable<OperatorJobDetail['semantic_review']>;
type SemanticWorkItem = SemanticReview['work']['required'][number];
type ProductReviewData = NonNullable<OperatorJobDetail['product_review']>;
type ProductField = ProductReviewData['fields'][number];
type ProductQualifiedValue = NonNullable<ProductReviewData['qualified_values']>[number];
type StaleResult = false | 'reloaded' | 'reload_failed';
type FieldResolution = { selected_fact_id: string; rationale: string };

interface ProductReviewControls {
  review?: ProductReviewData;
  fieldDecisions: Record<string, string>;
  resolutions: Record<string, FieldResolution>;
  qualifiedSelections: Record<string, boolean>;
  factDecisions: Record<string, string>;
  onFieldDecision: (field: string, decision: string) => void;
  onResolutionChange: (field: string, resolution: FieldResolution) => void;
  onQualifiedSelection: (id: string, selected: boolean) => void;
  onFactDecision: (id: string, decision: string) => void;
}
const noProductReview: ProductReviewControls = {
  fieldDecisions: {},
  resolutions: {},
  qualifiedSelections: {},
  factDecisions: {},
  onFieldDecision: () => {},
  onResolutionChange: () => {},
  onQualifiedSelection: () => {},
  onFactDecision: () => {},
};

interface CardProductReview {
  field?: ProductField;
  ownsFieldDecision: boolean;
  fieldDecision: string;
  resolution?: FieldResolution;
  resolutionRequired: boolean;
  onFieldDecision: (decision: string) => void;
  onResolutionChange: (resolution: FieldResolution) => void;
  qualifiedValue?: ProductQualifiedValue;
  ownsQualifiedDecision: boolean;
  qualifiedSelected: boolean;
  onQualifiedSelection: (selected: boolean) => void;
  evidenceDecisions: ProductReviewData['candidate_facts'];
  factDecisions: Record<string, string>;
  onFactDecision: (id: string, decision: string) => void;
  factOwners: ReadonlyMap<string, string>;
  fieldOwners: ReadonlyMap<string, string>;
  qualifiedOwners: ReadonlyMap<string, string>;
}

const outcomes = [
  {
    value: 'map',
    label: 'Map this specification',
    explanation:
      "Choose what this manufacturer specification means. Expedition converts its value into the selected property's units.",
  },
  {
    value: 'evidence_only',
    label: 'Keep as source evidence',
    explanation: 'Keep useful manufacturer information without assigning an engineering property.',
  },
  {
    value: 'schema_gap',
    label: 'Report a possible missing property',
    explanation:
      'Describe a possible missing engineering concept. A missing search match alone does not establish a contract gap; this decision creates no property.',
  },
  {
    value: 'reject',
    label: 'Reject this source interpretation',
    explanation:
      'The extracted interpretation is wrong or unreliable. Keep the original evidence and explain the problem.',
  },
  {
    value: 'not_applicable',
    label: 'Not applicable to this component',
    explanation:
      'The source statement may be valid for a sibling model or another operating context, but does not apply to this component.',
  },
  {
    value: 'unresolved',
    label: 'Leave unresolved',
    explanation:
      'Record that you reviewed this specification but cannot safely establish its meaning, conditions or model applicability. You can revisit it later.',
  },
] as const;

function Section({
  title,
  items,
  empty,
  render,
}: {
  title: string;
  items: readonly SemanticWorkItem[];
  empty?: string;
  render: (item: SemanticWorkItem) => ReactNode;
}) {
  return (
    <section>
      <h3>{title}</h3>
      {items.length ? items.map(render) : <p>{empty ?? 'None.'}</p>}
    </section>
  );
}

const itemLabel = (item: SemanticWorkItem) =>
  item.evidence[0]?.label ?? propertyName(item.target ?? item.automatic_target) ?? item.id;

// Automatically retained document evidence and derived results do not acquire a new review obligation.
const canEditSemanticItem = (item: SemanticWorkItem) =>
  !item.derived &&
  (item.required ||
    !!item.active_decision ||
    (item.automatic_disposition === 'mapped' && !item.automatic_retained_evidence));

function SemanticWorkItemCard({
  item,
  allowCorrectionAction = false,
  product,
  onNavigate,
}: {
  item: SemanticWorkItem;
  allowCorrectionAction?: boolean;
  product: CardProductReview;
  onNavigate: (id: string, focusCard?: boolean) => void;
}) {
  const projectedValue = product.field?.display_value ?? product.field?.value;
  const semanticValue = item.display_value ?? item.value ?? item.automatic_value;
  const projectedValueAddsInformation =
    product.field && JSON.stringify(projectedValue) !== JSON.stringify(semanticValue);

  return (
    <article id={`semantic-${encodeURIComponent(item.id)}`} tabIndex={-1}>
      <h4>{itemLabel(item)}</h4>
      <details>
        <summary>Automatic proposal details</summary>
        <code>{item.automatic_target}</code>
      </details>
      {canEditSemanticItem(item) && (
        <button type="button" onClick={() => onNavigate(item.id)}>
          Open specification review
        </button>
      )}
      <p>
        Proposal {item.id} · automatic disposition: {item.automatic_disposition} · state:{' '}
        {item.state}
      </p>
      {item.automatic_disposition === 'mapped' &&
        item.automatic_value !== undefined &&
        item.active_decision?.outcome !== 'map' && (
          <p>
            {item.derived
              ? 'Calculated / derived value: '
              : item.active_decision
                ? 'Prior automatic proposal value (not currently projected): '
                : item.value_origin === 'normalized / converted'
                  ? 'Normalized / converted canonical value: '
                  : 'Automatically mapped canonical value: '}
            <ReviewValue value={item.display_value ?? item.automatic_value} />{' '}
            {item.canonical_unit ?? ''}
          </p>
        )}
      {item.derived && (
        <p>Calculated / derived result; derived proposals are not human semantic evidence.</p>
      )}
      {item.semantic_assertions && (
        <details>
          <summary>Semantic rules and source conditions</summary>
          <ReviewValue value={item.semantic_assertions} />
          <p>
            These conditions describe the source rating. Mapping does not establish installation
            applicability or engineering verification.
          </p>
        </details>
      )}
      {item.automatic_retained_evidence && (
        <details>
          <summary>Automatically retained evidence</summary>
          <p>
            No engineering projection. The source remains available for future interpretation; no
            human mapping decision is required for this classification.
          </p>
          <ReviewValue value={item.automatic_retained_evidence} />
        </details>
      )}
      {item.target && (
        <p>
          Human-adjudicated target: <strong>{item.target}</strong>
        </p>
      )}
      {item.value !== undefined && (
        <p>
          Normalized / converted canonical value:{' '}
          <ReviewValue value={item.display_value ?? item.value} />{' '}
          {item.normalized_unit ?? item.canonical_unit ?? ''}
        </p>
      )}
      {item.evidence.length > 0 &&
        !product.field &&
        !product.qualifiedValue &&
        !item.required &&
        !item.active_decision && (
          <div>
            <h5>SOURCE-STATED</h5>
            {item.evidence.map((fact) => (
              <p key={fact.id}>
                {fact.label ?? 'Source label unavailable'}: <ReviewValue value={fact.raw_value} />
                {fact.unit ? ` · Retained source unit: ${fact.unit}` : ''}
              </p>
            ))}
          </div>
        )}
      {item.evidence.map((fact) => (
        <details key={fact.id} className="source-evidence" open={!!product.field}>
          <summary>
            Source-stated evidence · {fact.label ?? 'Source label unavailable'} · {fact.id}
          </summary>
          {(product.field || product.qualifiedValue) && <h5>SOURCE-STATED</h5>}
          <dl>
            <dt>Exact source assertion</dt>
            <dd>
              <ReviewValue value={fact.raw_value} />
            </dd>
            <dt>Retained source-unit metadata</dt>
            <dd>{fact.unit ?? 'Not separately specified'}</dd>
            <dt>Source / document</dt>
            <dd>
              {fact.document ?? 'Document title unavailable'} · <SourceLink uri={fact.source_uri} />
            </dd>
            <dt>Applicability and qualification</dt>
            <dd>
              <ReviewValue value={fact.applicability} /> · {fact.qualification ?? 'Unknown'}
            </dd>
            <dt>Source locator</dt>
            <dd>
              <ReviewValue value={fact.locators} />
            </dd>
          </dl>
          {product.evidenceDecisions.some((candidate) => candidate.id === fact.id) &&
            (product.factOwners.get(fact.id) === item.id ? (
              <label>
                Product evidence handling for {fact.id}
                <select
                  value={product.factDecisions[fact.id] ?? ''}
                  aria-label={`Product evidence handling for ${fact.id}`}
                  onChange={(event) => product.onFactDecision(fact.id, event.target.value)}
                >
                  <option value="">No additional evidence decision</option>
                  <option value="reviewed">Reviewed as evidence only</option>
                  <option value="exclude">Exclude fact from product approval</option>
                </select>
              </label>
            ) : (
              <p>
                Product evidence handling is available on{' '}
                <button
                  type="button"
                  onClick={() => onNavigate(product.factOwners.get(fact.id) ?? '', true)}
                >
                  its primary review card
                </button>
                .
              </p>
            ))}
        </details>
      ))}
      {item.active_decision && (
        <p>
          Active human decision: revision {item.active_decision.revision},{' '}
          {item.active_decision.outcome} by {item.active_decision.actor_label} at{' '}
          {item.active_decision.recorded_at}.
        </p>
      )}
      {!!item.decision_history?.length && (
        <details>
          <summary>Append-only decision history ({item.decision_history.length} revisions)</summary>
          <ol>
            {item.decision_history.map((decision) => (
              <li key={decision.id}>
                Revision {decision.revision} · {decision.outcome}
                {decision.active ? ' · current' : ' · superseded'} · {decision.actor_label} ·{' '}
                {decision.recorded_at}
                {decision.target ? ` · ${decision.target}` : ''}
                {decision.rationale ? ` · ${decision.rationale}` : ''}
              </li>
            ))}
          </ol>
          <p>A correction appends a new revision; earlier decisions are never edited in place.</p>
        </details>
      )}
      {allowCorrectionAction && (
        <button
          type="button"
          onClick={() => {
            onNavigate(item.id);
          }}
        >
          Review / correct automatic mapping
        </button>
      )}
      {product.field && (
        <section aria-label={`Product field approval for ${product.field.path}`}>
          <h5>PRODUCT FIELD APPROVAL</h5>
          <p>
            Projected candidate field: <strong>{product.field.path}</strong>
          </p>
          {projectedValueAddsInformation && (
            <p>
              Candidate canonical value: <ReviewValue value={projectedValue} />{' '}
              {product.field.canonical_unit ?? ''}
            </p>
          )}
          {product.ownsFieldDecision ? (
            <>
              <label>
                Product field decision for {product.field.path}
                <select
                  value={product.fieldDecision}
                  onChange={(event) => product.onFieldDecision(event.target.value)}
                >
                  <option value="">Not reviewed</option>
                  <option value="approve">Approve / include field</option>
                  <option value="exclude">Exclude field</option>
                </select>
              </label>
              {product.resolutionRequired && (
                <details>
                  <summary>Resolve multiple supporting facts for {product.field.path}</summary>
                  <label>
                    Selected supporting fact for {product.field.path}
                    <select
                      value={product.resolution?.selected_fact_id ?? ''}
                      onChange={(event) =>
                        product.onResolutionChange({
                          rationale: product.resolution?.rationale ?? '',
                          selected_fact_id: event.target.value,
                        })
                      }
                    >
                      <option value="">Use all supporting evidence</option>
                      {product.field.candidate_fact_ids.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Resolution rationale for {product.field.path}
                    <textarea
                      value={product.resolution?.rationale ?? ''}
                      onChange={(event) =>
                        product.onResolutionChange({
                          selected_fact_id: product.resolution?.selected_fact_id ?? '',
                          rationale: event.target.value,
                        })
                      }
                    />
                  </label>
                </details>
              )}
            </>
          ) : (
            <p>
              Product field decision is on the primary card for{' '}
              <button
                type="button"
                onClick={() =>
                  onNavigate(product.fieldOwners?.get(product.field?.path ?? '') ?? '', true)
                }
              >
                proposal {product.fieldOwners?.get(product.field.path)}
              </button>
              .
            </p>
          )}
        </section>
      )}
      {product.qualifiedValue &&
        (product.ownsQualifiedDecision ? (
          <label>
            <input
              type="checkbox"
              checked={product.qualifiedSelected}
              onChange={(event) => product.onQualifiedSelection(event.target.checked)}
            />
            Include qualified candidate assertion {product.qualifiedValue.id} in product approval
          </label>
        ) : (
          <p>
            Qualified assertion {product.qualifiedValue.id} is selected on{' '}
            <button
              type="button"
              onClick={() =>
                onNavigate(
                  product.qualifiedOwners.get(product.qualifiedValue?.id ?? '') ?? '',
                  true,
                )
              }
            >
              its primary review card
            </button>
            .
          </p>
        ))}
    </article>
  );
}

export function SemanticAdjudication({
  job,
  client,
  reviewer,
  onUpdate,
  productReview = noProductReview,
}: {
  job: OperatorJobDetail;
  client: OperatorApi;
  reviewer: string;
  onUpdate: (job: OperatorJobDetail) => void;
  productReview?: ProductReviewControls;
}) {
  const semanticReview = job.semantic_review;
  const [selectedId, setSelectedId] = useState<string>();
  const [sourceCorrection, setSourceCorrection] = useState<false | 'correct' | 'add'>(false);
  const [sourceRevisionId, setSourceRevisionId] = useState<string>();
  const [groupedFactIds, setGroupedFactIds] = useState<string[]>();
  const [dirty, setDirty] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);
  const [message, setMessage] = useState('');
  const [queueQuery, setQueueQuery] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const focusRef = useRef<HTMLHeadingElement>(null);
  const [focusCardId, setFocusCardId] = useState<string>();
  const [focusRevision, setFocusRevision] = useState(0);
  useEffect(() => {
    if (!focusRevision) return;
    const destination = focusCardId
      ? document.getElementById('semantic-' + encodeURIComponent(focusCardId))
      : focusRef.current;
    destination?.focus();
    destination?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, focusRevision, focusCardId]);
  const navigate = (id: string, focusCard = false) => {
    if (!id || editorBusy || loadingReview) return;
    if (focusCard) setAdvancedOpen(true);
    if (id === selected?.id) {
      setFocusCardId(focusCard ? id : undefined);
      setFocusRevision((revision) => revision + 1);
      return;
    }
    if (
      editorBusy ||
      loadingReview ||
      (dirty && !window.confirm('Discard unsaved review input and open another specification?'))
    )
      return;
    setDirty(false);
    setSelectedId(id);
    setSourceCorrection(false);
    setSourceRevisionId(undefined);
    setGroupedFactIds(undefined);
    setFocusCardId(focusCard ? id : undefined);
    setMessage('');
    setFocusRevision((revision) => revision + 1);
  };
  const onStale = useCallback(
    async (error: unknown, setError: (message: string) => void) => {
      if (!(error instanceof OperatorApiError) || error.status !== 409) return false;
      try {
        onUpdate(await client.get(job.summary.id));
        setError(
          'The review changed. Current job state was reloaded; inspect the evidence and reconfirm before recording a decision.',
        );
        return 'reloaded' as const;
      } catch {
        setError('The review changed. Reload the job before making another decision.');
        return 'reload_failed' as const;
      }
    },
    [client, job.summary.id, onUpdate],
  );
  if (!semanticReview) return null;
  const requiredIds = (semanticReview.required_dispositions ?? []).map((item) => item.proposal_id);
  const work = semanticReview.work;
  const allItems = [...work.required, ...work.reviewed, ...work.automatic, ...work.derived];
  const selected = allItems.find(
    (item) =>
      item.id ===
      (selectedId ??
        work.required[0]?.id ??
        work.reviewed[0]?.id ??
        (job.human_adjudication?.editable
          ? work.automatic.find(canEditSemanticItem)?.id
          : undefined)),
  );
  const revisionEvent = job.human_adjudication?.history.find((e) => e.id === sourceRevisionId);
  const revisionFacts = revisionEvent
    ? (job.human_adjudication?.history
        .filter((e) => e.intent.group_id === revisionEvent.intent.group_id && e.facts.length)
        .at(-1)
        ?.facts.map((f) => f.id) ?? [...revisionEvent.intent.replaces_fact_ids])
    : undefined;
  const openSourceCorrection = (mode: 'correct' | 'add', eventId?: string, groupIds?: string[]) => {
    if (
      editorBusy ||
      loadingReview ||
      (dirty && !window.confirm('Discard unsaved input and open this source correction?'))
    )
      return;
    setDirty(false);
    setSourceRevisionId(eventId);
    setGroupedFactIds(groupIds);
    setSourceCorrection(mode);
  };
  const saved = (returned: OperatorJobDetail, next: boolean) => {
    // Only the successful persisted response owns queue advancement. No stale client queue or replay.
    setDirty(false);
    onUpdate(returned);
    const returnedReview = returned.semantic_review;
    if (!returnedReview) {
      setMessage(
        'Decision saved, but the current work queue is unavailable. Reload the durable review before continuing.',
      );
      return;
    }
    const remaining = returnedReview.work.required;
    setMessage(
      remaining.length
        ? 'Decision saved. Product approval and engineering verification remain separate.'
        : returnedReview.complete
          ? 'All required review decisions are recorded. Engineering specifications may remain unresolved; this component is not approved or verified by this save.'
          : 'Decision saved. No next outstanding specification is available in the returned queue; inspect the durable review.',
    );
    if (next) setSelectedId(remaining[0]?.id ?? '');
    setFocusCardId(undefined);
    setFocusRevision((revision) => revision + 1);
  };
  const reload = async () => {
    if (
      editorBusy ||
      (dirty &&
        !window.confirm('Discard unsaved review input and return to the durable job review?'))
    )
      return;
    setLoadingReview(true);
    try {
      const returned = await client.get(job.summary.id);
      onUpdate(returned);
      setDirty(false);
      setSelectedId('');
      setFocusCardId(undefined);
      setMessage('Current durable review reloaded. Choose a recorded decision to revisit it.');
      setFocusRevision((revision) => revision + 1);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Durable review could not load. Your input is retained.',
      );
    } finally {
      setLoadingReview(false);
    }
  };
  const fieldsByOwner = new Map<string, ProductField>();
  const qualifiedByOwner = new Map<string, ProductQualifiedValue>();
  const fieldOwners = new Map<string, string>();
  const qualifiedOwners = new Map<string, string>();
  const factOwners = new Map<string, string>();
  // Field approval is field-scoped in the contract, so its first contributing proposal card owns the single control.
  for (const item of allItems) {
    const field = item.projected_field
      ? productReview.review?.fields.find(
          (candidate) => candidate.path === item.projected_field && candidate.selectable,
        )
      : undefined;
    if (field) {
      fieldsByOwner.set(item.id, field);
      if (!fieldOwners.has(field.path)) fieldOwners.set(field.path, item.id);
    }
    const qualifiedValue = item.projected_qualified_value_id
      ? productReview.review?.qualified_values?.find(
          (candidate) => candidate.id === item.projected_qualified_value_id,
        )
      : undefined;
    if (qualifiedValue) {
      qualifiedByOwner.set(item.id, qualifiedValue);
      if (!qualifiedOwners.has(qualifiedValue.id)) qualifiedOwners.set(qualifiedValue.id, item.id);
    }
    for (const fact of item.evidence)
      if (
        productReview.review?.candidate_facts.some((candidate) => candidate.id === fact.id) &&
        !factOwners.has(fact.id)
      )
        factOwners.set(fact.id, item.id);
  }
  const cardProductReview = (item: SemanticWorkItem): CardProductReview => {
    const field = fieldsByOwner.get(item.id);
    const qualifiedValue = qualifiedByOwner.get(item.id);
    const resolutionRequired =
      !!field &&
      (field.candidate_fact_ids.length > 1 ||
        field.proposals.some((proposal) =>
          proposal.evidence.some((evidence) => evidence.conflicts.length > 0),
        ));
    return {
      field,
      ownsFieldDecision: !!field && fieldOwners.get(field.path) === item.id,
      fieldDecision: field ? (productReview.fieldDecisions[field.path] ?? '') : '',
      resolution: field ? productReview.resolutions[field.path] : undefined,
      resolutionRequired,
      onFieldDecision: (decision) => field && productReview.onFieldDecision(field.path, decision),
      onResolutionChange: (resolution) =>
        field && productReview.onResolutionChange(field.path, resolution),
      qualifiedValue,
      ownsQualifiedDecision: !!qualifiedValue && qualifiedOwners.get(qualifiedValue.id) === item.id,
      qualifiedSelected: qualifiedValue
        ? (productReview.qualifiedSelections[qualifiedValue.id] ?? false)
        : false,
      onQualifiedSelection: (selected) =>
        qualifiedValue && productReview.onQualifiedSelection(qualifiedValue.id, selected),
      evidenceDecisions: productReview.review?.candidate_facts ?? [],
      factDecisions: productReview.factDecisions,
      onFactDecision: productReview.onFactDecision,
      factOwners,
      fieldOwners,
      qualifiedOwners,
    };
  };

  const renderItemCard = (item: SemanticWorkItem, allowCorrectionAction = false) => (
    <SemanticWorkItemCard
      key={item.id}
      item={item}
      onNavigate={navigate}
      allowCorrectionAction={allowCorrectionAction}
      product={cardProductReview(item)}
    />
  );

  const queueItems = [
    ...work.required,
    ...work.reviewed,
    ...work.automatic.filter(canEditSemanticItem),
  ];
  const queueMatches = (item: SemanticWorkItem) => {
    const status =
      item.active_decision?.outcome === 'map'
        ? 'mapped reviewed'
        : item.active_decision
          ? 'reviewed ' + item.active_decision.outcome
          : item.required
            ? 'awaiting review'
            : 'automatic suggestion mapped';
    const text = [
      itemLabel(item),
      status,
      outcomes.find((choice) => choice.value === item.active_decision?.outcome)?.label,
      ...item.evidence.flatMap((fact) => [
        fact.label,
        JSON.stringify(fact.raw_value),
        fact.source_context?.wording,
      ]),
    ]
      .join(' ')
      .toLowerCase();
    return queueQuery
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((word) => text.includes(word));
  };

  return (
    <section aria-label="Semantic adjudication" className="specification-review">
      <h2>Specification review</h2>
      <p className="workflow-order">
        1 · Find a specification → 2 · Read manufacturer evidence → 3 · Record engineering
        interpretation
      </p>
      <div className="review-layout">
        <aside className="review-queue" aria-label="Review queue">
          <p role="status">
            {semanticReview.complete
              ? 'Required review decisions recorded. Engineering meaning may remain unresolved; approval and verification are separate.'
              : requiredIds.length + ' specification(s) await a human decision.'}
          </p>
          <label>
            Find a specification
            <input
              type="search"
              value={queueQuery}
              onChange={(event) => setQueueQuery(event.target.value)}
              placeholder="Labels, source values, review status…"
            />
          </label>
          <p className="queue-scope">
            This product/job only · {queueItems.filter(queueMatches).length} of {queueItems.length}{' '}
            specifications match
          </p>
          {queueQuery && (
            <button type="button" onClick={() => setQueueQuery('')}>
              Clear queue search
            </button>
          )}
          {queueQuery && !queueItems.some(queueMatches) && (
            <p role="status">No specifications match. Clear search to see all review groups.</p>
          )}
          <nav aria-label="Specification work queue">
            {[
              ['Awaiting a decision', work.required],
              [
                'Reviewed but engineering meaning unresolved',
                work.reviewed.filter((item) =>
                  ['unresolved', 'schema_gap', 'evidence_only'].includes(
                    item.active_decision?.outcome ?? '',
                  ),
                ),
              ],
              [
                'Recorded decisions',
                work.reviewed.filter(
                  (item) =>
                    !['unresolved', 'schema_gap', 'evidence_only'].includes(
                      item.active_decision?.outcome ?? '',
                    ),
                ),
              ],
              ['Optional automatic corrections', work.automatic.filter(canEditSemanticItem)],
            ]
              .filter(([, items]) => (items as readonly SemanticWorkItem[]).length > 0)
              .map(([title, items]) => (
                <details
                  key={title as string}
                  open={
                    !!queueQuery.trim() ||
                    title === 'Awaiting a decision' ||
                    (title === 'Optional automatic corrections' &&
                      !work.required.length &&
                      !work.reviewed.length)
                  }
                  className="queue-group"
                >
                  <summary>
                    {title as string} (
                    {(items as readonly SemanticWorkItem[]).filter(queueMatches).length}
                    {queueQuery ? ' / ' + (items as readonly SemanticWorkItem[]).length : ''})
                  </summary>
                  <ul>
                    {(items as readonly SemanticWorkItem[]).filter(queueMatches).map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={editorBusy || loadingReview}
                          aria-label={
                            itemLabel(item) +
                            (item.active_decision
                              ? ' · ' +
                                outcomes.find(
                                  (choice) => choice.value === item.active_decision?.outcome,
                                )?.label
                              : '')
                          }
                          aria-current={selected?.id === item.id ? 'true' : undefined}
                          onClick={() => navigate(item.id)}
                        >
                          <strong>{itemLabel(item)}</strong>
                          <small>
                            Source:{' '}
                            {item.evidence
                              .map((fact) =>
                                typeof fact.raw_value === 'object'
                                  ? 'Structured source value'
                                  : String(fact.raw_value ?? 'Unknown value'),
                              )
                              .join(' · ')}
                          </small>
                          {item.active_decision
                            ? ' · ' +
                              outcomes.find(
                                (choice) => choice.value === item.active_decision?.outcome,
                              )?.label
                            : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
          </nav>
          <button
            type="button"
            disabled={editorBusy || loadingReview}
            onClick={() => void reload()}
          >
            Return to saved review
          </button>
        </aside>
        <div className="selected-specification">
          <h3 ref={focusRef} tabIndex={-1}>
            {selected
              ? 'Review: ' + itemLabel(selected)
              : 'Choose a specification to review or revisit'}
          </h3>
          {message && <p role="status">{message}</p>}
          {job.human_adjudication?.editable && !sourceCorrection && (
            <button
              type="button"
              className="correction-entry"
              disabled={editorBusy || loadingReview}
              onClick={() => openSourceCorrection(selected ? 'correct' : 'add')}
            >
              Correct or add information
            </button>
          )}
          {sourceCorrection && job.human_adjudication && (
            <HumanSourceEditor
              key={`${sourceRevisionId ?? selected?.id ?? 'new'}:${sourceCorrection}:${groupedFactIds?.join(',') ?? ''}`}
              job={job}
              client={client}
              reviewer={reviewer}
              priorEventId={sourceRevisionId}
              currentItem={sourceCorrection === 'correct' ? selected : undefined}
              factIds={
                sourceCorrection === 'add'
                  ? []
                  : (groupedFactIds ?? revisionFacts ?? selected?.evidence.map((f) => f.id) ?? [])
              }
              onDirty={setDirty}
              onBusy={setEditorBusy}
              onSaved={(next) => {
                setSourceCorrection(false);
                setSourceRevisionId(undefined);
                setGroupedFactIds(undefined);
                saved(next, false);
                // The persisted response owns the replacement proposal IDs.
                // Source corrections change IDs; select their effective facts,
                // not the now-superseded client proposal or an arbitrary next item.
                const event = next.human_adjudication?.history.at(-1);
                const changedIds = event?.facts.length
                  ? event.facts.map((fact) => fact.id)
                  : (event?.intent.replaces_fact_ids ?? []);
                const returnedWork = next.semantic_review?.work;
                const updated =
                  returnedWork &&
                  [
                    ...returnedWork.required,
                    ...returnedWork.reviewed,
                    ...returnedWork.automatic,
                  ].find((item) => item.evidence.some((fact) => changedIds.includes(fact.id)));
                if (updated) setSelectedId(updated.id);
                setMessage(
                  event?.intent.disposition === 'draft'
                    ? 'Unresolved correction draft saved. Its source and reason remain available in correction history.'
                    : 'Correction saved. The current effective record is shown; approval and verification remain separate.',
                );
              }}
              onClose={() => {
                if (
                  !dirty ||
                  window.confirm(
                    'Discard unsaved source correction and return to specification review?',
                  )
                ) {
                  setSourceCorrection(false);
                  setSourceRevisionId(undefined);
                  setGroupedFactIds(undefined);
                  setDirty(false);
                }
              }}
            />
          )}
          {/* Freeze input during durable reload so its response cannot discard input entered after the discard confirmation. */}
          {!sourceCorrection && selected && canEditSemanticItem(selected) && (
            <fieldset disabled={loadingReview} aria-label="Active specification review">
              <SemanticDecisionEditor
                key={selected.id}
                item={selected}
                job={job}
                client={client}
                reviewer={reviewer}
                onStale={onStale}
                onSaved={saved}
                onDirty={setDirty}
                onBusy={setEditorBusy}
              />
            </fieldset>
          )}
        </div>
      </div>
      <details
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        className="advanced-review"
      >
        <summary>Product field approval and advanced proposal details</summary>
        <p>
          Product approval choices are separate from specification decisions. Expand a source entry
          to inspect exact locators and prior automatic results.
        </p>
        {advancedOpen && (
          <div id="semantic-required">
            <Section
              title="REVIEW REQUIRED"
              items={work.required}
              empty="No semantic dispositions remain outstanding."
              render={(item) => renderItemCard(item)}
            />
            <Section
              title="REVIEWED / DISPOSITIONED"
              items={work.reviewed}
              empty="No human dispositions have been recorded."
              render={(item) => renderItemCard(item)}
            />
            <Section
              title="AUTOMATICALLY MAPPED"
              items={work.automatic.filter((item) => !item.automatic_retained_evidence)}
              empty="No automatically mapped engineering proposals."
              render={(item) =>
                renderItemCard(item, item.automatic_disposition === 'mapped' && !item.derived)
              }
            />
            {work.automatic.some((item) => item.automatic_retained_evidence) && (
              <Section
                title="AUTOMATICALLY RETAINED EVIDENCE"
                items={work.automatic.filter((item) => item.automatic_retained_evidence)}
                render={(item) => renderItemCard(item)}
              />
            )}
            <Section
              title="DERIVED / CALCULATED"
              items={work.derived}
              empty="No derived semantic proposals."
              render={(item) => renderItemCard(item)}
            />
          </div>
        )}
      </details>
      {!!job.human_adjudication?.history.length && (
        <details className="advanced-review">
          <summary>
            Human source correction history ({job.human_adjudication.history.length})
          </summary>
          {job.human_adjudication.history.map((event) => (
            <article key={event.id}>
              <h4>
                {event.intent.action} · revision {event.revision} ·{' '}
                {event.intent.disposition === 'draft'
                  ? 'Unresolved draft — no engineering scope'
                  : 'Source-adjudicated'}
              </h4>
              <p>
                {event.actor.identifier} (local operator label) · {event.recorded_at}
              </p>
              <p>{event.intent.rationale}</p>
              {event.intent.statements.map((statement, i) => (
                <div key={i}>
                  <strong>{statement.label}</strong>
                  <p>
                    Human source value: {statement.value} {statement.unit ?? ''}
                  </p>
                  <p>Manufacturer wording: {statement.wording}</p>
                  <p>
                    Engineering meaning:{' '}
                    {statement.mapping ? propertyName(statement.mapping.target) : 'Unresolved'}
                  </p>
                </div>
              ))}
              {job.human_adjudication?.editable &&
                job.human_adjudication.history
                  .filter((e) => e.intent.group_id === event.intent.group_id)
                  .at(-1)?.id === event.id && (
                  <button
                    type="button"
                    disabled={editorBusy || loadingReview}
                    onClick={() =>
                      openSourceCorrection(
                        event.intent.replaces_fact_ids.length || event.facts.length
                          ? 'correct'
                          : 'add',
                        event.id,
                      )
                    }
                  >
                    Reopen this source correction
                  </button>
                )}
            </article>
          ))}
        </details>
      )}
      {!!job.human_adjudication?.archived_history?.length && (
        <details className="advanced-review">
          <summary>Earlier source captures · archived human corrections</summary>
          <p>
            These records belong to earlier retained preparations. They remain read-only and do not
            apply to the current source capture.
          </p>
          {job.human_adjudication.archived_history.map((archive) => (
            <article key={archive.review_snapshot}>
              <h4>Archived at {archive.requested_at}</h4>
              {archive.events.map((event) => (
                <details key={event.id}>
                  <summary>
                    {event.actor.identifier} · {event.recorded_at} ·{' '}
                    {event.intent.disposition === 'draft'
                      ? 'Unresolved draft'
                      : 'Source correction'}
                  </summary>
                  <p>{event.intent.rationale}</p>
                  <ReviewValue value={event} />
                </details>
              ))}
            </article>
          ))}
        </details>
      )}
    </section>
  );
}

function SemanticDecisionEditor({
  item,
  job,
  client,
  reviewer,
  onStale,
  onSaved,
  onDirty,
  onBusy,
}: {
  item: SemanticWorkItem;
  job: OperatorJobDetail;
  client: OperatorApi;
  reviewer: string;
  onSaved: (job: OperatorJobDetail, next: boolean) => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
  onStale: (error: unknown, setError: (message: string) => void) => Promise<StaleResult>;
}) {
  const semanticReview = job.semantic_review!;
  const [outcome, setOutcome] = useState<(typeof outcomes)[number]['value'] | ''>('');
  const [selectedFactIds, setSelectedFactIds] = useState<string[]>(() =>
    initialEvidenceBinding(item),
  );
  const [targets, setTargets] = useState<SemanticTargetResponse['targets']>([]);
  const [target, setTarget] = useState('');
  const [sourceUnit, setSourceUnit] = useState('');
  const [previewRevision, setPreviewRevision] = useState(0);
  const [rationale, setRationale] = useState('');
  const [conceptKey, setConceptKey] = useState('');
  const [explanation, setExplanation] = useState('');
  const [preview, setPreview] = useState<{
    intentKey: string;
    value: ReviewedSemanticMappingPreview;
  }>();
  const previewIntentRef = useRef('');
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [discoveryState, setDiscoveryState] = useState<
    'idle' | 'loading' | 'ready' | 'failed' | 'stale'
  >('idle');
  const [discoveryRevision, setDiscoveryRevision] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmedSnapshot, setConfirmedSnapshot] = useState(
    semanticReview.expected_review_snapshot,
  );
  const [conflict, setConflict] = useState<'none' | 'reloaded' | 'reload_failed'>('none');
  const snapshotMatches =
    conflict === 'none' && confirmedSnapshot === semanticReview.expected_review_snapshot;
  const handleFailure = async (caught: unknown, fallback: string) => {
    const result = await onStale(caught, setError);
    if (result) setConflict(result);
    else setError(caught instanceof Error ? caught.message : fallback);
  };
  useEffect(() => {
    onDirty(
      !!(
        outcome ||
        rationale ||
        conceptKey ||
        explanation ||
        target ||
        sourceUnit ||
        selectedFactIds.join('|') !== initialEvidenceBinding(item).join('|')
      ),
    );
  }, [outcome, rationale, conceptKey, explanation, target, sourceUnit, selectedFactIds, onDirty]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  const selectedFactsAreCurrent =
    selectedFactIds.length > 0 &&
    selectedFactIds.every((id) => item.evidence.some((fact) => fact.id === id));
  const selectedKey = selectedFactIds.join('|');
  const selectedOutcome = outcomes.find((choice) => choice.value === outcome);
  const intentKey = (nextTarget: string, nextSourceUnit: string, factIds: string[]) =>
    JSON.stringify({
      target: nextTarget,
      source_unit: nextSourceUnit.trim(),
      selected_fact_ids: factIds,
    });
  const currentIntentKey = intentKey(target, sourceUnit, selectedFactIds);
  const currentPreview =
    snapshotMatches &&
    discoveryState === 'ready' &&
    targets.some((entry) => entry.canonical_field === target) &&
    preview?.intentKey === currentIntentKey &&
    previewIntentRef.current === currentIntentKey
      ? preview.value
      : undefined;

  // Event handlers advance this guard before React effects run, so an older request
  // cannot restore a preview after the operator changes mapping intent.
  useEffect(() => {
    if (!snapshotMatches) {
      setDiscoveryState('stale');
      setLoadingTargets(false);
      return;
    }
    if (outcome !== 'map' || !selectedFactsAreCurrent) {
      setDiscoveryState('idle');
      previewIntentRef.current = intentKey('', '', selectedFactIds);
      setTargets([]);
      setTarget('');
      setSourceUnit('');
      setPreview(undefined);
      return;
    }
    let active = true;
    setLoadingTargets(true);
    setDiscoveryState('loading');
    setTargets([]);
    setPreview(undefined);
    previewIntentRef.current = intentKey(target, sourceUnit, selectedFactIds);
    void client
      .semanticTargets(job.summary.id, item.id, {
        expected_review_snapshot: semanticReview.expected_review_snapshot,
        selected_fact_ids: selectedFactIds,
      })
      .then((result) => {
        if (active) {
          setTargets(result.targets);
          setDiscoveryState('ready');
          if (target && !result.targets.some((descriptor) => descriptor.canonical_field === target))
            setTarget('');
        }
      })
      .catch(async (caught: unknown) => {
        if (active) {
          setDiscoveryState('failed');
          await handleFailure(caught, 'Engineering properties could not load.');
        }
      })
      .finally(() => {
        if (active) setLoadingTargets(false);
      });
    return () => {
      active = false;
    };
  }, [
    client,
    item.id,
    job.summary.id,
    onStale,
    outcome,
    selectedFactIds,
    selectedKey,
    discoveryRevision,
    semanticReview.expected_review_snapshot,
    confirmedSnapshot,
    snapshotMatches,
  ]);

  useEffect(() => {
    if (
      !snapshotMatches ||
      discoveryState !== 'ready' ||
      outcome !== 'map' ||
      !target ||
      !targets.some((entry) => entry.canonical_field === target) ||
      !selectedFactsAreCurrent
    ) {
      setLoadingPreview(false);
      return;
    }
    let active = true;
    const requestedIntentKey = intentKey(target, sourceUnit, selectedFactIds);
    setLoadingPreview(true);
    setPreview(undefined);
    void client
      .semanticPreview(job.summary.id, item.id, {
        expected_review_snapshot: semanticReview.expected_review_snapshot,
        selected_fact_ids: selectedFactIds,
        target,
        ...(sourceUnit.trim() ? { source_unit: sourceUnit.trim() } : {}),
      })
      .then((result) => {
        if (active && previewIntentRef.current === requestedIntentKey)
          setPreview({ intentKey: requestedIntentKey, value: result });
      })
      .catch(async (caught: unknown) => {
        if (active) await handleFailure(caught, 'Mapping preview failed.');
      })
      .finally(() => {
        if (active) setLoadingPreview(false);
      });
    return () => {
      active = false;
    };
  }, [
    client,
    item.id,
    job.summary.id,
    onStale,
    outcome,
    selectedKey,
    semanticReview.expected_review_snapshot,
    confirmedSnapshot,
    snapshotMatches,
    sourceUnit,
    selectedFactIds,
    target,
    discoveryState,
    targets,
    previewRevision,
  ]);

  const submit = async (next = false) => {
    if (!snapshotMatches || !selectedFactsAreCurrent || busy) return;
    if (!selectedOutcome || !reviewer.trim() || selectedFactIds.length === 0) return;
    const common = {
      proposal_id: item.id,
      expected_review_snapshot: semanticReview.expected_review_snapshot,
      selected_fact_ids: selectedFactIds,
      actor_label: reviewer.trim(),
    };
    let input: SemanticDecisionInput;
    if (outcome === 'map') {
      if (!currentPreview || !rationale.trim()) return;
      // Persist the exact domain-produced preview; the browser never computes or edits this value.
      input = {
        ...common,
        outcome,
        target,
        normalized_value: currentPreview.normalized_value,
        normalized_unit: currentPreview.normalized_unit,
        ...(sourceUnit.trim() ? { source_unit: sourceUnit.trim() } : {}),
        rationale: rationale.trim(),
      };
    } else if (outcome === 'schema_gap') {
      if (!conceptKey.trim() || !explanation.trim() || !rationale.trim()) return;
      input = {
        ...common,
        outcome,
        schema_gap: { concept_key: conceptKey.trim(), explanation: explanation.trim() },
        rationale: rationale.trim(),
      };
    } else if (outcome === 'reject' || outcome === 'not_applicable') {
      if (!rationale.trim()) return;
      input = { ...common, outcome, rationale: rationale.trim() };
    } else if (outcome === 'evidence_only' || outcome === 'unresolved') {
      input = {
        ...common,
        outcome,
        ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
      };
    } else {
      return;
    }
    setBusy(true);
    setError('');
    setSaveFailed(false);
    try {
      const returned = await client.semanticDecision(job.summary.id, input);
      if (returned.semantic_review)
        setConfirmedSnapshot(returned.semantic_review.expected_review_snapshot);
      setConflict('none');
      onSaved(returned, next);
    } catch (caught) {
      setSaveFailed(true);
      await handleFailure(caught, 'Decision could not save.');
    } finally {
      setBusy(false);
    }
  };

  const rationaleRequired = ['map', 'schema_gap', 'reject', 'not_applicable'].includes(outcome);
  const canSubmit =
    snapshotMatches &&
    !!outcome &&
    !!reviewer.trim() &&
    selectedFactsAreCurrent &&
    !busy &&
    (!rationaleRequired || !!rationale.trim()) &&
    (outcome !== 'map' || (!!target && !!currentPreview && !loadingPreview)) &&
    (outcome !== 'schema_gap' || (!!conceptKey.trim() && !!explanation.trim()));

  return (
    <div className="specification-workspace">
      <SourceEvidencePanel
        item={item}
        job={job}
        selectedFactIds={selectedFactIds}
        disabled={busy}
        onSelectionChange={(nextFactIds) => {
          previewIntentRef.current = intentKey('', '', nextFactIds);
          setDiscoveryState('idle');
          setTargets([]);
          setError('');
          setSelectedFactIds(nextFactIds);
          setTarget('');
          setSourceUnit('');
          setPreview(undefined);
        }}
      />
      <fieldset className="semantic-editor" disabled={busy}>
        <section className="current-interpretation" aria-label="Current engineering interpretation">
          <h3>Current engineering interpretation</h3>
          {item.active_decision ? (
            <>
              <strong>
                {item.active_decision.outcome === 'map'
                  ? 'Human-reviewed mapping · ' +
                    propertyName(item.target ?? item.active_decision.target ?? '')
                  : outcomes.find((choice) => choice.value === item.active_decision?.outcome)
                      ?.label}
              </strong>
              <p>
                Recorded decision:{' '}
                {outcomes.find((choice) => choice.value === item.active_decision?.outcome)?.label} ·
                revision {item.active_decision.revision} · {item.active_decision.actor_label}.
              </p>
              {item.active_decision.outcome === 'map' && (
                <p>
                  Normalized representation:{' '}
                  <ReviewValue value={item.display_value ?? item.value} />{' '}
                  {item.normalized_unit ?? item.canonical_unit ?? ''}.{' '}
                  {item.projected_field || item.projected_qualified_value_id
                    ? 'Represented in the current candidate review; approval remains separate.'
                    : 'Recorded mapping is not currently represented in the candidate.'}
                </p>
              )}
              {item.active_decision.rationale && <p>{item.active_decision.rationale}</p>}
              {item.active_decision.schema_gap && (
                <p>
                  Possible missing concept: {item.active_decision.schema_gap.concept_key}.{' '}
                  {item.active_decision.schema_gap.explanation}
                </p>
              )}
            </>
          ) : item.automatic_disposition === 'mapped' ? (
            <>
              <strong>Automatic suggestion · {propertyName(item.automatic_target)}</strong>
              <p>Provisional automatic interpretation; no human mapping decision recorded.</p>
              <p>
                Automatic normalized representation: <ReviewValue value={item.automatic_value} />{' '}
                {item.canonical_unit ?? ''}
              </p>
            </>
          ) : (
            <>
              <strong>No engineering property assigned</strong>
              <p>This specification has no durable human mapping.</p>
            </>
          )}
          {job.candidate?.non_projected
            .filter((entry) => entry.proposal_id === item.id)
            .map((entry) => (
              <p className="source-warning" key={entry.proposal_id}>
                Server projection reason: {entry.reason}
              </p>
            ))}
          {item.evidence.map(
            (fact) =>
              sourceScopeWarning(fact, job) && (
                <p className="source-warning" key={fact.id}>
                  {sourceScopeWarning(fact, job)}
                </p>
              ),
          )}
          {item.evidence.some(
            (fact) =>
              fact.source_context?.duration ||
              fact.source_context?.temperature ||
              fact.source_context?.conditions?.length,
          ) && (
            <p className="source-warning">
              Material source conditions are retained beside the original value. Scalar mapping
              cannot discard them; server discovery and preview remain required.
            </p>
          )}
          {(item.active_decision || item.automatic_disposition === 'mapped') && (
            <button
              type="button"
              onClick={() => document.getElementById('review-outcome')?.focus()}
            >
              Review / correct interpretation
            </button>
          )}
        </section>
        <h3>Record a review decision</h3>
        <p>
          Saving records your review decision. It does not approve, publish or engineering-verify
          this component.
        </p>
        {!snapshotMatches && (
          <div role="alert">
            <p>
              The review snapshot changed. Your input is retained. Inspect the current evidence
              before rechecking; no decision was replayed.
            </p>
            {conflict === 'reload_failed' ? (
              <button
                type="button"
                onClick={() =>
                  void handleFailure(
                    new OperatorApiError(409, 'Reload requested'),
                    'Current review could not load.',
                  )
                }
              >
                Reload current review
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPreview(undefined);
                  setConflict('none');
                  setConfirmedSnapshot(semanticReview.expected_review_snapshot);
                }}
              >
                Review current evidence and recheck
              </button>
            )}
          </div>
        )}
        {item.decision_history?.length ? (
          <p>This records a new revision; it does not edit the current or prior decision.</p>
        ) : null}
        <ReviewHelp topic="Choosing a review decision">
          Mapping assigns an engineering meaning. Keep as source evidence stores useful information
          without that assignment. Leave unresolved when meaning, conditions or model scope remain
          uncertain. A possible missing property reports a gap and creates no field. Reject a wrong
          interpretation; use Not applicable for valid evidence belonging to another component or
          context.
        </ReviewHelp>
        <label>
          Review decision
          <select
            id="review-outcome"
            value={outcome}
            onChange={(event) => {
              const nextOutcome = event.target.value as typeof outcome;
              if (nextOutcome !== 'map') {
                previewIntentRef.current = '';
                setPreview(undefined);
              } else {
                previewIntentRef.current = intentKey(target, sourceUnit, selectedFactIds);
              }
              setOutcome(nextOutcome);
            }}
          >
            <option value="">Choose a review decision</option>
            {outcomes.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        {selectedOutcome && <p>{selectedOutcome.explanation}</p>}
        {!selectedFactsAreCurrent && selectedFactIds.length > 0 && (
          <div role="alert">
            <p>
              A previously bound fact is absent from the current item. Select current evidence
              before saving; old evidence references will not be replayed.
            </p>
            <button
              type="button"
              onClick={() => {
                const currentIds = initialEvidenceBinding({ ...item, active_decision: undefined });
                previewIntentRef.current = intentKey('', '', currentIds);
                setSelectedFactIds(currentIds);
                setTarget('');
                setSourceUnit('');
                setPreview(undefined);
              }}
            >
              Use current supporting facts
            </button>
          </div>
        )}
        {outcome === 'map' && (
          <>
            <ReviewerPropertyPicker
              targets={targets}
              value={target}
              loading={loadingTargets}
              discoveryState={discoveryState}
              onChange={(nextTarget) => {
                previewIntentRef.current = intentKey(nextTarget, '', selectedFactIds);
                setError('');
                setPreview(undefined);
                setSourceUnit('');
                setTarget(nextTarget);
              }}
            />
            {discoveryState === 'failed' && (
              <button
                type="button"
                onClick={() => setDiscoveryRevision((revision) => revision + 1)}
              >
                Retry property discovery
              </button>
            )}
            {targets.length === 0 && discoveryState === 'ready' && !loadingTargets && (
              <p>
                No target is eligible for the selected evidence, or the source facts need review.
              </p>
            )}
            {target && (
              <>
                {targets.find((descriptor) => descriptor.canonical_field === target)
                  ?.allows_unit_conversion && (
                  <label>
                    Source unit clarification (only when retained evidence does not establish it)
                    <input
                      value={sourceUnit}
                      onChange={(event) => {
                        const nextSourceUnit = event.target.value;
                        previewIntentRef.current = intentKey(
                          target,
                          nextSourceUnit,
                          selectedFactIds,
                        );
                        setPreview(undefined);
                        setSourceUnit(nextSourceUnit);
                      }}
                      placeholder="Leave blank to use retained source evidence"
                    />
                  </label>
                )}
                <p>
                  Selected engineering meaning: <strong>{propertyName(target)}</strong>
                </p>
                {loadingPreview && <p role="status">Requesting server mapping preview…</p>}
                {currentPreview && !loadingPreview && (
                  <div className="semantic-preview">
                    <h5>Value conversion preview</h5>
                    <ReviewHelp topic="Source value and converted value">
                      Source-stated values are the manufacturer assertions. Expedition computes the
                      normalized value using server rules and supported units. Successful conversion
                      does not prove exact model applicability, preserve unsupported conditions, or
                      guarantee representation in a candidate.
                    </ReviewHelp>
                    <p>
                      Source-stated value(s):{' '}
                      {currentPreview.source_assertions.map((assertion) => (
                        <span key={assertion.fact_id}>
                          <ReviewValue value={assertion.raw_value} />
                        </span>
                      ))}
                    </p>
                    {currentPreview.source_assertions.some(
                      (assertion) => assertion.source_unit || assertion.effective_source_unit,
                    ) && (
                      <p>
                        Resolved source unit:{' '}
                        {currentPreview.source_assertions
                          .map(
                            (assertion) =>
                              `${assertion.source_unit ?? assertion.effective_source_unit}`,
                          )
                          .join('; ')}
                      </p>
                    )}
                    <p>
                      Normalized / converted value:{' '}
                      <strong>
                        <ReviewValue value={currentPreview.normalized_value} />{' '}
                        {currentPreview.normalized_unit}
                      </strong>
                    </p>
                    <p>
                      Downstream eligibility is not established by normalization. Exact model
                      applicability, source conditions and candidate projection remain server
                      checks; inspect the returned candidate review after saving.
                    </p>
                    <p>Original manufacturer evidence remains unchanged.</p>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {outcome === 'schema_gap' && (
          <>
            <label>
              Missing engineering concept or topic (required)
              <input
                required
                id="missing-concept"
                value={conceptKey}
                onChange={(event) => setConceptKey(event.target.value)}
              />
            </label>
            <label>
              Explain the missing concept and why existing properties do not fit (required)
              <textarea
                required
                id="gap-explanation"
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
              />
            </label>
          </>
        )}
        {outcome && (
          <ReviewHelp topic="Review rationale">
            Explain the source and reasoning behind your decision. Map, Reject interpretation, Not
            applicable and Possible missing property require rationale. Leave unresolved and Keep
            evidence allow optional notes.
          </ReviewHelp>
        )}
        {outcome && (
          <label>
            Rationale{rationaleRequired ? ' (required)' : ' (optional)'}
            <textarea
              id="review-rationale"
              required={rationaleRequired}
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
          </label>
        )}
        {!reviewer.trim() && (
          <p>Enter your local reviewer label at the top of product review before saving.</p>
        )}
        {!selectedFactIds.length && <p>Select at least one original manufacturer fact.</p>}
        {rationaleRequired && !rationale.trim() && (
          <p>Explain why this decision is appropriate before saving.</p>
        )}
        {outcome === 'map' && !currentPreview && (
          <p>
            Choose an eligible property and obtain a successful server preview. Conditioned or
            unsupported ratings must remain unresolved or be recorded as a possible contract gap; do
            not remove qualifiers to enable mapping.
          </p>
        )}
        {outcome === 'schema_gap' && (
          <p>
            Use a short meaningful topic, such as measurement accuracy. This records a possible
            contract gap and creates no engineering property. Complete the topic, explanation and
            rationale.
          </p>
        )}
        <section className="review-readiness" aria-label="Review readiness" aria-live="polite">
          <h4>Ready to save?</h4>
          <ul>
            {[
              {
                id: 'reviewer-label',
                label: 'Reviewer label',
                valid: !!reviewer.trim(),
                missing: 'Enter your local reviewer label in the product header.',
              },
              {
                id: 'review-outcome',
                label: 'Review decision',
                valid: !!outcome,
                missing: 'Choose a review decision.',
              },
              {
                id: 'source-evidence',
                label: 'Supporting evidence',
                valid: selectedFactsAreCurrent,
                missing: 'Choose at least one current source statement in manufacturer evidence.',
              },
              {
                id: 'review-outcome',
                label: 'Current review snapshot',
                valid: snapshotMatches,
                missing:
                  'Review changed: reload/recheck current evidence. Input is retained; no save will replay.',
              },
              ...(rationaleRequired
                ? [
                    {
                      id: 'review-rationale',
                      label: 'Required rationale',
                      valid: !!rationale.trim(),
                      missing: 'Explain this decision before saving.',
                    },
                  ]
                : []),
              ...(outcome === 'map'
                ? [
                    {
                      id: 'engineering-property',
                      label: 'Eligible engineering property',
                      valid:
                        !!target &&
                        discoveryState === 'ready' &&
                        targets.some((entry) => entry.canonical_field === target),
                      missing:
                        discoveryState === 'loading'
                          ? 'Pending: discovering eligible targets.'
                          : discoveryState === 'failed'
                            ? 'Invalid: target discovery failed; retry.'
                            : discoveryState === 'stale'
                              ? 'Stale: recheck evidence before discovering targets.'
                              : discoveryState === 'ready' && !targets.length
                                ? 'Mapping unavailable: no eligible target for this evidence under the current contract.'
                                : 'Select an eligible engineering property.',
                    },
                    {
                      id: 'normalization-preview',
                      label: 'Server normalization preview',
                      valid: !!currentPreview && !loadingPreview,
                      missing: loadingPreview
                        ? 'Pending: server preview is loading.'
                        : target
                          ? 'Validate the selected property again; inspect the preview error before saving.'
                          : 'Choose a property before requesting normalization.',
                    },
                  ]
                : []),
              ...(outcome === 'schema_gap'
                ? [
                    {
                      id: 'missing-concept',
                      label: 'Possible missing concept',
                      valid: !!conceptKey.trim(),
                      missing: 'Describe the possible missing concept.',
                    },
                    {
                      id: 'gap-explanation',
                      label: 'Gap explanation',
                      valid: !!explanation.trim(),
                      missing: 'Explain why existing concepts do not fit.',
                    },
                  ]
                : []),
            ].map((requirement, index) => (
              <li key={index} className={requirement.valid ? 'satisfied' : 'outstanding'}>
                {requirement.valid ? (
                  '✓ ' + requirement.label
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const node = document.getElementById(requirement.id);
                      const control =
                        requirement.id === 'source-evidence'
                          ? (node?.querySelector<HTMLElement>('input[type="checkbox"]') ?? node)
                          : node?.matches('input,select,textarea')
                            ? node
                            : node?.querySelector<HTMLElement>('input,select,textarea,button');
                      control?.focus();
                      node?.scrollIntoView?.({ block: 'nearest' });
                    }}
                  >
                    {requirement.missing}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canSubmit && (
            <p>
              Ready to record this decision. Approval and engineering verification remain separate.
            </p>
          )}
          {busy && <p>Saving… navigation waits for the server response.</p>}
        </section>
        <button type="button" disabled={!canSubmit} onClick={() => void submit(false)}>
          {busy ? 'Saving decision…' : 'Save decision'}
        </button>
        <button type="button" disabled={!canSubmit} onClick={() => void submit(true)}>
          Save and next outstanding item
        </button>
        {outcome === 'map' && target && (
          <section id="normalization-preview" tabIndex={-1} aria-label="Normalization recovery">
            <button
              type="button"
              disabled={busy || loadingPreview || !snapshotMatches}
              onClick={() => setPreviewRevision((n) => n + 1)}
            >
              Retry selected property preview
            </button>
          </section>
        )}
        {error && (
          <p role="alert">
            {error}{' '}
            {saveFailed ? 'Your decision was not saved.' : 'No valid mapping preview is available.'}{' '}
            Local input is retained. Review the evidence or keep it unresolved; no automatic retry
            occurs.
          </p>
        )}
      </fieldset>
    </div>
  );
}
