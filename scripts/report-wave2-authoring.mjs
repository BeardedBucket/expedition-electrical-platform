import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join, basename, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { parseSourceGroundedDraft } from '../packages/engineering-core/dist/source-grounded-draft.js';
import { projectAuthoredComponent, artifactDigest } from '../packages/ingestion/dist/index.js';
import { validateComponentLibraryRecord } from '../packages/engineering-core/dist/component-library.js';
import { format, resolveConfig } from 'prettier';
const option = (k) => {
  const i = process.argv.indexOf(k);
  if (i < 0 || !process.argv[i + 1]) throw Error('Required ' + k);
  return resolve(process.argv[i + 1]);
};
const input = option('--input'),
  output = option('--output');
for (const p of [input, output]) {
  const r = relative(resolve('.'), p);
  if (
    (!isAbsolute(r) && !r.startsWith('..')) ||
    p.split(/[\\/]/).some((s) => ['.git', 'components', '.local-corpus-draft-archive'].includes(s))
  )
    throw Error('Explicit external roots required');
}
if (basename(input) !== 'engineering-wave2-authored-private')
  throw Error('Exact authoring run required');
const parse = (b) => JSON.parse(b.toString('utf8').replace(/^\uFEFF/, ''));
const run = parse(await readFile(join(input, 'AUTHORING_RUN_METADATA.json')));
const requirementsBytes = await readFile('data/ingestion/engineering-wave2/requirements.json'),
  requirements = parse(requirementsBytes);
const ledger = parse(await readFile('data/ingestion/engineering-wave2/readiness-ledger.json'));
if (
  run.version !== 'wave2-authored-run.v1' ||
  ledger.version !== 'wave2-product-readiness-ledger.v2'
)
  throw Error('Explicit authored versions required');
const regular = new Set([
  'input_voltage_range',
  'output_voltage_range',
  'operating_voltage_range',
  'charge_voltage_max',
  'output_power',
  'output_apparent_power',
  'output_current',
  'input_current_max',
  'charge_current',
  'discharge_current',
  'ac_phase',
  'ambient_temperature_range',
  'battery_cell_charge_range',
  'clearance_above',
  'clearance_below',
  'clearance_left',
  'clearance_right',
  'installed_ambient_max',
  'max_input_isc',
  'max_input_voc',
  'shunt_measurement_max',
  'measurement_current_range',
  'measurement_voltage_range',
]);
const pv = new Set([
  'pv_voc',
  'pv_isc',
  'beta_voc',
  'alpha_isc',
  'startup_delta_v',
  'running_delta_v',
]);
const projected = new Set([
  'pv_vmp',
  'pv_imp',
  'pv_pmax',
  'reference_module_temperature',
  'reference_irradiance',
  'reference_spectrum',
  'max_system_voltage',
  'gamma_pmax',
  'series_count_max',
  'parallel_count_max',
  'reference_shunt_current',
  'reference_shunt_drop',
  'current_accuracy_percent',
  'voltage_accuracy_percent',
  'output_voltage_nominal',
]);
const products = [],
  sources = [];
await mkdir(join(output, 'PRODUCT_DRAFTS'), { recursive: true });
const json = async (name, value) =>
  writeFile(
    join(output, name),
    await format(JSON.stringify(value), {
      ...(await resolveConfig('package.json')),
      parser: 'json',
    }),
  );
