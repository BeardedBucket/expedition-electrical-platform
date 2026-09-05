import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { loadCanonicalCatalog, promoteCandidate, writeCanonicalComponent } from '../dist/index.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const reviewIndex = args.indexOf('--review');
const reviewPath = reviewIndex >= 0 ? args[reviewIndex + 1] : undefined;
if (!reviewPath || reviewPath.startsWith('--'))
  throw new Error('An explicit approved review JSON file is required: --review <path>.');

const repositoryRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const artifactPath = resolve(
  repositoryRoot,
  'data/ingestion/victron-multiplus-24-2000-50-50-120v.json',
);
const canonicalRoot = resolve(repositoryRoot, 'data/components');
const parseJsonFile = async (path) =>
  JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const artifact = await parseJsonFile(artifactPath);
const review = await parseJsonFile(resolve(reviewPath));

if (
  !review ||
  typeof review !== 'object' ||
  review.decision !== 'approved' ||
  typeof review.id !== 'string' ||
  typeof review.candidate_id !== 'string' ||
  typeof review.reviewer_id !== 'string' ||
  typeof review.reviewed_at !== 'string' ||
  !Array.isArray(review.approved_fields) ||
  typeof review.evidence_acknowledged !== 'boolean' ||
  typeof review.product_role !== 'string' ||
  typeof review.category !== 'string'
)
  throw new Error('Review input must be a structured, explicitly approved PromotionReview.');

const catalogComponents = await loadCanonicalCatalog(canonicalRoot);
const promotion = promoteCandidate(artifact.candidate, [artifact.source], artifact.facts, review, {
  components: catalogComponents,
});
const result = await writeCanonicalComponent({
  promotion,
  destinationRoot: canonicalRoot,
  write,
  catalogComponents,
});

const audit = result.audit;
process.stdout.write(
  `${JSON.stringify(
    {
      status: result.status,
      canonical_filename: result.path,
      identity: result.proposal
        ? {
            id: result.proposal.id,
            manufacturer: result.proposal.manufacturer,
            part_number: result.proposal.part_number,
          }
        : undefined,
      schema_valid: result.schema_valid,
      review_id: audit?.review_id,
      review_decision: review.decision,
      field_count: result.proposal ? Object.keys(result.proposal).length : 0,
      omitted_fields: audit?.omitted_fields,
      collision: result.collision,
      would_write: result.status === 'dry_run' || result.status === 'written',
      wrote: result.status === 'written',
      issues: result.issues,
    },
    null,
    2,
  )}\n`,
);
if (result.status === 'invalid' || result.status === 'blocked') process.exitCode = 1;
