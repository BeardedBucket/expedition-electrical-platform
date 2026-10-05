import { describe, expect, it } from 'vitest';
import {
  validateComponentLibraryRecord,
  type ComponentLibraryRecord,
} from '../src/component-library.js';
import { evaluateProductWitness } from '../src/product-binding-evaluation.js';
import { generateArchitectures } from '../src/architecture-generation.js';
import { bindProductSelection, evaluateProductSelection } from '../src/product-selection.js';
import {
  evaluateInstalledSystem,
  parseEngineeringPassport,
  serializeEngineeringPassport,
  replayEngineeringPassport,
} from '../src/engineering-passport.js';
import { batteryProduct, converterProduct, selectionRequest } from './fixtures/selection.js';

const exactWitness = { interfaces: { dc: 'in', output: 'out' }, paths: { supply: 'convert' } };
const pathProduct = (portIds?: readonly string[]): ComponentLibraryRecord => ({
  ...converterProduct(),
  capabilities: [
    { id: 'convert', type: 'dc_to_dc_conversion', ...(portIds ? { port_ids: portIds } : {}) },
  ],
});

describe('capability participant authority', () => {
  it.each([{ ids: ['in', 'out'] }, { ids: undefined }])(
    'accepts consistent participants or an exact path: $ids',
    ({ ids }) => {
      const product = pathProduct(ids);
      expect(validateComponentLibraryRecord(product).ok).toBe(true);
      expect(
        evaluateProductSelection(selectionRequest([product])).roles[0]!.candidates[0]!.status,
      ).toBe('ELIGIBLE');
      expect(product.capabilities![0]!.port_ids).toEqual(ids);
    },
  );
  it.each([['in'], ['out'], []])('rejects excluded path endpoints: %s', (...ids) => {
    const product = pathProduct(ids);
    expect(validateComponentLibraryRecord(product).ok).toBe(false);
    const input = selectionRequest([product]);
    expect(() => evaluateProductSelection(input)).toThrow(
      /participants contradict|fewer than 1 items/,
    );
    const architecture = input.generation.candidates[0]!;
    // Exercise the interpreter without the canonical admission boundary as well.
    const binding = evaluateProductWitness(
      architecture,
      architecture.required_roles[0]!,
      product,
      exactWitness,
    );
    expect(binding.status).toBe('BLOCKED');
    expect(binding.gates.find((g) => g.constraint.kind === 'directed_power_path')!.truth).toBe(
      'NO',
    );
  });
  it('does not infer storage participants when there is no exact canonical association', () => {
    const product = {
      ...batteryProduct(),
      capabilities: [{ id: 'store', type: 'energy_storage' as const }],
    };
    const role = evaluateProductSelection(selectionRequest([product], false, true)).roles.find(
      (r) => r.role.function === 'storage',
    )!;
    expect(role.candidates.every((c) => c.status !== 'ELIGIBLE')).toBe(true);
    expect(
      role.candidates
        .flatMap((c) => c.bindings)
        .some((b) =>
          b.gates.some((g) => g.constraint.kind === 'capability' && g.truth === 'UNKNOWN'),
        ),
    ).toBe(true);
  });
  it('still rejects dangling participants and positive/negative conflicts', () => {
    expect(validateComponentLibraryRecord(pathProduct(['in', 'out', 'absent'])).ok).toBe(false);
    expect(
      validateComponentLibraryRecord({
        ...pathProduct(['in', 'out']),
        unsupported_capabilities: ['dc_to_dc_conversion'],
      }).ok,
    ).toBe(false);
  });
  it('rejects unrelated real participants instead of letting a path override them', () => {
    const product = {
      ...pathProduct(['other-in', 'other-out']),
      ports: [
        ...converterProduct().ports!,
        { id: 'other-in', domain: 'dc' as const, direction: 'input' as const },
        { id: 'other-out', domain: 'dc' as const, direction: 'output' as const },
      ],
    };
    const validation = validateComponentLibraryRecord(product);
    expect(validation.ok).toBe(false);
    if (!validation.ok)
      expect(validation.errors).toContain(
        'power_paths.convert: participants contradict capabilities.convert.port_ids.',
      );
    const input = selectionRequest([product]);
    const architecture = input.generation.candidates[0]!;
    expect(
      evaluateProductWitness(architecture, architecture.required_roles[0]!, product, exactWitness)
        .status,
    ).toBe('BLOCKED');
  });
});

