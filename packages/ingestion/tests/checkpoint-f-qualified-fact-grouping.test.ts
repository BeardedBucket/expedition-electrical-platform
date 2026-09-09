import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_SCHEMA_VERSION,
  artifactDigest,
  artifactReference,
  buildQualifiedFactArtifact,
  groupQualifiedFactsForReconciliation,
  type ApplicabilityBinding,
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
  intakeId = 'intake.shared',
  candidateIds: readonly string[] = [],
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
  candidates: candidateIds.map((candidateId) => ({
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

const acquisitionReference = (value: SourceAcquisitionArtifact) =>
  artifactReference('source_acquisition', value);

const fact = (
  id: string,
  sourceAcquisition?: SourceAcquisitionArtifact,
  overrides: {
    readonly wording?: string;
    /** Explicit value-independent comparison label. Pass `null` to omit it entirely. */
    readonly label?: string | null;
    readonly value?: string;
    readonly applicability?: ApplicabilityBinding;
    readonly acquisition_candidate_id?: string;
    readonly qualification_state?: QualifiedFactArtifact['qualification_state'];
    readonly location?: number;
  } = {},
): QualifiedFactArtifact => {
  const wording = overrides.wording ?? 'Maximum input voltage';
  const sourceLabel = overrides.label === null ? undefined : (overrides.label ?? wording);
  return buildQualifiedFactArtifact({
    source_capture: capture(`capture.${id}`),
    ...(sourceAcquisition ? { source_acquisition: acquisitionReference(sourceAcquisition) } : {}),
    ...(overrides.acquisition_candidate_id
      ? { acquisition_candidate_id: overrides.acquisition_candidate_id }
      : {}),
    metadata: {
      source_wording: wording,
      ...(sourceLabel ? { source_label: sourceLabel } : {}),
      raw_value: overrides.value ?? '24',
      source_unit: 'V',
      applicability: overrides.applicability ?? { kind: 'exact_product', value: 'MODEL-A' },
    },
    evidence: [
      {
        role: 'value',
        locator: { kind: 'generic', page: overrides.location ?? 1 },
        text: `${overrides.value ?? '24'} V`,
      },
    ],
    qualification_state: overrides.qualification_state ?? 'exact',
  });
};

const group = (
  facts: readonly QualifiedFactArtifact[],
  source_acquisitions: readonly SourceAcquisitionArtifact[],
) => groupQualifiedFactsForReconciliation({ facts, source_acquisitions });

describe('Checkpoint F qualified fact grouping', () => {
  it('groups identical qualified wording and applicability while preserving both fact ids', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source);
    const second = fact('second', source);

    expect(group([first, second], [source]).groups[0].qualified_fact_ids).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('keeps different exact product applicability in separate groups', () => {
    const source = acquisition('acquisition.shared');
    const modelA = fact('model-a', source, {
      applicability: { kind: 'exact_product', value: 'MODEL-A' },
    });
    const modelB = fact('model-b', source, {
      applicability: { kind: 'exact_product', value: 'MODEL-B' },
    });

    expect(group([modelA, modelB], [source]).groups).toHaveLength(2);
  });

  it('keeps exact and unresolved applicability in separate groups', () => {
    const source = acquisition('acquisition.shared');
    const exact = fact('exact', source, {
      applicability: { kind: 'exact_product', value: 'MODEL-A' },
    });
    const unresolved = fact('unresolved', source, { applicability: { kind: 'unresolved' } });

    expect(group([exact, unresolved], [source]).groups).toHaveLength(2);
  });

  it('keeps family and exact product applicability in separate groups', () => {
    const source = acquisition('acquisition.shared');
    const family = fact('family', source, {
      applicability: { kind: 'family', value: 'Example family' },
    });
    const exact = fact('exact', source, {
      applicability: { kind: 'exact_product', value: 'MODEL-A' },
    });

    expect(group([family, exact], [source]).groups).toHaveLength(2);
  });

  it('does not group facts merely because raw values match', () => {
    const source = acquisition('acquisition.shared');
    const voltage = fact('voltage', source, { wording: 'Nominal voltage' });
    const current = fact('current', source, { wording: 'Maximum current' });

    expect(group([voltage, current], [source]).groups).toHaveLength(2);
  });

  it('does not infer semantic equivalence between different manufacturer wording', () => {
    const source = acquisition('acquisition.shared');
    const maximum = fact('maximum', source, { wording: 'Maximum input voltage' });
    const max = fact('max', source, { wording: 'Max input voltage' });

    expect(group([maximum, max], [source]).groups).toHaveLength(2);
  });

  it('produces deterministic groups independent of input order', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source);
    const second = fact('second', source);
    const third = fact('third', source, { wording: 'Maximum current' });

    expect(group([first, second, third], [source])).toEqual(
      group([third, second, first], [source]),
    );
  });

  it('keeps same wording from different source locations as distinct group members', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, { location: 1 });
    const second = fact('second', source, { location: 2 });

    expect(group([first, second], [source]).groups[0].qualified_fact_ids).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('does not use source authority to discard or select group members', () => {
    const source = acquisition('acquisition.shared');
    const technical = fact('technical', source);
    const support = fact('support', source);

    expect(group([technical, support], [source]).groups[0].qualified_fact_ids).toEqual(
      [technical.id, support.id].sort(),
    );
  });

  it('does not group facts from different reconciliation scopes', () => {
    const firstSource = acquisition('acquisition.first', 'intake.first');
    const secondSource = acquisition('acquisition.second', 'intake.second');
    const first = fact('first', firstSource);
    const second = fact('second', secondSource);

    expect(group([first, second], [firstSource, secondSource]).groups).toHaveLength(2);
  });

  it('does not treat missing product scope as proof of shared identity', () => {
    const first = fact('first');
    const second = fact('second');
    const result = group([first, second], []);

    expect(result.groups).toEqual([]);
    expect(result.unscoped_qualified_fact_ids).toEqual([first.id, second.id].sort());
  });

  it('keeps grouping deterministic within one explicit reconciliation scope', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source);
    const second = fact('second', source);

    expect(group([first, second], [source])).toEqual(group([second, first], [source]));
  });

  it('groups facts from different acquisitions when they share one product intake', () => {
    const firstSource = acquisition('acquisition.first');
    const secondSource = acquisition('acquisition.second');
    const first = fact('first', firstSource);
    const second = fact('second', secondSource);

    expect(artifactDigest(firstSource)).not.toBe(artifactDigest(secondSource));
    expect(
      group([first, second], [firstSource, secondSource]).groups[0].qualified_fact_ids,
    ).toEqual([first.id, second.id].sort());
  });

  it('keeps facts from different product intakes in separate reconciliation scopes', () => {
    const firstSource = acquisition('acquisition.first', 'intake.first');
    const secondSource = acquisition('acquisition.second', 'intake.second');
    const first = fact('first', firstSource);
    const second = fact('second', secondSource);

    expect(group([first, second], [firstSource, secondSource]).groups).toHaveLength(2);
  });

  it('keeps unscoped facts non-comparable when no candidate or intake identity exists', () => {
    const first = fact('first');
    const second = fact('second');

    expect(group([first, second], []).unscoped_qualified_fact_ids).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('accepts candidate scope when the candidate belongs to the referenced acquisition', () => {
    const source = acquisition('acquisition.shared', 'intake.shared', ['candidate.shared']);
    const qualified = fact('candidate', source, { acquisition_candidate_id: 'candidate.shared' });
    const result = group([qualified], [source]);

    expect(result.groups[0].key.reconciliation_scope).toEqual({
      kind: 'acquisition_candidate',
      intake_digest: source.intake.digest,
      id: 'candidate.shared',
    });
  });

  it('preserves contradictory candidate acquisition binding as scope inconsistent', () => {
    const source = acquisition('acquisition.shared', 'intake.shared', ['candidate.declared']);
    const qualified = fact('candidate', source, { acquisition_candidate_id: 'candidate.other' });
    const result = group([qualified], [source]);

    expect(result.groups).toEqual([]);
    expect(result.scope_inconsistent_qualified_fact_ids).toEqual([qualified.id]);
    expect(result.unscoped_qualified_fact_ids).toEqual([]);
  });

  it('distinguishes contradictory scope from missing scope', () => {
    const source = acquisition('acquisition.shared', 'intake.shared', ['candidate.declared']);
    const contradictory = fact('contradictory', source, {
      acquisition_candidate_id: 'candidate.other',
    });
    const missing = fact('missing');
    const result = group([contradictory, missing], [source]);

    expect(result.scope_inconsistent_qualified_fact_ids).toEqual([contradictory.id]);
    expect(result.unscoped_qualified_fact_ids).toEqual([missing.id]);
  });

  it('does not use candidate id alone as a globally unique reconciliation scope', () => {
    const qualified = fact('candidate-only', undefined, {
      acquisition_candidate_id: 'candidate.standalone',
    });
    const result = group([qualified], []);

    // A candidate ID without a resolvable source acquisition has no proven
    // product-intake identity, so it must not become a comparable candidate
    // scope; candidate IDs are not proven globally unique across intakes.
    expect(result.groups).toEqual([]);
    expect(result.unscoped_qualified_fact_ids).toEqual([qualified.id]);
  });

  it('groups conflicting values by value-independent source label', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, {
      wording: 'Maximum voltage: 24 V',
      label: 'Maximum voltage',
      value: '24',
    });
    const second = fact('second', source, {
      wording: 'Maximum voltage: 25 V',
      label: 'Maximum voltage',
      value: '25',
    });

    expect(first.metadata.source_wording).not.toBe(second.metadata.source_wording);
    const result = group([first, second], [source]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].qualified_fact_ids).toEqual([first.id, second.id].sort());
  });

  it('does not heuristically strip values from source wording when comparison label is missing', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, {
      wording: 'Maximum voltage: 24 V',
      label: null,
      value: '24',
    });
    const second = fact('second', source, {
      wording: 'Maximum voltage: 25 V',
      label: null,
      value: '25',
    });
    const result = group([first, second], [source]);

    expect(result.groups).toEqual([]);
    expect(result.label_unavailable_qualified_fact_ids).toEqual([first.id, second.id].sort());
  });

  it('preserves original source wording separately from comparison label identity', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, {
      wording: 'Maximum voltage: 24 V',
      label: 'Maximum voltage',
      value: '24',
    });
    const second = fact('second', source, {
      wording: 'Maximum voltage: 25 V',
      label: 'Maximum voltage',
      value: '25',
    });

    group([first, second], [source]);

    expect(first.metadata.source_wording).toBe('Maximum voltage: 24 V');
    expect(second.metadata.source_wording).toBe('Maximum voltage: 25 V');
    expect(first.metadata.source_label).toBe('Maximum voltage');
    expect(second.metadata.source_label).toBe('Maximum voltage');
  });

  it('groups the same candidate across separate acquisitions of the same product intake', () => {
    const first = acquisition('acquisition.first', 'intake.shared', ['candidate.shared']);
    const second = acquisition('acquisition.second', 'intake.shared', ['candidate.shared']);
    const firstFact = fact('first', first, { acquisition_candidate_id: 'candidate.shared' });
    const secondFact = fact('second', second, { acquisition_candidate_id: 'candidate.shared' });

    const result = group([firstFact, secondFact], [first, second]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].qualified_fact_ids).toEqual([firstFact.id, secondFact.id].sort());
  });

  it('does not group the same candidate id across different product intakes', () => {
    const first = acquisition('acquisition.first', 'intake.first', ['candidate.shared']);
    const second = acquisition('acquisition.second', 'intake.second', ['candidate.shared']);
    const firstFact = fact('first', first, { acquisition_candidate_id: 'candidate.shared' });
    const secondFact = fact('second', second, { acquisition_candidate_id: 'candidate.shared' });

    const result = group([firstFact, secondFact], [first, second]);

    expect(result.groups).toHaveLength(2);
    expect(
      result.groups.map((comparisonGroup) => comparisonGroup.qualified_fact_ids).sort(),
    ).toEqual([[firstFact.id], [secondFact.id]].sort());
  });

  it('produces deterministic candidate scope independent of acquisition input order', () => {
    const first = acquisition('acquisition.first', 'intake.shared', ['candidate.shared']);
    const second = acquisition('acquisition.second', 'intake.shared', ['candidate.shared']);
    const firstFact = fact('first', first, { acquisition_candidate_id: 'candidate.shared' });
    const secondFact = fact('second', second, { acquisition_candidate_id: 'candidate.shared' });

    const forward = group([firstFact, secondFact], [first, second]);
    const backward = group([secondFact, firstFact], [second, first]);

    expect(forward.groups[0].key.reconciliation_scope).toEqual(
      backward.groups[0].key.reconciliation_scope,
    );
    expect([...forward.groups[0].qualified_fact_ids].sort()).toEqual(
      [...backward.groups[0].qualified_fact_ids].sort(),
    );
  });

  it('does not fall back from contradictory candidate scope to product-intake grouping', () => {
    const source = acquisition('acquisition.shared', 'intake.shared', ['candidate.declared']);
    const contradictory = fact('contradictory', source, {
      acquisition_candidate_id: 'candidate.other',
    });
    const sameIntake = fact('same-intake', source);
    const result = group([contradictory, sameIntake], [source]);

    expect(result.scope_inconsistent_qualified_fact_ids).toEqual([contradictory.id]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].qualified_fact_ids).toEqual([sameIntake.id]);
  });

  it('rejects duplicate qualified fact ids before production grouping', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, { value: '24' });
    const duplicate: QualifiedFactArtifact = {
      ...fact('second', source, { value: '25' }),
      id: first.id,
    };

    expect(() => group([first, duplicate], [source])).toThrow(/duplicate qualified fact ids/i);
  });

  it('does not silently overwrite different qualified facts that share an id', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, { value: '24' });
    const duplicate: QualifiedFactArtifact = {
      ...fact('second', source, { value: '25' }),
      id: first.id,
    };

    // Both artifacts carry the same id but disagree in raw_value; the
    // implementation must reject this outright rather than letting a
    // fact-id-keyed map keep only one of them.
    expect(() => group([first, duplicate], [source])).toThrow();
    expect(first.metadata.raw_value).not.toBe(duplicate.metadata.raw_value);
  });

  it('reports duplicate qualified fact ids deterministically', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, { value: '24' });
    const duplicate: QualifiedFactArtifact = {
      ...fact('second', source, { value: '25' }),
      id: first.id,
    };

    let forwardError: unknown;
    let backwardError: unknown;
    try {
      group([first, duplicate], [source]);
    } catch (error) {
      forwardError = error;
    }
    try {
      group([duplicate, first], [source]);
    } catch (error) {
      backwardError = error;
    }

    expect((forwardError as Error).message).toBe((backwardError as Error).message);
    expect((forwardError as Error).message).toContain(first.id);
  });

  it('groups identical applicability despite different explanatory reasons', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, {
      applicability: { kind: 'exact_product', value: 'MODEL-A', reason: 'matched by SKU' },
    });
    const second = fact('second', source, {
      applicability: { kind: 'exact_product', value: 'MODEL-A', reason: 'matched by table header' },
    });

    expect(first.metadata.applicability.reason).not.toBe(second.metadata.applicability.reason);
    const result = group([first, second], [source]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].qualified_fact_ids).toEqual([first.id, second.id].sort());
  });

  it('preserves applicability reason on original qualified facts', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, {
      applicability: { kind: 'exact_product', value: 'MODEL-A', reason: 'matched by SKU' },
    });
    const second = fact('second', source, {
      applicability: { kind: 'exact_product', value: 'MODEL-A', reason: 'matched by table header' },
    });

    group([first, second], [source]);

    expect(first.metadata.applicability.reason).toBe('matched by SKU');
    expect(second.metadata.applicability.reason).toBe('matched by table header');
  });

  it('groups exact and structurally supported facts for scalar reconciliation', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, { qualification_state: 'exact', value: '24' });
    const second = fact('second', source, {
      qualification_state: 'structurally_supported',
      value: '24',
    });

    expect(first.qualification_state).not.toBe(second.qualification_state);
    const result = group([first, second], [source]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].qualified_fact_ids).toEqual([first.id, second.id].sort());
  });

  it('produces deterministic group identity independent of explanatory applicability reason', () => {
    const source = acquisition('acquisition.shared');
    const first = fact('first', source, {
      applicability: { kind: 'exact_product', value: 'MODEL-A', reason: 'matched by SKU' },
    });
    const second = fact('second', source, {
      applicability: { kind: 'exact_product', value: 'MODEL-A', reason: 'matched by table header' },
    });

    const forward = group([first, second], [source]);
    const backward = group([second, first], [source]);

    expect(forward.groups[0].id).toBe(backward.groups[0].id);
    expect(forward.groups[0].key).toEqual(backward.groups[0].key);
  });
});
