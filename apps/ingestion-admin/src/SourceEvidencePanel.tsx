import type { OperatorJobDetail } from './api.js';
import { ReviewValue, SourceLink } from './ReviewValue.js';
import { ReviewHelp } from './ReviewHelp.js';
type WorkItem = NonNullable<OperatorJobDetail['semantic_review']>['work']['required'][number];
function applicabilityLabel(value: unknown) {
  if (!value || typeof value !== 'object') return 'Unknown / not established';
  const scope = value as { kind?: string; value?: unknown };
  const labels: Record<string, string> = {
    exact_mpn_or_sku: 'Exact part number',
    exact_product: 'Exact product model',
    family: 'Product family',
  };
  return (
    <>
      {labels[scope.kind ?? ''] ?? 'Retained source scope'}: <ReviewValue value={scope.value} />
    </>
  );
}
// A single exact, non-conflicting source binding can be shown without an unnecessary checkbox.
// This is evidence binding only: exact qualification is still a provisional source claim.
export function initialEvidenceBinding(item: WorkItem): string[] {
  const recorded = item.active_decision?.selected_fact_ids;
  if (recorded?.length) return recorded.filter((id): id is string => typeof id === 'string');
  const fact = item.evidence[0];
  const scope = fact?.applicability as { kind?: string; value?: unknown } | undefined;
  return item.evidence.length === 1 &&
    fact.qualification === 'exact' &&
    ['exact_mpn_or_sku', 'exact_product'].includes(scope?.kind ?? '') &&
    !!scope?.value &&
    !fact.conflicts?.length &&
    !fact.source_context?.alternatives?.length
    ? [fact.id]
    : [];
}
export function sourceScopeWarning(
  fact: WorkItem['evidence'][number],
  job: OperatorJobDetail,
): string | undefined {
  const scope = fact.applicability as { kind?: string; value?: unknown } | undefined;
  const requested =
    scope?.kind === 'exact_mpn_or_sku'
      ? job.intake?.manufacturer_part_number
      : scope?.kind === 'exact_product'
        ? job.intake?.product_model
        : undefined;
  if (requested && typeof scope?.value === 'string' && requested !== scope.value)
    return (
      'Model / part mismatch: requested ' +
      requested +
      '; source names ' +
      scope.value +
      '. Normalization cannot establish applicability. Inspect projection restrictions; Not applicable or Leave unresolved may be appropriate.'
    );
  if (
    !['exact_mpn_or_sku', 'exact_product'].includes(scope?.kind ?? '') ||
    !scope?.value ||
    fact.qualification !== 'exact'
  )
    return 'Exact requested-model applicability is not established. A family or uncertain table column cannot establish this component’s rating.';
  return undefined;
}
export function SourceEvidencePanel({
  item,
  job,
  selectedFactIds,
  onSelectionChange,
  disabled = false,
}: {
  item: WorkItem;
  job: OperatorJobDetail;
  selectedFactIds: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <aside
      className="mapping-evidence"
      aria-label="Manufacturer evidence"
      id="source-evidence"
      tabIndex={-1}
    >
      <h3>
        Manufacturer evidence{' '}
        <ReviewHelp topic="Source evidence">
          Extraction is provisional. Original evidence is read-only; source locations identify
          retained extraction evidence and do not independently confirm table cell boundaries.
        </ReviewHelp>
      </h3>
      <p>
        Requested component: {job.intake?.manufacturer ?? 'Unknown manufacturer'} ·{' '}
        {job.intake?.product_model ?? 'Unknown model'} · Part number:{' '}
        {job.intake?.manufacturer_part_number ?? 'Unknown / not available'}
      </p>
      <p>Missing source context is unknown. It does not establish an unconditional rating.</p>
      {!item.evidence.length && <p>No exact source evidence is available for this item.</p>}
      {item.evidence.map((fact, index) => (
        <section
          className={'evidence-card ' + (selectedFactIds.includes(fact.id) ? 'selected' : '')}
          key={fact.id}
          aria-label={'Evidence: ' + (fact.label ?? fact.id)}
        >
          <h4>{fact.label ?? 'Source label unavailable'}</h4>
          {(item.evidence.length > 1 ||
            initialEvidenceBinding({ ...item, active_decision: undefined }).length === 0) &&
            onSelectionChange && (
              <label className="evidence-selection">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selectedFactIds.includes(fact.id)}
                  onChange={(event) =>
                    onSelectionChange(
                      event.target.checked
                        ? [...selectedFactIds, fact.id]
                        : selectedFactIds.filter((id) => id !== fact.id),
                    )
                  }
                />
                Use {fact.label ?? 'source statement'} (source statement {index + 1})
              </label>
            )}
          {sourceScopeWarning(fact, job) && (
            <p role="alert" className="source-warning">
              {sourceScopeWarning(fact, job)}
            </p>
          )}
          <p>
            {fact.human_correction ? 'Human source correction' : 'Automated observation'}{' '}
            {index + 1} ·{' '}
            {selectedFactIds.includes(fact.id)
              ? 'Used for this decision'
              : 'Not selected for this decision'}
          </p>
          <dl className="evidence-facts">
            <dt>{fact.human_correction ? 'Human-adjudicated source value' : 'Original value'}</dt>
            <dd>
              <ReviewValue value={fact.raw_value} />
            </dd>
            <dt>Source-stated units</dt>
            <dd>{fact.unit ?? 'Unknown / not separately retained'}</dd>
            <dt>Original wording</dt>
            <dd>{fact.source_context?.wording ?? 'Exact wording not available'}</dd>
            <dt>
              Model / part-number applicability{' '}
              <ReviewHelp topic="Exact model applicability">
                A family or neighboring model's rating cannot establish this component's rating.
                Compare the retained model or part number with the requested component. Exact source
                scope is a claim requiring review, not verified identity.
              </ReviewHelp>
            </dt>
            <dd>
              {applicabilityLabel(fact.applicability)} ·{' '}
              {fact.qualification === 'exact'
                ? 'Exact source scope claimed'
                : 'Scope requires review'}
            </dd>
            <dt>
              Operating conditions{' '}
              <ReviewHelp topic="Conditions and measurement basis">
                Duration, temperature, operating state and measurement basis can change a
                specification's meaning. For example, precision with a 500 A shunt is not a 500 A
                current rating. Do not remove conditions to enable a scalar mapping.
              </ReviewHelp>
            </dt>
            <dd>
              {fact.source_context?.conditions?.length ? (
                <ReviewValue value={fact.source_context.conditions} />
              ) : (
                'Other operating conditions: unknown / not retained'
              )}
            </dd>
            <dt>Duration / temperature / revision</dt>
            <dd>
              Duration: <span>{fact.source_context?.duration ?? 'Unknown / not retained'}</span>;
              temperature:{' '}
              <span>{fact.source_context?.temperature ?? 'Unknown / not retained'}</span>; revision:{' '}
              <span>{fact.source_context?.revision ?? 'Unknown / not retained'}</span>
            </dd>
            <dt>Source</dt>
            <dd>
              {fact.document ?? 'Title unavailable'} <SourceLink uri={fact.source_uri} />
            </dd>
          </dl>
          {fact.locators
            ?.filter((entry) => entry.role !== 'value')
            .map((entry, index) => (
              <div className="source-context" key={index}>
                <strong>
                  {entry.role === 'context'
                    ? 'Retained page context · association requires review'
                    : 'Bound source context'}
                </strong>
                {entry.text !== undefined && <p>{entry.text}</p>}
                {'note' in entry && entry.note !== undefined && <p>{entry.note}</p>}
                {entry.context && <ReviewValue value={entry.context} />}
              </div>
            ))}
          {fact.conflicts?.length > 0 && (
            <div role="alert">
              Conflicting or unresolved source observations: <ReviewValue value={fact.conflicts} />
            </div>
          )}
          {!!fact.source_context?.alternatives?.length && (
            <div role="alert">
              Alternative interpretations: <ReviewValue value={fact.source_context.alternatives} />
            </div>
          )}
          {/* Every exact identifier stays available once, without repeating the evidence object in the normal flow. */}
          <details>
            <summary>Source locations and exact evidence identifiers</summary>
            <p>Extraction locators do not independently confirm manufacturer table boundaries.</p>
            <ReviewValue
              value={{
                fact_id: fact.id,
                applicability: fact.applicability,
                qualification: fact.qualification,
                locators: fact.locators,
              }}
            />
          </details>
          <details>
            <summary>Capture identity and digests</summary>
            <ReviewValue
              value={{
                capture_id: fact.source_context?.capture_id,
                retrieved_at: fact.source_context?.retrieved_at,
                capture: fact.source_context?.capture,
                content_digest: fact.source_context?.content_digest,
                content_digest_algorithm: fact.source_context?.content_digest_algorithm,
                document_reference: fact.source_context?.document_reference,
              }}
            />
            <p>
              The artifact digest binds capture metadata. The content digest identifies captured
              bytes; these are different digest types.
            </p>
          </details>
        </section>
      ))}
      <div className="supporting-evidence">
        <strong>Supporting evidence · {selectedFactIds.length} selected statement(s)</strong>
        <p>
          Selection binds source evidence to this decision; it does not map, approve or verify an
          engineering property.
        </p>
        {item.evidence.length === 1 &&
          initialEvidenceBinding({ ...item, active_decision: undefined }).length === 1 &&
          selectedFactIds.includes(item.evidence[0].id) && (
            <p className="evidence-bound">
              One already-bound source statement is used for this decision (read-only binding).
              Source scope remains provisional.
            </p>
          )}
        <ReviewHelp topic="Supporting evidence selection">
          Choose statements beside their original wording. Competing statements require an explicit
          choice. Changing the selection clears the engineering target and requires a new server
          preview.
        </ReviewHelp>
      </div>
      {item.semantic_assertions && (
        <details>
          <summary>Retained semantic conditions — inspect before interpreting this rating</summary>
          <ReviewValue value={item.semantic_assertions} />
        </details>
      )}
    </aside>
  );
}