const alternatives = (unknownPower: boolean): ComponentLibraryRecord => ({
  ...pathProduct(['in', 'out', 'bad-out']),
  ports: [
    converterProduct().ports![0]!,
    {
      id: 'out',
      domain: 'dc',
      direction: 'output',
      voltage_v: 12,
      ...(unknownPower ? {} : { power_w: 500 }),
    },
    { id: 'bad-out', domain: 'dc', direction: 'output', voltage_v: 48, power_w: 500 },
  ],
  power_paths: [
    ...converterProduct().power_paths!,
    {
      id: 'bad-path',
      capability_id: 'convert',
      from_port: 'in',
      to_port: 'bad-out',
      isolated: true,
    },
  ],
});
const selectOutput = (unknownPower: boolean, output: string) => {
  const selection = evaluateProductSelection(selectionRequest([alternatives(unknownPower)]));
  const role = selection.roles[0]!;
  const product = role.candidates[0]!;
  const binding = product.bindings.find(
    (b) => b.witness.interfaces.dc === 'in' && b.witness.interfaces.output === output,
  )!;
  const handoff = bindProductSelection(selection, [
    { role_id: role.role.id, component_id: product.component_id, binding_id: binding.id },
  ]);
  return { selection, role, product, binding, ...handoff };
};

describe('selected witness provenance', () => {
  it('retains only the selected unresolved witness reasons and exact identity', () => {
    const { role, product, binding, input, catalog } = selectOutput(true, 'out');
    expect(binding.status).toBe('UNRESOLVED');
    expect(product.bindings.some((b) => b.status === 'BLOCKED')).toBe(true);
    expect(product.reasons).toContain('engineering_mismatch');
    expect(product.reasons).toContain('requirement_supported');
    const condition = input.requirements.mandatory_conditions!.find((c) => c.id === role.role.id)!;
    expect(condition).toMatchObject({
      subject_id: binding.id,
      status: 'unresolved',
      reason_codes: ['fact_missing'],
    });
    const passport = evaluateInstalledSystem(input, catalog);
    expect(passport.decisions.find((d) => d.id === `inherited:${role.role.id}`)!.inputs).toEqual(
      condition,
    );
  });
  it('preserves a selected blocker even when the model has an eligible witness', () => {
    const { role, product, binding, input, catalog } = selectOutput(false, 'bad-out');
    expect(product.status).toBe('ELIGIBLE');
    expect(binding.status).toBe('BLOCKED');
    expect(
      input.requirements.mandatory_conditions!.find((c) => c.id === role.role.id),
    ).toMatchObject({
      subject_id: binding.id,
      status: 'blocked',
      reason_codes: ['engineering_mismatch'],
    });
    expect(evaluateInstalledSystem(input, catalog).result.status).toBe('blocked');
  });
  it('retains a required upstream dependency even when all selected gates are YES', () => {
    const selection = evaluateProductSelection(selectionRequest(undefined, true));
    const role = selection.roles[0]!;
    const binding = role.candidates[0]!.bindings.find((b) =>
      b.gates.every((g) => g.truth === 'YES'),
    )!;
    const { input } = bindProductSelection(selection, [
      {
        role_id: role.role.id,
        component_id: role.candidates[0]!.component_id,
        binding_id: binding.id,
      },
    ]);
    expect(
      input.requirements.mandatory_conditions!.find((c) => c.id === role.role.id)!.reason_codes,
    ).toEqual(['upstream_requirement_unresolved']);
  });
  it('includes only selected non-YES assembly gates', () => {
    const { allowed_parallel_count: _permission, ...battery } = batteryProduct().battery!;
    const selection = evaluateProductSelection(
      selectionRequest([converterProduct(), { ...batteryProduct(), battery }], false, true),
    );
    const choices = selection.roles.map((r) => {
      const product = r.candidates.find((c) =>
        r.role.function === 'storage'
          ? c.assembly?.series_count === 2 && c.assembly.parallel_count === 2
          : c.status === 'ELIGIBLE',
      )!;
      const binding = product.bindings.find((b) => b.status !== 'BLOCKED')!;
      return {
        role_id: r.role.id,
        component_id: product.component_id,
        binding_id: binding.id,
        ...(product.assembly ? { assembly: product.assembly } : {}),
      };
    });
    const { input } = bindProductSelection(selection, choices);
    const storageRole = selection.roles.find((r) => r.role.function === 'storage')!;
    expect(
      input.requirements.mandatory_conditions!.find((c) => c.id === storageRole.role.id)!
        .reason_codes,
    ).toEqual(['assembly_permission_unknown']);
  });
});

