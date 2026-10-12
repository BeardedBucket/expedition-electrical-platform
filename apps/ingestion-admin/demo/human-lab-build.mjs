/* global process, console */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expedition-human-lab-'));
await build({
  entryPoints: [path.join(root, 'apps/ingestion-admin/demo/HumanLab.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: path.join(directory, 'app.js'),
});
await build({
  entryPoints: [path.join(root, 'apps/ingestion-admin/demo/human-lab-server.ts')],
  bundle: true,
  platform: 'node',
  // PDF.js owns its native optional dependencies relative to its installed file.
  // Preserve that module boundary; this HTML lab never invokes PDF extraction.
  plugins: [
    {
      name: 'installed-pdf-runtime',
      setup(builder) {
        builder.onResolve({ filter: /^pdfjs-dist\// }, (args) => ({
          path: pathToFileURL(require.resolve(args.path)).href,
          external: true,
        }));
      },
    },
  ],
  format: 'esm',
  alias: {
    '@expedition/engineering-core/engineering-passport': path.join(
      root,
      'packages/engineering-core/src/engineering-passport.ts',
    ),
    '@expedition/ingestion': path.join(root, 'packages/ingestion/src/index.ts'),
    '@expedition/ingestion-runtime': path.join(root, 'packages/ingestion-runtime/src/index.ts'),
    '@expedition/engineering-core': path.join(root, 'packages/engineering-core/src/index.ts'),
    '@expedition/engineering-core/portable-json': path.join(
      root,
      'packages/engineering-core/src/portable-json.ts',
    ),
    '@expedition/engineering-core/canonical-verification': path.join(
      root,
      'packages/engineering-core/src/canonical-verification.ts',
    ),
  },
  banner: {
    js: `import {createRequire as labCreateRequire} from 'node:module'; const require=labCreateRequire(${JSON.stringify(path.join(root, 'package.json'))});`,
  },
  outfile: path.join(directory, 'server.mjs'),
});
fs.copyFileSync(
  path.join(root, 'apps/ingestion-admin/src/styles.css'),
  path.join(directory, 'styles.css'),
);
fs.writeFileSync(
  path.join(directory, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &apos;self&apos;; connect-src &apos;self&apos;; style-src &apos;self&apos; &apos;unsafe-inline&apos;; form-action &apos;none&apos;; base-uri &apos;none&apos;"><title>Human source adjudication lab</title><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);
console.log(directory);
