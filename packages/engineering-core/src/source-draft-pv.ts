import type { ComponentLibraryRecord } from './component-library.js';
import type { WholeSystemEvaluationInput } from './engineering-passport-contracts.js';
import {
  parseSourceGroundedDraft,
  type SourceGroundedDraft,
  type SourceGroundedFact,
} from './source-grounded-draft.js';
import { serializePassportValue } from './portable-json.js';

// A shared model label alone cannot justify a homogeneous series current. This
// deliberately conservative equivalence requires the same retained source and
// document revision, product identity/revision, and applicable rating meaning.
// Separate record/fact IDs are allowed; different source editions remain held
// even if their numbers coincide, pending explicit human reconciliation. This
// compares proposed assertions, not authenticity, wiring or full I-V behavior.
function currentAssertion(draft: SourceGroundedDraft, fact: SourceGroundedFact) {
  const source = draft.sources.find((s) => s.id === fact.source_id)!;
  return {
    product: {
      manufacturer: draft.product.manufacturer,
      model: draft.product.model,
      manufacturer_part_number: draft.product.manufacturer_part_number,
      hardware_revision: draft.product.hardware_revision,
    },
    source: {
      digest: source.content_digest,
      document_revision: source.document_revision,
      publisher: source.publisher,
      model: source.model,
    },
    quantity: fact.quantity,
    normalized: fact.normalized,
    basis: fact.basis,
    mode: fact.mode,
    direction: fact.direction,
    electrical_domain: fact.electrical_domain,
    conditions: [...fact.conditions].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}

export interface SourceDraftPvArray {
  controller_instance_id: string;
  strings: { series_count: number; module_instance_ids: string[] | null }[];
  module_temperature_c: number | null;
  irradiance_w_m2: number | null;
  spectrum: string | null;
  tracker_id: string | null;
  battery_voltage_v?: number | null;
  controller_state?: 'startup' | 'running' | null;
}
export interface SourceDraftCheck {
  instance_id: string;
  quantity: string;
  status: 'BLOCKED' | 'UNRESOLVED' | 'ELIGIBLE';
  reason: string;
  fact_ids: string[];
  trace?: {
    formula: string;
    inputs: { string_values: number[]; limit: number };
    unit: string;
    assumptions: string[];
  };
}

/** Diagnostic source-reference array arithmetic over exact declared pieces.
 * Physical membership is independent of series/parallel connection proof. No
 * missing ports/edges, tracker count, coefficient or ambient/cell conversion is
 * synthesized. Mixed source/model strings withhold I-V and yield arithmetic. */
export function sourceDraftPvChecks(
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
  arrays: readonly SourceDraftPvArray[],
): SourceDraftCheck[] {
  const checks: SourceDraftCheck[] = [];
  const used = new Set<string>();
  const get = (id: string) => {
    const matches =
      input.architecture.installation.component_instances?.filter((i) => i.id === id) ?? [];
    if (matches.length > 1) throw Error('Ambiguous PV physical owner');
    const record = catalog.find((c) => c.id === matches[0]?.component_id);
    const draft = record?.engineering_profile?.source_specification;
    return draft ? { record: record!, draft: parseSourceGroundedDraft(draft) } : undefined;
  };
  for (const array of arrays) {
    const add = (
      quantity: string,
      status: SourceDraftCheck['status'],
      reason: string,
      ids: string[] = [],
      trace?: SourceDraftCheck['trace'],
    ) =>
      checks.push({
        instance_id: array.controller_instance_id,
        quantity,
        status,
        reason,
        fact_ids: ids,
        ...(trace ? { trace } : {}),
      });
    const controller = get(array.controller_instance_id);
    const modules: { record: ComponentLibraryRecord; draft: SourceGroundedDraft }[][] = [];
    let inventoryKnown = true;
    for (const string of array.strings) {
      if (string.module_instance_ids === null) {
        add('pv_physical_inventory', 'UNRESOLVED', 'Physical module inventory missing');
        inventoryKnown = false;
        continue;
      }
      if (string.module_instance_ids.length !== string.series_count) {
        add(
          'pv_physical_count',
          'BLOCKED',
          'Declared series count contradicts exact physical inventory',
        );
        inventoryKnown = false;
        continue;
      }
      const owners = [];
      for (const id of string.module_instance_ids) {
        if (used.has(id)) {
          add(
            'pv_physical_owner_reused',
            'BLOCKED',
            'One physical module cannot occupy two strings/arrays',
          );
          inventoryKnown = false;
          continue;
        }
        used.add(id);
        const owner = get(id);
        if (!owner) {
          add(
            'pv_physical_owner',
            'UNRESOLVED',
            'Exact physical source/model snapshot unavailable',
          );
          inventoryKnown = false;
          continue;
        }
        if (
          owner.record.id !== owner.draft.product.id ||
          owner.record.model !== owner.draft.product.model ||
          (owner.record.manufacturer_revision != null &&
            owner.draft.product.hardware_revision !== null &&
            owner.record.manufacturer_revision !== owner.draft.product.hardware_revision)
        ) {
          add(
            'pv_physical_owner',
            'BLOCKED',
            'Physical model/revision contradicts the source draft',
          );
          inventoryKnown = false;
          continue;
        }
        if (
          owner.record.manufacturer_revision != null &&
          owner.draft.product.hardware_revision === null
        ) {
          add(
            'pv_physical_revision',
            'UNRESOLVED',
            'Source revision applicability unknown for explicitly revisioned module',
          );
          inventoryKnown = false;
          continue;
        }
        if (
          owner.record.manufacturer_revision == null &&
          owner.draft.product.hardware_revision !== null
        ) {
          add(
            'pv_physical_revision',
            'UNRESOLVED',
            'Physical module revision unknown for revision-specific source',
          );
          inventoryKnown = false;
          continue;
        }
        owners.push(owner);
      }
      modules.push(owners);
    }
    if (!controller || !inventoryKnown) {
      add(
        'pv_electrical_envelope',
        'UNRESOLVED',
        'No envelope from incomplete exact inventory/controller',
      );
      continue;
    }
    if (
      controller.record.model !== controller.draft.product.model ||
      controller.record.id !== controller.draft.product.id
    ) {
      add('pv_controller_owner', 'BLOCKED', 'Foreign controller model/source');
      continue;
    }
    if (
      controller.record.manufacturer_revision != null &&
      controller.draft.product.hardware_revision === null
    ) {
      add(
        'pv_controller_revision',
        'UNRESOLVED',
        'Source revision applicability unknown for explicitly revisioned controller',
      );
      continue;
    }
    if (
      controller.record.manufacturer_revision == null &&
      controller.draft.product.hardware_revision !== null
    ) {
      add(
        'pv_controller_revision',
        'UNRESOLVED',
        'Installed controller revision unknown for revision-specific source',
      );
      continue;
    }
    if (
      controller.record.manufacturer_revision != null &&
      controller.draft.product.hardware_revision !== null &&
      controller.record.manufacturer_revision !== controller.draft.product.hardware_revision
    ) {
      add('pv_controller_revision', 'BLOCKED', 'Known controller/source revisions differ');
      continue;
    }
    if (
      new Set(modules.flat().map((m) => m.draft.product.model)).size !== 1 ||
      new Set(array.strings.map((s) => s.series_count)).size !== 1
    ) {
      add('pv_mixed_iv', 'UNRESOLVED', 'Mixed-string/model I-V behavior is not modeled');
      continue;
    }
    const numeric = (d: SourceGroundedDraft, q: string) => {
      const facts = d.facts.filter(
        (f) => f.quantity === q && typeof f.normalized.value === 'number',
      );
      return facts.length === 1 ? facts[0] : undefined;
    };
    let vocUpper: number | undefined;
    let vocEvidence: string[] = [];
    for (const [q, coefficient, limit, unit, parallel] of [
      ['pv_voc', 'beta_voc', 'max_input_voc', 'V', false],
      ['pv_isc', 'alpha_isc', 'max_input_isc', 'A', true],
    ] as const) {
      const values: number[] = [];
      const evidence: string[] = [];
      let currentEquivalenceMissing = false;
      for (const string of modules) {
        const each: number[] = [];
        const currentAssertions: string[] = [];
        for (const module of string) {
          const f = numeric(module.draft, q);
          const temperature = f?.conditions.find(
            (c) => c.key === 'module_temperature_c' && c.unit === 'degC',
          )?.value;
          const irradiance = f?.conditions.find(
            (c) => c.key === 'irradiance_w_m2' && c.unit === 'W/m2',
          )?.value;
          const spectrum = f?.conditions.find((c) => c.key === 'spectrum')?.value;
          if (
            !f ||
            f.basis !== 'nominal' ||
            f.mode !== 'pv_reference' ||
            f.direction !== 'output' ||
            f.electrical_domain !== 'dc' ||
            f.conditions.length !== 3 ||
            (f.normalized.value as number) <= 0 ||
            f.normalized.unit !== unit ||
            f.disposition !== 'typed_consumer' ||
            f.unresolved_conditions.length ||
            typeof temperature !== 'number' ||
            array.module_temperature_c === null ||
            irradiance !== array.irradiance_w_m2 ||
            spectrum !== array.spectrum
          )
            continue;
          let value = f.normalized.value as number;
          let appliedCoefficient: SourceGroundedFact | undefined;
          evidence.push(f.id);
          if (array.module_temperature_c !== temperature) {
            const beta = numeric(module.draft, coefficient);
            const domain = beta?.conditions.find(
              (c) => c.key === 'coefficient_temperature_c' && c.unit === 'degC',
            )?.value;
            if (
              !beta ||
              beta.disposition !== 'typed_consumer' ||
              beta.basis !== 'operating' ||
              beta.mode !== 'pv_coefficient' ||
              beta.direction !== 'output' ||
              beta.electrical_domain !== 'dc' ||
              beta.conditions.length !== 1 ||
              beta.unresolved_conditions.length ||
              !domain ||
              typeof domain !== 'object' ||
              !('min' in domain) ||
              array.module_temperature_c < domain.min ||
              array.module_temperature_c > domain.max
            )
              continue;
            const delta = array.module_temperature_c - temperature;
            // Celsius and Kelvin increments are equal; percent is per hundred.
            // No absolute-temperature offset or hidden rating-unit rewrite.
            if (['%/K', 'percent/K'].includes(beta.normalized.unit))
              value *= 1 + ((beta.normalized.value as number) / 100) * delta;
            else if (beta.normalized.unit === 'fraction/K')
              value *= 1 + (beta.normalized.value as number) * delta;
            else if (beta.normalized.unit === unit + '/K')
              value += (beta.normalized.value as number) * delta;
            else continue;
            if (!Number.isFinite(value) || value <= 0) continue;
            evidence.push(beta.id);
            appliedCoefficient = beta;
          }
          each.push(value);
          if (parallel)
            currentAssertions.push(
              serializePassportValue({
                reference: currentAssertion(module.draft, f),
                coefficient: appliedCoefficient
                  ? currentAssertion(module.draft, appliedCoefficient)
                  : null,
              }),
            );
        }
        if (each.length !== string.length) continue;
        if (parallel && new Set(currentAssertions).size !== 1) {
          currentEquivalenceMissing = true;
          continue;
        }
        // Only source-qualified equivalent modules justify one series Isc;
        // parallel string currents sum. Never select min/max for mixed I-V data.
        values.push(parallel ? each[0]! : each.reduce((s, v) => s + v, 0));
      }
      const bound = numeric(controller.draft, limit);
      if (q === 'pv_voc' && values.length === modules.length) {
        vocUpper = Math.max(...values);
        vocEvidence = [...evidence];
      }
      if (
        values.length !== modules.length ||
        !bound ||
        bound.basis !== 'absolute' ||
        bound.mode !== 'pv_input' ||
        bound.direction !== 'input' ||
        bound.electrical_domain !== 'dc' ||
        typeof bound.normalized.value !== 'number' ||
        bound.normalized.value <= 0 ||
        bound.disposition !== 'typed_consumer' ||
        bound.normalized.unit !== unit ||
        bound.unresolved_conditions.length ||
        bound.conditions.length
      ) {
        add(
          q,
          'UNRESOLVED',
          currentEquivalenceMissing
            ? 'Homogeneous series Isc source/reference/revision equivalence is unproved; mixed I-V current is not modeled'
            : 'Exact reference/coefficient domain or controller limit prerequisite missing',
          evidence,
        );
        continue;
      }
      if (array.tracker_id !== null) {
        add(
          q,
          'UNRESOLVED',
          'Per-independent-tracker ownership is not proved by a caller label',
          evidence,
        );
        continue;
      }
      const total = parallel ? values.reduce((s, v) => s + v, 0) : Math.max(...values);
      const ceiling = bound.normalized.value as number;
      add(
        q,
        total > ceiling ? 'BLOCKED' : 'ELIGIBLE',
        `Reference array ${total} ${unit} versus source limit ${ceiling} ${unit}; ${parallel ? 'Np × source Isc' : 'Ns × source Voc; largest same-model string'}`,
        [...evidence, bound.id],
        {
          formula: parallel
            ? 'sum(string Isc) <= controller source current limit'
            : 'max(sum(module Voc per string)) <= controller source absolute voltage limit',
          inputs: { string_values: values, limit: ceiling },
          unit,
          assumptions: [
            'Explicit module temperature, irradiance and spectrum match source reference or independently supported coefficient domain',
            'Same-model equal-length strings and exact declared physical members',
            ...(parallel
              ? [
                  'Each series string has equivalent source-qualified Isc and applied coefficient assertions from the same document/revision',
                ]
              : []),
            'Declared arrangement only; physical connection, tracker grouping and full installation proof remain unknown',
          ],
        },
      );
    }
    const headroom = array.controller_state
      ? numeric(
          controller.draft,
          array.controller_state === 'startup' ? 'startup_delta_v' : 'running_delta_v',
        )
      : undefined;
    if (
      vocUpper !== undefined &&
      array.battery_voltage_v != null &&
      headroom?.normalized.unit === 'V' &&
      headroom.basis === 'operating' &&
      headroom.mode === array.controller_state &&
      headroom.direction === 'input' &&
      headroom.electrical_domain === 'dc' &&
      headroom.disposition === 'typed_consumer' &&
      !headroom.unresolved_conditions.length &&
      !headroom.conditions.length
    ) {
      // Generic PV voltage need not be relabeled Vmp to prove a necessary NO:
      // under the declared passive source/reference model, operating voltage
      // cannot exceed open-circuit voltage. Exceeding this upper-bound test still
      // cannot prove startup/running or replace an operating Vmp/basis consumer.
      const threshold = array.battery_voltage_v + (headroom.normalized.value as number);
      const impossible =
        array.controller_state === 'startup' ? vocUpper <= threshold : vocUpper < threshold;
      add(
        'pv_state_headroom_necessary',
        impossible ? 'BLOCKED' : 'UNRESOLVED',
        impossible
          ? `Declared source Voc upper bound ${vocUpper} V cannot satisfy required ${array.controller_state} threshold ${threshold} V`
          : 'Voc upper bound does not establish actual operating voltage or state transition',
        [...vocEvidence, headroom.id],
        {
          formula:
            array.controller_state === 'startup'
              ? 'source Voc upper bound must be > battery voltage + source start headroom'
              : 'source Voc upper bound must be >= battery voltage + source running minimum headroom',
          inputs: { string_values: [vocUpper], limit: threshold },
          unit: 'V',
          assumptions: [
            'Explicit controller state and battery voltage',
            'Passive forward-generating PV source under its proven reference/coefficient model; no external voltage forcing',
            'No positive startup, restart or operating-Vmp claim',
          ],
        },
      );
    } else
      add(
        'pv_state_headroom_necessary',
        'UNRESOLVED',
        'Controller state, actual battery voltage, Voc model or source headroom applicability missing',
      );
    add(
      'hot_vmp_operating',
      'UNRESOLVED',
      'No inferred beta-Vmp or operating-upper voltage basis; actual operating and restart proof remain separate',
    );
    add(
      'tracker_ports_wiring_protection',
      'UNRESOLVED',
      'No independent tracker/terminal, source connection, protection, service or installation authority established',
    );
  }
  return checks;
}
