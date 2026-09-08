import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProductCandidate, ProductFact, ProductSource } from '../src/contracts.js';
import {
  assessCorpusWorkflow,
  executeCorpusWorkflow,
  type CorpusWorkItem,
} from '../src/corpus-workflow.js';
import { promotionCandidateSnapshot } from '../src/promotion.js';
import { extractStructuredProductFacts } from '../src/structured-fact-extraction.js';
import type { StructuredFactMapping } from '../src/manufacturer-acquisition.js';
import { buildProductCandidate } from '../src/candidate-builder.js';

const workItem: CorpusWorkItem = {
  schema_version: '1.0',
  id: 'victron.smartsolar.scc075015060r',
  manufacturer: 'Victron Energy',
  acquisition_profile_id: 'victron-energy.web.acquisition-profile',
  source_uri:
    'https://www.victronenergy.com/solar-charge-controllers/smartsolar-mppt-75-10-75-15-100-15-100-20',
  requested_identity: {
    manufacturer: 'Victron Energy',
    manufacturer_part_number: 'SCC075015060R',
  },
  expected_component_id: 'victron-energy.smartsolar-scc075015060r',
  artifact_paths: {
    source: 'data/ingestion/victron-smartsolar-scc075015060r.json',
    candidate: 'data/ingestion/victron-smartsolar-scc075015060r.json',
    review: 'data/ingestion/victron-smartsolar-scc075015060r.review.json',
  },
};

const source: ProductSource = {
  schema_version: '1.0',
  id: 'source.smartsolar',
  uri: workItem.source_uri,
  source_type: 'manufacturer_product_page',
  authority: 'manufacturer_product',
  publisher: 'Victron Energy',
  retrieved_at: '2026-09-07T00:00:00Z',
  applicability: 'direct_identity',
  content_hash: 'sha256:source',
  product_identity_claim: {
    manufacturer: 'Victron Energy',
    manufacturer_part_number: 'SCC075015060R',
  },
};

const facts: ProductFact[] = [
  {
    schema_version: '1.0',
    id: 'fact.smartsolar.current',
    source_id: source.id,
    field: 'electrical.continuous_charge_current_a',
    raw_label: 'Rated charge current',
    raw_value: '15A',
    raw_unit: 'A',
    normalized_value: 15,
    normalized_unit: 'A',
    extraction_method: 'structured',
    fact_state: 'verified',
  },
];

const candidate: ProductCandidate = {
  schema_version: '1.0',
  id: 'candidate.smartsolar',
  identity_status: 'verified',
  identity: {
    manufacturer: 'Victron Energy',
    model: 'SmartSolar MPPT 75/15 Retail',
    manufacturer_part_number: 'SCC075015060R',
  },
  review_status: 'pending',
  promotion_status: 'review_required',
  source_ids: [source.id],
  identity_source_ids: [source.id],
  fact_ids: facts.map((fact) => fact.id),
  component_data: {
    electrical: { continuous_charge_current_a: 15 },
  },
  field_evidence: {
    'electrical.continuous_charge_current_a': [facts[0].id],
  },
};

const review = {
  schema_version: '1.0',
  id: 'review.smartsolar',
  candidate_id: candidate.id,
  decision: 'approved' as const,
  reviewer_id: 'test-reviewer',
  reviewed_at: '2026-09-07T00:01:00Z',
  approved_fields: ['electrical.continuous_charge_current_a'],
  reviewed_evidence_fact_ids: [],
  evidence_acknowledged: true,
  product_role: 'solar_charge_controller',
  category: 'solar_charge_controller',
  candidate_snapshot: '',
};

