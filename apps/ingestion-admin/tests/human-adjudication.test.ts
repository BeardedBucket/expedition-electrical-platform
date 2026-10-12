// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  artifactDigest,
  humanStatementFact,
  previewHumanMapping,
  previewReviewedSemanticMapping,
  reconcileQualifiedFactsForWholeIntake,
  buildProductionSemanticProposals,
  buildProductionProductCandidate,
  buildProductionReviewPackage,
  reviewPackageSnapshot,
  validateHumanAdjudicationIntent,
  sourceSupportsQualifiedValue,
  replayHumanSourceFacts,
  type HumanAdjudicationIntent,
  type HumanSourceStatement,
  type DocumentExtractionArtifact,
  type ReviewReadyProductionIngest,
  type ProductIntake,
  type CanonicalQualifiedValue,
} from '@expedition/ingestion';
import {
  IngestionJobService,
  FileIngestionJobStore,
  JobStoreConflictError,
} from '@expedition/ingestion-runtime';
import { createOperatorApi } from '../server/api.js';
import { jobDetail } from '../server/operator-views.js';
import { input, profile } from './fixtures.js';
import {
  createHumanSourceEvent,
  rebuildHumanPreparation,
} from '../../../packages/ingestion-runtime/src/human-review.js';
import {
  canonicalEngineeringContent,
  canonicalEngineeringDigest,
  canonicalLineageDigest,
  canonicalVerificationEventId,
  hasCurrentCanonicalVerification,
  type CanonicalVerificationEvent,
} from '../../../packages/engineering-core/src/canonical-verification.js';

const roots: string[] = [];
function assertCleanupTarget(root: string) {
  const candidate = resolve(root);
  // mkdtemp owns only a direct child of the OS temp directory. Compare path
  // components using the host's separators; a string prefix also admits nesting.
  if (
    dirname(candidate) !== resolve(tmpdir()) ||
    !basename(candidate).startsWith('human-adjudication-')
  )
    throw new Error('Unexpected cleanup target');
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    assertCleanupTarget(root);
    await rm(root, { recursive: true, force: true });
  }
});

describe('human adjudication cleanup ownership', () => {
  it.each([
    join(tmpdir(), 'human-adjudication-fixture'),
    join(tmpdir(), 'unused', '..', 'human-adjudication-fixture'),
  ])('accepts an owned direct temporary child: %s', (root) => {
    expect(() => assertCleanupTarget(root)).not.toThrow();
  });
  it.each([
    tmpdir(),
    join(tmpdir(), 'unrelated-fixture'),
    join(
      dirname(resolve(tmpdir())),
      `${basename(resolve(tmpdir()))}-other`,
      'human-adjudication-fixture',
    ),
    join(tmpdir(), 'human-adjudication-parent', 'human-adjudication-fixture'),
    join(tmpdir(), 'unrelated-parent', 'human-adjudication-fixture'),
    join(tmpdir(), 'human-adjudication-fixture', '..', '..', 'human-adjudication-outside'),
  ])('refuses an unowned cleanup target before filesystem access: %s', (root) => {
    expect(() => assertCleanupTarget(root)).toThrow('Unexpected cleanup target');
  });
});