const requirementHandoff = () => {
  const original = selectionRequest();
  const assumptions = [
    {
      id: 'genuine',
      origin: 'user' as const,
      statement: 'Genuine upstream assumption, independent of the explicit load.',
    },
  ];
  const generation = generateArchitectures({
    ...original.generation.input,
    assumptions,
    requirements: {
      ...original.generation.input.requirements,
      loads: original.generation.input.requirements.loads.map((l) => ({
        ...l,
        schedule: [{ state: 'active', duration_hours: 1 }],
      })),
    },
  });
  const selection = evaluateProductSelection({
    ...original,
    generation,
    candidate_id: generation.candidates[0]!.id,
  });
  const role = selection.roles[0]!;
  const binding = role.candidates[0]!.bindings.find((b) => b.status === 'ELIGIBLE')!;
  return {
    assumptions,
    ...bindProductSelection(
      selection,
      [
        {
          role_id: role.role.id,
          component_id: role.candidates[0]!.component_id,
          binding_id: binding.id,
        },
      ],
      { evaluation_hours: 1 },
    ),
  };
};

describe('direct requirement provenance', () => {
  it('preserves requirements and genuine assumptions through portable passport replay', () => {
    const { assumptions, input, catalog } = requirementHandoff();
    expect(input.assumptions).toEqual(assumptions);
    expect(input.requirements.project_demands![0]!.provenance).toEqual({
      requirement_id: 'load',
      pointer: '/requirements/loads/0',
    });
    const passport = evaluateInstalledSystem(input, catalog);
    const decision = passport.decisions.find((d) => d.code === 'project_owned_demand')!;
    const calculation = passport.calculations.find((c) =>
      c.formula.startsWith('energyWh = explicitProjectPowerW'),
    )!;
    expect(decision.assumption_ids).toEqual([]);
    expect(decision.evidence_refs).toEqual([]);
    expect(calculation.assumption_ids).toEqual([]);
    expect(calculation.evidence_refs).toEqual([]);
    expect(calculation.inputs).toMatchObject({
      provenance: input.requirements.project_demands![0]!.provenance,
    });
    const restored = parseEngineeringPassport(serializeEngineeringPassport(passport));
    expect(restored).toEqual(passport);
    expect(restored.decisions.find((d) => d.code === 'project_owned_demand')!.inputs).toEqual(
      input.requirements.project_demands![0],
    );
    expect(replayEngineeringPassport(restored, catalog).ok).toBe(true);
  });
  it('preserves genuine cited assumption dependencies without generating new ones', () => {
    const { input, catalog } = requirementHandoff();
    const demand = input.requirements.project_demands![0]!;
    const passport = evaluateInstalledSystem(
      {
        ...input,
        requirements: {
          ...input.requirements,
          project_demands: [
            { ...demand, provenance: { ...demand.provenance, assumption_ids: ['genuine'] } },
          ],
        },
      },
      catalog,
    );
    expect(
      passport.decisions.find((d) => d.code === 'project_owned_demand')!.assumption_ids,
    ).toEqual(['genuine']);
    expect(
      passport.calculations.find((c) => c.formula.startsWith('energyWh = explicitProjectPowerW'))!
        .assumption_ids,
    ).toEqual(['genuine']);
  });
  it.each(['requirement_id', 'pointer'] as const)('rejects absent direct %s provenance', (key) => {
    const { input, catalog } = requirementHandoff();
    const altered = JSON.parse(JSON.stringify(input));
    delete altered.requirements.project_demands[0].provenance[key];
    expect(() => evaluateInstalledSystem(altered, catalog)).toThrow();
  });
  it('keeps a missing horizon unknown and rejects project demand as a source', () => {
    const { input, catalog } = requirementHandoff();
    const { evaluation_hours: _horizon, ...requirements } = input.requirements;
    const passport = evaluateInstalledSystem({ ...input, requirements }, catalog);
    expect(passport.result.energy.unresolved_contributions).toContainEqual({
      kind: 'project_demand',
      demand_id: requirements.project_demands![0]!.id,
      reasons: ['horizon_unknown'],
    });
    const demand = requirements.project_demands![0]!;
    const edges = input.architecture.power_topology!.edges.map((e) =>
      e.kind === 'wire' ? { ...e, from: demand.id } : e,
    );
    const sourced = evaluateInstalledSystem(
      {
        ...input,
        architecture: {
          ...input.architecture,
          power_topology: { ...input.architecture.power_topology!, edges },
        },
      },
      catalog,
    );
    expect(sourced.result.status).toBe('blocked');
  });
});

