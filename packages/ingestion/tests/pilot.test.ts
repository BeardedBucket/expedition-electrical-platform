import { describe, expect, it } from 'vitest';
import pilot from '../../../data/ingestion/victron-multiplus-24-2000-50-50-120v.json' with { type: 'json' };
import { replayArtifact, validatePersistedArtifact } from '../src/victron-pilot.js';

const clone = () => JSON.parse(JSON.stringify(pilot));

describe('Victron MultiPlus ingestion pilot artifact', () => {
  it('preserves target, source-observed, and policy identity provenance', () => {
    expect(pilot.pilot_target_identity).toMatchObject({
      manufacturer: 'Victron Energy',
      product_family: 'MultiPlus',
      model: '24/2000/50-50 120V VE.Bus',
      manufacturer_part_number: 'PMP242200100',
      voltage_variant: '24V DC input',
      regional_variant: '120V',
    });
    expect(pilot.source_identity_evidence).toMatchObject({
      source_id: pilot.source.id,
      manufacturer_part_number: 'PMP242200100',
      raw_value: 'PMP242200100',
      extraction_method: 'structured',
      provenance_type: 'source_observed',
    });
    expect(pilot.policy_metadata).toEqual({
      authority: 'manufacturer_product',
      lifecycle_status: 'discontinued',
      product_role: 'inverter_charger',
    });
    expect(pilot.source).toMatchObject({
      source_type: 'manufacturer_product_page',
      authority: 'manufacturer_product',
      publisher: 'Victron Energy',
      content_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(pilot.source.product_identity_claim).toEqual({
      manufacturer: 'Victron Energy',
      manufacturer_part_number: 'PMP242200100',
    });
  });

  it('replays and validates the persisted candidate and report offline', () => {
    const replayed = replayArtifact(clone());
    expect(replayed.validation).toMatchObject({ ok: true, status: 'unresolved' });
    expect(replayed.candidate).toEqual(pilot.candidate);
    expect(replayed.report).toEqual(pilot.report);
    expect(pilot.candidate).toMatchObject({
      identity_status: 'verified',
      review_status: 'pending',
      promotion_status: 'review_required',
      component_data: {
        electrical: {
          nominal_voltage_v: 24,
          apparent_power_va: 2000,
          continuous_charge_current_a: 50,
          continuous_power_w: 1600,
          ac_output_voltage_v: 120,
          frequency_hz: 60,
        },
        weight_kg: 13,
      },
    });
  });

  it('keeps dimensions unresolved and preserves all facts as provisional', () => {
    expect(pilot.report.unresolved_or_unmapped_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Height', value: '520 mm' }),
        expect.objectContaining({ label: 'Width', value: '255 mm' }),
        expect.objectContaining({ label: 'Depth', value: '125 mm' }),
      ]),
    );
    expect(pilot.candidate.component_data).not.toHaveProperty('dimensions_mm');
    expect(pilot.facts.every((fact) => fact.fact_state === 'provisional')).toBe(true);
  });

  it.each([
    ['candidate.field_evidence', (artifact) => delete artifact.candidate.field_evidence],
    ['candidate.source_ids', (artifact) => artifact.candidate.source_ids.pop()],
    ['candidate.fact_ids', (artifact) => artifact.candidate.fact_ids.pop()],
    ['candidate.review_status', (artifact) => (artifact.candidate.review_status = 'approved')],
    [
      'candidate.promotion_status',
      (artifact) => (artifact.candidate.promotion_status = 'eligible'),
    ],
    [
      'dangling evidence',
      (artifact) => (artifact.candidate.field_evidence.weight_kg = ['missing.fact']),
    ],
    [
      'report normalized fields',
      (artifact) => artifact.report.normalized_fields.push('electrical.fake_field'),
    ],
    ['report unresolved facts', (artifact) => artifact.report.unresolved_or_unmapped_facts.pop()],
    ['report validation', (artifact) => (artifact.report.validation.status = 'valid')],
  ])('rejects corrupted %s', (_label, mutate) => {
    const corrupted = clone();
    mutate(corrupted);
    expect(validatePersistedArtifact(corrupted).ok).toBe(false);
    expect(() => replayArtifact(corrupted)).toThrow();
  });

  it('rejects a mismatched source-observed MPN', () => {
    const corrupted = clone();
    corrupted.source_identity_evidence.manufacturer_part_number = 'PMP242200102';
    expect(validatePersistedArtifact(corrupted).ok).toBe(false);
  });
});
