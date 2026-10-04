import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import {
  generateArchitectures,
  architectureGenerationPolicy,
  parseArchitectureGeneration,
  replayArchitectureGeneration,
  serializeArchitectureGeneration,
  type ArchitectureCandidate,
  type ArchitectureGenerationInput,
  type ArchitectureGenerationPolicy,
} from '../src/architecture-generation.js';
import { passportDigest, serializePassportValue } from '../src/portable-json.js';
import { evaluateAbstractPowerTopology } from '../src/abstract-power-evaluation.js';
import { mixedArchitectureRequirements } from './fixtures/architecture-requirements.js';
import { productionAcceptanceComponentIds } from './fixtures/production-system.js';
import { loadComponentLibraryFile } from '../src/component-library-loader.js';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fixed = (voltage = 24): ArchitectureGenerationInput => {
  const input = mixedArchitectureRequirements();
  return { ...input, requirements: { ...input.requirements, fixed_house_voltage_v: voltage } };
};
const separate = (input = fixed()) =>
  generateArchitectures(input).candidates.find(
    (candidate) => candidate.choices.ac_function_arrangement === 'separate',
  )!;
const changedLoad = (
  changes: Partial<ArchitectureGenerationInput['requirements']['loads'][number]>,
) => {
  const input = fixed();
  return {
    ...input,
    requirements: {
      ...input.requirements,
      loads: [{ ...input.requirements.loads[0]!, ...changes }],
    },
  };
};
const changedSource = (
  changes: Partial<ArchitectureGenerationInput['requirements']['charging_sources'][number]>,
) => {
  const input = fixed();
  return {
    ...input,
    requirements: {
      ...input.requirements,
      charging_sources: [{ ...input.requirements.charging_sources[0]!, ...changes }],
    },
  };
};

