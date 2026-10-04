import { describe, expect, it } from 'vitest';
import {
  generateArchitectures,
  type ArchitectureGenerationInput,
} from '../src/architecture-generation.js';
import {
  evaluateProductSelection,
  bindProductSelection,
  type ProductSelectionInput,
  type SelectedRoleBinding,
} from '../src/product-selection.js';
import {
  evaluateInstalledSystem,
  serializeEngineeringPassport,
  parseEngineeringPassport,
  replayEngineeringPassport,
  type WholeSystemEvaluationInput,
} from '../src/engineering-passport.js';
import { batteryProduct, converterProduct, selectionRequest } from './fixtures/selection.js';
import type { ComponentLibraryRecord } from '../src/component-library.js';
import { productionAcceptanceComponentIds } from './fixtures/production-system.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeComponentLibraryRecord } from '../src/component-library.js';
import { parse } from 'yaml';

const multifunction = (): ComponentLibraryRecord => ({
  id: 'fixture.multifunction',
  manufacturer: 'Project fixture',
  model: 'M',
  category: 'test',
  verification_status: 'verified',
  capabilities: [
    { id: 'invert', type: 'inversion', port_ids: ['dc', 'ac-out'] },
    { id: 'charge', type: 'charging', port_ids: ['ac-in', 'dc'] },
  ],
  ports: [
    { id: 'dc', domain: 'dc', direction: 'bidirectional', voltage_v: 24, power_w: 2000 },
    { id: 'ac-in', domain: 'ac', direction: 'input', voltage_v: 230, frequency_hz: 50 },
    {
      id: 'ac-out',
      domain: 'ac',
      direction: 'output',
      voltage_v: 120,
      frequency_hz: 60,
      power_w: 2000,
    },
  ],
  power_paths: [
    { id: 'invert', capability_id: 'invert', from_port: 'dc', to_port: 'ac-out' },
    { id: 'charge', capability_id: 'charge', from_port: 'ac-in', to_port: 'dc' },
  ],
});
const acRequest = (product = multifunction(), shared = false): ProductSelectionInput => {
  const generation = generateArchitectures({
    schema_version: '2.0.0',
    assumptions: [],
    requirements: {
      id: 'fixture.ac',
      fixed_house_voltage_v: 24,
      loads: [
        {
          id: 'ac-load',
          domain: { kind: 'ac', nominal_voltage_v: 120, frequency_hz: 60 },
          required_power_w: 800,
        },
        ...(shared
          ? [
              {
                id: 'ac-load2',
                domain: { kind: 'ac' as const, nominal_voltage_v: 120, frequency_hz: 60 },
                required_power_w: 500,
              },
            ]
          : []),
      ],
      charging_sources: [
        {
          id: 'shore',
          kind: 'shore',
          domain: { kind: 'ac', nominal_voltage_v: 230, frequency_hz: 50 },
          required_output_power_w: 400,
        },
      ],
      storage: { required: false },
    },
  });
  return {
    schema_version: '1.0.0',
    generation,
    candidate_id: generation.candidates.find(
      (c) => c.choices.ac_function_arrangement === 'combined',
    )!.id,
    corpus: [product],
    fixed_existing: [],
    assemblies: [],
  };
};
describe('multifunction and real-record selection', () => {
  it('requires one complete combined binding, with distinct AC contexts and paths', () => {
    const r = evaluateProductSelection(acRequest());
    expect(r.roles).toHaveLength(1);
    const c = r.roles[0]!.candidates[0]!;
    expect(c.status).toBe('ELIGIBLE');
    const b = c.bindings.find((b) => b.status === 'ELIGIBLE')!;
    expect(Object.values(b.witness.interfaces).sort()).toEqual(['ac-in', 'ac-out', 'dc']);
    expect(Object.values(b.witness.paths).sort()).toEqual(['charge', 'invert']);
  });
  it.each([
    'wrong_frequency',
    'missing_frequency',
    'unrelated_charging_path',
    'missing_charging_path',
  ] as const)('combined %s cannot pass', (mode) => {
    const p = multifunction();
    const ports = p.ports!.map((port) =>
      mode === 'wrong_frequency' && port.id === 'ac-out'
        ? { ...port, frequency_hz: 50 }
        : mode === 'missing_frequency' && port.id === 'ac-out'
          ? {
              id: port.id,
              domain: port.domain,
              direction: port.direction,
              voltage_v: port.voltage_v,
              power_w: port.power_w,
            }
          : port,
    );
    const power_paths =
      mode === 'missing_charging_path'
        ? p.power_paths!.slice(0, 1)
        : mode === 'unrelated_charging_path'
          ? [p.power_paths![0]!, { ...p.power_paths![1]!, from_port: 'ac-out' }]
          : p.power_paths;
    // A canonical path from an output-only port is invalid independently of selection.
    const canonicalPorts =
      mode === 'unrelated_charging_path'
        ? ports.map((port) =>
            port.id === 'ac-out' ? { ...port, direction: 'bidirectional' as const } : port,
          )
        : ports;
    // Keep this negative fixture internally consistent: it tests an unrelated
    // charging path, whereas contradictory participant lists reject at admission.
    const capabilities =
      mode === 'unrelated_charging_path'
        ? p.capabilities!.map((c) => (c.id === 'charge' ? { ...c, port_ids: ['ac-out', 'dc'] } : c))
        : p.capabilities;
    expect(
      evaluateProductSelection(
        acRequest({ ...p, ports: canonicalPorts, power_paths, capabilities }),
      ).roles[0]!.candidates[0]!.status,
    ).not.toBe('ELIGIBLE');
  });
  it('separate roles can independently use a model, with distinct physical instances', () => {
    const request = acRequest();
    const separate = request.generation.candidates.find(
      (c) => c.choices.ac_function_arrangement === 'separate',
    )!;
    const result = evaluateProductSelection({ ...request, candidate_id: separate.id });
    expect(result.roles).toHaveLength(2);
    expect(result.roles.every((r) => r.candidates[0]!.status === 'ELIGIBLE')).toBe(true);
    const choices = result.roles.map((r) => ({
      role_id: r.role.id,
      component_id: r.candidates[0]!.component_id,
      binding_id: r.candidates[0]!.bindings.find((b) => b.status === 'ELIGIBLE')!.id,
    }));
    const bound = bindProductSelection(result, choices);
    const instances = bound.input.architecture.installation.component_instances!;
    expect(new Set(instances.map((i) => i.id)).size).toBe(2);
    expect(new Set(instances.map((i) => i.component_id)).size).toBe(1);
  });
  it('shared combined capacity remains unresolved despite passing every lower bound', () => {
    const c = evaluateProductSelection(acRequest(undefined, true)).roles[0]!.candidates[0]!;
    expect(c.status).toBe('UNRESOLVED');
    expect(c.bindings.some((b) => b.gates.every((g) => g.truth === 'YES'))).toBe(true);
  });
  it('evaluates all seven named production records without review upgrades or corpus scans', () => {
    const corpus = productionAcceptanceComponentIds.map((id) =>
      normalizeComponentLibraryRecord(
        parse(readFileSync(resolve('data/components', `${id}.yaml`), 'utf8')),
      ),
    );
    const input = selectionRequest(corpus);
    const result = evaluateProductSelection(input);
    expect(result.roles[0]!.candidates).toHaveLength(7);
    expect(result.roles[0]!.candidates.every((c) => c.status === 'UNRESOLVED')).toBe(true);
    expect(result.input.corpus.every((c) => c.verification_status === 'unverified')).toBe(true);
  });
});

