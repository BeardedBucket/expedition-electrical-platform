import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadComponentLibraryFile } from '../src/component-library-loader.js';
import {
  evaluateInstalledSystem,
  parseEngineeringPassport,
  serializeEngineeringPassport,
  replayEngineeringPassport,
  passportDigest,
} from '../src/engineering-passport.js';
import {
  productionAcceptanceComponentIds,
  productionInstalledSystemFixture,
} from './fixtures/production-system.js';
import { exportPassportProof } from './fixtures/passport-artifact.js';

describe('whole-system acceptance over the actual tracked canonical corpus', () => {
  it('retains exact seven-record identities/status/provenance and fails closed on current incomplete evidence', async () => {
    const paths = productionAcceptanceComponentIds.map((id) =>
      resolve('data/components', `${id}.yaml`),
    );
    const before = paths.map((path) => readFileSync(path, 'utf8'));
    const catalog = [];
    for (const path of paths) {
      const loaded = await loadComponentLibraryFile(path);
      if (!loaded.ok) throw new Error(loaded.errors.join('; '));
      catalog.push(loaded.value);
    }
    const input = productionInstalledSystemFixture(catalog);
    const passport = evaluateInstalledSystem(input, catalog);
    expect(passport.result.status).toBe('unresolved');
    expect(passport.result.system_evaluation.status).toBe('CONDITIONAL');
    expect(passport.result.energy.total_energy_wh).toBeUndefined();
    expect(passport.result.energy.completeness).toBe('incomplete');
    expect(passport.result.energy.resolved_subtotal_energy_wh).toBe(0);
    expect(
      passport.result.energy.unresolved_contributions.filter((entry) => entry.kind === 'state'),
    ).toHaveLength(5);
    expect(
      passport.result.energy.unresolved_contributions
        .filter((entry) => entry.kind === 'schedule' && entry.reasons.includes('schedule_missing'))
        .map((entry) => entry.instance_id),
    ).toEqual(['switch', 'monitor']);
    expect(
      passport.examined_evidence.every((entry) => entry.engineering_use.state === 'withheld'),
    ).toBe(true);
    expect(
      passport.decisions
        .flatMap((entry) => entry.evidence_refs)
        .every((ref) => ref.engineering_use === 'withheld'),
    ).toBe(true);
    expect(passport.component_bindings).toHaveLength(7);
    expect(
      passport.component_bindings.every(
        (binding) =>
          binding.record.verification_status === 'unverified' &&
          binding.manufacturer_revision.state === 'unknown',
      ),
    ).toBe(true);
    expect(
      passport.decisions.filter((decision) => decision.code === 'product_review_required'),
    ).toHaveLength(7);
    expect(passport.decisions.find((decision) => decision.id === 'schedule:switch')?.status).toBe(
      'unresolved',
    );
    expect(passport.decisions.find((decision) => decision.id === 'schedule:monitor')?.status).toBe(
      'unresolved',
    );
    for (const binding of passport.component_bindings) {
      const record = catalog.find((component) => component.id === binding.component_id)!;
      expect(binding.record).toEqual(record);
      expect(binding.record_digest).toBe(passportDigest(record));
      expect(binding.record.source_refs?.length).toBeGreaterThan(0);
    }
    const multifunc = passport.component_bindings.find(
      (binding) => binding.component_id === 'victron-energy.pmp242200100',
    )!.record;
    expect(multifunc.ports?.map((port) => [port.id, port.domain])).toEqual([
      ['dc_port', 'dc'],
      ['ac_input', 'ac'],
      ['ac_output', 'ac'],
    ]);
    expect(
      passport.examined_evidence.every((fact) => fact.verification_status === 'unverified'),
    ).toBe(true);
    expect(passport.calculations.map((calculation) => calculation.id)).toEqual([
      'energy:resolved-device-subtotal',
    ]);
    expect(passport.calculations[0]!.inputs).toMatchObject({
      resolved_state_energy_wh: [],
      complete_schedule: false,
    });
    expect(parseEngineeringPassport(serializeEngineeringPassport(passport))).toEqual(passport);
    expect(replayEngineeringPassport(passport, catalog)).toEqual({ ok: true, passport });
    expect(paths.map((path) => readFileSync(path, 'utf8'))).toEqual(before);
    exportPassportProof('production', passport);
  });
});
