import type { ConfigFormState } from '../configurator-model.js';

interface Props {
  formState: ConfigFormState;
  onFieldChange: <K extends keyof ConfigFormState>(field: K, value: ConfigFormState[K]) => void;
}

export function ElectricalConstraintsSection({ formState, onFieldChange }: Props) {
  return (
    <section className="card" aria-labelledby="electrical-heading">
      <h2 id="electrical-heading">3. Electrical constraints</h2>
      <div className="form-grid">
        <label>
          One-way conductor length (m) (Deferred - not yet evaluated)
          <input
            type="number"
            min="0"
            step="any"
            disabled
            value={formState.electricalConstraints.oneWayLengthM}
            onChange={(event) =>
              onFieldChange('electricalConstraints', {
                ...formState.electricalConstraints,
                oneWayLengthM: event.target.value,
              })
            }
          />
        </label>
        <label>
          Maximum voltage drop (%) (Deferred - not yet evaluated)
          <input
            type="number"
            min="0"
            max="100"
            step="any"
            disabled
            value={formState.electricalConstraints.maxVoltageDropPercent}
            onChange={(event) =>
              onFieldChange('electricalConstraints', {
                ...formState.electricalConstraints,
                maxVoltageDropPercent: event.target.value,
              })
            }
          />
        </label>
        <label>
          Installation profile (Deferred - not yet evaluated)
          <select
            disabled
            value={formState.electricalConstraints.installationProfile}
            onChange={(event) =>
              onFieldChange('electricalConstraints', {
                ...formState.electricalConstraints,
                installationProfile: event.target.value,
              })
            }
          >
            <option value="mixed">Mixed / typical</option>
            <option value="engine-bay">Engine bay</option>
            <option value="interior">Interior</option>
            <option value="roofline">Roofline</option>
          </select>
        </label>
      </div>

      <label className="checkbox-inline">
        <input
          type="checkbox"
          disabled
          checked={formState.electricalConstraints.roundTrip}
          onChange={(event) =>
            onFieldChange('electricalConstraints', {
              ...formState.electricalConstraints,
              roundTrip: event.target.checked,
            })
          }
        />
        Treat the run as round-trip conductor length for checks. (Deferred - not yet evaluated)
      </label>

      <p className="microcopy">
        Note: Conductor length, voltage drop, and installation profile evaluations are deferred to
        future core phases.
      </p>
    </section>
  );
}

export function InstallationConstraintsSection({ formState, onFieldChange }: Props) {
  return (
    <section className="card" aria-labelledby="installation-heading">
      <h2 id="installation-heading">4. Installation constraints</h2>
      <div className="form-grid">
        <label>
          Max dimensions (mm) (Deferred - not yet evaluated)
          <input
            type="text"
            disabled
            value={formState.installationConstraints.maxDimensionsMm}
            onChange={(event) =>
              onFieldChange('installationConstraints', {
                ...formState.installationConstraints,
                maxDimensionsMm: event.target.value,
              })
            }
          />
        </label>
        <label>
          Max weight (kg) (Deferred - not yet evaluated)
          <input
            type="text"
            disabled
            value={formState.installationConstraints.maxWeightKg}
            onChange={(event) =>
              onFieldChange('installationConstraints', {
                ...formState.installationConstraints,
                maxWeightKg: event.target.value,
              })
            }
          />
        </label>
        <label>
          Required interfaces (Deferred - not yet evaluated)
          <input
            type="text"
            disabled
            value={formState.installationConstraints.requiredInterfaces}
            onChange={(event) =>
              onFieldChange('installationConstraints', {
                ...formState.installationConstraints,
                requiredInterfaces: event.target.value,
              })
            }
          />
        </label>
        <label>
          Required accessories (Deferred - not yet evaluated)
          <input
            type="text"
            disabled
            value={formState.installationConstraints.requiredAccessories}
            onChange={(event) =>
              onFieldChange('installationConstraints', {
                ...formState.installationConstraints,
                requiredAccessories: event.target.value,
              })
            }
          />
        </label>
      </div>

      <p className="microcopy">
        Note: Physical dimension, weight, interface, and accessory constraint evaluations are
        deferred to future core phases.
      </p>
    </section>
  );
}
