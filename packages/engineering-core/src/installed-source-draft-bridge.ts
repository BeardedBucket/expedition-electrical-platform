import type { ComponentLibraryRecord } from './component-library.js';
import type { WholeSystemEvaluationInput } from './engineering-passport-contracts.js';
import {
  parseSourceGroundedDraft,
  type DraftValue,
  type SourceGroundedFact,
} from './source-grounded-draft.js';
import { parseEngineeringProfile } from './engineering-profile.js';
import { passportDigest, serializePassportValue } from './portable-json.js';
import { evaluateInstalledSystem } from './whole-system-evaluator.js';
import Ajv2020 from 'ajv/dist/2020.js';
import scenarioSchema from '../../../data/schemas/installed-source-draft-scenario.schema.json' with { type: 'json' };
import { sourceDraftPvChecks, type SourceDraftPvArray } from './source-draft-pv.js';

export interface InstalledSourceDraftScenario {
  version: 'installed-source-draft-scenario.v1';
  pv_arrays?: SourceDraftPvArray[];
  uses: {
    instance_id: string;
    requirements: {
      quantity: string;
      mode: string;
      direction: SourceGroundedFact['direction'];
      electrical_domain: SourceGroundedFact['electrical_domain'];
      unit: string;
      value: number | string;
      predicate: 'within_range' | 'at_most' | 'at_least' | 'equals';
      conditions: { key: string; value: number | string | boolean; unit: string }[];
    }[];
  }[];
}
// Consumer registry owns electrical meaning and unit: arbitrary source labels
// are retained for review but cannot accidentally become actionable limits.
const quantities: Record<string, string> = {
  input_voltage_range: 'V',
  output_voltage_range: 'V',
  operating_voltage_range: 'V',
  charge_voltage_max: 'V',
  output_power: 'W',
  output_apparent_power: 'VA',
  output_current: 'A',
  input_current_max: 'A',
  charge_current: 'A',
  discharge_current: 'A',
  ac_phase: 'text',
  ambient_temperature_range: 'degC',
  battery_cell_charge_range: 'degC',
  clearance_above: 'mm',
  clearance_below: 'mm',
  max_input_isc: 'A',
  max_input_voc: 'V',
  clearance_left: 'mm',
  clearance_right: 'mm',
  installed_ambient_max: 'degC',
  shunt_measurement_max: 'A',
  measurement_current_range: 'A',
  measurement_voltage_range: 'V',
};
const range = (v: DraftValue): v is { min: number; max: number } =>
  typeof v === 'object' && 'min' in v;
const predicateFor = (quantity: string) =>
  quantity === 'ac_phase'
    ? 'equals'
    : quantity.startsWith('clearance_')
      ? 'at_least'
      : quantity.endsWith('_range')
        ? 'within_range'
        : 'at_most';
const actionableBasis = (f: SourceGroundedFact) =>
  f.quantity === 'ac_phase'
    ? ['operating', 'descriptive'].includes(f.basis)
    : f.quantity.startsWith('clearance_') || f.quantity === 'installed_ambient_max'
      ? f.basis === 'installation'
      : f.quantity.endsWith('_range')
        ? ['operating', 'measurement'].includes(f.basis)
        : ['absolute', 'continuous', 'peak', 'operating', 'measurement'].includes(f.basis);
const conditionApplies = (source: DraftValue, installed: number | string | boolean) =>
  range(source)
    ? typeof installed === 'number' && installed >= source.min && installed <= source.max
    : source === installed;
const copy = <T>(v: T): T => JSON.parse(serializePassportValue(v)) as T;
const Ajv = Ajv2020 as unknown as new (options: object) => {
  compile(s: unknown): (v: unknown) => boolean;
};
const validScenario = new Ajv({ strict: false, strictNumbers: true }).compile(scenarioSchema);

/** Bounded provisional fact diagnostics, additive to actual Phase 3/5 gates.
 * Every source qualifier must apply before either YES or NO. No interpolation,
 * cross-mode rating borrowing, inferred port, missing condition or source review.
 * Even all proven comparisons retain mandatory source/installation authority holds. */
