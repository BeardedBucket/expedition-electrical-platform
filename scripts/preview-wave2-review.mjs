import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename, relative, isAbsolute } from 'node:path';
import {
  artifactDigest,
  reviewPackageSnapshot,
  suggestEngineeringProfileSources,
  LocalSnapshotStore,
  replaySourceCaptureSnapshot,
} from '../packages/ingestion/dist/index.js';
import {
  IngestionJobService,
  FileIngestionJobStore,
} from '../packages/ingestion-runtime/dist/index.js';
const i = process.argv.indexOf('--input');
if (i < 0 || !process.argv[i + 1]) throw new Error('Explicit private --input required');
const root = resolve(process.argv[i + 1]);
const rel = relative(resolve('.'), root);
if (
  basename(root) !== 'engineering-corpus-wave2-private' ||
  (!isAbsolute(rel) && !rel.startsWith('..')) ||
  root.split(/[\\/]/).some((p) => ['components', '.git', '.local-corpus-draft-archive'].includes(p))
)
  throw new Error('Use the exact private Wave 2 durable run');
const run = JSON.parse(await readFile(join(root, 'RUN_METADATA.json'), 'utf8'));
if (run.version !== 'wave2-durable-review-run.v1') throw new Error('Unknown durable run version');
const snapshots = new LocalSnapshotStore(join(root, 'snapshots'));
const make = () =>
  new IngestionJobService({
    store: new FileIngestionJobStore(join(root, 'jobs')),
    preparationRequest: () => {
      throw new Error('Read-only preview cannot prepare or recapture');
    },
  });
const results = [];
for (const row of run.results) {
  if (!/^p\d{2}$/.test(row.investigation_id)) throw new Error('Invalid run ID');
  const service = make();
  const job = await service.getJob(row.job_id);
  const p = job.preparation;
  if (p?.status !== 'review_ready' || job.approval || job.human_adjudications?.length)
    throw new Error('Expected an unapproved untouched preparation');
  // Restart is a job replay; separately require the actual retained byte snapshots.
  for (const c of p.captures.filter((c) => c.disposition === 'authoritative')) {
    const snapshot = c.snapshot;
    if (!snapshot?.reference) throw new Error('Missing retained source snapshot');
    const replay = await replaySourceCaptureSnapshot(c, snapshots);
    if (replay.status !== 'replayed')
      throw new Error(`Retained bytes failed exact replay: ${replay.issue.code}`);
  }
  const suggestions = suggestEngineeringProfileSources(
    p.intake,
    p.document_extractions,
    p.qualified_facts,
  );
  const selected = suggestions.filter(
    (s) => s.statement.applicability.relationship === 'source_record',
  );
  const ids = [...new Set(selected.flatMap((s) => s.replaces_fact_ids ?? []))];
  const intent = {
    version: 'human-adjudication.v1',
    group_id: `wave2.readonly.${row.investigation_id}`,
    replaces_fact_ids: ids,
    action: ids.length ? (selected.length > 1 ? 'split' : 'correct') : 'add',
    disposition: 'ready',
    rationale:
      'Read-only development preview; no human action is recorded. Review all native ownership and containing conditions before saving.',
    statements: selected.map((s) => s.statement),
  };
  let preview;
  let error;
  if (selected.length) {
    try {
      preview = await service.previewHumanAdjudication(job.id, {
        expected_review_snapshot: reviewPackageSnapshot(p.review_package),
        actor_label: 'UNREVIEWED DEVELOPMENT PREVIEW',
        intent,
      });
      await writeFile(
        join(root, `${row.investigation_id}.readonly-preview.json`),
        JSON.stringify(
          { authority: 'unreviewed_readonly_preview_not_human_decision', intent, preview },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      );
    } catch (e) {
      error = String(e);
    }
  }
  if (artifactDigest(await make().getJob(job.id)) !== artifactDigest(job))
    throw new Error('Read-only preview mutated durable job');
  results.push({
    investigation_id: row.investigation_id,
    job_id: job.id,
    suggestions: selected.map((s) => ({
      quantity: s.statement.mapping.quantity,
      source_label: s.statement.label,
      source_value: s.statement.value,
      citations: s.statement.citations.map((c) => ({
        document_id: c.document_id,
        block_id: c.block_id,
      })),
      replaces_fact_ids: s.replaces_fact_ids ?? [],
    })),
    preview_profile_present: Boolean(preview?.candidate?.engineering_profile),
    preview_assertions:
      preview?.assertions.map((a) => ({
        id: a.id,
        projected: a.projected,
        normalized_value: a.normalized_value,
        restriction_reasons: a.restriction_reasons,
      })) ?? [],
    error: error ?? null,
    human_events_written: 0,
    approval: false,
    authority: 'read_only_development_preview',
  });
  console.log(
    `${row.investigation_id}: suggestions=${selected.length}, typed preview=${Boolean(preview?.candidate?.engineering_profile)}, error=${error ?? 'none'}; no human decision saved`,
  );
}
await writeFile(
  join(root, 'PREVIEW_METADATA.json'),
  JSON.stringify({ version: 'wave2-readonly-previews.v1', results }, null, 2) + '\n',
  { flag: 'wx' },
);
