import { expect, it } from 'vitest';
import {
  evaluateInstalledPv,
  bindInstalledPv,
  replayInstalledPv,
  type InstalledPvScenario,
} from '../src/installed-pv-bridge.js';
import { solarFixture } from './fixtures/engineering-envelope.js';
import { completeInstalledSystemFixture } from './fixtures/whole-system.js';
import type { ComponentLibraryRecord } from '../src/component-library.js';
import { generateArchitectures } from '../src/architecture-generation.js';
import { evaluateProductSelection, bindProductSelection } from '../src/product-selection.js';
import { evaluateInstalledSystem } from '../src/engineering-passport.js';
function fixture() {
  const e = solarFixture(),
    f = completeInstalledSystemFixture();
  const catalog: ComponentLibraryRecord[] = [
    ...f.catalog,
    ...e.profiles.map((p) => ({
      id: p.component_id,
      model: p.model,
      manufacturer: 'Synthetic test authors',
      manufacturer_revision: p.manufacturer_revision,
      verification_status: 'unverified' as const,
      engineering_profile: p,
      ports: [
        {
          id: p.pv ? 'output' : 'input',
          domain: 'dc' as const,
          direction: p.pv ? ('output' as const) : ('input' as const),
        },
      ],
    })),
  ];
  const input = {
    ...f.input,
    architecture: {
      ...f.input.architecture,
      installation: {
        ...f.input.architecture.installation,
        component_instances: [
          ...(f.input.architecture.installation.component_instances ?? []),
          { id: 'pv.module', component_id: 'module', status: 'installed' as const },
          { id: 'pv.controller', component_id: 'controller', status: 'installed' as const },
        ],
      },
      power_topology: {
        ...f.input.architecture.power_topology,
        domains: [
          ...f.input.architecture.power_topology.domains,
          { id: 'pv', kind: 'pv_dc' as const },
        ],
        bindings: [
          ...f.input.architecture.power_topology.bindings,
          { id: 'pv.out', instance_id: 'pv.module', port_id: 'output', domain_id: 'pv' },
          { id: 'pv.in', instance_id: 'pv.controller', port_id: 'input', domain_id: 'pv' },
        ],
      },
    },
  };
  const scenario: InstalledPvScenario = {
    version: 'installed-pv-scenario.v2',
    controller_instance_id: 'pv.controller',
    module_instances: { s0: [{ instance_id: 'pv.module', port_id: 'output' }] },
    pv: e.pv!,
  };
  return { input, catalog, scenario };
}
it('safe complete synthetic model passes the envelope but cannot grant installed authority', () => {
  const f = fixture(),
    r = evaluateInstalledPv(f.input, f.catalog, f.scenario);
  expect(r.binding.envelope!.result.envelope_status).toBe('ELIGIBLE');
  expect(r.binding.status).toBe('UNRESOLVED');
  expect(r.passport.decisions.find((d) => d.id === 'inherited:installed_pv')?.status).toBe(
    'unresolved',
  );
  expect(r.binding.reason_codes).toContain('wiring_and_protection_design');
  expect(replayInstalledPv(JSON.parse(JSON.stringify(r)))).toEqual(r);
  r.binding.scenario.pv.cell_min_c = -20;
  expect(() => replayInstalledPv(r)).toThrow('replay');
});
it.each(['voc', 'isc', 'tracker', 'terminal'])(
  'known %s NO survives missing unrelated facts through actual passport',
  (kind) => {
    const f = fixture(),
      p = f.catalog.find((r) => r.id === 'controller')!.engineering_profile!;
    if (kind === 'voc') p.trackers![0]!.absolute_voc_v!.value = 20;
    if (kind === 'isc') p.trackers![0]!.max_isc_a!.value = 5;
    if (kind === 'tracker') f.scenario.pv.strings[0]!.tracker_id = 'wrong';
    if (kind === 'terminal')
      f.input.architecture.power_topology.domains.find((d) => d.id === 'pv')!.kind = 'dc';
    p.manufacturer_revision = null;
    p.evidence[0]!.manufacturer_revision = null;
    delete f.catalog.find((r) => r.id === 'controller')!.manufacturer_revision;
    const r = evaluateInstalledPv(f.input, f.catalog, f.scenario);
    expect(r.binding.status).toBe('BLOCKED');
    expect(r.passport.decisions.find((d) => d.id === 'inherited:installed_pv')?.status).toBe(
      'blocked',
    );
  },
);
it.each(['coefficient', 'domain', 'revision', 'profile'])(
  'missing %s and source-only profiles remain unknown',
  (kind) => {
    const f = fixture(),
      m = f.catalog.find((r) => r.id === 'module')!;
    if (kind === 'coefficient') delete m.engineering_profile!.pv!.coefficients;
    if (kind === 'domain') delete m.engineering_profile!.pv!.coefficients!.voc!.cell_domain_c;
    if (kind === 'revision') {
      delete m.manufacturer_revision;
      m.engineering_profile!.manufacturer_revision = null;
      m.engineering_profile!.evidence[0]!.manufacturer_revision = null;
    }
    if (kind === 'profile') delete m.engineering_profile;
    const r = evaluateInstalledPv(f.input, f.catalog, f.scenario);
    expect(r.binding.status).toBe('UNRESOLVED');
  },
);
it('commercial changes cannot influence mandatory diagnostics', () => {
  const f = fixture(),
    a = evaluateInstalledPv(f.input, f.catalog, f.scenario);
  f.catalog[0]!.price = 0;
  f.catalog[0]!.affiliate_score = 100;
  const b = evaluateInstalledPv(f.input, f.catalog, f.scenario);
  expect(b.binding.status).toBe(a.binding.status);
  expect(b.binding.reason_codes).toEqual(a.binding.reason_codes);
});
function selectedFixture() {
  const e = solarFixture();
  const controller: ComponentLibraryRecord = {
    id: 'controller',
    manufacturer: 'Invented fixture',
    model: e.profiles[1]!.model,
    manufacturer_revision: 'invented-r1',
    verification_status: 'unverified',
    engineering_profile: e.profiles[1],
    capabilities: [{ id: 'solar', type: 'solar_energy_conversion' }],
    ports: [
      { id: 'input', domain: 'dc', direction: 'input', voltage_v: 24 },
      { id: 'battery', domain: 'dc', direction: 'output', voltage_v: 12, power_w: 200 },
    ],
    power_paths: [{ id: 'charge', capability_id: 'solar', from_port: 'input', to_port: 'battery' }],
  };
  const module: ComponentLibraryRecord = {
    id: 'module',
    manufacturer: 'Invented fixture',
    model: e.profiles[0]!.model,
    manufacturer_revision: 'invented-r1',
    verification_status: 'unverified',
    engineering_profile: e.profiles[0],
    ports: [{ id: 'output', domain: 'dc', direction: 'output', voltage_v: 24 }],
  };
  const generation = generateArchitectures({
    schema_version: '2.0.0',
    assumptions: [],
    requirements: {
      id: 'pv.test',
      fixed_house_voltage_v: 12,
      loads: [],
      charging_sources: [
        {
          id: 'solar',
          kind: 'solar',
          domain: { kind: 'pv_dc', nominal_voltage_v: 24 },
          required_output_power_w: 100,
        },
      ],
      storage: { required: false },
    },
  });
  const selection = evaluateProductSelection({
    schema_version: '1.0.0',
    generation,
    candidate_id: generation.candidates[0]!.id,
    corpus: [controller],
    fixed_existing: [],
    assemblies: [],
  });
  const role = selection.roles[0]!,
    product = role.candidates[0]!,
    binding = product.bindings.find((b) => Object.values(b.witness.interfaces).includes('input'))!;
  const scenario: InstalledPvScenario = {
    version: 'installed-pv-scenario.v2',
    controller_instance_id: role.role.id,
    module_instances: { s0: [{ instance_id: 'installed.module', port_id: 'output' }] },
    pv: e.pv!,
  };
  const choices = [{ role_id: role.role.id, component_id: 'controller', binding_id: binding.id }];
  const options = {
    installed_pv: scenario,
    pv_modules: [
      {
        instance_id: 'installed.module',
        record: module,
        port_id: 'output',
        source_endpoint_id: 'domain.source.solar',
      },
    ],
  };
  return { e, controller, module, selection, scenario, choices, options };
}
it('connects an actual Phase 5 solar witness and explicit source module to the Phase 3 mandatory gate', () => {
  const { controller, module, selection, scenario, choices, options } = selectedFixture();
  const bound = bindProductSelection(selection, choices, options);
  expect(bound.pv_binding!.status).toBe('UNRESOLVED');
  expect(
    bound.input.architecture.power_topology.bindings.find(
      (b) => b.instance_id === 'installed.module',
    )?.port_id,
  ).toBe('output');
  expect(
    bound.input.architecture.power_topology.edges.some((e) => e.id.startsWith('pv-wire.')),
  ).toBe(false);
  expect(bound.pv_binding!.envelope!.result.envelope_status).toBe('ELIGIBLE');
  expect(
    evaluateInstalledSystem(bound.input, bound.catalog).decisions.find(
      (d) => d.id === 'inherited:installed_pv',
    )?.status,
  ).toBe('unresolved');
  controller.engineering_profile!.trackers![0]!.absolute_voc_v!.value = 20;
  const changedSelection = evaluateProductSelection({ ...selection.input, corpus: [controller] });
  const changedRole = changedSelection.roles[0]!,
    changedBinding = changedRole.candidates[0]!.bindings.find((b) =>
      Object.values(b.witness.interfaces).includes('input'),
    )!;
  const bad = bindProductSelection(
    changedSelection,
    [{ role_id: changedRole.role.id, component_id: 'controller', binding_id: changedBinding.id }],
    {
      installed_pv: scenario,
      pv_modules: [
        {
          instance_id: 'installed.module',
          record: module,
          port_id: 'output',
          source_endpoint_id: 'domain.source.solar',
        },
      ],
    },
  );
  expect(bad.pv_binding!.status).toBe('BLOCKED');
  expect(evaluateInstalledSystem(bad.input, bad.catalog).result.status).toBe('blocked');
});

