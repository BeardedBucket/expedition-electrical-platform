import { describe, expect, it } from 'vitest';
import {
  evaluateProductSelection,
  parseProductSelection,
  serializeProductSelection,
  replayProductSelection,
  productSelectionPolicy,
  type ProductSelectionInput,
  type ProductSelectionResult,
} from '../src/product-selection.js';
import { evaluateProductWitness, feasibility } from '../src/product-binding-evaluation.js';
import { passportDigest, serializePassportValue } from '../src/portable-json.js';
import { batteryProduct, converterProduct, selectionRequest } from './fixtures/selection.js';
import type { ComponentLibraryRecord } from '../src/component-library.js';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const candidate = (input: ProductSelectionInput) =>
  evaluateProductSelection(input).roles.find((r) => r.role.function === 'dc_conversion')!
    .candidates[0]!;
const mutate = (f: (r: Record<string, unknown>) => void): ComponentLibraryRecord => {
  const p = copy(converterProduct());
  f(p as Record<string, unknown>);
  return p;
};

describe('mandatory product feasibility', () => {
  it('proves a complete binding with exact accepted evidence for every YES', () => {
    const c = candidate(selectionRequest());
    expect(c.status).toBe('ELIGIBLE');
    const binding = c.bindings.find((b) => b.status === 'ELIGIBLE')!;
    expect(binding.witness).toEqual({
      interfaces: { dc: 'in', output: 'out' },
      paths: { supply: 'convert' },
    });
    for (const gate of binding.gates) {
      expect(gate.truth).toBe('YES');
      expect(gate.evidence.length).toBeGreaterThan(0);
      expect(gate.evidence.every((e) => e.engineering_use.state === 'accepted_input')).toBe(true);
      expect(gate.constraint.provenance.length).toBeGreaterThan(0);
    }
  });
  it.each(['unverified', 'partially_verified'] as const)(
    'withholds %s evidence from both YES and NO',
    (verification) => {
      const p = { ...converterProduct(), verification_status: verification };
      const c = candidate(selectionRequest([p]));
      expect(c.status).toBe('UNRESOLVED');
      expect(c.bindings.flatMap((b) => b.gates).every((g) => g.truth === 'UNKNOWN')).toBe(true);
    },
  );
  it.each(['ports', 'capabilities', 'power_paths'] as const)(
    'missing %s stays unresolved',
    (field) => {
      const p = mutate((r) => {
        delete r[field];
        if (field !== 'power_paths') delete r.power_paths;
      });
      expect(candidate(selectionRequest([p])).status).toBe('UNRESOLVED');
    },
  );
  it.each(['voltage_v', 'power_w'] as const)('missing numeric %s never becomes zero', (field) => {
    const p = copy(converterProduct());
    const out = { ...p.ports![1]! };
    delete (out as Record<string, unknown>)[field];
    const c = candidate(selectionRequest([{ ...p, ports: [p.ports![0]!, out] }]));
    expect(c.status).toBe('UNRESOLVED');
    expect(
      c.bindings.some((b) =>
        b.gates.some((g) => g.truth === 'UNKNOWN' && g.reason === 'fact_missing'),
      ),
    ).toBe(true);
  });
  it.each([
    ['voltage_v', 48],
    ['power_w', 99],
    ['direction', 'input'],
    ['domain', 'ac'],
  ] as const)('explicit output %s mismatch blocks', (field, value) => {
    const p = copy(converterProduct());
    const out = { ...p.ports![1]!, [field]: value };
    expect(
      candidate(
        selectionRequest([
          {
            ...p,
            ports: [p.ports![0]!, out],
            ...(field === 'direction' ? { power_paths: [] } : {}),
          },
        ]),
      ).status,
    ).toBe('BLOCKED');
  });
  it('records every gate after a blocker and preserves all contradictions', () => {
    const p = copy(converterProduct());
    const c = candidate(
      selectionRequest([
        {
          ...p,
          ports: [
            { ...p.ports![0]!, voltage_v: 48 },
            { ...p.ports![1]!, voltage_v: 48, power_w: 1 },
          ],
        },
      ]),
    );
    for (const b of c.bindings)
      expect(b.gates.length).toBe(
        selectionRequest().generation.candidates[0]!.required_roles[0]!.constraints.length,
      );
    expect(c.bindings.some((b) => b.gates.filter((g) => g.truth === 'NO').length >= 3)).toBe(true);
  });
  it.each([false, undefined])(
    'optional communications %s does not gate storage or fixed equipment',
    (unsupported) => {
      const p = {
        ...batteryProduct(),
        electrical: { nominal_voltage_v: 24 },
        ports: [
          {
            id: 'battery',
            domain: 'dc' as const,
            direction: 'bidirectional' as const,
            voltage_v: 24,
          },
        ],
        battery: { nominal_energy_wh: 4800 },
        ...(unsupported === false ? { unsupported_capabilities: ['communication' as const] } : {}),
      };
      let request = selectionRequest([p], false, true);
      const role = request.generation.candidates[0]!.required_roles.find(
        (r) => r.function === 'storage',
      )!;
      request = { ...request, fixed_existing: [{ role_id: role.id, component_id: p.id }] };
      expect(
        evaluateProductSelection(request).roles.find((r) => r.role.id === role.id)!.candidates[0]!
          .status,
      ).toBe('ELIGIBLE');
    },
  );
  it.each([
    ['explicit', 'NO'],
    ['missing', 'UNKNOWN'],
    ['unreviewed', 'UNKNOWN'],
  ] as const)('mandatory communication %s distinguishes negatives and missing', (mode, truth) => {
    const request = selectionRequest();
    const architecture = request.generation.candidates[0]!;
    const role = architecture.required_roles[0]!;
    const p = {
      ...converterProduct(),
      ...(mode !== 'missing' ? { unsupported_capabilities: ['communication' as const] } : {}),
      verification_status: mode === 'unreviewed' ? ('unverified' as const) : ('verified' as const),
    };
    const b = evaluateProductWitness(
      architecture,
      {
        ...role,
        constraints: [
          ...role.constraints,
          {
            id: 'communication',
            kind: 'capability',
            capability: 'communication',
            provenance: role.constraints[0]!.provenance,
          },
        ],
      },
      p,
      { interfaces: { dc: 'in', output: 'out' }, paths: { supply: 'convert' } },
    );
    expect(b.gates.find((g) => g.constraint.id === 'communication')!.truth).toBe(truth);
  });
  it('cannot union unrelated port voltage and power facts', () => {
    const p = copy(converterProduct());
    const c = candidate(
      selectionRequest([
        {
          ...p,
          ports: [
            p.ports![0]!,
            { ...p.ports![1]!, power_w: 1 },
            { id: 'elsewhere', domain: 'dc', direction: 'output', voltage_v: 48, power_w: 1000 },
          ],
        },
      ]),
    );
    expect(c.status).not.toBe('ELIGIBLE');
    expect(c.bindings.every((b) => b.status !== 'ELIGIBLE')).toBe(true);
  });
  it('cannot borrow an unrelated conversion path', () => {
    const p = copy(converterProduct());
    expect(
      candidate(
        selectionRequest([
          {
            ...p,
            ports: [
              ...p.ports!,
              { id: 'other-in', domain: 'dc', direction: 'input', voltage_v: 48 },
              { id: 'other-out', domain: 'dc', direction: 'output', voltage_v: 48, power_w: 500 },
            ],
            power_paths: [{ ...p.power_paths![0]!, from_port: 'other-in', to_port: 'other-out' }],
          },
        ]),
      ).status,
    ).not.toBe('ELIGIBLE');
  });
  it.each(['wrong', 'missing'] as const)(
    'context %s cannot use a headline/conditional rating',
    (mode) => {
      const p = copy(converterProduct());
      const out = {
        ...p.ports![1]!,
        constraints: [
          {
            id: 'temperature',
            kind: 'continuous_rating' as const,
            quantity: 'power' as const,
            unit: 'W' as const,
            value: 1000,
            conditions: [{ path: 'temperature_c', equals: mode === 'wrong' ? 25 : 40 }],
          },
        ],
      };
      // Omitted modeled context remains genuinely absent, not JSON undefined.
      const clean = copy(out);
      const c = candidate(
        selectionRequest([
          { ...p, electrical: { continuous_power_w: 5000 }, ports: [p.ports![0]!, clean] },
        ]),
      );
      expect(c.status).toBe('UNRESOLVED');
      expect(c.reasons).toContain('contextual_rating_unresolved');
    },
  );
  it.each([false, undefined])(
    'path isolation %s is NO or UNKNOWN without inference',
    (isolated) => {
      const p = copy(converterProduct());
      const path = { ...p.power_paths![0]! };
      delete (path as Record<string, unknown>).isolated;
      if (isolated !== undefined) (path as { isolated?: boolean }).isolated = isolated;
      const c = candidate(selectionRequest([{ ...p, power_paths: [path] }]));
      expect(c.status).toBe(isolated === false ? 'BLOCKED' : 'UNRESOLVED');
    },
  );
  it('preserves upstream shared capacity even when all lower bounds pass', () => {
    const request = selectionRequest(undefined, true);
    const role = evaluateProductSelection(request).roles[0]!;
    expect(role.upstream_unresolved[0]!.unresolved_reasons).toContain('concurrency_not_asserted');
    const b = role.candidates[0]!.bindings.find((b) => b.gates.every((g) => g.truth === 'YES'))!;
    expect(b.status).toBe('UNRESOLVED');
    expect(
      b.gates
        .filter((g) => g.constraint.kind === 'minimum_output_power')
        .map((g) => (g.constraint.kind === 'minimum_output_power' ? g.constraint.power_w : -1)),
    ).toEqual([100, 200]);
    expect(b.calculations).toEqual([]);
  });
  it('unknown individual demand remains upstream unknown, not a zero W gate', () => {
    const req = selectionRequest(undefined, true);
    const gen = copy(req.generation.input);
    delete (gen.requirements.loads[1] as Record<string, unknown>).required_power_w;
    // Regeneration, rather than editing a portable role artifact.
    const request = withGeneration(req, gen);
    const role = evaluateProductSelection(request).roles[0]!;
    expect(role.upstream_unresolved[0]!.unresolved_reasons).toContain('demand_power_unknown');
    expect(role.role.constraints.filter((c) => c.kind === 'minimum_output_power')).toHaveLength(1);
  });
  it.each([
    ['NO', 'UNKNOWN', 'BLOCKED'],
    ['YES', 'UNKNOWN', 'UNRESOLVED'],
    ['YES', 'YES', 'ELIGIBLE'],
  ] as const)('aggregates %s/%s as %s in either order', (a, b, status) => {
    expect(feasibility([a, b])).toBe(status);
    expect(feasibility([b, a])).toBe(status);
  });
});

