import { describe, expect, it } from 'vitest';
import {
  generateArchitectures,
  parseArchitectureGeneration,
  serializeArchitectureGeneration,
  replayArchitectureGeneration,
  architectureGenerationPolicy,
  type ArchitectureGenerationInput,
  type ArchitectureCandidate,
} from '../src/architecture-generation.js';
import { passportDigest } from '../src/portable-json.js';
import { evaluateAbstractPowerTopology } from '../src/abstract-power-evaluation.js';
import {
  evaluateInstalledSystem,
  parseEngineeringPassport,
  serializeEngineeringPassport,
} from '../src/engineering-passport.js';
import { architectureWitness } from './fixtures/architecture-witness.js';

type Load = ArchitectureGenerationInput['requirements']['loads'][number];
const dc = (id: string, power = 100, voltage = 12): Load => ({
  id,
  domain: { kind: 'dc', nominal_voltage_v: voltage },
  required_power_w: power,
});
const ac = (id: string, power = 100, voltage = 120, hz = 60): Load => ({
  id,
  domain: { kind: 'ac', nominal_voltage_v: voltage, frequency_hz: hz },
  required_power_w: power,
});
const input = (loads: readonly Load[], shore = false): ArchitectureGenerationInput => ({
  schema_version: '2.0.0',
  assumptions: [],
  requirements: {
    id: 'review.shared-demands',
    fixed_house_voltage_v: 24,
    loads,
    storage: { required: true, minimum_nominal_energy_wh: 2400 },
    charging_sources: shore
      ? [
          {
            id: 'shore',
            kind: 'shore',
            domain: { kind: 'ac', nominal_voltage_v: 230, frequency_hz: 50 },
            required_output_power_w: 500,
          },
        ]
      : [],
  },
});
const supplyRoles = (candidate: ArchitectureCandidate) =>
  candidate.required_roles.filter((role) =>
    role.output_capacity.some((capacity) => capacity.demand_endpoint_ids.length),
  );
const first = (loads: readonly Load[]) => generateArchitectures(input(loads)).candidates[0]!;
const powers = (candidate: ArchitectureCandidate) =>
  supplyRoles(candidate).flatMap((role) =>
    role.constraints.filter((c) => c.kind === 'minimum_output_power').map((c) => c.power_w),
  );
const rehash = (result: ReturnType<typeof generateArchitectures>) => {
  const candidates = result.candidates.map(({ id: _id, candidate_digest: _digest, ...body }) => {
    const digest = passportDigest(body);
    return { ...body, id: `architecture.${digest.slice(7)}`, candidate_digest: digest };
  });
  const { result_digest: _digest, ...body } = result;
  const changed = { ...body, candidates };
  return { ...changed, result_digest: passportDigest(changed) };
};

