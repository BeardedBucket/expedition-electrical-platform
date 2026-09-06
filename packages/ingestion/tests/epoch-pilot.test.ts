import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import persistedArtifact from '../../../data/ingestion/epoch-24v-100ah-b24100a-c.json' with { type: 'json' };
import { buildProductCandidate } from '../src/candidate-builder.js';
import { isSourceApplicable, type ProductSource } from '../src/contracts.js';
import {
  buildEpochCandidate,
  epochArtifact,
  epochCapturedSource,
  epochFacts,
  epochIdentity,
  epochManualFacts,
  epochSources,
  evaluateEpochIdentityGate,
  legacyEpochSources,
  replayEpochArtifact,
  reconcileEpochSpecifications,
  validatePersistedEpochArtifact,
} from '../src/epoch-pilot.js';
import { evaluatePilotIdentityGate } from '../src/pilot-config.js';
import { normalizeProductFact } from '../src/normalize-fact.js';
import { reconcileProductFacts } from '../src/reconciliation.js';
import epochReview from '../../../data/ingestion/epoch-24v-100ah-b24100a-c.review.json' with { type: 'json' };
import { promoteCandidate } from '../src/promotion.js';
import { writeCanonicalComponent } from '../src/promotion-write.js';

describe('Epoch 24V 100Ah replay migration', () => {
  it('builds and replays a persisted noncanonical captured source artifact', () => {
    expect(epochCapturedSource.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(epochArtifact.source.content_hash).toBe(epochCapturedSource.content_hash);
    expect(validatePersistedEpochArtifact(persistedArtifact).ok).toBe(true);
    const replayed = replayEpochArtifact(persistedArtifact);
    expect(replayed.validation.ok).toBe(true);
    expect(replayed.candidate).toEqual(persistedArtifact.candidate);
    expect(replayed.report).toEqual(persistedArtifact.report);
  });

  it('creates stable replay output for the same captured content', () => {
    const extractedA = epochArtifact.facts;
    const extractedB = epochArtifact.facts;
    expect(extractedA).toEqual(extractedB);

    const normalizedA = epochArtifact.facts.flatMap((fact) => {
      const source = epochSources.find((item) => item.id === fact.source_id);
      const result = source ? normalizeProductFact(fact, source) : undefined;
      return result?.status === 'normalized' && result.fact ? [result.fact] : [];
    });
    const normalizedB = epochArtifact.facts.flatMap((fact) => {
      const source = epochSources.find((item) => item.id === fact.source_id);
      const result = source ? normalizeProductFact(fact, source) : undefined;
      return result?.status === 'normalized' && result.fact ? [result.fact] : [];
    });
    expect(normalizedA).toEqual(normalizedB);

    const reconciliationA = reconcileEpochSpecifications();
    const reconciliationB = reconcileEpochSpecifications();
    expect(reconciliationA).toEqual(reconciliationB);
    expect(buildEpochCandidate()).toEqual(buildEpochCandidate());
  });

  it('rejects changed hash and changed content', () => {
    const corrupted = JSON.parse(JSON.stringify(persistedArtifact));
    corrupted.source.content_hash =
      'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    expect(validatePersistedEpochArtifact(corrupted).ok).toBe(false);
    expect(() => replayEpochArtifact(corrupted)).toThrow();

    const mutated = JSON.parse(JSON.stringify(persistedArtifact));
    mutated.facts[0].raw_value = '99Ah';
    expect(validatePersistedEpochArtifact(mutated).ok).toBe(false);
  });

  it('source_id alone is not proof of applicability', () => {
    const source: Pick<ProductSource, 'applicability'> = { applicability: undefined };
    expect(isSourceApplicable(source)).toBe(false);
    expect(isSourceApplicable({ applicability: 'not_applicable' })).toBe(false);
    expect(isSourceApplicable({ applicability: 'direct_identity' })).toBe(true);
  });

  it('gates not_applicable and unresolved applicability before selection', () => {
    const direct = normalizeProductFact(
      {
        schema_version: '1.0',
        id: 'epoch.fact.direct',
        source_id: 'epoch-s1',
        field: 'unmapped',
        raw_label: 'Nominal voltage',
        raw_value: '24 V',
        raw_unit: 'V',
        extraction_method: 'table',
        review_required: true,
        fact_state: 'provisional',
      },
      {
        schema_version: '1.0',
        id: 'epoch-s1',
        uri: 'https://example.invalid/direct',
        source_type: 'manufacturer_product_page',
        authority: 'manufacturer_product',
        publisher: 'Epoch Batteries',
        retrieved_at: '2026-09-05T00:00:00Z',
        applicability: 'direct_identity',
        product_identity_claim: {
          manufacturer: 'Epoch Batteries',
          model: 'Model X',
          manufacturer_part_number: 'X-1',
        },
      },
    );

    const notApplicable = normalizeProductFact(
      { ...direct.fact!.fact, id: 'epoch.fact.notapp', source_id: 'epoch-s2' },
      {
        schema_version: '1.0',
        id: 'epoch-s2',
        uri: 'https://example.invalid/na',
        source_type: 'manufacturer_product_page',
        authority: 'manufacturer_product',
        publisher: 'Epoch Batteries',
        retrieved_at: '2026-09-05T00:00:00Z',
        applicability: 'not_applicable',
      },
    );
    const unresolved = normalizeProductFact(
      { ...direct.fact!.fact, id: 'epoch.fact.unresolved', source_id: 'epoch-s3' },
      {
        schema_version: '1.0',
        id: 'epoch-s3',
        uri: 'https://example.invalid/unresolved',
        source_type: 'manufacturer_product_page',
        authority: 'manufacturer_product',
        publisher: 'Epoch Batteries',
        retrieved_at: '2026-09-05T00:00:00Z',
        applicability: 'unresolved',
      },
    );

    expect(
      reconcileProductFacts({
        candidate_id: 'epoch.gate',
        identity: epochIdentity,
        sources: [notApplicable.fact!.source],
        facts: [notApplicable.fact!.fact],
        normalized_facts: [notApplicable.fact!],
      }).fields,
    ).toEqual([]);
    expect(
      reconcileProductFacts({
        candidate_id: 'epoch.gate',
        identity: epochIdentity,
        sources: [unresolved.fact!.source],
        facts: [unresolved.fact!.fact],
        normalized_facts: [unresolved.fact!],
      }).fields,
    ).toEqual([]);
  });

  it('matches legacy manual facts to replay output for the accepted battery values', () => {
    const replay = buildEpochCandidate();
    const manualCandidate = buildProductCandidate({
      id: 'epoch-legacy.manual-candidate',
      identity: epochIdentity,
      sources: legacyEpochSources,
      facts: epochManualFacts,
      normalized_facts: epochManualFacts.flatMap((fact) => {
        const source = legacyEpochSources.find((item) => item.id === fact.source_id);
        if (!source) return [];
        const normalized = normalizeProductFact(fact, source);
        return normalized.status === 'normalized' && normalized.fact ? [normalized.fact] : [];
      }),
    });

    expect(replay.component_data).toMatchObject(manualCandidate.component_data);
    expect(replay.component_data).toMatchObject({
      electrical: {
        nominal_voltage_v: 25.6,
        continuous_discharge_current_a: 120,
        peak_discharge_current_a: 200,
        peak_discharge_duration_s: 60,
      },
      battery: {
        nominal_capacity_ah: 100,
        nominal_energy_wh: 2560,
        chemistry: 'lifepo4',
        charge_current: { recommended_a: 50 },
        allowed_series_count: { min: 1, max: 2 },
        allowed_parallel_count: { min: 1, max: 4 },
      },
    });
  });

  it('preserves raw source units and rejects calculated 2400Wh as a manufacturer fact', () => {
    const candidate = buildEpochCandidate();
    expect(epochFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          raw_label: 'Nominal energy',
          raw_value: '2.56 kWh',
          raw_unit: 'kWh',
        }),
        expect.objectContaining({
          raw_label: 'Max continuous discharge',
          raw_value: '120A',
          raw_unit: 'A',
        }),
      ]),
    );
    expect(candidate.component_data.battery.nominal_energy_wh).toBe(2560);
    expect(candidate.component_data.battery.nominal_energy_wh).not.toBe(2400);
    expect(candidate.component_data).not.toHaveProperty('battery.nominal_energy_wh', 2400);
  });

  it('keeps evidence-only claims out of selected component data', () => {
    const candidate = buildEpochCandidate();
    expect(candidate.component_data).not.toHaveProperty(
      'battery.charge_current.maximum_continuous_a',
    );
    expect(candidate.component_data).not.toHaveProperty(
      'battery.charge_current.protection_limit_a',
    );
    expect(candidate.component_data).not.toHaveProperty('electrical.nominal_voltage_v', 24);
    expect(candidate.component_data).not.toHaveProperty('battery.nominal_energy_wh', 2400);
    expect(candidate.component_data).not.toHaveProperty('electrical.peak_discharge_duration_s', 10);
  });

  it('resolves only the official identity before specification work', () => {
    expect(evaluateEpochIdentityGate()).toEqual({
      status: 'resolved',
      can_proceed_to_specification: true,
      required_fields: ['manufacturer', 'model', 'manufacturer_part_number'],
      missing_fields: [],
    });
    expect(epochIdentity).toEqual({
      manufacturer: 'Epoch Batteries',
      product_family: '24V Lithium Batteries',
      model: '24V 100Ah LiFePO4 Battery (2.56kWh)',
      manufacturer_part_number: 'B24100A-C',
      voltage_variant: '24V',
    });
    expect(
      evaluatePilotIdentityGate(epochIdentity, epochSources, [
        'manufacturer',
        'model',
        'manufacturer_part_number',
      ]),
    ).toMatchObject({ status: 'resolved', can_proceed_to_specification: true });
  });

  it('keeps the candidate in review-required state while replaying the same persisted source', () => {
    const candidate = buildEpochCandidate();
    expect(candidate.identity_status).toBe('verified');
    expect(candidate.review_status).toBe('pending');
    expect(candidate.promotion_status).toBe('review_required');
    expect(candidate.fact_ids.length).toBeGreaterThan(0);
    expect(reconcileEpochSpecifications().conflicts).toEqual([]);
  });

  it('promotes the bound Epoch subset in a schema-valid dry run', async () => {
    const artifact = replayEpochArtifact(persistedArtifact);
    const promotion = promoteCandidate(
      artifact.candidate,
      [persistedArtifact.source],
      persistedArtifact.facts,
      epochReview,
    );
    expect(promotion.status).toBe('success');
    const destinationRoot = await mkdtemp(join(tmpdir(), 'epoch-promotion-'));
    try {
      const result = await writeCanonicalComponent({
        promotion,
        destinationRoot,
        write: false,
      });
      expect(result.status).toBe('dry_run');
      expect(result.path).toMatch(/epoch-batteries\.b24100a-c\.yaml$/);
      expect(result.schema_valid).toBe(true);
      expect(result.proposal).toMatchObject({
        battery: {
          allowed_parallel_count: { min: 1, max: 4 },
          allowed_series_count: { min: 1, max: 2 },
          charge_current: { recommended_a: 50 },
          nominal_capacity_ah: 100,
          nominal_energy_wh: 2560,
          chemistry: 'lifepo4',
        },
        electrical: {
          nominal_voltage_v: 25.6,
          continuous_discharge_current_a: 120,
          peak_discharge_current_a: 200,
          peak_discharge_duration_s: 60,
        },
        weight_kg: 21.999229945,
      });
      expect(result.proposal).not.toHaveProperty('dimensions_mm');
      expect(result.proposal).not.toHaveProperty('battery.charge_current.maximum_continuous_a');
      expect(result.proposal).not.toHaveProperty('electrical.operating_voltage_range_v');
      expect(result.proposal).not.toHaveProperty('battery.nominal_energy_wh', 2400);
      expect(result.audit?.omitted_fields).toEqual([
        'battery.allowed_parallel_count.max',
        'battery.allowed_parallel_count.min',
        'battery.allowed_series_count.max',
        'battery.allowed_series_count.min',
        'dimensions_mm.x',
        'dimensions_mm.z',
      ]);
    } finally {
      await rm(destinationRoot, { recursive: true });
    }
  });
});