for (const id of ['p25', 'p26', 'p07', 'p22', 'p23', 'p24', 'p10', 'p15']) {
  const row = run.results.find((r) => r.id === id);
  if (!row) throw Error('Missing product ' + id);
  const draft = parseSourceGroundedDraft(
      parse(await readFile(`data/ingestion/engineering-wave2/authored-drafts/${id}.json`)),
    ),
    component = projectAuthoredComponent(draft);
  if (
    !validateComponentLibraryRecord(component).ok ||
    artifactDigest(component) !==
      artifactDigest(parse(await readFile(join(input, id + '.component-proposal.json'))))
  )
    throw Error('Component export drift ' + id);
  await json(`PRODUCT_DRAFTS/${id}.draft.json`, draft);
  await json(`PRODUCT_DRAFTS/${id}.component-proposal.json`, component);
  await copyFile(
    join(input, id + '.proposal.json'),
    join(output, 'PRODUCT_DRAFTS', id + '.proposal.json'),
  );
  const facts = draft.facts.map((f) => ({
    ...f,
    product_id: id,
    exact_model: draft.product.model,
    drafted_field: `engineering_profile.source_specification.facts[id=${f.id}]`,
    schema_disposition:
      f.disposition === 'evidence_ambiguity'
        ? 'evidence_ambiguity'
        : 'new_closed_provenance_fact_contract',
    consumer_disposition:
      f.disposition === 'evidence_ambiguity'
        ? 'withheld_ambiguity'
        : regular.has(f.quantity) && f.disposition === 'typed_consumer'
          ? 'conditional_Phase3_and_Phase5_comparison'
          : pv.has(f.quantity)
            ? 'source_reference_PV_consumer_with_explicit_prerequisites'
            : projected.has(f.quantity)
              ? 'existing_typed_projection_preserves_optional_unknowns'
              : draft.ports?.some((p) => p.source_fact_ids.includes(f.id)) ||
                  draft.power_paths?.some((p) => p.source_fact_ids.includes(f.id))
                ? 'directional_Phase5_port_path_witness'
                : 'retained_source_fact_no_engineering_decision_consumer',
    engineering_consumer_gap:
      !regular.has(f.quantity) && !pv.has(f.quantity) && !projected.has(f.quantity)
        ? 'Structured for source review; stateful, geometric, protection or protocol applicability is not implemented by this scalar comparison registry'
        : null,
  }));
  const original = requirements.products.find((p) => p.id === id);
  products.push({
    id,
    model: draft.product.model,
    intended_use: draft.intended_use,
    frozen_intended_use: original.intended_use,
    required_assertion_names: original.required_assertions,
    facts,
    holds: draft.holds,
    stages: {
      studied: true,
      captured: true,
      automatic_candidate: ledger.products.find((p) => p.id === id).durable_run.pending_candidate,
      codex_authored: true,
      partial_fact_reviewable: true,
      intended_use_review_ready: false,
      human_reviewed: false,
      approved: false,
      promoted: false,
      independently_verified: false,
    },
    completion_basis:
      'Complete fact inventory of the examined source regions, not a claim that every manufacturer publication or all installed configurations has been covered',
    gap_classification: {
      a: 'Additional exact-variant/hardware and installation evidence remains uncaptured',
      b: 'Direct reasoning authored facts even when native extraction failed/missed fields; extraction no longer gates drafting',
      c: 'Model/variant/document reconciliation and all source interpretations require human review',
      d: 'Source conditions represented; detailed curves, stateful controls and installed geometry have no complete engineering model',
      e: 'Scalar/directional/PV/operating consumers implemented; retained descriptive and dynamic facts cannot prove system suitability',
      f:
        id === 'p23'
          ? 'C input33.6–67.2 V excludes a supplied24V intent'
          : id === 'p15'
            ? '12V inverter/charger ranges contradict24/48V DC use and single-phase excludes split-phase output'
            : null,
      g: draft.holds.filter((h) => !h.includes('human review')),
    },
  });
  sources.push(
    ...draft.sources.map((s) => ({
      ...s,
      product_id: id,
      job_id: row.source_jobs.find((j) => j.source_id === s.id).id,
      byte_count: row.source_jobs.find((j) => j.source_id === s.id).byte_count,
      source_body_included: false,
      semantic_status: 'codex_prepared_unreviewed',
    })),
  );
}
const factCount = products.reduce((n, p) => n + p.facts.length, 0);
// Reporting-only support overlap. This cannot certify a frozen intended-use
// assertion, and is never passed to extraction, import or engineering rules.
const agenda = {
  pmax_w: ['pv_pmax'],
  voc_v: ['pv_voc'],
  vmp_v: ['pv_vmp'],
  isc_a: ['pv_isc'],
  imp_a: ['pv_imp'],
  reference_cell_temperature: ['reference_module_temperature'],
  reference_irradiance_spectrum: ['reference_irradiance', 'reference_spectrum'],
  quantity_coefficients_domains: ['beta_voc', 'alpha_isc', 'gamma_pmax'],
  uncertainty: ['pmax_tolerance'],
  system_voltage_series_fuse: ['max_system_voltage'],
  absolute_pv_voc: ['max_input_voc'],
  operating_start_restart_voltage: ['startup_delta_v', 'running_delta_v'],
  pv_isc_imp: ['max_input_isc'],
  battery_voltage_charge_current: ['battery_voltage_selection', 'charge_current'],
  conditional_pv_power_clipping: ['nominal_pv_power'],
  direction_input_output: [
    'internal_power_direction',
    'input_terminal_assignments',
    'output_terminal_assignments',
  ],
  input_range: ['input_voltage_range'],
  output_voltage_current_power: ['output_voltage_range', 'output_current', 'output_power'],
  peak_duration_conditions: ['output_current_peak', 'peak_loading_pattern'],
  isolation_scope: ['isolation_test_voltage_io', 'isolation_test_voltage_fg'],
  lockout_recovery: ['input_turn_on', 'input_turn_off', 'overload_behavior'],
  thermal_derating: ['low_input_derating_reference', 'performance_curves', 'installed_ambient_max'],
  nominal_v_ah_wh: ['nominal_voltage', 'capacity', 'energy'],
  charge_voltage_current: ['charge_voltage_max', 'recommended_charge_current', 'charge_current'],
  discharge_continuous_peak_duration: ['discharge_current'],
  bms_cutoff_recovery: ['bms_functions'],
  temperature_heater_policy: [
    'battery_cell_charge_range',
    'charge_temperature_range_with_heating',
    'internal_heater',
  ],
  series_parallel_permission: ['series_count_max', 'parallel_count_max', 'bank_matching'],
  supply_consumption: ['input_voltage_range', 'supply_current_less_than'],
  measurement_participants: ['measurement_path', 'shunt_configuration'],
  accuracy_denominator_conditions: ['current_accuracy_percent', 'voltage_accuracy_percent'],
  shunt_a_mv_transfer: ['reference_shunt_current', 'reference_shunt_drop'],
  included_optional_accessories: ['alternative_shunts', 'temperature_sensor', 'included_cables'],
  battery_envelope: ['input_voltage_range', 'output_voltage_range', 'charge_current'],
  mode_specific_ac_conductors: [
    'ac_phase',
    'output_voltage_nominal',
    'neutral_bond_inverting',
    'neutral_bond_charging',
  ],
  w_va_pf_surge_duration: [
    'output_apparent_power',
    'output_power',
    'surge_apparent_power',
    'surge_current',
  ],
  shared_capacity_exclusions: [
    'ac_shared_current_rule',
    'charge_thermal_reduction',
    'external_dc_compensation',
  ],
  ground_neutral_transfer: [
    'neutral_bond_inverting',
    'neutral_bond_charging',
    'transfer_topology',
    'transfer_capacity',
  ],
  idle_thermal_installation: ['idle_power', 'cooling', 'clearance_surrounding_greater_than'],
};
for (const p of products)
  p.intended_use_assertions = p.required_assertion_names.map((name) => ({
    name,
    proposed_support_fact_ids: p.facts
      .filter((f) => (agenda[name] ?? []).includes(f.quantity))
      .map((f) => f.id),
    complete_required_assertion_verified: false,
    status:
      name === 'exact_identity_revision'
        ? 'exact_model_proposed_hardware_revision_unknown'
        : 'partial_proposed_support_or_evidence_hold',
    remaining_prerequisites: p.holds.slice(2),
    interpretation:
      'Support overlap only; full qualifiers and product-specific holds require human review. Installation evidence remains distinct from component-data adequacy.',
  }));
