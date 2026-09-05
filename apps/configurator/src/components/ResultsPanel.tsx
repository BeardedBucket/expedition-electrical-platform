import type { EvaluationSummary } from '../configurator-model.js';

interface Props {
  result: EvaluationSummary;
  selectedVoltage: number | '';
  loadCount: number;
  builderMode: 'generic' | 'builder';
  onInquiry?: (
    componentId: string,
    recommendationState: 'eligible' | 'not-eligible' | 'unknown',
    inventoryState?: string,
  ) => void;
  showInquiry?: boolean;
}

export function ResultsPanel({
  result,
  selectedVoltage,
  loadCount,
  builderMode,
  onInquiry,
  showInquiry = false,
}: Props) {
  return (
    <section className="card" aria-labelledby="results-heading">
      <h2 id="results-heading">6. Results</h2>
      <p className="result-summary">
        Evaluated at {result.evaluatedAt}. Selected voltage {selectedVoltage} V and {loadCount} load
        {loadCount === 1 ? '' : 's'} in{' '}
        {builderMode === 'generic' ? 'generic mode' : 'builder mode'}.
      </p>

      {result.builderOutcome && result.builderOutcome.status !== 'generic' && (
        <div className="status-panel">
          <h3>Builder / catalog context</h3>
          <p>
            {result.builderOutcome.status === 'inventory_gap'
              ? 'Builder inventory gap: eligible global candidates exist, but this builder has no active inventory path.'
              : result.builderOutcome.status === 'unknown'
                ? 'Builder context remains unknown; global engineering eligibility is still the authority.'
                : result.builderOutcome.status === 'unresolved'
                  ? 'Builder identity is unresolved; generic mode is not silently assumed.'
                  : 'Builder filter applied after engineering eligibility.'}
          </p>
        </div>
      )}

      {result.groups.map((group) => (
        <div key={group.id} className="result-group">
          <h3>{group.title}</h3>
          {group.items.length === 0 ? (
            <p className="empty-result">No candidates in this group.</p>
          ) : (
            <div className="candidate-list">
              {group.items.map((candidate) => (
                <article key={candidate.id} className="candidate-card">
                  <div className="candidate-header">
                    <div>
                      <h4>{candidate.label}</h4>
                      <p className="meta">ID: {candidate.id}</p>
                    </div>
                    <span className={`status-badge badge-${candidate.advisoryAction ?? 'none'}`}>
                      {candidate.advisoryAction === 'exclude'
                        ? 'Excluded'
                        : candidate.advisoryAction === 'suppress_recommendation'
                          ? 'Suppressed'
                          : candidate.engineeringStatus === 'unknown'
                            ? 'Unknown'
                            : candidate.advisoryAction === 'caution'
                              ? 'Cautioned'
                              : 'Eligible'}
                    </span>
                  </div>

                  <dl className="compact-grid">
                    <div>
                      <dt>Compatibility</dt>
                      <dd>{candidate.engineeringStatus}</dd>
                    </div>
                    <div>
                      <dt>Recommendation</dt>
                      <dd>{candidate.recommendationEligible ? 'Eligible' : 'Not eligible'}</dd>
                    </div>
                    <div>
                      <dt>Advisory</dt>
                      <dd>{candidate.advisoryAction}</dd>
                    </div>
                    <div>
                      <dt>Severity</dt>
                      <dd>{candidate.advisorySeverity}</dd>
                    </div>
                    <div>
                      <dt>Confidence</dt>
                      <dd>{candidate.advisoryConfidence}</dd>
                    </div>
                    {candidate.builderAvailability && (
                      <div>
                        <dt>Builder availability</dt>
                        <dd>{candidate.builderAvailability}</dd>
                      </div>
                    )}
                    {candidate.builderPreference && (
                      <div>
                        <dt>Builder preference</dt>
                        <dd>{candidate.builderPreference}</dd>
                      </div>
                    )}
                  </dl>

                  <p className="why-text">Why? {candidate.why}</p>
                  {showInquiry && onInquiry && (
                    <button
                      type="button"
                      className="secondary inquiry-button"
                      onClick={() =>
                        onInquiry(
                          candidate.id,
                          candidate.engineeringStatus === 'unknown'
                            ? 'unknown'
                            : candidate.recommendationEligible
                              ? 'eligible'
                              : 'not-eligible',
                          candidate.builderState,
                        )
                      }
                    >
                      Inquire about this candidate
                    </button>
                  )}

                  <details>
                    <summary>Why? details</summary>
                    <div className="details-body">
                      <ul>
                        {candidate.reasons.length === 0 ? (
                          <li>No explicit reasons were returned by the engine.</li>
                        ) : (
                          candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)
                        )}
                      </ul>
                      {candidate.trace && candidate.trace.length > 0 && (
                        <pre>{JSON.stringify(candidate.trace, null, 2)}</pre>
                      )}
                    </div>
                  </details>
                </article>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="trace-card">
        <h3>Engine trace / provenance</h3>
        <dl className="versions">
          <div>
            <dt>Rule set</dt>
            <dd>
              {result.recommendationResult.trace.ruleSet.id} ·{' '}
              {result.recommendationResult.trace.ruleSet.version}
            </dd>
          </div>
          <div>
            <dt>Components</dt>
            <dd>
              {result.recommendationResult.trace.datasets.components.id} ·{' '}
              {result.recommendationResult.trace.datasets.components.version}
            </dd>
          </div>
          <div>
            <dt>Builders</dt>
            <dd>
              {result.recommendationResult.trace.datasets.builders.id} ·{' '}
              {result.recommendationResult.trace.datasets.builders.version}
            </dd>
          </div>
          <div>
            <dt>Advisories</dt>
            <dd>
              {result.recommendationResult.trace.datasets.advisories.id} ·{' '}
              {result.recommendationResult.trace.datasets.advisories.version}
            </dd>
          </div>
        </dl>
        <pre>{JSON.stringify(result.recommendationResult.trace, null, 2)}</pre>
      </div>
    </section>
  );
}
