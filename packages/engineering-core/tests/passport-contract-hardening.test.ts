import { describe, expect, it } from 'vitest';
import {
  evaluateInstalledSystem,
  installedSystemRuleData,
  parseEngineeringPassport,
  passportDigest,
  replayEngineeringPassport,
  serializeEngineeringPassport,
  serializePassportValue,
} from '../src/engineering-passport.js';
import { evaluateEngineeringRules } from '../src/evaluator.js';
import { completeInstalledSystemFixture } from './fixtures/whole-system.js';
import { passiveDeviceFixture } from './fixtures/single-device-system.js';

// A recomputed envelope hash alone must not authorize stronger semantics.
const reseal = (value: unknown): string => {
  const { passport_digest: _oldDigest, ...body } = JSON.parse(
    serializePassportValue(value),
  ) as Record<string, unknown>;
  return serializePassportValue({ ...body, passport_digest: passportDigest(body) });
};

describe('reviewed portable contract hardening', () => {
  it('zero resolved subtotal plus unknown state power cannot assert zero total', () => {
    const { input, record } = passiveDeviceFixture();
    const passport = evaluateInstalledSystem(input, [{ ...record, qualified_values: [] }]);
    expect(passport.result.energy).toEqual({
      basis: 'device-side',
      status: 'unresolved',
      completeness: 'incomplete',
      resolved_subtotal_energy_wh: 0,
      unresolved_contributions: [
        {
          kind: 'state',
          instance_id: 'device',
          state_id: 'baseline',
          reasons: ['power_unknown'],
        },
      ],
    });
    expect(passport.result.energy).not.toHaveProperty('total_energy_wh');
    expect(passport.result.energy).not.toHaveProperty('known_energy_wh');
  });

  it('unscheduled installed instances are represented inside energy alone', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const passport = evaluateInstalledSystem(
      {
        ...input,
        requirements: {
          ...input.requirements,
          load_states: input.requirements.load_states.filter(
            (state) => state.id !== 'boost.baseline',
          ),
        },
      },
      catalog,
    );
    expect(passport.result.energy.completeness).toBe('incomplete');
    expect(passport.result.energy.unresolved_contributions).toContainEqual({
      kind: 'schedule',
      instance_id: 'boost',
      reasons: ['schedule_missing', 'horizon_mismatch'],
    });
    expect(passport.result.energy.total_energy_wh).toBeUndefined();
  });

  it.each(['horizon_unknown', 'duration_unknown', 'horizon_mismatch'] as const)(
    'energy directly identifies incomplete coverage caused by %s',
    (reason) => {
      const { input, record } = passiveDeviceFixture();
      const { evaluation_hours: _hours, ...requirements } = input.requirements;
      const { duration_hours: _duration, ...state } = requirements.load_states[0]!;
      const editedRequirements =
        reason === 'horizon_unknown'
          ? requirements
          : {
              ...input.requirements,
              load_states: [
                reason === 'duration_unknown' ? state : { ...state, duration_hours: 0.5 },
              ],
            };
      const energy = evaluateInstalledSystem({ ...input, requirements: editedRequirements }, [
        record,
      ]).result.energy;
      expect(energy.completeness).toBe('incomplete');
      expect(energy.total_energy_wh).toBeUndefined();
      expect(energy.unresolved_contributions).toContainEqual(
        expect.objectContaining({
          kind: 'schedule',
          instance_id: 'device',
          reasons: expect.arrayContaining([reason]),
        }),
      );
      if (reason === 'duration_unknown')
        expect(energy.unresolved_contributions).toContainEqual({
          kind: 'state',
          instance_id: 'device',
          state_id: 'baseline',
          reasons: ['duration_unknown'],
        });
    },
  );

  it('empty schedules expose evaluation and instance omissions with no total', () => {
    const { input, record } = passiveDeviceFixture();
    const energy = evaluateInstalledSystem(
      { ...input, requirements: { ...input.requirements, load_states: [] } },
      [record],
    ).result.energy;
    expect(energy.completeness).toBe('incomplete');
    expect(energy.unresolved_contributions).toContainEqual({
      kind: 'evaluation',
      reason: 'no_states',
    });
    expect(energy.unresolved_contributions).toContainEqual(
      expect.objectContaining({ kind: 'schedule', instance_id: 'device' }),
    );
    expect(energy.total_energy_wh).toBeUndefined();
  });

  it('complete reviewed zero consumption emits an explicit zero total', () => {
    const { input, record } = passiveDeviceFixture();
    expect(evaluateInstalledSystem(input, [record]).result.energy).toEqual({
      basis: 'device-side',
      status: 'satisfied',
      completeness: 'complete',
      resolved_subtotal_energy_wh: 0,
      total_energy_wh: 0,
      unresolved_contributions: [],
    });
  });

  it('complete mixed-domain accounting emits a total and round trips exactly', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const passport = evaluateInstalledSystem(input, catalog);
    expect(passport.result.energy).toMatchObject({
      completeness: 'complete',
      resolved_subtotal_energy_wh: 750,
      total_energy_wh: 750,
      unresolved_contributions: [],
    });
    expect(parseEngineeringPassport(serializeEngineeringPassport(passport))).toEqual(passport);
    expect(replayEngineeringPassport(passport, catalog)).toEqual({ ok: true, passport });
  });

  it.each(['unverified', 'partially_verified'] as const)(
    '%s canonical observations and their trace links explicitly withhold engineering use',
    (verification_status) => {
      const { input, record } = passiveDeviceFixture();
      const passport = evaluateInstalledSystem(input, [{ ...record, verification_status }]);
      expect(passport.examined_evidence.length).toBeGreaterThan(0);
      expect(
        passport.examined_evidence.every(
          (entry) =>
            entry.verification_status === verification_status &&
            entry.engineering_use.state === 'withheld',
        ),
      ).toBe(true);
      const state = passport.decisions.find((entry) => entry.id === 'load-state:baseline')!;
      expect(state.status).toBe('unresolved');
      expect(state.evidence_refs).toEqual([
        {
          evidence_id: `evidence:${record.id}:qualified_values.baseline`,
          engineering_use: 'withheld',
        },
      ]);
      expect(parseEngineeringPassport(serializeEngineeringPassport(passport))).toEqual(passport);
    },
  );

  it('verified observations supplied to a calculation are explicitly accepted inputs', () => {
    const { input, record } = passiveDeviceFixture();
    const passport = evaluateInstalledSystem(input, [record]);
    const id = `evidence:${record.id}:qualified_values.baseline`;
    expect(passport.examined_evidence.find((entry) => entry.id === id)?.engineering_use).toEqual({
      state: 'accepted_input',
    });
    expect(
      passport.calculations.find((entry) => entry.id === 'energy:state:baseline')?.evidence_refs,
    ).toEqual([{ evidence_id: id, engineering_use: 'accepted_input' }]);
    expect(passport.decisions.find((entry) => entry.id === 'load-state:baseline')?.status).toBe(
      'satisfied',
    );
  });

  it('accepted input does not itself assert applicable operating context', () => {
    const { input, record } = passiveDeviceFixture();
    const passport = evaluateInstalledSystem(
      {
        ...input,
        requirements: {
          ...input.requirements,
          load_states: input.requirements.load_states.map((state) => ({
            ...state,
            state: 'idle' as const,
          })),
        },
      },
      [record],
    );
    expect(
      passport.examined_evidence.find((entry) => entry.path === 'qualified_values.baseline')
        ?.engineering_use.state,
    ).toBe('accepted_input');
    expect(passport.decisions.find((entry) => entry.id === 'load-state:baseline')?.status).toBe(
      'unresolved',
    );
    expect(passport.result.energy.total_energy_wh).toBeUndefined();
  });

  it('recomputed hashes cannot relabel withheld evidence and matching references as accepted', () => {
    const { input, record } = passiveDeviceFixture();
    const catalog = [{ ...record, verification_status: 'unverified' as const }];
    const passport = evaluateInstalledSystem(input, catalog);
    const forged = {
      ...passport,
      examined_evidence: passport.examined_evidence.map((entry) => ({
        ...entry,
        verification_status: 'verified' as const,
        engineering_use: { state: 'accepted_input' as const },
      })),
      decisions: passport.decisions.map((entry) => ({
        ...entry,
        evidence_refs: entry.evidence_refs.map((ref) => ({
          ...ref,
          engineering_use: 'accepted_input' as const,
        })),
      })),
    };
    expect(() => parseEngineeringPassport(reseal(forged))).toThrow(/does not reproduce/);
    expect(replayEngineeringPassport(JSON.parse(reseal(forged)), catalog)).toMatchObject({
      ok: false,
      code: 'invalid_passport',
    });
  });

  it('recomputed hashes cannot turn an incomplete zero subtotal into a complete zero total', () => {
    const { input, record } = passiveDeviceFixture();
    const passport = evaluateInstalledSystem(input, [{ ...record, qualified_values: [] }]);
    expect(() =>
      parseEngineeringPassport(
        reseal({
          ...passport,
          result: {
            ...passport.result,
            energy: {
              basis: 'device-side',
              status: 'satisfied',
              completeness: 'complete',
              resolved_subtotal_energy_wh: 0,
              total_energy_wh: 0,
              unresolved_contributions: [],
            },
          },
        }),
      ),
    ).toThrow(/does not reproduce/);
  });

  it('previous artifact schema is explicitly unsupported instead of silently migrated', () => {
    const { input, record } = passiveDeviceFixture();
    expect(() =>
      parseEngineeringPassport(
        reseal({ ...evaluateInstalledSystem(input, [record]), schema_version: '1.0.0' }),
      ),
    ).toThrow(/schema rejected/);
  });

  it.each(['wire', 'conductive'] as const)(
    'same-nominal PV/DC %s continuity remains unresolved rather than incompatible',
    (kind) => {
      const { input, record } = passiveDeviceFixture();
      const edges =
        kind === 'wire'
          ? [{ id: 'direct', kind: 'wire' as const, from: 'source', to: 'destination' }]
          : input.architecture.power_topology.edges;
      const passport = evaluateInstalledSystem(
        {
          ...input,
          architecture: {
            ...input.architecture,
            power_topology: {
              ...input.architecture.power_topology,
              domains: input.architecture.power_topology.domains.map((domain) =>
                domain.id === 'source' ? { ...domain, kind: 'pv_dc' as const } : domain,
              ),
              edges,
            },
          },
          requirements: {
            ...input.requirements,
            supplies: [
              {
                id: 'supply',
                from: 'source',
                to: 'destination',
                edge_ids: kind === 'wire' ? ['direct'] : ['in-wire', 'contact', 'out-wire'],
              },
            ],
          },
        },
        [record],
      );
      expect(
        passport.decisions.find(
          (entry) => entry.id === `edge:${kind === 'wire' ? 'direct' : 'contact'}`,
        )?.status,
      ).toBe('unresolved');
      expect(passport.decisions.find((entry) => entry.id === 'supply:supply')?.status).toBe(
        'unresolved',
      );
      expect(passport.result.status).toBe('unresolved');
    },
  );

  it.each([undefined, 24] as const)(
    'PV/DC nominal continuity with destination voltage %s preserves unknown or mismatch',
    (voltage) => {
      const { input, record } = passiveDeviceFixture();
      const passport = evaluateInstalledSystem(
        {
          ...input,
          architecture: {
            ...input.architecture,
            power_topology: {
              ...input.architecture.power_topology,
              domains: [
                { id: 'source', kind: 'pv_dc', nominal_voltage_v: 12 },
                {
                  id: 'destination',
                  kind: 'dc',
                  ...(voltage === undefined ? {} : { nominal_voltage_v: voltage }),
                },
              ],
            },
          },
        },
        [record],
      );
      expect(passport.decisions.find((entry) => entry.id === 'edge:contact')?.status).toBe(
        voltage === undefined ? 'unresolved' : 'blocked',
      );
    },
  );

  it('a reviewed explicit solar conversion establishes the modeled PV/DC boundary generically', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const solarInput = {
      ...input,
      architecture: {
        ...input.architecture,
        power_topology: {
          ...input.architecture.power_topology,
          domains: input.architecture.power_topology.domains.map((domain) =>
            domain.id === 'vehicle' ? { ...domain, kind: 'pv_dc' as const } : domain,
          ),
        },
      },
    };
    const solarCatalog = catalog.map((record) =>
      record.id === 'fixture.boost'
        ? {
            ...record,
            manufacturer: 'Another project-authored fixture',
            product_role: 'solar_charge_controller' as const,
            capabilities: [{ id: 'conversion', type: 'solar_energy_conversion' as const }],
          }
        : record,
    );
    const passport = evaluateInstalledSystem(solarInput, solarCatalog);
    expect(passport.decisions.find((entry) => entry.id === 'supply:vehicle-house')?.status).toBe(
      'satisfied',
    );
    expect(passport.result.status).toBe('satisfied');
    expect(
      evaluateInstalledSystem(solarInput, catalog).decisions.find(
        (entry) => entry.id === 'supply:vehicle-house',
      )?.status,
    ).toBe('unresolved');
    const missing = solarCatalog.map((record) =>
      record.id === 'fixture.boost'
        ? {
            ...record,
            ports: record.ports?.map((port) =>
              port.id === 'input' ? { ...port, voltage_v: null } : port,
            ),
          }
        : record,
    );
    expect(
      evaluateInstalledSystem(solarInput, missing).decisions.find(
        (entry) => entry.id === 'supply:vehicle-house',
      )?.status,
    ).toBe('unresolved');
    const mismatch = solarCatalog.map((record) =>
      record.id === 'fixture.boost'
        ? {
            ...record,
            ports: record.ports?.map((port) =>
              port.id === 'input' ? { ...port, voltage_v: 48 } : port,
            ),
          }
        : record,
    );
    expect(
      evaluateInstalledSystem(solarInput, mismatch).decisions.find(
        (entry) => entry.id === 'supply:vehicle-house',
      )?.status,
    ).toBe('blocked');
  });

  it('draft rule execution remains a scoped proof with visible lifecycle and no promotion', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const passport = evaluateInstalledSystem(input, catalog);
    expect(installedSystemRuleData.status).toBe('draft');
    expect(passport.result).toMatchObject({
      status: 'satisfied',
      rule_lifecycle_status: 'draft',
      installation_safety: 'not_evaluated',
    });
    expect(passport.result.warnings.some((entry) => entry.code === 'rule_review_required')).toBe(
      true,
    );
    expect(passport.rule_data.status).toBe('draft');
    expect(() =>
      parseEngineeringPassport(
        reseal({ ...passport, result: { ...passport.result, rule_lifecycle_status: 'approved' } }),
      ),
    ).toThrow(/does not reproduce/);
    const changedRule = { ...passport.rule_data, status: 'approved' };
    expect(() =>
      parseEngineeringPassport(
        reseal({
          ...passport,
          rule_data: changedRule,
          rule_data_digest: passportDigest(changedRule),
        }),
      ),
    ).toThrow(/Unsupported rule data/);
    expect(replayEngineeringPassport(passport, catalog, changedRule)).toMatchObject({
      ok: false,
      code: 'rule_data_changed',
    });
  });

  it.each(['synthetic', 'unverified', 'reviewed'] as const)(
    'existing profile lifecycle %s is retained metadata rather than an execution gate',
    (status) => {
      const trace = evaluateEngineeringRules(
        {
          systemVoltageComparison: { powerW: 240, powerBasis: 'direct-source' },
          systemVoltageCandidates: [{ id: '24v', voltageV: 24 }],
          wireCandidates: [],
          wireConstraints: {
            currentA: 10,
            systemVoltageV: 24,
            oneWayLengthM: 2,
            requiredAmpacityA: 15,
            maximumPercentVoltageDrop: 5,
          },
        },
        { id: 'fixture.profile', version: '1.0.0', status, sources: [] },
      );
      expect(trace.standardsProfile.status).toBe(status);
      expect(trace.calculationSteps.every((step) => step.status === 'complete')).toBe(true);
    },
  );
});
