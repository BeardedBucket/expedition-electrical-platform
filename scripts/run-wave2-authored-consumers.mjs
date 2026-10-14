import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename, relative, isAbsolute } from 'node:path';
import assert from 'node:assert/strict';
import {
  evaluateInstalledSourceDrafts,
  replayInstalledSourceDrafts,
} from '../packages/engineering-core/dist/installed-source-draft-bridge.js';
import {
  evaluateInstalledOperating,
  replayInstalledOperating,
} from '../packages/engineering-core/dist/installed-operating-bridge.js';
import { generateArchitectures } from '../packages/engineering-core/dist/architecture-generation.js';
import {
  evaluateProductSelection,
  bindProductSelection,
} from '../packages/engineering-core/dist/product-selection.js';
import { FileIngestionJobStore } from '../packages/ingestion-runtime/dist/index.js';
import {
  LocalSnapshotStore,
  replaySourceCaptureSnapshot,
  artifactDigest,
} from '../packages/ingestion/dist/index.js';

const option = (k) => {
  const i = process.argv.indexOf(k);
  if (i < 0 || !process.argv[i + 1]) throw Error('Required ' + k);
  return resolve(process.argv[i + 1]);
};
const root = option('--input'),
  output = option('--output');
for (const p of [root, output]) {
  const r = relative(resolve('.'), p);
  if (
    (!isAbsolute(r) && !r.startsWith('..')) ||
    p.split(/[\\/]/).some((s) => ['.git', 'components', '.local-corpus-draft-archive'].includes(s))
  )
    throw Error('External bounded paths required');
}
if (basename(root) !== 'engineering-wave2-authored-private')
  throw Error('Exact authored private run required');
const run = JSON.parse(await readFile(join(root, 'AUTHORING_RUN_METADATA.json'), 'utf8'));
assert.equal(run.version, 'wave2-authored-run.v1');
const store = new FileIngestionJobStore(join(root, 'jobs')),
  snapshots = new LocalSnapshotStore(join(root, 'snapshots')),
  records = new Map();
for (const id of ['p25', 'p26', 'p07', 'p22', 'p23', 'p24', 'p10', 'p15']) {
  const row = run.results.find((r) => r.id === id);
  assert(row);
  const loaded = await store.loadVersioned(row.job_id);
  assert.equal(loaded.version, row.job_version);
  assert.equal(loaded.job.authored_draft_imports.at(-1).proposal_digest, row.proposal_digest);
  assert(!loaded.job.approval && !loaded.job.human_adjudications?.length);
  for (const j of row.source_jobs) {
    const job = await store.load(j.id);
    for (const c of job.preparation.captures.filter((c) => c.disposition === 'authoritative'))
      assert.equal((await replaySourceCaptureSnapshot(c, snapshots)).status, 'replayed');
  }
  const record = JSON.parse(await readFile(join(root, id + '.component-proposal.json'), 'utf8'));
  assert.equal(
    artifactDigest(record.engineering_profile.source_specification),
    artifactDigest(loaded.job.authored_draft_imports.at(-1).proposal.draft),
  );
  records.set(id, record);
}
// These project-owned design assumptions assert no installed wiring, chosen
// tracker or protection. Each physical member is an explicit independent item.
const system = (pairs, voltage) => ({
  requirements: {
    id: 'wave2.authored.demo',
    house_domain_id: 'house',
    supplies: [],
    load_states: [],
    battery_banks: [],
  },
  assumptions: [
    {
      id: 'explicit_demo',
      origin: 'project',
      statement: `Provisional ${voltage} V house intent. No source adjudication or installation proof; independent 12/24/48 V alternatives.`,
    },
  ],
  architecture: {
    installation: {
      schema_version: '1.0.0',
      id: 'wave2.authored.demo',
      name: 'Source-grounded unreviewed diagnostic',
      status: 'selected',
      component_instances: pairs.map(([instance, id]) => ({
        id: instance,
        component_id: records.get(id).id,
        status: 'selected',
      })),
    },
    power_topology: {
      domains: [
        { id: 'house', kind: 'dc', nominal_voltage_v: voltage },
        { id: 'load12', kind: 'dc', nominal_voltage_v: 12 },
        { id: 'pv', kind: 'pv_dc' },
      ],
      bindings: [],
      edges: [],
    },
  },
});
const catalog = [...records.values()],
  results = [];
