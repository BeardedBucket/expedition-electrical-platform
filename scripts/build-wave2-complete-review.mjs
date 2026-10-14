import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname, basename, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const index = process.argv.indexOf('--output');
if (index < 0 || !process.argv[index + 1]) throw Error('Explicit --output required');
const repo = resolve('.'),
  root = resolve(process.argv[index + 1]);
// Sandbox TEMP can differ from the stable host task directory. Validate the
// explicit external parent/leaf instead of relocating or scanning either TEMP.
const rel = relative(repo, root);
if (
  basename(root) !== 'real-product-readiness-wave2-complete-review' ||
  basename(dirname(root)) !== 'expedition-electrical-platform-reviews' ||
  (!isAbsolute(rel) && !rel.startsWith('..'))
)
  throw Error('Bounded external review root required');
const old = join(dirname(root), 'real-product-readiness-wave2-review');
const parse = (b) => JSON.parse(b.toString('utf8').replace(/^\uFEFF/, '')),
  sha = (b) => createHash('sha256').update(b).digest('hex');
const prior = parse(await readFile(join(old, 'FILE_MANIFEST.json'))),
  oldPaths = parse(await readFile(join(old, 'SOURCE_PATHS.json')));
const added = [
  'apps/ingestion-admin/server/runtime.ts',
  'packages/engineering-core/src/component-library.ts',
  'apps/ingestion-admin/server/api.ts',
  'apps/ingestion-admin/tests/api.test.ts',
  'apps/ingestion-admin/src/App.tsx',
  'apps/ingestion-admin/src/AuthoredDraftView.tsx',
  'apps/ingestion-admin/src/AuthoredDraftView.test.tsx',
  'data/schemas/source-grounded-draft.schema.json',
  'data/schemas/installed-source-draft-scenario.schema.json',
  'docs/WAVE2_DIRECT_PRODUCT_AUTHORING.md',
  'packages/engineering-core/package.json',
  'packages/engineering-core/src/source-grounded-draft.ts',
  'packages/engineering-core/src/installed-source-draft-bridge.ts',
  'packages/engineering-core/src/source-draft-pv.ts',
  'packages/engineering-core/tests/installed-source-draft-bridge.test.ts',
  'packages/engineering-core/tests/source-draft-pv.test.ts',
  'packages/ingestion/src/index.ts',
  'packages/ingestion/src/source-grounded-authoring.ts',
  'packages/ingestion/src/authored-component-projection.ts',
  'packages/ingestion/tests/authored-component-projection.test.ts',
  'packages/ingestion-runtime/src/job-store.ts',
  'packages/ingestion-runtime/tests/source-grounded-authoring.test.ts',
  'scripts/generate-source-grounded-draft-schema.mjs',
  'scripts/prepare-wave2-authored-drafts.mjs',
  'scripts/run-wave2-authored-consumers.mjs',
  'scripts/report-wave2-authoring.mjs',
  'scripts/build-wave2-complete-review.mjs',
  ...['p25', 'p26', 'p07', 'p22', 'p23', 'p24', 'p10', 'p15'].map(
    (id) => `data/ingestion/engineering-wave2/authored-drafts/${id}.json`,
  ),
];
const paths = [...new Set([...oldPaths, ...added])].sort();
const git = (args) =>
  execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: repo,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const branch = git(['branch', '--show-current']).toString().trim(),
  head = git(['rev-parse', 'HEAD']).toString().trim();
if (
  branch !== 'feat/real-product-readiness-wave2' ||
  head !== '726f5838d2c2c971131a1447814d5dfee1830903'
)
  throw Error('Branch/HEAD drift: stop');
const files = [],
  tracked = [];
let patch = '';
for (const path of paths) {
  if (
    path.includes('..') ||
    !/^(apps\/ingestion-admin\/|packages\/(engineering-core|ingestion|ingestion-runtime)\/|data\/(schemas\/|ingestion\/engineering-wave2\/)|docs\/|scripts\/)/.test(
      path,
    )
  )
    throw Error('Unsafe explicit source path');
  const bytes = await readFile(join(repo, path));
  let before = null;
  try {
    before = git(['show', `${head}:${path}`]);
    tracked.push(path);
  } catch {
    /* Exact absent HEAD path, never directory discovery. */
  }
  const previous = prior.files.find((f) => f.path === path);
  files.push({
    path,
    classification: before ? 'modified' : 'new',
    size: bytes.length,
    sha256: sha(bytes),
    before_head_sha256: before ? sha(before) : null,
    before_head_size: before?.length ?? null,
    prior_review_sha256: previous?.sha256 ?? null,
    prior_review_changed: previous ? previous.sha256 !== sha(bytes) : null,
    before_working_sha256: previous?.before_working_sha256 ?? null,
  });
  await mkdir(dirname(join(root, 'files', path)), { recursive: true });
  await writeFile(join(root, 'files', path), bytes);
  if (!before) {
    const text = bytes.toString('utf8');
    if (text.includes('\0')) throw Error('Unexpected binary');
    const end = text.endsWith('\n'),
      lines = text.replace(/\r\n/g, '\n').split('\n');
    if (end) lines.pop();
    patch +=
      `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n` +
      lines.map((l) => '+' + l + '\n').join('') +
      (end ? '' : '\\ No newline at end of file\n');
  }
}
patch = git(['diff', '--binary', head, '--', ...tracked]).toString('utf8') + patch;
const staged = git(['diff', '--cached', '--name-status', '--', ...paths]).toString('utf8');
const json = (name, value) => writeFile(join(root, name), JSON.stringify(value, null, 2) + '\n');
await json('FILE_MANIFEST.json', {
  version: 'wave2-complete-file-manifest.v1',
  branch,
  starting_head: head,
  current_head: head,
  worktree: 'OFF',
  writer_count: 1,
  files,
});
await writeFile(join(root, 'task-only.patch'), patch);
await json('SOURCE_PATHS.json', paths);
await json('PRESERVATION_OBSERVATIONS.json', {
  scope:
    'Exact task paths and named prior evidence only; no whole-repository cleanliness/preservation assertion',
  branch,
  current_head: head,
  task_scoped_staged_diff: staged,
  attributes_current_sha256: sha(await readFile('.gitattributes')),
  attributes_prior_sha256: '0a8f9cd20935878809e50fc8d35d0ac20d32692776134ee5c8f1bbd6b1505ca0',
  frozen_requirements_sha256: sha(
    await readFile('data/ingestion/engineering-wave2/requirements.json'),
  ),
  old_review_zip_sha256: sha(await readFile(old + '.zip')),
  old_review_zip_expected_sha256:
    'bb4bf3416fb034f8f6e63d91274d598681531820370e8efc5c72d0fcf06fcad5',
  index_current_sha256: sha(await readFile('.git/index')),
  index_caveat:
    'Prior initial/later index byte fingerprint drift was not explained or repaired. Current task performed no index mutation; whole-index preservation cannot be asserted.',
  prior_incident:
    'Earlier initial unrestricted status before the governing prompt was read enumerated protected names. No recurrence in this continuation; no protected content read.',
  private_runs:
    'Original evidence and unsuccessful task-owned private runs retained; final successful direct authoring uses authored-run-v5. Earlier successful v4 is preserved.',
});
console.log(
  JSON.stringify({
    paths: paths.length,
    modified: tracked.length,
    new: paths.length - tracked.length,
    staged_empty: !staged.trim(),
    manifest_sha256: sha(await readFile(join(root, 'FILE_MANIFEST.json'))),
  }),
);
