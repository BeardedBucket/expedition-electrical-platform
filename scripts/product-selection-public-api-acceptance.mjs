import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { parse } from 'yaml';
import * as browserEntry from '@expedition/engineering-core';
import { generateArchitectures } from '@expedition/engineering-core/architecture-generation';
import {
  evaluateProductSelection,
  serializeProductSelection,
  parseProductSelection,
  replayProductSelection,
} from '@expedition/engineering-core/product-selection';

// Explicit tracked membership, never a corpus directory scan or a production
// fact/review repair. This process tests the built public Node export independently.
const ids = [
  'victron-energy.ori122436120',
  'victron-energy.ori241236120',
  'epoch-batteries.b24100a-c',
  'victron-energy.pmp242200100',
  'victron-energy.scc075015060r',
  'blue-sea-systems.6006',
  'victron-energy.shu050150050',
];
const corpus = ids.map((id) =>
  browserEntry.normalizeComponentLibraryRecord(
    parse(readFileSync(new URL(`../data/components/${id}.yaml`, import.meta.url), 'utf8')),
  ),
);
const generation = generateArchitectures({
  schema_version: '2.0.0',
  assumptions: [],
  requirements: {
    id: 'acceptance.phase5',
    fixed_house_voltage_v: 24,
    loads: [
      { id: 'demand12', domain: { kind: 'dc', nominal_voltage_v: 12 }, required_power_w: 100 },
    ],
    charging_sources: [],
    storage: { required: false },
  },
});
const input = {
  schema_version: '1.0.0',
  generation,
  candidate_id: generation.candidates[0].id,
  corpus,
  fixed_existing: [],
  assemblies: [],
};
const result = evaluateProductSelection(input);
assert.deepEqual(parseProductSelection(serializeProductSelection(result)), result);
assert.deepEqual(replayProductSelection(result, input), result);
assert.equal(result.roles.length, 1);
assert.equal(result.roles[0].candidates.length, ids.length);
assert(result.roles[0].candidates.every((c) => c.status === 'UNRESOLVED'));
assert.equal('evaluateProductSelection' in browserEntry, false);
console.log(
  `Public Node API acceptance: generate/evaluate/serialize/parse/replay; ${ids.length} unchanged real records, all unresolved; browser export excluded.`,
);