const req = (
  quantity,
  value,
  unit,
  mode,
  direction,
  electrical_domain = 'dc',
  conditions = [],
) => ({
  quantity,
  value,
  unit,
  mode,
  direction,
  electrical_domain,
  predicate:
    quantity === 'ac_phase' ? 'equals' : quantity.endsWith('_range') ? 'within_range' : 'at_most',
  conditions,
});
const cond = (key, value, unit) => ({ key, value, unit });
function evaluate(name, pairs, voltage, uses, pv_arrays, expected) {
  const input = system(pairs, voltage);
  const scenario = {
    version: 'installed-source-draft-scenario.v1',
    uses,
    ...(pv_arrays ? { pv_arrays } : {}),
  };
  const full = evaluateInstalledSourceDrafts(input, catalog, scenario);
  assert.deepEqual(replayInstalledSourceDrafts(JSON.parse(JSON.stringify(full))), full);
  assert.equal(full.binding.status, expected);
  results.push({ name, authority: 'unreviewed_provisional_diagnostic', evaluation: full });
}
for (const id of ['p25', 'p26'])
  for (const [ns, np] of [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ]) {
    const pairs = [['mppt', 'p07']],
      strings = [];
    for (let p = 0; p < np; p++) {
      const members = [];
      for (let s = 0; s < ns; s++) {
        const member = `${id}.${p}.${s}`;
        pairs.push([member, id]);
        members.push(member);
      }
      strings.push({ series_count: ns, module_instance_ids: members });
    }
    evaluate(
      `${id}.${ns}S${np}P.reference`,
      pairs,
      24,
      [],
      [
        {
          controller_instance_id: 'mppt',
          strings,
          module_temperature_c: 25,
          irradiance_w_m2: 1000,
          spectrum: 'AM1.5g',
          tracker_id: null,
          battery_voltage_v: 24,
          controller_state: 'startup',
        },
      ],
      id === 'p25' && ns === 1 ? 'BLOCKED' : 'UNRESOLVED',
    );
    if (ns === 2 && np === 2)
      evaluate(
        `${id}.hot75.no_coefficient_domain`,
        pairs,
        24,
        [],
        [
          {
            controller_instance_id: 'mppt',
            strings,
            module_temperature_c: 75,
            irradiance_w_m2: 1000,
            spectrum: 'AM1.5g',
            tracker_id: null,
          },
        ],
        'UNRESOLVED',
      );
  }
evaluate(
  'p26.4S.absolute_voc_no',
  [['mppt', 'p07'], ...Array.from({ length: 4 }, (_, i) => ['m' + i, 'p26'])],
  48,
  [],
  [
    {
      controller_instance_id: 'mppt',
      strings: [{ series_count: 4, module_instance_ids: ['m0', 'm1', 'm2', 'm3'] }],
      module_temperature_c: 25,
      irradiance_w_m2: 1000,
      spectrum: 'AM1.5g',
      tracker_id: null,
    },
  ],
  'BLOCKED',
);
for (const voltage of [12, 24, 48])
  for (const id of ['p22', 'p23']) {
    const conditions = [
      cond('input_voltage_v', voltage, 'V'),
      cond('ambient_temperature_c', 25, 'degC'),
      cond('orientation', 'vertical', 'text'),
      cond('altitude_m', 1000, 'm'),
    ];
    evaluate(
      `${id}.${voltage}to12.50W`,
      [['converter', id]],
      voltage,
      [
        {
          instance_id: 'converter',
          requirements: [
            req('input_voltage_range', voltage, 'V', 'dc_conversion', 'input'),
            req('output_voltage_range', 12, 'V', 'dc_conversion', 'output'),
            req('output_power', 50, 'W', 'dc_conversion', 'output', 'dc', conditions),
          ],
        },
      ],
      null,
      (id === 'p22' && voltage === 24) || (id === 'p23' && voltage === 48)
        ? 'UNRESOLVED'
        : 'BLOCKED',
    );
  }