const inventory = {
  version: 'wave2-direct-engineering-inventory.v1',
  authority: 'codex_prepared_unreviewed',
  products,
};
await json('COMPREHENSIVE_ENGINEERING_FACT_INVENTORY.json', inventory);
await json('PRODUCT_AUTHORING_COVERAGE.json', {
  version: 'wave2-direct-coverage.v1',
  products: products.map(({ facts, ...p }) => ({
    ...p,
    fact_count: facts.length,
    source_fact_mappings: facts.map((f) => ({
      id: f.id,
      quantity: f.quantity,
      drafted_field: f.drafted_field,
      consumer_disposition: f.consumer_disposition,
      disposition: f.disposition,
      conditions: f.conditions,
      unresolved_conditions: f.unresolved_conditions,
      source_id: f.source_id,
      locator: f.locator,
      context_digest: f.context_digest,
    })),
  })),
  counts: {
    products: 8,
    fact_proposals: factCount,
    source_bindings: sources.length,
    intended_use_review_ready: 0,
  },
  requirements_sha256: createHash('sha256').update(requirementsBytes).digest('hex'),
  historical_extraction: {
    visible: 341,
    eligible: 254,
    page2: 77,
    page2_complete: 46,
    rerun: false,
  },
  limitation:
    'No accepted-fact coverage percentage. Direct authored fact proposals are counted independently of frozen historical extraction denominators; no automatic extraction gain is claimed.',
});
await json('SOURCE_RECEIPTS.json', {
  sources,
  redistribution:
    'Original source bodies, screenshots, page dumps and private jobs excluded; metadata and authored limited facts only',
  examined_rejected_association: {
    source: 'p24-manual',
    model_named: 'B24100B',
    reason: 'Not exact B24100A-C; no ratings transferred',
  },
});
await json('PRODUCT_READINESS_LEDGER.json', ledger);
await json('AUTHORING_RUN_METADATA.json', run);
const summary = products
  .map(
    (p) =>
      `| ${p.id} | ${p.model} | ${p.facts.length} | Partial fact review | ${p.holds.slice(2).join('; ')} |`,
  )
  .join('\n');