import {
  generateArchitectures,
  type ArchitectureGenerationInput,
} from '../src/architecture-generation.js';
const withGeneration = (request: ProductSelectionInput, input: ArchitectureGenerationInput) => {
  const generation = generateArchitectures(input);
  return { ...request, generation, candidate_id: generation.candidates[0]!.id };
};

describe('fixed intent, assembly and deterministic portability', () => {
  it.each(['ELIGIBLE', 'UNRESOLVED', 'BLOCKED', 'missing'] as const)(
    'retains fixed %s without substitutions',
    (status) => {
      const p =
        status === 'missing'
          ? undefined
          : status === 'UNRESOLVED'
            ? { ...converterProduct(), verification_status: 'unverified' as const }
            : status === 'BLOCKED'
              ? {
                  ...converterProduct(),
                  ports: converterProduct().ports!.map((p) => ({ ...p, voltage_v: 48 })),
                }
              : converterProduct();
      const request = selectionRequest(
        p ? [p, { ...converterProduct(), id: 'fixture.alternative' }] : [converterProduct()],
      );
      const role = request.generation.candidates[0]!.required_roles[0]!;
      const result = evaluateProductSelection({
        ...request,
        fixed_existing: [{ role_id: role.id, component_id: p?.id ?? 'missing.owned' }],
      });
      expect(result.roles[0]!.candidates).toHaveLength(1);
      const c = result.roles[0]!.candidates[0]!;
      expect(c.fixed_existing).toBe(true);
      expect(c.status).toBe(status === 'missing' ? 'UNRESOLVED' : status);
      if (status === 'missing') {
        expect(c.reasons).toEqual(['fixed_component_record_missing']);
        expect(c.bindings).toHaveLength(1);
        expect(c.bindings[0]!.gates).toHaveLength(role.constraints.length);
        expect(
          c.bindings[0]!.gates.every((g) => g.truth === 'UNKNOWN' && g.evidence.length === 0),
        ).toBe(true);
      }
    },
  );
  it('other roles remain selectable around a missing fixed model', () => {
    const request = selectionRequest([converterProduct()], false, true);
    const storage = request.generation.candidates[0]!.required_roles.find(
      (r) => r.function === 'storage',
    )!;
    const result = evaluateProductSelection({
      ...request,
      fixed_existing: [{ role_id: storage.id, component_id: 'missing.owned' }],
    });
    expect(
      result.roles.find((r) => r.role.function === 'dc_conversion')!.candidates[0]!.status,
    ).toBe('ELIGIBLE');
  });
  it('derives minimum series/parallel bank with exact formulas and preserved deferred dispatch', () => {
    const result = evaluateProductSelection(selectionRequest([batteryProduct()], false, true));
    const role = result.roles.find((r) => r.role.function === 'storage')!;
    const c = role.candidates.find((c) => c.assembly)!;
    expect(c.assembly).toMatchObject({ series_count: 2, parallel_count: 2 });
    expect(c.status).toBe('ELIGIBLE');
    expect(role.deferred_scopes[0]!.scope).toBe('storage_dispatch');
    expect(role.upstream_unresolved).toEqual([]);
    expect(role.role.constraints.some((c) => c.kind === 'minimum_output_power')).toBe(false);
    expect(c.bindings[0]!.calculations.map((c) => [c.unit, c.output])).toEqual([
      ['V', 24],
      ['Wh', 4800],
      ['Ah', 200],
    ]);
    expect(
      c.bindings[0]!.calculations.every((c) => c.kind === 'derived' && c.evidence.length > 0),
    ).toBe(true);
  });
  it.each(['series', 'parallel'] as const)(
    'explicit %s prohibition blocks, missing permission remains unknown',
    (axis) => {
      const p = batteryProduct();
      const field = `allowed_${axis}_count`;
      const request = selectionRequest(
        [{ ...p, battery: { ...p.battery, [field]: { min: 1, max: 1 } } }],
        false,
        true,
      );
      expect(
        evaluateProductSelection(request)
          .roles.find((r) => r.role.function === 'storage')!
          .candidates.find((c) => c.assembly)!.status,
      ).toBe('BLOCKED');
      const battery = { ...p.battery };
      delete (battery as Record<string, unknown>)[field];
      const c = evaluateProductSelection(selectionRequest([{ ...p, battery }], false, true))
        .roles.find((r) => r.role.function === 'storage')!
        .candidates.find((c) => c.assembly)!;
      expect(c.status).toBe('UNRESOLVED');
      expect(c.reasons).toContain('assembly_permission_unknown');
    },
  );
  it('missing unit energy retains a symbolic unresolved assembly rather than quantity guessing', () => {
    const p = batteryProduct();
    const c = evaluateProductSelection(
      selectionRequest(
        [{ ...p, battery: { allowed_series_count: { min: 1, max: 4 } } }],
        false,
        true,
      ),
    ).roles.find((r) => r.role.function === 'storage')!.candidates;
    expect(c.some((c) => c.assembly_generation === 'unresolved' && c.status === 'UNRESOLVED')).toBe(
      true,
    );
    expect(c.some((c) => c.assembly)).toBe(false);
  });
  it('explicit count assemblies are deterministic, including an engineering contradiction', () => {
    const request = selectionRequest([batteryProduct()], false, true);
    const role = request.generation.candidates[0]!.required_roles.find(
      (r) => r.function === 'storage',
    )!;
    const input = {
      ...request,
      assemblies: [
        {
          role_id: role.id,
          kind: 'homogeneous' as const,
          component_id: batteryProduct().id,
          series_count: 3,
          parallel_count: 1,
        },
      ],
    };
    const result = evaluateProductSelection(input);
    expect(
      result.roles
        .find((r) => r.role.id === role.id)!
        .candidates.find((c) => c.assembly?.series_count === 3)!.status,
    ).toBe('BLOCKED');
    expect(evaluateProductSelection(input)).toEqual(result);
  });
  it.each([
    'max_products',
    'max_bindings_per_candidate',
    'max_total_bindings',
    'max_assembly_units',
  ] as const)('rejects %s overflow instead of truncating', (field) => {
    const policy = {
      ...productSelectionPolicy,
      bounds: { ...productSelectionPolicy.bounds, [field]: 1 },
    };
    expect(() =>
      evaluateProductSelection(
        selectionRequest([converterProduct(), batteryProduct()], false, true),
        policy,
      ),
    ).toThrow(/bound/);
  });
  it('corpus order has no effect on the complete artifact', () => {
    const input = selectionRequest([converterProduct(), batteryProduct()]);
    expect(evaluateProductSelection({ ...input, corpus: [...input.corpus].reverse() })).toEqual(
      evaluateProductSelection(input),
    );
  });
  it('unrelated product addition/removal cannot change another product truth', () => {
    const a = candidate(selectionRequest());
    const b = evaluateProductSelection(
      selectionRequest([converterProduct(), batteryProduct()]),
    ).roles[0]!.candidates.find((c) => c.component_id === converterProduct().id)!;
    expect(b).toEqual(a);
  });
  it.each([
    'manufacturer',
    'price',
    'weight_kg',
    'builder_inventory',
    'advisory_refs',
    'popularity',
    'product_role',
    'category',
  ] as const)('%s has no eligibility authority', (field) => {
    const p = copy(converterProduct());
    const value =
      field === 'advisory_refs'
        ? [{ id: 'advisory', title: 'Active concern' }]
        : field === 'product_role'
          ? 'other'
          : field === 'weight_kg'
            ? 500
            : field === 'price' || field === 'popularity'
              ? 999
              : 'changed';
    const c = candidate(selectionRequest([{ ...p, [field]: value }]));
    expect(c.status).toBe('ELIGIBLE');
  });
  it('predicate order changes neither gate outcomes nor aggregate truth', () => {
    const request = selectionRequest();
    const a = request.generation.candidates[0]!;
    const role = a.required_roles[0]!;
    const w = { interfaces: { dc: 'in', output: 'out' }, paths: { supply: 'convert' } };
    expect(
      evaluateProductWitness(
        a,
        { ...role, constraints: [...role.constraints].reverse() },
        converterProduct(),
        w,
      ),
    ).toEqual(evaluateProductWitness(a, role, converterProduct(), w));
  });
  it('round trips and exactly replays through the public source API', () => {
    const input = selectionRequest();
    const result = evaluateProductSelection(input);
    expect(parseProductSelection(serializeProductSelection(result))).toEqual(result);
    expect(replayProductSelection(result, input)).toEqual(result);
  });
  const tamperings: readonly [string, (r: ProductSelectionResult) => void][] = [
    [
      'gate truth',
      (r) => {
        (r.roles[0]!.candidates[0]!.bindings[0]!.gates[0] as { truth: string }).truth = 'YES';
      },
    ],
    [
      'witness',
      (r) => {
        (
          r.roles[0]!.candidates[0]!.bindings[0]!.witness.interfaces as Record<string, string>
        ).input = 'forged';
      },
    ],
    [
      'evidence',
      (r) => {
        (
          r.roles[0]!.candidates[0]!.bindings[0]!.gates[0]!.evidence[0] as {
            source_refs: unknown[];
          }
        ).source_refs = [];
      },
    ],
    [
      'unresolved reason',
      (r) => {
        (r.roles[0]!.candidates[0]!.bindings[0]!.gates[0] as { reason: string }).reason =
          'fact_missing';
      },
    ],
    [
      'constraint provenance',
      (r) => {
        (r.roles[0]!.role.constraints[0] as { provenance: unknown[] }).provenance = [];
      },
    ],
  ];
  it.each(tamperings)('rejects rehashed tampered %s', (_label, change) => {
    // Withheld evidence ensures a forged YES is a material semantic change.
    const r = copy(
      evaluateProductSelection(
        selectionRequest([{ ...converterProduct(), verification_status: 'unverified' }]),
      ),
    );
    change(r);
    const { result_digest: _old, ...body } = r;
    (r as { result_digest: string }).result_digest = passportDigest(body);
    expect(() => parseProductSelection(serializePassportValue(r))).toThrow();
  });
  it.each(['count', 'calculation'] as const)('rejects rehashed assembly %s tampering', (field) => {
    const r = copy(evaluateProductSelection(selectionRequest([batteryProduct()], false, true)));
    const c = r.roles
      .find((r) => r.role.function === 'storage')!
      .candidates.find((c) => c.assembly)!;
    if (field === 'count') (c.assembly as { series_count: number }).series_count = 3;
    else (c.bindings[0]!.calculations[0] as { output: number }).output = 999;
    const { result_digest: _old, ...body } = r;
    (r as { result_digest: string }).result_digest = passportDigest(body);
    expect(() => parseProductSelection(serializePassportValue(r))).toThrow();
  });
  it('replay rejects a changed external evidence snapshot', () => {
    const input = selectionRequest();
    const result = evaluateProductSelection(input);
    expect(() =>
      replayProductSelection(result, {
        ...input,
        corpus: [{ ...converterProduct(), verification_status: 'unverified' }],
      }),
    ).toThrow();
  });
  it('rejects fixed demand-endpoint intent instead of making appliance slots', () => {
    const input = selectionRequest();
    expect(() =>
      evaluateProductSelection({
        ...input,
        fixed_existing: [
          {
            role_id: input.generation.candidates[0]!.demand_endpoints[0]!.id,
            component_id: converterProduct().id,
          },
        ],
      }),
    ).toThrow(/nonmandatory/);
  });
  it('rejects contradictory canonical capability assertions', () => {
    expect(() =>
      evaluateProductSelection(
        selectionRequest([
          { ...converterProduct(), unsupported_capabilities: ['dc_to_dc_conversion'] },
        ]),
      ),
    ).toThrow(/conflicting/i);
  });
});

