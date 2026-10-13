import type { OperatorJobDetail } from './api.js';
import { propertyName } from './ReviewerProperties.js';
import { ReviewValue } from './ReviewValue.js';
export type CorrectionItem = NonNullable<
  OperatorJobDetail['semantic_review']
>['work']['required'][number];
export function CorrectionRecord({
  job,
  item,
  factIds,
}: {
  job: OperatorJobDetail;
  item?: CorrectionItem;
  factIds: readonly string[];
}) {
  const records =
    job.human_adjudication?.correction_records?.filter((r) => factIds.includes(r.fact_id)) ?? [];
  const history = job.human_adjudication?.history ?? [];
  const groups = new Set(
    history
      .filter((event) => event.facts.some((fact) => factIds.includes(fact.id)))
      .map((event) => event.intent.group_id),
  );
  const originalIds = new Set([
    ...factIds,
    ...history
      .filter((event) => groups.has(event.intent.group_id))
      .flatMap((event) => event.original_fact_refs.map((ref) => ref.reference)),
  ]);
  const observations =
    job.human_adjudication?.original_observations.filter((f) => originalIds.has(f.id)) ?? [];
  const human = records.find((record) => record.origin === 'human');
  const evidence = item?.evidence ?? [];
  return (
    <section className="correction-current-record" aria-label="Current record">
      <div className="correction-section-heading">
        <h4>1 · Current record</h4>
        <span className="review-status">
          {records.some((r) => r.origin === 'human')
            ? 'Human source correction · provisional'
            : item?.active_decision
              ? 'Human-reviewed · provisional'
              : item?.automatic_disposition === 'mapped'
                ? 'Automatic interpretation · provisional'
                : 'Unresolved · provisional'}
        </span>
      </div>
      <p>
        <strong>Requested product:</strong> {job.intake.manufacturer} · {job.intake.product_model} ·{' '}
        {job.intake.manufacturer_part_number || 'Part number unknown'}
      </p>
      {human &&
        observations.map((fact) => (
          <p key={fact.id} className="original-extracted-record">
            <strong>Original automatic extraction:</strong> {fact.label} ·{' '}
            <ReviewValue value={fact.value} /> {fact.unit ?? 'Unit unknown'}
          </p>
        ))}
      {evidence.length ? (
        evidence.map((f) => (
          <div key={f.id} className="current-source-record">
            <strong>{f.label ?? 'Unrecognized source specification'}</strong>
            <p className="current-source-value">
              <ReviewValue value={f.raw_value} /> {f.unit ?? 'Unit unknown'}
            </p>
            {f.source_context?.conditions?.length ? (
              <p>Recorded conditions: {f.source_context.conditions.join(' · ')}</p>
            ) : (
              <p className="muted">
                Other source conditions are unknown unless retained in the evidence.
              </p>
            )}
            {[
              f.source_context?.duration,
              f.source_context?.temperature,
              f.source_context?.revision,
            ].filter(Boolean).length > 0 && (
              <p>
                Recorded qualification:{' '}
                {[
                  f.source_context?.duration,
                  f.source_context?.temperature,
                  f.source_context?.revision,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        ))
      ) : observations.length ? (
        observations.map((f) => (
          <div key={f.id}>
            <strong>{f.label}</strong>
            <ReviewValue value={f.value} />
            <span>{f.unit}</span>
          </div>
        ))
      ) : (
        <p>
          {factIds.length
            ? 'Current source details are unavailable; inspect retained evidence before correcting.'
            : 'New specification · no existing value will be replaced.'}
        </p>
      )}
      {item && (
        <div className="current-interpretations">
          <div>
            <small>{human ? 'Earlier automatic observation' : 'Automatic interpretation'}</small>
            <strong>
              {human
                ? observations.map((fact) => fact.label).join(' · ') ||
                  'Earlier extraction retained in history'
                : item.automatic_disposition === 'mapped'
                  ? propertyName(item.automatic_target)
                  : 'No supported automatic mapping'}
            </strong>
            {!human && item.automatic_value !== undefined && (
              <p>
                <ReviewValue value={item.automatic_value} />{' '}
                {item.canonical_unit ?? 'Normalized unit unavailable'}
              </p>
            )}
          </div>
          <div>
            <small>Effective reviewed interpretation</small>
            <strong>
              {human
                ? human.statement.mapping
                  ? propertyName(human.statement.mapping.target)
                  : 'Human-corrected source · engineering meaning unresolved'
                : item.active_decision
                  ? item.state === 'human_mapped'
                    ? propertyName(item.target ?? item.active_decision.target ?? '')
                    : item.active_decision.outcome.replace(/_/g, ' ')
                  : 'No human mapping recorded'}
            </strong>
            {item.active_decision && item.value !== undefined && (
              <p>
                <ReviewValue value={item.value} /> {item.normalized_unit ?? item.canonical_unit}
              </p>
            )}
            {human && !item.active_decision && item.automatic_value !== undefined && (
              <p>
                <ReviewValue value={item.automatic_value} /> {item.canonical_unit}
              </p>
            )}
            {human?.statement.mapping && (
              <p className="muted">
                Provisional human interpretation
                {!item.projected_field && !item.projected_qualified_value_id
                  ? ' · not projected into the current candidate'
                  : ''}
                .
              </p>
            )}
          </div>
        </div>
      )}
      {records
        .filter((r) => r.warning)
        .map((r) => (
          <p key={r.fact_id} className="inline-warning">
            {r.warning}
          </p>
        ))}
      {!!item?.decision_history.length && (
        <details>
          <summary>Previous engineering decisions ({item.decision_history.length})</summary>
          {item.decision_history.map((d) => (
            <p key={d.id}>
              {d.active ? 'Effective' : 'Superseded'} · {d.outcome.replace(/_/g, ' ')} ·{' '}
              {d.rationale ?? 'Earlier reason not recorded'}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
