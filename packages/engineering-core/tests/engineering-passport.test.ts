import { describe, expect, it } from 'vitest';
import {
  evaluateInstalledSystem,
  parseEngineeringPassport,
  serializeEngineeringPassport,
  replayEngineeringPassport,
  passportDigest,
  serializePassportValue,
  installedSystemRuleData,
} from '../src/engineering-passport.js';
import type { ComponentLibraryRecord } from '../src/component-library.js';
import { completeInstalledSystemFixture } from './fixtures/whole-system.js';
import { exportPassportProof } from './fixtures/passport-artifact.js';

const evaluate = () => {
  const fixture = completeInstalledSystemFixture();
  return evaluateInstalledSystem(fixture.input, fixture.catalog);
};
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const replace = (
  catalog: ComponentLibraryRecord[],
  index: number,
  edits: Partial<ComponentLibraryRecord>,
) => {
  catalog[index] = { ...catalog[index]!, ...edits };
};

describe('portable installed-system engineering passport', () => {
  it('proves explicit 12 -> 24 -> 12 domains with reviewed synthetic facts', () => {
    const passport = evaluate();
    expect(passport.result.status).toBe('satisfied');
    expect(passport.result.system_evaluation.status).toBe('PASS');
    expect(
      passport.input.architecture.power_topology.domains.map((domain) => domain.nominal_voltage_v),
    ).toEqual([12, 24, 12]);
    expect(passport.result.energy.total_energy_wh).toBe(750);
    expect(passport.calculations.find((entry) => entry.id === 'bank:bank')?.output).toMatchObject({
      nominal_energy_wh: 2400,
    });
    exportPassportProof('positive', passport);
  });

  it('is deterministic and does not mutate or retain mutable caller inputs', () => {
    const fixture = completeInstalledSystemFixture();
    const before = copy(fixture);
    const first = evaluateInstalledSystem(fixture.input, fixture.catalog);
    expect(evaluateInstalledSystem(fixture.input, fixture.catalog)).toEqual(first);
    expect(fixture).toEqual(before);
    replace(fixture.catalog, 0, { model: 'changed' });
    expect(
      first.component_bindings.find((binding) => binding.component_id === 'fixture.boost')?.record
        .model,
    ).toBe('boost');
  });

  it('has stable JSON, can reconstruct in another input ordering, and replays exactly', () => {
    const fixture = completeInstalledSystemFixture();
    const passport = evaluateInstalledSystem(fixture.input, fixture.catalog);
    const text = serializeEngineeringPassport(passport);
    expect(parseEngineeringPassport(text)).toEqual(passport);
    expect(serializeEngineeringPassport(parseEngineeringPassport(text))).toBe(text);
    expect(replayEngineeringPassport(passport, [...fixture.catalog].reverse())).toEqual({
      ok: true,
      passport,
    });
    expect(evaluateInstalledSystem(fixture.input, [...fixture.catalog].reverse())).toEqual(
      passport,
    );
    expect(passportDigest({ b: 1, a: 2 })).toBe(passportDigest({ a: 2, b: 1 }));
  });

  it('blocks a direct 12 V source to 24 V house wire', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const bad = { id: 'direct', kind: 'wire' as const, from: 'vehicle', to: 'house' };
    const modified = {
      ...input,
      architecture: {
        ...input.architecture,
        power_topology: {
          ...input.architecture.power_topology,
          edges: [...input.architecture.power_topology.edges, bad],
        },
      },
      requirements: {
        ...input.requirements,
        supplies: [{ id: 'direct', from: 'vehicle', to: 'house', edge_ids: ['direct'] }],
      },
    };
    expect(evaluateInstalledSystem(modified, catalog).result.status).toBe('blocked');
  });

  it.each(['fuse', 'breaker', 'disconnect', 'busbar', 'distribution_panel'] as const)(
    'never lets passive %s hardware satisfy conversion',
    (role) => {
      const { input, catalog } = completeInstalledSystemFixture();
      replace(catalog, 0, { product_role: role });
      expect(
        evaluateInstalledSystem(input, catalog).decisions.find(
          (decision) => decision.id === 'edge:boost-conversion',
        )?.status,
      ).toBe('blocked');
    },
  );

  it('rejects distribution capability as a conversion path', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 0, { capabilities: [{ id: 'conversion', type: 'distribution' }] });
    expect(evaluateInstalledSystem(input, catalog).result.status).toBe('blocked');
  });

  it('blocks a reverse converter edge without inventing bidirectional operation', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const topology = input.architecture.power_topology;
    const modified = {
      ...input,
      architecture: {
        ...input.architecture,
        power_topology: {
          ...topology,
          edges: topology.edges.map((edge) =>
            edge.id === 'boost-conversion' ? { ...edge, from: edge.to, to: edge.from } : edge,
          ),
        },
      },
    };
    expect(evaluateInstalledSystem(modified, catalog).result.status).toBe('blocked');
  });

  it.each([48, { min: 26, max: 30 }])('blocks unsupported converter voltage %j', (voltage) => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 0, {
      ports: catalog[0]!.ports!.map((port) =>
        port.id === 'output' ? { ...port, voltage_v: voltage } : port,
      ),
    });
    expect(evaluateInstalledSystem(input, catalog).result.status).toBe('blocked');
  });

  it('keeps missing converter voltage, efficiency and current limits unresolved', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 0, {
      ports: catalog[0]!.ports!.map((port) => ({ ...port, voltage_v: null })),
      efficiency_fraction: null,
    });
    expect(evaluateInstalledSystem(input, catalog).result.status).toBe('unresolved');
    expect(
      evaluateInstalledSystem(input, catalog).calculations.some((calculation) =>
        calculation.id.includes('conversion:vehicle'),
      ),
    ).toBe(false);
  });

  it('propagates reviewed DC conversion losses and identifies the formula/input facts', () => {
    const passport = evaluate();
    const conversion = passport.calculations.find(
      (entry) => entry.id === 'conversion:vehicle-house:boost-conversion',
    )!;
    expect(conversion.output).toMatchObject({ inputPowerW: 100 / 0.9, currentA: 100 / 0.9 / 12 });
    expect(conversion.kind).toBe('derived');
    expect(conversion.formula).toContain('/ efficiency');
    expect(conversion.evidence_refs).toContainEqual({
      evidence_id: 'evidence:fixture.boost:efficiency_fraction',
      engineering_use: 'accepted_input',
    });
    expect(conversion.rule_revision).toBe(passport.rule_data.version);
  });

  it('blocks insufficient converter power and current, without a magic safety margin', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 0, {
      ports: catalog[0]!.ports!.map((port) =>
        port.id === 'input' ? { ...port, current_a: 1 } : { ...port, power_w: 99 },
      ),
    });
    expect(evaluateInstalledSystem(input, catalog).result.status).toBe('blocked');
  });

  it('unknown idle power cannot be filled with a requirement assumption or zero', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 0, { qualified_values: [] });
    const result = evaluateInstalledSystem(input, catalog);
    expect(result.result.status).toBe('unresolved');
    expect(result.result.energy.total_energy_wh).toBeUndefined();
    expect(result.result.energy.resolved_subtotal_energy_wh).toBe(740);
    expect(result.result.energy.unresolved_contributions).toContainEqual({
      kind: 'state',
      instance_id: 'boost',
      state_id: 'boost.baseline',
      reasons: ['power_unknown'],
    });
    const modified = {
      ...input,
      requirements: {
        ...input.requirements,
        load_states: input.requirements.load_states.map((state) =>
          state.id === 'boost.baseline'
            ? {
                ...state,
                state: 'idle' as const,
                power: { kind: 'requirement' as const, watts: 0, assumption_id: 'demand' },
              }
            : state,
        ),
      },
    };
    expect(
      evaluateInstalledSystem(modified, catalog).result.energy.total_energy_wh,
    ).toBeUndefined();
  });

  it('missing baseline schedules cannot silently disappear from energy accounting', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const modified = {
      ...input,
      requirements: {
        ...input.requirements,
        load_states: input.requirements.load_states.filter(
          (state) => state.id !== 'boost.baseline',
        ),
      },
    };
    const passport = evaluateInstalledSystem(modified, catalog);
    expect(passport.result.status).toBe('unresolved');
    expect(passport.result.energy.total_energy_wh).toBeUndefined();
    expect(passport.decisions.find((decision) => decision.id === 'schedule:boost')?.status).toBe(
      'unresolved',
    );
  });

  it('display-off alone is not idle and wrong discrete voltage/context cannot be borrowed', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 0, {
      qualified_values: [
        {
          id: 'baseline',
          target: 'electrical.power_consumption_w',
          value: 1,
          qualifiers: { display: { state: 'off' }, supply_voltage_v: 24 },
        },
      ],
    });
    expect(
      evaluateInstalledSystem(input, catalog).result.energy.unresolved_contributions,
    ).toContainEqual({
      kind: 'state',
      instance_id: 'boost',
      state_id: 'boost.baseline',
      reasons: ['power_unknown'],
    });
  });

  it('does not classify canonical normalization as published source-native text or derived engineering', () => {
    const passport = evaluate();
    const fact = passport.examined_evidence.find(
      (entry) => entry.path === 'qualified_values.baseline',
    )!;
    expect(fact.source_native.state).toBe('not_retained_in_canonical_record');
    expect(fact.normalization.kind).toBe('canonical_projection');
    expect(fact.origin).toBe('canonical_assertion');
    expect(fact.normalization).not.toHaveProperty('formula');
    expect(
      passport.calculations.every(
        (entry) => entry.kind === 'derived' && entry.rule_id && entry.formula && entry.inputs,
      ),
    ).toBe(true);
  });

  it('keeps product-derived values and lineage distinct from source-published facts', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 2, {
      battery: { ...catalog[2]!.battery, nominal_energy_wh: 2400 },
      derived_fields: {
        'battery.nominal_energy_wh': {
          status: 'derived',
          rule_version: 'fixture.energy.v1',
          formula: 'V * Ah',
          input_targets: ['electrical.nominal_voltage_v', 'battery.nominal_capacity_ah'],
          input_fact_ids: ['fixture.v', 'fixture.ah'],
          input_units: ['V', 'Ah'],
          output_unit: 'Wh',
          assumptions: [],
        },
      },
    });
    const fact = evaluateInstalledSystem(input, catalog).examined_evidence.find(
      (entry) => entry.path === 'battery.nominal_energy_wh',
    )!;
    expect(fact.origin).toBe('product_derivation');
    expect(fact.product_derivation).toMatchObject({ formula: 'V * Ah' });
  });

  it('never manufactures a manufacturer revision from corpus/project identities', () => {
    expect(
      evaluate().component_bindings.every(
        (binding) =>
          binding.manufacturer_revision.state === 'unknown' &&
          binding.record_digest.startsWith('sha256:'),
      ),
    ).toBe(true);
  });

  it('physical body dimensions do not become installed envelope or clearances', () => {
    const passport = evaluate();
    expect(passport.component_bindings[0]!.record.dimensions_mm).toBeDefined();
    expect(
      passport.result.warnings.filter(
        (warning) => warning.code === 'installed_envelope_unresolved',
      ),
    ).toHaveLength(5);
    expect(passport.calculations.some((calculation) => calculation.id.includes('envelope'))).toBe(
      false,
    );
  });

  it('series arithmetic cannot authorize a bank with unknown manufacturer permission', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 2, { battery: { nominal_capacity_ah: 100 } });
    const modified = {
      ...input,
      requirements: {
        ...input.requirements,
        battery_banks: input.requirements.battery_banks.map((bank) => ({
          ...bank,
          series_count: 2,
        })),
      },
    };
    const passport = evaluateInstalledSystem(modified, catalog);
    expect(passport.decisions.find((decision) => decision.id === 'bank:bank')?.status).toBe(
      'unresolved',
    );
    expect(passport.calculations.some((calculation) => calculation.id === 'bank:bank')).toBe(false);
  });

  it('unknown grounding role remains separate from DC or AC role declarations', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 0, {
      terminals: [{ id: 'ground', function: 'chassis_ground', polarity: 'ground' }],
    });
    const passport = evaluateInstalledSystem(input, catalog);
    expect(
      passport.result.warnings.some((warning) => warning.code === 'bonding_role_unresolved'),
    ).toBe(true);
    expect(passport.examined_evidence.some((fact) => fact.path.includes('ground'))).toBe(false);
  });

  it('advisory state cannot become product ratings or engineering exclusion', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 0, {
      advisory_refs: [{ id: 'fixture.critical', status: 'critical', continuous_power_w: 99999 }],
    });
    const passport = evaluateInstalledSystem(input, catalog);
    expect(passport.result.status).toBe('satisfied');
    expect(
      passport.result.warnings.some((warning) => warning.code === 'advisory_review_required'),
    ).toBe(true);
    expect(passport.examined_evidence.some((fact) => fact.path.includes('advisory'))).toBe(false);
  });

  it('rejects builder/commercial policy at the input boundary', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    expect(() =>
      evaluateInstalledSystem(
        { ...input, builder: { preferredManufacturers: ['fixture'] } } as typeof input,
        catalog,
      ),
    ).toThrow(/schema rejected/);
    replace(catalog, 0, { price: 0, builder_preference: 'preferred' });
    expect(evaluateInstalledSystem(input, catalog).result.status).toBe('satisfied');
  });

  it('detects material component/rule changes and missing referenced records during replay', () => {
    const fixture = completeInstalledSystemFixture();
    const passport = evaluateInstalledSystem(fixture.input, fixture.catalog);
    expect(replayEngineeringPassport(passport, fixture.catalog.slice(1))).toMatchObject({
      ok: false,
      code: 'component_missing',
    });
    replace(fixture.catalog, 0, { efficiency_fraction: 0.8 });
    expect(replayEngineeringPassport(passport, fixture.catalog)).toMatchObject({
      ok: false,
      code: 'component_changed',
    });
    expect(
      replayEngineeringPassport(passport, fixture.catalog, {
        ...installedSystemRuleData,
        description: 'changed meaning with same version',
      }),
    ).toMatchObject({ ok: false, code: 'rule_data_changed' });
    expect(() => evaluateInstalledSystem(fixture.input, [])).toThrow(
      /Missing referenced component/,
    );
  });

  it('rejects forged stronger statuses even with recomputed passport integrity', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 0, { verification_status: 'unverified' });
    const forged = copy(evaluateInstalledSystem(input, catalog));
    const body = { ...forged, result: { ...forged.result, status: 'satisfied' as const } };
    const { passport_digest: _oldDigest, ...hashed } = body;
    expect(() =>
      parseEngineeringPassport(
        serializePassportValue({ ...body, passport_digest: passportDigest(hashed) }),
      ),
    ).toThrow(/does not reproduce/);
  });

  it.each([NaN, Infinity, undefined, new Date(), new Map()])(
    'rejects nonportable or silently coerced input %j',
    (value) => {
      expect(() => passportDigest({ value })).toThrow();
    },
  );

  it('does not infer generic AC frequency or ignore contextual constraints', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    replace(catalog, 0, {
      ports: catalog[0]!.ports!.map((port) => ({
        ...port,
        constraints: [
          { id: 'startup', quantity: 'voltage', unit: 'V', kind: 'startup_threshold', value: 11 },
        ],
      })),
    });
    expect(evaluateInstalledSystem(input, catalog).result.status).toBe('unresolved');
  });
});
