import { useState } from 'react';
import {
  parseEngineeringProfile,
  type EngineeringProfile,
} from '@expedition/engineering-core/engineering-profile';
import {
  evaluateEngineeringEnvelope,
  type EngineeringEnvelopeInput,
} from '@expedition/engineering-core/engineering-envelope';

/** Browser authoring is a proposed read-model only. It cannot persist a semantic
 * decision or issue a product approval. Server/private byte replay is separate. */
export function EngineeringPreparation() {
  const [draft, setDraft] = useState('');
  const [scenario, setScenario] = useState('');
  const [profile, setProfile] = useState<EngineeringProfile>();
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReturnType<typeof evaluateEngineeringEnvelope>>();
  function preview() {
    setError('');
    setResult(undefined);
    setProfile(undefined);
    try {
      const p = parseEngineeringProfile(JSON.parse(draft));
      setProfile(p);
      if (scenario.trim()) {
        const input = JSON.parse(scenario) as EngineeringEnvelopeInput;
        // Explicit replacement only of the same profile owner. A changed model
        // or revision is visible in validation, never a silently selected sibling.
        input.profiles = [...input.profiles.filter((x) => x.component_id !== p.component_id), p];
        setResult(evaluateEngineeringEnvelope(input));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid preparation');
    }
  }
  return (
    <section>
      <h1>Engineering profile preparation</h1>
      <p>
        Propose PV, tracker, shared capacity, AC mode and assembly facts against exact retained
        evidence. Missing facts remain unknown.
      </p>
      <p>
        Source qualification, product approval, promotion and engineering verification require
        separate human actions. This preview has no admission authority.
      </p>
      <label>
        Proposed engineering profile JSON
        <textarea
          rows={18}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setProfile(undefined);
            setResult(undefined);
          }}
        />
      </label>
      <label>
        Optional explicit installed scenario JSON
        <textarea
          rows={8}
          value={scenario}
          onChange={(e) => {
            setScenario(e.target.value);
            setResult(undefined);
          }}
        />
      </label>
      <button type="button" onClick={preview}>
        Validate and preview proposal
      </button>
      {error && <p role="alert">{error}</p>}
      {profile && (
        <>
          <h2>{profile.model}</h2>
          <p>
            Revision: {profile.manufacturer_revision ?? 'Unknown'}. Profile:{' '}
            {profile.schema_version}. Provisional proposal; private byte replay still required.
          </p>
          <h2>Evidence review queue</h2>
          {profile.evidence.map((e) => (
            <article key={e.id}>
              <h3>
                {e.id} ·{' '}
                {e.origin === 'synthetic'
                  ? 'Controlled synthetic assumption'
                  : 'Source-stated observation, awaiting review'}
              </h3>
              <p>{e.statement}</p>
              <p>
                {e.publisher} · {e.model} · {e.manufacturer_revision ?? 'Revision unknown'}
              </p>
              <p>
                Source: {e.source_url} · Locator: {e.locator}
              </p>
              <p>Digest: {e.source_digest ?? 'Not retained'}</p>
              <p>
                Conditions:{' '}
                {e.conditions.length
                  ? e.conditions.join('; ')
                  : 'No conditions asserted; inspect full source context'}
              </p>
            </article>
          ))}
          <h2>Proposed typed facts and original units</h2>
          <pre>{JSON.stringify(profile, null, 2)}</pre>
        </>
      )}
      {result && (
        <>
          <h2>Selected envelope: {result.status}</h2>
          <p>
            Authority: {result.authority}. Installation safety: {result.installation_safety}.
          </p>
          {result.checks.map((c, i) => (
            <article key={i}>
              <h3>
                {c.subject} · {c.code} · {c.status}
              </h3>
              <p>{c.explanation}</p>
              <p>Evidence: {c.evidence_ids.join(', ') || 'Missing prerequisites'}</p>
            </article>
          ))}
          <h2>Reproducible calculations and assumptions</h2>
          <pre>{JSON.stringify(result.calculations, null, 2)}</pre>
        </>
      )}
    </section>
  );
}
