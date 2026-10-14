import type { ComponentLibraryRecord } from './component-library.js';
import type { WholeSystemEvaluationInput } from './engineering-passport-contracts.js';
import {
  parseEngineeringProfile,
  type EngineeringProfile,
  type EngineeringStatus,
} from './engineering-profile.js';
import { hasCurrentCanonicalVerification } from './canonical-verification.js';
import { passportDigest, serializePassportValue } from './portable-json.js';
import { evaluateInstalledSystem } from './whole-system-evaluator.js';
import Ajv2020 from 'ajv/dist/2020.js';
import scenarioSchema from '../../../data/schemas/installed-operating-scenario.schema.json' with { type: 'json' };

export interface InstalledOperatingScenario {
  version: 'installed-operating-scenario.v1';
  uses: {
    instance_id: string;
    battery?: {
      operation: 'charge' | 'discharge';
      temperature?: {
        value_c: number;
        measurement_point: 'battery_cell' | 'ambient';
        rationale: string;
      };
      heater_state?: 'after_heating' | 'not_after_heating';
      series_count?: number;
      parallel_count?: number;
      matched_bank?: boolean;
      requires_bms_recovery?: boolean;
    };
    monitoring?: {
      quantity: 'dc_current' | 'dc_voltage';
      max_error_percent: number;
      basis: 'reading' | 'full_scale';
      measured_value?: number;
      temperature_c?: number;
      measurement_path?: 'external_shunt';
      current_path_a?: number;
      shunt_current_a?: number;
      shunt_drop_mv?: number;
      calibration_evidence_id?: string;
    };
  }[];
}
export interface OperatingCheck {
  code: string;
  instance_id: string;
  status: EngineeringStatus;
  explanation: string;
  evidence_ids: string[];
}
const aggregate = (checks: OperatingCheck[]): EngineeringStatus =>
  checks.some((c) => c.status === 'BLOCKED')
    ? 'BLOCKED'
    : checks.some((c) => c.status === 'UNRESOLVED') || !checks.length
      ? 'UNRESOLVED'
      : 'ELIGIBLE';
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const Ajv = Ajv2020 as unknown as new (options: object) => {
  compile(schema: unknown): (value: unknown) => boolean;
};
const validScenario = new Ajv({ strict: false, strictNumbers: true }).compile(scenarioSchema);
const closed = (obj: unknown, allowed: string[]): void => {
  if (
    !obj ||
    typeof obj !== 'object' ||
    Array.isArray(obj) ||
    Object.keys(obj).some((k) => !allowed.includes(k))
  )
    throw new Error('Unmodeled operating scenario member');
};
function validateScenario(s: InstalledOperatingScenario) {
  if (!validScenario(s)) throw new Error('Unsupported installed operating scenario schema');
  closed(s, ['version', 'uses']);
  if (
    s.version !== 'installed-operating-scenario.v1' ||
    !Array.isArray(s.uses) ||
    !s.uses.length ||
    new Set(s.uses.map((u) => u.instance_id)).size !== s.uses.length
  )
    throw new Error('Unsupported or ambiguous operating scenario');
  for (const u of s.uses) {
    closed(u, ['instance_id', 'battery', 'monitoring']);
    if (typeof u.instance_id !== 'string' || !u.instance_id.trim() || (!u.battery && !u.monitoring))
      throw new Error('Operating use needs an exact instance and requirement');
    if (u.battery) {
      const b = u.battery;
      closed(b, [
        'operation',
        'temperature',
        'heater_state',
        'series_count',
        'parallel_count',
        'matched_bank',
        'requires_bms_recovery',
      ]);
      if (
        !['charge', 'discharge'].includes(b.operation) ||
        (b.heater_state !== undefined &&
          !['after_heating', 'not_after_heating'].includes(b.heater_state)) ||
        [b.matched_bank, b.requires_bms_recovery].some(
          (v) => v !== undefined && typeof v !== 'boolean',
        )
      )
        throw new Error('Invalid battery operating assumptions');
      for (const n of [b.series_count, b.parallel_count])
        if (n !== undefined && (!Number.isSafeInteger(n) || n < 1))
          throw new Error('Bank counts must be positive safe integers');
      if (b.temperature) {
        closed(b.temperature, ['value_c', 'measurement_point', 'rationale']);
        if (
          !finite(b.temperature.value_c) ||
          !['battery_cell', 'ambient'].includes(b.temperature.measurement_point) ||
          typeof b.temperature.rationale !== 'string' ||
          !b.temperature.rationale.trim()
        )
          throw new Error('Explicit finite temperature, location and rationale required');
      }
    }
    if (u.monitoring) {
      const m = u.monitoring;
      closed(m, [
        'quantity',
        'max_error_percent',
        'basis',
        'measured_value',
        'temperature_c',
        'measurement_path',
        'current_path_a',
        'shunt_current_a',
        'shunt_drop_mv',
        'calibration_evidence_id',
      ]);
      if (
        !['dc_current', 'dc_voltage'].includes(m.quantity) ||
        !['reading', 'full_scale'].includes(m.basis) ||
        !finite(m.max_error_percent) ||
        m.max_error_percent < 0 ||
        [
          m.measured_value,
          m.temperature_c,
          m.current_path_a,
          m.shunt_current_a,
          m.shunt_drop_mv,
        ].some((v) => v !== undefined && !finite(v)) ||
        (m.measurement_path !== undefined && m.measurement_path !== 'external_shunt') ||
        (m.calibration_evidence_id !== undefined &&
          (typeof m.calibration_evidence_id !== 'string' || !m.calibration_evidence_id.trim()))
      )
        throw new Error('Invalid explicit monitoring requirement');
    }
  }
}
const supported = (p: EngineeringProfile, ids: string[], quantity: string) =>
  ids.length > 0 &&
  ids.every((id) => {
    const e = p.evidence.find((v) => v.id === id);
    return (
      e?.origin === 'synthetic' ||
      (e?.source_digest != null &&
        e?.human_interpretation?.version === 'engineering-profile-adjudication.v2' &&
        e.human_interpretation.fact_id === e.id &&
        e.human_interpretation.quantity === quantity)
    );
  });

