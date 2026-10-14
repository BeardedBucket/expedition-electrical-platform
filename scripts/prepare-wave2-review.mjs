import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, basename, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import {
  LocalSnapshotStore,
  reviewPackageSnapshot,
  artifactDigest,
} from '../packages/ingestion/dist/index.js';
import {
  IngestionJobService,
  FileIngestionJobStore,
} from '../packages/ingestion-runtime/dist/index.js';

// Explicit investigation IDs and byte receipts are intake, never expected answers.
// No frozen assertion oracle, component catalog or directory discovery enters preparation.
const option = (key) => {
  const i = process.argv.indexOf(key);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`Required ${key}`);
  return process.argv[i + 1];
};
const input = resolve(option('--input'));
const supplementInput = process.argv.includes('--supplement-input')
  ? resolve(option('--supplement-input'))
  : undefined;
const supplementId = process.argv.includes('--supplement-id')
  ? option('--supplement-id')
  : undefined;
const output = resolve(option('--output'));
const ids = option('--ids').split(',');
if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !/^p\d{2}$/.test(id)))
  throw new Error('Explicit unique investigation IDs required');
if (
  Boolean(supplementInput) !== Boolean(supplementId) ||
  (supplementId && !ids.includes(supplementId))
)
  throw new Error('Supplement needs one selected ID and its explicit private root');
for (const root of [input, output, ...(supplementInput ? [supplementInput] : [])]) {
  const rel = relative(resolve('.'), root);
  if (
    (!isAbsolute(rel) && !rel.startsWith('..')) ||
    root
      .split(/[\\/]/)
      .some((p) => ['.git', 'components', '.local-corpus-draft-archive'].includes(p))
  )
    throw new Error('Private evidence roots must be outside the checkout and protected paths');
}
if (basename(output) !== 'engineering-corpus-wave2-private' || input === output)
  throw new Error('Use a fresh engineering-corpus-wave2-private output; preserve inputs');
await mkdir(output, { recursive: false });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const store = new FileIngestionJobStore(join(output, 'jobs'));
const snapshots = new LocalSnapshotStore(join(output, 'snapshots'));
// Existing human-reviewed acquisition profile supplies its already reviewed
// publisher/domain mechanics. Do not manufacture a new reviewed status here.
const victronProfile = JSON.parse(
  await readFile('data/ingestion/manufacturer-acquisition-profiles/victron-energy.json', 'utf8'),
);
const results = [];
for (const id of ids) {
  const sourceRoot = id === supplementId ? supplementInput : input;
  const receipt = JSON.parse(await readFile(join(sourceRoot, `${id}.capture.json`), 'utf8'));
  if (
    receipt.investigation_id !== id ||
    receipt.body_file !== `${id}.source` ||
    receipt.status !== 'success'
  )
    throw new Error(`Successful exact receipt required: ${id}`);
  const bytes = await readFile(join(sourceRoot, `${id}.source`));
  if (sha(bytes) !== receipt.source_digest || bytes.length !== receipt.byte_count)
    throw new Error(`Source identity mismatch: ${id}`);
  // These are literal source identities independently inspected for this intake.
  // MPPT's source model header is not asserted to be a retail ordering code.
  const identity =
    id === 'p07'
      ? { product_model: 'MPPT 150/45' }
      : id === 'p24'
        ? { product_model: 'B24100A-C', manufacturer_part_number: 'B24100A-C' }
        : ['p25', 'p26'].includes(id)
          ? { product_model: receipt.model, manufacturer_part_number: receipt.model }
          : { product_model: receipt.model };
  const source = {
    requested_uri: receipt.requested_uri,
    final_uri: receipt.final_uri,
    media_type: receipt.media_type,
    retrieved_at: receipt.retrieved_at,
    content_hash: `sha256:${receipt.source_digest}`,
    body: {
      bytes: new Uint8Array(bytes),
      ...(receipt.media_type.includes('html') ? { text: bytes.toString('utf8') } : {}),
    },
  };
  const make = () =>
    new IngestionJobService({
      store,
      preparationRequest: () => ({
        ...(receipt.publisher === 'Victron Energy' ? { profile: victronProfile } : {}),
        adapter: {
          async capture(request) {
            return request.uri === receipt.requested_uri
              ? { status: 'success', source, issues: [] }
              : {
                  status: 'failed',
                  issues: [
                    {
                      code: 'offline_not_retained',
                      message: 'Only the explicit retained seed is available',
                    },
                  ],
                };
          },
        },
        // Zero auxiliary captures is an offline scope boundary, not a coverage claim.
        policy: {
          max_captured_candidates: 0,
          max_recursion_depth: 0,
          retention_status: 'retained',
          snapshot_store: snapshots,
          now: () => receipt.retrieved_at,
        },
      }),
    });
  const service = make();
  const job = await service.createJob({
    schema_version: '1.0',
    artifact_kind: 'product_intake',
    id: `wave2.${id}.intake`,
    manufacturer: receipt.publisher,
    ...identity,
    official_product_uri: receipt.requested_uri,
    submitted_at: receipt.retrieved_at,
  });
  const prepared = await service.prepareJob(job.id);
  const restarted = await make().getJob(job.id);
  if (artifactDigest(restarted) !== artifactDigest(prepared))
    throw new Error('Restart changed durable job');
  const p = restarted.preparation;
  results.push({
    investigation_id: id,
    job_id: job.id,
    state: restarted.state,
    error: restarted.error ?? null,
    source_digest: receipt.source_digest,
    rights: receipt.rights,
    source_identity: identity,
    qualified_fact_count: p?.qualified_facts.length ?? 0,
    proposed_fact_count: p?.status === 'review_ready' ? p.proposals.length : 0,
    candidate_present: p?.status === 'review_ready' && Boolean(p.bridge.candidate),
    projected_proposal_count:
      p?.status === 'review_ready' ? p.bridge.projected_proposal_ids.length : 0,
    review_snapshot: p?.status === 'review_ready' ? reviewPackageSnapshot(p.review_package) : null,
    human_source_events: restarted.human_adjudications?.length ?? 0,
    approval: restarted.approval ?? null,
    intended_use_review_ready: false,
    facts:
      p?.qualified_facts.map((f) => ({
        id: f.id,
        label: f.metadata.source_label,
        applicability: f.metadata.applicability,
        qualification: f.qualification_state,
      })) ?? [],
  });
  console.log(
    `${id}: durable ${restarted.state}; qualified=${results.at(-1).qualified_fact_count}, projected=${results.at(-1).projected_proposal_count}; human events=0`,
  );
}
await writeFile(
  join(output, 'RUN_METADATA.json'),
  JSON.stringify(
    { version: 'wave2-durable-review-run.v1', source_root: input, output_root: output, results },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