it.each([
  'absent',
  'unknown',
  'input',
  'bidirectional',
  'ac',
  'endpoint',
  'orphan',
  'scenario-port',
])('refuses exact Phase 5 PV materialization for %s witness', (kind) => {
  const f = selectedFixture();
  if (kind === 'absent') delete f.module.ports;
  if (kind === 'unknown') f.module.ports![0]!.id = 'different';
  if (kind === 'input') f.module.ports![0]!.direction = 'input';
  if (kind === 'bidirectional') f.module.ports![0]!.direction = 'bidirectional';
  if (kind === 'ac') f.module.ports![0]!.domain = 'ac';
  if (kind === 'endpoint') f.options.pv_modules[0]!.source_endpoint_id = 'house';
  if (kind === 'orphan')
    f.options.pv_modules.push({ ...f.options.pv_modules[0]!, instance_id: 'orphan' });
  if (kind === 'scenario-port') f.scenario.module_instances.s0![0]!.port_id = 'undeclared';
  expect(() => bindProductSelection(f.selection, f.choices, f.options)).toThrow();
});

function physicalFixture(ns: number, np: number) {
  const f = fixture();
  f.scenario.pv = solarFixture(ns, np).pv!;
  f.scenario.module_instances = {};
  const instances = f.input.architecture.installation.component_instances!;
  const topology = f.input.architecture.power_topology;
  instances.splice(
    instances.findIndex((i) => i.id === 'pv.module'),
    1,
  );
  topology.bindings.splice(
    topology.bindings.findIndex((b) => b.id === 'pv.out'),
    1,
  );
  for (const string of f.scenario.pv.strings) {
    const members = Array.from({ length: ns }, (_, i) => ({
      instance_id: `pv.${string.id}.${i}`,
      port_id: 'output',
    }));
    f.scenario.module_instances[string.id] = members;
    for (const m of members) {
      instances.push({ id: m.instance_id, component_id: 'module', status: 'installed' });
      topology.bindings.push({ id: `${m.instance_id}.out`, ...m, domain_id: 'pv' });
    }
  }
  return f;
}
it.each([
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
])('binds %iS%iP to distinct physical pieces with exact replay', (ns, np) => {
  const f = physicalFixture(ns, np),
    r = evaluateInstalledPv(f.input, f.catalog, f.scenario);
  expect(r.binding.physical_inventory).toHaveLength(ns * np);
  expect(new Set(r.binding.physical_inventory.map((m) => m.instance_id)).size).toBe(ns * np);
  expect(r.binding.physical_inventory.every((m) => m.manufacturer_revision === 'invented-r1')).toBe(
    true,
  );
  expect(r.binding.envelope!.result.calculations.some((c) => c.inputs.Ns === ns)).toBe(true);
  expect(r.binding.envelope!.result.calculations.some((c) => c.inputs.Np === np)).toBe(true);
  expect(r.binding.status).toBe('UNRESOLVED');
  expect(r.binding.reason_codes).toContain('pv_series_parallel_connection_proof_unmodeled');
  expect(replayInstalledPv(JSON.parse(JSON.stringify(r)))).toEqual(r);
  r.binding.physical_inventory[0]!.instance_id = 'tampered';
  expect(() => replayInstalledPv(r)).toThrow('replay');
});
it.each(['shared', 'count', 'wrong-model', 'wrong-revision', 'wrong-port', 'wrong-domain'])(
  'blocks known %s physical contradiction and withholds fabricated calculations',
  (kind) => {
    const f = physicalFixture(1, 2);
    if (kind === 'shared') f.scenario.module_instances.s1 = f.scenario.module_instances.s0;
    if (kind === 'count') f.scenario.module_instances.s0 = [];
    if (kind === 'wrong-model') f.scenario.pv.strings[0]!.module_id = 'different';
    if (kind === 'wrong-revision')
      f.catalog.find((r) => r.id === 'module')!.manufacturer_revision = 'other-revision';
    if (kind === 'wrong-port')
      f.catalog.find((r) => r.id === 'module')!.ports![0]!.direction = 'input';
    if (kind === 'wrong-domain')
      f.input.architecture.power_topology.bindings.find(
        (b) => b.instance_id === 'pv.s0.0',
      )!.domain_id = 'house';
    if (kind === 'wrong-revision') {
      expect(bindInstalledPv(f.input, f.catalog, f.scenario).status).toBe('BLOCKED');
      expect(bindInstalledPv(f.input, f.catalog, f.scenario).envelope).toBeNull();
      expect(() => evaluateInstalledPv(f.input, f.catalog, f.scenario)).toThrow(
        'owner/model/revision',
      );
      return;
    }
    const r = evaluateInstalledPv(f.input, f.catalog, f.scenario);
    expect(r.binding.status).toBe('BLOCKED');
    expect(r.binding.envelope).toBeNull();
    expect(r.passport.decisions.find((d) => d.id === 'inherited:installed_pv')?.status).toBe(
      'blocked',
    );
  },
);
it.each(['inventory', 'instance', 'port', 'binding', 'controller-binding', 'topology-domain'])(
  'keeps missing %s evidence unresolved',
  (kind) => {
    const f = physicalFixture(1, 1);
    if (kind === 'inventory') delete f.scenario.module_instances.s0;
    if (kind === 'instance') f.scenario.module_instances.s0![0]!.instance_id = 'missing';
    if (kind === 'port') delete f.catalog.find((r) => r.id === 'module')!.ports;
    if (kind === 'binding')
      f.input.architecture.power_topology.bindings =
        f.input.architecture.power_topology.bindings.filter((b) => b.instance_id !== 'pv.s0.0');
    if (kind === 'controller-binding')
      f.input.architecture.power_topology.bindings =
        f.input.architecture.power_topology.bindings.filter(
          (b) => b.instance_id !== 'pv.controller',
        );
    if (kind === 'topology-domain') {
      f.input.architecture.power_topology.domains =
        f.input.architecture.power_topology.domains.filter((d) => d.id !== 'pv');
      f.input.architecture.power_topology.bindings =
        f.input.architecture.power_topology.bindings.filter((b) => b.domain_id !== 'pv');
    }
    const r = evaluateInstalledPv(f.input, f.catalog, f.scenario);
    expect(r.binding.status).toBe('UNRESOLVED');
    if (['inventory', 'instance', 'port'].includes(kind)) expect(r.binding.envelope).toBeNull();
    expect(replayInstalledPv(r)).toEqual(r);
  },
);
it('known envelope NO precedes missing connection proof; v1 inventory is explicitly rejected', () => {
  const f = fixture();
  f.input.architecture.power_topology.bindings =
    f.input.architecture.power_topology.bindings.filter((b) => b.instance_id !== 'pv.controller');
  f.catalog.find(
    (r) => r.id === 'controller',
  )!.engineering_profile!.trackers![0]!.absolute_voc_v!.value = 20;
  expect(evaluateInstalledPv(f.input, f.catalog, f.scenario).binding.status).toBe('BLOCKED');
  const legacy = {
    ...f.scenario,
    version: 'installed-pv-scenario.v1',
    module_instances: { s0: 'pv.module' },
  };
  expect(() =>
    evaluateInstalledPv(f.input, f.catalog, legacy as unknown as InstalledPvScenario),
  ).toThrow('v1 physical inventory is unprovable');
  const r = evaluateInstalledPv(f.input, f.catalog, f.scenario);
  r.binding.scenario = legacy as unknown as InstalledPvScenario;
  expect(() => replayInstalledPv(r)).toThrow('v1 physical inventory is unprovable');
});