/** A diagnostic gate over exact installed owners, additive to Phase 3 mandatory
 * conditions. Source ranges are inclusive, with no tolerances, inferred ambient
 * conversion, interpolation or BMS curve. Every supplied requirement is examined;
 * known NO precedes unrelated unknowns. Catalog admission/verification is separate. */
function bindOperatingVersion(
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
  raw: InstalledOperatingScenario,
  legacy = false,
) {
  validateScenario(raw);
  if (new Set(catalog.map((r) => r.id)).size !== catalog.length)
    throw new Error('Ambiguous operating catalog');
  const scenario = JSON.parse(JSON.stringify(raw)) as InstalledOperatingScenario;
  const checks: OperatingCheck[] = [];
  const examined: ComponentLibraryRecord[] = [];
  for (const u of scenario.uses) {
    const add = (
      code: string,
      status: EngineeringStatus,
      explanation: string,
      evidence_ids: string[] = [],
    ) =>
      checks.push({
        code,
        status,
        explanation,
        instance_id: u.instance_id,
        evidence_ids: [...evidence_ids].sort(),
      });
    const instances =
      input.architecture.installation.component_instances?.filter((i) => i.id === u.instance_id) ??
      [];
    if (instances.length > 1) throw new Error('Ambiguous installed operating owner');
    const r = catalog.find((r) => r.id === instances[0]?.component_id);
    if (!r) {
      add('operating_owner_unknown', 'UNRESOLVED', 'Exact installed product owner is missing');
      continue;
    }
    examined.push(r);
    const p = r.engineering_profile ? parseEngineeringProfile(r.engineering_profile) : undefined;
    if (
      p &&
      (p.component_id !== r.id ||
        p.model !== r.model ||
        (p.manufacturer_revision !== null &&
          r.manufacturer_revision != null &&
          p.manufacturer_revision !== r.manufacturer_revision))
    ) {
      add(
        'operating_owner_contradiction',
        'BLOCKED',
        'Profile belongs to another exact product/revision',
      );
      continue;
    }
    if (!hasCurrentCanonicalVerification(r))
      add(
        'operating_authority_unresolved',
        'UNRESOLVED',
        'Provisional source/profile data cannot grant verified product eligibility',
      );
    if (u.battery) {
      const b = u.battery;
      const range =
        b.operation === 'charge'
          ? p?.battery_operating?.charge_range
          : p?.battery_operating?.discharge_range;
      const q =
        b.operation === 'charge' ? 'battery_cell_charge_range_c' : 'battery_discharge_range_c';
      if (!p || !range || !supported(p, range.evidence_ids, q))
        add(
          'battery_temperature_source_unknown',
          'UNRESOLVED',
          'Required allowed temperature range has no supported meaning',
        );
      else {
        if (
          !b.temperature ||
          range.measurement_point === 'unknown' ||
          b.temperature.measurement_point !== range.measurement_point
        )
          add(
            'battery_temperature_location_unknown',
            'UNRESOLVED',
            'Ambient and battery/cell temperatures are not interchangeable',
            range.evidence_ids,
          );
        else if (
          legacy ||
          range.prerequisite === 'none' ||
          (range.prerequisite === 'after_heating' && b.heater_state === 'after_heating')
        )
          add(
            'battery_temperature_range',
            b.temperature.value_c < range.min_c || b.temperature.value_c > range.max_c
              ? 'BLOCKED'
              : 'ELIGIBLE',
            `Compare explicit ${range.measurement_point} temperature with inclusive ${range.min_c}..${range.max_c} degC source range`,
            range.evidence_ids,
          );
        if (
          range.prerequisite === 'unknown' ||
          (range.prerequisite === 'after_heating' && b.heater_state !== 'after_heating')
        )
          add(
            'battery_heating_context_unknown',
            'UNRESOLVED',
            'This source range does not establish the supplied heater/operating state',
            range.evidence_ids,
          );
      }
      for (const [kind, count, permission] of [
        ['series', b.series_count, p?.battery_operating?.series_permission],
        ['parallel', b.parallel_count, p?.battery_operating?.parallel_permission],
      ] as const) {
        if (count === undefined) continue;
        if (
          !p ||
          !permission ||
          !supported(p, permission.evidence_ids, `battery_${kind}_max_count`)
        )
          add(
            `battery_${kind}_permission_unknown`,
            'UNRESOLVED',
            'Unknown bank permission is not permission',
          );
        else {
          add(
            `battery_${kind}_count`,
            count > permission.max_count ? 'BLOCKED' : 'ELIGIBLE',
            `Explicit count ${count} versus source maximum ${permission.max_count}`,
            permission.evidence_ids,
          );
          if (permission.unmodeled_conditions?.length)
            add(
              `battery_${kind}_source_conditions_unmodeled`,
              'UNRESOLVED',
              'Source voltage/capacity and other permission qualifiers remain unmodeled; count comparison alone cannot grant bank permission',
              permission.evidence_ids,
            );
          if (
            permission.requires_matched_bank === null ||
            (permission.requires_matched_bank && b.matched_bank === undefined)
          )
            add(
              `battery_${kind}_matching_unknown`,
              'UNRESOLVED',
              'Required bank matching or source conditions remain unknown',
              permission.evidence_ids,
            );
          else if (permission.requires_matched_bank && b.matched_bank === false)
            add(
              `battery_${kind}_matching_contradiction`,
              'BLOCKED',
              'Declared unmatched bank contradicts source matching restriction',
              permission.evidence_ids,
            );
        }
      }
      if (b.series_count !== undefined || b.parallel_count !== undefined)
        add(
          'battery_bank_ownership_unmodeled',
          'UNRESOLVED',
          'A model permission/count comparison does not prove physical bank membership or matching of each installed battery',
        );
      if (b.requires_bms_recovery)
        add(
          'bms_recovery_unmodeled',
          'UNRESOLVED',
          'Allowed temperature ranges are not BMS threshold, hysteresis or recovery-state proof',
        );
      add(
        'battery_current_protection_thermal_unmodeled',
        'UNRESOLVED',
        'Current/duration, BMS transitions, physical installation/protection and thermal dynamics require separate consumers',
      );
    }
    if (u.monitoring) {
      const m = u.monitoring;
      const instrument = p?.instrumentation;
      const a = instrument?.accuracy?.find(
        (a) => a.quantity === (m.quantity === 'dc_current' ? 'current' : 'voltage'),
      );
      // A DC supply, battery label or shunt shape cannot prove measurement domain.
      const domainSupported =
        p &&
        a?.electrical_domain === 'dc' &&
        supported(p, a.domain_evidence_ids ?? [], 'instrument_measurement_domain');
      if (a && !domainSupported)
        add(
          'measurement_domain_unknown',
          'UNRESOLVED',
          'Required DC measurement domain has no independently supported source meaning',
          a.evidence_ids,
        );
      if (
        !p ||
        !a ||
        !supported(
          p,
          a.evidence_ids,
          m.quantity === 'dc_current'
            ? 'instrument_current_accuracy_percent'
            : 'instrument_voltage_accuracy_percent',
        )
      )
        add(
          'measurement_accuracy_source_unknown',
          'UNRESOLVED',
          'Resolution/current magnitude is not accuracy',
        );
      else if (a.basis === 'unknown' || a.basis !== m.basis)
        add(
          'measurement_accuracy_basis_unknown',
          'UNRESOLVED',
          'Percentage denominator is unknown or differs from the requested basis',
          a.evidence_ids,
        );
      else if (
        !legacy &&
        a.required_shunt_a !== undefined &&
        (m.measurement_path !== 'external_shunt' ||
          m.shunt_current_a !== a.required_shunt_a ||
          a.required_shunt_drop_mv === undefined ||
          m.shunt_drop_mv !== a.required_shunt_drop_mv)
      )
        add(
          'measurement_accuracy_shunt_applicability_unknown',
          'UNRESOLVED',
          'Source accuracy is conditional on a reference shunt; missing or different installed transfer cannot borrow it',
          a.evidence_ids,
        );
      else if (
        !legacy &&
        (!a.range ||
          m.measured_value === undefined ||
          !a.temperature_c ||
          m.temperature_c === undefined ||
          m.measured_value < a.range.min ||
          m.measured_value > a.range.max ||
          m.temperature_c < a.temperature_c.min ||
          m.temperature_c > a.temperature_c.max)
      )
        add(
          'measurement_accuracy_conditions_applicability_unknown',
          'UNRESOLVED',
          'Accuracy range/temperature applicability must be proved before either sign of the percentage comparison',
          a.evidence_ids,
        );
      else if (domainSupported)
        add(
          'measurement_accuracy_bound',
          a.percent > m.max_error_percent ? 'BLOCKED' : 'ELIGIBLE',
          'Compare source and requirement percentages on the same explicit denominator',
          a.evidence_ids,
        );
      if (
        !a?.range ||
        m.measured_value === undefined ||
        !a.temperature_c ||
        m.temperature_c === undefined ||
        !m.calibration_evidence_id
      )
        add(
          'measurement_conditions_unknown',
          'UNRESOLVED',
          'Measurement range, applicable temperature and calibration proof are required',
        );
      else if (
        m.measured_value < a.range.min ||
        m.measured_value > a.range.max ||
        m.temperature_c < a.temperature_c.min ||
        m.temperature_c > a.temperature_c.max
      )
        add(
          'measurement_conditions_outside_source',
          'UNRESOLVED',
          'No accuracy extrapolation outside the documented range/temperature',
          a.evidence_ids,
        );
      add(
        'measurement_calibration_unmodeled',
        'UNRESOLVED',
        'A supplied calibration reference is not a modeled, content-bound calibration proof',
      );
      if (m.quantity === 'dc_current') {
        const shunt = instrument?.shunt;
        if (
          !p ||
          !shunt ||
          !supported(p, shunt.evidence_ids, 'instrument_shunt_rating') ||
          m.measurement_path !== 'external_shunt'
        )
          add(
            'measurement_shunt_path_unknown',
            'UNRESOLVED',
            'Explicit shunt measurement path/rating is separate from monitor supply or battery discharge',
          );
        else {
          const limit = shunt.max_measurement_current_a;
          const shuntDomain =
            shunt.electrical_domain === 'dc' &&
            supported(p, shunt.domain_evidence_ids ?? [], 'instrument_measurement_domain');
          // Applicability precedes either sign of the limit comparison. A source
          // accessory maximum cannot constrain a different installed transfer.
          if (
            !legacy &&
            (m.shunt_current_a !== shunt.nominal_current_a ||
              m.shunt_drop_mv !== shunt.nominal_drop_mv)
          )
            add(
              'measurement_shunt_limit_applicability_unknown',
              'UNRESOLVED',
              'Installed shunt transfer is missing or differs from the source-rated shunt',
              shunt.evidence_ids,
            );
          else if (
            !shuntDomain ||
            !limit ||
            !supported(p, limit.evidence_ids, 'instrument_shunt_measurement_max_a')
          )
            add(
              'measurement_shunt_limit_unknown',
              'UNRESOLVED',
              'Nominal A/mV transfer does not establish maximum measurable current or its electrical domain',
              shunt.evidence_ids,
            );
          else if (m.current_path_a === undefined)
            add(
              'measurement_path_current_unknown',
              'UNRESOLVED',
              'Required path current is unknown',
              shunt.evidence_ids,
            );
          else
            add(
              'measurement_shunt_explicit_limit',
              Math.abs(m.current_path_a) > limit.value ? 'BLOCKED' : 'ELIGIBLE',
              'Independently source-supported measurement-current limit; no electrical protection/throughput capacity is inferred',
              limit.evidence_ids,
            );
          if (m.shunt_current_a === undefined || m.shunt_drop_mv === undefined)
            add(
              'measurement_shunt_identity_unknown',
              'UNRESOLVED',
              'Installed shunt transfer is missing',
              shunt.evidence_ids,
            );
          else if (
            m.shunt_current_a !== shunt.nominal_current_a ||
            m.shunt_drop_mv !== shunt.nominal_drop_mv ||
            (a?.required_shunt_a !== undefined && m.shunt_current_a !== a.required_shunt_a)
          )
            add(
              'measurement_shunt_basis_differs',
              'UNRESOLVED',
              'Different nominal transfer/accuracy basis requires separately supported calibration; included is not a mandatory accessory permission',
              shunt.evidence_ids,
            );
        }
      }
    }
  }
  // Copies and content-bound reconstruction protect callers from mutable preview
  // objects. This gate can only add a failure/unknown; it never clears Phase 5.
  const content = {
    version: legacy
      ? ('installed-operating-binding.v1' as const)
      : ('installed-operating-binding.v2' as const),
    assertion_scope: 'bounded-temperature-bank-permission-and-measurement' as const,
    scenario,
    catalog: JSON.parse(JSON.stringify(examined)) as ComponentLibraryRecord[],
    checks,
    status: aggregate(checks),
  };
  const digest = passportDigest(content);
  const copy = JSON.parse(JSON.stringify(input)) as WholeSystemEvaluationInput;
  const status = content.status === 'BLOCKED' ? ('blocked' as const) : ('unresolved' as const);
  const bindingInput: WholeSystemEvaluationInput = {
    ...copy,
    requirements: {
      ...copy.requirements,
      mandatory_conditions: [
        ...(copy.requirements.mandatory_conditions ?? []),
        {
          id: 'installed_operating',
          subject_id: 'selected_operating_requirements',
          status,
          artifact_digest: digest,
          reason_codes: checks
            .filter((c) => c.status !== 'ELIGIBLE')
            .map((c) => `${c.instance_id}:${c.code}`)
            .sort(),
        },
      ],
    },
  };
  return { ...content, digest, input: bindingInput };
}
export function bindInstalledOperating(
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
  scenario: InstalledOperatingScenario,
) {
  return bindOperatingVersion(input, catalog, scenario);
}
function evaluateOperatingVersion(
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
  scenario: InstalledOperatingScenario,
  legacy = false,
) {
  const binding = bindOperatingVersion(input, catalog, scenario, legacy);
  const content = {
    version: legacy
      ? ('installed-operating-evaluation.v1' as const)
      : ('installed-operating-evaluation.v2' as const),
    original_input: JSON.parse(JSON.stringify(input)) as WholeSystemEvaluationInput,
    catalog: JSON.parse(JSON.stringify(catalog)) as ComponentLibraryRecord[],
    binding,
    passport: evaluateInstalledSystem(binding.input, catalog),
  };
  return { ...content, digest: passportDigest(content) };
}
export function evaluateInstalledOperating(
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
  scenario: InstalledOperatingScenario,
) {
  return evaluateOperatingVersion(input, catalog, scenario);
}
export function replayInstalledOperating(raw: unknown) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid operating replay');
  const r = raw as ReturnType<typeof evaluateInstalledOperating>;
  if (
    !['installed-operating-evaluation.v1', 'installed-operating-evaluation.v2'].includes(r.version)
  )
    throw new Error('Unsupported operating replay version');
  // Historical diagnostics replay their original rule. Only fresh evaluation
  // uses v2 applicability; replay never silently upgrades an archived decision.
  const reconstructed = evaluateOperatingVersion(
    r.original_input,
    r.catalog,
    r.binding.scenario,
    r.version === 'installed-operating-evaluation.v1',
  );
  if (serializePassportValue(reconstructed) !== serializePassportValue(raw))
    throw new Error('Operating evaluation differs from exact replay');
  return reconstructed;
}