describe('corpus promotion workflow', () => {
  it('extracts only mapped fields from the selected structured record', () => {
    const mappings: readonly StructuredFactMapping[] = [
      { source_path: 'battery_voltage', raw_label: 'Supported battery voltage' },
      {
        source_path: 'rated_charge_current',
        raw_label: 'Continuous charge current',
        source_unit: 'A',
      },
      {
        source_path: 'max_pv_voltage',
        raw_label: 'Maximum PV open-circuit voltage',
        source_unit: 'V',
      },
    ];
    const first = extractStructuredProductFacts({
      source,
      raw_record: {
        sku: 'SCC075015060R',
        battery_voltage: ['12V', '24V'],
        rated_charge_current: '15A',
        max_pv_voltage: '75V',
        sibling_rated_charge_current: '10A',
      },
      record_locator: {
        script_id: '__NEXT_DATA__',
        json_path: '$.props.pageProps',
        record_collection_path: '$.products',
        record_index: 0,
      },
      mappings,
    });
    const second = extractStructuredProductFacts({
      source,
      raw_record: {
        sku: 'SCC075010060R',
        battery_voltage: ['12V', '24V'],
        rated_charge_current: '10A',
        max_pv_voltage: '75V',
      },
      record_locator: {
        script_id: '__NEXT_DATA__',
        json_path: '$.props.pageProps',
        record_collection_path: '$.products',
        record_index: 1,
      },
      mappings,
    });
    expect(first.facts.map((fact) => fact.raw_value)).toEqual([['12V', '24V'], '15A', '75V']);
    expect(first.normalized_facts.map((fact) => fact.normalized_value)).toEqual([[12, 24], 15, 75]);
    expect(first.facts.some((fact) => fact.raw_value === '10A')).toBe(false);
    expect(
      second.facts.find((fact) => fact.raw_label === 'Continuous charge current')?.raw_value,
    ).toBe('10A');
    const rebuilt = buildProductCandidate({
      id: candidate.id,
      identity: candidate.identity,
      sources: [source],
      facts: first.facts,
      normalized_facts: first.normalized_facts,
    });
    expect(rebuilt.fact_ids).toEqual(first.facts.map((fact) => fact.id).sort());
    expect(rebuilt.component_data).toEqual({
      electrical: { nominal_voltage_v: [12, 24], continuous_charge_current_a: 15 },
    });
    expect(
      first.facts.every((fact) => fact.source_locator?.fragment?.includes('__NEXT_DATA__')),
    ).toBe(true);
  });

  it('tracks source artifact to candidate and stops at human review', () => {
    expect(assessCorpusWorkflow({ work_item: workItem, source })).toMatchObject({
      state: 'source_captured',
    });

    expect(assessCorpusWorkflow({ work_item: workItem, source, candidate, facts })).toMatchObject({
      state: 'review_pending',
    });
  });

  it('requires approved review before promotion', () => {
    expect(
      assessCorpusWorkflow({
        work_item: workItem,
        source,
        candidate,
        facts,
        review: { ...review, decision: 'rejected' },
      }),
    ).toMatchObject({ state: 'review_pending' });
  });

  it('routes exact existing identity toward amendment', () => {
    expect(
      assessCorpusWorkflow({
        work_item: workItem,
        source,
        candidate,
        facts,
        review,
        canonical_components: [
          {
            id: 'other-id',
            manufacturer: 'Victron Energy',
            part_number: 'SCC075015060R',
          },
        ],
      }),
    ).toMatchObject({ state: 'amendment_required' });
  });

  it('preserves approved promotion provenance and create-only writes', async () => {
    const destinationRoot = await mkdtemp(join(tmpdir(), 'corpus-workflow-'));
    const candidateSnapshot = promotionCandidateSnapshot(candidate, [source], facts);
    const result = await executeCorpusWorkflow({
      work_item: workItem,
      source,
      candidate,
      facts,
      review: { ...review, candidate_snapshot: candidateSnapshot },
      destination_root: destinationRoot,
      write: true,
    });
    expect(result.state).toBe('promoted');
    expect(result.write?.proposal?.source_refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: source.id, fact_ids: [facts[0].id] })]),
    );
    const rerun = await executeCorpusWorkflow({
      work_item: workItem,
      source,
      candidate,
      facts,
      review: { ...review, candidate_snapshot: candidateSnapshot },
      destination_root: destinationRoot,
      write: true,
    });
    expect(rerun.state).toBe('review_approved');
    expect(rerun.write?.collision).toBe(true);
  });

  it('retains approved evidence-only facts without promoting them to canonical fields', () => {
    const evidenceFact = {
      ...facts[0],
      id: 'fact.smartsolar.pv-limit',
      raw_label: 'Maximum PV open-circuit voltage',
      raw_value: '75V',
      raw_unit: 'V',
      normalized_value: 75,
      normalized_unit: 'V',
    };
    const candidateWithEvidence = {
      ...candidate,
      fact_ids: [...candidate.fact_ids, evidenceFact.id],
    };
    const result = assessCorpusWorkflow({
      work_item: workItem,
      source,
      candidate: candidateWithEvidence,
      facts: [...facts, evidenceFact],
      review: {
        ...review,
        candidate_snapshot: promotionCandidateSnapshot(
          candidateWithEvidence,
          [source],
          [...facts, evidenceFact],
        ),
        reviewed_evidence_fact_ids: [evidenceFact.id],
      },
    });
    expect(result.state).toBe('promotion_ready');
    expect(result.promotion?.proposal?.electrical).toEqual({
      continuous_charge_current_a: 15,
    });
    expect(result.promotion?.proposal?.source_refs).toEqual([
      expect.objectContaining({ fact_ids: [facts[0].id] }),
    ]);
    expect(result.promotion?.audit?.reviewed_evidence_fact_ids).toEqual([evidenceFact.id]);
  });
});
