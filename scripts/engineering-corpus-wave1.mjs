import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, basename, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import {
  HttpSourceCaptureAdapter,
  extractDocumentAsync,
  prepareNativePvReference,
  prepareNativeTrackerReference,
  prepareProductionIngestReview,
} from '../packages/ingestion/dist/index.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inventoryPath = 'data/ingestion/engineering-wave1/inventory.json';
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
const mode = process.argv[2];
const option = (key) => process.argv[process.argv.indexOf(key) + 1];
const selectedIds = process.argv.includes('--ids') ? option('--ids').split(',') : [];
const selected = inventory.products.filter((p) => selectedIds.includes(p.id));
if (new Set(selectedIds).size !== selectedIds.length || selected.length !== selectedIds.length)
  throw new Error('Unknown or repeated exact investigation ID');

function outputRoot() {
  if (!process.argv.includes('--output')) throw new Error('Explicit private --output required');
  const root = resolve(option('--output'));
  // This tool owns one named private campaign directory, not canonical data or
  // the historic benchmark. No recursive scans, fallbacks, or online replay.
  if (
    basename(root) !== 'engineering-corpus-wave1-private' ||
    root
      .split(/[\\/]/)
      .some((p) => ['.local-corpus-draft-archive', '.git', 'components'].includes(p))
  )
    throw new Error(
      'Use an explicit engineering-corpus-wave1-private directory outside canonical paths',
    );
  const rel = relative(resolve('.'), root);
  if (!isAbsolute(rel) && !rel.startsWith('..'))
    throw new Error('Private manufacturer bytes must stay outside this checkout');
  return root;
}

