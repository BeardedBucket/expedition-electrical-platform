import { useState, type FormEvent } from 'react';
import {
  createDefaultFormState,
  evaluateConfiguration,
  validateConfig,
  type ConfigFormState,
  type LoadItem,
} from './configurator-model.js';
import { BuilderContextSection } from './components/BuilderContextSection';
import {
  ElectricalConstraintsSection,
  InstallationConstraintsSection,
} from './components/ConstraintSections';
import { LoadsSection, createLoadDefinition } from './components/LoadsSection';
import { ResultsPanel } from './components/ResultsPanel';
import { SystemBasicsSection } from './components/SystemBasicsSection';

function App() {
  const [formState, setFormState] = useState<ConfigFormState>(createDefaultFormState());
  const [result, setResult] = useState<ReturnType<typeof evaluateConfiguration> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateField = <K extends keyof ConfigFormState>(field: K, value: ConfigFormState[K]) => {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateLoad = (id: string, field: keyof LoadItem, value: string) => {
    setFormState((current) => ({
      ...current,
      loads: current.loads.map((load) =>
        load.id === id
          ? {
              ...load,
              [field]: value,
            }
          : load,
      ),
    }));
  };

  const removeLoad = (id: string) => {
    setFormState((current) => ({
      ...current,
      loads: current.loads.filter((item) => item.id !== id),
    }));
  };

  const addLoad = () => {
    setFormState((current) => ({
      ...current,
      loads: [...current.loads, createLoadDefinition()],
    }));
  };

  const submitRequirements = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateConfig(formState);
    if (!validation.valid) {
      setError(validation.errors[0] ?? 'The current form is incomplete or malformed.');
      setResult(null);
      return;
    }

    const nextResult = evaluateConfiguration(formState);
    if (!nextResult) {
      setError(
        'The current form is incomplete or malformed. Complete the required fields before evaluation.',
      );
      setResult(null);
      return;
    }

    setError(null);
    setResult(nextResult);
  };

  return (
    <main className="page">
      <header>
        <p className="eyebrow">Engineering configurator</p>
        <h1>Start with requirements, not inventory.</h1>
        <p className="lede">
          This UI consumes the deterministic engineering-core outputs, preserves unknown states, and
          keeps builder preference behind engineering eligibility.
        </p>
      </header>

      <form className="workflow-form" onSubmit={submitRequirements}>
        <SystemBasicsSection formState={formState} onFieldChange={updateField} />
        <LoadsSection
          formState={formState}
          onLoadUpdate={updateLoad}
          onLoadRemove={removeLoad}
          onLoadAdd={addLoad}
        />
        <ElectricalConstraintsSection formState={formState} onFieldChange={updateField} />
        <InstallationConstraintsSection formState={formState} onFieldChange={updateField} />
        <BuilderContextSection formState={formState} onFieldChange={updateField} />

        <div className="toolbar">
          <button type="submit">Evaluate configuration</button>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>

      {result && (
        <ResultsPanel
          result={result}
          selectedVoltage={formState.selectedVoltage}
          loadCount={formState.loads.length}
          builderMode={formState.builderMode}
        />
      )}
    </main>
  );
}

export default App;
