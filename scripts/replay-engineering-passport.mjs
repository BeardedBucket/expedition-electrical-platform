import { readFile } from 'node:fs/promises';
import {
  parseEngineeringPassport,
  replayEngineeringPassport,
} from '../packages/engineering-core/dist/engineering-passport.js';

// Explicit files only: this application boundary neither scans the corpus nor
// fetches evidence. The catalog is the exact canonical JSON records supplied to
// the original evaluation, not ingestion artifacts or commercial overlays.
const [passportPath, catalogPath] = process.argv.slice(2);
if (!passportPath || !catalogPath) {
  throw new Error('Usage: node scripts/replay-engineering-passport.mjs PASSPORT.json CATALOG.json');
}
const passport = parseEngineeringPassport(await readFile(passportPath, 'utf8'));
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
if (!Array.isArray(catalog))
  throw new TypeError('Replay catalog must be a canonical record array.');
const result = replayEngineeringPassport(passport, catalog);
if (!result.ok) {
  console.log(JSON.stringify(result));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      ok: true,
      status: result.passport.result.status,
      schema_version: result.passport.schema_version,
      evaluator_revision: result.passport.evaluator_revision,
      rule_lifecycle_status: result.passport.result.rule_lifecycle_status,
      assertion_scope: result.passport.result.assertion_scope,
      energy: result.passport.result.energy,
      evidence_use_counts: {
        accepted_input: result.passport.examined_evidence.filter(
          (entry) => entry.engineering_use.state === 'accepted_input',
        ).length,
        withheld: result.passport.examined_evidence.filter(
          (entry) => entry.engineering_use.state === 'withheld',
        ).length,
      },
      input_digest: result.passport.input_digest,
      corpus_digest: result.passport.corpus_digest,
      passport_digest: result.passport.passport_digest,
    }),
  );
}