const pipeline = (shared = false, missingPower = false, withheld = false) => {
  const product = {
    ...converterProduct(),
    efficiency_fraction: 1,
    electrical: { power_consumption_w: 2 },
    ports: converterProduct().ports!.map((p) => ({ ...p, current_a: 100 })),
    ...(withheld ? { verification_status: 'unverified' as const } : {}),
  };
  const original = selectionRequest([product], shared);
  const req: ArchitectureGenerationInput = {
    ...original.generation.input,
    requirements: {
      ...original.generation.input.requirements,
      loads: original.generation.input.requirements.loads.map(
        ({ requires_isolation: _isolation, required_power_w, ...l }) => ({
          ...l,
          ...(missingPower ? {} : { required_power_w }),
          schedule: [{ state: 'active', duration_hours: 1 }],
        }),
      ),
    },
  };
  const generation = generateArchitectures(req);
  const selection = evaluateProductSelection({
    ...original,
    generation,
    candidate_id: generation.candidates[0]!.id,
  });
  const choices: SelectedRoleBinding[] = selection.roles.map((r) => {
    const c = r.candidates[0]!;
    const b = c.bindings.find(
      (b) =>
        Object.values(b.witness.interfaces).includes('in') && b.witness.interfaces.output === 'out',
    )!;
    return { role_id: r.role.id, component_id: c.component_id, binding_id: b.id };
  });
  const binding = generation.candidates[0]!.topology.bindings.find((b) => b.interface_id === 'dc')!;
  const bound = bindProductSelection(selection, choices, {
    evaluation_hours: 1,
    device_states: [
      {
        id: 'device.active',
        binding_id: binding.id,
        state: 'active',
        duration_hours: 1,
        power: { kind: 'component' },
      },
    ],
  });
  return { selection, ...bound };
};
describe('Phase 4 → Phase 5 → exact Phase 3 project-owned demand', () => {
  it('proves an exact system without a synthetic appliance product', () => {
    const { input, catalog } = pipeline();
    expect(catalog).toHaveLength(1);
    expect(input.architecture.installation.component_instances).toHaveLength(1);
    expect(input.requirements.project_demands).toHaveLength(1);
    const passport = evaluateInstalledSystem(input, catalog);
    expect(passport.result.status).toBe('unresolved');
    expect(
      passport.decisions
        .filter((d) => d.status !== 'satisfied')
        .every((d) => d.code === 'inherited_mandatory_condition'),
    ).toBe(true);
    expect(passport.result.energy).toMatchObject({
      completeness: 'complete',
      total_energy_wh: 102,
    });
    expect(passport.examined_evidence.every((e) => e.component_id === converterProduct().id)).toBe(
      true,
    );
    expect(parseEngineeringPassport(serializeEngineeringPassport(passport))).toEqual(passport);
    expect(replayEngineeringPassport(passport, catalog).ok).toBe(true);
    const demandDecision = passport.decisions.find((d) => d.code === 'project_owned_demand')!;
    expect(demandDecision.assumption_ids).toEqual([]);
    expect(input.assumptions).toEqual([]);
    expect(demandDecision.evidence_refs).toEqual([]);
  });
  it.each(['shared', 'missing_power', 'withheld'] as const)(
    'cannot lose %s mandatory unresolved conditions downstream',
    (mode) => {
      const { input, catalog, selection } = pipeline(
        mode === 'shared',
        mode === 'missing_power',
        mode === 'withheld',
      );
      expect(selection.roles[0]!.candidates[0]!.status).toBe('UNRESOLVED');
      expect(input.requirements.mandatory_conditions!.length).toBeGreaterThan(0);
      const p = evaluateInstalledSystem(input, catalog);
      expect(p.result.status).toBe('unresolved');
      expect(
        p.decisions.some(
          (d) => d.code === 'inherited_mandatory_condition' && d.status === 'unresolved',
        ),
      ).toBe(true);
      if (mode === 'missing_power') {
        expect(p.result.energy.completeness).toBe('incomplete');
        expect(
          p.result.energy.unresolved_contributions.some(
            (c) => c.kind === 'project_demand' && c.reasons.includes('power_unknown'),
          ),
        ).toBe(true);
      }
    },
  );
  it.each(['schedule', 'duration', 'idle_power'] as const)(
    'unknown project %s remains incomplete',
    (mode) => {
      const { input, catalog } = pipeline();
      const d = input.requirements.project_demands![0]!;
      const demand = {
        ...d,
        ...(mode === 'schedule'
          ? { schedule: [] }
          : mode === 'duration'
            ? { schedule: [{ state: 'active' as const }] }
            : { schedule: [{ state: 'idle' as const, duration_hours: 1 }] }),
      };
      const p = evaluateInstalledSystem(
        { ...input, requirements: { ...input.requirements, project_demands: [demand] } },
        catalog,
      );
      expect(p.result.energy.completeness).toBe('incomplete');
      expect(p.result.status).toBe('unresolved');
    },
  );
  it('explicit zero project demand is resolved and preserved', () => {
    const { input, catalog } = pipeline();
    const d = input.requirements.project_demands![0]!;
    const p = evaluateInstalledSystem(
      {
        ...input,
        requirements: { ...input.requirements, project_demands: [{ ...d, required_power_w: 0 }] },
      },
      catalog,
    );
    expect(p.result.energy).toMatchObject({ completeness: 'complete', total_energy_wh: 2 });
  });
  it('unresolved inherited condition alone prevents a complete proof', () => {
    const { input, catalog } = pipeline();
    const p = evaluateInstalledSystem(
      {
        ...input,
        requirements: {
          ...input.requirements,
          mandatory_conditions: [
            {
              id: 'unknown',
              status: 'unresolved',
              subject_id: 'unknown',
              artifact_digest: 'sha256:' + '0'.repeat(64),
              reason_codes: ['upstream_requirement_unresolved'],
            },
          ],
        },
      },
      catalog,
    );
    expect(p.result.energy.completeness).toBe('complete');
    expect(p.result.status).toBe('unresolved');
  });
  it('inherited blocker remains blocked, with all other decisions retained', () => {
    const { input, catalog } = pipeline();
    const p = evaluateInstalledSystem(
      {
        ...input,
        requirements: {
          ...input.requirements,
          mandatory_conditions: [
            {
              id: 'conflict',
              status: 'blocked',
              subject_id: 'conflict',
              artifact_digest: 'sha256:' + '0'.repeat(64),
              reason_codes: ['engineering_mismatch'],
            },
          ],
        },
      },
      catalog,
    );
    expect(p.result.status).toBe('blocked');
    expect(p.decisions.some((d) => d.code === 'project_owned_demand')).toBe(true);
  });
  it.each(['missing_provenance', 'identity_collision', 'unknown_domain'] as const)(
    'rejects project %s',
    (mode) => {
      const { input, catalog } = pipeline();
      const d = input.requirements.project_demands![0]!;
      const demand = {
        ...d,
        ...(mode === 'missing_provenance'
          ? { provenance: { ...d.provenance, assumption_ids: ['absent'] } }
          : mode === 'identity_collision'
            ? { id: 'house' }
            : { domain_id: 'absent' }),
      };
      expect(() =>
        evaluateInstalledSystem(
          { ...input, requirements: { ...input.requirements, project_demands: [demand] } },
          catalog,
        ),
      ).toThrow();
    },
  );
  it('rejects upstream satisfied labels as replacement evidence', () => {
    const { input, catalog } = pipeline();
    const altered = {
      ...input,
      requirements: {
        ...input.requirements,
        mandatory_conditions: [
          {
            id: 'forged',
            status: 'satisfied',
            subject_id: 'forged',
            artifact_digest: 'sha256:' + '0'.repeat(64),
            reason_codes: [],
          },
        ],
      },
    };
    expect(() => evaluateInstalledSystem(altered as WholeSystemEvaluationInput, catalog)).toThrow(
      /schema/,
    );
  });
  it('rejects incomplete role choice and null exact witnesses', () => {
    const { selection } = pipeline();
    expect(() => bindProductSelection(selection, [])).toThrow();
    const r = evaluateProductSelection(
      selectionRequest([{ ...converterProduct(), power_paths: [] }]),
    );
    const c = r.roles[0]!.candidates[0]!;
    expect(() =>
      bindProductSelection(r, [
        {
          role_id: r.roles[0]!.role.id,
          component_id: c.component_id,
          binding_id: c.bindings[0]!.id,
        },
      ]),
    ).toThrow();
  });
  it('represents no model for requirement-only demand even when there are no roles', () => {
    const generation = generateArchitectures({
      schema_version: '2.0.0',
      assumptions: [],
      requirements: {
        id: 'native',
        fixed_house_voltage_v: 24,
        loads: [
          { id: 'demand', domain: { kind: 'dc', nominal_voltage_v: 24 }, required_power_w: 10 },
        ],
        charging_sources: [],
        storage: { required: false },
      },
    });
    const s = evaluateProductSelection({
      schema_version: '1.0.0',
      generation,
      candidate_id: generation.candidates[0]!.id,
      corpus: [],
      fixed_existing: [],
      assemblies: [],
    });
    expect(s.roles).toEqual([]);
    const b = bindProductSelection(s, []);
    expect(b.catalog).toEqual([]);
    expect(b.input.architecture.installation.component_instances).toEqual([]);
    expect(b.input.requirements.project_demands).toHaveLength(1);
    expect(evaluateInstalledSystem(b.input, b.catalog).result.status).toBe('unresolved');
  });
});

