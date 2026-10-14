import { describe, it, expect } from 'vitest';
import { completeInstalledSystemFixture } from './fixtures/whole-system.js';
import {
  evaluateInstalledSourceDrafts,
  bindInstalledSourceDrafts,
  replayInstalledSourceDrafts,
  type InstalledSourceDraftScenario,
} from '../src/installed-source-draft-bridge.js';
import type { SourceGroundedDraft, SourceGroundedFact } from '../src/source-grounded-draft.js';
import { passportDigest } from '../src/portable-json.js';
// Entirely invented source, product and physical-installation fixtures.
function fixture() {
  const f = completeInstalledSystemFixture();
  const make = (id: string, model: string): SourceGroundedDraft => ({
    version: 'source-grounded-draft.v1',
    authority: 'codex_prepared_unreviewed',
    product: {
      id,
      model,
      manufacturer: 'Test author',
      manufacturer_part_number: null,
      hardware_revision: null,
    },
    intended_use: 'Invented PV model',
    sources: [
      {
        id: 'test',
        url: 'https://example.test/synthetic',
        publisher: 'Test author',
        model,
        retrieved_at: '2026-10-13T00:00:00Z',
        content_digest: 'sha256:' + 'a'.repeat(64),
        document_revision: null,
        identity_locator: 'Invented header',
        rights: 'metadata_and_limited_facts_only',
        redistribution_grant: 'not_established',
      },
    ],
    facts: [],
    holds: ['Synthetic only'],
  });
  const add = (
    d: SourceGroundedDraft,
    q: string,
    value: number,
    unit: string,
    conditions: SourceGroundedFact['conditions'] = [],
    extra: Partial<SourceGroundedFact> = {},
  ) =>
    d.facts.push({
      id: d.product.id + '.' + q,
      quantity: q,
      basis: 'nominal',
      mode: 'pv_reference',
      direction: 'output',
      electrical_domain: 'dc',
      original: { value: String(value), unit, presentation: 'source_literal' },
      normalized: { value, unit },
      normalization: 'identity',
      source_id: 'test',
      locator: 'Invented ' + q,
      context_digest: 'sha256:' + 'a'.repeat(64),
      conditions,
      unresolved_conditions: [],
      disposition: 'typed_consumer',
      ...extra,
    });
  const ref = [
    { key: 'module_temperature_c', value: 25, unit: 'degC' },
    { key: 'irradiance_w_m2', value: 1000, unit: 'W/m2' },
    { key: 'spectrum', value: 'AM1.5g', unit: 'text' },
  ];
  const panel = make('test.panel', 'invented-panel');
  add(panel, 'pv_voc', 50, 'V', ref);
  add(panel, 'pv_isc', 12, 'A', ref);
  const controller = make('test.controller', 'invented-controller');
  add(controller, 'max_input_voc', 150, 'V', [], {
    basis: 'absolute',
    mode: 'pv_input',
    direction: 'input',
  });
  add(controller, 'max_input_isc', 45, 'A', [], {
    basis: 'absolute',
    mode: 'pv_input',
    direction: 'input',
  });
  add(controller, 'startup_delta_v', 5, 'V', [], {
    basis: 'operating',
    mode: 'startup',
    direction: 'input',
  });
  add(controller, 'running_delta_v', 1, 'V', [], {
    basis: 'operating',
    mode: 'running',
    direction: 'input',
  });
  const records = [panel, controller].map((d) => ({
    id: d.product.id,
    manufacturer: d.product.manufacturer,
    model: d.product.model,
    verification_status: 'unverified' as const,
    engineering_profile: {
      schema_version: 'engineering-profile.v1' as const,
      component_id: d.product.id,
      model: d.product.model,
      manufacturer_revision: null,
      evidence: [],
      source_specification: d,
    },
  }));
  f.input = {
    ...f.input,
    requirements: {
      id: 'synthetic.pv',
      house_domain_id: 'house',
      supplies: [],
      load_states: [],
      battery_banks: [],
    },
    architecture: {
      ...f.input.architecture,
      power_topology: { ...f.input.architecture.power_topology, bindings: [], edges: [] },
      installation: {
        ...f.input.architecture.installation,
        component_instances: [
          { id: 'controller', component_id: controller.product.id, status: 'selected' },
          ...['a', 'b', 'c', 'd'].map((id) => ({
            id,
            component_id: panel.product.id,
            status: 'selected' as const,
          })),
        ],
      },
    },
  };
  const scenario: InstalledSourceDraftScenario = {
    version: 'installed-source-draft-scenario.v1',
    uses: [],
    pv_arrays: [
      {
        controller_instance_id: 'controller',
        strings: [
          { series_count: 2, module_instance_ids: ['a', 'b'] },
          { series_count: 2, module_instance_ids: ['c', 'd'] },
        ],
        module_temperature_c: 25,
        irradiance_w_m2: 1000,
        spectrum: 'AM1.5g',
        tracker_id: null,
        battery_voltage_v: 24,
        controller_state: 'startup',
      },
    ],
  };
  return { ...f, records, panel, controller, scenario, add };
}
describe('source-reference PV physical and electrical diagnostic', () => {
  // Independent component identities deliberately share a model label. Source
  // evidence and reference meaning, rather than array order, must own Isc.
  function secondPanel(f: ReturnType<typeof fixture>, current: number) {
    const record = structuredClone(f.records[0]!);
    record.id = 'test.panel.second';
    record.engineering_profile.component_id = record.id;
    const d = record.engineering_profile.source_specification;
    d.product.id = record.id;
    for (const fact of d.facts) fact.id = record.id + '.' + fact.quantity;
    const isc = d.facts.find((fact) => fact.quantity === 'pv_isc')!;
    isc.original.value = String(current);
    isc.normalized.value = current;
    f.records.push(record);
    f.input.architecture.installation.component_instances!.find((i) => i.id === 'b')!.component_id =
      record.id;
    f.scenario.pv_arrays![0]!.strings = [{ series_count: 2, module_instance_ids: ['a', 'b'] }];
    return d;
  }
  it.each([
    ['a', 'b'],
    ['b', 'a'],
  ])('withholds unequal same-model series Isc for order %s/%s', (a, b) => {
    const f = fixture();
    secondPanel(f, 48);
    f.scenario.pv_arrays![0]!.strings[0]!.module_instance_ids = [a, b];
    const r = evaluateInstalledSourceDrafts(f.input, f.records, f.scenario);
    const current = r.binding.checks.find((c) => c.quantity === 'pv_isc')!;
    expect(current.status).toBe('UNRESOLVED');
    expect(current.trace).toBeUndefined();
    expect(current.fact_ids).toContain('test.panel.pv_isc');
    expect(current.fact_ids).toContain('test.panel.second.pv_isc');
    expect(r.binding.status).toBe('UNRESOLVED');
    expect(replayInstalledSourceDrafts(r)).toEqual(r);
    r.binding.checks.find((c) => c.quantity === 'pv_isc')!.status = 'ELIGIBLE';
    const { digest: _digest, ...body } = r;
    r.digest = passportDigest(body);
    expect(() => replayInstalledSourceDrafts(r)).toThrow();
  });
  it.each([
    ['a', 'b'],
    ['b', 'a'],
  ])('uses equivalent distinct records for order %s/%s', (a, b) => {
    const f = fixture();
    secondPanel(f, 12);
    f.scenario.pv_arrays![0]!.strings[0]!.module_instance_ids = [a, b];
    const r = evaluateInstalledSourceDrafts(f.input, f.records, f.scenario);
    const current = r.binding.checks.find((c) => c.quantity === 'pv_isc')!;
    expect(current.status).toBe('ELIGIBLE');
    expect(current.trace?.inputs.string_values).toEqual([12]);
    expect(r.binding.status).toBe('UNRESOLVED');
    expect(replayInstalledSourceDrafts(r)).toEqual(r);
  });
  it.each(['capture', 'revision', 'reference', 'manufacturer'] as const)(
    'withholds unproved %s equivalence even with equal Isc',
    (kind) => {
      const f = fixture(),
        d = secondPanel(f, 12);
      if (kind === 'capture') {
        d.sources[0]!.content_digest = 'sha256:' + 'b'.repeat(64);
        d.facts.forEach((fact) => {
          fact.context_digest = d.sources[0]!.content_digest;
        });
      }
      if (kind === 'revision') d.sources[0]!.document_revision = 'R2';
      if (kind === 'reference')
        d.facts.find((fact) => fact.quantity === 'pv_isc')!.conditions[0]!.value = 24;
      if (kind === 'manufacturer') {
        d.product.manufacturer = 'Other test author';
        d.sources[0]!.publisher = d.product.manufacturer;
        f.records[2]!.manufacturer = d.product.manufacturer;
      }
      expect(
        evaluateInstalledSourceDrafts(f.input, f.records, f.scenario).binding.checks.find(
          (c) => c.quantity === 'pv_isc',
        )?.status,
      ).toBe('UNRESOLVED');
    },
  );
  it.each(['voltage', 'independent_current', 'identity'] as const)(
    'retains independent %s NO beside unresolved series current',
    (kind) => {
      const f = fixture();
      secondPanel(f, 48);
      if (kind === 'voltage') {
        f.controller.facts[0]!.original.value = '90';
        f.controller.facts[0]!.normalized.value = 90;
      }
      if (kind === 'independent_current')
        f.scenario.uses.push({
          instance_id: 'controller',
          requirements: [
            {
              quantity: 'max_input_isc',
              mode: 'pv_input',
              direction: 'input',
              electrical_domain: 'dc',
              unit: 'A',
              value: 46,
              predicate: 'at_most',
              conditions: [],
            },
          ],
        });
      if (kind === 'identity') {
        Object.assign(f.records[2]!, { manufacturer_revision: 'R2' });
        f.records[2]!.engineering_profile.source_specification.product.hardware_revision = 'R1';
        expect(bindInstalledSourceDrafts(f.input, f.records, f.scenario).status).toBe('BLOCKED');
        // The diagnostic retains the known NO; the full passport also refuses
        // this deliberately inconsistent catalog instead of accepting ownership.
        expect(() => evaluateInstalledSourceDrafts(f.input, f.records, f.scenario)).toThrow();
        return;
      }
      const r = evaluateInstalledSourceDrafts(f.input, f.records, f.scenario);
      expect(r.binding.status).toBe('BLOCKED');
      expect(replayInstalledSourceDrafts(r)).toEqual(r);
    },
  );
  it('rejects repeated controller-wide groups instead of reusing a total input budget', () => {
    const f = fixture();
    const first = f.scenario.pv_arrays![0]!;
    first.strings = [{ series_count: 2, module_instance_ids: ['a', 'b'] }];
    f.scenario.pv_arrays!.push({
      ...first,
      strings: [{ series_count: 2, module_instance_ids: ['c', 'd'] }],
    });
    expect(() => evaluateInstalledSourceDrafts(f.input, f.records, f.scenario)).toThrow(
      'Ambiguous',
    );
  });
  it.each([
    'module_mode',
    'module_direction',
    'controller_basis',
    'controller_domain',
    'extra_condition',
  ] as const)('does not borrow %s into PV arithmetic', (kind) => {
    const f = fixture();
    if (kind === 'module_mode') f.panel.facts[0]!.mode = 'idle';
    if (kind === 'module_direction') f.panel.facts[0]!.direction = 'input';
    if (kind === 'controller_basis') f.controller.facts[0]!.basis = 'nominal';
    if (kind === 'controller_domain') f.controller.facts[0]!.electrical_domain = 'ac';
    if (kind === 'extra_condition')
      f.panel.facts[0]!.conditions.push({ key: 'unknown_constraint', value: true, unit: 'text' });
    expect(
      evaluateInstalledSourceDrafts(f.input, f.records, f.scenario).binding.checks.find(
        (c) => c.quantity === 'pv_voc',
      )?.status,
    ).toBe('UNRESOLVED');
  });
  it('uses exact 2S2P pieces and source reference, preserving wiring/tracker and hot-Vmp holds', () => {
    const f = fixture();
    const r = evaluateInstalledSourceDrafts(f.input, f.records, f.scenario);
    expect(r.binding.checks.find((c) => c.quantity === 'pv_voc')?.status).toBe('ELIGIBLE');
    expect(r.binding.checks.find((c) => c.quantity === 'pv_isc')?.reason).toContain('24 A');
    expect(r.binding.status).toBe('UNRESOLVED');
    expect(replayInstalledSourceDrafts(r)).toEqual(r);
  });
  it.each(['count', 'reuse', 'voltage', 'current'] as const)(
    'retains independent %s NO despite other unknowns',
    (kind) => {
      const f = fixture();
      const a = f.scenario.pv_arrays![0]!;
      if (kind === 'count') a.strings[0]!.series_count = 3;
      if (kind === 'reuse') a.strings[1]!.module_instance_ids = ['a', 'd'];
      if (kind === 'voltage')
        a.strings = [{ series_count: 4, module_instance_ids: ['a', 'b', 'c', 'd'] }];
      if (kind === 'current') {
        a.strings = ['a', 'b', 'c', 'd'].map((id) => ({
          series_count: 1,
          module_instance_ids: [id],
        }));
      }
      expect(evaluateInstalledSourceDrafts(f.input, f.records, f.scenario).binding.status).toBe(
        'BLOCKED',
      );
    },
  );
  it.each(['temperature', 'spectrum', 'inventory', 'tracker'] as const)(
    'withholds %s instead of making an envelope',
    (kind) => {
      const f = fixture();
      const a = f.scenario.pv_arrays![0]!;
      if (kind === 'temperature') a.module_temperature_c = 0;
      if (kind === 'spectrum') a.spectrum = null;
      if (kind === 'inventory') a.strings[0]!.module_instance_ids = null;
      if (kind === 'tracker') a.tracker_id = 'unproven';
      const r = evaluateInstalledSourceDrafts(f.input, f.records, f.scenario);
      expect(r.binding.status).toBe('UNRESOLVED');
      expect(r.binding.checks.some((c) => c.quantity === 'pv_voc' && c.status === 'ELIGIBLE')).toBe(
        false,
      );
    },
  );
  it.each([
    ['startup', 45, 'BLOCKED'],
    ['running', 49, 'UNRESOLVED'],
    ['running', 50, 'BLOCKED'],
    [null, 100, 'UNRESOLVED'],
  ] as const)('qualifies state %s before headroom/equality', (state, battery, status) => {
    const f = fixture();
    const a = f.scenario.pv_arrays![0]!;
    a.strings = [{ series_count: 1, module_instance_ids: ['a'] }];
    a.controller_state = state;
    a.battery_voltage_v = battery;
    const r = evaluateInstalledSourceDrafts(f.input, f.records, f.scenario);
    expect(r.binding.checks.find((c) => c.quantity === 'pv_state_headroom_necessary')?.status).toBe(
      status,
    );
  });
  it.each([
    ['%/K', -0.5, '58.75 V'],
    ['fraction/K', -0.005, '58.75 V'],
    ['V/K', -0.5, '67.5 V'],
  ] as const)('retains coefficient %s units and declared domain', (unit, value, expected) => {
    const f = fixture();
    const a = f.scenario.pv_arrays![0]!;
    a.strings = [{ series_count: 1, module_instance_ids: ['a'] }];
    a.module_temperature_c = -10;
    f.add(
      f.panel,
      'beta_voc',
      value,
      unit,
      [{ key: 'coefficient_temperature_c', value: { min: -10, max: 50 }, unit: 'degC' }],
      { basis: 'operating', mode: 'pv_coefficient' },
    );
    const r = evaluateInstalledSourceDrafts(f.input, f.records, f.scenario);
    expect(r.binding.checks.find((c) => c.quantity === 'pv_voc')?.reason).toContain(expected);
    a.module_temperature_c = -11;
    expect(
      evaluateInstalledSourceDrafts(f.input, f.records, f.scenario).binding.checks.find(
        (c) => c.quantity === 'pv_voc',
      )?.status,
    ).toBe('UNRESOLVED');
  });
});
