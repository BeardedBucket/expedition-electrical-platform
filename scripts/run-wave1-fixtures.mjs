import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  buildPortableEngineeringEnvelope,
  replayEngineeringEnvelope,
} from '../packages/engineering-core/dist/engineering-envelope-replay.js';
// Exact committed invented inputs only. No private artifacts, component loading,
// discovery, live fetch or developer TEMP fallback enters this clean-fixture run.
for (const path of [
  'data/ingestion/engineering-wave1/synthetic-solar.json',
  'data/ingestion/engineering-wave1/synthetic-multifunction.json',
]) {
  const input = JSON.parse(await readFile(path, 'utf8'));
  const start = performance.now();
  const p = buildPortableEngineeringEnvelope(input);
  replayEngineeringEnvelope(JSON.parse(JSON.stringify(p)));
  console.log(
    JSON.stringify({
      path,
      status: p.result.status,
      authority: p.result.authority,
      checks: p.result.checks.length,
      calculations: p.result.calculations.length,
      digest: p.digest,
      elapsed_ms: Number((performance.now() - start).toFixed(3)),
    }),
  );
}
