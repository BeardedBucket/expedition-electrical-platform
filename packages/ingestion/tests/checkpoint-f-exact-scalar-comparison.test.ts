import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_SCHEMA_VERSION,
  artifactReference,
  buildQualifiedFactArtifact,
  compareQualifiedFactExactScalars,
  type QualifiedFactArtifact,
} from '../src/index.js';

const fact = (
  id: string,
  raw_value: QualifiedFactArtifact['metadata']['raw_value'],
  source_unit?: string,
  overrides: Partial<QualifiedFactArtifact['metadata']> = {},
): QualifiedFactArtifact =>
  buildQualifiedFactArtifact({
    source_capture: artifactReference('source_capture', {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'source_capture',
      id: `capture.${id}`,
      requested_uri: `https://example.invalid/${id}`,
      retrieved_at: '2026-09-08T00:00:00Z',
      disposition: 'authoritative',
      retention_status: 'not_retained',
    }),
    metadata: {
      source_wording: 'Example scalar',
      raw_value,
      ...(source_unit ? { source_unit } : {}),
      applicability: { kind: 'exact_product', value: 'MODEL-A' },
      ...overrides,
    },
    qualification_state: 'exact',
  });

describe('Checkpoint F exact scalar comparison', () => {
  it('compares identical exact scalar values as equal', () => {
    expect(
      compareQualifiedFactExactScalars(fact('first', '24', 'V'), fact('second', '24.0', 'V'))
        .outcome,
    ).toBe('equal');
    expect(
      compareQualifiedFactExactScalars(fact('first', '24', 'V'), fact('second', '24.00', 'V'))
        .outcome,
    ).toBe('equal');
  });

  it('compares mechanically equivalent scalar units as equal', () => {
    expect(
      compareQualifiedFactExactScalars(fact('mv', '24000', 'mV'), fact('v', '24', 'V')).outcome,
    ).toBe('equal');
  });

  it('compares exact scalars with different dimensions as different', () => {
    expect(
      compareQualifiedFactExactScalars(fact('voltage', '24', 'V'), fact('current', '24', 'A'))
        .outcome,
    ).toBe('different');
  });

  it('keeps VAC and VDC values unresolved rather than erasing domain distinction', () => {
    expect(
      compareQualifiedFactExactScalars(fact('ac', '24', 'VAC'), fact('dc', '24', 'VDC')).outcome,
    ).toBe('unresolved');
  });

  it('keeps explicit-domain and domain-unspecified voltage unresolved', () => {
    expect(
      compareQualifiedFactExactScalars(fact('ac', '24', 'VAC'), fact('plain', '24', 'V')).outcome,
    ).toBe('unresolved');
    expect(
      compareQualifiedFactExactScalars(fact('dc', '24', 'VDC'), fact('plain', '24', 'V')).outcome,
    ).toBe('unresolved');
  });

  it('compares identical VDC scalar values without erasing the explicit domain token', () => {
    expect(
      compareQualifiedFactExactScalars(fact('first', '24', 'VDC'), fact('second', '24', 'VDC'))
        .outcome,
    ).toBe('equal');
  });

  it('compares identical VAC scalar values without erasing the explicit domain token', () => {
    expect(
      compareQualifiedFactExactScalars(fact('first', '24', 'VAC'), fact('second', '24', 'VAC'))
        .outcome,
    ).toBe('equal');
  });

  it('compares differing scalar values within the same explicit domain token', () => {
    expect(
      compareQualifiedFactExactScalars(fact('first', '24', 'VDC'), fact('second', '25', 'VDC'))
        .outcome,
    ).toBe('different');
  });

  it('keeps decimal-comma range descriptor and inequality syntax unresolved', () => {
    for (const raw_value of ['24,0 V', '12–24 V', '12-24 V', '300 A continuous', '≤ 50 V']) {
      expect(
        compareQualifiedFactExactScalars(fact('qualified', raw_value), fact('plain', '24', 'V'))
          .outcome,
      ).toBe('unresolved');
    }
  });

  it('keeps missing or empty values unresolved rather than treating them as zero', () => {
    expect(
      compareQualifiedFactExactScalars(fact('missing', ''), fact('zero', '0', 'V')).outcome,
    ).toBe('unresolved');
    expect(
      compareQualifiedFactExactScalars(fact('missing-a', ''), fact('missing-b', '')).outcome,
    ).toBe('unresolved');
  });

  it('keeps differing structured value contexts unresolved', () => {
    expect(
      compareQualifiedFactExactScalars(
        fact('cold', '24', 'V', { temperature_context: 'at 0 C' }),
        fact('warm', '24', 'V', { temperature_context: 'at 25 C' }),
      ).outcome,
    ).toBe('unresolved');
  });

  it('preserves original fact ids raw values and source units in comparison output', () => {
    const left = fact('left', '24000', 'mV');
    const right = fact('right', '24', 'V');

    expect(compareQualifiedFactExactScalars(left, right).members).toEqual(
      [
        { qualified_fact_id: left.id, raw_value: '24000', source_unit: 'mV' },
        { qualified_fact_id: right.id, raw_value: '24', source_unit: 'V' },
      ].sort((first, second) => first.qualified_fact_id.localeCompare(second.qualified_fact_id)),
    );
  });

  it('produces deterministic comparison independent of pair order', () => {
    const left = fact('left', '24000', 'mV');
    const right = fact('right', '24', 'V');

    expect(compareQualifiedFactExactScalars(left, right)).toEqual(
      compareQualifiedFactExactScalars(right, left),
    );
  });

  it('treats mechanically equivalent converted scalars as equal despite floating point representation', () => {
    // 0.7 lb·ft and 8.4 lb·in are the mechanically identical torque value
    // (0.7 * 12 = 8.4), but the current registry's lb·ft/lb·in conversion
    // factors land on adjacent floating-point representations for this pair
    // under strict `===` canonical comparison. This is real, currently
    // reproducible IEEE-754 rounding noise from `toCanonical`, not a
    // fabricated or manufacturer-precision scenario.
    const left = fact('lb-ft', '0.7', 'lb·ft');
    const right = fact('lb-in', '8.4', 'lb·in');

    expect(compareQualifiedFactExactScalars(left, right).outcome).toBe('equal');
  });

  it('does not treat nearby but genuinely different scalar values as equal', () => {
    // 8.40001 lb·in is genuinely different from 0.7 lb·ft (8.4 lb·in):
    // the difference is many orders of magnitude larger than the floating
    // point computation noise absorbed above, so it must remain `different`.
    const left = fact('lb-ft', '0.7', 'lb·ft');
    const right = fact('lb-in', '8.40001', 'lb·in');

    expect(compareQualifiedFactExactScalars(left, right).outcome).toBe('different');
  });

  it('preserves exact equality for simple scale conversions', () => {
    expect(
      compareQualifiedFactExactScalars(fact('mv', '24000', 'mV'), fact('v', '24', 'V')).outcome,
    ).toBe('equal');
  });

  it('preserves different outcome for genuinely different converted values', () => {
    expect(
      compareQualifiedFactExactScalars(fact('mv', '24000', 'mV'), fact('v', '25', 'V')).outcome,
    ).toBe('different');
  });

  it('preserves unresolved outcome for mismatched explicit VAC and VDC domains', () => {
    expect(
      compareQualifiedFactExactScalars(fact('ac', '24', 'VAC'), fact('dc', '24', 'VDC')).outcome,
    ).toBe('unresolved');
  });

  it('preserves unresolved outcome when only one voltage value has an explicit domain', () => {
    expect(
      compareQualifiedFactExactScalars(fact('ac', '24', 'VAC'), fact('plain', '24', 'V')).outcome,
    ).toBe('unresolved');
  });

  it('does not compare numeric values across different dimensions as equal', () => {
    expect(
      compareQualifiedFactExactScalars(fact('voltage', '24', 'V'), fact('current', '24', 'A'))
        .outcome,
    ).toBe('different');
  });

  it('produces deterministic numeric equivalence independent of member order', () => {
    const left = fact('lb-ft', '0.7', 'lb·ft');
    const right = fact('lb-in', '8.4', 'lb·in');

    expect(compareQualifiedFactExactScalars(left, right)).toEqual(
      compareQualifiedFactExactScalars(right, left),
    );
  });
});