describe('reviewed demand, topology and product capacity boundaries', () => {
  it('two 12 V demands share one 24-to-12 V conversion boundary', () => {
    const c = first([dc('pump'), dc('lights', 200)]);
    expect(supplyRoles(c).map((role) => role.function)).toEqual(['dc_conversion']);
    expect(new Set(c.demand_endpoints.map((endpoint) => endpoint.domain_id)).size).toBe(1);
    const routes = c.topology.routes.filter((route) => route.id.startsWith('supply.'));
    expect(routes[0]!.edge_ids.slice(0, 3)).toEqual(routes[1]!.edge_ids.slice(0, 3));
    expect(routes[0]!.to).not.toBe(routes[1]!.to);
  });
  it('two compatible AC demands share one inverter', () => {
    expect(supplyRoles(first([ac('a'), ac('b')])).map((role) => role.function)).toEqual([
      'inverter',
    ]);
  });
  it('every individual power gate retains its original input pointer and decision', () => {
    const c = first([dc('z', 110), dc('a', 220)]);
    const role = supplyRoles(c)[0]!;
    for (const [index, power] of [110, 220].entries())
      expect(role.constraints).toContainEqual(
        expect.objectContaining({
          kind: 'minimum_output_power',
          power_w: power,
          provenance: [
            { kind: 'requirement', pointer: `/requirements/loads/${index}/required_power_w` },
            { kind: 'generation_decision', decision_id: index === 0 ? 'load.z' : 'load.a' },
          ],
        }),
      );
    expect(role.output_capacity[0]!.lower_bound_constraint_ids).toHaveLength(2);
    expect(role.output_capacity[0]!.demand_endpoint_ids).toEqual(['demand.a', 'demand.z']);
  });
  it('unknown concurrency creates no summed rating, diversity or efficiency', () => {
    const c = first([dc('a', 100), dc('b', 200)]);
    expect(powers(c)).toEqual([100, 200]);
    expect(JSON.stringify(c.required_roles)).not.toMatch(/efficiency|diversity|simultaneous_power/);
  });
  it('shared output capacity remains explicitly unresolved with a retained candidate', () => {
    const c = first([dc('a'), dc('b')]);
    expect(c.structural_evaluation.status).toBe('unresolved');
    expect(supplyRoles(c)[0]!.output_capacity[0]).toMatchObject({
      status: 'unresolved',
      unresolved_reasons: ['concurrency_not_asserted'],
    });
    expect(c.structural_evaluation.blocked_decision_ids).toEqual([]);
  });
  it('known and unknown power demands can share without turning unknown into zero', () => {
    const c = first([dc('a', 120), { id: 'b', domain: { kind: 'dc', nominal_voltage_v: 12 } }]);
    expect(supplyRoles(c)).toHaveLength(1);
    expect(powers(c)).toEqual([120]);
    expect(c.demand_endpoints.find((e) => e.source_requirement_id === 'b')).not.toHaveProperty(
      'required_power_w',
    );
    expect(supplyRoles(c)[0]!.output_capacity[0]!.unresolved_reasons).toEqual([
      'concurrency_not_asserted',
      'demand_power_unknown',
    ]);
  });
  it('explicit isolation retains separate boundaries and isolation evidence gates', () => {
    const c = first([dc('a'), { ...dc('b'), requires_isolation: true }]);
    expect(supplyRoles(c)).toHaveLength(2);
    expect(supplyRoles(c).flatMap((role) => role.constraints)).toContainEqual(
      expect.objectContaining({ kind: 'isolation', required: true }),
    );
    expect(
      c.demand_endpoints.find((e) => e.source_requirement_id === 'b')!.requires_isolation,
    ).toBe(true);
  });
  it('different DC voltages retain different conversion domains', () => {
    expect(supplyRoles(first([dc('a', 100, 12), dc('b', 100, 48)]))).toHaveLength(2);
  });
  it.each([
    [230, 60],
    [120, 50],
  ])('AC target %i V / %i Hz remains separate from 120 V / 60 Hz', (v, hz) => {
    const result = generateArchitectures(input([ac('a'), ac('b', 100, v, hz)], true));
    expect(result.candidates).toHaveLength(1);
    expect(supplyRoles(result.candidates[0]!)).toHaveLength(2);
    expect(result.candidates[0]!.choices.ac_function_arrangement).toBe('separate');
  });
  it('unknown domain compatibility does not silently establish sharing', () => {
    const c = first([
      { id: 'a', domain: { kind: 'ac', nominal_voltage_v: 120 } },
      { id: 'b', domain: { kind: 'ac', nominal_voltage_v: 120 } },
    ]);
    expect(supplyRoles(c)).toHaveLength(2);
    expect(c.structural_evaluation.status).toBe('unresolved');
  });
  it('endpoints are explicit nonmandatory catalog objects with independent topology identity', () => {
    const c = first([dc('a'), dc('b')]);
    expect(c.demand_endpoints).toHaveLength(2);
    for (const endpoint of c.demand_endpoints) {
      expect(endpoint).toMatchObject({ kind: 'end_use_demand', product_binding: 'not_required' });
      expect(c.required_roles.some((role) => role.id === endpoint.id)).toBe(false);
      expect(c.topology.bindings.some((binding) => binding.id === endpoint.id)).toBe(false);
      expect(c.topology.routes.some((route) => route.to === endpoint.id)).toBe(true);
    }
  });
  it('a corpus without any load products cannot create a requirement-only endpoint slot', () => {
    const c = first([dc('a'), dc('b')]);
    // No Phase 5 filter is implemented: the contractual selection surface is roles.
    expect(c.required_roles.every((role) => role.function !== ('load' as string))).toBe(true);
    expect(
      c.required_roles.some((role) =>
        role.constraints.some(
          (g) => g.kind === 'capability' && g.capability === 'load_consumption',
        ),
      ),
    ).toBe(false);
    expect(generateArchitectures(input([dc('a'), dc('b')]))).toEqual(
      generateArchitectures(input([dc('a'), dc('b')])),
    );
  });
  it('stable endpoint identity permits a future optional exact-product association', () => {
    const c = first([dc('a')]);
    const before = JSON.stringify(c.required_roles);
    const applicationAssociation = new Map([
      [c.demand_endpoints[0]!.id, 'future.external-product'],
    ]);
    expect(applicationAssociation.get('demand.a')).toBe('future.external-product');
    expect(JSON.stringify(c.required_roles)).toBe(before);
    expect(c.demand_endpoints[0]!.product_binding).toBe('not_required');
  });
  it('retains schedules, explicit false isolation and provenance without interpreting overlap', () => {
    const schedule = [{ state: 'active' as const, duration_hours: 2, power_w: 50 }];
    const c = first([{ ...dc('a'), schedule, requires_isolation: false }, dc('b')]);
    const endpoint = c.demand_endpoints.find((e) => e.source_requirement_id === 'a')!;
    expect(endpoint).toMatchObject({ schedule, requires_isolation: false, required_power_w: 100 });
    expect(endpoint.provenance).toContainEqual({
      kind: 'requirement',
      pointer: '/requirements/loads/0',
    });
    expect(powers(c)).toEqual([100, 100]);
    expect(supplyRoles(c)[0]!.output_capacity[0]!.status).toBe('unresolved');
  });
  it('storage receives no load output rating from native house-domain co-location', () => {
    const c = first([dc('native', 900, 24)]);
    const storage = c.required_roles.find((role) => role.function === 'storage')!;
    expect(storage.constraints.some((g) => g.kind === 'minimum_output_power')).toBe(false);
    expect(c.demand_endpoints[0]!.required_power_w).toBe(900);
    expect(supplyRoles(c)).toEqual([]);
  });
  it('missing storage discharge stays unresolved/deferred without a zero gate', () => {
    const c = first([dc('native', 900, 24)]);
    expect(c.required_roles.find((role) => role.function === 'storage')!.output_capacity).toEqual([
      expect.objectContaining({
        scope: 'storage_dispatch',
        status: 'unresolved',
        lower_bound_constraint_ids: [],
        unresolved_reasons: ['storage_dispatch_not_asserted'],
      }),
    ]);
    expect(c.structural_evaluation.deferred_checks).toContain(
      'storage_discharge_dispatch_and_capacity',
    );
  });
  it('shared AC demand supports both combined and separate functions independently of products', () => {
    const result = generateArchitectures(input([ac('a', 100), ac('b', 200)], true));
    expect(result.candidates.map((c) => c.choices.ac_function_arrangement)).toEqual([
      'combined',
      'separate',
    ]);
    const combined = result.candidates[0]!;
    const role = supplyRoles(combined)[0]!;
    expect(role.function).toBe('inverter_charger');
    expect(
      role.constraints.filter((g) => g.kind === 'directed_power_path').map((g) => g.capability),
    ).toEqual(['inversion', 'charging']);
    expect(role.constraints.filter((g) => g.kind === 'interface')).toHaveLength(3);
    expect(role.binding_scope).toBe('single_device');
    expect(role.output_capacity.map((c) => [c.interface_id, c.status])).toEqual([
      ['output', 'unresolved'],
      ['dc', 'specified'],
    ]);
    expect(combined.structural_evaluation.status).toBe('unresolved');
    expect(result.candidates[1]!.required_roles.some((r) => r.id === 'charging.shore')).toBe(true);
  });
  it.each([24, 12])(
    'vehicle %i V retains controlled charging with conversion only for unlike house voltage',
    (v) => {
      const req = input([dc('a')]);
      const c = generateArchitectures({
        ...req,
        requirements: {
          ...req.requirements,
          charging_sources: [
            {
              id: 'vehicle',
              kind: 'vehicle',
              domain: { kind: 'dc', nominal_voltage_v: v },
              required_output_power_w: 100,
            },
          ],
        },
      }).candidates[0]!;
      const role = c.required_roles.find((r) => r.id === 'charging.vehicle')!;
      expect(role.constraints).toContainEqual(
        expect.objectContaining({ kind: 'directed_power_path', capability: 'charging' }),
      );
      expect(
        role.constraints.some(
          (g) => g.kind === 'capability' && g.capability === 'dc_to_dc_conversion',
        ),
      ).toBe(v !== 24);
      expect(c.decisions).toContainEqual(
        expect.objectContaining({
          code: v === 24 ? 'same_voltage_charging_function' : 'source_to_house_voltage_conversion',
        }),
      );
    },
  );
  it('contradictory AC vehicle input stays blocked without a fabricated DC conversion decision', () => {
    const req = input([dc('a')]);
    const c = generateArchitectures({
      ...req,
      requirements: {
        ...req.requirements,
        charging_sources: [
          {
            id: 'vehicle',
            kind: 'vehicle',
            domain: { kind: 'ac', nominal_voltage_v: 120, frequency_hz: 60 },
            required_output_power_w: 100,
          },
        ],
      },
    }).candidates[0]!;
    expect(c.structural_evaluation.status).toBe('blocked');
    expect(
      c.required_roles
        .find((r) => r.id === 'charging.vehicle')!
        .constraints.some((g) => g.kind === 'capability' && g.capability === 'dc_to_dc_conversion'),
    ).toBe(false);
    for (const ref of c.required_roles.flatMap((role) =>
      role.constraints.flatMap((g) => g.provenance),
    ))
      if (ref.kind === 'generation_decision')
        expect(c.decisions.some((d) => d.id === ref.decision_id)).toBe(true);
  });
  it('64 compatible demands keep bounded linear topology and one conversion role', () => {
    const req = input(Array.from({ length: 64 }, (_, i) => dc(`d${i}`)));
    const result = generateArchitectures(req);
    expect(result.candidates).toHaveLength(1);
    expect(supplyRoles(result.candidates[0]!)).toHaveLength(1);
    expect(result.candidates[0]!.demand_endpoints).toHaveLength(64);
    expect(generateArchitectures(req)).toEqual(result);
    expect(() =>
      generateArchitectures({
        ...req,
        requirements: { ...req.requirements, loads: [...req.requirements.loads, dc('overflow')] },
      }),
    ).toThrow();
  });
  it('group identity follows the domain boundary instead of load count or power', () => {
    expect(supplyRoles(first([dc('a')]))[0]!.id).toBe(
      supplyRoles(first([dc('a', 500), dc('b')]))[0]!.id,
    );
  });
  it('version 2 portable roundtrip and exact replay retain shared endpoints and capacity', () => {
    const req = input([ac('a'), ac('b')], true);
    const result = generateArchitectures(req);
    expect(result.schema_version).toBe('2.0.0');
    expect(result.generator_revision).toBe('architecture-generation/2.0.0');
    expect(result.policy.version).toBe('2.0.0');
    expect(parseArchitectureGeneration(serializeArchitectureGeneration(result))).toEqual(result);
    expect(replayArchitectureGeneration(result, req)).toEqual(result);
    expect(() =>
      parseArchitectureGeneration(JSON.stringify({ ...result, schema_version: '1.0.0' })),
    ).toThrow();
    const { load_supply_arrangement: _arrangement, ...legacyPolicy } = architectureGenerationPolicy;
    expect(() =>
      generateArchitectures(req, legacyPolicy as typeof architectureGenerationPolicy),
    ).toThrow();
  });
  it.each(['endpoint', 'capacity'])(
    'recomputed hashes cannot authorize forged %s semantics',
    (kind) => {
      const result = generateArchitectures(input([dc('a'), dc('b')]));
      const c = result.candidates[0]!;
      if (kind === 'endpoint')
        (c.demand_endpoints[0] as { required_power_w: number }).required_power_w = 999;
      else (supplyRoles(c)[0]!.output_capacity[0] as { status: string }).status = 'specified';
      expect(() => parseArchitectureGeneration(JSON.stringify(rehash(result)))).toThrow(
        /reproduce/,
      );
    },
  );
  it('abstract evaluator rejects demand endpoints used as power sources', () => {
    const c = first([dc('a'), dc('b')]);
    const topology = {
      ...c.topology,
      edges: [
        ...c.topology.edges,
        {
          id: 'backwards',
          kind: 'wire' as const,
          from: 'demand.a',
          to: c.demand_endpoints[0]!.domain_id,
        },
      ],
    };
    expect(
      evaluateAbstractPowerTopology(topology, c.required_roles, c.demand_endpoints),
    ).toContainEqual(expect.objectContaining({ id: 'edge.backwards', status: 'blocked' }));
  });
  it('Phase 3 test-only shared witnesses retain nominal topology and unresolved shared capacity', () => {
    const c = first([dc('a'), dc('b')]);
    const witness = architectureWitness(c);
    const passport = evaluateInstalledSystem(witness.input, witness.catalog);
    expect(passport.result.status).toBe('unresolved');
    expect(passport.decisions.some((d) => d.status === 'blocked')).toBe(false);
    expect(
      passport.decisions
        .filter((d) => d.id.startsWith('edge:'))
        .every((d) => d.status === 'satisfied'),
    ).toBe(true);
    expect(passport.decisions.some((d) => d.code === 'shared_capacity_unresolved')).toBe(true);
    expect(parseEngineeringPassport(serializeEngineeringPassport(passport))).toEqual(passport);
  });
});
