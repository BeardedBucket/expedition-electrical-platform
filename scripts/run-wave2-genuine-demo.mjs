import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename, relative, isAbsolute } from 'node:path';
import {
  evaluateInstalledPv,
  evaluateInstalledOperating,
  replayInstalledOperating,
} from '../packages/engineering-core/dist/engineering-passport.js';
import { generateArchitectures } from '../packages/engineering-core/dist/architecture-generation.js';
import { evaluateProductSelection } from '../packages/engineering-core/dist/product-selection.js';
import {
  replaySourceCaptureSnapshot,
  LocalSnapshotStore,
} from '../packages/ingestion/dist/index.js';
import {
  IngestionJobService,
  FileIngestionJobStore,
} from '../packages/ingestion-runtime/dist/index.js';
const at = process.argv.indexOf('--input');
if (at < 0 || !process.argv[at + 1]) throw new Error('Explicit genuine private --input required');
const root = resolve(process.argv[at + 1]);
const rel = relative(resolve('.'), root);
if (
  basename(root) !== 'engineering-corpus-wave2-private' ||
  (!isAbsolute(rel) && !rel.startsWith('..')) ||
  root.split(/[\\/]/).some((p) => ['components', '.git', '.local-corpus-draft-archive'].includes(p))
)
  throw new Error('Invalid private demo root');
