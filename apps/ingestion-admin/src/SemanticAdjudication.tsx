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

type SemanticReview = NonNullable<OperatorJobDetail['semantic_review']>;
type SemanticWorkItem = SemanticReview['work']['required'][number];
type ProductReviewData = NonNullable<OperatorJobDetail['product_review']>;
type ProductField = ProductReviewData['fields'][number];
type ProductQualifiedValue = NonNullable<ProductReviewData['qualified_values']>[number];
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
    label: 'Map to canonical field',
    explanation:
      "Choose the source assertion's canonical meaning; the platform computes its value.",
  },
  {
    value: 'evidence_only',
    label: 'Evidence only',
    explanation: 'Keep relevant evidence without projecting it into the canonical component.',
  },
  {
    value: 'schema_gap',
    label: 'Schema gap',
    explanation: 'The source has a meaningful concept but no supported canonical target exists.',
  },
  {
    value: 'reject',
    label: 'Reject assertion',
    explanation: 'Do not use this retained assertion as an applicable semantic fact.',
  },
  {
    value: 'not_applicable',
    label: 'Not applicable',
    explanation:
      'The assertion is valid source material but does not apply to this product/context.',
  },
  {
    value: 'unresolved',
    label: 'Leave unresolved',
    explanation: 'You examined the evidence but cannot safely determine its canonical meaning.',
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

function SemanticWorkItemCard({
  item,
  job,
  client,
  reviewer,
  onUpdate,
  onStale,
  showEditor,
  allowCorrectionAction = false,
  product,
}: {
  item: SemanticWorkItem;
  job: OperatorJobDetail;
  client: OperatorApi;
  reviewer: string;
  onUpdate: (job: OperatorJobDetail) => void;
  onStale: (error: unknown, setError: (message: string) => void) => Promise<boolean>;
  showEditor: boolean;
  allowCorrectionAction?: boolean;
  product: CardProductReview;
}) {
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const editorVisible = showEditor || correctionOpen;
  const projectedValue = product.field?.display_value ?? product.field?.value;
  const semanticValue = item.display_value ?? item.value ?? item.automatic_value;
  const projectedValueAddsInformation =
    product.field && JSON.stringify(projectedValue) !== JSON.stringify(semanticValue);

  return (
    <article id={`semantic-${encodeURIComponent(item.id)}`}>
      <h4>{item.automatic_target || item.id}</h4>
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
        <details
          key={fact.id}
          className="source-evidence"
          open={item.required || !!item.active_decision || correctionOpen || !!product.field}
        >
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
                <a href={`#semantic-${encodeURIComponent(product.factOwners.get(fact.id) ?? '')}`}>
                  its primary review card
                </a>
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
        <button type="button" onClick={() => setCorrectionOpen((open) => !open)}>
          {correctionOpen ? 'Hide correction controls' : 'Review / correct automatic mapping'}
        </button>
      )}
      {editorVisible && (
        <SemanticDecisionEditor
          key={`${item.id}:${job.semantic_review?.expected_review_snapshot}`}
          item={item}
          job={job}
          client={client}
          reviewer={reviewer}
          onUpdate={onUpdate}
          onStale={onStale}
        />
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
              <a
                href={`#semantic-${encodeURIComponent(product.fieldOwners?.get(product.field.path) ?? '')}`}
              >
                proposal {product.fieldOwners?.get(product.field.path)}
              </a>
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
            <a
              href={`#semantic-${encodeURIComponent(product.qualifiedOwners.get(product.qualifiedValue.id) ?? '')}`}
            >
              its primary review card
            </a>
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
  const onStale = useCallback(
    async (error: unknown, setError: (message: string) => void) => {
      if (!(error instanceof OperatorApiError) || error.status !== 409) return false;
      try {
        onUpdate(await client.get(job.summary.id));
        setError(
          'The review changed. Current job state was reloaded; inspect the evidence and reconfirm before recording a decision.',
        );
      } catch {
        setError('The review changed. Reload the job before making another decision.');
      }
      return true;
    },
    [client, job.summary.id, onUpdate],
  );
  if (!semanticReview) return null;
  const requiredIds = (semanticReview.required_dispositions ?? []).map((item) => item.proposal_id);
  const work = semanticReview.work;
  const allItems = [...work.required, ...work.reviewed, ...work.automatic, ...work.derived];
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

  const renderItemCard = (
    item: SemanticWorkItem,
    showEditor: boolean,
    allowCorrectionAction = false,
  ) => (
    <SemanticWorkItemCard
      key={item.id}
      item={item}
      job={job}
      client={client}
      reviewer={reviewer}
      onUpdate={onUpdate}
      onStale={onStale}
      showEditor={showEditor}
      allowCorrectionAction={allowCorrectionAction}
      product={cardProductReview(item)}
    />
  );

  return (
    <section aria-label="Semantic adjudication">
      <h2>Semantic review</h2>
      <p role="status">
        {semanticReview.complete
          ? 'Semantic review complete. The existing product approval workflow is available.'
          : `Semantic review still requires dispositions for ${requiredIds.length} proposal(s).`}
      </p>
      {!semanticReview.complete && (
        <ul aria-label="Proposals requiring disposition">
          {requiredIds.map((id) => (
            <li key={id}>
              <a href={`#semantic-${encodeURIComponent(id)}`}>{id}</a>
            </li>
          ))}
        </ul>
      )}
      <div id="semantic-required">
        <Section
          title="REVIEW REQUIRED"
          items={work.required}
          empty="No semantic dispositions remain outstanding."
          render={(item) => renderItemCard(item, true)}
        />
        <Section
          title="REVIEWED / DISPOSITIONED"
          items={work.reviewed}
          empty="No human dispositions have been recorded."
          render={(item) => renderItemCard(item, true)}
        />
        <Section
          title="AUTOMATICALLY MAPPED"
          items={work.automatic}
          empty="No proposals were handled automatically."
          render={(item) =>
            renderItemCard(item, false, item.automatic_disposition === 'mapped' && !item.derived)
          }
        />
        <Section
          title="DERIVED / CALCULATED"
          items={work.derived}
          empty="No derived semantic proposals."
          render={(item) => renderItemCard(item, false)}
        />
      </div>
    </section>
  );
}

function SemanticDecisionEditor({
  item,
  job,
  client,
  reviewer,
  onUpdate,
  onStale,
}: {
  item: SemanticWorkItem;
  job: OperatorJobDetail;
  client: OperatorApi;
  reviewer: string;
  onUpdate: (job: OperatorJobDetail) => void;
  onStale: (error: unknown, setError: (message: string) => void) => Promise<boolean>;
}) {
  const semanticReview = job.semantic_review!;
  const [outcome, setOutcome] = useState<(typeof outcomes)[number]['value'] | ''>('');
  const [selectedFactIds, setSelectedFactIds] = useState<string[]>(() =>
    item.evidence.map((fact) => fact.id),
  );
  const [targets, setTargets] = useState<SemanticTargetResponse['targets']>([]);
  const [target, setTarget] = useState('');
  const [sourceUnit, setSourceUnit] = useState('');
  const [rationale, setRationale] = useState('');
  const [conceptKey, setConceptKey] = useState('');
  const [explanation, setExplanation] = useState('');
  const [preview, setPreview] = useState<{
    intentKey: string;
    value: ReviewedSemanticMappingPreview;
  }>();
  const previewIntentRef = useRef('');
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    preview?.intentKey === currentIntentKey && previewIntentRef.current === currentIntentKey
      ? preview.value
      : undefined;

  // Event handlers advance this guard before React effects run, so an older request
  // cannot restore a preview after the operator changes mapping intent.
  useEffect(() => {
    if (outcome !== 'map' || selectedFactIds.length === 0) {
      previewIntentRef.current = intentKey('', '', selectedFactIds);
      setTargets([]);
      setTarget('');
      setSourceUnit('');
      setPreview(undefined);
      return;
    }
    let active = true;
    setLoadingTargets(true);
    setTargets([]);
    setTarget('');
    setSourceUnit('');
    setPreview(undefined);
    previewIntentRef.current = intentKey('', '', selectedFactIds);
    void client
      .semanticTargets(job.summary.id, item.id, {
        expected_review_snapshot: semanticReview.expected_review_snapshot,
        selected_fact_ids: selectedFactIds,
      })
      .then((result) => {
        if (active) setTargets(result.targets);
      })
      .catch(async (caught: unknown) => {
        if (active && !(await onStale(caught, setError)))
          setError(caught instanceof Error ? caught.message : 'Canonical targets could not load.');
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
    semanticReview.expected_review_snapshot,
  ]);

  useEffect(() => {
    if (outcome !== 'map' || !target || selectedFactIds.length === 0) {
      setLoadingPreview(false);
      return;
    }
    let active = true;
    const requestedIntentKey = intentKey(target, sourceUnit, selectedFactIds);
    setLoadingPreview(true);
    setPreview(undefined);
    setError('');
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
        if (active && !(await onStale(caught, setError)))
          setError(caught instanceof Error ? caught.message : 'Mapping preview failed.');
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
    sourceUnit,
    selectedFactIds,
    target,
  ]);

  const submit = async () => {
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
    try {
      onUpdate(await client.semanticDecision(job.summary.id, input));
    } catch (caught) {
      if (!(await onStale(caught, setError)))
        setError(caught instanceof Error ? caught.message : 'Semantic decision failed.');
    } finally {
      setBusy(false);
    }
  };

  const rationaleRequired = ['map', 'schema_gap', 'reject', 'not_applicable'].includes(outcome);
  const canSubmit =
    !!outcome &&
    !!reviewer.trim() &&
    selectedFactIds.length > 0 &&
    !busy &&
    (!rationaleRequired || !!rationale.trim()) &&
    (outcome !== 'map' || (!!target && !!currentPreview && !loadingPreview)) &&
    (outcome !== 'schema_gap' || (!!conceptKey.trim() && !!explanation.trim()));

  return (
    <div className="semantic-editor">
      {item.decision_history?.length ? (
        <p>This records a new revision; it does not edit the current or prior decision.</p>
      ) : null}
      <label>
        Semantic disposition
        <select
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
          <option value="">Choose a disposition</option>
          {outcomes.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      {selectedOutcome && <p>{selectedOutcome.explanation}</p>}
      <fieldset>
        <legend>Supporting retained facts</legend>
        {item.evidence.map((fact) => (
          <label key={fact.id}>
            <input
              type="checkbox"
              checked={selectedFactIds.includes(fact.id)}
              onChange={(event) => {
                const nextFactIds = event.target.checked
                  ? [...selectedFactIds, fact.id]
                  : selectedFactIds.filter((id) => id !== fact.id);
                previewIntentRef.current = intentKey('', '', nextFactIds);
                setSelectedFactIds(nextFactIds);
                setTarget('');
                setSourceUnit('');
                setPreview(undefined);
              }}
            />
            {fact.label ?? 'Source label unavailable'} · {fact.id}
          </label>
        ))}
      </fieldset>
      {outcome === 'map' && (
        <>
          <label>
            Canonical target from the server contract
            <select
              value={target}
              disabled={loadingTargets || targets.length === 0}
              onChange={(event) => {
                const nextTarget = event.target.value;
                previewIntentRef.current = intentKey(nextTarget, '', selectedFactIds);
                setPreview(undefined);
                setSourceUnit('');
                setTarget(nextTarget);
              }}
            >
              <option value="">
                {loadingTargets ? 'Loading eligible targets...' : 'Choose a canonical field'}
              </option>
              {targets.map((descriptor) => (
                <option key={descriptor.canonical_field} value={descriptor.canonical_field}>
                  {descriptor.canonical_field} · {descriptor.dimension} · {descriptor.unit}
                </option>
              ))}
            </select>
          </label>
          {targets.length === 0 && !loadingTargets && (
            <p>No target is eligible for the selected evidence, or the source facts need review.</p>
          )}
          {target && (
            <>
              {targets.find((descriptor) => descriptor.canonical_field === target)
                ?.allows_unit_conversion && (
                <label>
                  Explicit source unit, only if not recoverable from retained evidence
                  <input
                    value={sourceUnit}
                    onChange={(event) => {
                      const nextSourceUnit = event.target.value;
                      previewIntentRef.current = intentKey(target, nextSourceUnit, selectedFactIds);
                      setPreview(undefined);
                      setSourceUnit(nextSourceUnit);
                    }}
                    placeholder="Leave blank to use retained source evidence"
                  />
                </label>
              )}
              <p>
                Human-adjudicated meaning: <strong>{target}</strong>
              </p>
              {loadingPreview && <p role="status">Requesting server mapping preview…</p>}
              {currentPreview && !loadingPreview && (
                <div className="semantic-preview">
                  <h5>Server-authoritative mapping preview</h5>
                  <p>
                    Source-stated value(s):{' '}
                    {currentPreview.source_assertions.map((assertion) => (
                      <span key={assertion.fact_id}>
                        <ReviewValue value={assertion.raw_value} /> {assertion.fact_id}
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
                            `${assertion.fact_id}: ${assertion.source_unit ?? assertion.effective_source_unit}`,
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
                    The source assertion is preserved; the platform computes this canonical
                    representation. This conversion is normalization, not a calculated fact.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
      {outcome === 'schema_gap' && (
        <>
          <label>
            Schema concept key (required)
            <input
              required
              value={conceptKey}
              onChange={(event) => setConceptKey(event.target.value)}
            />
          </label>
          <label>
            Explain the missing concept (required)
            <textarea
              required
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
            />
          </label>
        </>
      )}
      {outcome && (
        <label>
          Rationale{rationaleRequired ? ' (required)' : ' (optional)'}
          <textarea
            required={rationaleRequired}
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
          />
        </label>
      )}
      <button type="button" disabled={!canSubmit} onClick={() => void submit()}>
        {busy ? 'Recording decision…' : 'Record semantic disposition'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
