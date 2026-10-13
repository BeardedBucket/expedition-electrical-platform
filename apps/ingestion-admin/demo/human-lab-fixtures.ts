import { createHash } from 'node:crypto';
import {
  artifactDigest,
  buildProductionProductCandidate,
  buildProductionReviewPackage,
  buildProductionSemanticProposals,
  reconcileQualifiedFactsForWholeIntake,
  type QualifiedFactArtifact,
} from '@expedition/ingestion';
import { FileIngestionJobStore, IngestionJobService } from '@expedition/ingestion-runtime';
import { input, profile } from '../tests/fixtures.js';

const table = (heading: string, value: string, model = 'EX-1') =>
  `<table><tr><th>Model</th><th>${heading}</th></tr><tr><td>${model}</td><td>${value}</td></tr></table>`;
const current = table('Continuous input current', '500 mA');
export const humanLabScenarios = [
  {
    id: 'automatic',
    label: 'Already automatically mapped',
    instruction:
      'Correct the engineering interpretation without re-entering the valid retained source values.',
    source: current,
  },
  {
    id: 'wrong-property',
    label: 'Wrong automatic interpretation',
    instruction:
      'The controlled automatic observation claims output current. Original retained text states input current. Reuse its source value, choose input meaning and explain the correction.',
    source: current,
    fault: 'property',
  },
  {
    id: 'unmapped',
    label: 'Unmapped valid statement',
    instruction:
      'The cell is a complete exact-model input-current statement, but its heading is unrecognized. Choose engineering meaning and validate 0.5 A.',
    source: table('Unrecognized specification', 'Example Model continuous input current 500 mA'),
  },
  {
    id: 'wrong-value',
    label: 'Incorrect extracted value',
    instruction:
      'A controlled extraction fault recorded 900 instead of the retained 500 mA. Correct the value, cite the real cell and exact-model row; original observations stay unchanged.',
    source: current,
    fault: 'value',
  },
  {
    id: 'missed',
    label: 'Missed specification',
    instruction:
      'No automatic fact represents this paragraph. Add the retained exact-model statement, then map continuous input current.',
    source: '<p>Example Model continuous input current 500 mA</p>',
  },
  {
    id: 'combined',
    label: 'Combined genuine specifications',
    instruction:
      'Separate mass 2 kg and input current 500 mA into independent assertions. Keep the same retained cell and explicit model row. Do not map the combined wording as one scalar.',
    source: table('Combined specification', 'mass 2 kg and continuous input current 500 mA'),
  },
  {
    id: 'duplicates',
    label: 'Duplicate extraction fragments',
    instruction:
      'Two controlled automatic fragments refer to the same retained value cell. Choose duplicate reconciliation; select both observations. The backend still enforces shared provenance.',
    source: current,
    fault: 'duplicate',
  },
  {
    id: 'model-scope',
    label: 'Missing model relationship',
    instruction:
      'A controlled qualification failure omitted model scope. Reuse existing values; select EX-1 in the actual source row and establish the row relationship.',
    source: current,
    fault: 'scope',
  },
  {
    id: 'sibling',
    label: 'Sibling-only evidence — refused',
    instruction:
      'The automatic extractor retains no requested-model fact from this sibling-only table. Use Correct or add information to inspect the original cell and try its row proof: the real server refuses Sibling Model. Keep an unresolved draft; do not borrow its rating.',
    source: table('Continuous input current', '500 mA', 'Sibling Model'),
  },
  {
    id: 'ambiguous',
    label: 'Ambiguous shared evidence — refused',
    instruction:
      'Shared text does not establish an exact-model table column. Selecting the passage cannot supply missing ownership; preserve a draft.',
    source: '<p>Models EX-1 / EX-2</p><p>Input current 500 / 900 mA</p>',
  },
  {
    id: 'qualified',
    label: 'Duration and temperature rating',
    instruction:
      'Choose a source-conditioned output-current rating. Retain output direction, 5 seconds and 25°C. Inspect normalized results, then save and reopen the current correction.',
    source: table('Output current', '150 A for 5 seconds at 25°C'),
  },
  {
    id: 'cropped',
    label: 'Cropped conditions — refused',
    instruction:
      'Cite only 150 A and omit duration/temperature. The containing-source checks must refuse unconditional or incomplete mapping. Retain a draft or supply all actual conditions.',
    source: table('Output current', '150 A for 5 seconds at 25°C'),
  },
  {
    id: 'many',
    label: 'Many searchable retained passages',
    instruction:
      'Search for the one exact-model current statement among 90 retained entries. Browse source evidence to navigate complete result pages; only that paragraph states the current value.',
    source:
      '<p>Example Model continuous input current 500 mA</p>' +
      Array.from(
        { length: 90 },
        (_, i) =>
          `<p>Controlled background passage ${i + 1}: service note without an engineering rating.</p>`,
      ).join(''),
  },
] as const;

