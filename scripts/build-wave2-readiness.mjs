import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { format, resolveConfig } from 'prettier';
const option = (key) => {
  const i = process.argv.indexOf(key);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`Required ${key}`);
  return resolve(process.argv[i + 1]);
};
const campaign = option('--campaign');
const runRoot = option('--run');
for (const [root, leaf] of [
  [campaign, 'engineering-corpus-wave1-private'],
  [runRoot, 'engineering-corpus-wave2-private'],
]) {
  const rel = relative(resolve('.'), root);
  if (
    basename(root) !== leaf ||
    (!isAbsolute(rel) && !rel.startsWith('..')) ||
    root
      .split(/[\\/]/)
      .some((p) => ['.git', 'components', '.local-corpus-draft-archive'].includes(p))
  )
    throw new Error('Explicit private campaign/run roots required');
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const oldBytes = await readFile('data/ingestion/engineering-wave1/inventory.json');
const old = JSON.parse(oldBytes);
const requirementsBytes = await readFile('data/ingestion/engineering-wave2/requirements.json');
// Independent assertion names are used only AFTER production processing, for
// reporting. Neither this oracle nor its match patterns reaches extraction.
const requirements = JSON.parse(requirementsBytes);
const run = JSON.parse(await readFile(join(runRoot, 'RUN_METADATA.json'), 'utf8'));
const previews = JSON.parse(await readFile(join(runRoot, 'PREVIEW_METADATA.json'), 'utf8'));
const authoredAt = process.argv.indexOf('--authored-run');
const authoredRoot = authoredAt >= 0 ? option('--authored-run') : null;
if (authoredRoot) {
  const rel = relative(resolve('.'), authoredRoot);
  if (
    basename(authoredRoot) !== 'engineering-wave2-authored-private' ||
    (!isAbsolute(rel) && !rel.startsWith('..')) ||
    authoredRoot
      .split(/[\\/]/)
      .some((p) => ['components', '.git', '.local-corpus-draft-archive'].includes(p))
  )
    throw Error('Explicit external authored run required');
}
const authored = authoredRoot
  ? JSON.parse(await readFile(join(authoredRoot, 'AUTHORING_RUN_METADATA.json'), 'utf8'))
  : null;
if (
  authored &&
  (authored.version !== 'wave2-authored-run.v1' ||
    authored.results.length !== 8 ||
    new Set(authored.results.map((r) => r.id)).size !== 8 ||
    authored.results.some(
      (r) =>
        r.authority !== 'codex_prepared_unreviewed' ||
        r.human_source_decisions ||
        r.approved ||
        r.promoted ||
        r.verified,
    ))
)
  throw Error('Unreviewed exact eight authored results required');
if (
  old.schema_version !== 'wave1-product-ledger.v1' ||
  requirements.schema_version !== 'wave2-required-assertions.v1' ||
  run.version !== 'wave2-durable-review-run.v1' ||
  previews.version !== 'wave2-readonly-previews.v1'
)
  throw new Error('Unknown readiness input version');
const next = {
  p25: 'Open the durable job, inspect/load five native quantity corrections; obtain exact revision, cell reference/irradiance/spectrum, coefficient domains/Vmp coefficient, uncertainty, fuse and connectors before intended-use completeness.',
  p26: 'Review the distinct 24J source and its five corrections independently; do not transfer 12J quantities/reference conditions. Obtain the missing exact reference, coefficient/domain, uncertainty, protection and revision proof.',
  p07: 'Review the literal MPPT 150/45 header and absolute-Voc correction. Independently identify retail variant/revision, tracker and terminals, operating-limit quantity basis and startup/current/power conditions; do not treat a manual header as an ordering code.',
  p22: 'Inspect the complete manufacturer PDF family/output axes and all footnotes before selecting DDR-120B-12 values. Frozen incorrect associations remain a hold; no PDF column repair or complete source-meaning qualification was established.',
  p23: 'Independently inspect the C input-family and 12V output column, input direction, peak duration and thermal/derating/recovery conditions. B-family facts cannot supply C-family assertions.',
  p24: 'Review source-owned B24100A-C rows and four conditional corrections; obtain source-complete BMS cutoff/recovery/current/installation/terminal/revision evidence. Cell range is not ambient permission or a BMS curve.',
  p15: 'Use a complete exact EVO-2212 official specification/manual source to establish mode/direction/table ownership. Duplicate page headings and unsupported native shape currently yield zero ordinary facts; retain the hold rather than a cropped source claim.',
  p10: 'Review the new technical HTML against the retained PDF, then inspect three instrument corrections. Obtain accuracy denominator/range/temperature/calibration and exact shunt/accessory revision/measurement-path proof; do not map shunt amperes to monitor or battery throughput.',
};
const quantities = {
  pmax_w: ['pmax_w'],
  voc_v: ['voc_v'],
  vmp_v: ['vmp_v'],
  isc_a: ['isc_a'],
  imp_a: ['imp_a'],
  absolute_pv_voc: ['pv_absolute_voc_v'],
  temperature_heater_policy: ['battery_cell_charge_range_c', 'battery_discharge_range_c'],
  series_parallel_permission: ['battery_series_max_count', 'battery_parallel_max_count'],
  accuracy_denominator_conditions: [
    'instrument_current_accuracy_percent',
    'instrument_voltage_accuracy_percent',
  ],
  shunt_a_mv_transfer: ['instrument_shunt_rating'],
};
const products = [];
for (const p of old.products) {
  if (!/^p\d{2}$/.test(p.id)) throw new Error('Invalid historical investigation ID');
  let capture = null;
  if (p.states.retained === true) {
    const receipt = JSON.parse(await readFile(join(campaign, `${p.id}.capture.json`), 'utf8'));
    if (
      receipt.investigation_id !== p.id ||
      receipt.body_file !== `${p.id}.source` ||
      receipt.status !== 'success' ||
      receipt.source_digest !== p.current_campaign?.source_digest
    )
      throw new Error(`Retained historical receipt changed: ${p.id}`);
    const bytes = await readFile(join(campaign, `${p.id}.source`));
    if (sha(bytes) !== receipt.source_digest || bytes.length !== receipt.byte_count)
      throw new Error(`Retained historical bytes changed: ${p.id}`);
    capture = {
      url: receipt.final_uri,
      retrieved_at: receipt.retrieved_at,
      sha256: receipt.source_digest,
      size: bytes.length,
      rights: receipt.rights,
      receipt_id: `${p.id}.capture.json`,
      byte_digest_verified: true,
      publisher_authentication: 'separate_from_digest_not_independently_human_adjudicated',
      exact_part_revision_source_conditions: 'not_established_by_receipt',
    };
  }
  const required = requirements.products.find((r) => r.id === p.id);
  const actual = run.results.find((r) => r.investigation_id === p.id);
  const preview = previews.results.find((r) => r.investigation_id === p.id);
  products.push({
    id: p.id,
    manufacturer: p.manufacturer,
    investigation_model: p.exact_model ?? p.model,
    historical_states: p.states,
    historical_sources: p.sources,
    retained_capture_reconciliation: capture ?? {
      status: 'not_inspected_no_retained_capture_claim_in_historical_ledger',
      current_absence_not_asserted: true,
    },
    selected: Boolean(required),
    intended_use: required?.intended_use ?? p.intended_use,
    required_assertions: (required?.required_assertions ?? p.required_assertions).map((name) => {
      const support =
        preview?.suggestions.filter((s) => (quantities[name] ?? []).includes(s.quantity)) ?? [];
      return {
        name,
        inventory_origin: required ? 'wave2_independent_frozen' : 'wave1_historical_not_reassessed',
        native_support: support.map((s) => ({
          quantity: s.quantity,
          source_label: s.source_label,
          citations: s.citations,
          original_fact_ids: s.replaces_fact_ids,
        })),
        status: !required
          ? 'not_reassessed'
          : support.length
            ? 'native_literal_supported_pending_human_meaning_and_full_qualifiers'
            : 'source_or_representation_or_intended_use_prerequisite_unresolved',
        complete_required_assertion_verified: false,
        next_action:
          name === 'exact_identity_revision'
            ? 'Establish independent exact part/hardware revision and retained source ownership; document revision does not establish hardware revision'
            : support.length
              ? 'Inspect full containing source and prospective correction; deliberately preview/save only after human meaning/context review'
              : 'Inspect the complete cited source, distinguish omission from missed extraction/representation, and retain a precise unresolved prerequisite; not-found is not inferred',
      };
    }),
    durable_run: actual
      ? {
          job_id: actual.job_id,
          state: actual.state,
          source_digest: actual.source_digest,
          source_identity: actual.source_identity,
          pipeline_qualified_observations: actual.qualified_fact_count,
          proposals: actual.proposed_fact_count,
          projected_proposals: actual.projected_proposal_count,
          pending_candidate: actual.candidate_present,
          review_snapshot: actual.review_snapshot,
          source_and_condition_correctness: ['p22', 'p23'].includes(p.id)
            ? 'not_independently_accepted_historical_wrong_association_hold'
            : 'unreviewed_source_observations_not_approved_engineering_facts',
        }
      : null,
    readonly_preview: preview
      ? {
          typed_profile_present: preview.preview_profile_present,
          quantity_count: preview.suggestions.length,
          assertion_ids: preview.preview_assertions.map((a) => a.id),
          authority: preview.authority,
          human_events_written: preview.human_events_written,
          error: preview.error,
        }
      : null,
    wave2_intended_use_review_ready: false,
    wave2_human_source_decisions: 0,
    wave2_approvals: 0,
    wave2_promotions: 0,
    wave2_engineering_verifications: 0,
    next_human_action:
      next[p.id] ??
      (p.id === 'p06'
        ? 'COMVOLT publisher/model identity HOLD; obtain independently identified primary publisher and exact model before importing any fact'
        : 'Historical held investigation; preserve its original prerequisites and perform explicit source/intended-use review before advancing'),
  });
}
const ledger = {
  version: authored ? 'wave2-product-readiness-ledger.v2' : 'wave2-product-readiness-ledger.v1',
  starting_head: requirements.starting_head,
  requirements_sha256: sha(requirementsBytes),
  historical_inventory_sha256: sha(oldBytes),
  authority: 'metadata_only_task_scope_no_global_canonical_absence_claim',
  counts: {
    horizon: products.length,
    historical_investigated: products.filter((p) => p.historical_states.investigated).length,
    historical_retained_bytes_reconciled: products.filter(
      (p) => p.retained_capture_reconciliation.byte_digest_verified,
    ).length,
    selected: run.results.length,
    pipeline_qualified_observations: run.results.reduce((s, r) => s + r.qualified_fact_count, 0),
    ordinary_pending_candidates: run.results.filter((r) => r.candidate_present).length,
    ordinary_projected_proposals: run.results.reduce((s, r) => s + r.projected_proposal_count, 0),
    readonly_typed_previews: previews.results.filter((r) => r.preview_profile_present).length,
    readonly_quantity_suggestions: previews.results.reduce((s, r) => s + r.suggestions.length, 0),
    intended_use_review_ready: 0,
    human_source_decisions: 0,
    approved: 0,
    promoted: 0,
    independently_verified: 0,
    ...(authored
      ? {
          codex_authored_products: authored.results.length,
          codex_authored_fact_proposals: authored.results.reduce((s, r) => s + r.fact_count, 0),
          partial_fact_reviewable: authored.results.filter((r) => r.status === 'partial_reviewable')
            .length,
        }
      : {}),
  },
  limitations: [
    'Pipeline qualification counts are observations, including MEAN WELL association holds, not fully source-supported usable assertions',
    'Read-only prospective human-event shapes are not saved source decisions',
    'No independent hardware revision or complete selected intended-use inventory was established',
    'Historical 341/254 and 77 denominators are separate; the coincidental 256 current observations are not an improved historical denominator',
    'Canonical/protected/unscanned locations are not included in these product-state claims',
  ],
  products,
};
// Preserve historical pipeline states/assertions rather than rewriting their
// meaning with later direct-document authoring. Distinct stage metadata is an
// explicit v2 addition; source/requirements identity remains unchanged.
if (authored)
  for (const product of products) {
    const a = authored.results.find((r) => r.id === product.id);
    if (a) {
      product.codex_authoring = a;
      product.next_human_action =
        'Inspect attached authored proposal and complete original context; use direct-authoring runbook. Original complete intended-use and all authority gates remain held.';
    }
  }
await writeFile(
  'data/ingestion/engineering-wave2/readiness-ledger.json',
  // Use the same formatter as CI, deterministically, rather than excluding the
  // generated report. Input receipts and frozen requirements are never rewritten.
  await format(JSON.stringify(ledger), {
    ...(await resolveConfig('data/ingestion/engineering-wave2/readiness-ledger.json')),
    parser: 'json',
  }),
);
console.log(JSON.stringify(ledger.counts, null, 2));
