import { builderOptions } from '../configurator-model.js';
import type { ConfigFormState } from '../configurator-model.js';

interface Props {
  formState: ConfigFormState;
  onFieldChange: <K extends keyof ConfigFormState>(field: K, value: ConfigFormState[K]) => void;
}

export function BuilderContextSection({ formState, onFieldChange }: Props) {
  return (
    <section className="card" aria-labelledby="builder-heading">
      <h2 id="builder-heading">5. Builder / catalog context</h2>
      <fieldset>
        <legend>Mode</legend>
        <div className="choice-row">
          <label className="choice-pill">
            <input
              type="radio"
              name="builderMode"
              checked={formState.builderMode === 'generic'}
              onChange={() => onFieldChange('builderMode', 'generic')}
            />
            <span>Generic / DIY</span>
          </label>
          <label className="choice-pill">
            <input
              type="radio"
              name="builderMode"
              checked={formState.builderMode === 'builder'}
              onChange={() => onFieldChange('builderMode', 'builder')}
            />
            <span>Builder-specific</span>
          </label>
        </div>
      </fieldset>

      {formState.builderMode === 'builder' && (
        <label>
          Builder profile
          <select
            value={formState.selectedBuilderId}
            onChange={(event) => onFieldChange('selectedBuilderId', event.target.value)}
          >
            <option value="">Select a builder</option>
            {builderOptions.map((builder) => (
              <option key={builder.value} value={builder.value}>
                {builder.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}
