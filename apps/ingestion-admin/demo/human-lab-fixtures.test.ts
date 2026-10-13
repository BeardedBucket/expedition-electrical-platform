// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FileIngestionJobStore } from '@expedition/ingestion-runtime';
import { type HumanAdjudicationIntent } from '@expedition/ingestion';
import { createHumanLab, humanLabScenarios } from './human-lab-fixtures.js';
import { jobDetail } from '../server/operator-views.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith('expedition-ux-lab-')
    )
      throw new Error('Unexpected lab cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});
it('prepares all controlled interactive scenarios and uses real correction, qualification and replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'expedition-ux-lab-'));
  roots.push(root);
  const store = new FileIngestionJobStore(join(root, 'jobs'));
  const { service, jobs } = await createHumanLab(store);
  expect(jobs).toHaveLength(humanLabScenarios.length);
  const get = async (name: string) =>
    jobDetail(await service.getJob(jobs.find((j) => j.scenario === name)!.id));
  const automatic = await get('automatic');
  expect(
    automatic.semantic_review?.work.automatic.some(
      (item) => item.automatic_disposition === 'mapped',
    ),
  ).toBe(true);
  const wrong = await get('wrong-property');
  const record = wrong.human_adjudication!.correction_records![0];
  expect(record.source_ready).toBe(true);
  expect(
    [...wrong.semantic_review!.work.automatic, ...wrong.semantic_review!.work.required].some(
      (item) => item.automatic_target.includes('output'),
    ),
  ).toBe(true);
  const intent: HumanAdjudicationIntent = {
    version: 'human-adjudication.v1',
    group_id: 'lab.integration',
    replaces_fact_ids: [record.fact_id],
    action: 'correct',
    disposition: 'ready',
    rationale:
      'Original retained input-current evidence corrects the controlled automatic output interpretation.',
    statements: [
      {
        ...record.statement,
        mapping: { kind: 'scalar', target: 'electrical.continuous_input_current_a' },
      },
    ],
  };
  const request = {
    expected_review_snapshot: wrong.semantic_review!.expected_review_snapshot,
    actor_label: 'Local tester',
    intent,
  };
  const preview = await service.previewHumanAdjudication(wrong.summary.id, request);
  expect(preview.assertions[0]).toMatchObject({
    normalized_value: 0.5,
    normalized_unit: 'A',
    projected: true,
  });
  const saved = await service.recordHumanAdjudication(wrong.summary.id, request);
  expect(saved.approval).toBeUndefined();
  expect(saved.final_result).toBeUndefined();
  expect((await service.getJob(saved.id)).human_adjudications).toEqual(saved.human_adjudications);
  const duplicate = await get('duplicates');
  expect(duplicate.human_adjudication!.correction_records).toHaveLength(2);
  const scope = await get('model-scope');
  expect(scope.human_adjudication!.correction_records![0].source_ready).toBe(false);
  const sibling = await get('sibling');
  // This extractor correctly emits no requested-model fact for a sibling row.
  // Adding from the retained document remains interactive and must still refuse
  // that row as requested-model proof; no synthetic qualification is inserted.
  expect(sibling.human_adjudication!.correction_records ?? []).toHaveLength(0);
  const siblingJob = await service.getJob(sibling.summary.id);
  if (siblingJob.preparation?.status !== 'review_ready') throw new Error('Missing lab source');
  const document = siblingJob.preparation.document_extractions[0];
  const tableBlock = document.blocks.find((block) =>
    block.cells?.some((cell) => cell.value === '500 mA'),
  )!;
  const valueCell = tableBlock.cells!.find((cell) => cell.value === '500 mA')!;
  const modelCell = tableBlock.cells!.find((cell) => cell.value === 'Sibling Model')!;
  const cite = (cell: typeof valueCell) => ({
    document_id: document.id,
    block_id: tableBlock.id,
    cell_id: `${cell.row}:${cell.column}`,
    quote: cell.value,
  });
  await expect(
    service.previewHumanAdjudication(sibling.summary.id, {
      expected_review_snapshot: sibling.semantic_review!.expected_review_snapshot,
      actor_label: 'Local tester',
      intent: {
        ...intent,
        group_id: 'lab.sibling',
        action: 'add',
        replaces_fact_ids: [],
        statements: [
          {
            label: 'Input current',
            value: '500 mA',
            unit: 'mA',
            wording: '500 mA',
            citations: [cite(valueCell)],
            applicability: { relationship: 'table_row', citation: cite(modelCell) },
            mapping: { kind: 'scalar', target: 'electrical.continuous_input_current_a' },
          },
        ],
      },
    }),
  ).rejects.toThrow();
  const qualified = await get('qualified');
  const rating = qualified.human_adjudication!.correction_records![0].statement;
  expect(rating.unit).toBe('A');
  expect(rating.value).toBe('150 A');
  expect(rating.wording).toBe('150 A for 5 seconds at 25°C');
  expect(rating.duration).toBe('5 seconds');
  expect(rating.temperature).toBe('25°C');
  const q: HumanAdjudicationIntent = {
    ...intent,
    group_id: 'lab.qualified',
    replaces_fact_ids: [qualified.human_adjudication!.correction_records![0].fact_id],
    statements: [
      {
        ...rating,
        mapping: {
          kind: 'source_rating',
          target: 'electrical.output_current_a',
          qualifiers: {
            direction: 'output',
            duration: rating.duration,
            temperature_context: rating.temperature,
          },
        },
      },
    ],
  };
  expect(
    (
      await service.previewHumanAdjudication(qualified.summary.id, {
        expected_review_snapshot: qualified.semantic_review!.expected_review_snapshot,
        actor_label: 'Local tester',
        intent: q,
      })
    ).assertions[0].normalized_value,
  ).toBe(150);
}, 30000); // Thirteen real TEMP pipelines and durable correction/replay, not a UI render timeout.
