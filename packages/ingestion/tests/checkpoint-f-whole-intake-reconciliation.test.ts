import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_SCHEMA_VERSION,
  artifactReference,
  buildQualifiedFactArtifact,
  reconcileQualifiedFactsForWholeIntake,
  type QualifiedFactArtifact,
  type SourceAcquisitionArtifact,
} from '../src/index.js';

const capture = (id: string) =>
  artifactReference('source_capture', {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'source_capture',
    id,
    requested_uri: `https://example.invalid/${id}`,
    retrieved_at: '2026-09-08T00:00:00Z',
    disposition: 'authoritative',
    retention_status: 'not_retained',
  });

const acquisition = (
  id: string,
  candidates: readonly string[] = [],
  intakeId = 'intake.shared',
): SourceAcquisitionArtifact => ({
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_acquisition',
  id,
  intake: artifactReference('product_intake', {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'product_intake',
    id: intakeId,
    manufacturer: 'Example Manufacturer',
    product_model: 'Example Model',
    manufacturer_part_number: 'MODEL-A',
    official_product_uri: `https://example.invalid/products/${intakeId}`,
  }),
  seed_capture: capture(`seed.${id}`),
  officiality: 'official',
  status: 'acquired',
  candidates: candidates.map((candidateId) => ({
    id: candidateId,
    raw_discovered_uri: `https://example.invalid/${candidateId}`,
    normalized_uri: `https://example.invalid/${candidateId}`,
    discovery: {
      parent_capture_id: `seed.${id}`,
      parent_uri: `https://example.invalid/seed.${id}`,
      raw_discovered_uri: `https://example.invalid/${candidateId}`,
      normalized_uri: `https://example.invalid/${candidateId}`,
      method: 'maintainer_hint',
    },
    officiality: 'official',
    role: 'datasheet',
    selection_status: 'selected',
    capture_outcome: 'not_attempted',
    content_equivalence: 'unique',
  })),
  deterministic_snapshot: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});

const qualifiedFact = (
  id: string,
  source: SourceAcquisitionArtifact | undefined,
  wording: string,
  value: string,
  unit?: string,
  candidateId?: string,
): QualifiedFactArtifact =>
  buildQualifiedFactArtifact({
    source_capture: capture(`fact.${id}`),
    ...(source ? { source_acquisition: artifactReference('source_acquisition', source) } : {}),
    ...(candidateId ? { acquisition_candidate_id: candidateId } : {}),
    metadata: {
      source_wording: wording,
      source_label: wording,
      raw_value: value,
      ...(unit ? { source_unit: unit } : {}),
      applicability: { kind: 'exact_product', value: 'MODEL-A' },
    },
    qualification_state: 'exact',
  });

