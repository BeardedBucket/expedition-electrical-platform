import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, basename } from 'node:path';
import { createHash } from 'node:crypto';
import {
  IngestionJobService,
  FileIngestionJobStore,
} from '../packages/ingestion-runtime/dist/index.js';
import {
  LocalSnapshotStore,
  artifactDigest,
  projectAuthoredComponent,
  replaySourceCaptureSnapshot,
} from '../packages/ingestion/dist/index.js';
import { parseSourceGroundedDraft } from '../packages/engineering-core/dist/source-grounded-draft.js';
import { validateComponentLibraryRecord } from '../packages/engineering-core/dist/component-library.js';

const arg = (key) => {
  const i = process.argv.indexOf(key);
  if (i < 0 || !process.argv[i + 1]) throw Error('Required ' + key);
  return process.argv[i + 1];
};
const input = resolve(arg('--input'));
const output = resolve(arg('--output'));
for (const root of [input, output]) {
  const r = relative(resolve('.'), root);
  if (
    (!isAbsolute(r) && !r.startsWith('..')) ||
    root
      .split(/[\\/]/)
      .some((p) => ['components', '.git', '.local-corpus-draft-archive'].includes(p))
  )
    throw Error('Explicit private external roots required');
}
if (basename(output) !== 'engineering-wave2-authored-private' || input === output)
  throw Error('Fresh bounded authored output required');
