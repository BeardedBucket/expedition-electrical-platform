import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { parseEngineeringProfile } from '../src/engineering-profile.js';
import { evaluateEngineeringEnvelope } from '../src/engineering-envelope.js';
import { solarFixture } from './fixtures/engineering-envelope.js';
const profile = (id: string) =>
  parseEngineeringProfile(
    JSON.parse(
      readFileSync(`data/ingestion/engineering-wave1/proposals/${id}.profile.json`, 'utf8'),
    ),
  );
it('source-grounded incomplete RV5 shared capacity cannot yield compatibility', () => {
  const p = profile('p01');
  const result = evaluateEngineeringEnvelope({
    schema_version: 'engineering-envelope-input.v1',
    profiles: [p],
    operating: {
      component_id: p.component_id,
      mode: 'combined_load_unqualified',
      required_capacity_group_ids: ['combined_load'],
      demands: [
        { path_id: 'ac_output', value: 5000, unit: 'W' },
        { path_id: 'dc_output', value: 1500, unit: 'W' },
      ],
      installed_modules: [],
      ac_loads: [],
    },
  });
  expect(result.status).toBe('UNRESOLVED');
  expect(result.checks.some((c) => c.code === 'capacity_condition_unknown')).toBe(true);
  expect(result.calculations).toEqual([]);
});
it.each(['p25', 'p26'])('real %s PV proposal does not inherit synthetic prerequisites', (id) => {
  const p = profile(id),
    x = solarFixture();
  x.profiles[0] = p;
  x.pv!.strings[0]!.module_id = p.component_id;
  const result = evaluateEngineeringEnvelope(x);
  expect(result.status).toBe('UNRESOLVED');
  expect(result.checks.find((c) => c.code === 'cold_voc_prerequisites')?.status).toBe('UNRESOLVED');
  expect(result.authority).toBe('provisional');
});
it('retained MPPT limits alone never establish electrical tracker grouping', () => {
  const p = profile('p07'),
    x = solarFixture();
  x.profiles[1] = p;
  x.pv!.controller_id = p.component_id;
  x.pv!.strings[0]!.tracker_id = 'pv_input_unassigned';
  expect(
    evaluateEngineeringEnvelope(x).checks.some((c) => c.code === 'tracker_grouping_unknown'),
  ).toBe(true);
});