const run = JSON.parse(await readFile(join(root, 'RUN_METADATA.json'), 'utf8'));
if (run.version !== 'wave2-durable-review-run.v1') throw new Error('Unsupported genuine run');
const service = new IngestionJobService({
  store: new FileIngestionJobStore(join(root, 'jobs')),
  preparationRequest: () => {
    throw new Error('Demo cannot prepare, decide or recapture');
  },
});
const records = new Map();
for (const id of ['p25', 'p26', 'p07', 'p24', 'p10', 'p22', 'p23']) {
  const row = run.results.find((r) => r.investigation_id === id);
  if (!row) throw new Error(`Missing genuine prerequisite ${id}`);
  const job = await service.getJob(row.job_id);
  if (job.preparation?.status !== 'review_ready' || job.approval || job.human_adjudications?.length)
    throw new Error('Expected provisional undecided job');
  for (const capture of job.preparation.captures.filter((c) => c.disposition === 'authoritative')) {
    const replay = await replaySourceCaptureSnapshot(
      capture,
      new LocalSnapshotStore(join(root, 'snapshots')),
    );
    if (replay.status !== 'replayed')
      throw new Error(`Genuine byte gate failed: ${replay.issue.code}`);
  }
  if (['p22', 'p23'].includes(id)) {
    // Real retained converter intakes have no usable candidate/typed meaning.
    // Keep identity-only placeholders explicitly unverified; no PDF column
    // values, ports or conversion paths are fabricated to satisfy the 12 V load.
    records.set(id, {
      id: `wave2-intake.${id}`,
      manufacturer: job.intake.manufacturer,
      model: job.intake.product_model,
      verification_status: 'unverified',
      manufacturer_revision: null,
      source_refs: [
        {
          id: id + '.source',
          source_uri: job.intake.official_product_uri,
          title:
            'Retained genuine converter intake; exact family/output source interpretation and conversion witness remain unresolved',
        },
      ],
    });
    continue;
  }
  const saved = JSON.parse(await readFile(join(root, `${id}.readonly-preview.json`), 'utf8'));
  if (
    saved.authority !== 'unreviewed_readonly_preview_not_human_decision' ||
    !saved.preview.candidate?.engineering_profile
  )
    throw new Error('Missing explicitly provisional typed preview');
  const p = saved.preview.candidate.engineering_profile;
  records.set(id, {
    id: p.component_id,
    manufacturer: job.intake.manufacturer,
    model: p.model,
    verification_status: 'unverified',
    manufacturer_revision: null,
    engineering_profile: p,
    source_refs: [
      {
        id: id + '.source',
        source_uri: job.intake.official_product_uri,
        title: 'Private genuine source; source correction preview has not been saved by a human',
      },
    ],
  });
}
// These are explicit project demonstration intents, not an actual installation.
// Missing product ports, tracker/terminal identity and wire/protection proof stay
// missing. Do not create fake interfaces merely to materialize a Phase 5 witness.
const system = (ids, voltage) => ({
  requirements: {
    id: 'wave2.provisional.demo',
    house_domain_id: 'house',
    supplies: [],
    load_states: [],
    battery_banks: [],
  },
  assumptions: [
    {
      id: 'demo',
      origin: 'project',
      statement: `Provisional source-backed diagnostic; ${voltage} V house is a supplied design intent, with 12/24/48 V alternatives. No physical connectivity, thermal/protection/bonding certification or approval is asserted.`,
    },
  ],
  architecture: {
    installation: {
      schema_version: '1.0.0',
      id: 'wave2.demo',
      name: 'Unapproved genuine-source diagnostic',
      status: 'selected',
      component_instances: ids.map((id) => ({
        id,
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
const all = [...records.values()];
const outputs = [];
for (const voltage of [12, 24, 48]) {
  const generation = generateArchitectures({
    schema_version: '2.0.0',
    assumptions: [],
    requirements: {
      id: 'wave2.domain-intent',
      fixed_house_voltage_v: voltage,
      loads: [{ id: 'dc12', domain: { kind: 'dc', nominal_voltage_v: 12 }, required_power_w: 30 }],
      charging_sources: [
        { id: 'solar', kind: 'solar', domain: { kind: 'pv_dc' }, required_output_power_w: 100 },
      ],
      storage: { required: true },
    },
  });
  const selection = evaluateProductSelection({
    schema_version: '1.0.0',
    generation,
    candidate_id: generation.candidates[0].id,
    corpus: all,
    fixed_existing: [],
    assemblies: [],
  });
  outputs.push({
    case: `phase5-${voltage}V-domain-intent`,
    scope:
      'product-independent architecture and genuine provisional corpus; no selected port/path witness fabricated',
    selection_digest: selection.result_digest,
    roles: selection.roles.map((r) => ({
      id: r.role.id,
      function: r.role.function,
      candidates: r.candidates.map((c) => ({
        component_id: c.component_id,
        status: c.status,
        reasons: c.bindings.flatMap((b) =>
          b.gates.filter((g) => g.truth !== 'YES').map((g) => g.reason),
        ),
      })),
    })),
  });
  await writeFile(
    join(root, `demo-phase5-${voltage}.json`),
    JSON.stringify(selection, null, 2) + '\n',
    { flag: 'wx' },
  );
}
const pvInput = system(['p25', 'p07', 'p24', 'p22'], 24);
const pvScenario = {
  version: 'installed-pv-scenario.v2',
  controller_instance_id: 'p07',
  module_instances: { string: [{ instance_id: 'p25', port_id: 'source_output_unproved' }] },
  pv: {
    controller_id: records.get('p07').id,
    strings: [
      {
        id: 'string',
        module_id: records.get('p25').id,
        series_count: 1,
        tracker_id: 'pv_input_unassigned',
        terminal_id: 'source_input_unproved',
      },
    ],
    battery_nominal_v: 24,
  },
};
for (const [label, count] of [
  ['provisional-pv-mppt-battery', 1],
  ['known-physical-count-contradiction', 2],
]) {
  pvScenario.pv.strings[0].series_count = count;
  const r = evaluateInstalledPv(pvInput, all, pvScenario);
  outputs.push({
    case: label,
    status: r.binding.status,
    envelope_present: Boolean(r.binding.envelope),
    reasons: r.binding.reason_codes,
    inherited_passport: r.passport.decisions.find((d) => d.id === 'inherited:installed_pv')?.status,
    source_ids: ['p25', 'p07', 'p24', 'p22'],
    physical_edges_added: 0,
  });
  await writeFile(join(root, `demo-${label}.json`), JSON.stringify(r, null, 2) + '\n', {
    flag: 'wx',
  });
}
const operatingInput = system(['p24', 'p10'], 24);
for (const [label, temperature, current] of [
  ['provisional-battery-monitor', 10, 40],
  ['known-cold-cell-with-unknown-measurement-limit', -5, 600],
]) {
  const scenario = {
    version: 'installed-operating-scenario.v1',
    uses: [
      {
        instance_id: 'p24',
        battery: {
          operation: 'charge',
          temperature: {
            value_c: temperature,
            measurement_point: 'battery_cell',
            rationale:
              'Explicit demonstration cell-temperature assumption; ambient is not substituted',
          },
          heater_state: 'after_heating',
          series_count: 2,
          parallel_count: 1,
          matched_bank: true,
          requires_bms_recovery: true,
        },
      },
      {
        instance_id: 'p10',
        monitoring: {
          quantity: 'dc_current',
          max_error_percent: 0.5,
          basis: 'reading',
          measurement_path: 'external_shunt',
          current_path_a: current,
          shunt_current_a: 500,
          shunt_drop_mv: 50,
        },
      },
    ],
  };
  const r = evaluateInstalledOperating(operatingInput, all, scenario);
  replayInstalledOperating(r);
  outputs.push({
    case: label,
    status: r.binding.status,
    checks: r.binding.checks,
    inherited_passport: r.passport.decisions.find((d) => d.id === 'inherited:installed_operating')
      ?.status,
    source_ids: ['p24', 'p10'],
  });
  await writeFile(join(root, `demo-${label}.json`), JSON.stringify(r, null, 2) + '\n', {
    flag: 'wx',
  });
}
const summary = {
  version: 'wave2-genuine-demo-summary.v1',
  authority: 'genuine_bytes_and_unreviewed_readonly_meaning_previews_not_human_decisions',
  full_outputs_private: true,
  outputs,
};
await writeFile(join(root, 'DEMO_METADATA.json'), JSON.stringify(summary, null, 2) + '\n', {
  flag: 'wx',
});
console.log(JSON.stringify(summary, null, 2));
