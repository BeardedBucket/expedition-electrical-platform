import type { ConfigFormState, LoadItem } from '../configurator-model.js';

interface Props {
  formState: ConfigFormState;
  onLoadUpdate: (id: string, field: keyof LoadItem, value: string) => void;
  onLoadRemove: (id: string) => void;
  onLoadAdd: () => void;
}

const createNewLoad = (): LoadItem => ({
  id: `load-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: '',
  quantity: '1',
  powerW: '100',
  operatingVoltage: '',
  basis: 'direct-source',
  conversionEfficiency: '',
});

export function LoadsSection({ formState, onLoadUpdate, onLoadRemove, onLoadAdd }: Props) {
  return (
    <section className="card" aria-labelledby="loads-heading">
      <h2 id="loads-heading">2. Loads</h2>
      <div className="stacked-list">
        {formState.loads.map((load, index) => (
          <div key={load.id} className="load-row">
            <label>
              Load name
              <input
                type="text"
                value={load.name}
                onChange={(event) => onLoadUpdate(load.id, 'name', event.target.value)}
              />
            </label>
            <label>
              Quantity
              <input
                type="number"
                min="1"
                value={load.quantity}
                onChange={(event) => onLoadUpdate(load.id, 'quantity', event.target.value)}
              />
            </label>
            <label>
              Power (W)
              <input
                type="number"
                min="0"
                step="any"
                value={load.powerW}
                onChange={(event) => onLoadUpdate(load.id, 'powerW', event.target.value)}
              />
            </label>
            <label>
              Operating voltage (V)
              <input
                type="number"
                min="0"
                step="any"
                value={load.operatingVoltage}
                onChange={(event) => onLoadUpdate(load.id, 'operatingVoltage', event.target.value)}
              />
            </label>
            <label>
              Basis
              <select
                value={load.basis}
                onChange={(event) =>
                  onLoadUpdate(load.id, 'basis', event.target.value as LoadItem['basis'])
                }
              >
                <option value="direct-source">Direct source</option>
                <option value="converted-load">Converted load</option>
              </select>
            </label>
            <label>
              Conversion efficiency (%)
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={load.conversionEfficiency}
                onChange={(event) =>
                  onLoadUpdate(load.id, 'conversionEfficiency', event.target.value)
                }
              />
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() => onLoadRemove(load.id)}
              aria-label={`Remove ${load.name || `load ${index + 1}`}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="secondary" onClick={onLoadAdd}>
        Add load
      </button>
    </section>
  );
}

export const createLoadDefinition = createNewLoad;
