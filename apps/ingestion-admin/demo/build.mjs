/* global process, console */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadFrozenSourceScenarios } from './frozen-sources.mjs';
const retained = process.argv.includes('--frozen')
  ? loadFrozenSourceScenarios(path.join(os.tmpdir(), 'expedition-document-extraction-benchmark'))
  : [];
const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const esbuild = require('esbuild');
// Build artifacts belong to a fresh TEMP directory, never a retained evidence store.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expedition-review-lab-'));
await esbuild.build({
  entryPoints: [path.join(root, 'apps/ingestion-admin/demo/main.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    __RETAINED_SOURCE_SCENARIOS__: JSON.stringify(retained),
  },
  outfile: path.join(directory, 'app.js'),
});
fs.copyFileSync(
  path.join(root, 'apps/ingestion-admin/src/styles.css'),
  path.join(directory, 'styles.css'),
);
// The lab also blocks browser connections to APIs: shared browser API definitions may be bundled,
// but fixture states stay review_ready, verification never mounts, and all client authority calls throw.
fs.writeFileSync(
  path.join(directory, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &apos;self&apos;; connect-src &apos;none&apos;; style-src &apos;self&apos; &apos;unsafe-inline&apos;; form-action &apos;none&apos;; base-uri &apos;none&apos;"><title>Expedition synthetic specification review lab</title><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);
console.log(directory);
