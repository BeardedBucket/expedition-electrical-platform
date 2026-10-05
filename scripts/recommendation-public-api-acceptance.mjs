import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { parse } from 'yaml';
import * as browserEntry from '@expedition/engineering-core';
import { generateArchitectures } from '@expedition/engineering-core/architecture-generation';
import { evaluateProductSelection } from '@expedition/engineering-core/product-selection';
import {
  evaluateRecommendation,
  serializeRecommendation,
  parseRecommendation,
  replayRecommendation,
  recommendationPolicy,
} from '@expedition/engineering-core/recommendation';

// Explicit tracked membership avoids protected local material. Original file bytes
// are checked again after acceptance; no product values or review states are changed.
const ids = [
  'victron-energy.ori122436120',
  'victron-energy.ori241236120',
  'epoch-batteries.b24100a-c',
  'victron-energy.pmp242200100',
  'victron-energy.scc075015060r',
  'blue-sea-systems.6006',
  'victron-energy.shu050150050',
];
const paths = ids.map((id) => new URL(`../data/components/${id}.yaml`, import.meta.url));
const originals = paths.map((path) => readFileSync(path, 'utf8'));
const corpus = originals.map((text) => browserEntry.normalizeComponentLibraryRecord(parse(text)));
const generation = generateArchitectures({
  schema_version: '2.0.0',
  assumptions: [],
  requirements: {
    id: 'acceptance.phase6',
    fixed_house_voltage_v: 24,
    loads: [
      { id: 'dc-demand', domain: { kind: 'dc', nominal_voltage_v: 12 }, required_power_w: 100 },
    ],
    charging_sources: [],
    storage: { required: false },
  },
});
const selection = evaluateProductSelection({
  schema_version: '1.0.0',
  generation,
  candidate_id: generation.candidates[0].id,
  corpus,
  fixed_existing: [],
  assemblies: [],
});
const input = {
  schema_version: '1.0.0',
  sources: [{ selection, handoff: {} }],
  construction: { mode: 'automatic' },
  preference: { schema_version: '1.0.0', id: 'acceptance.empty', tiers: [] },
  context: { prices: [], owned_acquisition: [], features: [] },
};
const result = evaluateRecommendation(input);
assert.deepEqual(parseRecommendation(serializeRecommendation(result)), result);
assert.deepEqual(replayRecommendation(result, input), result);
assert.equal(result.construction.status, 'complete');
assert(result.options.length > 0);
assert(result.deferred.length > 0);
assert(result.options.every((o) => o.engineering_status === 'unresolved'));
assert.equal(result.fronts.satisfied.length, 0);
assert.equal(result.fronts.unresolved[0].length, result.options.length);
assert(
  result.input.sources[0].selection.input.corpus.every(
    (c) => c.verification_status === 'unverified',
  ),
);
assert.deepEqual(
  paths.map((path) => readFileSync(path, 'utf8')),
  originals,
);
const bounded = evaluateRecommendation(input, {
  ...recommendationPolicy,
  bounds: { ...recommendationPolicy.bounds, max_options: 1 },
});
assert.equal(bounded.construction.status, 'option_space_bound_exceeded');
assert.equal(bounded.options.length, 0);
for (const name of [
  'evaluateRecommendation',
  'parseRecommendation',
  'serializeRecommendation',
  'replayRecommendation',
  'recommendationPolicy',
])
  assert.equal(name in browserEntry, false);
console.log(
  `Built public Node recommendation acceptance: evaluate/serialize/parse/replay; ${ids.length} unchanged unverified real records; ${result.options.length} unresolved exact options, ${result.deferred.length} deferred candidates; atomic bound report; browser exclusion.`,
);