describe('selected storage assembly exact handoff', () => {
  it('reuses Phase 3 bank permission/arithmetic on the exact selected model and counts', () => {
    const corpus = [
      { ...converterProduct(), electrical: { power_consumption_w: 2 } },
      { ...batteryProduct(), electrical: { nominal_voltage_v: 12, power_consumption_w: 1 } },
    ];
    const input = selectionRequest(corpus, false, true);
    const selection = evaluateProductSelection(input);
    const choices = selection.roles.map((r) => {
      const c =
        r.role.function === 'storage'
          ? r.candidates.find((c) => c.assembly && c.status === 'ELIGIBLE')!
          : r.candidates.find((c) => c.component_id === converterProduct().id)!;
      return {
        role_id: r.role.id,
        component_id: c.component_id,
        binding_id: c.bindings.find((b) => b.status === 'ELIGIBLE')!.id,
        ...(c.assembly ? { assembly: c.assembly } : {}),
      };
    });
    const bound = bindProductSelection(selection, choices);
    const bank = bound.input.requirements.battery_banks[0]!;
    expect(bank).toMatchObject({
      series_count: 2,
      parallel_count: 2,
      required_nominal_energy_wh: 4800,
    });
    const p = evaluateInstalledSystem(bound.input, bound.catalog);
    expect(p.component_bindings).toHaveLength(2);
    expect(
      p.decisions.filter((d) => d.id.startsWith('bank:')).every((d) => d.status === 'satisfied'),
    ).toBe(true);
    expect(p.calculations.some((c) => c.id.startsWith('bank-port:') && c.output === 24)).toBe(true);
    expect(replayEngineeringPassport(p, bound.catalog).ok).toBe(true);
  });
});

describe('unresolved upstream interface design points', () => {
  it.each(['voltage', 'frequency'] as const)(
    'missing shore input %s cannot produce an eligible combined role',
    (mode) => {
      const original = acRequest();
      const generationInput = JSON.parse(
        JSON.stringify(original.generation.input),
      ) as ArchitectureGenerationInput;
      const domain = generationInput.requirements.charging_sources[0]!.domain as {
        nominal_voltage_v?: number;
        frequency_hz?: number;
      };
      if (mode === 'voltage') delete domain.nominal_voltage_v;
      else delete domain.frequency_hz;
      const generation = generateArchitectures(generationInput);
      const result = evaluateProductSelection({
        ...original,
        generation,
        candidate_id: generation.candidates.find(
          (c) => c.choices.ac_function_arrangement === 'combined',
        )!.id,
      });
      expect(result.roles[0]!.candidates[0]!.status).toBe('UNRESOLVED');
      expect(result.roles[0]!.candidates[0]!.reasons).toContain('upstream_requirement_unresolved');
    },
  );
});