if (mode === 'inventory') {
  const flags = [
    'investigated',
    'acquired',
    'retained',
    'interpreted',
    'draft_prepared',
    'review_ready',
    'human_reviewed',
    'approved',
    'promoted',
    'engineering_verified',
    'held',
  ];
  console.log(
    JSON.stringify(
      {
        frozen_requirements_version: inventory.requirements_version,
        horizon: inventory.products.length,
        populations: Object.fromEntries(
          flags.map((f) => [f, inventory.products.filter((p) => p.states[f] === true).length]),
        ),
      },
      null,
      2,
    ),
  );
} else if (mode === 'capture') {
  if (!selected.length) throw new Error('Explicit bounded --ids required');
  const root = outputRoot();
  await mkdir(root, { recursive: true });
  const adapter = new HttpSourceCaptureAdapter();
  // Sequential capture deliberately shares no mutable extraction state. The
  // existing transport owns byte/time/redirect bounds; campaign adds no quotas.
  for (const p of selected) {
    if (p.hold_class === 'identity_publisher') {
      console.log(`${p.id}: HOLD identity/publisher`);
      continue;
    }
    const source = p.sources[0];
    if (!source) throw new Error(`No proposed official source for ${p.id}`);
    const result = await adapter.capture({ uri: source.url });
    const capture = result.source;
    const metadata = {
      schema_version: 'wave1-private-capture.v1',
      investigation_id: p.id,
      model: p.model,
      publisher: p.manufacturer,
      requested_uri: source.url,
      status: result.status,
      issues: result.issues,
      rights: 'private_research_only_no_public_redistribution_grant',
      document_revision: null,
      ...(capture
        ? {
            final_uri: capture.final_uri,
            retrieved_at: capture.retrieved_at,
            media_type: capture.media_type,
            source_digest: sha(capture.body.bytes),
            byte_count: capture.body.bytes.byteLength,
            body_file: `${p.id}.source`,
          }
        : {}),
    };
    // Exclusive writes preserve any previous capture. A refresh needs a new
    // explicitly named parent directory; no stale private cache is overwritten.
    if (capture) await writeFile(join(root, `${p.id}.source`), capture.body.bytes, { flag: 'wx' });
    await writeFile(join(root, `${p.id}.capture.json`), JSON.stringify(metadata, null, 2), {
      flag: 'wx',
    });
    console.log(
      `${p.id}: ${result.status}${capture ? ` ${metadata.byte_count} bytes ${metadata.source_digest}` : ` ${JSON.stringify(result.issues)}`}`,
    );
  }
} else if (mode === 'extract') {
  if (!selected.length) throw new Error('Explicit bounded --ids required');
  const root = outputRoot();
  for (const p of selected) {
    const m = JSON.parse(await readFile(join(root, `${p.id}.capture.json`), 'utf8'));
    if (
      m.status !== 'success' ||
      m.investigation_id !== p.id ||
      m.model !== p.model ||
      m.body_file !== `${p.id}.source`
    )
      throw new Error(`Missing/failed/mismatched capture: ${p.id}`);
    const bytes = await readFile(join(root, m.body_file));
    if (sha(bytes) !== m.source_digest) throw new Error(`Source digest mismatch: ${p.id}`);
    const document = await extractDocumentAsync({
      requested_uri: m.requested_uri,
      final_uri: m.final_uri,
      retrieved_at: m.retrieved_at,
      media_type: m.media_type,
      content_hash: m.source_digest,
      // PDF.js intentionally rejects Node Buffer. Own a plain Uint8Array; the
      // parser may transfer its buffer, while retained source bytes stay owned here.
      body: {
        bytes: new Uint8Array(bytes),
        ...(m.media_type?.includes('html') ? { text: bytes.toString('utf8') } : {}),
      },
    });
    const extraction = Object.fromEntries(
      Object.entries(document).filter(([key]) => key !== 'source'),
    );
    await writeFile(
      join(root, `${p.id}.extraction-v1.json`),
      JSON.stringify(
        {
          schema_version: 'wave1-private-extraction.v1',
          source_digest: m.source_digest,
          extraction,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
    console.log(
      `${p.id}: ${document.status}, blocks=${document.blocks.length}, tables=${document.blocks.filter((b) => b.cells).length}`,
    );
  }
} else if (mode === 'prepare-production') {
  if (!selected.length) throw new Error('Explicit bounded --ids required');
  const root = outputRoot();
  for (const p of selected) {
    const m = JSON.parse(await readFile(join(root, `${p.id}.capture.json`), 'utf8'));
    if (m.status !== 'success' || m.body_file !== `${p.id}.source`)
      throw new Error('Successful retained source required');
    const bytes = await readFile(join(root, m.body_file));
    if (sha(bytes) !== m.source_digest) throw new Error('Source digest mismatch');
    const source = {
      requested_uri: m.requested_uri,
      final_uri: m.final_uri,
      media_type: m.media_type,
      retrieved_at: m.retrieved_at,
      content_hash: `sha256:${m.source_digest}`,
      body: {
        bytes: new Uint8Array(bytes),
        ...(m.media_type?.includes('html') ? { text: bytes.toString('utf8') } : {}),
      },
    };
    const snapshots = new Map();
    // Existing snapshot-store protocol only, seeded by explicitly retained input.
    // In-memory preparation does not redesign production blob ownership/storage.
    const snapshot_store = {
      async writeSnapshot(value, digest) {
        const reference = `snapshot://sha256/${digest.replace(/^sha256:/, '')}`;
        snapshots.set(reference, new Uint8Array(value));
        return { reference, digest };
      },
      async readSnapshot(reference) {
        if (!snapshots.has(reference)) throw new Error('Missing exact snapshot');
        return snapshots.get(reference);
      },
    };
    const result = await prepareProductionIngestReview({
      intake: {
        schema_version: '1.0',
        artifact_kind: 'product_intake',
        id: `wave1.${p.id}.intake`,
        manufacturer: p.manufacturer,
        product_model: p.exact_model ?? p.model,
        official_product_uri: m.requested_uri,
        submitted_at: m.retrieved_at,
      },
      adapter: {
        async capture(request) {
          if (request.uri !== m.requested_uri)
            return {
              status: 'failed',
              issues: [{ code: 'offline_not_retained', message: 'No exact retained source' }],
            };
          return { status: 'success', source, issues: [] };
        },
      },
      policy: {
        // This replay evaluates only the explicitly retained seed. Zero child
        // capture/depth forbids fetching or guessing auxiliary evidence; missing
        // manual scope remains a qualification/completeness hold.
        max_captured_candidates: 0,
        max_recursion_depth: 0,
        retention_status: 'retained',
        snapshot_store,
        now: () => m.retrieved_at,
      },
    });
    await writeFile(
      join(root, `${p.id}.production-review-v1.json`),
      JSON.stringify(result, null, 2),
      { flag: 'wx' },
    );
    console.log(
      `${p.id}: ordinary pipeline ${result.status}, qualified=${result.qualified_facts.length}, candidate=${Boolean(result.bridge?.candidate)}. Intended-use readiness not asserted.`,
    );
  }
} else if (mode === 'prepare-pv' || mode === 'prepare-tracker') {
  if (selected.length !== 1 || !process.argv.includes('--model'))
    throw new Error('prepare-pv requires one --ids and exact --model');
  const root = outputRoot();
  const p = selected[0];
  const m = JSON.parse(await readFile(join(root, `${p.id}.capture.json`), 'utf8'));
  if (m.status !== 'success' || m.body_file !== `${p.id}.source`)
    throw new Error('Retained successful capture required');
  const bytes = await readFile(join(root, m.body_file));
  if (sha(bytes) !== m.source_digest) throw new Error('Retained source digest mismatch');
  const common = {
    component_id: `wave1.${p.id}`,
    source: {
      source_url: m.final_uri,
      publisher: m.publisher,
      retrieved_at: m.retrieved_at,
      manufacturer_revision: m.document_revision,
      bytes: new Uint8Array(bytes),
    },
    required_assertions: p.required_assertions,
  };
  const preparation =
    mode === 'prepare-pv'
      ? prepareNativePvReference({ ...common, exact_model: option('--model') })
      : prepareNativeTrackerReference({ ...common, exact_source_model: option('--model') });
  await writeFile(join(root, `${p.id}.preparation-v1.json`), JSON.stringify(preparation, null, 2), {
    flag: 'wx',
  });
  console.log(
    `${p.id}: provisional ${preparation.review_queue.length} proposed typed objects; ${preparation.unresolved.length} unresolved reviews. No admission.`,
  );
} else
  throw new Error(
    'Use inventory | capture | extract | prepare-pv. Explicit --ids and private --output required.',
  );