describe('additional canonical and assembly trust boundaries', () => {
  it('missing category metadata does not exclude a proven product', () => {
    const p = converterProduct();
    delete (p as Record<string, unknown>).category;
    expect(candidate(selectionRequest([p])).status).toBe('ELIGIBLE');
  });
  it('raw/provisional extractions and confidence never fill missing port power', () => {
    const p = converterProduct();
    const out = { ...p.ports![1]! };
    delete (out as Record<string, unknown>).power_w;
    const c = candidate(
      selectionRequest([
        {
          ...p,
          ports: [p.ports![0]!, out],
          raw_source_text: '500 W',
          confidence: 1,
          extracted_facts: [{ power_w: 500, verified: true }],
        },
      ]),
    );
    expect(c.status).toBe('UNRESOLVED');
  });
  it.each(['missing', 'unrelated'] as const)(
    'storage capability port association %s is not a valid binding',
    (mode) => {
      const p = batteryProduct();
      const capabilities =
        mode === 'missing'
          ? [{ id: 'store', type: 'energy_storage' as const }]
          : [{ id: 'store', type: 'energy_storage' as const, port_ids: ['aux'] }];
      const ports =
        mode === 'unrelated'
          ? [
              ...p.ports!,
              { id: 'aux', domain: 'dc' as const, direction: 'input' as const, voltage_v: 48 },
            ]
          : p.ports;
      const r = evaluateProductSelection(
        selectionRequest([{ ...p, capabilities, ports }], false, true),
      );
      expect(
        r.roles
          .find((r) => r.role.function === 'storage')!
          .candidates.filter((c) => c.assembly)
          .every((c) => c.status !== 'ELIGIBLE'),
      ).toBe(true);
    },
  );
  it.each(['ELIGIBLE', 'BLOCKED', 'UNRESOLVED'] as const)(
    'fixed assembly may be %s without replacement',
    (status) => {
      const p = batteryProduct();
      const battery =
        status === 'BLOCKED'
          ? { ...p.battery, allowed_series_count: { min: 1, max: 1 } }
          : status === 'UNRESOLVED'
            ? { ...p.battery, allowed_series_count: null }
            : p.battery;
      const request = selectionRequest([{ ...p, battery }, converterProduct()], false, true);
      const role = request.generation.candidates[0]!.required_roles.find(
        (r) => r.function === 'storage',
      )!;
      const r = evaluateProductSelection({
        ...request,
        fixed_existing: [
          {
            role_id: role.id,
            component_id: p.id,
            assembly: {
              kind: 'homogeneous',
              component_id: p.id,
              series_count: 2,
              parallel_count: 2,
            },
          },
        ],
      });
      const c = r.roles.find((r) => r.role.id === role.id)!.candidates;
      expect(c).toHaveLength(1);
      expect(c[0]!.status).toBe(status);
      expect(c[0]!.fixed_existing).toBe(true);
    },
  );
  it('unit Wh fallback retains the V times Ah derivation instead of claiming publication', () => {
    const p = batteryProduct();
    const battery = { ...p.battery };
    delete (battery as Record<string, unknown>).nominal_energy_wh;
    const r = evaluateProductSelection(selectionRequest([{ ...p, battery }], false, true));
    const c = r.roles
      .find((r) => r.role.function === 'storage')!
      .candidates.find((c) => c.assembly)!;
    expect(c.status).toBe('ELIGIBLE');
    expect(
      c.bindings[0]!.calculations.some(
        (c) =>
          c.formula === 'unitEnergyWh = unitNominalVoltageV * unitNominalCapacityAh' &&
          c.output === 1200,
      ),
    ).toBe(true);
  });
  it('native and series storage are both retained without preference ordering', () => {
    const p = batteryProduct();
    const native = {
      ...p,
      id: 'fixture.native',
      electrical: { nominal_voltage_v: 24 },
      ports: p.ports!.map((port) => ({ ...port, voltage_v: 24 })),
      battery: { ...p.battery, nominal_energy_wh: 4800 },
    };
    const r = evaluateProductSelection(selectionRequest([p, native], false, true));
    const candidates = r.roles.find((r) => r.role.function === 'storage')!.candidates;
    expect(
      candidates.some(
        (c) => c.component_id === native.id && c.status === 'ELIGIBLE' && !c.assembly,
      ),
    ).toBe(true);
    expect(
      candidates.some((c) => c.component_id === p.id && c.status === 'ELIGIBLE' && c.assembly),
    ).toBe(true);
    expect(candidates.every((c) => !('score' in c) && !('rank' in c))).toBe(true);
  });
  it('does not truncate at a top-N candidate count', () => {
    const corpus = Array.from({ length: 30 }, (_, i) => ({
      ...converterProduct(),
      id: 'fixture.c' + i,
    }));
    expect(
      evaluateProductSelection(selectionRequest(corpus)).roles[0]!.candidates.filter(
        (c) => c.status === 'ELIGIBLE',
      ),
    ).toHaveLength(30);
  });
});

