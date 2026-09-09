import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_SCHEMA_VERSION,
  artifactReference,
  buildQualifiedFactArtifact,
  reconcileQualifiedFactComparisonGroup,
  type QualifiedFactArtifact,
  type QualifiedFactComparisonGroup,
} from '../src/index.js';

const fact = (
  id: string,
  raw_value: string,
  source_unit?: string,
  qualification_state: QualifiedFactArtifact['qualification_state'] = 'exact',
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
    },
    qualification_state,
  });

const group = (...facts: readonly QualifiedFactArtifact[]): QualifiedFactComparisonGroup => ({
  id: 'qualified-fact-group.synthetic',
  key: {
    reconciliation_scope: {
      kind: 'acquisition_candidate',
      intake_digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      id: 'candidate.synthetic',
    },
    applicability: { kind: 'exact_product', value: 'MODEL-A' },
    source_wording: 'Example scalar',
  },
  qualified_fact_ids: facts.map((item) => item.id).sort(),
});

describe('Checkpoint F group reconciliation', () => {
  it('reconciles mechanically equivalent qualified facts as agreement', () => {
    const first = fact('first', '24', 'V');
    const second = fact('second', '24.0', 'V');
    const third = fact('third', '24000', 'mV');

    expect(
      reconcileQualifiedFactComparisonGroup(group(first, second, third), [first, second, third])
        .outcome,
    ).toBe('agreement');
  });

  it('reconciles mechanically different qualified facts as conflict', () => {
    const first = fact('first', '24', 'V');
    const second = fact('second', '25', 'V');

    expect(
      reconcileQualifiedFactComparisonGroup(group(first, second), [first, second]).outcome,
    ).toBe('conflict');
  });

  it('preserves all supporting fact ids in an agreement', () => {
    const first = fact('first', '24', 'V');
    const second = fact('second', '24', 'V');
    const result = reconcileQualifiedFactComparisonGroup(group(first, second), [first, second]);

    expect(result.qualified_fact_ids).toEqual([first.id, second.id].sort());
  });

  it('preserves all competing fact ids in a conflict', () => {
    const first = fact('first', '24', 'V');
    const second = fact('second', '25', 'V');
    const result = reconcileQualifiedFactComparisonGroup(group(first, second), [first, second]);

    expect(result.qualified_fact_ids).toEqual([first.id, second.id].sort());
    expect(result.comparisons[0].members.map((member) => member.qualified_fact_id)).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('keeps a singleton comparison group unresolved', () => {
    const only = fact('only', '24', 'V');

    expect(reconcileQualifiedFactComparisonGroup(group(only), [only]).outcome).toBe('unresolved');
  });

  it('keeps a group unresolved when no difference is proven but one member is not mechanically comparable', () => {
    const exact = fact('exact', '24', 'V');
    const qualified = fact('qualified', '≤ 24 V');

    expect(
      reconcileQualifiedFactComparisonGroup(group(exact, qualified), [exact, qualified]).outcome,
    ).toBe('unresolved');
  });

  it('preserves proven conflict when another group member is unresolved', () => {
    const first = fact('first', '24', 'V');
    const second = fact('second', '25', 'V');
    const qualified = fact('qualified', '≤ 30 V');
    const result = reconcileQualifiedFactComparisonGroup(group(first, second, qualified), [
      first,
      second,
      qualified,
    ]);

    expect(result.outcome).toBe('conflict');
    expect(result.has_unresolved_comparisons).toBe(true);
    expect(result.comparisons.some((comparison) => comparison.outcome === 'unresolved')).toBe(true);
  });

  it('does not choose a winner for conflicting qualified facts', () => {
    const first = fact('first', '24', 'V');
    const second = fact('second', '25', 'V');
    const result = reconcileQualifiedFactComparisonGroup(group(first, second), [first, second]);

    expect(result).not.toHaveProperty('selected_qualified_fact_id');
    expect(result).not.toHaveProperty('value');
  });

  it('produces deterministic group reconciliation independent of member order', () => {
    const first = fact('first', '24', 'V');
    const second = fact('second', '24.0', 'V');
    const third = fact('third', '24000', 'mV');

    expect(
      reconcileQualifiedFactComparisonGroup(group(first, second, third), [first, second, third]),
    ).toEqual(
      reconcileQualifiedFactComparisonGroup(group(third, first, second), [third, second, first]),
    );
  });

  it('does not turn identical unsupported non-scalar wording into mechanical agreement', () => {
    const first = fact('first', 'LiFePO4');
    const second = fact('second', 'LiFePO4');

    expect(
      reconcileQualifiedFactComparisonGroup(group(first, second), [first, second]).outcome,
    ).toBe('unresolved');
  });

  it('rejects duplicate qualified fact ids at direct group reconciliation', () => {
    const first = fact('first', '24', 'V');
    const duplicate: QualifiedFactArtifact = { ...fact('second', '25', 'V'), id: first.id };

    expect(() =>
      reconcileQualifiedFactComparisonGroup(group(first, duplicate), [first, duplicate]),
    ).toThrow(/duplicate qualified fact ids/i);
  });

  it('reconciles exact and structurally supported equal scalars as agreement', () => {
    const first = fact('first', '24', 'V', 'exact');
    const second = fact('second', '24', 'V', 'structurally_supported');

    expect(
      reconcileQualifiedFactComparisonGroup(group(first, second), [first, second]).outcome,
    ).toBe('agreement');
  });

  it('does not treat ambiguous qualification state as comparable scalar agreement', () => {
    const first = fact('first', '24', 'V', 'exact');
    const second = fact('second', '24', 'V', 'ambiguous');

    expect(
      reconcileQualifiedFactComparisonGroup(group(first, second), [first, second]).outcome,
    ).toBe('unresolved');
  });

  it('does not treat unresolved qualification state as comparable scalar agreement', () => {
    const first = fact('first', '24', 'V', 'exact');
    const second = fact('second', '24', 'V', 'unresolved');

    expect(
      reconcileQualifiedFactComparisonGroup(group(first, second), [first, second]).outcome,
    ).toBe('unresolved');
  });

  it('does not treat rejected qualification state as comparable scalar agreement', () => {
    const first = fact('first', '24', 'V', 'exact');
    const second = fact('second', '24', 'V', 'rejected');

    expect(
      reconcileQualifiedFactComparisonGroup(group(first, second), [first, second]).outcome,
    ).toBe('unresolved');
  });
});
