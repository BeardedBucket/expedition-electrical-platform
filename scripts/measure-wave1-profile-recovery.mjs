import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  suggestEngineeringProfileSources,
  nativeModelGridObservations,
} from '../packages/ingestion/dist/index.js';

// Explicit inputs only; no TEMP defaults, recursive inventory, followed embedded
// paths, live fetching, oracle values or publisher text in measurement output.
const option = (k) => {
  const i = process.argv.indexOf(k);
  if (i < 0 || !process.argv[i + 1]) throw Error(`Required ${k}`);
  return resolve(process.argv[i + 1]);
};
const observations = option('--observations'),
  campaign = option('--campaign'),
  auditPath = option('--audit');
for (const p of [observations, campaign, auditPath])
  if (
    p.split(/[\\/]/).includes('.local-corpus-draft-archive') ||
    p.includes('ekrano-gx-bpp900480100')
  )
    throw Error('Prohibited input');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const auditBytes = await readFile(auditPath);
if (sha(auditBytes) !== 'c45228d88f6997067569065a872cb094124b2560413c38a8be72af5eea38629a')
  throw Error('Frozen audit changed');
// Audit is read only to validate identity. Its expected values are never passed
// to the production adapter; denominator populations remain historical.
const frozen = [
  [
    'victron-bmv-712',
    'BMV-712 Smart',
    'b09ef2001d990e09edea6d2f4655c09870b2c6f98be9cdcb951f88a7339adcde',
  ],
  [
    'morningstar-sunsaver-10l',
    'SS-10L-12V',
    '0a4060d282abcba7bc988b5bb438215d8164916ef4f3117692f7d57b535b7b70',
  ],
  [
    'samlex-evo-2212',
    'EVO-2212',
    'c438b4815d3dcc982cee83ea09de98ad161a5c40e4d835b1fd5fd4844a55fda3',
  ],
];
const rows = [];
for (const [key, model, hash] of frozen) {
  const bytes = await readFile(join(observations, 'outputs', 'pdfplumber-text', key + '.json'));
  if (sha(bytes) !== hash) throw Error('Frozen observation changed');
  const o = JSON.parse(bytes);
  if (o.page !== 2 || typeof o.text !== 'string') throw Error('Wrong original page');
  const ref = {
    kind: 'source_capture',
    reference_schema_version: '1.0',
    digest_algorithm: 'sha256',
    digest: 'sha256:' + hash,
  };
  const intake = {
    schema_version: '1.0',
    artifact_kind: 'product_intake',
    id: 'measurement.' + key,
    manufacturer: 'Frozen source observation',
    product_model: model,
    official_product_uri: o.source.source_uri,
  };
  const doc = {
    schema_version: '1.0',
    artifact_kind: 'document_extraction',
    id: 'observation.' + key,
    source_capture: ref,
    source_acquisition: { ...ref, kind: 'source_acquisition' },
    status: 'extracted',
    capability_state: 'automatic_extraction_available',
    remediation_state: 'none_required',
    extractor: 'frozen-pdfplumber-observation',
    extractor_version: o.version,
    blocks: [{ id: 'page2', kind: 'text', content: o.text, locator: { kind: 'pdf', page: 2 } }],
  };
  const start = performance.now(),
    s = suggestEngineeringProfileSources(intake, [doc]);
  rows.push({
    population: 'original_frozen_page2',
    key,
    sha256: hash,
    suggestions: s.length,
    new_usable_assertions: 0,
    wrong_or_competing_accepted: 0,
    elapsed_ms: Number((performance.now() - start).toFixed(3)),
    limitation:
      'Observed page text only; not a rerun of PDF extraction or original production captures',
  });
}
const inventory = JSON.parse(await readFile('data/ingestion/engineering-wave1/inventory.json'));
for (const id of ['p25', 'p26', 'p07', 'p08']) {
  const product = inventory.products.find((p) => p.id === id);
  const receipt = JSON.parse(await readFile(join(campaign, id + '.capture.json')));
  const sourceBytes = await readFile(join(campaign, id + '.source'));
  if (
    receipt.status !== 'success' ||
    sha(sourceBytes) !== receipt.source_digest ||
    receipt.source_digest !== product.current_campaign.source_digest
  )
    throw Error('Held-out exact source mismatch');
  const preparation = JSON.parse(await readFile(join(campaign, id + '.production-review-v1.json')));
  if (preparation.status !== 'review_ready') throw Error('Missing ordinary production preparation');
  const start = performance.now(),
    s = suggestEngineeringProfileSources(preparation.intake, preparation.document_extractions);
  rows.push({
    population: 'current_campaign_sibling_sample',
    key: id,
    model: preparation.intake.product_model,
    source_sha256: receipt.source_digest,
    suggestions: s.length,
    new_usable_assertions: 0,
    wrong_or_competing_accepted: 0,
    elapsed_ms: Number((performance.now() - start).toFixed(3)),
    qualified_facts: preparation.qualified_facts.length,
    candidate_present: Boolean(preparation.bridge.candidate),
    limitation:
      'Read-only suggestion attempt over real ordinary production documents; no human decisions',
  });
  if (id === 'p07') {
    const observed = nativeModelGridObservations(sourceBytes, 'MPPT 150/35');
    rows.push({
      population: 'held_out_native_header',
      key: 'p07-source-sibling-150-35',
      model: 'MPPT 150/35',
      source_sha256: receipt.source_digest,
      native_observations: observed.length,
      new_usable_assertions: 0,
      wrong_or_competing_accepted: 0,
      limitation:
        'Native HTML ownership only; no production qualification, tracker grouping or PDF recovery',
    });
  }
}
console.log(
  JSON.stringify(
    {
      version: 'wave1-profile-recovery-measurement.v1',
      adapter: 'engineering-profile-adjudication.v1',
      frozen_audit_sha256: sha(auditBytes),
      historical_denominators: { eligible: 254, visible: 341, gaps: 87, page2: 77 },
      historical_usable: { eligible: 47, page2: 46 },
      full_denominator_remeasured: false,
      observed_incremental_usable: 0,
      rows,
      reviewer_time: 'not_measured',
      rights: 'No publisher content emitted; retained exact private bytes only',
    },
    null,
    2,
  ),
);
