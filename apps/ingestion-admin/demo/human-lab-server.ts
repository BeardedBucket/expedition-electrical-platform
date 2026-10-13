import type { RequestListener } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { FileIngestionJobStore } from '@expedition/ingestion-runtime';
import { createOperatorApi, type OperatorService } from '../server/api.js';
import { createHumanLab } from './human-lab-fixtures.js';

const directory = resolve(process.argv[2] ?? '');
if (
  dirname(directory) !== resolve(tmpdir()) ||
  !basename(directory).startsWith('expedition-human-lab-')
)
  throw new Error('Use the fresh TEMP directory returned by human-lab-build.mjs.');
const store = new FileIngestionJobStore(join(directory, 'jobs'));
const { service, jobs } = await createHumanLab(store);
// Deliberate capability boundary: no approval, promotion, canonical destination,
// verification, source fetch or retained-store discovery is available in this lab.
const restricted: OperatorService = {
  createJob: service.createJob.bind(service),
  prepareJob: service.prepareJob.bind(service),
  getJob: service.getJob.bind(service),
  listJobs: service.listJobs.bind(service),
  humanEvidence: service.humanEvidence.bind(service),
  humanProperties: service.humanProperties.bind(service),
  previewHumanAdjudication: service.previewHumanAdjudication.bind(service),
  recordHumanAdjudication: service.recordHumanAdjudication.bind(service),
  discoverSemanticTargets: service.discoverSemanticTargets.bind(service),
  previewSemanticMapping: service.previewSemanticMapping.bind(service),
  recordSemanticDecision: service.recordSemanticDecision.bind(service),
};
const server = createOperatorApi(restricted);
const apiHandler = server.listeners('request')[0] as RequestListener;
server.removeAllListeners('request');
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']],
]);
server.on('request', (request, response) => {
  if (request.method === 'GET' && request.url === '/lab/scenarios') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(jobs));
    return;
  }
  if (request.url?.startsWith('/api/')) {
    apiHandler(request, response);
    return;
  }
  // The job selector is a browser query; asset lookup stays on this exact map.
  const asset = assets.get(request.url?.split('?')[0] ?? '');
  if (request.method !== 'GET' || !asset) {
    response.writeHead(404);
    response.end();
    return;
  }
  void readFile(join(directory, asset[0]))
    .then((bytes) => {
      response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
      response.end(bytes);
    })
    .catch(() => {
      response.writeHead(500);
      response.end('Lab asset unavailable.');
    });
});
// A normal development port avoids Chromium's blocked ephemeral ports. If
// occupied, fail rather than stopping another process or changing its listener.
server.listen(5177, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string')
    console.log(`LAB_URL=http://127.0.0.1:${address.port}/?job=${jobs[0].id}`);
});
// The launching terminal owns lifetime. Evidence and builds remain in fresh TEMP.
process.on('SIGINT', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