describe('unambiguous assembly intent admission', () => {
  const setup = () => {
    const input = selectionRequest([batteryProduct()], false, true);
    const role = input.generation.candidates[0]!.required_roles.find(
      (r) => r.function === 'storage',
    )!;
    const assembly = {
      role_id: role.id,
      kind: 'homogeneous' as const,
      component_id: batteryProduct().id,
      series_count: 2,
      parallel_count: 2,
    };
    return { input, role, assembly };
  };
  it.each([true, false])('rejects fixed plus standalone intent, same counts = %s', (sameCounts) => {
    const { input, role, assembly } = setup();
    const { role_id: _role, ...counts } = assembly;
    expect(() =>
      evaluateProductSelection({
        ...input,
        fixed_existing: [
          { role_id: role.id, component_id: assembly.component_id, assembly: counts },
        ],
        assemblies: [{ ...assembly, parallel_count: sameCounts ? 2 : 3 }],
      }),
    ).toThrow(/fixed role/);
  });
  it('rejects duplicate explicit intent even when object key order differs', () => {
    const { input, assembly } = setup();
    expect(() =>
      evaluateProductSelection({
        ...input,
        assemblies: [
          assembly,
          {
            parallel_count: 2,
            series_count: 2,
            component_id: assembly.component_id,
            kind: 'homogeneous',
            role_id: assembly.role_id,
          },
        ],
      }),
    ).toThrow(/Duplicate explicit assembly/);
  });
  it('retains different count alternatives and reuses a matching generated candidate', () => {
    const { input, role, assembly } = setup();
    const result = evaluateProductSelection({
      ...input,
      assemblies: [assembly, { ...assembly, parallel_count: 3 }],
    });
    const candidates = result.roles
      .find((r) => r.role.id === role.id)!
      .candidates.filter((c) => c.assembly);
    expect(candidates.map((c) => c.assembly!.parallel_count).sort()).toEqual([2, 3]);
    expect(result.input.assemblies).toHaveLength(2);
  });
  it('retains different model alternatives for a nonfixed role', () => {
    const { input, role, assembly } = setup();
    const second = { ...batteryProduct(), id: 'fixture.battery2' };
    const result = evaluateProductSelection({
      ...input,
      corpus: [...input.corpus, second],
      assemblies: [assembly, { ...assembly, component_id: second.id }],
    });
    expect(
      result.roles
        .find((r) => r.role.id === role.id)!
        .candidates.filter((c) => c.assembly)
        .map((c) => c.component_id)
        .sort(),
    ).toEqual([assembly.component_id, second.id]);
  });
});
