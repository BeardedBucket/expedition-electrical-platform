import { describe, expect, it } from 'vitest';
import {
  evaluateInstalledSystem,
  passportDigest,
  replayEngineeringPassport,
  serializeEngineeringPassport,
} from '../src/engineering-passport.js';
import { validateComponentLibraryRecord } from '../src/component-library.js';
import { completeInstalledSystemFixture } from './fixtures/whole-system.js';
import {
  singleDeviceSystem,
  passiveDeviceFixture,
  multifunctionDeviceFixture,
} from './fixtures/single-device-system.js';

describe('installed topology trust boundaries', () => {
  it('a disconnect relationship does not imply closed state when switching evidence is absent', () => {
    const { input, record } = passiveDeviceFixture();
    expect(
      evaluateInstalledSystem(input, [{ ...record, product_role: 'disconnect' }]).result.status,
    ).toBe('unresolved');
  });
  it('a larger power rating cannot erase a smaller known output or endpoint current limit', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    catalog[0] = {
      ...catalog[0]!,
      ports: catalog[0]!.ports!.map((port) =>
        port.id === 'output' ? { ...port, current_a: 1 } : port,
      ),
    };
    expect(
      evaluateInstalledSystem(input, catalog).decisions.find(
        (decision) => decision.id === 'supply:vehicle-house',
      )?.status,
    ).toBe('blocked');
    const endpoint = completeInstalledSystemFixture();
    endpoint.catalog[3] = {
      ...endpoint.catalog[3]!,
      ports: endpoint.catalog[3]!.ports!.map((port) => ({ ...port, current_a: 1 })),
    };
    expect(
      evaluateInstalledSystem(endpoint.input, endpoint.catalog).decisions.find(
        (decision) => decision.id === 'supply:battery-load24',
      )?.status,
    ).toBe('blocked');
  });
  it('state names cannot collide with summary trace IDs and composite IDs cannot contain delimiters', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const changed = {
      ...input,
      requirements: {
        ...input.requirements,
        load_states: input.requirements.load_states.map((state, index) =>
          index === 0
            ? { ...state, id: 'system' }
            : index === 1
              ? { ...state, id: 'known-device-demand' }
              : state,
        ),
      },
    };
    const passport = evaluateInstalledSystem(changed, catalog);
    expect(new Set(passport.calculations.map((calculation) => calculation.id)).size).toBe(
      passport.calculations.length,
    );
    expect(
      passport.calculations.some((calculation) => calculation.id === 'energy:state:system'),
    ).toBe(true);
    expect(passport.calculations.some((calculation) => calculation.id === 'energy:system')).toBe(
      true,
    );
    expect(() =>
      evaluateInstalledSystem(
        {
          ...input,
          requirements: {
            ...input.requirements,
            supplies: [{ ...input.requirements.supplies[0]!, id: 'ambiguous:delimiter' }],
          },
        },
        catalog,
      ),
    ).toThrow(/schema rejected/);
  });

  it('device-side demand and product-derived unit energy never acquire battery/published labels', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const passport = evaluateInstalledSystem(input, catalog);
    for (const decision of passport.decisions.filter((entry) =>
      entry.id.startsWith('load-state:'),
    )) {
      expect(decision.output).not.toHaveProperty('netBatteryPowerW');
      expect(decision.output).not.toHaveProperty('netBatteryEnergyWh');
      expect(decision.output).toHaveProperty('power_origin');
    }
    expect(
      passport.decisions.find((decision) => decision.id === 'bank:bank')?.output,
    ).toHaveProperty('energy_origin', 'derived_bank_aggregate');
    expect(
      passport.decisions.find((decision) => decision.id === 'bank:bank')?.output,
    ).not.toHaveProperty('nominalEnergyBasis');
  });
  it('preserves separate AC input, AC output and DC battery interfaces on one device', () => {
    const { input, record } = multifunctionDeviceFixture();
    const passport = evaluateInstalledSystem(input, [record]);
    expect(passport.result.status).toBe('satisfied');
    expect(
      passport.decisions
        .filter((decision) => decision.id.startsWith('binding:'))
        .map((decision) => decision.status),
    ).toEqual(['satisfied', 'satisfied', 'satisfied']);
    expect(
      passport.input.architecture.power_topology.domains.map((domain) => [
        domain.nominal_voltage_v,
        domain.frequency_hz,
      ]),
    ).toEqual([
      [24, undefined],
      [120, 60],
      [230, 50],
    ]);
    expect(passport.component_bindings[0]!.record.electrical?.nominal_voltage_v).toBe(12);
  });

  it('missing AC port frequency remains unknown despite a global product frequency', () => {
    const { input, record } = multifunctionDeviceFixture();
    const changed = {
      ...record,
      ports: record.ports!.map((port) =>
        port.id === 'ac-in' ? { ...port, frequency_hz: null } : port,
      ),
    };
    expect(
      evaluateInstalledSystem(input, [changed]).decisions.find(
        (decision) => decision.id === 'binding:ac-in',
      )?.status,
    ).toBe('unresolved');
  });

  it('blocks incompatible AC frequency without preferring any voltage', () => {
    const { input, record } = multifunctionDeviceFixture();
    const changed = {
      ...record,
      ports: record.ports!.map((port) =>
        port.id === 'ac-out' ? { ...port, frequency_hz: 60 } : port,
      ),
    };
    expect(evaluateInstalledSystem(input, [changed]).result.status).toBe('blocked');
  });

  it('validates port-specific frequency ranges including negative and inverted bounds', () => {
    const { record } = multifunctionDeviceFixture();
    expect(
      validateComponentLibraryRecord({
        ...record,
        ports: record.ports!.map((port) => ({ ...port, frequency_hz: { min: 60, max: 50 } })),
      }).ok,
    ).toBe(false);
    expect(
      validateComponentLibraryRecord({
        ...record,
        ports: record.ports!.map((port) => ({ ...port, frequency_hz: -1 })),
      }).ok,
    ).toBe(false);
  });

  it('published global efficiency cannot resolve path-specific multi-function losses', () => {
    const { input, record } = multifunctionDeviceFixture();
    const changedInput = {
      ...input,
      requirements: {
        ...input.requirements,
        supplies: input.requirements.supplies.map((supply) => ({
          ...supply,
          required_power_w: 100,
        })),
      },
    };
    const passport = evaluateInstalledSystem(changedInput, [
      {
        ...record,
        efficiency_fraction: 0.95,
        ports: record.ports!.map((port) => ({ ...port, power_w: 1000 })),
      },
    ]);
    expect(passport.result.status).toBe('unresolved');
    expect(
      passport.calculations.some((calculation) => calculation.id.startsWith('conversion:')),
    ).toBe(false);
  });

  it('static conductive continuity connects distinct same-voltage buses only via explicit edges', () => {
    const { input, record } = passiveDeviceFixture();
    const passport = evaluateInstalledSystem(input, [record]);
    expect(passport.result.status).toBe('satisfied');
    expect(passport.result.energy.total_energy_wh).toBe(0);
    expect(passport.input.architecture.power_topology.domains).toHaveLength(2);
  });

  it('passive conductive relationships cannot bridge a voltage mismatch', () => {
    const { input, record } = passiveDeviceFixture();
    const changed = {
      ...input,
      architecture: {
        ...input.architecture,
        power_topology: {
          ...input.architecture.power_topology,
          domains: input.architecture.power_topology.domains.map((domain) =>
            domain.id === 'destination' ? { ...domain, nominal_voltage_v: 24 } : domain,
          ),
        },
      },
    };
    expect(
      evaluateInstalledSystem(changed, [record]).decisions.find(
        (decision) => decision.id === 'edge:contact',
      )?.status,
    ).toBe('blocked');
  });

  it.each(['on', 'off', undefined])(
    'switching configuration %s does not acquire a default',
    (selection) => {
      const { input, record } = passiveDeviceFixture();
      const changedRecord = {
        ...record,
        product_role: 'disconnect' as const,
        switching: {
          controlled_relationship_ids: ['continuity'],
          configurations: [
            { id: 'on', active_relationship_ids: ['continuity'] },
            { id: 'off', active_relationship_ids: [] },
          ],
        },
      };
      const changedInput = {
        ...input,
        architecture: {
          ...input.architecture,
          power_topology: {
            ...input.architecture.power_topology,
            edges: input.architecture.power_topology.edges.map((edge) =>
              edge.kind === 'conductive'
                ? {
                    ...edge,
                    ...(selection === undefined ? {} : { switching_configuration_id: selection }),
                  }
                : edge,
            ),
          },
        },
      };
      expect(evaluateInstalledSystem(changedInput, [changedRecord]).result.status).toBe(
        selection === 'on' ? 'satisfied' : selection === 'off' ? 'blocked' : 'unresolved',
      );
    },
  );

  it('unknown isolation is not false, safe or a satisfied separation assertion', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const changed = {
      ...input,
      requirements: {
        ...input.requirements,
        supplies: input.requirements.supplies.map((supply) => ({
          ...supply,
          requires_isolation: true,
        })),
      },
    };
    expect(evaluateInstalledSystem(changed, catalog).result.status).toBe('unresolved');
  });

  it('shared converter ratings cannot certify combined demand without concurrency context', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const changed = {
      ...input,
      requirements: {
        ...input.requirements,
        supplies: [
          ...input.requirements.supplies,
          { ...input.requirements.supplies[0]!, id: 'another-route', required_power_w: 400 },
        ],
      },
    };
    const passport = evaluateInstalledSystem(changed, catalog);
    expect(
      passport.decisions.find((decision) => decision.code === 'shared_capacity_unresolved')?.status,
    ).toBe('unresolved');
  });

  it('known manufacturer series permission supports explicit series bank output without a recommendation', () => {
    const fixture = completeInstalledSystemFixture();
    const battery = fixture.catalog[2]!;
    const requirements = {
      ...fixture.input.requirements,
      supplies: [{ id: 'bank-supply', from: 'battery', to: 'house', edge_ids: ['wire'] }],
      load_states: [
        {
          id: 'baseline',
          binding_id: 'battery',
          state: 'quiescent' as const,
          duration_hours: 10,
          power: {
            kind: 'component' as const,
            qualified_value_id: 'baseline',
            context: {
              supply_voltage_v: 24,
              electrical_domain: 'dc' as const,
              measurement_basis: 'quiescent' as const,
            },
          },
        },
      ],
      battery_banks: [
        {
          id: 'bank',
          instance_id: 'device',
          domain_id: 'house',
          series_count: 2,
          parallel_count: 1,
        },
      ],
    };
    const input = singleDeviceSystem(
      battery,
      {
        domains: [{ id: 'house', kind: 'dc', nominal_voltage_v: 48 }],
        bindings: [
          { id: 'battery', instance_id: 'device', port_id: 'battery', domain_id: 'house' },
        ],
        edges: [{ id: 'wire', kind: 'wire', from: 'battery', to: 'house' }],
      },
      requirements,
    );
    const passport = evaluateInstalledSystem(input, [battery]);
    expect(passport.result.status).toBe('satisfied');
    expect(passport.result.energy.total_energy_wh).toBe(20);
    expect(
      passport.calculations.find((calculation) => calculation.id === 'bank:bank')?.output,
    ).toMatchObject({ nominal_voltage_v: 48, nominal_energy_wh: 4800 });
    expect(
      passport.result.warnings.some((warning) => warning.code === 'series_installation_review'),
    ).toBe(true);
    expect(passport).not.toHaveProperty('recommendations');
  });

  it('prohibited series counts block, and missing parallel permission remains unresolved', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const changed = {
      ...input,
      requirements: {
        ...input.requirements,
        battery_banks: input.requirements.battery_banks.map((bank) => ({
          ...bank,
          series_count: 3,
        })),
      },
    };
    expect(
      evaluateInstalledSystem(changed, catalog).decisions.find(
        (decision) => decision.id === 'bank:bank',
      )?.status,
    ).toBe('blocked');
    const battery = catalog[2]!;
    catalog[2] = {
      ...battery,
      battery: { nominal_capacity_ah: 100, allowed_series_count: { min: 1, max: 2 } },
    };
    expect(
      evaluateInstalledSystem(input, catalog).decisions.find(
        (decision) => decision.id === 'bank:bank',
      )?.status,
    ).toBe('unresolved');
  });

  it('retains actual manufacturer revision as an assertion with its independent review status', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    catalog[0] = {
      ...catalog[0]!,
      manufacturer_revision: 'manufacturer-rev-b',
      verification_status: 'unverified',
    };
    const passport = evaluateInstalledSystem(input, catalog);
    expect(
      passport.component_bindings.find((binding) => binding.component_id === 'fixture.boost')
        ?.manufacturer_revision,
    ).toEqual({
      state: 'recorded',
      value: 'manufacturer-rev-b',
      verification_status: 'unverified',
    });
    expect(passport.result.status).toBe('unresolved');
  });

  it('missing schedule duration or horizon cannot create total energy', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const changed = {
      ...input,
      requirements: { ...input.requirements, evaluation_hours: undefined },
    };
    // Undefined is not a portable representation of an unknown; omit the field.
    const { evaluation_hours: _hours, ...requirements } = changed.requirements;
    expect(
      evaluateInstalledSystem({ ...input, requirements }, catalog).result.energy.total_energy_wh,
    ).toBeUndefined();
  });

  it('numeric overflow cannot be silently serialized as null', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const changed = {
      ...input,
      requirements: {
        ...input.requirements,
        load_states: input.requirements.load_states.map((state) =>
          state.power.kind === 'requirement'
            ? { ...state, power: { ...state.power, watts: Number.MAX_VALUE } }
            : state,
        ),
      },
    };
    expect(() => evaluateInstalledSystem(changed, catalog)).toThrow(/overflow|finite portable/);
  });

  it('unsupported accessor or symbol properties cannot be erased before hashing', () => {
    expect(() => passportDigest({ [Symbol('hidden')]: true })).toThrow();
    expect(() =>
      passportDigest({
        get voltage() {
          return 12;
        },
      }),
    ).toThrow();
    expect(() => passportDigest(new Array(2))).toThrow();
  });

  it('missing endpoints, duplicate bindings and ambiguous catalog identities fail explicitly', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const topology = input.architecture.power_topology;
    expect(() =>
      evaluateInstalledSystem(
        {
          ...input,
          architecture: {
            ...input.architecture,
            power_topology: {
              ...topology,
              bindings: [...topology.bindings, topology.bindings[0]!],
            },
          },
        },
        catalog,
      ),
    ).toThrow(/Duplicate/);
    expect(() =>
      evaluateInstalledSystem(
        {
          ...input,
          requirements: {
            ...input.requirements,
            supplies: [{ id: 'missing', from: 'nonexistent', to: 'house', edge_ids: [] }],
          },
        },
        catalog,
      ),
    ).toThrow(/Missing endpoint/);
    expect(() => evaluateInstalledSystem(input, [...catalog, catalog[0]!])).toThrow(/Duplicate/);
    expect(
      replayEngineeringPassport(evaluateInstalledSystem(input, catalog), [...catalog, catalog[0]!]),
    ).toMatchObject({ ok: false, code: 'duplicate_component' });
  });

  it('no route is generated for disconnected equal-voltage domain identities', () => {
    const { input, record } = passiveDeviceFixture();
    const changed = {
      ...input,
      requirements: {
        ...input.requirements,
        supplies: [{ id: 'supply', from: 'source', to: 'destination', edge_ids: [] }],
      },
    };
    expect(evaluateInstalledSystem(changed, [record]).result.status).toBe('blocked');
  });

  it('unknown product direction cannot become an incompatible reviewed assertion', () => {
    const { input, record } = passiveDeviceFixture();
    const changed = {
      ...record,
      verification_status: 'unverified' as const,
      ports: record.ports!.map((port) => ({ ...port, direction: 'input' as const })),
    };
    expect(evaluateInstalledSystem(input, [changed]).result.status).toBe('unresolved');
  });

  it('replay rejects changed evaluator identity and altered trace payload', () => {
    const { input, catalog } = completeInstalledSystemFixture();
    const passport = evaluateInstalledSystem(input, catalog);
    expect(
      replayEngineeringPassport({ ...passport, evaluator_revision: 'different' }, catalog),
    ).toMatchObject({ ok: false, code: 'evaluator_changed' });
    expect(() => serializeEngineeringPassport({ ...passport, calculations: [] })).toThrow(
      /integrity/,
    );
  });
});
