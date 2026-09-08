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
  evidence_acknowledged: true,
  product_role: 'solar_charge_controller',
  category: 'solar_charge_controller',
  candidate_snapshot: '',
};

describe('corpus promotion workflow', () => {
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
});