const lines = [
  'Example Model continuous input current 500 mA',
  'Example Model output current 150 A for 5 seconds at 25°C',
  'Example Model mass 2 kg and continuous input current 500 mA',
  'Sibling Model input current 900 mA',
  'Example Model continuous input current 900 mA',
  'Example Model output voltage 14 - 16 VDC at 25°C',
  'Example Model input current <5 mA at 25°C',
  'Example Model standby consumption 8 W at 25°C',
  'Example Model outer body dimensions H x W x D 12 x 18 x 3 cm (without connectors)',
  'Example Model outer body dimensions 12 x 18 x 3 cm (without connectors)',
  'Example Model continuous input current 500 mA for 5 seconds',
  'Example Model nominal outer body dimensions H x W x D 12 x 18 x 3 cm (without connectors)',
];
async function fixture(
  table = '<table><tr><th>Model</th><th>Mystery</th></tr><tr><td>EX-1</td><td>500 mA</td></tr></table>',
  retainedHtml?: string,
  intakeFields: Omit<ProductIntake, 'schema_version' | 'artifact_kind' | 'id'> = input,
) {
  const root = await mkdtemp(join(tmpdir(), 'human-adjudication-'));
  roots.push(root);
  const store = new FileIngestionJobStore(join(root, 'jobs'));
  const make = () =>
    new IngestionJobService({
      store,
      preparationRequest: () => ({
        profile: {
          ...profile,
          manufacturer: intakeFields.manufacturer,
          publisher: intakeFields.manufacturer,
        },
        adapter: {
          capture: async (request) => {
            const text =
              (retainedHtml
                ? retainedHtml.includes('<html')
                  ? retainedHtml
                  : `<html><body>${retainedHtml}</body></html>`
                : undefined) ??
              `<html><body><h1>Example Model</h1>${lines.map((line) => `<p>${line}</p>`).join('')}${table}</body></html>`;
            const bytes = new TextEncoder().encode(text);
            return {
              status: 'success' as const,
              issues: [],
              source: {
                requested_uri: request.uri,
                final_uri: request.uri,
                retrieved_at: '2026-10-10T00:00:00.000Z',
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
  const service = make();
  const job = await service.createJob({
    schema_version: '1.0',
    artifact_kind: 'product_intake',
    id: 'intake.human',
    ...intakeFields,
  });
  const prepared = await service.prepareJob(job.id);
  if (prepared.preparation?.status !== 'review_ready') throw new Error('No preparation');
  return { root, store, service, make, id: job.id, job: prepared, p: prepared.preparation };
}
function statement(
  p: ReviewReadyProductionIngest,
  line = lines[0],
  value = '500',
  unit = 'mA',
): HumanSourceStatement {
  const d = p.document_extractions.find((d) => d.blocks.some((b) => b.content === line))!;
  const b = d.blocks.find((b) => b.content === line)!;
  const citation = { document_id: d.id, block_id: b.id, quote: line };
  return {
    label: 'Input current',
    value,
    unit,
    wording: line,
    citations: [citation],
    applicability: { relationship: 'statement', citation },
    mapping: { kind: 'scalar', target: 'electrical.continuous_input_current_a' },
  };
}
function intent(s: HumanSourceStatement): HumanAdjudicationIntent {
  return {
    version: 'human-adjudication.v1',
    group_id: 'group.input-current',
    replaces_fact_ids: [],
    action: 'add',
    disposition: 'ready',
    statements: [s],
    rationale: 'The retained manufacturer statement identifies this exact model and source value.',
  };
}
function request(p: ReviewReadyProductionIngest, i: HumanAdjudicationIntent) {
  return {
    expected_review_snapshot: reviewPackageSnapshot(p.review_package),
    actor_label: 'Local engineer',
    intent: i,
  };
}
const proof = (p: ReviewReadyProductionIngest, s: HumanSourceStatement) =>
  humanStatementFact({
    version: 'human-adjudication.v1',
    event_id: 'human.test',
    statement_index: 0,
    intake: p.intake,
    statement: s,
    documents: p.document_extractions,
  });

describe('source-backed human adjudication', () => {
  it('integrates HTTP correction, qualified candidates and repeated durable review without approval', async () => {
    const f = await fixture();
    const originalEvidence = artifactDigest({
      captures: f.p.captures,
      documents: f.p.document_extractions,
    });
    const server = createOperatorApi(f.service);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No isolated HTTP port');
      const post = (body: unknown, route: string) =>
        fetch(`http://127.0.0.1:${address.port}/api/ingestion/jobs/${f.id}/review/${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      // The paragraph is deliberately missed by automatic table qualification.
      // Both passes use the real API, store codec, source proof and candidate bridge.
      const source: HumanSourceStatement = {
        ...statement(f.p, lines[1], '150', 'A'),
        label: 'Output current',
        duration: '5 seconds',
        temperature: '25°C',
        mapping: {
          kind: 'source_rating',
          target: 'electrical.output_current_a',
          qualifiers: {
            direction: 'output',
            duration: '5 seconds',
            temperature_context: '25°C',
          },
        },
      };
      let current = f.job;
      for (let revision = 1; revision <= 2; revision++) {
        if (current.preparation?.status !== 'review_ready') throw new Error('Missing review');
        const previous = current.human_adjudications?.at(-1);
        const correction: HumanAdjudicationIntent = {
          ...intent(source),
          group_id: 'integration.qualified-missed-source',
          ...(previous ? { previous_event_id: previous.id } : {}),
          rationale: `Review ${revision}: preserve the complete retained duration and temperature.`,
        };
        const req = request(current.preparation, correction);
        const preview = await post(req, 'human-preview');
        expect(preview.status).toBe(200);
        expect((await preview.json()).assertions[0]).toMatchObject({
          normalized_value: 150,
          normalized_unit: 'A',
          projected: true,
        });
        expect((await post(req, 'human-adjudication')).status).toBe(200);
        // A fresh store and service enforce persisted replay rather than an in-memory cache.
        current = await new IngestionJobService({
          store: new FileIngestionJobStore(join(f.root, 'jobs')),
        }).getJob(f.id);
        if (current.preparation?.status !== 'review_ready') throw new Error('Missing replay');
        expect(current.human_adjudications).toHaveLength(revision);
        expect(current.preparation.bridge.candidate?.component_data.qualified_values).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              target: 'electrical.output_current_a',
              value: 150,
              qualifiers: expect.objectContaining({
                duration: '5 seconds',
                temperature_context: '25°C',
                source_conditions: [lines[1]],
              }),
            }),
          ]),
        );
        expect(current.preparation.bridge.candidate?.component_data.electrical).toBeUndefined();
        expect(current.approval).toBeUndefined();
        expect(current.final_result).toBeUndefined();
        expect(current.state).toBe('review_ready');
        expect(
          artifactDigest({
            captures: current.preparation.captures,
            documents: current.preparation.document_extractions,
          }),
        ).toBe(originalEvidence);
        expect(current.human_adjudication_original).toEqual(f.p);
        expect((await post(req, 'human-adjudication')).status).toBe(409);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
  it('retains a source-supported measurement-accuracy gap through durable review without a false current mapping', async () => {
    const f = await fixture(
      '<table><tr><th>Model</th><th>Current measurement accuracy</th></tr><tr><td>EX-1</td><td>±0.4% with a 500 A shunt</td></tr></table>',
    );
    const proposal = f.p.proposals[0];
    expect(proposal.disposition).not.toBe('mapped');
    const result = await f.service.recordSemanticDecision(f.id, {
      expected_review_snapshot: reviewPackageSnapshot(f.p.review_package),
      proposal_id: proposal.id,
      actor_label: 'Local integration reviewer',
      outcome: 'schema_gap',
      schema_gap: {
        concept_key: 'measurement.current_accuracy',
        explanation:
          'Measurement accuracy with an explicit shunt basis is distinct from current magnitude and efficiency; no supported mapping represents that test basis.',
      },
      rationale:
        'Retain the measurement assertion and its 500 A shunt condition for a versioned contract addition.',
    });
    const reopened = await new IngestionJobService({
      store: new FileIngestionJobStore(join(f.root, 'jobs')),
    }).getJob(f.id);
    expect(reopened).toEqual(result);
    if (reopened.preparation?.status !== 'review_ready') throw new Error('Missing gap review');
    expect(reopened.preparation.bridge.reviewed_semantic_decisions?.at(-1)).toMatchObject({
      outcome: 'schema_gap',
      schema_gap: { concept_key: 'measurement.current_accuracy' },
    });
    expect(reopened.preparation.bridge.candidate).toBeUndefined();
    expect(reopened.approval).toBeUndefined();
    expect(reopened.final_result).toBeUndefined();
  });
  it('rejects arbitrary canonical payloads and unknown versions', () => {
    const i = { ...intent({} as HumanSourceStatement), version: 'unknown' };
    expect(validateHumanAdjudicationIntent(i)).toBe(false);
    expect(
      validateHumanAdjudicationIntent({
        ...i,
        version: 'human-adjudication.v1',
        normalized_value: 42,
      }),
    ).toBe(false);
  });
  it('normalizes a human scalar from source units and reconstructs a candidate', async () => {
    const f = await fixture();
    const s = statement(f.p);
    const result = await f.service.recordHumanAdjudication(f.id, request(f.p, intent(s)));
    expect(result.preparation?.status).toBe('review_ready');
    if (result.preparation?.status !== 'review_ready') return;
    expect(result.preparation.bridge.candidate?.component_data.electrical).toMatchObject({
      continuous_input_current_a: 0.5,
    });
    expect(result.approval).toBeUndefined();
    expect(result.final_result).toBeUndefined();
    expect(result.state).toBe('review_ready');
    expect(result.preparation.bridge.facts[0].fact_state).toBe('provisional');
  });
  it('retains a qualified rating duration, temperature, direction and full source wording', async () => {
    const f = await fixture();
    const s = {
      ...statement(f.p, lines[1], '150', 'A'),
      label: 'Output current',
      duration: '5 seconds',
      temperature: '25°C',
      mapping: {
        kind: 'source_rating' as const,
        target: 'electrical.output_current_a' as const,
        qualifiers: {
          direction: 'output' as const,
          duration: '5 seconds',
          temperature_context: '25°C',
        },
      },
    };
    const result = await f.service.recordHumanAdjudication(f.id, request(f.p, intent(s)));
    if (result.preparation?.status !== 'review_ready') throw new Error('Missing');
    const q = result.preparation.bridge.candidate?.component_data
      .qualified_values as CanonicalQualifiedValue[];
    expect(q?.[0]).toMatchObject({
      target: 'electrical.output_current_a',
      value: 150,
      qualifiers: {
        duration: '5 seconds',
        temperature_context: '25°C',
        direction: 'output',
        source_conditions: [lines[1]],
      },
    });
    expect(result.preparation.bridge.candidate?.component_data.electrical).toBeUndefined();
    expect(sourceSupportsQualifiedValue(result.preparation.bridge.facts[0], q[0])).toBe(true);
    expect(await f.make().getJob(f.id)).toEqual(result);
  });
  it('supports repairing malformed extracted value without overwriting original facts', async () => {
    const f = await fixture();
    const old = f.p.qualified_facts[0];
    expect(old).toBeDefined();
    const i = {
      ...intent(statement(f.p)),
      action: 'correct' as const,
      replaces_fact_ids: [old.id],
    };
    const oldHash = artifactDigest(f.p);
    const result = await f.service.recordHumanAdjudication(f.id, request(f.p, i));
    expect(artifactDigest(result.human_adjudication_original)).toBe(oldHash);
    expect(result.human_adjudication_original?.qualified_facts[0]).toEqual(old);
    expect(artifactDigest(result.human_adjudication_original?.captures)).toBe(
      artifactDigest(f.p.captures),
    );
  });
  it('splits a combined observation into distinct source-linked tasks without source loss', async () => {
    const f = await fixture();
    const original = f.p.qualified_facts[0];
    const mass = {
      ...statement(f.p, lines[2], '2', 'kg'),
      label: 'Mass',
      wording: 'mass 2 kg',
      mapping: { kind: 'scalar' as const, target: 'weight_kg' },
    };
    const current = { ...statement(f.p, lines[2]), wording: 'continuous input current 500 mA' };
    const i = {
      ...intent(mass),
      action: 'split' as const,
      replaces_fact_ids: [original.id],
      statements: [mass, current],
    };
    const result = await f.service.recordHumanAdjudication(f.id, request(f.p, i));
    expect(result.human_adjudications?.[0].facts).toHaveLength(2);
    expect(result.human_adjudication_original?.qualified_facts).toEqual(f.p.qualified_facts);
  });
  it('adds a missed specification even when no automatic proposal represents it', async () => {
    const f = await fixture();
    expect(f.p.qualified_facts.some((f) => f.metadata.source_wording === lines[0])).toBe(false);
    const result = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, intent(statement(f.p))),
    );
    expect(result.human_adjudications?.[0].intent.action).toBe('add');
    expect(result.preparation?.qualified_facts.length).toBe(f.p.qualified_facts.length + 1);
  });
  it('refuses sibling model borrowing and fabricated source quotations', async () => {
    const f = await fixture();
    await expect(
      f.service.recordHumanAdjudication(
        f.id,
        request(f.p, intent(statement(f.p, lines[3], '900'))),
      ),
    ).rejects.toThrow(/sibling/);
    const s = statement(f.p);
    await expect(
      f.service.recordHumanAdjudication(
        f.id,
        request(
          f.p,
          intent({ ...s, citations: [{ ...s.citations[0], quote: 'Invented 500 mA' }] }),
        ),
      ),
    ).rejects.toThrow(/quote/);
  });
  it('allows incomplete source drafts without suppressing evidence or granting scope', async () => {
    const f = await fixture();
    const s = {
      ...statement(f.p),
      citations: [],
      applicability: { relationship: 'unresolved' as const },
    };
    const result = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, { ...intent(s), action: 'incomplete', disposition: 'draft' }),
    );
    expect(result.human_adjudications?.[0].facts).toEqual([]);
    expect(result.preparation).toEqual(f.p);
    expect(result.human_adjudication_original).toEqual(f.p);
  });
  it('rejects omitted or altered duration and incompatible units', async () => {
    const f = await fixture();
    const s = {
      ...statement(f.p, lines[1], '150', 'A'),
      duration: '5 seconds',
      mapping: {
        kind: 'source_rating' as const,
        target: 'electrical.output_current_a' as const,
        qualifiers: { direction: 'output' as const },
      },
    };
    expect(() => previewHumanMapping(proof(f.p, s), s.mapping)).toThrow(/duration|temperature/);
    const wrong = { ...statement(f.p), mapping: { kind: 'scalar' as const, target: 'weight_kg' } };
    expect(() => previewHumanMapping(proof(f.p, wrong), wrong.mapping)).toThrow(/scalar/);
  });
  it('retains both qualified voltage bounds and explicit electrical domain', async () => {
    const f = await fixture();
    const s: HumanSourceStatement = {
      ...statement(f.p, lines[5], '14 - 16 VDC', 'VDC'),
      label: 'Output voltage',
      temperature: '25°C',
      mapping: {
        kind: 'source_rating',
        target: 'electrical.output_voltage_v',
        qualifiers: { direction: 'output', electrical_domain: 'dc', temperature_context: '25°C' },
      },
    };
    const result = await f.service.recordHumanAdjudication(f.id, request(f.p, intent(s)));
    expect(
      result.preparation?.status === 'review_ready' &&
        result.preparation.bridge.candidate?.component_data.qualified_values,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: { min: 14, max: 16 },
          qualifiers: expect.objectContaining({
            electrical_domain: 'dc',
            temperature_context: '25°C',
          }),
        }),
      ]),
    );
  });
  it('preserves an exact source comparison and refuses its alteration', async () => {
    const f = await fixture();
    const s: HumanSourceStatement = {
      ...statement(f.p, lines[6], '<5', 'mA'),
      temperature: '25°C',
      mapping: {
        kind: 'source_rating',
        target: 'electrical.input_current_a',
        qualifiers: { direction: 'input', comparison: 'less_than', temperature_context: '25°C' },
      },
    };
    expect(previewHumanMapping(proof(f.p, s), s.mapping!)).toMatchObject({
      normalized_value: 0.005,
      qualified_value: { qualifiers: { comparison: 'less_than' } },
    });
    const wrong = {
      ...s,
      mapping: {
        ...s.mapping!,
        qualifiers: {
          direction: 'input' as const,
          comparison: 'less_than_or_equal' as const,
          temperature_context: '25°C',
        },
      },
    } as HumanSourceStatement;
    expect(() => previewHumanMapping(proof(f.p, wrong), wrong.mapping!)).toThrow(
      /comparison boundary/,
    );
  });
  it('refuses operating-consumption mapping that would discard temperature or state', async () => {
    const f = await fixture();
    const s: HumanSourceStatement = {
      ...statement(f.p, lines[7], '8', 'W'),
      label: 'Power consumption',
      mapping: { kind: 'source_observation', target: 'electrical.power_consumption_w' },
    };
    expect(() => previewHumanMapping(proof(f.p, s), s.mapping!)).toThrow(/conditions/);
  });
  it('retains explicitly ordered qualified body dimensions and connector exclusions', async () => {
    const f = await fixture();
    const s: HumanSourceStatement = {
      ...statement(f.p, lines[8], '12 x 18 x 3 cm (without connectors)', 'cm'),
      label: 'Outer body dimensions',
      mapping: { kind: 'source_observation', target: 'dimensions_mm' },
    };
    const result = await f.service.recordHumanAdjudication(f.id, request(f.p, intent(s)));
    expect(
      result.preparation?.status === 'review_ready' &&
        result.preparation.bridge.candidate?.component_data.qualified_values,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'dimensions_mm',
          value: { x: 180, y: 30, z: 120 },
          qualifiers: { physical_scope: { kind: 'physical_body', exclusions: ['connectors'] } },
        }),
      ]),
    );
  });
  it('refuses body triples with unknown manufacturer order', async () => {
    const f = await fixture();
    const s: HumanSourceStatement = {
      ...statement(f.p, lines[9], '12 x 18 x 3 cm (without connectors)', 'cm'),
      mapping: { kind: 'source_observation', target: 'dimensions_mm' },
    };
    expect(() => previewHumanMapping(proof(f.p, s), s.mapping!)).toThrow(/source order/);
  });
  it('does not mistake multiplication x for a source X-axis definition', async () => {
    const f = await fixture();
    const s: HumanSourceStatement = {
      ...statement(f.p, lines[8], '12', 'cm'),
      mapping: { kind: 'scalar', target: 'dimensions_mm.x' },
    };
    expect(() => previewHumanMapping(proof(f.p, s), s.mapping!)).toThrow(/source axis/);
  });
  it('editable source labels cannot hide time-limited context from scalar validation', async () => {
    const f = await fixture();
    const s = { ...statement(f.p, lines[10]), label: lines[10] };
    expect(() => previewHumanMapping(proof(f.p, s), s.mapping!)).toThrow(
      /qualified representation/,
    );
  });
  it('does not discard a nominal basis from the body-dimension observation contract', async () => {
    const f = await fixture();
    const s: HumanSourceStatement = {
      ...statement(f.p, lines[11], '12 x 18 x 3 cm (without connectors)', 'cm'),
      mapping: { kind: 'source_observation', target: 'dimensions_mm' },
    };
    expect(() => previewHumanMapping(proof(f.p, s), s.mapping!)).toThrow(
      /material operating context/,
    );
  });
  it('source corrections and previously verified content cannot inherit downstream authority', async () => {
    const f = await fixture();
    const result = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, intent(statement(f.p))),
    );
    expect(
      result.preparation?.status === 'review_ready' &&
        result.preparation.bridge.candidate?.component_data.verification,
    ).toBeUndefined();
    const approved = { ...result, state: 'finalized' as const };
    const fakeStore = {
      ...f.store,
      load: async () => approved,
      loadVersioned: async () => ({ job: approved, version: 'x' }),
      save: async () => {
        throw new Error('Must not mutate');
      },
      create: async () => {},
    };
    const service = new IngestionJobService({
      store: fakeStore,
      preparationRequest: () => {
        throw new Error('No capture');
      },
    });
    await expect(
      service.recordHumanAdjudication(f.id, request(f.p, intent(statement(f.p)))),
    ).rejects.toThrow(/before approval/);
  });
  it('keeps append-only revisions and durably reloads corrected human observations', async () => {
    const f = await fixture();
    const first = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, intent(statement(f.p))),
    );
    if (first.preparation?.status !== 'review_ready') throw new Error('Missing');
    const event = first.human_adjudications![0];
    const nextIntent = {
      ...event.intent,
      previous_event_id: event.id,
      replaces_fact_ids: event.facts.map((f) => f.id),
      action: 'correct' as const,
      rationale: 'Reaffirm the source evidence after reopening.',
    };
    const next = await f.service.recordHumanAdjudication(
      f.id,
      request(first.preparation, nextIntent),
    );
    expect(next.human_adjudications?.[0]).toEqual(event);
    expect(next.human_adjudications?.[1].previous_digest).toBe(artifactDigest(event));
    expect(await f.make().getJob(f.id)).toEqual(next);
    const { version } = await f.store.loadVersioned(f.id);
    await expect(f.store.save({ ...next, human_adjudications: [] }, version)).rejects.toThrow(
      /invalid|append-only/i,
    );
  });
  it('refuses stale review snapshots without mutation', async () => {
    const f = await fixture();
    const req = request(f.p, intent(statement(f.p)));
    await f.service.recordHumanAdjudication(f.id, req);
    const before = await f.store.loadVersioned(f.id);
    await expect(
      f.service.recordHumanAdjudication(f.id, {
        ...req,
        intent: { ...req.intent, group_id: 'another' },
      }),
    ).rejects.toThrow(/changed/);
    expect(await f.store.loadVersioned(f.id)).toEqual(before);
  });
  it('reports CAS conflicts without automatic replay or retry', async () => {
    const f = await fixture();
    let saves = 0;
    const service = new IngestionJobService({
      store: {
        create: f.store.create.bind(f.store),
        load: f.store.load.bind(f.store),
        loadVersioned: f.store.loadVersioned.bind(f.store),
        save: async () => {
          saves++;
          throw new JobStoreConflictError('Concurrent correction');
        },
      },
      preparationRequest: () => {
        throw new Error('No capture');
      },
    });
    await expect(
      service.recordHumanAdjudication(f.id, request(f.p, intent(statement(f.p)))),
    ).rejects.toMatchObject({ status: 409 });
    expect(saves).toBe(1);
    expect((await f.service.getJob(f.id)).human_adjudications).toBeUndefined();
  });
  it('keeps genuinely different source values explicit rather than selecting a winner', async () => {
    const f = await fixture();
    const s = statement(f.p);
    const result = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, { ...intent(s), statements: [s, statement(f.p, lines[4], '900')] }),
    );
    expect(result.human_adjudications?.[0].facts).toHaveLength(2);
    expect(
      result.preparation?.status === 'review_ready' &&
        result.preparation.bridge.reviewed_semantic_interpretation.entries.some(
          (e) => e.state === 'unresolved',
        ),
    ).toBe(true);
    expect(
      result.preparation?.status === 'review_ready' &&
        result.preparation.reconciliation.group_reconciliations.some(
          (g) => g.outcome === 'conflict',
        ),
    ).toBe(true);
  });
  it('corrects a wrong automated target while retaining its original interpretation', async () => {
    const f = await fixture(
      '<table><tr><th>Model</th><th>Output current</th></tr><tr><td>EX-1</td><td>500 mA</td></tr></table>',
    );
    expect(f.p.proposals.some((p) => p.target === 'electrical.output_current_a')).toBe(true);
    const result = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, {
        ...intent(statement(f.p)),
        action: 'correct',
        replaces_fact_ids: f.p.qualified_facts.map((f) => f.id),
      }),
    );
    expect(result.human_adjudication_original?.proposals).toEqual(f.p.proposals);
    expect(
      result.preparation?.status === 'review_ready'
        ? result.preparation.bridge.candidate?.component_data.electrical
        : undefined,
    ).toMatchObject({ continuous_input_current_a: 0.5 });
  });
  it('groups same-block extraction fragments and supplies retained row applicability', async () => {
    const f = await fixture();
    // Controlled parser fault: two observations of the same source cell, not
    // two different manufacturer specifications that merely share a number.
    const facts = [
      ...f.p.qualified_facts,
      { ...f.p.qualified_facts[0], id: 'controlled.duplicate-fragment' },
    ];
    const reconciliation = reconcileQualifiedFactsForWholeIntake({
      facts,
      source_acquisitions: f.p.source_acquisitions,
    });
    const proposals = buildProductionSemanticProposals({
      facts,
      reconciliation,
      source_acquisitions: f.p.source_acquisitions,
    });
    const bridge = buildProductionProductCandidate({
      intake: f.p.intake,
      captures: f.p.captures,
      source_acquisitions: f.p.source_acquisitions,
      facts,
      reconciliation,
      proposals,
    });
    const review_package = buildProductionReviewPackage({
      intake: f.p.intake,
      reconciliation,
      bridge,
    });
    f.p = { ...f.p, qualified_facts: facts, reconciliation, proposals, bridge, review_package };
    await f.store.save({ ...f.job, preparation: f.p }, (await f.store.loadVersioned(f.id)).version);
    const d = f.p.document_extractions.find((d) => d.blocks.some((b) => b.kind === 'table'))!;
    const b = d.blocks.find((b) => b.kind === 'table')!;
    const model = b.cells!.find((c) => c.value === 'EX-1')!;
    const value = b.cells!.find((c) => c.value === '500 mA')!;
    const cite = {
      document_id: d.id,
      block_id: b.id,
      cell_id: `${value.row}:${value.column}`,
      quote: value.value,
    };
    const s: HumanSourceStatement = {
      label: 'Retained current statement',
      value: '500',
      unit: 'mA',
      wording: '500 mA',
      citations: [cite],
      applicability: {
        relationship: 'table_row',
        citation: {
          document_id: d.id,
          block_id: b.id,
          cell_id: `${model.row}:${model.column}`,
          quote: model.value,
        },
      },
    };
    const result = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, {
        ...intent(s),
        action: 'group',
        replaces_fact_ids: f.p.qualified_facts.map((f) => f.id),
      }),
    );
    expect(result.human_adjudications?.[0].facts).toHaveLength(1);
    expect(result.human_adjudication_original?.qualified_facts).toHaveLength(2);
    expect(result.preparation?.qualified_facts).toHaveLength(1);
  });
  it('does not merge distinct table specifications that happen to have the same value', async () => {
    const f = await fixture(
      '<table><tr><th>Model</th><th>Mystery one</th><th>Mystery two</th></tr><tr><td>EX-1</td><td>500 mA</td><td>500 mA</td></tr></table>',
    );
    await expect(
      f.service.recordHumanAdjudication(
        f.id,
        request(f.p, {
          ...intent(statement(f.p)),
          action: 'group',
          replaces_fact_ids: f.p.qualified_facts.map((f) => f.id),
        }),
      ),
    ).rejects.toThrow(/distinct specifications/);
  });
  it('a retained draft does not freeze ordinary legacy semantic decisions', async () => {
    const f = await fixture();
    const saved = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, { ...intent(statement(f.p)), disposition: 'draft' }),
    );
    const result = await f.service.recordSemanticDecision(f.id, {
      proposal_id: f.p.proposals[0].id,
      expected_review_snapshot: reviewPackageSnapshot(f.p.review_package),
      actor_label: 'Local reviewer',
      outcome: 'unresolved',
      rationale: 'Source correction is still being established.',
    });
    expect(result.human_adjudications).toEqual(saved.human_adjudications);
    expect(await f.make().getJob(f.id)).toEqual(result);
  });
  it('human source facts cannot bypass context enforcement through legacy scalar mapping', async () => {
    const f = await fixture();
    const s = statement(f.p);
    const fact = proof(f.p, s);
    expect(() =>
      previewReviewedSemanticMapping(
        'electrical.continuous_output_current_a',
        [fact],
        [fact],
        f.p.source_acquisitions,
      ),
    ).toThrow(/Correct source information/);
  });
  it('refuses grouping unrelated source passages', async () => {
    const f = await fixture();
    await expect(
      f.service.recordHumanAdjudication(
        f.id,
        request(f.p, {
          ...intent(statement(f.p)),
          action: 'group',
          replaces_fact_ids: f.p.qualified_facts.map((f) => f.id),
        }),
      ),
    ).rejects.toThrow(/shared retained source block/);
  });
  it('archives drafts during preparation recovery without applying them to a new capture', async () => {
    const f = await fixture('');
    const first = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, { ...intent(statement(f.p)), disposition: 'draft' }),
    );
    const reopened = await f.service.reopenPreparation(
      f.id,
      reviewPackageSnapshot(f.p.review_package),
    );
    expect(reopened.human_adjudications).toBeUndefined();
    expect(reopened.preparation_recovery_history?.[0].human_adjudications).toEqual(
      first.human_adjudications,
    );
    expect(await f.make().getJob(f.id)).toEqual(reopened);
    const prepared = await f.service.prepareJob(f.id);
    expect(prepared.human_adjudications).toBeUndefined();
  });
  it('invalidates existing content-bound verification after a material correction', () => {
    const record = { id: 'controlled.record', electrical: { continuous_input_current_a: 0.5 } };
    const event: Omit<CanonicalVerificationEvent, 'id'> = {
      revision: 1,
      policy_version: 'canonical-engineering-verification.v1',
      actor: { kind: 'operator_label', identifier: 'Local reviewer' },
      authority_boundary: 'trusted_local_operator',
      recorded_at: '2026-10-10T00:00:00Z',
      component_id: record.id,
      content_digest: canonicalEngineeringDigest(record),
      content_snapshot: canonicalEngineeringContent(record),
      lineage_digest: canonicalLineageDigest(record),
      promotion_binding: {
        job_id: 'controlled.job',
        approval_digest: `sha256:${'a'.repeat(64)}`,
        promotion_digest: `sha256:${'b'.repeat(64)}`,
        write_digest: `sha256:${'c'.repeat(64)}`,
      },
    };
    const verified = {
      ...record,
      verification_status: 'verified',
      engineering_verification_history: [{ ...event, id: canonicalVerificationEventId(event) }],
    };
    expect(hasCurrentCanonicalVerification(verified)).toBe(true);
    expect(
      hasCurrentCanonicalVerification({
        ...verified,
        electrical: { continuous_input_current_a: 0.9 },
      }),
    ).toBe(false);
  });
  it('rejects direction borrowing even with compatible scalar units', async () => {
    const f = await fixture();
    const s = {
      ...statement(f.p),
      mapping: { kind: 'scalar' as const, target: 'electrical.continuous_output_current_a' },
    };
    expect(() => previewHumanMapping(proof(f.p, s), s.mapping)).toThrow(/direction/);
  });
  it('returns real server eligibility and allowlisted corrected DTOs', async () => {
    const f = await fixture();
    const req = request(f.p, intent(statement(f.p)));
    const targets = await f.service.humanProperties(f.id, { ...req, statement_index: 0 });
    expect(
      targets.targets.some((t) => t.canonical_field === 'electrical.continuous_input_current_a'),
    ).toBe(true);
    expect(targets.targets.some((t) => t.canonical_field === 'weight_kg')).toBe(false);
    const preview = await f.service.previewHumanAdjudication(f.id, req);
    expect(preview.candidate?.electrical).toMatchObject({ continuous_input_current_a: 0.5 });
    expect((await f.service.getJob(f.id)).human_adjudications).toBeUndefined();
    const result = await f.service.recordHumanAdjudication(f.id, req);
    const dto = jobDetail(result);
    expect(dto.human_adjudication?.history).toHaveLength(1);
    expect(JSON.stringify(dto)).not.toContain('human_source');
  });
  it('HTTP rejects extra authority fields and uses the real source preview/save route', async () => {
    const f = await fixture();
    const server = createOperatorApi(f.service);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No port');
      const url = `http://127.0.0.1:${address.port}/api/ingestion/jobs/${f.id}/review/human-adjudication`;
      const post = (body: unknown, route = 'human-adjudication') =>
        fetch(url.replace(/human-adjudication$/, route), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      expect((await post({ ...request(f.p, intent(statement(f.p))), verified: true })).status).toBe(
        400,
      );
      const noReason = request(f.p, { ...intent(statement(f.p)), rationale: '' });
      const preview = await post(noReason, 'human-preview');
      expect(preview.status).toBe(200);
      expect((await preview.json()).assertions[0]).toMatchObject({
        normalized_value: 0.5,
        normalized_unit: 'A',
        projected: true,
      });
      expect((await post(noReason)).status).toBe(400);
      const discovery = {
        ...noReason,
        intent: {
          ...noReason.intent,
          statements: noReason.intent.statements.map((row) => ({ ...row, mapping: undefined })),
        },
        statement_index: 0,
        representation: { kind: 'scalar' },
      };
      expect((await post(discovery, 'human-properties')).status).toBe(200);
      expect(
        (
          await post(
            { ...discovery, representation: { kind: 'scalar', normalized_value: 0.5 } },
            'human-properties',
          )
        ).status,
      ).toBe(400);
      const sourceQuery = {
        expected_review_snapshot: noReason.expected_review_snapshot,
        document_id: f.p.document_extractions[0].id,
        offset: 0,
        query: 'Sibling Model',
      };
      const evidence = await post(sourceQuery, 'human-evidence');
      expect(evidence.status).toBe(200);
      expect(
        (await evidence.json()).entries.every((entry: { text: string }) =>
          entry.text.includes('Sibling Model'),
        ),
      ).toBe(true);
      expect((await post({ ...sourceQuery, query: 10 }, 'human-evidence')).status).toBe(400);
      expect((await f.make().getJob(f.id)).human_adjudications).toBeUndefined();
      const response = await post(request(f.p, intent(statement(f.p))));
      expect(response.status).toBe(200);
      expect((await response.json()).summary.state).toBe('review_ready');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

describe('containing manufacturer context', () => {
  it('exposes reliable correction seeds without requiring source value reconstruction', async () => {
    const f = await fixture(
      '<table><tr><th>Model</th><th>Continuous input current</th></tr><tr><td>EX-1</td><td>500 mA</td></tr></table>',
    );
    const dto = jobDetail(f.job);
    const record = dto.human_adjudication!.correction_records![0];
    expect(record.source_ready).toBe(true);
    expect(record.statement.applicability.relationship).toBe('table_row');
    const i = {
      ...intent(record.statement),
      rationale: '',
      action: 'correct' as const,
      replaces_fact_ids: [record.fact_id],
    };
    const result = await f.service.humanProperties(f.id, {
      ...request(f.p, i),
      statement_index: 0,
      representation: { kind: 'scalar' },
    });
    expect(
      result.targets.some(
        (target) => target.canonical_field === 'electrical.continuous_input_current_a',
      ),
    ).toBe(true);
    expect(record.statement.mapping).toBeUndefined();
    const selected = {
      ...i,
      statements: [
        {
          ...record.statement,
          mapping: { kind: 'scalar' as const, target: 'electrical.continuous_input_current_a' },
        },
      ],
    };
    expect(
      (await f.service.previewHumanAdjudication(f.id, request(f.p, selected))).assertions[0],
    ).toMatchObject({ normalized_value: 0.5, normalized_unit: 'A' });
    await expect(f.service.recordHumanAdjudication(f.id, request(f.p, selected))).rejects.toThrow(
      /intent|rationale|reason/,
    );
    expect((await f.make().getJob(f.id)).human_adjudications).toBeUndefined();
  });
  it('searches all retained source entries before paging without modifying the source', async () => {
    const f = await fixture(
      '',
      `<html><body><h1>Example Model</h1>${Array.from({ length: 80 }, (_, i) => `<p>Marker passage ${i} value ${i}</p>`).join('')}</body></html>`,
    );
    const digest = artifactDigest(f.p);
    const document = f.p.document_extractions[0];
    const first = await f.service.humanEvidence(f.id, {
      expected_review_snapshot: reviewPackageSnapshot(f.p.review_package),
      document_id: document.id,
      offset: 0,
      query: 'Marker',
    });
    expect(first.total).toBe(80);
    expect(first.entries).toHaveLength(50);
    expect(first.next_offset).toBe(50);
    const second = await f.service.humanEvidence(f.id, {
      expected_review_snapshot: reviewPackageSnapshot(f.p.review_package),
      document_id: document.id,
      offset: 50,
      query: 'Marker',
    });
    expect(second.entries).toHaveLength(30);
    expect(second.next_offset).toBeUndefined();
    expect(
      (
        await f.service.humanEvidence(f.id, {
          expected_review_snapshot: reviewPackageSnapshot(f.p.review_package),
          document_id: document.id,
          offset: 0,
          query: 'not retained',
        })
      ).total,
    ).toBe(0);
    expect(artifactDigest(f.p)).toBe(digest);
  });
  const conditioned = lines[0] + ' at 25°C';
  const crop = (p: ReviewReadyProductionIngest, line: string) => {
    const full = statement(p, line);
    const citation = { ...full.citations[0], quote: lines[0] };
    return { ...full, wording: lines[0], citations: [citation] };
  };
  const rating = (s: HumanSourceStatement): HumanSourceStatement => ({
    ...s,
    temperature: '25°C',
    mapping: {
      kind: 'source_rating',
      target: 'electrical.input_current_a',
      qualifiers: { direction: 'input', rating_basis: 'continuous', temperature_context: '25°C' },
    },
  });
  it('maps a complete unconditional statement but refuses a cropped temperature on preview and save', async () => {
    const safe = await fixture();
    expect(
      previewHumanMapping(proof(safe.p, statement(safe.p)), statement(safe.p).mapping!)
        .normalized_value,
    ).toBe(0.5);
    const f = await fixture('', `<h1>Example Model</h1><p>${conditioned}</p>`);
    const before = artifactDigest(await f.service.getJob(f.id));
    const s = crop(f.p, conditioned);
    expect(() => proof(f.p, s)).toThrow(/containing-source context/);
    await expect(f.service.previewHumanAdjudication(f.id, request(f.p, intent(s)))).rejects.toThrow(
      /containing-source context/,
    );
    await expect(f.service.recordHumanAdjudication(f.id, request(f.p, intent(s)))).rejects.toThrow(
      /containing-source context/,
    );
    expect(artifactDigest(await f.make().getJob(f.id))).toBe(before);
  });
  it.each(['heading', 'note'])(
    'retains a governing %s qualifier even when it was not selected',
    async (kind) => {
      const html =
        kind === 'heading'
          ? `<h1>Example Model — all ratings at 25°C</h1><p>${lines[0]}</p>`
          : `<h1>Example Model</h1><p>${lines[0]}</p><p>All ratings at 25°C</p>`;
      const f = await fixture('', html);
      expect(() => proof(f.p, statement(f.p))).toThrow(/containing-source context/);
      const s = rating(statement(f.p));
      const fact = proof(f.p, s);
      const value = previewHumanMapping(fact, s.mapping!).qualified_value!;
      expect(JSON.stringify(value)).toContain('25°C');
      expect(
        fact.evidence?.some(
          (e) =>
            (e.role === 'context' && e.text?.includes('all ratings')) ||
            e.text?.includes('All ratings'),
        ),
      ).toBe(true);
      const saved = await f.service.recordHumanAdjudication(f.id, request(f.p, intent(s)));
      expect(await f.make().getJob(f.id)).toEqual(saved);
    },
  );
  it('separates a conditioned specification from an unrelated unconditional assertion', async () => {
    const line =
      'Example Model continuous input current 500 mA; Example Model output current 150 A for 5 seconds at 25°C';
    const f = await fixture('', `<h1>Example Model</h1><p>${line}</p>`);
    const s = crop(f.p, line);
    expect(previewHumanMapping(proof(f.p, s), s.mapping!).normalized_value).toBe(0.5);
    const full = statement(f.p, line, '150', 'A');
    const wording = line.split('; ')[1];
    const qualified: HumanSourceStatement = {
      ...full,
      wording,
      citations: [{ ...full.citations[0], quote: wording }],
      duration: '5 seconds',
      temperature: '25°C',
      mapping: {
        kind: 'source_rating',
        target: 'electrical.output_current_a',
        qualifiers: { direction: 'output', duration: '5 seconds', temperature_context: '25°C' },
      },
    };
    expect(
      previewHumanMapping(proof(f.p, qualified), qualified.mapping!).qualified_value,
    ).toMatchObject({ qualifiers: { duration: '5 seconds', temperature_context: '25°C' } });
  });
  it('retains a cropped qualified statement with all its actual surrounding conditions', async () => {
    const f = await fixture('', `<h1>Example Model</h1><p>${conditioned}</p>`);
    const s = rating(crop(f.p, conditioned));
    const saved = await f.service.recordHumanAdjudication(f.id, request(f.p, intent(s)));
    if (saved.preparation?.status !== 'review_ready') throw new Error('Missing');
    const q = saved.preparation.bridge.candidate?.component_data
      .qualified_values as CanonicalQualifiedValue[];
    expect(q[0]).toMatchObject({
      qualifiers: { source_conditions: [conditioned], temperature_context: '25°C' },
    });
    expect(sourceSupportsQualifiedValue(saved.preparation.bridge.facts[0], q[0])).toBe(true);
    expect(await f.make().getJob(f.id)).toEqual(saved);
  });
  it('refuses uncertain shared qualifier ownership while preserving an unresolved draft', async () => {
    const line = 'Example Model mass 2 kg and continuous input current 500 mA at 25°C';
    const f = await fixture('', `<h1>Example Model</h1><p>${line}</p>`);
    const s = { ...statement(f.p, line), wording: 'continuous input current 500 mA' };
    expect(() => proof(f.p, rating(s))).toThrow(/ownership is uncertain/);
    const saved = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, { ...intent(s), disposition: 'draft' }),
    );
    expect(saved.human_adjudications?.[0].facts).toEqual([]);
    expect(saved.preparation).toEqual(f.p);
    const notes = await fixture(
      '',
      `<h1>Example Model</h1><p>${lines[0]}</p><p>Note: some ratings at 25°C</p>`,
    );
    expect(() => proof(notes.p, rating(statement(notes.p)))).toThrow(/ownership is uncertain/);
  });
  it('refuses omitted duration, basis, state, comparison and measurement context in cropped excerpts', async () => {
    for (const suffix of [
      ' for 5 seconds',
      ' (maximum)',
      ' in standby',
      ' with a 500 A shunt',
      ' measured RMS',
      ' under load',
    ]) {
      const line = lines[0] + suffix;
      const f = await fixture('', `<h1>Example Model</h1><p>${line}</p>`);
      expect(() => proof(f.p, crop(f.p, line))).toThrow(/containing-source context/);
    }
    const line = 'Example Model continuous input current <500 mA';
    const f = await fixture('', `<h1>Example Model</h1><p>${line}</p>`);
    const s = {
      ...statement(f.p, line),
      wording: '500 mA',
      citations: [{ ...statement(f.p, line).citations[0], quote: '500 mA' }],
      mapping: {
        kind: 'source_rating' as const,
        target: 'electrical.input_current_a' as const,
        qualifiers: { direction: 'input' as const, rating_basis: 'continuous' as const },
      },
    };
    expect(() => proof(f.p, s)).toThrow(/source comparison/);
  });
  it('revalidates retained context during replay, candidate construction and durable reload', async () => {
    const f = await fixture('', `<h1>Example Model</h1><p>${conditioned}</p>`);
    const saved = await f.service.recordHumanAdjudication(
      f.id,
      request(f.p, intent(rating(crop(f.p, conditioned)))),
    );
    if (saved.preparation?.status !== 'review_ready') throw new Error('Missing');
    const original = saved.human_adjudications![0];
    const s = crop(f.p, conditioned);
    const bad = {
      ...original,
      intent: { ...original.intent, statements: [s] },
      facts: original.facts.map((fact) => ({
        ...fact,
        human_source: { ...fact.human_source!, statement: s },
      })),
    };
    expect(() => replayHumanSourceFacts(f.p.qualified_facts, [bad])).toThrow(
      /containing-source context/,
    );
    expect(() => rebuildHumanPreparation(f.p, [bad], [])).toThrow(/containing-source context/);
    const stored = await f.store.loadVersioned(f.id);
    await expect(
      f.store.save({ ...saved, human_adjudications: [bad] }, stored.version),
    ).rejects.toThrow(/Invalid job schema or state/);
    expect(await f.make().getJob(f.id)).toEqual(saved);
    const path = join(f.root, 'unsafe-event.json');
    await writeFile(path, JSON.stringify(bad));
    const reloaded = JSON.parse(await readFile(path, 'utf8'));
    expect(() => replayHumanSourceFacts(f.p.qualified_facts, [reloaded])).toThrow(
      /containing-source context/,
    );
    expect(
      sourceSupportsQualifiedValue(
        { ...saved.preparation!.bridge.facts[0], human_source: bad.facts[0] },
        {
          ...(
            saved.preparation!.bridge.candidate!.component_data
              .qualified_values as CanonicalQualifiedValue[]
          )[0],
        },
      ),
    ).toBe(false);
  });
  it('checks table-header qualifiers independently of the selected value cell', async () => {
    const f = await fixture(
      '<table><tr><th>Model</th><th>Continuous input current (mA) at 25°C</th></tr><tr><td>EX-1</td><td>500 mA</td></tr></table>',
    );
    const document = f.p.document_extractions.find((d) =>
      d.blocks.some((b) => b.cells?.some((c) => c.value === '500 mA')),
    )!;
    const block = document.blocks.find((b) => b.cells?.some((c) => c.value === '500 mA'))!;
    const value = block.cells!.find((c) => c.value === '500 mA')!;
    const model = block.cells!.find((c) => c.value === 'EX-1')!;
    const citation = {
      document_id: document.id,
      block_id: block.id,
      cell_id: `${value.row}:${value.column}`,
      quote: value.value,
    };
    const s: HumanSourceStatement = {
      ...statement(f.p),
      wording: value.value,
      citations: [citation],
      applicability: {
        relationship: 'table_row',
        citation: { ...citation, cell_id: `${model.row}:${model.column}`, quote: model.value },
      },
    };
    expect(() => proof(f.p, s)).toThrow(/containing-source context/);
    const qualified = rating(s);
    expect(
      previewHumanMapping(proof(f.p, qualified), qualified.mapping!).qualified_value,
    ).toMatchObject({ qualifiers: { temperature_context: '25°C', rating_basis: 'continuous' } });
  });
  it('refuses unfamiliar cropped trailing context and partial numeric values', async () => {
    const line = lines[0] + ' subject to enclosure ventilation';
    const f = await fixture('', `<h1>Example Model</h1><p>${line}</p>`);
    expect(() => proof(f.p, crop(f.p, line))).toThrow(/Additional containing-source prose/);
    const safe = await fixture();
    expect(() => proof(safe.p, { ...statement(safe.p), value: '5' })).toThrow(/numeric boundary/);
  });
  it('keeps universal paragraph notes and refuses a detached qualifier with multiple possible owners', async () => {
    const line = `${lines[0]}; Example Model mass 2 kg, all ratings at 25°C`;
    const f = await fixture('', `<h1>Example Model</h1><p>${line}</p>`);
    const s = crop(f.p, line);
    expect(() => proof(f.p, s)).toThrow(/containing-source context/);
    const qualified = rating(s);
    expect(
      previewHumanMapping(proof(f.p, qualified), qualified.mapping!).qualified_value,
    ).toMatchObject({ qualifiers: { source_conditions: [lines[0] + '\nall ratings at 25°C'] } });
    const ambiguous = `${lines[0]}; Example Model mass 2 kg; at 25°C`;
    const uncertain = await fixture('', `<h1>Example Model</h1><p>${ambiguous}</p>`);
    expect(() => proof(uncertain.p, rating(crop(uncertain.p, ambiguous)))).toThrow(
      /ownership is uncertain/,
    );
  });
});

describe('controlled corpus-scale storage and replay', () => {
  it('measures one correction, revisions, many assertions and repeated document citations', async () => {
    // Twenty assertions and eight revisions are bounded workload samples, not
    // source/extraction limits. An 80 KiB unrelated document tail models retained
    // evidence duplication; five replay samples report timing without a flaky gate.
    const text = Array.from(
      { length: 20 },
      (_, i) => `Example Model continuous input current ${500 + i} mA`,
    );
    const f = await fixture(
      '',
      `<h1>Example Model</h1>${text.map((s) => `<p>${s}</p>`).join('')}<p>${'z'.repeat(80 * 1024)}</p>`,
    );
    const makeStatement = (i: number) => statement(f.p, text[i], String(500 + i));
    const makeEvent = (
      p: ReviewReadyProductionIngest,
      history: Parameters<typeof createHumanSourceEvent>[1],
      i: HumanAdjudicationIntent,
      id: string,
    ) =>
      createHumanSourceEvent(
        p,
        history,
        i,
        'Benchmark operator',
        id,
        '2026-10-10T00:00:00.000Z',
        reviewPackageSnapshot(p.review_package),
      );
    const first = makeEvent(f.p, [], intent(makeStatement(0)), 'size.one');
    const revisions = [first];
    let current = rebuildHumanPreparation(f.p, revisions, []);
    for (let n = 1; n < 8; n++) {
      const previous = revisions.at(-1)!;
      const i = {
        ...intent(makeStatement(0)),
        action: 'correct' as const,
        replaces_fact_ids: previous.facts.map((fact) => fact.id),
        previous_event_id: previous.id,
      };
      revisions.push(makeEvent(current, revisions, i, `size.revision.${n}`));
      current = rebuildHumanPreparation(f.p, revisions, []);
    }
    const many = makeEvent(
      f.p,
      [],
      { ...intent(makeStatement(0)), statements: text.map((_, i) => makeStatement(i)) },
      'size.many',
    );
    const repeated: typeof revisions = [];
    current = f.p;
    for (let n = 0; n < 20; n++) {
      repeated.push(
        makeEvent(
          current,
          repeated,
          { ...intent(makeStatement(n)), group_id: `size.group.${n}` },
          `size.citation.${n}`,
        ),
      );
      current = rebuildHumanPreparation(f.p, repeated, []);
    }
    const report = [];
    for (const [name, sample] of [
      ['one_correction', [first]],
      ['eight_revisions', revisions],
      ['twenty_assertions_one_event', [many]],
      ['twenty_repeated_document_citations', repeated],
    ] as const) {
      const events: Parameters<typeof createHumanSourceEvent>[1] = sample;
      const effective = rebuildHumanPreparation(f.p, events, []);
      const record = {
        ...f.job,
        human_adjudication_original: f.p,
        human_adjudications: events,
        preparation: effective,
      };
      const path = join(f.root, `${name}.json`);
      await writeFile(path, JSON.stringify(record));
      const bytes = (await readFile(path)).byteLength;
      const proofDocuments = events.flatMap((event) =>
        event.facts.flatMap((fact) => fact.human_source!.documents),
      );
      const unique = new Map(
        proofDocuments.map((document) => [artifactDigest(document), document]),
      );
      const payloadBytes = proofDocuments.reduce(
        (sum, document) => sum + Buffer.byteLength(JSON.stringify(document)),
        0,
      );
      const uniqueBytes = [...unique.values()].reduce(
        (sum, document) => sum + Buffer.byteLength(JSON.stringify(document)),
        0,
      );
      const timings = [];
      for (let n = 0; n < 5; n++) {
        const start = performance.now();
        rebuildHumanPreparation(f.p, events, []);
        timings.push(performance.now() - start);
      }
      timings.sort((a, b) => a - b);
      report.push({
        scenario: name,
        events: events.length,
        assertions_in_history: events.reduce<number>((sum, e) => sum + e.facts.length, 0),
        record_bytes: bytes,
        baseline_job_bytes: Buffer.byteLength(JSON.stringify(f.job)),
        detached_document_occurrences: proofDocuments.length,
        unique_document_bytes: uniqueBytes,
        detached_document_bytes: payloadBytes,
        repeated_document_bytes: payloadBytes - uniqueBytes,
        replay_median_ms: Number(timings[2].toFixed(2)),
        replay_max_ms: Number(timings[4].toFixed(2)),
      });
      expect(unique.size).toBe(1);
      expect(effective.intake).toEqual(f.p.intake);
    }
    console.log('CONTROLLED_CORPUS_MEASUREMENTS ' + JSON.stringify(report));
  }, 30000); // Controlled replay samples may exceed Vitest's five-second UI default.
});

describe('authorized frozen manufacturer observations — genuine text, controlled retained envelope', () => {
  // These files are explicitly authorized observations. No external PDF path,
  // benchmark oracle, original preparation store or canonical destination is read.
  const names = ['victron-bmv-712', 'morningstar-sunsaver-10l', 'samlex-evo-2212'] as const;
  const frozenHashes = {
    'victron-bmv-712': 'b09ef2001d990e09edea6d2f4655c09870b2c6f98be9cdcb951f88a7339adcde',
    'morningstar-sunsaver-10l': '0a4060d282abcba7bc988b5bb438215d8164916ef4f3117692f7d57b535b7b70',
    'samlex-evo-2212': 'c438b4815d3dcc982cee83ea09de98ad161a5c40e4d835b1fd5fd4844a55fda3',
  };
  async function frozen(name: (typeof names)[number]) {
    const path = join(
      tmpdir(),
      'expedition-document-extraction-benchmark',
      'outputs',
      'pdfplumber-text',
      `${name}.json`,
    );
    const bytes = await readFile(path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(frozenHashes[name]);
    const observation = JSON.parse(bytes.toString());
    const intake: ProductIntake = {
      schema_version: '1.0',
      artifact_kind: 'product_intake',
      id: 'controlled.frozen',
      manufacturer: 'Frozen manufacturer observation',
      product_model:
        name === 'victron-bmv-712'
          ? 'BMV-712 Smart'
          : name === 'morningstar-sunsaver-10l'
            ? 'SS-10L-12V'
            : 'EVO-2212',
      official_product_uri: 'https://example.test/controlled-frozen-envelope',
    };
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const document: DocumentExtractionArtifact = {
      schema_version: '1.0',
      artifact_kind: 'document_extraction',
      id: 'frozen-observation.controlled',
      source_capture: {
        kind: 'source_capture',
        reference_schema_version: '1.0',
        digest_algorithm: 'sha256',
        digest,
      },
      source_acquisition: {
        kind: 'source_acquisition',
        reference_schema_version: '1.0',
        digest_algorithm: 'sha256',
        digest,
      },
      status: 'extracted',
      capability_state: 'automatic_extraction_available',
      remediation_state: 'none_required',
      extractor: 'frozen-pdfplumber-observation',
      extractor_version: observation.version ?? 'retained',
      blocks: [
        {
          id: 'frozen.page-text',
          kind: 'text',
          content: observation.text,
          locator: { kind: 'pdf', page: observation.page },
        },
      ],
    };
    return { path, bytes, observation, intake, document };
  }
  it('BMV supply range becomes a valid qualified representation after human source repair', async () => {
    const f = await frozen(names[0]);
    const wording = 'Supply voltage range 6.5 - 70 VDC';
    expect(f.observation.text).toContain(wording);
    const citation = {
      document_id: f.document.id,
      block_id: f.document.blocks[0].id,
      quote: f.observation.text,
    };
    const s: HumanSourceStatement = {
      label: 'Supply voltage range',
      value: '6.5 - 70 VDC',
      unit: 'VDC',
      wording,
      citations: [citation],
      applicability: { relationship: 'text_heading', citation },
      mapping: { kind: 'source_observation', target: 'electrical.input_voltage_range_v' },
    };
    const fact = humanStatementFact({
      version: 'human-adjudication.v1',
      event_id: 'controlled.human.bmv',
      statement_index: 0,
      intake: f.intake,
      statement: s,
      documents: [f.document],
    });
    const p = previewHumanMapping(fact, s.mapping!);
    expect(p.qualified_value).toMatchObject({
      value: { min: 6.5, max: 70 },
      qualifiers: { electrical_domain: 'dc' },
    });
    expect(await readFile(f.path)).toEqual(f.bytes);
  });
  it('BMV genuine frozen wording uses real backend eligibility, candidate reconstruction and durable restart', async () => {
    const frozenSource = await frozen(names[0]);
    const escape = (text: string) =>
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const textLines: string[] = frozenSource.observation.text.split('\n');
    // A controlled HTML envelope retains genuine frozen wording. It tests the
    // real acquisition/review/store contracts, not original PDF layout or
    // manufacturer-host authentication. No invented table coordinates enter it.
    const html = `<html><body><h1>${escape(textLines[0])}</h1>${textLines
      .slice(1)
      .map((line) => `<p>${escape(line)}</p>`)
      .join('')}</body></html>`;
    const f = await fixture('', html, {
      manufacturer: 'Frozen manufacturer observation',
      product_model: 'BMV-712 Smart',
      official_product_uri: input.official_product_uri,
    });
    expect(f.p.qualified_facts).toHaveLength(0);
    const d = f.p.document_extractions.find((d) =>
      d.blocks.some((b) => b.content === 'Supply voltage range 6.5 - 70 VDC'),
    )!;
    const b = d.blocks.find((b) => b.content === 'Supply voltage range 6.5 - 70 VDC')!;
    const heading = d.blocks.find((b) => b.kind === 'heading' && b.content === textLines[0])!;
    const s: HumanSourceStatement = {
      label: 'Supply voltage range',
      value: '6.5 - 70 VDC',
      unit: 'VDC',
      wording: b.content!,
      citations: [{ document_id: d.id, block_id: b.id, quote: b.content! }],
      applicability: {
        relationship: 'text_heading',
        citation: { document_id: d.id, block_id: heading.id, quote: heading.content! },
      },
      mapping: { kind: 'source_observation', target: 'electrical.input_voltage_range_v' },
    };
    const req = request(f.p, intent(s));
    const discovery = await f.service.humanProperties(f.id, { ...req, statement_index: 0 });
    expect(
      discovery.targets.some((t) => t.canonical_field === 'electrical.input_voltage_range_v'),
    ).toBe(true);
    const preview = await f.service.previewHumanAdjudication(f.id, req);
    expect(preview.candidate?.qualified_values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'electrical.input_voltage_range_v',
          value: { min: 6.5, max: 70 },
        }),
      ]),
    );
    const saved = await f.service.recordHumanAdjudication(f.id, req);
    expect(await f.make().getJob(f.id)).toEqual(saved);
    expect(saved.human_adjudication_original?.qualified_facts).toEqual([]);
    expect(saved.approval).toBeUndefined();
    expect(saved.final_result).toBeUndefined();
    expect(await readFile(frozenSource.path)).toEqual(frozenSource.bytes);
  });
  it('genuine BMV measurement precision cannot become an electrical current rating', async () => {
    const f = await frozen(names[0]);
    const citation = {
      document_id: f.document.id,
      block_id: f.document.blocks[0].id,
      quote: f.observation.text,
    };
    const s: HumanSourceStatement = {
      label: 'Current measurement accuracy',
      value: '± 0.4 %',
      unit: '%',
      wording: 'Accuracy of current measurement ± 0.4 %',
      citations: [citation],
      applicability: { relationship: 'text_heading', citation },
      mapping: {
        kind: 'source_rating',
        target: 'electrical.output_current_a',
        qualifiers: { direction: 'output' },
      },
    };
    const fact = humanStatementFact({
      version: 'human-adjudication.v1',
      event_id: 'precision.refusal',
      statement_index: 0,
      intake: f.intake,
      statement: s,
      documents: [f.document],
    });
    expect(() => previewHumanMapping(fact, s.mapping!)).toThrow(/units/);
  });
  it.each(names)(
    'preserves %s frozen identity and refuses invented precision/current mappings',
    async (name) => {
      const f = await frozen(name);
      const citation = {
        document_id: f.document.id,
        block_id: f.document.blocks[0].id,
        quote: 'Invented exact-model unconditional current 150 A',
      };
      expect(() =>
        humanStatementFact({
          version: 'human-adjudication.v1',
          event_id: 'negative',
          statement_index: 0,
          intake: f.intake,
          documents: [f.document],
          statement: {
            label: 'Current',
            value: '150 A',
            wording: citation.quote,
            citations: [citation],
            applicability: { relationship: 'statement', citation },
            mapping: { kind: 'scalar', target: 'electrical.output_current_a' },
          },
        }),
      ).toThrow(/quote/);
      expect(await readFile(f.path)).toEqual(f.bytes);
    },
  );
  it('Morningstar shared text cannot establish a reliable model column', async () => {
    const f = await frozen(names[1]);
    const citation = {
      document_id: f.document.id,
      block_id: f.document.blocks[0].id,
      quote: f.observation.text,
    };
    const value = f.observation.text.slice(0, 10);
    expect(() =>
      humanStatementFact({
        version: 'human-adjudication.v1',
        event_id: 'negative',
        statement_index: 0,
        intake: f.intake,
        documents: [f.document],
        statement: {
          label: 'Shared table',
          value,
          wording: value,
          citations: [citation],
          applicability: { relationship: 'table_column', citation },
        },
      }),
    ).toThrow(/column|model/);
  });
});
