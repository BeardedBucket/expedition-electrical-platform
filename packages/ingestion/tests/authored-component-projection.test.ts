import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { projectAuthoredComponent } from '../src/authored-component-projection.js';
import { parseSourceGroundedDraft } from '@expedition/engineering-core/source-grounded-draft';
import { validateComponentLibraryRecord } from '@expedition/engineering-core';

// Genuine limited-fact authored proposals, not independently verified records.
// The expectations below are pinned independently of the projection; cited
// original bytes remain private and are checked in the explicit genuine run.
const draft = (id: string) =>
  parseSourceGroundedDraft(
    JSON.parse(readFileSync(`data/ingestion/engineering-wave2/authored-drafts/${id}.json`, 'utf8')),
  );
describe('actual authored component exports', () => {
  it('rejects a forged literal phase before projecting AC semantics', () => {
    const d = draft('p15'),
      fact = d.facts.find((f) => f.quantity === 'ac_phase')!;
    fact.original = { value: 'single_phase', unit: 'text', presentation: 'source_literal' };
    fact.normalized = { value: 'single_phase', unit: 'text' };
    expect(projectAuthoredComponent(d).verification_status).toBe('unverified');
    fact.original.value = 'three_phase';
    expect(() => projectAuthoredComponent(d)).toThrow();
  });
  it('rejects a foreign manufacturer on a component even when profile model/id match', () => {
    const r = { ...projectAuthoredComponent(draft('p22')), manufacturer: 'Foreign' };
    expect(validateComponentLibraryRecord(r).ok).toBe(false);
  });
  it.each(['p25', 'p26', 'p07', 'p22', 'p23', 'p24', 'p10', 'p15'])(
    'round trips %s without authority or qualifier loss',
    (id) => {
      const d = draft(id),
        r = projectAuthoredComponent(d);
      expect(validateComponentLibraryRecord(r).ok).toBe(true);
      expect(r.verification_status).toBe('unverified');
      expect(r.engineering_profile!.source_specification).toEqual(d);
      expect(r.engineering_profile!.evidence.every((e) => e.origin === 'source_stated')).toBe(true);
    },
  );
  it('keeps independent B/C input columns and real terminal labels', () => {
    const b = projectAuthoredComponent(draft('p22')),
      c = projectAuthoredComponent(draft('p23'));
    expect(b.ports![0]!.voltage_v).toEqual({ min: 16.8, max: 33.6 });
    expect(c.ports![0]!.voltage_v).toEqual({ min: 33.6, max: 67.2 });
    expect(b.ports![0]!.notes).toContain('TB1');
    expect(b.power_paths![0]!.from_port).toBe(b.ports![0]!.id);
  });
  it('does not invent beta Vmp or coefficient domains', () => {
    const p = projectAuthoredComponent(draft('p25')).engineering_profile!.pv!;
    expect(p.voc_v!.value).toBe(24.34);
    expect(p.coefficients!.voc!.value).toBe(-0.36);
    expect(p.coefficients!.vmp).toBeUndefined();
    expect(p.coefficients!.voc!.cell_domain_c).toBeUndefined();
    expect(projectAuthoredComponent(draft('p26')).engineering_profile!.pv!.voc_v!.value).toBe(
      48.68,
    );
  });
  it('does not convert reference transfer to ampacity or guess accuracy basis', () => {
    const p = projectAuthoredComponent(draft('p10')).engineering_profile!.instrumentation!;
    expect(p.shunt!.nominal_current_a).toBe(500);
    expect(p.shunt!.nominal_drop_mv).toBe(50);
    expect(p.shunt!.max_measurement_current_a).toBeUndefined();
    expect(p.accuracy![0]!.basis).toBe('unknown');
    expect(p.accuracy![0]!.required_shunt_drop_mv).toBeUndefined();
  });
  it('preserves VA and W disagreement and heater applicability', () => {
    const s = draft('p15');
    expect(s.facts.find((f) => f.quantity === 'output_apparent_power')!.normalized).toEqual({
      value: 2200,
      unit: 'VA',
    });
    expect(
      s.facts.some((f) => f.quantity === 'output_power' && f.disposition === 'evidence_ambiguity'),
    ).toBe(true);
    expect(
      projectAuthoredComponent(draft('p24')).engineering_profile!.battery_operating!.charge_range!
        .prerequisite,
    ).toBe('after_heating');
  });
});
