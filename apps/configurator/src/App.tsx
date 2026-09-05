import { useState } from 'react';
import {
  demoData,
  orchestrateRecommendations,
  type RecommendationResult,
} from '@expedition/engineering-core';

function App() {
  const [voltage, setVoltage] = useState('');
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitRequirements = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const systemVoltageV = Number(voltage);
    if (!voltage.trim() || !Number.isFinite(systemVoltageV) || systemVoltageV <= 0) {
      setError('Enter a positive system voltage selected for this project.');
      setResult(null);
      return;
    }

    setError(null);
    setResult(orchestrateRecommendations({ systemVoltageV, loads: [] }, demoData));
  };

  return (
    <main className="page">
      <header>
        <p className="eyebrow">Bootstrap configurator</p>
        <h1>Start with requirements, not inventory.</h1>
        <p className="lede">
          This synthetic demo keeps engineering logic in a framework-independent package. No
          component, builder, or advisory records are loaded yet.
        </p>
      </header>

      <section className="card" aria-labelledby="requirements-heading">
        <h2 id="requirements-heading">Requirements</h2>
        <form onSubmit={submitRequirements}>
          <label htmlFor="system-voltage">
            System voltage (V)
            <input
              id="system-voltage"
              name="systemVoltageV"
              type="number"
              min="0"
              step="any"
              value={voltage}
              onChange={(event) => setVoltage(event.target.value)}
              placeholder="Select a project voltage"
              required
            />
          </label>
          <button type="submit">Evaluate requirements</button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="card" aria-labelledby="results-heading">
          <h2 id="results-heading">Recommendations</h2>
          <p className="empty-result">
            No recommendations are available because the synthetic component and builder collections
            are empty.
          </p>
          <h3>Rule-set and dataset versions</h3>
          <dl className="versions">
            <div>
              <dt>Rule set</dt>
              <dd>
                {result.trace.ruleSet.id} · {result.trace.ruleSet.version}
              </dd>
            </div>
            <div>
              <dt>Components</dt>
              <dd>
                {result.trace.datasets.components.id} · {result.trace.datasets.components.version}
              </dd>
            </div>
            <div>
              <dt>Builders</dt>
              <dd>
                {result.trace.datasets.builders.id} · {result.trace.datasets.builders.version}
              </dd>
            </div>
            <div>
              <dt>Advisories</dt>
              <dd>
                {result.trace.datasets.advisories.id} · {result.trace.datasets.advisories.version}
              </dd>
            </div>
          </dl>
          <h3>Trace/debug metadata</h3>
          <pre>{JSON.stringify(result.trace, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}

export default App;