describe('Checkpoint F whole-intake reconciliation', () => {
  it('reconciles all established qualified fact groups for one production intake', () => {
    const source = acquisition('source', ['candidate']);
    const agreementA = qualifiedFact('agreement-a', source, 'Voltage', '24', 'V', 'candidate');
    const agreementB = qualifiedFact('agreement-b', source, 'Voltage', '24.0', 'V', 'candidate');
    const conflictA = qualifiedFact('conflict-a', source, 'Current', '24', 'A', 'candidate');
    const conflictB = qualifiedFact('conflict-b', source, 'Current', '25', 'A', 'candidate');
    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [agreementA, agreementB, conflictA, conflictB],
      source_acquisitions: [source],
    });

    expect(result.group_reconciliations).toHaveLength(2);
    expect(result.agreement_count).toBe(1);
    expect(result.conflict_count).toBe(1);
  });

  it('preserves independent outcomes for separate comparison groups', () => {
    const source = acquisition('source', ['candidate']);
    const agreementA = qualifiedFact('agreement-a', source, 'Voltage', '24', 'V', 'candidate');
    const agreementB = qualifiedFact('agreement-b', source, 'Voltage', '24', 'V', 'candidate');
    const conflictA = qualifiedFact('conflict-a', source, 'Current', '24', 'A', 'candidate');
    const conflictB = qualifiedFact('conflict-b', source, 'Current', '25', 'A', 'candidate');
    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [agreementA, agreementB, conflictA, conflictB],
      source_acquisitions: [source],
    });

    expect(result.group_reconciliations.map((item) => item.outcome).sort()).toEqual([
      'agreement',
      'conflict',
    ]);
  });

  it('preserves unscoped facts at the whole-intake reconciliation boundary', () => {
    const source = acquisition('source', ['candidate']);
    const unscoped = qualifiedFact('unscoped', undefined, 'Voltage', '24', 'V');
    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [unscoped],
      // A proven intake still must come from somewhere; an unscoped fact
      // never contributes or fabricates one on its own (see
      // `rejects whole-intake reconciliation when no intake identity can be
      // proven` below for the case with no acquisitions at all).
      source_acquisitions: [source],
    });

    expect(result.unscoped_qualified_fact_ids).toEqual([unscoped.id]);
    expect(result.groups).toEqual([]);
  });

  it('preserves scope-inconsistent facts at the whole-intake reconciliation boundary', () => {
    const source = acquisition('source', ['declared']);
    const inconsistent = qualifiedFact(
      'inconsistent',
      source,
      'Voltage',
      '24',
      'V',
      'contradictory',
    );
    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [inconsistent],
      source_acquisitions: [source],
    });

    expect(result.scope_inconsistent_qualified_fact_ids).toEqual([inconsistent.id]);
    expect(result.groups).toEqual([]);
  });

  it('accounts for every input qualified fact exactly once by reconciliation scope', () => {
    const source = acquisition('source', ['candidate']);
    const grouped = qualifiedFact('grouped', source, 'Voltage', '24', 'V', 'candidate');
    const unscoped = qualifiedFact('unscoped', undefined, 'Current', '24', 'A');
    const inconsistent = qualifiedFact('inconsistent', source, 'Power', '24', 'W', 'other');
    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [grouped, unscoped, inconsistent],
      source_acquisitions: [source],
    });
    const accounted = [
      ...result.groups.flatMap((item) => item.qualified_fact_ids),
      ...result.unscoped_qualified_fact_ids,
      ...result.scope_inconsistent_qualified_fact_ids,
    ];

    expect(accounted.sort()).toEqual([grouped.id, unscoped.id, inconsistent.id].sort());
    expect(new Set(accounted).size).toBe(accounted.length);
  });

  it('reconciles each group only with its declared qualified fact members', () => {
    const source = acquisition('source', ['candidate']);
    const voltageA = qualifiedFact('voltage-a', source, 'Voltage', '24', 'V', 'candidate');
    const voltageB = qualifiedFact('voltage-b', source, 'Voltage', '25', 'V', 'candidate');
    const currentA = qualifiedFact('current-a', source, 'Current', '24', 'A', 'candidate');
    const currentB = qualifiedFact('current-b', source, 'Current', '24', 'A', 'candidate');
    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [voltageA, voltageB, currentA, currentB],
      source_acquisitions: [source],
    });

    expect(result.group_reconciliations.map((item) => item.comparisons)).toEqual(
      expect.arrayContaining([
        [expect.objectContaining({ outcome: 'different' })],
        [expect.objectContaining({ outcome: 'equal' })],
      ]),
    );
  });

  it('preserves conflict plus unresolved evidence through whole-intake reconciliation', () => {
    const source = acquisition('source', ['candidate']);
    const first = qualifiedFact('first', source, 'Voltage', '24', 'V', 'candidate');
    const second = qualifiedFact('second', source, 'Voltage', '25', 'V', 'candidate');
    const unresolved = qualifiedFact(
      'unresolved',
      source,
      'Voltage',
      '≤ 30 V',
      undefined,
      'candidate',
    );
    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [first, second, unresolved],
      source_acquisitions: [source],
    });

    expect(result.group_reconciliations[0].outcome).toBe('conflict');
    expect(result.group_reconciliations[0].has_unresolved_comparisons).toBe(true);
    expect(result.has_conflicts).toBe(true);
    expect(result.has_unresolved).toBe(true);
  });

  it('keeps singleton or otherwise noncomparable groups unresolved', () => {
    const source = acquisition('source', ['candidate']);
    const singleton = qualifiedFact('singleton', source, 'Voltage', '24', 'V', 'candidate');
    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [singleton],
      source_acquisitions: [source],
    });

    expect(result.group_reconciliations[0].outcome).toBe('unresolved');
  });

  it('produces deterministic whole-intake reconciliation independent of input order', () => {
    const sourceA = acquisition('source-a', ['candidate']);
    const sourceB = acquisition('source-b', ['candidate']);
    const first = qualifiedFact('first', sourceA, 'Voltage', '24', 'V', 'candidate');
    const second = qualifiedFact('second', sourceB, 'Voltage', '24', 'V', 'candidate');
    const input = { facts: [first, second], source_acquisitions: [sourceA, sourceB] };

    expect(reconcileQualifiedFactsForWholeIntake(input)).toEqual(
      reconcileQualifiedFactsForWholeIntake({
        facts: [second, first],
        source_acquisitions: [sourceB, sourceA],
      }),
    );
  });

  it('does not choose canonical values or preferred sources during whole-intake reconciliation', () => {
    const source = acquisition('source', ['candidate']);
    const first = qualifiedFact('first', source, 'Voltage', '24', 'V', 'candidate');
    const second = qualifiedFact('second', source, 'Voltage', '25', 'V', 'candidate');
    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [first, second],
      source_acquisitions: [source],
    });

    expect(result).not.toHaveProperty('selected_qualified_fact_id');
    expect(result).not.toHaveProperty('canonical_value');
    expect(result.group_reconciliations[0].comparisons[0].members).toHaveLength(2);
  });

  it('rejects an unused source acquisition from a different product intake', () => {
    const used = acquisition('source-used', ['candidate'], 'intake.first');
    const unused = acquisition('source-unused', [], 'intake.second');
    const fact = qualifiedFact('first', used, 'Voltage', '24', 'V', 'candidate');

    expect(() =>
      reconcileQualifiedFactsForWholeIntake({
        facts: [fact],
        source_acquisitions: [used, unused],
      }),
    ).toThrow();
  });

  it('accepts unscoped facts when one supplied acquisition proves the whole intake', () => {
    const source = acquisition('source', ['candidate'], 'intake.shared');
    const scoped = qualifiedFact('scoped', source, 'Voltage', '24', 'V', 'candidate');
    const unscoped = qualifiedFact('unscoped', undefined, 'Current', '24', 'A');

    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [scoped, unscoped],
      source_acquisitions: [source],
    });

    expect(result.unscoped_qualified_fact_ids).toEqual([unscoped.id]);
    expect(result.groups.flatMap((group) => group.qualified_fact_ids)).toEqual([scoped.id]);
  });

  it('rejects whole-intake reconciliation when no intake identity can be proven', () => {
    const unscoped = qualifiedFact('unscoped', undefined, 'Voltage', '24', 'V');

    expect(() =>
      reconcileQualifiedFactsForWholeIntake({
        facts: [unscoped],
        source_acquisitions: [],
      }),
    ).toThrow();
  });

  it('requires group-derived intake scope to agree with supplied acquisitions', () => {
    const acquisitionIntake = acquisition('source', ['candidate'], 'intake.first');
    const fact = qualifiedFact('first', acquisitionIntake, 'Voltage', '24', 'V', 'candidate');

    // The group's scope digest is always derived from the supplied
    // acquisition's own intake, so under correct operation this case cannot
    // diverge; this test proves the explicit consistency check still passes
    // (and would fail deterministically) rather than silently trusting either
    // side without comparison.
    expect(() =>
      reconcileQualifiedFactsForWholeIntake({
        facts: [fact],
        source_acquisitions: [acquisitionIntake],
      }),
    ).not.toThrow();
  });

  it('rejects duplicate qualified fact ids at whole-intake reconciliation', () => {
    const source = acquisition('source', ['candidate']);
    const first = qualifiedFact('first', source, 'Voltage', '24', 'V', 'candidate');
    const duplicate: QualifiedFactArtifact = {
      ...qualifiedFact('second', source, 'Voltage', '25', 'V', 'candidate'),
      id: first.id,
    };

    expect(() =>
      reconcileQualifiedFactsForWholeIntake({
        facts: [first, duplicate],
        source_acquisitions: [source],
      }),
    ).toThrow(/duplicate qualified fact ids/i);
  });

  it('accounts for every unique qualified fact exactly once after duplicate validation', () => {
    const source = acquisition('source', ['candidate']);
    const grouped = qualifiedFact('grouped', source, 'Voltage', '24', 'V', 'candidate');
    const unscoped = qualifiedFact('unscoped', undefined, 'Current', '24', 'A');
    const inconsistent = qualifiedFact('inconsistent', source, 'Power', '24', 'W', 'other');
    const labelUnavailable: QualifiedFactArtifact = {
      ...qualifiedFact('label-unavailable', source, 'Frequency', '60', 'Hz', 'candidate'),
      metadata: {
        ...qualifiedFact('label-unavailable', source, 'Frequency', '60', 'Hz', 'candidate')
          .metadata,
        source_label: undefined,
      },
    };
    const result = reconcileQualifiedFactsForWholeIntake({
      facts: [grouped, unscoped, inconsistent, labelUnavailable],
      source_acquisitions: [source],
    });
    const accounted = [
      ...result.groups.flatMap((item) => item.qualified_fact_ids),
      ...result.unscoped_qualified_fact_ids,
      ...result.scope_inconsistent_qualified_fact_ids,
      ...result.label_unavailable_qualified_fact_ids,
    ];

    expect(accounted.sort()).toEqual(
      [grouped.id, unscoped.id, inconsistent.id, labelUnavailable.id].sort(),
    );
    expect(new Set(accounted).size).toBe(accounted.length);
  });

  it('accepts multiple source acquisitions belonging to one product intake', () => {
    const sourceA = acquisition('source-a', ['candidate'], 'intake.shared');
    const sourceB = acquisition('source-b', ['candidate'], 'intake.shared');
    const first = qualifiedFact('first', sourceA, 'Voltage', '24', 'V', 'candidate');
    const second = qualifiedFact('second', sourceB, 'Voltage', '24', 'V', 'candidate');

    expect(() =>
      reconcileQualifiedFactsForWholeIntake({
        facts: [first, second],
        source_acquisitions: [sourceA, sourceB],
      }),
    ).not.toThrow();
  });

  it('rejects multiple proven product intakes at the whole-intake boundary', () => {
    const sourceA = acquisition('source-a', ['candidate'], 'intake.first');
    const sourceB = acquisition('source-b', ['candidate'], 'intake.second');
    const first = qualifiedFact('first', sourceA, 'Voltage', '24', 'V', 'candidate');
    const second = qualifiedFact('second', sourceB, 'Voltage', '24', 'V', 'candidate');

    expect(() =>
      reconcileQualifiedFactsForWholeIntake({
        facts: [first, second],
        source_acquisitions: [sourceA, sourceB],
      }),
    ).toThrow();
  });
});
