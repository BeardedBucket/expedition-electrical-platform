/* global process, console */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
const directory = path.resolve(process.argv[2] ?? '');
// Only the fresh demo build directly under TEMP may be served. No API, directory listing,
// dynamic lookup or production startup is present; unknown paths fail closed.
if (
  path.dirname(directory) !== path.resolve(os.tmpdir()) ||
  !path.basename(directory).startsWith('expedition-review-lab-')
)
  throw new Error('Supply the exact TEMP directory returned by demo/build.mjs.');
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']],
]);
const server = http.createServer((request, response) => {
  const asset = assets.get(request.url);
  if (request.method !== 'GET' || !asset) {
    response.writeHead(404);
    response.end('Unavailable in the synthetic lab.');
    return;
  }
  try {
    response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
    response.end(fs.readFileSync(path.join(directory, asset[0])));
  } catch {
    response.writeHead(500);
    response.end('Demo asset unavailable.');
  }
});
server.listen(0, '127.0.0.1', () =>
  console.log('DEMO_URL=http://127.0.0.1:' + server.address().port + '/'),
);
// The launching terminal owns server lifetime; Ctrl+C closes the listener. Builds remain in TEMP.
process.on('SIGINT', () => server.close(() => process.exit(0)));
