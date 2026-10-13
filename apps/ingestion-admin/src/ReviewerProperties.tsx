import { useEffect, useRef, useState } from 'react';
import { engineeringConcepts, type EngineeringConcept } from './EngineeringPropertyCatalog.js';
import { ReviewHelp } from './ReviewHelp.js';
import type { SemanticTargetResponse } from './api.js';

// Presentation-only version. Eligibility, dimensions, units and normalization stay server-owned.
export const REVIEWER_PROPERTY_CATALOG_VERSION = 'reviewer-properties.v1';
const entries = [
  [
    'electrical.input_voltage_range_v',
    'Input operating voltage range',
    'Voltage range accepted at the input.',
    'Not output voltage or a battery charging setpoint.',
    'input supply operating dc volts',
  ],
  [
    'electrical.output_voltage_range_v',
    'Output operating voltage range',
    'Voltage range provided at the output.',
    'Not input voltage or a battery charging setpoint.',
    'output supply operating dc volts',
  ],
  [
    'electrical.nominal_voltage_v',
    'Nominal operating voltage',
    'Source-stated nominal system or component voltage.',
    'Nominal voltage differs from an operating range and charging voltage.',
    'system rated nominal dc volts',
  ],
  [
    'electrical.continuous_current_a',
    'Continuous current',
    'Current rating without an input, output, charging or discharging direction in this property.',
    'Prefer an explicit directional property when the source establishes it. Do not use for peak or time-limited ratings.',
    'continuous amps amperes sustained current',
  ],
  [
    'electrical.continuous_input_current_a',
    'Continuous input current',
    'Sustained current at the component input.',
    'Input differs from output; peak current is a separate meaning. AC/DC and operating conditions must remain established by the source.',
    'continuous input amps amperes supply sustained',
  ],
  [
    'electrical.continuous_output_current_a',
    'Continuous output current',
    'Sustained current provided at the component output.',
    'Output differs from input; peak current is a separate meaning. AC/DC and operating conditions must remain established by the source.',
    'continuous output amps amperes load sustained',
  ],
  [
    'electrical.continuous_charge_current_a',
    'Continuous charging current',
    'Sustained current charging a battery.',
    'Charging differs from discharging and time-limited peak ratings.',
    'continuous charge charging amps amperes',
  ],
  [
    'electrical.continuous_discharge_current_a',
    'Continuous discharging current',
    'Sustained current drawn from a battery.',
    'Discharging differs from charging and time-limited peak ratings.',
    'continuous discharge discharging amps amperes',
  ],
  [
    'electrical.peak_input_current_a',
    'Peak input current',
    'Source-stated peak current at the input.',
    'Not a continuous rating. A duration or other material condition cannot be discarded by scalar mapping.',
    'peak surge input amps amperes transient',
  ],
  [
    'electrical.peak_output_current_a',
    'Peak output current',
    'Source-stated peak current at the output.',
    'Not a continuous rating. A duration or other material condition cannot be discarded by scalar mapping.',
    'peak surge output amps amperes transient',
  ],
  [
    'electrical.peak_discharge_current_a',
    'Peak discharging current',
    'Source-stated peak current drawn from a battery.',
    'Not continuous discharge current. Conditioned current/duration relationships require qualified mapping outside this workflow.',
    'peak discharge surge amps amperes transient',
  ],
  [
    'electrical.peak_discharge_duration_s',
    'Peak discharge duration',
    'Source-stated duration associated with peak discharge.',
    'Selecting a duration property does not authorize discarding the associated rating or its conditions.',
    'peak discharge duration seconds time surge',
  ],
  [
    'electrical.continuous_power_w',
    'Continuous real power',
    'Sustained real power in watts.',
    'Watts (W) differ from apparent power in volt-amperes (VA); do not substitute a surge rating.',
    'continuous watts watt real power sustained',
  ],
  [
    'electrical.apparent_power_va',
    'Apparent power',
    'AC apparent power in volt-amperes.',
    'VA differs from real power in watts; no assumed power factor conversion.',
    'apparent power volt amperes va ac',
  ],
  [
    'electrical.ac_output_voltage_v',
    'AC output voltage',
    'Source-stated alternating-current output voltage.',
    'AC output differs from DC operating voltage and battery charging voltage.',
    'ac alternating output volts voltage',
  ],
  [
    'electrical.frequency_hz',
    'Frequency',
    'Source-stated electrical frequency.',
    'Preserve the source context; frequency does not establish AC voltage or power.',
    'frequency hertz hz cycles',
  ],
  [
    'battery.nominal_capacity_ah',
    'Nominal battery capacity',
    'Source-stated nominal charge capacity in ampere-hours.',
    'Ah differs from energy in Wh and usable capacity.',
    'battery capacity nominal amp hours ah',
  ],
  [
    'battery.nominal_energy_wh',
    'Nominal battery energy',
    'Source-stated nominal stored energy in watt-hours.',
    'Wh differs from capacity in Ah; do not calculate missing source energy here.',
    'battery energy watt hours wh nominal',
  ],
  [
    'battery.chemistry',
    'Battery chemistry',
    'Source-stated battery chemistry.',
    'Do not infer chemistry from voltage, branding or appearance.',
    'battery chemistry lithium lead acid lifepo4',
  ],
  [
    'battery.charge_current.recommended_a',
    'Recommended battery charging current',
    'Manufacturer-recommended battery charging current.',
    'A recommendation differs from maximum continuous current and a protection limit.',
    'battery recommended charge charging amps',
  ],
  [
    'battery.charge_current.maximum_continuous_a',
    'Maximum continuous battery charging current',
    'Maximum sustained battery charging current.',
    'Not the recommended current or protection trip limit.',
    'battery maximum continuous charge charging amps',
  ],
  [
    'battery.charge_current.protection_limit_a',
    'Battery charging protection limit',
    'Source-stated charging current protection limit.',
    'A protection limit is not a recommended or continuous operating current.',
    'battery charge charging protection cutoff trip amps',
  ],
  [
    'battery.allowed_series_count',
    'Allowed batteries in series',
    'Source-stated allowed count or range for series connection.',
    'Series differs from parallel; do not infer allowable connections.',
    'battery series count number connection',
  ],
  [
    'battery.allowed_parallel_count',
    'Allowed batteries in parallel',
    'Source-stated allowed count or range for parallel connection.',
    'Parallel differs from series; do not infer allowable connections.',
    'battery parallel count number connection',
  ],
  [
    'battery.usable_capacity_ah',
    'Usable battery capacity',
    'Source-stated usable charge capacity.',
    'Not nominal capacity or an inferred depth-of-discharge calculation.',
    'battery usable capacity amp hours ah',
  ],
  [
    'battery.usable_depth_of_discharge_fraction',
    'Usable depth of discharge',
    'Source-stated usable portion of battery discharge, normalized as a fraction.',
    'A fraction differs from Ah capacity; conditions and cycle-life context must remain visible.',
    'battery usable depth discharge percent percentage dod',
  ],
  [
    'battery.maximum_series_voltage_v',
    'Maximum battery series voltage',
    'Source-stated maximum voltage for a series battery arrangement.',
    'Not individual nominal voltage or charging voltage.',
    'battery maximum series voltage volts',
  ],
  [
    'battery.charging_voltage_range_v',
    'Battery charging voltage range',
    'Source-stated battery charging voltage range.',
    'Not nominal operating voltage or float voltage.',
    'battery charging charge voltage volts absorption',
  ],
  [
    'battery.float_voltage_range_v',
    'Battery float voltage range',
    'Source-stated battery float-maintenance voltage range.',
    'Float differs from charging and nominal operating voltage.',
    'battery float maintenance voltage volts',
  ],
  [
    'weight_kg',
    'Component mass',
    'Source-stated component mass.',
    'Do not substitute shipping or packaged mass.',
    'weight mass kilograms kg',
  ],
  [
    'dimensions_mm',
    'Body dimensions',
    'Source-stated component body dimensions as a structured set.',
    'Not the mounted envelope, cable space, ventilation or installation clearance. Preserve source axis orientation.',
    'physical body dimensions size length width height mm',
  ],
  [
    'dimensions_mm.x',
    'Body dimension X',
    'Source-stated body dimension along the established X axis.',
    'Do not guess which source length, width or height is X; not installation clearance.',
    'physical body dimension x size mm',
  ],
  [
    'dimensions_mm.y',
    'Body dimension Y',
    'Source-stated body dimension along the established Y axis.',
    'Do not guess which source length, width or height is Y; not installation clearance.',
    'physical body dimension y size mm',
  ],
  [
    'dimensions_mm.z',
    'Body dimension Z',
    'Source-stated body dimension along the established Z axis.',
    'Do not guess which source length, width or height is Z; not installation clearance.',
    'physical body dimension z size mm',
  ],
] as const;
export const reviewerProperties = Object.fromEntries(
  entries.map(([path, label, description, distinction, terms]) => [
    path,
    { label, description, distinction, terms },
  ]),
);
export const propertyName = (path: string) =>
  reviewerProperties[path]?.label ??
  explorerConcepts.find((c) => c.path === path)?.label ??
  'Engineering property';