export function bindInstalledSourceDrafts(
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
  raw: InstalledSourceDraftScenario,
) {
  if (
    !validScenario(raw) ||
    (!raw.uses.length && !raw.pv_arrays?.length) ||
    new Set(raw.uses.map((u) => u.instance_id)).size !== raw.uses.length ||
    // This version compares a controller-wide array group. Splitting one
    // physical controller into several groups could borrow its entire current
    // budget repeatedly. Independent tracker/group sharing needs its own proof.
    new Set(raw.pv_arrays?.map((a) => a.controller_instance_id)).size !==
      (raw.pv_arrays?.length ?? 0) ||
    new Set(catalog.map((c) => c.id)).size !== catalog.length
  )
    throw Error('Ambiguous/unsupported source draft scenario');
  const scenario = copy(raw);
  const checks: {
    instance_id: string;
    quantity: string;
    status: 'BLOCKED' | 'UNRESOLVED' | 'ELIGIBLE';
    reason: string;
    fact_ids: string[];
  }[] = [];
  for (const use of scenario.uses) {
    if (!use.instance_id || !Array.isArray(use.requirements) || !use.requirements.length)
      throw Error('Exact owner and requirements needed');
    const instances =
      input.architecture.installation.component_instances?.filter(
        (i) => i.id === use.instance_id,
      ) ?? [];
    if (instances.length > 1) throw Error('Ambiguous installed owner');
    const record = catalog.find((c) => c.id === instances[0]?.component_id);
    const p = record?.engineering_profile
      ? parseEngineeringProfile(record.engineering_profile)
      : undefined;
    const d = p?.source_specification
      ? parseSourceGroundedDraft(p.source_specification)
      : undefined;
    for (const req of use.requirements) {
      if (
        (typeof req.value !== 'number' && typeof req.value !== 'string') ||
        (typeof req.value === 'number' && !Number.isFinite(req.value)) ||
        !['within_range', 'at_most', 'at_least', 'equals'].includes(req.predicate) ||
        !Array.isArray(req.conditions) ||
        new Set(req.conditions.map((c) => c.key)).size !== req.conditions.length ||
        req.conditions.some(
          (c) => !c.key || !c.unit || (typeof c.value === 'number' && !Number.isFinite(c.value)),
        )
      )
        throw Error('Invalid explicit source draft requirement');
      const add = (
        status: 'BLOCKED' | 'UNRESOLVED' | 'ELIGIBLE',
        reason: string,
        ids: string[] = [],
      ) =>
        checks.push({
          instance_id: use.instance_id,
          quantity: req.quantity,
          status,
          reason,
          fact_ids: ids,
        });
      // The registry owns rating meaning. A caller cannot invert a minimum
      // clearance into a maximum or compare signed flow as a demand magnitude.
      if (quantities[req.quantity] && req.predicate !== predicateFor(req.quantity))
        throw Error('Requirement predicate contradicts quantity semantics');
      if (
        [
          'output_power',
          'output_apparent_power',
          'output_current',
          'input_current_max',
          'charge_current',
          'discharge_current',
          'shunt_measurement_max',
        ].includes(req.quantity) &&
        typeof req.value === 'number' &&
        req.value < 0
      )
        throw Error('Directional power/current demands require nonnegative magnitude');
      if (
        d &&
        (d.product.id !== record!.id ||
          d.product.model !== record!.model ||
          (record!.manufacturer_revision != null &&
            d.product.hardware_revision !== null &&
            d.product.hardware_revision !== record!.manufacturer_revision))
      ) {
        add('BLOCKED', 'Exact installed source model/revision contradicts draft ownership');
        continue;
      }
      if (d && record!.manufacturer_revision != null && d.product.hardware_revision === null) {
        add(
          'UNRESOLVED',
          'Source hardware revision applicability is unknown for this explicitly revisioned installed record',
        );
        continue;
      }
      if (d && record!.manufacturer_revision == null && d.product.hardware_revision !== null) {
        add(
          'UNRESOLVED',
          'Installed hardware revision is unknown for revision-specific source facts',
        );
        continue;
      }
      if (!d || quantities[req.quantity] !== req.unit) {
        add('UNRESOLVED', 'Missing exact draft or unimplemented quantity/unit consumer');
        continue;
      }
      const facts = d.facts.filter(
        (f) =>
          f.quantity === req.quantity &&
          f.mode === req.mode &&
          f.direction === req.direction &&
          f.electrical_domain === req.electrical_domain &&
          f.normalized.unit === req.unit &&
          f.disposition === 'typed_consumer' &&
          actionableBasis(f),
      );
      const applicable = facts.filter(
        (f) =>
          !f.unresolved_conditions.length &&
          f.conditions.every((c) => {
            const given = req.conditions.find((k) => k.key === c.key && k.unit === c.unit);
            return given !== undefined && conditionApplies(c.value, given.value);
          }),
      );
      // Multiple ratings (e.g. duration-specific boost) are all examined only if
      // their exact predicates apply. Competing same-context values abstain.
      if (!applicable.length) {
        add(
          'UNRESOLVED',
          'Source rating absent or applicability unproven',
          facts.map((f) => f.id),
        );
        continue;
      }
      if (new Set(applicable.map((f) => serializePassportValue(f.normalized.value))).size !== 1) {
        add(
          'UNRESOLVED',
          'Competing applicable source ratings require human reconciliation',
          applicable.map((f) => f.id),
        );
        continue;
      }
      const value = applicable[0]!.normalized.value;
      if (typeof value === 'number' && value < 0 && req.unit !== 'degC') {
        add(
          'UNRESOLVED',
          'Negative scalar is not a modeled magnitude/minimum rating',
          applicable.map((f) => f.id),
        );
        continue;
      }
      const okay =
        req.predicate === 'equals'
          ? value === req.value
          : req.predicate === 'within_range' && range(value) && typeof req.value === 'number'
            ? req.value >= value.min && req.value <= value.max
            : req.predicate === 'at_most' &&
                typeof value === 'number' &&
                typeof req.value === 'number'
              ? req.value <= value
              : req.predicate === 'at_least' &&
                  typeof value === 'number' &&
                  typeof req.value === 'number'
                ? req.value >= value
                : undefined;
      add(
        okay === undefined ? 'UNRESOLVED' : okay ? 'ELIGIBLE' : 'BLOCKED',
        okay === undefined
          ? 'Incompatible quantity shape/predicate'
          : 'Compare exact source value within proven mode/direction/conditions',
        applicable.map((f) => f.id),
      );
    }
    checks.push({
      instance_id: use.instance_id,
      quantity: 'authority_and_installation',
      status: 'UNRESOLVED',
      reason:
        'Codex-prepared facts are unreviewed; physical wiring, protection, thermal, grounding and installation suitability remain separate',
      fact_ids: [],
    });
  }
  checks.push(...sourceDraftPvChecks(input, catalog, scenario.pv_arrays ?? []));
  const content = {
    version: 'installed-source-draft-binding.v1' as const,
    scenario,
    original_input: copy(input),
    catalog: copy(catalog),
    checks,
    status: checks.some((c) => c.status === 'BLOCKED')
      ? ('BLOCKED' as const)
      : ('UNRESOLVED' as const),
  };
  const digest = passportDigest(content);
  const owned = copy(input);
  const bound: WholeSystemEvaluationInput = {
    ...owned,
    requirements: {
      ...owned.requirements,
      mandatory_conditions: [
        ...(owned.requirements.mandatory_conditions ?? []),
        {
          id: 'installed_source_drafts',
          subject_id: 'explicit_source_draft_requirements',
          status: content.status === 'BLOCKED' ? 'blocked' : 'unresolved',
          artifact_digest: digest,
          reason_codes: checks
            .filter((c) => c.status !== 'ELIGIBLE')
            .map((c) => `${c.instance_id}:${c.quantity}:${c.reason}`)
            .sort(),
        },
      ],
    },
  };
  return { ...content, digest, input: bound };
}
export function evaluateInstalledSourceDrafts(
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
  scenario: InstalledSourceDraftScenario,
) {
  const binding = bindInstalledSourceDrafts(input, catalog, scenario);
  const content = {
    version: 'installed-source-draft-evaluation.v1' as const,
    binding,
    passport: evaluateInstalledSystem(binding.input, catalog),
  };
  return { ...content, digest: passportDigest(content) };
}
export function replayInstalledSourceDrafts(raw: unknown) {
  const r = raw as ReturnType<typeof evaluateInstalledSourceDrafts>;
  if (r?.version !== 'installed-source-draft-evaluation.v1')
    throw Error('Unsupported source draft replay');
  const rebuilt = evaluateInstalledSourceDrafts(
    r.binding.original_input,
    r.binding.catalog,
    r.binding.scenario,
  );
  if (serializePassportValue(rebuilt) !== serializePassportValue(raw))
    throw Error('Source draft replay mismatch');
  return rebuilt;
}
