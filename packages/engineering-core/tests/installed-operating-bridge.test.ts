import { describe, expect, it } from 'vitest';
import {
  evaluateInstalledOperating,
  replayInstalledOperating,
  type InstalledOperatingScenario,
} from '../src/installed-operating-bridge.js';
import type { EngineeringProfile } from '../src/engineering-profile.js';
import { parseEngineeringProfile } from '../src/engineering-profile.js';
import { completeInstalledSystemFixture } from './fixtures/whole-system.js';
import { passportDigest } from '../src/portable-json.js';
import { generateArchitectures } from '../src/architecture-generation.js';
import { evaluateProductSelection, bindProductSelection } from '../src/product-selection.js';

// Entirely invented project-owned source/installation values; no manufacturer
// success, human approval or actual installed eligibility is represented here.
function fixture() {
  const f = completeInstalledSystemFixture();
  const battery = f.catalog.find((r) => r.id === 'fixture.battery')!;
  const p: EngineeringProfile = {
    schema_version: 'engineering-profile.v1',
    component_id: battery.id,
    model: battery.model!,
    manufacturer_revision: null,
    evidence: [
      {
        id: 'synthetic.operating',
        source_url: 'https://example.test/invented',
        publisher: 'Test author',
        model: battery.model!,
        manufacturer_revision: null,
        retrieved_at: '2026-10-13T00:00:00Z',
        locator: 'synthetic-only',
        source_digest: null,
        statement: 'Invented battery, bank and instrument limits',
        conditions: [],
        origin: 'synthetic',
        rights: 'project_authored',
      },
    ],
    battery_operating: {
      version: 'battery-operating.v1',
      charge_range: {
        min_c: 5,
        max_c: 40,
        unit: 'degC',
        measurement_point: 'battery_cell',
        prerequisite: 'after_heating',
        evidence_ids: ['synthetic.operating'],
      },
      series_permission: {
        max_count: 2,
        requires_matched_bank: true,
        evidence_ids: ['synthetic.operating'],
      },
    },
    instrumentation: {
      version: 'instrumentation.v1',
      accuracy: [
        {
          quantity: 'current',
          electrical_domain: 'dc',
          domain_evidence_ids: ['synthetic.operating'],
          percent: 0.5,
          basis: 'unknown',
          evidence_ids: ['synthetic.operating'],
        },
      ],
      shunt: {
        nominal_current_a: 250,
        nominal_drop_mv: 75,
        electrical_domain: 'dc',
        domain_evidence_ids: ['synthetic.operating'],
        max_measurement_current_a: { value: 250, unit: 'A', evidence_ids: ['synthetic.operating'] },
        evidence_ids: ['synthetic.operating'],
      },
    },
  };
  battery.engineering_profile = p;
  battery.verification_status = 'unverified';
  const instance = f.input.architecture.installation.component_instances!.find(
    (i) => i.component_id === battery.id,
  )!.id;
  const scenario: InstalledOperatingScenario = {
    version: 'installed-operating-scenario.v1',
    uses: [
      {
        instance_id: instance,
        battery: {
          operation: 'charge',
          temperature: {
            value_c: 5,
            measurement_point: 'battery_cell',
            rationale: 'Synthetic measured cell input',
          },
          heater_state: 'after_heating',
          series_count: 2,
          matched_bank: true,
          requires_bms_recovery: true,
        },
      },
    ],
  };
  return { ...f, p, instance, scenario };
}
describe('bounded installed operating requirements', () => {
  it.each([
    [4, undefined, 'after_heating', undefined],
    [4, 'not_after_heating', 'after_heating', undefined],
    [5, undefined, 'after_heating', undefined],
    [4, 'after_heating', 'after_heating', 'BLOCKED'],
    [5, 'after_heating', 'after_heating', 'ELIGIBLE'],
    [40, 'after_heating', 'after_heating', 'ELIGIBLE'],
    [4, 'after_heating', 'unknown', undefined],
    [4, undefined, 'none', 'BLOCKED'],
    [5, undefined, 'none', 'ELIGIBLE'],
  ] as const)(
    'qualifies cell %s / heater %s / source %s before comparison',
    (value, heater, prerequisite, expected) => {
      const f = fixture();
      f.p.battery_operating!.charge_range!.prerequisite = prerequisite;
      f.scenario.uses[0].battery!.temperature!.value_c = value;
      f.scenario.uses[0].battery!.heater_state = heater;
      const r = evaluateInstalledOperating(f.input, f.catalog, f.scenario);
      expect(r.binding.version).toBe('installed-operating-binding.v2');
      expect(r.binding.checks.find((c) => c.code === 'battery_temperature_range')?.status).toBe(
        expected,
      );
      expect(r.binding.status).toBe(expected === 'BLOCKED' ? 'BLOCKED' : 'UNRESOLVED');
      expect(replayInstalledOperating(JSON.parse(JSON.stringify(r)))).toEqual(r);
      f.scenario.uses[0].battery!.series_count = 3;
      expect(evaluateInstalledOperating(f.input, f.catalog, f.scenario).binding.status).toBe(
        'BLOCKED',
      );
    },
  );
  it.each([
    [500, 50, 300, 'UNRESOLVED'],
    [undefined, undefined, 300, 'UNRESOLVED'],
    [250, 75, 300, 'BLOCKED'],
    [250, 75, 250, 'UNRESOLVED'],
  ] as const)(
    'qualifies installed %s A / %s mV before %s A limit',
    (amps, mv, requested, expected) => {
      const f = fixture();
      const a = f.p.instrumentation!.accuracy![0];
      a.basis = 'reading';
      a.required_shunt_a = 250;
      a.required_shunt_drop_mv = 75;
      a.range = { min: -250, max: 250 };
      a.temperature_c = { min: 20, max: 30 };
      f.scenario.uses[0] = {
        instance_id: f.instance,
        monitoring: {
          quantity: 'dc_current',
          basis: 'reading',
          max_error_percent: 0.1,
          measured_value: 10,
          temperature_c: 25,
          measurement_path: 'external_shunt',
          current_path_a: requested,
          shunt_current_a: amps,
          shunt_drop_mv: mv,
        },
      };
      const r = evaluateInstalledOperating(f.input, f.catalog, f.scenario);
      if (amps !== 250) {
        expect(r.binding.status).toBe(expected);
        expect(r.binding.checks.some((c) => c.code === 'measurement_accuracy_bound')).toBe(false);
        expect(r.binding.checks.some((c) => c.code === 'measurement_shunt_explicit_limit')).toBe(
          false,
        );
      } else expect(r.binding.status).toBe('BLOCKED'); // independently applicable accuracy NO
      a.percent = 0.05;
      expect(evaluateInstalledOperating(f.input, f.catalog, f.scenario).binding.status).toBe(
        expected,
      );
      expect(replayInstalledOperating(r)).toEqual(r);
    },
  );
  it('withholds measurement limits/domain from a nominal A/mV point and alternative calibration', () => {
    const f = fixture();
    delete f.p.instrumentation!.shunt!.max_measurement_current_a;
    f.p.instrumentation!.shunt!.electrical_domain = 'unknown';
    f.p.instrumentation!.accuracy![0].electrical_domain = 'unknown';
    f.scenario.uses[0] = {
      instance_id: f.instance,
      monitoring: {
        quantity: 'dc_current',
        max_error_percent: 1,
        basis: 'reading',
        measurement_path: 'external_shunt',
        current_path_a: 600,
        shunt_current_a: 500,
        shunt_drop_mv: 50,
      },
    };
    const r = evaluateInstalledOperating(f.input, f.catalog, f.scenario);
    expect(r.binding.status).toBe('UNRESOLVED');
    expect(r.binding.checks.find((c) => c.code === 'measurement_domain_unknown')?.status).toBe(
      'UNRESOLVED',
    );
    expect(
      r.binding.checks.find((c) => c.code === 'measurement_shunt_limit_applicability_unknown')
        ?.status,
    ).toBe('UNRESOLVED');
    expect(r.binding.checks.find((c) => c.code === 'measurement_shunt_basis_differs')?.status).toBe(
      'UNRESOLVED',
    );
    expect(r.binding.checks.some((c) => c.status === 'BLOCKED')).toBe(false);
  });
  it('preserves Phase 5 witness holds and propagates a selected measurement contradiction to Phase 3', () => {
    const f = fixture();
    const converter = f.catalog.find((r) => r.id === 'fixture.reduce')!;
    converter.engineering_profile = {
      ...f.p,
      component_id: converter.id,
      model: converter.model!,
      evidence: f.p.evidence.map((e) => ({ ...e, model: converter.model! })),
    };
    converter.verification_status = 'unverified';
    const generation = generateArchitectures({
      schema_version: '2.0.0',
      assumptions: [],
      requirements: {
        id: 'synthetic.operating.selection',
        fixed_house_voltage_v: 24,
        loads: [
          { id: 'load12', domain: { kind: 'dc', nominal_voltage_v: 12 }, required_power_w: 50 },
        ],
        charging_sources: [],
        storage: { required: false },
      },
    });
    const selection = evaluateProductSelection({
      schema_version: '1.0.0',
      generation,
      candidate_id: generation.candidates[0].id,
      corpus: [converter],
      fixed_existing: [],
      assemblies: [],
    });
    const role = selection.roles[0];
    const binding = role.candidates[0].bindings.find(
      (b) =>
        Object.values(b.witness.interfaces).includes('input') &&
        Object.values(b.witness.interfaces).every((v) => v !== null) &&
        Object.values(b.witness.paths).every((v) => v !== null),
    );
    expect(binding, JSON.stringify(role.candidates[0].bindings)).toBeDefined();
    const bound = bindProductSelection(
      selection,
      [{ role_id: role.role.id, component_id: converter.id, binding_id: binding!.id }],
      {
        installed_operating: {
          version: 'installed-operating-scenario.v1',
          uses: [
            {
              instance_id: role.role.id,
              monitoring: {
                quantity: 'dc_current',
                max_error_percent: 1,
                basis: 'reading',
                measurement_path: 'external_shunt',
                current_path_a: 300,
                shunt_current_a: 250,
                shunt_drop_mv: 75,
              },
            },
          ],
        },
      },
    );
    expect(bound.operating_binding?.status).toBe('BLOCKED');
    expect(bound.input.requirements.mandatory_conditions?.some((c) => c.id === role.role.id)).toBe(
      true,
    );
    expect(
      bound.input.requirements.mandatory_conditions?.find((c) => c.id === 'installed_operating')
        ?.status,
    ).toBe('blocked');
  });
  it('retains an inclusive supported range but cannot turn unknown BMS/authority into eligibility', () => {
    const f = fixture();
    const r = evaluateInstalledOperating(f.input, f.catalog, f.scenario);
    expect(r.binding.checks.find((c) => c.code === 'battery_temperature_range')?.status).toBe(
      'ELIGIBLE',
    );
    expect(r.binding.status).toBe('UNRESOLVED');
    expect(r.passport.decisions.find((d) => d.id === 'inherited:installed_operating')?.status).toBe(
      'unresolved',
    );
    expect(replayInstalledOperating(JSON.parse(JSON.stringify(r)))).toEqual(r);
    f.scenario.uses[0].battery!.temperature!.value_c = 99;
    expect(r.binding.scenario.uses[0].battery!.temperature!.value_c).toBe(5);
  });
  it.each(['cold', 'series', 'unmatched'])(
    'known %s contradiction precedes unknown recovery and authority',
    (kind) => {
      const f = fixture();
      const b = f.scenario.uses[0].battery!;
      if (kind === 'cold') b.temperature!.value_c = 4.999;
      if (kind === 'series') b.series_count = 3;
      if (kind === 'unmatched') b.matched_bank = false;
      const r = evaluateInstalledOperating(f.input, f.catalog, f.scenario);
      expect(r.binding.status).toBe('BLOCKED');
      expect(
        r.passport.decisions.find((d) => d.id === 'inherited:installed_operating')?.status,
      ).toBe('blocked');
    },
  );
  it('does not compare an ambient input to a cell range or grant missing parallel permission', () => {
    const f = fixture();
    f.scenario.uses[0].battery!.temperature!.measurement_point = 'ambient';
    f.scenario.uses[0].battery!.parallel_count = 2;
    const r = evaluateInstalledOperating(f.input, f.catalog, f.scenario);
    expect(
      r.binding.checks.find((c) => c.code === 'battery_temperature_location_unknown')?.status,
    ).toBe('UNRESOLVED');
    expect(
      r.binding.checks.find((c) => c.code === 'battery_parallel_permission_unknown')?.status,
    ).toBe('UNRESOLVED');
  });
  it('keeps accuracy denominator and range unknown; shunt limits apply only to the requested current path', () => {
    const f = fixture();
    f.scenario.uses[0] = {
      instance_id: f.instance,
      monitoring: {
        quantity: 'dc_current',
        max_error_percent: 0.1,
        basis: 'reading',
        measurement_path: 'external_shunt',
        current_path_a: 251,
        shunt_current_a: 250,
        shunt_drop_mv: 75,
      },
    };
    const r = evaluateInstalledOperating(f.input, f.catalog, f.scenario);
    expect(
      r.binding.checks.find((c) => c.code === 'measurement_accuracy_basis_unknown')?.status,
    ).toBe('UNRESOLVED');
    expect(
      r.binding.checks.find((c) => c.code === 'measurement_shunt_explicit_limit')?.status,
    ).toBe('BLOCKED');
    expect(
      f.catalog.find((r) => r.id === 'fixture.battery')!.electrical?.discharge_current_a,
    ).toBeUndefined();
    f.scenario.uses[0].monitoring!.quantity = 'dc_voltage';
    const voltage = evaluateInstalledOperating(f.input, f.catalog, f.scenario);
    expect(voltage.binding.checks.some((c) => c.code === 'measurement_shunt_explicit_limit')).toBe(
      false,
    );
  });
  it('rejects rehashed result tampering, unknown versions, reversed ranges and malformed assumptions', () => {
    const f = fixture();
    const r = evaluateInstalledOperating(f.input, f.catalog, f.scenario);
    r.binding.status = 'ELIGIBLE';
    const { digest: _digest, ...body } = r;
    r.digest = passportDigest(body);
    expect(() => replayInstalledOperating(r)).toThrow('replay');
    expect(() =>
      evaluateInstalledOperating(f.input, f.catalog, {
        ...f.scenario,
        version: 'future',
      } as unknown as InstalledOperatingScenario),
    ).toThrow();
    f.p.battery_operating!.charge_range!.min_c = 90;
    expect(() => parseEngineeringProfile(f.p)).toThrow('Reversed');
    f.p.battery_operating!.charge_range!.min_c = 5;
    f.scenario.uses[0].battery!.series_count = 0;
    expect(() => evaluateInstalledOperating(f.input, f.catalog, f.scenario)).toThrow();
  });
});