describe('minimum feasible assembly and missing fixed bank trace', () => {
  it('honors a reviewed parallel minimum when it exceeds the energy-only count', () => {
    const p = batteryProduct();
    const r = evaluateProductSelection(
      selectionRequest(
        [{ ...p, battery: { ...p.battery, allowed_parallel_count: { min: 3, max: 4 } } }],
        false,
        true,
      ),
    );
    const c = r.roles
      .find((r) => r.role.function === 'storage')!
      .candidates.find((c) => c.assembly)!;
    expect(c.assembly!.parallel_count).toBe(3);
    expect(c.status).toBe('ELIGIBLE');
  });
  it('retains all permission UNKNOWNs for an absent fixed assembly record', () => {
    const input = selectionRequest([], false, true);
    const role = input.generation.candidates[0]!.required_roles.find(
      (r) => r.function === 'storage',
    )!;
    const r = evaluateProductSelection({
      ...input,
      fixed_existing: [
        {
          role_id: role.id,
          component_id: 'missing.bank',
          assembly: {
            kind: 'homogeneous',
            component_id: 'missing.bank',
            series_count: 2,
            parallel_count: 2,
          },
        },
      ],
    });
    const c = r.roles.find((r) => r.role.id === role.id)!.candidates[0]!;
    expect(c.status).toBe('UNRESOLVED');
    expect(c.bindings[0]!.gates.every((g) => g.truth === 'UNKNOWN')).toBe(true);
    expect(c.bindings[0]!.assembly_gates.map((g) => g.truth)).toEqual(['UNKNOWN', 'UNKNOWN']);
    expect(c.bindings[0]!.calculations).toEqual([]);
  });
});