export function searchEligibleProperties(
  targets: SemanticTargetResponse['targets'],
  query: string,
) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return targets.filter((target) => {
    const presentation =
      reviewerProperties[target.canonical_field] ??
      explorerConcepts.find((c) => c.path === target.canonical_field);
    if (!presentation) return false;
    const text =
      `${presentation.label} ${presentation.description} ${presentation.terms} ${target.dimension} ${target.unit} ${target.canonical_field}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

// Unit hints below describe existing property-name conventions only, never conversions.
// Returned server descriptors remain the authority for dimensions and normalization units.
const namedContractUnit = (field: string) =>
  /dimensions_mm|clearances_mm/.test(field)
    ? 'mm'
    : /weight_kg/.test(field)
      ? 'kg'
      : /_ah$/.test(field)
        ? 'Ah'
        : /_wh$/.test(field)
          ? 'Wh'
          : /_va$/.test(field)
            ? 'VA'
            : /_hz$/.test(field)
              ? 'Hz'
              : /_a$/.test(field)
                ? 'A'
                : /_v$/.test(field)
                  ? 'V'
                  : /_w$/.test(field)
                    ? 'W'
                    : /fraction$/.test(field)
                      ? 'fraction'
                      : 'Not documented / structured';
export const explorerConcepts = engineeringConcepts(reviewerProperties);
export function searchPropertyConcepts(query: string, targets: SemanticTargetResponse['targets']) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return explorerConcepts
    .filter((concept) =>
      words.every((word) =>
        (
          concept.label +
          ' ' +
          concept.description +
          ' ' +
          concept.terms +
          ' ' +
          concept.category +
          ' ' +
          namedContractUnit(concept.path) +
          ' ' +
          (targets.find((target) => target.canonical_field === concept.path)?.unit ?? '')
        )
          .toLowerCase()
          .includes(word),
      ),
    )
    .sort(
      (a, b) =>
        Number(isEligible(b, targets)) - Number(isEligible(a, targets)) ||
        a.label.localeCompare(b.label),
    );
}
const isEligible = (concept: EngineeringConcept, targets: SemanticTargetResponse['targets']) =>
  targets.some(
    (target) =>
      target.canonical_field === concept.path &&
      (target.human_adjudication === 'qualified_only'
        ? concept.representation === 'qualified'
        : concept.representation === 'direct'),
  );
const unavailable = (concept: EngineeringConcept) =>
  concept.representation === 'direct'
    ? 'This property was not returned as eligible for the selected evidence. Source role, units, scope or material conditions may prevent this mapping; discovery does not identify a specific reason.'
    : concept.representation === 'qualified'
      ? 'Known qualified representation. It is unavailable for the current source evidence, qualifier context or selected review route.'
      : 'Known canonical concept. A direct manual mapping contract is not available here.';
export function ReviewerPropertyPicker({
  targets,
  value,
  loading,
  discoveryState = 'ready',
  onChange,
}: {
  targets: SemanticTargetResponse['targets'];
  value: string;
  loading: boolean;
  discoveryState?: 'idle' | 'loading' | 'ready' | 'failed' | 'stale';
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [resultsOpen, setResultsOpen] = useState(!value);
  const [exploring, setExploring] = useState(false);
  const [category, setCategory] = useState('All categories');
  const [inspected, setInspected] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const usableTargets = !loading && discoveryState === 'ready' ? targets : [];
  const matches = searchEligibleProperties(usableTargets, query);
  const concepts = searchPropertyConcepts(query, usableTargets);
  const selected = usableTargets.find((target) => target.canonical_field === value);
  const presentation =
    selected &&
    (reviewerProperties[selected.canonical_field] ??
      explorerConcepts.find((c) => c.path === selected.canonical_field));
  const options =
    selected && presentation && !matches.includes(selected) ? [selected, ...matches] : matches;
  const close = () => {
    // Native modal inertness must end before returning focus to its outside trigger.
    // Focusing first works in jsdom but is ignored by real browsers.
    dialog.current?.close?.();
    setExploring(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!exploring) return;
    const panel = dialog.current;
    // Native modal focus/inert behavior in browsers; open fallback supports nonvisual DOM tests.
    if (panel?.showModal) panel.showModal();
    else panel?.setAttribute('open', '');
    search.current?.focus({ preventScroll: true });
    return () => {
      if (panel?.close) panel.close();
    };
  }, [exploring]);
  const choose = (concept: EngineeringConcept) => {
    // Both entry points intersect the same latest server response. Browsing grants no permission.
    if (!isEligible(concept, usableTargets)) return;
    onChange(concept.path);
    setResultsOpen(false);
    if (exploring) close();
  };
  const renderResult = (concept: EngineeringConcept, detailed = false) => {
    const eligible = isEligible(concept, usableTargets);
    const descriptor = usableTargets.find((entry) => entry.canonical_field === concept.path);
    return (
      <li key={concept.id} className={'property-result ' + (eligible ? 'eligible' : 'unavailable')}>
        <div className="property-result-heading">
          <strong>{concept.label}</strong>
          <span className="review-badge">{eligible ? 'Eligible now' : 'Unavailable'}</span>
        </div>
        <p>{concept.description}</p>
        <small>
          {concept.category} ·{' '}
          {descriptor
            ? descriptor.dimension + ' · ' + descriptor.unit
            : 'Named contract unit: ' +
              namedContractUnit(concept.path) +
              '; not an eligible target'}
        </small>
        {eligible ? (
          <button
            type="button"
            aria-pressed={value === concept.path}
            onClick={() => choose(concept)}
          >
            Select {concept.label}
          </button>
        ) : (
          <p className="availability-reason">{unavailable(concept)}</p>
        )}
        <details
          open={detailed || inspected === concept.id}
          onToggle={(event) => {
            if (event.currentTarget.open) setInspected(concept.id);
          }}
        >
          <summary>Meaning and contract details</summary>
          <p>{concept.distinction}</p>
          <code>{concept.path}</code>
          {!!concept.contractFields?.length && (
            <p>
              Defined {concept.representation === 'qualified' ? 'qualifier' : 'structure'} keys:{' '}
              {concept.contractFields.join(', ')}
            </p>
          )}
          <p>
            Representation:{' '}
            {concept.representation === 'qualified'
              ? 'qualified_values source rating'
              : concept.representation === 'direct'
                ? 'Direct-review target; eligibility remains server-owned'
                : 'Canonical structure / property'}
          </p>
        </details>
      </li>
    );
  };
  const feedback = (
    <div role="status" className="property-feedback">
      {loading || discoveryState === 'loading'
        ? 'Checking eligible engineering properties…'
        : discoveryState === 'failed'
          ? 'Target discovery failed. This is not an empty catalog; retry discovery or leave the decision unresolved.'
          : discoveryState === 'stale'
            ? 'Discovery is stale. Recheck the current evidence before selecting a property.'
            : discoveryState === 'idle'
              ? 'Select supporting evidence to check which properties are eligible.'
              : !usableTargets.length
                ? 'No eligible engineering property was returned for this evidence. Mapping is unavailable under the current contract. You may keep evidence, leave unresolved or report a possible missing property.'
                : usableTargets.length + ' eligible engineering properties for this evidence.'}
      {!concepts.length && (
        <p>
          No text match. Try other words or clear search. This does not prove a missing engineering
          concept.
        </p>
      )}
      {!!concepts.length && !concepts.some((concept) => isEligible(concept, usableTargets)) && (
        <p>Known concepts match, but none is selectable for this source binding.</p>
      )}
    </div>
  );
  return (
    <div className="property-finder" id="engineering-property">
      <div className="property-search-controls">
        <label>
          Search engineering properties
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setResultsOpen(true);
            }}
            placeholder="e.g. output amps, voltage, dimensions"
          />
        </label>
        <button type="button" ref={trigger} onClick={() => setExploring(true)}>
          Browse all engineering properties
        </button>
      </div>
      {feedback}
      <label>
        Engineering property
        <select
          value={value}
          disabled={!options.length || loading || discoveryState !== 'ready'}
          onChange={(event) => {
            if (options.some((entry) => entry.canonical_field === event.target.value)) {
              onChange(event.target.value);
              setResultsOpen(false);
            }
          }}
        >
          <option value="">Choose an engineering property</option>
          {options.map((entry) => (
            <option key={entry.canonical_field} value={entry.canonical_field}>
              {propertyName(entry.canonical_field)} · {entry.unit}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        {concepts.length} catalog matches · eligible results first. A known property is not
        automatically eligible.
      </p>
      {/* Twelve compact results bound reading height, not vocabulary or eligibility. Explorer exposes every indexed result. */}
      {!value || resultsOpen ? (
        <ul className="property-quick-results" aria-label="Property search results">
          {concepts.slice(0, 12).map((entry) => renderResult(entry))}
        </ul>
      ) : (
        <button type="button" onClick={() => setResultsOpen(true)}>
          Change selected property
        </button>
      )}
      {(!value || resultsOpen) && concepts.length > 12 && (
        <p>
          Showing 12 of {concepts.length} matches. Browse all engineering properties for the
          complete indexed results.
        </p>
      )}
      {targets.some(
        (entry) =>
          !reviewerProperties[entry.canonical_field] &&
          !explorerConcepts.some((c) => c.path === entry.canonical_field),
      ) && (
        <p role="alert">
          A returned property lacks a reviewed description and is withheld from selection. Report
          this presentation catalog gap.
        </p>
      )}
      {selected && presentation && (
        <div className="property-description">
          <strong>{presentation.label}</strong>
          <p>{presentation.description}</p>
          <p>
            Quantity: {selected.dimension} · Normal units: {selected.unit}
          </p>
          <ReviewHelp topic="Similar engineering properties">{presentation.distinction}</ReviewHelp>
        </div>
      )}
      {exploring && (
        <dialog
          ref={dialog}
          aria-label="Engineering property explorer"
          aria-modal="true"
          className="property-explorer"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
            // Native dialog traps focus. The fallback also keeps keyboard focus inside the modal.
            if (event.key === 'Tab') {
              const nodes = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),input,select,summary,[tabindex="0"]',
                ),
              );
              const first = nodes[0],
                last = nodes.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <div className="explorer-header">
            <div>
              <h2>Engineering property catalog</h2>
              <p>Existing component schema concepts · read-only browsing</p>
            </div>
            <button type="button" onClick={close}>
              Close explorer
            </button>
          </div>
          <label>
            Search full property catalog
            <input
              type="search"
              ref={search}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setResultsOpen(true);
              }}
              placeholder="Names, descriptions, units, common terms…"
            />
          </label>
          <div className="explorer-layout">
            <nav aria-label="Property categories">
              {['All categories', ...new Set(explorerConcepts.map((entry) => entry.category))].map(
                (entry) => (
                  <button
                    key={entry}
                    type="button"
                    aria-pressed={category === entry}
                    onClick={() => setCategory(entry)}
                  >
                    {entry}
                  </button>
                ),
              )}
            </nav>
            <div>
              {feedback}
              <p>
                {
                  concepts.filter(
                    (entry) => category === 'All categories' || entry.category === category,
                  ).length
                }{' '}
                matches in this category
              </p>
              <ul className="explorer-results">
                {concepts
                  .filter((entry) => category === 'All categories' || entry.category === category)
                  .map((entry) => renderResult(entry))}
              </ul>
            </div>
          </div>
          <p className="muted">
            This is a bounded index of component engineering sections and qualified-value targets,
            not an exhaustive platform vocabulary. Open-ended structures have no invented leaf
            properties. Incomplete schema descriptions remain explicitly undocumented. A possible
            missing concept requires human review.
          </p>
        </dialog>
      )}
    </div>
  );
}