for (const name of [
  'COMPREHENSIVE_ENGINEERING_FACT_INVENTORY.md',
  'PRODUCT_AUTHORING_COVERAGE.md',
  'PRODUCT_READINESS_LEDGER.md',
])
  await writeFile(
    join(output, name),
    `# Direct-source authoring and engineering coverage\n\nEight model-owned drafts retain ${factCount} fact proposals and ${sources.length} source bindings. All are Codex-prepared/unreviewed. Each fact's original unit/value, normalization, basis, direction, mode, conditions and complete-context locator/hash is in the JSON inventory. Retained source facts are not discarded when a consumer cannot yet use them.\n\n| ID | Model | Facts | Stage | Specific remaining prerequisites |\n| --- | --- | ---: | --- | --- |\n${summary}\n\nThe original intended-use-complete goal was not fully reached: zero of eight satisfy the frozen complete inventories. Hardware applicability, protection/connector evidence, coefficient domains, BMS/measurement conditions and stateful AC/thermal behavior remain product-specific holds. These eight drafts are ready for partial source-fact review, not installed-system certification. Human-source-reviewed, approved, promoted and independently verified remain zero. Historical47/37/21 investigation/capture states and automatic256/35/5 observations/proposals/candidates are preserved separately in the ledger; direct authoring adds no historical product IDs.\n\nCoverage is bounded to the genuine sources actually examined. Missing in those sources does not assert the manufacturer never publishes it. Categories a–g distinguish uncaptured evidence, extractor failure, human association, schema semantics, consumer deficiency, physical contradiction and insufficient source. Detailed dynamic controls, protection/recovery, protocol interoperability and installed geometry remain explicit gaps rather than scalar limits.\n`,
  );
console.log(
  JSON.stringify({
    products: products.length,
    fact_proposals: factCount,
    source_bindings: sources.length,
    component_schema_validated: 8,
  }),
);