evaluate(
  'epoch24.actual25_6.Bto12',
  [
    ['battery', 'p24'],
    ['converter', 'p22'],
  ],
  24,
  [
    {
      instance_id: 'battery',
      requirements: [req('operating_voltage_range', 25.6, 'V', 'battery', 'bidirectional')],
    },
    {
      instance_id: 'converter',
      requirements: [
        req('input_voltage_range', 25.6, 'V', 'dc_conversion', 'input'),
        req('output_voltage_range', 12, 'V', 'dc_conversion', 'output'),
        req('output_current', 50 / 12, 'A', 'dc_conversion', 'output', 'dc', [
          cond('input_voltage_v', 25.6, 'V'),
          cond('output_voltage_v', 12, 'V'),
          cond('ambient_temperature_c', 25, 'degC'),
          cond('orientation', 'vertical', 'text'),
        ]),
      ],
    },
  ],
  null,
  'UNRESOLVED',
);
evaluate(
  'converter.low_input9A.no10A',
  [['converter', 'p22']],
  24,
  [
    {
      instance_id: 'converter',
      requirements: [
        req('output_current', 10, 'A', 'dc_conversion', 'output', 'dc', [
          cond('input_voltage_v', 20, 'V'),
          cond('output_voltage_v', 12, 'V'),
          cond('ambient_temperature_c', 25, 'degC'),
          cond('orientation', 'vertical', 'text'),
        ]),
      ],
    },
  ],
  null,
  'BLOCKED',
);
evaluate(
  'converter.installed60C.no',
  [['converter', 'p22']],
  24,
  [
    {
      instance_id: 'converter',
      requirements: [req('installed_ambient_max', 60, 'degC', 'mounting', 'none', 'none')],
    },
  ],
  null,
  'BLOCKED',
);
for (const heater of ['after_heating', 'not_after_heating'])
  evaluate(
    'epoch.cold.' + heater,
    [['battery', 'p24']],
    24,
    [
      {
        instance_id: 'battery',
        requirements: [
          req('battery_cell_charge_range', -1, 'degC', 'charge', 'input', 'dc', [
            cond('measurement_point', 'battery_cell', 'text'),
            cond('heater_state', heater, 'text'),
          ]),
        ],
      },
    ],
    null,
    heater === 'after_heating' ? 'BLOCKED' : 'UNRESOLVED',
  );
for (const [a, mv] of [
  [500, 50],
  [250, 75],
]) {
  const input = system([['monitor', 'p10']], 24),
    scenario = {
      version: 'installed-operating-scenario.v1',
      uses: [
        {
          instance_id: 'monitor',
          monitoring: {
            quantity: 'dc_current',
            max_error_percent: 1,
            basis: 'reading',
            current_path_a: 300,
            shunt_current_a: a,
            shunt_drop_mv: mv,
            measurement_path: 'external_shunt',
          },
        },
      ],
    };
  const full = evaluateInstalledOperating(input, catalog, scenario);
  assert.deepEqual(replayInstalledOperating(full), full);
  assert.equal(full.binding.status, 'UNRESOLVED');
  results.push({
    name: `bmv.actual${a}A.${mv}mV`,
    authority: 'unreviewed_provisional_diagnostic',
    evaluation: full,
  });
}
evaluate(
  'bmv.independent_supply71V.no',
  [['monitor', 'p10']],
  24,
  [
    {
      instance_id: 'monitor',
      requirements: [req('input_voltage_range', 71, 'V', 'supply', 'input')],
    },
  ],
  null,
  'BLOCKED',
);
for (const v of [12, 24, 48])
  evaluate(
    `samlex.inverting.${v}V`,
    [['inverter', 'p15']],
    v,
    [
      {
        instance_id: 'inverter',
        requirements: [req('input_voltage_range', v, 'V', 'inverting', 'input')],
      },
    ],
    null,
    v === 12 ? 'UNRESOLVED' : 'BLOCKED',
  );
