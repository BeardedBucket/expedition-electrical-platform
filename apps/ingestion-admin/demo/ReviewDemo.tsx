import { useState } from 'react';
import { ProductReview } from '../src/ProductReview.js';
import { createDemoController, demoScenarios } from './scenarios.js';
declare const __RETAINED_SOURCE_SCENARIOS__: typeof demoScenarios;
const labScenarios = [
  ...demoScenarios,
  ...(typeof __RETAINED_SOURCE_SCENARIOS__ !== 'undefined' ? __RETAINED_SOURCE_SCENARIOS__ : []),
];
const controllers = labScenarios.map(createDemoController);
export function ReviewDemo() {
  const initial = Math.max(
    0,
    labScenarios.findIndex(
      (scenario) => scenario.id === new URLSearchParams(window.location.search).get('scenario'),
    ),
  );
  const [index, setIndex] = useState(initial);
  const [pendingIndex, setPendingIndex] = useState(initial);
  const [job, setJob] = useState(controllers[initial].current);
  const [width, setWidth] = useState('');
  const scenario = labScenarios[index];
  return (
    <>
      <header>
        <div className="brand">
          Expedition <span>Specification review lab</span>
        </div>
        <span>Synthetic · memory only</span>
      </header>
      <main>
        <div className="demo-controls">
          <label>
            Review scenario
            <select
              value={pendingIndex}
              onChange={(event) => setPendingIndex(Number(event.target.value))}
            >
              {labScenarios.map((scenario, index) => (
                <option key={scenario.id} value={index}>
                  {scenario.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Constrained container width
            <select value={width} onChange={(event) => setWidth(event.target.value)}>
              <option value="">Use available width</option>
              {[360, 390, 768, 1024, 1280, 1440].map((width) => (
                <option key={width} value={width}>
                  {width} CSS pixels
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={index === pendingIndex}
            onClick={() => {
              setIndex(pendingIndex);
              setJob(controllers[pendingIndex].current());
            }}
          >
            Open selected scenario
          </button>
        </div>
        <p className="muted">
          Opening another scenario discards unsaved input. Recorded demo decisions remain in memory
          until page reload.
        </p>
        <p role="note" hidden={!!scenario.retainedSource}>
          All values and records are invented. Target lists and conversion previews are scripted UI
          fixtures, not real engineering evaluations. Saves affect memory only; approval, publishing
          and verification are unavailable.
        </p>
        {scenario.retainedSource && (
          <div className="source-warning" role="note">
            <strong>Authentic retained-source reference lab · assembled review DTO</strong>
            <p>
              Text is from a hash-checked frozen pdfplumber observation of official manufacturer
              evidence. Flattened rows do not establish exact model/table applicability. Target
              discovery is scripted empty; no real backend qualification or preview was run for
              these observations. Saves affect memory only.
            </p>
            <p>
              Extractor: {scenario.retainedSource.engine} {scenario.retainedSource.version} · PDF
              page {scenario.retainedSource.page}
            </p>
            <details>
              <summary>Exact retained source identity</summary>
              <p>
                Observation digest: <code>{scenario.retainedSource.observation_digest}</code>
              </p>
              <p>
                PDF digest retained in observation metadata (external PDF not opened):{' '}
                <code>{scenario.retainedSource.pdf_digest}</code>
              </p>
              <a href={scenario.retainedSource.uri} target="_blank" rel="noopener noreferrer">
                Official manufacturer source
              </a>
            </details>
          </div>
        )}
        <p>
          <strong>{scenario.title}</strong> — {scenario.risk}
        </p>
        <details>
          <summary>Scenario index and engineering risks</summary>
          <ol>
            {labScenarios.map((scenario) => (
              <li key={scenario.id}>
                <strong>{scenario.title}</strong> — {scenario.risk}
              </li>
            ))}
          </ol>
        </details>
        {scenario.id === 'recovery' && (
          <div className="demo-controls" aria-label="Synthetic failure controls">
            <button onClick={() => controllers[index].failNext('save')}>Fail next save once</button>
            <button onClick={() => controllers[index].failNext('stale')}>
              Make next save stale
            </button>
            <button onClick={() => controllers[index].failNext('reload')}>
              Stale save and failed reload
            </button>
          </div>
        )}
        <div className="demo-width" style={{ maxWidth: width ? width + 'px' : undefined }}>
          <ProductReview
            key={scenario.id}
            job={job}
            client={controllers[index].client}
            onUpdate={setJob}
          />
        </div>
      </main>
    </>
  );
}