describe('Phase 4 deterministic abstract generation', () => {
  it('explores 12/24/48 independently of a 12 V vehicle, with six stable unranked candidates', () => {
    const input = mixedArchitectureRequirements();
    const result = generateArchitectures(input);
    expect(result.candidates.map((candidate) => candidate.choices)).toEqual(
      [12, 24, 48].flatMap((house_voltage_v) =>
        ['combined', 'separate'].map((ac_function_arrangement) => ({
          house_voltage_v,
          ac_function_arrangement,
        })),
      ),
    );
    expect(
      result.candidates.every(
        (candidate) => candidate.structural_evaluation.status === 'structurally_viable',
      ),
    ).toBe(true);
    expect(generateArchitectures(input)).toEqual(result);
    expect(new Set(result.candidates.map((candidate) => candidate.id)).size).toBe(6);
    for (const candidate of result.candidates) {
      const { candidate_digest, id, ...body } = candidate;
      expect(candidate_digest).toBe(passportDigest(body));
      expect(id).toBe(`architecture.${candidate_digest.slice(7)}`);
    }
  });

  it.each([12, 24, 48])(
    'respects fixed %i V without eliminating unlike vehicle charging',
    (voltage) => {
      const candidates = generateArchitectures(fixed(voltage)).candidates;
      expect(candidates).toHaveLength(2);
      expect(candidates.every((candidate) => candidate.choices.house_voltage_v === voltage)).toBe(
        true,
      );
      for (const candidate of candidates) {
        const role = candidate.required_roles.find((role) => role.id === 'charging.vehicle')!;
        expect(role.constraints).toContainEqual(
          expect.objectContaining({
            kind: 'directed_power_path',
            capability: 'charging',
            from_interface: 'input',
            to_interface: 'dc',
          }),
        );
        expect(role.constraints).toContainEqual(
          expect.objectContaining({
            kind: 'nominal_voltage',
            interface_id: 'input',
            voltage_v: 12,
          }),
        );
        expect(role.constraints).toContainEqual(
          expect.objectContaining({
            kind: 'nominal_voltage',
            interface_id: 'dc',
            voltage_v: voltage,
          }),
        );
      }
    },
  );

  it('keeps an explicit policy-excluded fixed voltage as a blocked visible candidate', () => {
    const result = generateArchitectures(fixed(36));
    expect(
      result.candidates.every(
        (candidate) =>
          candidate.choices.house_voltage_v === 36 &&
          candidate.structural_evaluation.status === 'blocked',
      ),
    ).toBe(true);
    expect(result.candidates[0]!.structural_evaluation.blocked_decision_ids).toContain(
      'house-voltage',
    );
  });

  it('does not insert a converter on native DC load supply, but preserves a same-voltage charging function', () => {
    const candidate = separate(fixed(12));
    expect(
      candidate.required_roles.some((role) =>
        role.output_capacity.some((capacity) =>
          capacity.demand_endpoint_ids.includes('demand.low12'),
        ),
      ),
    ).toBe(false);
    expect(candidate.required_roles.some((role) => role.id === 'charging.vehicle')).toBe(true);
    expect(
      candidate.topology.routes.find((route) => route.id === 'supply.low12')!.edge_ids,
    ).toHaveLength(2);
  });

  it.each([
    [24, 'low12', 12],
    [48, 'low12', 12],
    [48, 'native24', 24],
    [12, 'native24', 24],
  ] as const)('explicitly converts %i V house to %s at %i V', (voltage, loadId, loadVoltage) => {
    const role = separate(fixed(voltage)).required_roles.find((role) =>
      role.output_capacity.some((capacity) =>
        capacity.demand_endpoint_ids.includes(`demand.${loadId}`),
      ),
    )!;
    expect(role.constraints).toContainEqual(
      expect.objectContaining({ kind: 'capability', capability: 'dc_to_dc_conversion' }),
    );
    expect(role.constraints).toContainEqual(
      expect.objectContaining({ kind: 'nominal_voltage', interface_id: 'dc', voltage_v: voltage }),
    );
    expect(role.constraints).toContainEqual(
      expect.objectContaining({
        kind: 'nominal_voltage',
        interface_id: 'output',
        voltage_v: loadVoltage,
      }),
    );
  });

  it('requires explicit inversion, output-side demand and distinct shore charging interfaces', () => {
    const candidate = separate();
    const inverter = candidate.required_roles.find((role) => role.function === 'inverter')!;
    expect(inverter.constraints).toContainEqual(
      expect.objectContaining({ kind: 'capability', capability: 'inversion' }),
    );
    expect(inverter.constraints).toContainEqual(
      expect.objectContaining({
        kind: 'minimum_output_power',
        interface_id: 'output',
        power_w: 800,
      }),
    );
    expect(inverter.constraints).toContainEqual(
      expect.objectContaining({ kind: 'ac_frequency', interface_id: 'output', frequency_hz: 60 }),
    );
    const charger = candidate.required_roles.find((role) => role.id === 'charging.shore')!;
    expect(charger.constraints).toContainEqual(
      expect.objectContaining({ kind: 'capability', capability: 'charging' }),
    );
    expect(charger.constraints).toContainEqual(
      expect.objectContaining({ kind: 'ac_frequency', interface_id: 'input', frequency_hz: 50 }),
    );
    expect(candidate.topology.routes).toContainEqual(
      expect.objectContaining({ id: 'charge.shore', from: 'domain.source.shore', to: 'house' }),
    );
    expect(serializePassportValue(candidate.required_roles)).not.toMatch(
      /efficiency|input_current_a|series_count|parallel_count/,
    );
  });

  it('represents combined and separate functional alternatives, without assuming shared AC interfaces', () => {
    const result = generateArchitectures(fixed());
    const combined = result.candidates.find(
      (candidate) => candidate.choices.ac_function_arrangement === 'combined',
    )!;
    const role = combined.required_roles.find((role) => role.function === 'inverter_charger')!;
    expect(role.binding_scope).toBe('single_device');
    expect(
      role.constraints
        .filter((c) => c.kind === 'directed_power_path')
        .map((c) => c.capability)
        .sort(),
    ).toEqual(['charging', 'inversion']);
    expect(role.constraints.filter((c) => c.kind === 'interface')).toHaveLength(3);
    expect(role.constraints).toContainEqual(
      expect.objectContaining({
        kind: 'distinct_interfaces',
        interface_ids: ['input', 'output', 'dc'],
      }),
    );
    expect(role.constraints).toContainEqual(
      expect.objectContaining({ kind: 'nominal_voltage', interface_id: 'input', voltage_v: 230 }),
    );
    expect(role.constraints).toContainEqual(
      expect.objectContaining({ kind: 'nominal_voltage', interface_id: 'output', voltage_v: 120 }),
    );
    expect(combined.required_roles.some((role) => role.id === 'charging.shore')).toBe(false);
    expect(
      separate().required_roles.filter(
        (role) => role.function === 'inverter' || role.id === 'charging.shore',
      ),
    ).toHaveLength(2);
  });

  it('solar retains PV context on nominal equality with house and needs a solar conversion path', () => {
    const candidate = separate(
      changedSource({ kind: 'solar', domain: { kind: 'pv_dc', nominal_voltage_v: 24 } }),
    );
    expect(candidate.structural_evaluation.status).toBe('structurally_viable');
    expect(candidate.topology.domains).toContainEqual({
      id: 'domain.source.vehicle',
      kind: 'pv_dc',
      nominal_voltage_v: 24,
    });
    expect(
      candidate.required_roles.find((role) => role.function === 'solar_charge_control')!
        .constraints,
    ).toContainEqual(
      expect.objectContaining({
        kind: 'directed_power_path',
        capability: 'solar_energy_conversion',
      }),
    );
  });

  it('storage stays abstract and copies only explicitly requested nominal energy', () => {
    const candidate = separate();
    const storage = candidate.required_roles.find((role) => role.function === 'storage')!;
    expect(storage.binding_scope).toBe('storage_assembly');
    expect(storage.constraints).toContainEqual(
      expect.objectContaining({ kind: 'minimum_nominal_storage_energy', energy_wh: 2400 }),
    );
    expect(storage.constraints).toContainEqual(
      expect.objectContaining({ kind: 'nominal_voltage', interface_id: 'dc', voltage_v: 24 }),
    );
    expect(serializePassportValue(candidate)).not.toMatch(
      /component_id|manufacturer|series_count|parallel_count|usable_fraction|recommended|price|builder/,
    );
  });

  it('can generate with no corpus, a real tracked corpus, changed manufacturers and lost/gained records', async () => {
    const realCatalog = [];
    for (const id of productionAcceptanceComponentIds) {
      const loaded = await loadComponentLibraryFile(resolve('data/components', `${id}.yaml`));
      if (!loaded.ok) throw new Error(loaded.errors.join('; '));
      realCatalog.push(loaded.value);
    }
    const catalogs = [
      [],
      realCatalog,
      [...realCatalog].reverse(),
      realCatalog.slice(0, 1),
      realCatalog.map((record) => ({ ...record, manufacturer: 'Different test manufacturer' })),
      [...realCatalog, ...realCatalog],
    ];
    const artifacts = catalogs.map((catalog) => {
      // Corpus belongs to the future caller; Phase 4 has no argument or ambient
      // loader through which any membership or evidence can enter generation.
      expect(Array.isArray(catalog)).toBe(true);
      return serializeArchitectureGeneration(
        generateArchitectures(mixedArchitectureRequirements()),
      );
    });
    expect(new Set(artifacts).size).toBe(1);
    expect(
      JSON.parse(artifacts[0]!).candidates.every(
        (candidate: ArchitectureCandidate) =>
          candidate.structural_evaluation.status === 'structurally_viable',
      ),
    ).toBe(true);
  });

  it('its transitive runtime graph cannot load corpus, ingestion, overlays or recommendation logic', () => {
    const visited = new Set<string>();
    const walk = (file: string): void => {
      if (visited.has(file)) return;
      visited.add(file);
      const source = readFileSync(file, 'utf8');
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const imports = parsed.statements.flatMap((statement) => {
        if (
          ts.isImportDeclaration(statement) &&
          !statement.importClause?.isTypeOnly &&
          ts.isStringLiteral(statement.moduleSpecifier)
        )
          return [statement.moduleSpecifier.text];
        if (
          ts.isExportDeclaration(statement) &&
          !statement.isTypeOnly &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        )
          return [statement.moduleSpecifier.text];
        return [];
      });
      for (const specifier of imports) {
        expect(specifier).not.toMatch(
          /component-library|installed-system-context|ingestion|advisory|builder-overlay|recommendation|orchestrator|node:fs|node:http|components\//,
        );
        if (specifier.startsWith('.') && specifier.endsWith('.js'))
          walk(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
      }
    };
    walk(resolve('packages/engineering-core/src/architecture-generation.ts'));
    expect(visited.size).toBeGreaterThan(4);
    expect(readFileSync(resolve('packages/engineering-core/src/index.ts'), 'utf8')).not.toContain(
      'architecture-generation',
    );
  });

  it.each(['catalog', 'components', 'manufacturer', 'builder', 'prices', 'preferred_voltage_v'])(
    'rejects injected %s authority at input boundary',
    (key) => {
      expect(() =>
        generateArchitectures({ ...fixed(), [key]: [] } as ArchitectureGenerationInput),
      ).toThrow(/schema rejected/);
      expect(() =>
        generateArchitectures({
          ...fixed(),
          requirements: { ...fixed().requirements, [key]: [] },
        } as ArchitectureGenerationInput),
      ).toThrow(/schema rejected/);
    },
  );

  it('each constraint and route retains resolvable exact input/decision provenance', () => {
    const result = generateArchitectures(mixedArchitectureRequirements());
    for (const candidate of result.candidates)
      for (const constraint of [
        ...candidate.required_roles.flatMap((role) => role.constraints),
        ...candidate.topology.routes,
      ]) {
        expect(constraint.provenance.length).toBeGreaterThan(0);
        for (const ref of constraint.provenance) {
          if (ref.kind === 'generation_decision')
            expect(candidate.decisions.some((decision) => decision.id === ref.decision_id)).toBe(
              true,
            );
          else {
            const value = ref.pointer
              .split('/')
              .slice(1)
              .reduce(
                (value, key) => (value as Record<string, unknown>)?.[key],
                result.input as unknown,
              );
            expect(value).not.toBeUndefined();
          }
        }
      }
  });

  it('traces major choices with policy identity and preserves draft lifecycle separate from viability', () => {
    const result = generateArchitectures(fixed());
    for (const candidate of result.candidates) {
      expect(candidate.decisions.map((decision) => decision.code)).toEqual(
        expect.arrayContaining([
          'house_voltage_choice',
          'ac_function_arrangement',
          'abstract_storage_required',
          'inversion_required',
          'vehicle_charging_boundary',
          'solar_context_and_conversion',
          'ac_charging_required',
        ]),
      );
      expect(
        candidate.decisions.every(
          (decision) =>
            decision.policy_revision === result.policy.version &&
            decision.policy_id === result.policy.id,
        ),
      ).toBe(true);
      expect(candidate.structural_evaluation).toMatchObject({
        assertion_scope: 'abstract-nominal-topology-and-role-requirements',
        product_binding: 'not_evaluated',
        installation_safety: 'not_evaluated',
        policy_lifecycle_status: 'draft',
      });
    }
    expect(result.warnings).toContain('generation_policy_requires_human_review');
    expect(result.filter_semantics).toEqual({
      supported_outcomes: ['eligible', 'blocked', 'unresolved'],
      aggregation: 'any_blocked_else_any_unresolved_else_eligible',
      order_affects_authority: false,
    });
  });
});

describe('unknowns, contradictions and bounded generation', () => {
  it('unknown DC load voltage does not assert that a conversion capability is necessary', () => {
    const candidate = separate(changedLoad({ domain: { kind: 'dc' } }));
    expect(candidate.structural_evaluation.status).toBe('unresolved');
    expect(candidate.required_roles.some((role) => role.function === 'dc_conversion')).toBe(false);
    expect(candidate.decisions).toContainEqual(
      expect.objectContaining({ code: 'load_domain_voltage_unknown', status: 'unresolved' }),
    );
    expect(
      candidate.required_roles
        .find((role) => role.function === 'storage')!
        .constraints.some((c) => c.kind === 'minimum_output_power'),
    ).toBe(false);
  });
  it.each([
    ['source voltage', () => changedSource({ domain: { kind: 'dc' } })],
    ['load voltage', () => changedLoad({ domain: { kind: 'dc' } })],
    ['shore voltage and frequency', () => changedSource({ kind: 'shore', domain: { kind: 'ac' } })],
    ['AC frequency', () => changedLoad({ domain: { kind: 'ac', nominal_voltage_v: 120 } })],
  ] as const)('keeps missing %s unknown and candidates visible', (_name, makeInput) => {
    const result = generateArchitectures(makeInput());
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(
      result.candidates.every(
        (candidate) => candidate.structural_evaluation.status === 'unresolved',
      ),
    ).toBe(true);
    expect(result.input).toEqual(makeInput());
  });
  it('missing load and charge power never produce zero-valued or fabricated numeric gates', () => {
    const input = changedLoad({ id: 'unknown', domain: { kind: 'dc', nominal_voltage_v: 12 } });
    const load = { id: 'unknown', domain: { kind: 'dc' as const, nominal_voltage_v: 12 } };
    const source = {
      id: 'vehicle',
      kind: 'vehicle' as const,
      domain: { kind: 'dc' as const, nominal_voltage_v: 12 },
    };
    const candidate = separate({
      ...input,
      requirements: { ...input.requirements, loads: [load], charging_sources: [source] },
    });
    expect(candidate.structural_evaluation.status).toBe('unresolved');
    expect(
      candidate.required_roles
        .flatMap((role) => role.constraints)
        .some((c) => c.kind === 'minimum_output_power'),
    ).toBe(false);
    expect(candidate.decisions.map((d) => d.code)).toContain('output_power_requirement_unknown');
  });
  it('explicit zero power and zero nominal energy remain explicit values', () => {
    const input = changedLoad({
      required_power_w: 0,
      domain: { kind: 'dc', nominal_voltage_v: 12 },
    });
    const candidate = separate({
      ...input,
      requirements: {
        ...input.requirements,
        storage: { required: true, minimum_nominal_energy_wh: 0 },
      },
    });
    expect(candidate.required_roles.flatMap((role) => role.constraints)).toContainEqual(
      expect.objectContaining({ kind: 'minimum_output_power', power_w: 0 }),
    );
    expect(candidate.required_roles.flatMap((role) => role.constraints)).toContainEqual(
      expect.objectContaining({ kind: 'minimum_nominal_storage_energy', energy_wh: 0 }),
    );
    expect(candidate.structural_evaluation.status).toBe('structurally_viable');
  });
  it.each([
    'bonding',
    'protection',
    'distribution',
    'switching',
    'environment',
    'installation',
    'source_availability',
  ] as const)('retains unsupported %s requests unresolved and creates no invented role', (kind) => {
    const input = fixed();
    const candidate = separate({
      ...input,
      requirements: {
        ...input.requirements,
        unsupported_requirements: [
          { id: 'ground', kind, statement: 'Ground chassis earth at installation' },
        ],
      },
    });
    expect(candidate.structural_evaluation.status).toBe('unresolved');
    expect(candidate.decisions).toContainEqual(
      expect.objectContaining({ code: `${kind}_unmodeled`, status: 'unresolved' }),
    );
    expect(candidate.required_roles).toEqual(separate().required_roles);
  });
  it('retains requested isolation gate without claiming system isolation is established', () => {
    const candidate = separate(changedLoad({ requires_isolation: true }));
    expect(candidate.structural_evaluation.status).toBe('unresolved');
    expect(candidate.required_roles.flatMap((role) => role.constraints)).toContainEqual(
      expect.objectContaining({ kind: 'isolation', required: true }),
    );
  });
  it('preserves missing storage, missing capacity and autonomy as unknown rather than numeric defaults', () => {
    const { storage: _storage, ...requirements } = fixed().requirements;
    const missing = separate({ ...fixed(), requirements });
    expect(missing.structural_evaluation.status).toBe('unresolved');
    expect(missing.required_roles.some((role) => role.function === 'storage')).toBe(false);
    const input = fixed();
    const unsized = separate({
      ...input,
      requirements: { ...input.requirements, storage: { required: true } },
    });
    expect(unsized.structural_evaluation.status).toBe('unresolved');
    expect(
      unsized.required_roles
        .flatMap((role) => role.constraints)
        .some((c) => c.kind === 'minimum_nominal_storage_energy'),
    ).toBe(false);
    const autonomy = separate({
      ...input,
      requirements: {
        ...input.requirements,
        storage: { ...input.requirements.storage!, desired_autonomy_hours: 24 },
      },
    });
    expect(autonomy.decisions).toContainEqual(
      expect.objectContaining({ code: 'autonomy_unmodeled', status: 'unresolved' }),
    );
  });
  it('blocks explicit storage contradictions but keeps storage-free operation unresolved', () => {
    const input = fixed();
    expect(
      separate({
        ...input,
        requirements: {
          ...input.requirements,
          storage: { required: false, minimum_nominal_energy_wh: 100 },
        },
      }).structural_evaluation.status,
    ).toBe('blocked');
    expect(
      separate({ ...input, requirements: { ...input.requirements, storage: { required: false } } })
        .structural_evaluation.status,
    ).toBe('unresolved');
  });
  it('preserves schedule input and leaves energy interpretation unresolved', () => {
    const candidate = separate(
      changedLoad({
        schedule: [{ state: 'active', duration_hours: 10, power_w: 120 }, { state: 'idle' }],
      }),
    );
    expect(candidate.decisions).toContainEqual(
      expect.objectContaining({ code: 'schedule_energy_unmodeled', status: 'unresolved' }),
    );
  });
  it('text assumptions never fill missing numbers and are never mislabeled as used', () => {
    const input = changedSource({ domain: { kind: 'dc' } });
    const result = generateArchitectures({
      ...input,
      assumptions: [{ id: 'guess', origin: 'user', statement: 'Maybe vehicle is 12 V' }],
    });
    expect(
      result.candidates.every(
        (candidate) =>
          candidate.structural_evaluation.status === 'unresolved' &&
          candidate.used_assumption_ids.length === 0,
      ),
    ).toBe(true);
    expect(result.input.assumptions).toHaveLength(1);
    expect(result.warnings).toContain('text_assumptions_preserved_without_interpretation');
  });
  it('blocks wrong source context and DC frequency instead of treating known contradiction as missing', () => {
    expect(
      separate(changedSource({ kind: 'solar', domain: { kind: 'dc', nominal_voltage_v: 24 } }))
        .structural_evaluation.status,
    ).toBe('blocked');
    expect(
      separate(changedLoad({ domain: { kind: 'dc', nominal_voltage_v: 24, frequency_hz: 60 } }))
        .structural_evaluation.status,
    ).toBe('blocked');
  });
  it('policy can prohibit required DC load conversion with a visible blocked result', () => {
    const result = generateArchitectures(fixed(), {
      ...architectureGenerationPolicy,
      allow_dc_load_conversion: false,
    });
    expect(
      result.candidates.every((candidate) => candidate.structural_evaluation.status === 'blocked'),
    ).toBe(true);
  });
  it('deduplicates repeated dimensions and collapses inapplicable combined/split variants', () => {
    const duplicatePolicy = {
      ...architectureGenerationPolicy,
      candidate_house_voltages_v: [24, 12, 24, 48, 12],
      ac_function_arrangements: ['separate', 'separate'] as const,
    };
    const result = generateArchitectures(mixedArchitectureRequirements(), duplicatePolicy);
    expect(result.candidates.map((candidate) => candidate.choices.house_voltage_v)).toEqual([
      12, 24, 48,
    ]);
    expect(new Set(result.candidates.map((candidate) => candidate.id)).size).toBe(3);
    expect(result.expansion).toMatchObject({ explored: 10, deduplicated: 7, complete: true });
    expect(
      generateArchitectures(changedLoad({ domain: { kind: 'dc', nominal_voltage_v: 24 } }))
        .candidates,
    ).toHaveLength(1);
  });
  it('bounds expansion before candidate allocation and bounds requirements before generation', () => {
    expect(() =>
      generateArchitectures(mixedArchitectureRequirements(), {
        ...architectureGenerationPolicy,
        bounds: { ...architectureGenerationPolicy.bounds, max_candidates: 5 },
      }),
    ).toThrow(/expansion exceeds/);
    expect(() =>
      generateArchitectures(fixed(), {
        ...architectureGenerationPolicy,
        bounds: { ...architectureGenerationPolicy.bounds, max_loads: 2 },
      }),
    ).toThrow(/admission bounds/);
    expect(() =>
      generateArchitectures(fixed(), {
        ...architectureGenerationPolicy,
        bounds: { ...architectureGenerationPolicy.bounds, max_charging_sources: 2 },
      }),
    ).toThrow(/admission bounds/);
    expect(() =>
      generateArchitectures(fixed(), {
        ...architectureGenerationPolicy,
        candidate_house_voltages_v: Array.from({ length: 17 }, (_, i) => i + 1),
      }),
    ).toThrow(/schema rejected/);
    const maximum = generateArchitectures(mixedArchitectureRequirements(), {
      ...architectureGenerationPolicy,
      candidate_house_voltages_v: Array.from({ length: 16 }, (_, i) => i + 1),
    });
    expect(maximum.candidates).toHaveLength(32);
    expect(maximum.expansion.complete).toBe(true);
  });
  it('multiple compatible AC loads retain shared combined and separate choices without combinatorial pairing', () => {
    const input = fixed();
    const ac = input.requirements.loads[2]!;
    const result = generateArchitectures({
      ...input,
      requirements: { ...input.requirements, loads: [ac, { ...ac, id: 'other' }] },
    });
    expect(result.candidates).toHaveLength(2);
    expect(
      result.candidates
        .find((c) => c.choices.ac_function_arrangement === 'separate')!
        .required_roles.filter((role) => role.function === 'inverter'),
    ).toHaveLength(1);
    expect(
      result.candidates
        .find((c) => c.choices.ac_function_arrangement === 'combined')!
        .required_roles.filter((role) => role.function === 'inverter_charger'),
    ).toHaveLength(1);
  });
  it('a combined-only policy does not claim unsupported multi-function cardinality is satisfied', () => {
    const input = fixed();
    const ac = input.requirements.loads[2]!;
    const policy = {
      ...architectureGenerationPolicy,
      ac_function_arrangements: ['combined'] as const,
    };
    const result = generateArchitectures(
      {
        ...input,
        requirements: {
          ...input.requirements,
          loads: [ac, { ...ac, id: 'second', domain: { ...ac.domain, frequency_hz: 50 } }],
        },
      },
      policy,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.structural_evaluation.status).toBe('unresolved');
    expect(result.candidates[0]!.decisions).toContainEqual(
      expect.objectContaining({ code: 'combined_cardinality_unmodeled', status: 'unresolved' }),
    );
  });
  it('native load demand does not establish storage output dispatch', () => {
    const candidate = separate();
    const storage = candidate.required_roles.find((role) => role.function === 'storage')!;
    expect(storage.constraints.filter((c) => c.kind === 'minimum_output_power')).toEqual([]);
    expect(storage.output_capacity).toContainEqual(
      expect.objectContaining({
        scope: 'storage_dispatch',
        status: 'unresolved',
        lower_bound_constraint_ids: [],
      }),
    );
  });
  it.each(['loads', 'charging_sources'] as const)(
    'rejects duplicate %s identity rather than overwriting requirements',
    (key) => {
      const input = fixed();
      expect(() =>
        generateArchitectures({
          ...input,
          requirements: {
            ...input.requirements,
            [key]: [...input.requirements[key], input.requirements[key][0]!],
          },
        }),
      ).toThrow(/Duplicate/);
    },
  );
  it.each([NaN, Infinity, -1, 0])('rejects nonportable or nonpositive voltage %s', (voltage) => {
    expect(() => generateArchitectures(fixed(voltage))).toThrow();
  });
});

describe('structural and artifact authority', () => {
  it('passive wiring cannot replace DC conversion or inversion', () => {
    const candidate = copy(separate());
    const topology = {
      ...candidate.topology,
      edges: candidate.topology.edges.map((edge) =>
        edge.kind === 'required_power_path'
          ? { id: edge.id, kind: 'wire' as const, from: edge.from, to: edge.to }
          : edge,
      ),
    };
    expect(
      evaluateAbstractPowerTopology(
        topology,
        candidate.required_roles,
        candidate.demand_endpoints,
      ).some((result) => result.status === 'blocked'),
    ).toBe(true);
  });
  it('passive nominal-equal PV/DC continuity and generic DC conversion remain unresolved', () => {
    const candidate = copy(
      separate(changedSource({ kind: 'solar', domain: { kind: 'pv_dc', nominal_voltage_v: 24 } })),
    );
    const edges = candidate.topology.edges.map((edge) =>
      edge.kind === 'required_power_path' && edge.role_id === 'charging.vehicle'
        ? { id: edge.id, kind: 'wire' as const, from: 'domain.source.vehicle', to: 'house' }
        : edge,
    );
    expect(
      evaluateAbstractPowerTopology(
        { ...candidate.topology, edges },
        candidate.required_roles,
        candidate.demand_endpoints,
      ).some((result) => result.status === 'unresolved'),
    ).toBe(true);
    const roles = candidate.required_roles.map((role) =>
      role.function === 'solar_charge_control'
        ? {
            ...role,
            constraints: role.constraints.map((c) =>
              c.kind === 'capability'
                ? { ...c, capability: 'dc_to_dc_conversion' as const }
                : c.kind === 'directed_power_path'
                  ? { ...c, capability: 'dc_to_dc_conversion' as const }
                  : c,
            ),
          }
        : role,
    );
    expect(
      evaluateAbstractPowerTopology(candidate.topology, roles, candidate.demand_endpoints).some(
        (result) => result.status === 'unresolved',
      ),
    ).toBe(true);
  });
  it('distribution capability cannot authorize conversion', () => {
    const candidate = copy(separate());
    const roles = candidate.required_roles.map((role) =>
      role.function === 'dc_conversion'
        ? {
            ...role,
            constraints: role.constraints.map((c) =>
              c.kind === 'capability'
                ? { ...c, capability: 'distribution' as const }
                : c.kind === 'directed_power_path'
                  ? { ...c, capability: 'distribution' as const }
                  : c,
            ),
          }
        : role,
    );
    expect(
      evaluateAbstractPowerTopology(candidate.topology, roles, candidate.demand_endpoints).some(
        (result) => result.status === 'blocked',
      ),
    ).toBe(true);
  });
  it('domain assignment alone and reordered/cyclic routes cannot establish supply', () => {
    const candidate = separate();
    expect(
      evaluateAbstractPowerTopology(
        {
          ...candidate.topology,
          routes: candidate.topology.routes.map((route) => ({ ...route, edge_ids: [] })),
        },
        candidate.required_roles,
        candidate.demand_endpoints,
      )
        .filter((result) => result.code === 'ordered_abstract_route')
        .every((result) => result.status === 'blocked'),
    ).toBe(true);
    expect(
      evaluateAbstractPowerTopology(
        {
          ...candidate.topology,
          routes: candidate.topology.routes.map((route) => ({
            ...route,
            edge_ids: [...route.edge_ids].reverse(),
          })),
        },
        candidate.required_roles,
        candidate.demand_endpoints,
      ).some((result) => result.status === 'blocked'),
    ).toBe(true);
  });
  it('strict round-trip and replay preserve exact snapshots, identities and traces', () => {
    const input = mixedArchitectureRequirements();
    const result = generateArchitectures(input);
    expect(parseArchitectureGeneration(serializeArchitectureGeneration(result))).toEqual(result);
    expect(replayArchitectureGeneration(result, input)).toEqual(result);
    expect(() => replayArchitectureGeneration(result, fixed())).toThrow(/changed/);
    expect(() =>
      replayArchitectureGeneration(result, input, {
        ...architectureGenerationPolicy,
        version: 'changed',
      }),
    ).toThrow(/changed/);
    expect(passportDigest({ a: 1, b: 2 })).toBe(passportDigest({ b: 2, a: 1 }));
  });
  it('owns independent copies of caller input and policy and isolates candidate outputs', () => {
    const input = copy(mixedArchitectureRequirements());
    const policy = copy(architectureGenerationPolicy);
    const before = serializePassportValue({ input, policy });
    const result = generateArchitectures(input, policy);
    expect(serializePassportValue({ input, policy })).toBe(before);
    (input.requirements.loads[0]!.domain as { nominal_voltage_v: number }).nominal_voltage_v = 99;
    (policy as { version: string }).version = 'changed';
    expect(result.input.requirements.loads[0]!.domain.nominal_voltage_v).toBe(24);
    expect(result.policy.version).toBe('2.0.0');
    (result.candidates[0]!.topology.domains[0] as { nominal_voltage_v: number }).nominal_voltage_v =
      99;
    expect(result.candidates[1]!.topology.domains[0]!.nominal_voltage_v).toBe(12);
    expect(Object.isFrozen(architectureGenerationPolicy.bounds)).toBe(true);
  });
  const rehash = (result: ReturnType<typeof generateArchitectures>) => {
    const candidates = result.candidates.map((candidate) => {
      const { id: _id, candidate_digest: _digest, ...body } = candidate;
      const digest = passportDigest(body);
      return { ...body, id: `architecture.${digest.slice(7)}`, candidate_digest: digest };
    });
    const { result_digest: _resultDigest, ...body } = result;
    const changed = { ...body, candidates };
    return { ...changed, result_digest: passportDigest(changed) };
  };
  it.each([
    'status',
    'constraints',
    'provenance',
    'trace',
    'safety',
    'scope',
    'binding',
    'assumptions',
    'input_digest',
    'policy_lifecycle',
    'duplicate',
  ])('rejects forged %s even with recomputed artifact and candidate hashes', (kind) => {
    const result = copy(generateArchitectures(changedSource({ domain: { kind: 'dc' } })));
    const candidate = result.candidates[0]!;
    if (kind === 'status')
      (candidate.structural_evaluation as { status: string }).status = 'structurally_viable';
    if (kind === 'constraints') (candidate.required_roles[0]!.constraints as unknown[]).pop();
    if (kind === 'provenance')
      (candidate.required_roles[0]!.constraints[0]!.provenance as unknown[]).pop();
    if (kind === 'trace')
      (candidate.decisions[0] as { message: string }).message = 'unsupported explanation';
    if (kind === 'safety')
      (
        candidate.structural_evaluation as unknown as { installation_safety: string }
      ).installation_safety = 'safe';
    if (kind === 'scope')
      (candidate.structural_evaluation as unknown as { assertion_scope: string }).assertion_scope =
        'exact-system';
    if (kind === 'binding')
      (candidate.structural_evaluation as unknown as { product_binding: string }).product_binding =
        'compatible';
    if (kind === 'assumptions') (candidate.used_assumption_ids as string[]).push('invented');
    if (kind === 'input_digest')
      (candidate as { input_digest: string }).input_digest = passportDigest({ changed: true });
    if (kind === 'policy_lifecycle')
      (
        candidate.structural_evaluation as { policy_lifecycle_status: string }
      ).policy_lifecycle_status = 'approved';
    if (kind === 'duplicate') (result.candidates as ArchitectureCandidate[]).push(copy(candidate));
    expect(() => parseArchitectureGeneration(serializePassportValue(rehash(result)))).toThrow();
  });
  it('rejects unsupported schema/revision and rejects unexplained policy fields', () => {
    const result = copy(generateArchitectures(fixed()));
    expect(() =>
      parseArchitectureGeneration(JSON.stringify({ ...result, schema_version: '0.0.0' })),
    ).toThrow(/schema rejected/);
    expect(() =>
      parseArchitectureGeneration(JSON.stringify({ ...result, generator_revision: 'other' })),
    ).toThrow(/Unsupported/);
    expect(() =>
      generateArchitectures(fixed(), {
        ...architectureGenerationPolicy,
        manufacturer: 'a',
      } as ArchitectureGenerationPolicy),
    ).toThrow(/schema rejected/);
  });
});