await mkdir(output, { recursive: false });
const sha = (b) => 'sha256:' + createHash('sha256').update(b).digest('hex');
const parse = (b) => JSON.parse(b.toString('utf8').replace(/^\uFEFF/, ''));
const store = new FileIngestionJobStore(join(output, 'jobs'));
const snapshots = new LocalSnapshotStore(join(output, 'snapshots'));
const results = [];
// This is direct source authoring, not an extraction benchmark. Exact declared
// IDs/receipts are the only filesystem inputs; no catalog or private root scan.
for (const id of ['p25', 'p26', 'p07', 'p22', 'p23', 'p24', 'p10', 'p15']) {
  const draft = parseSourceGroundedDraft(
    parse(await readFile(`data/ingestion/engineering-wave2/authored-drafts/${id}.json`)),
  );
  const component = projectAuthoredComponent(draft);
  const validation = validateComponentLibraryRecord(component);
  if (!validation.ok) throw Error('Component proposal schema: ' + JSON.stringify(validation));
  const sourceJobs = [];
  for (const source of draft.sources) {
    if (
      !/^(p\d{2}(?:-datasheet|-manual|-spec|-technical|-installation)?|meanwell-manual)$/.test(
        source.id,
      )
    )
      throw Error('Unsafe named source');
    const receipt = parse(await readFile(join(input, source.id + '.capture.json')));
    const bytes = await readFile(join(input, source.id + '.source'));
    if (
      sha(bytes) !== source.content_digest ||
      bytes.length !== (receipt.byte_count ?? receipt.size) ||
      receipt.final_uri !== source.url ||
      receipt.retrieved_at !== source.retrieved_at
    )
      throw Error('Exact source changed: ' + source.id);
    // Manufacturer-linked hosted documents are explicitly proposed intake. A
    // successful transport does not review publisher/model ownership; source
    // identity locators and all authoring meanings remain unreviewed downstream.
    const media =
      bytes.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : receipt.media_type;
    const service = new IngestionJobService({
      store,
      preparationRequest: () => ({
        adapter: {
          async capture(request) {
            if (request.uri !== receipt.requested_uri)
              return {
                status: 'failed',
                issues: [
                  {
                    code: 'not_retained',
                    message: 'Only this exact named retained source is available',
                  },
                ],
              };
            return {
              status: 'success',
              issues: [],
              source: {
                requested_uri: receipt.requested_uri,
                final_uri: receipt.final_uri,
                retrieved_at: receipt.retrieved_at,
                media_type: media,
                content_hash: sha(bytes),
                body: {
                  bytes: new Uint8Array(bytes),
                  ...(media.includes('html') ? { text: bytes.toString('utf8') } : {}),
                },
              },
            };
          },
        },
        policy: {
          max_captured_candidates: 0,
          max_recursion_depth: 0,
          retention_status: 'retained',
          snapshot_store: snapshots,
          now: () => receipt.retrieved_at,
        },
      }),
    });
    const created = await service.createJob({
      schema_version: '1.0',
      artifact_kind: 'product_intake',
      id: `wave2.authored.${id}.${source.id}`,
      manufacturer: draft.product.manufacturer,
      product_model: draft.product.model,
      ...(draft.product.manufacturer_part_number
        ? { manufacturer_part_number: draft.product.manufacturer_part_number }
        : {}),
      official_product_uri: receipt.requested_uri,
      submitted_at: receipt.retrieved_at,
    });
    const job = await service.prepareJob(created.id);
    if (!job.preparation)
      throw Error('No retained preparation: ' + source.id + ' ' + JSON.stringify(job.error));
    for (const capture of job.preparation.captures.filter((c) => c.disposition === 'authoritative'))
      if ((await replaySourceCaptureSnapshot(capture, snapshots)).status !== 'replayed')
        throw Error('Source snapshot replay failed');
    const loaded = await store.loadVersioned(job.id);
    sourceJobs.push({
      source_id: source.id,
      id: job.id,
      version: loaded.version,
      byte_count: bytes.length,
      service,
    });
  }
  const main = sourceJobs[0];
  const supporting = sourceJobs.slice(1).map(({ id, version }) => ({ id, version }));
  const proposal = {
    version: 'authored-draft-proposal.v1',
    draft,
    proofs: draft.facts.map((f) => ({
      source_id: f.source_id,
      locator: f.locator,
      context_digest: f.context_digest,
      start_byte: 0,
      end_byte: sourceJobs.find((s) => s.source_id === f.source_id).byte_count,
    })),
  };
  // Repeated same-context proofs collapse by locator only, never by value or
  // semantic resemblance. The complete immutable source remains privately owned.
  proposal.proofs = proposal.proofs.filter(
    (p, i, a) =>
      a.findIndex(
        (q) =>
          q.source_id === p.source_id &&
          q.locator === p.locator &&
          q.context_digest === p.context_digest,
      ) === i,
  );
  const before = await store.loadVersioned(main.id);
  const preview = await main.service.previewAuthoredDraft(
    main.id,
    before.version,
    proposal,
    supporting,
  );
  if ((await store.loadVersioned(main.id)).version !== before.version)
    throw Error('Read-only preview wrote a job');
  const imported = await main.service.importAuthoredDraft(
    main.id,
    before.version,
    proposal,
    supporting,
  );
  const after = await store.loadVersioned(main.id);
  if (
    artifactDigest(
      await main.service.importAuthoredDraft(main.id, before.version, proposal, supporting),
    ) !== artifactDigest(imported)
  )
    throw Error('Exact import retry changed history');
  const restarted = await new FileIngestionJobStore(join(output, 'jobs')).load(main.id);
  if (
    artifactDigest(restarted) !== artifactDigest(imported) ||
    restarted.human_adjudications?.length ||
    restarted.approval ||
    restarted.finalization_request ||
    artifactDigest(restarted.preparation) !== artifactDigest(before.job.preparation)
  )
    throw Error('Authoring changed authority/source preparation');
  await writeFile(
    join(output, id + '.component-proposal.json'),
    JSON.stringify(component, null, 2) + '\n',
    { flag: 'wx' },
  );
  await writeFile(join(output, id + '.proposal.json'), JSON.stringify(proposal, null, 2) + '\n', {
    flag: 'wx',
  });
  results.push({
    id,
    model: draft.product.model,
    job_id: main.id,
    source_jobs: sourceJobs.map((j) => ({
      source_id: j.source_id,
      id: j.id,
      version: j.version,
      byte_count: j.byte_count,
    })),
    fact_count: draft.facts.length,
    source_count: draft.sources.length,
    proposal_digest: preview.proposal_digest,
    preparation_digest: preview.preparation_digest,
    job_version: after.version,
    status: 'partial_reviewable',
    authority: draft.authority,
    human_source_decisions: 0,
    approved: 0,
    promoted: 0,
    verified: 0,
    holds: draft.holds,
  });
  console.log(
    id +
      ': ' +
      draft.facts.length +
      ' authored facts; durable unreviewed import/restart/retry passed',
  );
}
await writeFile(
  join(output, 'AUTHORING_RUN_METADATA.json'),
  JSON.stringify({ version: 'wave2-authored-run.v1', results }, null, 2) + '\n',
  { flag: 'wx' },
);
