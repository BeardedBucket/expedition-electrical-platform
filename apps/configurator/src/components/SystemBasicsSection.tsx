import type { ConfigFormState, VoltageOption } from '../configurator-model.js';
import { voltageOptions } from '../configurator-model.js';

interface Props {
  formState: ConfigFormState;
  onFieldChange: <K extends keyof ConfigFormState>(field: K, value: ConfigFormState[K]) => void;
}

export function SystemBasicsSection({ formState, onFieldChange }: Props) {
  return (
    <section className="card" aria-labelledby="system-basics-heading">
      <h2 id="system-basics-heading">1. System basics</h2>
      <fieldset>
        <legend>System voltage candidate(s)</legend>
        <div className="choice-row">
          {voltageOptions.map((voltage) => (
            <label key={voltage} className="choice-pill">
              <input
                type="radio"
                name="selectedVoltage"
                checked={formState.selectedVoltage === voltage}
                onChange={() => onFieldChange('selectedVoltage', voltage as VoltageOption)}
              />
              <span>{voltage} V</span>
            </label>
          ))}
        </div>
        <p className="microcopy">
          The current engineering API evaluates one selected voltage per run. Multiple voltage
          candidates are shown as comparison options, but the request remains explicit and
          single-voltage for the deterministic engine.
        </p>
      </fieldset>

      <div className="form-grid">
        <label>
          System/application label
          <input
            type="text"
            value={formState.systemLabel}
            onChange={(event) => onFieldChange('systemLabel', event.target.value)}
            placeholder="Example: off-grid power hub"
          />
        </label>
      </div>

      <label>
        Optional notes
        <textarea
          value={formState.notes}
          onChange={(event) => onFieldChange('notes', event.target.value)}
          placeholder="Add any project assumptions, current constraints, or operational intent."
          rows={3}
        />
      </label>
    </section>
  );
}
