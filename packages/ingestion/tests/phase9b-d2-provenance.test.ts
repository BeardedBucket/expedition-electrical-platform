import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
const repoPath = (...parts: string[]): string => join(process.cwd(), ...parts);

describe('Phase 9B-3M-D2 topology provenance', () => {
  it('keeps Victron topology facts and amendment history within the approved source set', () => {
    const evidence = readJson(
      repoPath('data', 'ingestion', 'phase9b-d2', 'victron-pmp242200100-topology-review.json'),
    );
    const sources = evidence.sources as Array<Record<string, unknown>>;
    const facts = evidence.facts as Array<Record<string, unknown>>;
    const candidateSourceIds = new Set(sources.map((source) => source.id));
    const topologyFactIds = new Set(facts.map((fact) => fact.id));
    const topologyEvidence = evidence.topology_evidence as Record<string, string[]>;
    const evidenceFactIds = Object.values(topologyEvidence).flat();
    const history = (
      parseYaml(
        readFileSync(repoPath('data', 'components', 'victron-energy.pmp242200100.yaml'), 'utf8'),
      ) as Record<string, unknown>
    ).amendment_history as Array<Record<string, unknown>>;
    const amendment = history.find(
      (entry) => entry.review_id === 'review.amendment.victron-pmp242200100-topology-d2',
    );

    expect(sources.map((source) => source.id)).toEqual([
      'victron.multiplus-24-2000-50-50-120v.product-page',
      'victron.multiplus-24-2000-50-50-120v.datasheet',
    ]);
    expect(facts.every((fact) => candidateSourceIds.has(fact.source_id as string))).toBe(true);
    expect(facts.every((fact) => (fact.source_id as string).startsWith('victron.'))).toBe(true);
    expect(evidenceFactIds.every((factId) => topologyFactIds.has(factId))).toBe(true);
    expect(amendment?.source_ids).toEqual([...candidateSourceIds]);
    expect(
      (amendment?.topology_operations as Array<Record<string, unknown>>).every((operation) =>
        (operation.fact_ids as string[]).every((factId) => topologyFactIds.has(factId)),
      ),
    ).toBe(true);
  });

  it('keeps Epoch topology provenance separate from Victron provenance', () => {
    const evidence = readJson(
      repoPath('data', 'ingestion', 'phase9b-d2', 'epoch-b24100a-c-topology-review.json'),
    );
    const facts = evidence.facts as Array<Record<string, unknown>>;
    const history = (
      parseYaml(
        readFileSync(repoPath('data', 'components', 'epoch-batteries.b24100a-c.yaml'), 'utf8'),
      ) as Record<string, unknown>
    ).amendment_history as Array<Record<string, unknown>>;
    const amendment = history.find(
      (entry) => entry.review_id === 'review.amendment.epoch-b24100a-c-topology-d2',
    );

    expect(facts.every((fact) => (fact.source_id as string).startsWith('epoch.'))).toBe(true);
    expect(amendment?.source_ids).toEqual([
      'epoch.phase9b-d2.resources-page',
      'epoch.phase9b-d2.b24100a-c.manual',
    ]);
    expect(amendment?.source_ids).not.toContain('victron.multiplus-24-2000-50-50-120v.datasheet');
  });
});