evaluate(
  'samlex.3000VA.no',
  [['inverter', 'p15']],
  12,
  [
    {
      instance_id: 'inverter',
      requirements: [
        req('output_apparent_power', 3000, 'VA', 'inverting', 'output', 'ac', [
          cond('ambient_temperature_c', 25, 'degC'),
          cond('power_factor', 0.95, 'fraction'),
        ]),
      ],
    },
  ],
  null,
  'BLOCKED',
);
evaluate(
  'samlex.split_phase.no',
  [['inverter', 'p15']],
  12,
  [
    {
      instance_id: 'inverter',
      requirements: [req('ac_phase', 'split_phase', 'text', 'inverting', 'output', 'ac')],
    },
  ],
  null,
  'BLOCKED',
);
evaluate(
  'samlex.epoch29_2V.charge.no',
  [
    ['charger', 'p15'],
    ['battery', 'p24'],
  ],
  24,
  [
    {
      instance_id: 'charger',
      requirements: [req('output_voltage_range', 29.2, 'V', 'charging', 'output')],
    },
  ],
  null,
  'BLOCKED',
);
evaluate(
  'samlex.shared_charge100A.held',
  [['charger', 'p15']],
  12,
  [
    {
      instance_id: 'charger',
      requirements: [
        req('charge_current', 100, 'A', 'charging', 'output', 'dc', [
          cond('ambient_temperature_c', 25, 'degC'),
        ]),
      ],
    },
  ],
  null,
  'UNRESOLVED',
);
const phase5 = [];
for (const voltage of [12, 24, 48]) {
  const generation = generateArchitectures({
    schema_version: '2.0.0',
    assumptions: [],
    requirements: {
      id: 'wave2.authored.selection',
      fixed_house_voltage_v: voltage,
      loads: [
        { id: 'load12', domain: { kind: 'dc', nominal_voltage_v: 12 }, required_power_w: 50 },
      ],
      charging_sources: [],
      storage: { required: false },
    },
  });
  const selection = evaluateProductSelection({
    schema_version: '1.0.0',
    generation,
    candidate_id: generation.candidates[0].id,
    corpus: [records.get('p22'), records.get('p23')],
    fixed_existing: [],
    assemblies: [],
  });
  phase5.push({ voltage, selection });
  if (voltage === 24 || voltage === 48) {
    const id = voltage === 24 ? 'p22' : 'p23',
      role = selection.roles[0],
      candidate = role.candidates.find((c) => c.component_id === records.get(id).id),
      binding = candidate?.bindings.find(
        (b) =>
          Object.values(b.witness.interfaces).every((v) => v !== null) &&
          Object.values(b.witness.paths).every((v) => v !== null),
      );
    assert(binding, 'Manufacturer-described TB1/TB2 path must supply a real conversion witness');
    const bound = bindProductSelection(
      selection,
      [{ role_id: role.role.id, component_id: records.get(id).id, binding_id: binding.id }],
      {
        installed_source_drafts: {
          version: 'installed-source-draft-scenario.v1',
          uses: [
            {
              instance_id: role.role.id,
              requirements: [req('input_voltage_range', voltage, 'V', 'dc_conversion', 'input')],
            },
          ],
        },
      },
    );
    assert.equal(bound.source_draft_binding.status, 'UNRESOLVED');
    assert(bound.input.requirements.mandatory_conditions.some((c) => c.id === role.role.id));
    phase5.at(-1).handoff = bound;
  }
}
await writeFile(
  output,
  JSON.stringify(
    {
      version: 'wave2-real-authored-consumers.v1',
      assumptions: [
        'All manufacturer facts remain Codex-prepared/unreviewed',
        '50 W / 12 V = 4.166666666666667 A is a project demand conversion, not a manufacturer rating',
        'No physical wire, tracker, protection, neutral/grounding or certification proof',
      ],
      results,
      phase5,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  `${results.length} genuine provisional Phase3/operating demonstrations; 3 Phase5 voltage intents; 2 real directed conversion handoffs; portable replay passed`,
);