/** Every job/storage location is supplied by the TEMP-only lab owner. Faults
 * modify only declared synthetic automatic observations, never captured bytes.
 * Reconciliation/bridge/store validation are the real existing implementations. */
export async function createHumanLab(store: FileIngestionJobStore) {
  const service = new IngestionJobService({
    store,
    preparationRequest: () => ({
      profile,
      adapter: {
        capture: async (request) => {
          const id = new URL(request.uri).pathname.split('/').at(-1);
          const scenario = humanLabScenarios.find((entry) => entry.id === id);
          if (!scenario) throw new Error('Only declared controlled lab scenarios can be captured.');
          const text = `<html><head><title>Controlled synthetic review fixture</title></head><body><h1>${scenario.id === 'ambiguous' ? 'Models EX-1 / EX-2' : 'Example Model'}</h1>${scenario.source}</body></html>`;
          const bytes = new TextEncoder().encode(text);
          return {
            status: 'success' as const,
            issues: [],
            source: {
              requested_uri: request.uri,
              final_uri: request.uri,
              retrieved_at: '2026-10-11T00:00:00Z',
              media_type: 'text/html',
              response_status: 200,
              body: { text, bytes },
              content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
            },
          };
        },
      },
    }),
  });
  const jobs = [];
  for (const scenario of humanLabScenarios) {
    const created = await service.createJob({
      schema_version: '1.0',
      artifact_kind: 'product_intake',
      id: `intake.controlled-lab.${scenario.id}`,
      ...input,
      official_product_uri: `https://example.test/products/${scenario.id}`,
    });
    const prepared = await service.prepareJob(created.id);
    if (prepared.preparation?.status !== 'review_ready')
      throw new Error(`Controlled lab scenario did not prepare: ${scenario.id}`);
    const original = prepared.preparation;
    const evidenceDigest = artifactDigest({
      captures: original.captures,
      documents: original.document_extractions,
    });
    if ('fault' in scenario && original.qualified_facts.length) {
      const facts: QualifiedFactArtifact[] = [...original.qualified_facts];
      const first = facts[0];
      if (scenario.fault === 'duplicate')
        facts.push({ ...first, id: 'controlled.duplicate-fragment' });
      if (scenario.fault === 'value')
        facts[0] = {
          ...first,
          metadata: { ...first.metadata, raw_value: '900 mA', source_wording: '900 mA' },
        };
      if (scenario.fault === 'scope')
        facts[0] = {
          ...first,
          qualification_state: 'unresolved',
          metadata: {
            ...first.metadata,
            applicability: { kind: 'unresolved', reason: 'Controlled missing model association' },
          },
        };
      if (scenario.fault === 'property')
        facts[0] = {
          ...first,
          metadata: {
            ...first.metadata,
            source_label: 'Continuous output current',
            source_wording: 'Example Model continuous output current 500 mA',
          },
          evidence: first.evidence?.map((e) =>
            e.role === 'label' ? { ...e, text: 'Continuous output current' } : e,
          ),
        };
      const reconciliation = reconcileQualifiedFactsForWholeIntake({
        facts,
        source_acquisitions: original.source_acquisitions,
      });
      const proposals = buildProductionSemanticProposals({
        facts,
        reconciliation,
        source_acquisitions: original.source_acquisitions,
      });
      const bridge = buildProductionProductCandidate({
        ...original,
        facts,
        reconciliation,
        proposals,
      });
      const review_package = buildProductionReviewPackage({
        intake: original.intake,
        reconciliation,
        bridge,
      });
      const preparation = {
        ...original,
        qualified_facts: facts,
        reconciliation,
        proposals,
        bridge,
        review_package,
      };
      if (
        evidenceDigest !==
        artifactDigest({
          captures: preparation.captures,
          documents: preparation.document_extractions,
        })
      )
        throw new Error('Lab faults must not change original evidence.');
      await store.save(
        { ...prepared, preparation },
        (await store.loadVersioned(prepared.id)).version,
      );
    }
    jobs.push({
      id: created.id,
      scenario: scenario.id,
      label: scenario.label,
      instruction: scenario.instruction,
      evidence: 'controlled synthetic source',
      automatic_fault: 'fault' in scenario ? scenario.fault : undefined,
    });
  }
  return { service, jobs };
}
