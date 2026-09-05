import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { HttpSourceCaptureAdapter } from '../dist/index.js';
import {
  makeArtifacts,
  productUrl,
  replayArtifact,
} from '../dist/victron-pilot.js';

const outputPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../data/ingestion/victron-multiplus-24-2000-50-50-120v.json',
);

if (process.argv.includes('--replay')) {
  const artifact = JSON.parse(await readFile(outputPath, 'utf8'));
  process.stdout.write(`${JSON.stringify(replayArtifact(artifact), null, 2)}\n`);
} else {
  const capture = await new HttpSourceCaptureAdapter().capture({ uri: productUrl });
  if (capture.status !== 'success' || !capture.source?.body.text)
    throw new Error(`Victron capture failed: ${JSON.stringify(capture.issues)}`);
  const artifacts = makeArtifacts(capture.source);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifacts, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${outputPath}\n`);
}
