import { expect, it } from 'vitest';
import { evaluateEngineeringEnvelope } from '../src/engineering-envelope.js';
import { solarFixture, multifunctionFixture } from './fixtures/engineering-envelope.js';
import { evaluateEngineeringEnvelope as evaluateLegacy } from '../src/engineering-envelope-v1.js';
import { replayEngineeringEnvelope } from '../src/engineering-envelope-replay.js';
import { passportDigest } from '../src/portable-json.js';
it.each(['model', 'count', 'protocol'])(
  'known assembly %s contradiction survives unknown revision',
  (kind) => {
    const x = multifunctionFixture(),
      m = x.operating!.installed_modules![0]!;
    m.revision = null;
    if (kind === 'model') m.model = 'Wrong';
    if (kind === 'count') m.count = 1;
    if (kind === 'protocol') m.protocol = 'Wrong';
    expect(evaluateEngineeringEnvelope(x).status).toBe('BLOCKED');
  },
);
it('unknown revisions remain unresolved, optional absent and known pass retain their scope', () => {
  const x = multifunctionFixture();
  expect(evaluateEngineeringEnvelope(x).status).toBe('ELIGIBLE');
  x.operating!.installed_modules![0]!.revision = null;
  expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
  x.operating!.installed_modules = [];
  expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
});
it('operating Vmp does not become absolute Voc and unknown basis cannot pass', () => {
  const x = solarFixture(),
    t = x.profiles[1]!.trackers![0]!;
  t.operating_max_v!.value = 24;
  expect(evaluateEngineeringEnvelope(x).status).toBe('ELIGIBLE');
  delete t.operating_max_basis;
  expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
  t.absolute_voc_v!.value = 23;
  expect(evaluateEngineeringEnvelope(x).status).toBe('BLOCKED');
});
it('basis enum without its semantic evidence remains unknown, including real evidence', () => {
  const x = solarFixture(),
    t = x.profiles[1]!.trackers![0]!,
    e = x.profiles[1]!.evidence[0]!;
  e.statement = 'Invented numeric limit without a quantity-basis relation';
  expect(
    evaluateEngineeringEnvelope(x).checks.find((c) => c.code === 'operating_max_basis_unknown')
      ?.status,
  ).toBe('UNRESOLVED');
  e.statement = 'Controlled context: operating maximum voltage applies to Vmp envelope';
  e.origin = 'source_stated';
  e.human_interpretation = {
    version: 'engineering-profile-adjudication.v1',
    event_id: 'controlled-event',
    fact_id: 'controlled-fact',
    source_document_revision: null,
    source_unit: 'V',
  };
  expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
  expect(
    evaluateEngineeringEnvelope(x).checks.find((c) => c.code === 'operating_max_basis_unknown')!
      .evidence_ids,
  ).toEqual(t.operating_max_v!.evidence_ids);
  t.absolute_voc_v!.value = 20;
  expect(evaluateEngineeringEnvelope(x).status).toBe('BLOCKED');
});
it('controlled explicit Voc basis remains separate from Vmp and retains its exact source IDs', () => {
  const x = solarFixture(),
    t = x.profiles[1]!.trackers![0]!;
  t.operating_max_basis = 'voc_envelope';
  x.profiles[1]!.evidence[0]!.statement =
    'Synthetic assumption: operating maximum voltage applies to Voc envelope';
  t.operating_max_v!.value = 24;
  const r = evaluateEngineeringEnvelope(x);
  expect(r.checks.find((c) => c.code === 'operating_upper_voltage')?.status).toBe('BLOCKED');
  expect(r.checks.find((c) => c.code === 'absolute_cold_voc')?.status).toBe('ELIGIBLE');
  expect(r.checks.find((c) => c.code === 'operating_upper_voltage')!.evidence_ids).toContain(
    'controller.e',
  );
});
it('unrelated source IDs do not enter causal PV bounds', () => {
  const x = solarFixture(),
    m = x.profiles[0]!;
  m.evidence.push({ ...m.evidence[0]!, id: 'unrelated.marketing' });
  const r = evaluateEngineeringEnvelope(x);
  expect(r.checks.flatMap((c) => c.evidence_ids)).not.toContain('unrelated.marketing');
  expect(r.checks.find((c) => c.code === 'absolute_cold_voc')!.assumptions.length).toBeGreaterThan(
    0,
  );
});
it('caller capacity subsets cannot establish source inventory completeness', () => {
  const x = multifunctionFixture();
  delete x.profiles[0]!.shared_capacity_inventory;
  expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
  x.operating!.demands[0]!.value = 6500;
  expect(evaluateEngineeringEnvelope(x).status).toBe('BLOCKED');
});
it('replays historical v1 with its exact rule rather than silently upgrading', () => {
  const input = solarFixture();
  delete input.profiles[1]!.trackers![0]!.operating_max_basis;
  const body = {
    schema_version: 'portable-engineering-envelope.v1' as const,
    input,
    result: evaluateLegacy(input),
  };
  const legacy = { ...body, digest: passportDigest(body) };
  expect(replayEngineeringEnvelope(legacy)).toEqual(legacy);
  expect(evaluateEngineeringEnvelope(input).status).toBe('UNRESOLVED');
});
it('all unknown assembly metadata stays unresolved and optional absence imposes no requirement', () => {
  const x = multifunctionFixture(),
    r = x.profiles[0]!.assembly![0]!,
    m = x.operating!.installed_modules![0]!;
  r.compatible_revision = null;
  delete r.protocol;
  m.revision = null;
  delete m.protocol;
  expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
  const optional = { ...r, component_id: 'optional', relationship: 'optional' as const };
  x.profiles[0]!.assembly = [optional];
  x.operating!.installed_modules = [];
  expect(evaluateEngineeringEnvelope(x).status).toBe('ELIGIBLE');
  x.profiles[0]!.assembly = [{ ...optional, relationship: 'included' }];
  expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
});
