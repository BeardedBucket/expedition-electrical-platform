import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type OrionEvidence = {
  targets: Array<{ manufacturer_part_number: string; direction: string }>;
  facts: Array<{
    id: string;
    applies_to: string[];
    field: string;
    normalized_value?: unknown;
    normalized_unit?: string;
  }>;
  candidate_proposals: Array<{
    identity: { manufacturer_part_number: string };
    component_data: {
      ports: Array<{
        id: string;
        direction: string;
        voltage_v?: unknown;
        current_a?: number;
        power_w?: number;
      }>;
      isolation_relationships?: unknown;
    };
  }>;
};

const evidence = JSON.parse(
  readFileSync(
    join(process.cwd(), 'data', 'ingestion', 'victron-orion-tr-smart-pair.json'),
    'utf8',
  ),
) as OrionEvidence;

describe('Orion-Tr Smart pair evidence', () => {
  it('selects both exact MPNs without sibling-row leakage', () => {
    expect(evidence.targets.map((target) => target.manufacturer_part_number)).toEqual([
      'ORI122436120',
      'ORI241236120',
    ]);
    expect(
      evidence.facts
        .filter((fact) => fact.field === 'identity')
        .map((fact) => fact.applies_to)
        .flat(),
    ).toEqual(['ORI122436120', 'ORI241236120']);
  });

  it('preserves directional and side-specific electrical semantics', () => {
    const first = evidence.candidate_proposals.find(
      (candidate) => candidate.identity.manufacturer_part_number === 'ORI122436120',
    );
    const second = evidence.candidate_proposals.find(
      (candidate) => candidate.identity.manufacturer_part_number === 'ORI241236120',
    );
    expect(first?.component_data.ports).toEqual([
      expect.objectContaining({
        id: 'orion.input',
        domain: 'dc',
        direction: 'input',
        voltage_v: { min: 8, max: 17 },
        constraints: expect.any(Array),
      }),
      expect.objectContaining({
        id: 'orion.output',
        domain: 'dc',
        direction: 'output',
        voltage_v: 24,
        current_a: 15,
        power_w: 360,
        constraints: expect.arrayContaining([
          expect.objectContaining({ kind: 'continuous_rating', quantity: 'current' }),
          expect.objectContaining({ kind: 'continuous_rating', quantity: 'power' }),
        ]),
      }),
    ]);
    expect(second?.component_data.ports).toEqual([
      expect.objectContaining({
        id: 'orion.input',
        domain: 'dc',
        direction: 'input',
        voltage_v: { min: 16, max: 35 },
        constraints: expect.any(Array),
      }),
      expect.objectContaining({
        id: 'orion.output',
        domain: 'dc',
        direction: 'output',
        voltage_v: 12,
        current_a: 30,
        power_w: 360,
        constraints: expect.arrayContaining([
          expect.objectContaining({ kind: 'continuous_rating', quantity: 'current' }),
          expect.objectContaining({ kind: 'continuous_rating', quantity: 'power' }),
        ]),
      }),
    ]);
    expect(evidence.facts.some((fact) => fact.field === 'input_current')).toBe(false);
  });

  it('keeps isolation evidence review-bound without implying grounding', () => {
    const isolation = evidence.facts.find((fact) => fact.field === 'galvanic_isolation');
    expect(isolation?.normalized_value).toBeUndefined();
    expect(isolation?.applies_to).toEqual(['ORI122436120', 'ORI241236120']);
    for (const candidate of evidence.candidate_proposals) {
      expect(candidate.component_data.isolation_relationships).toEqual([
        {
          id: 'orion.input-output-case-isolation',
          kind: 'galvanic',
          participants: [
            { kind: 'port', id: 'orion.input' },
            { kind: 'port', id: 'orion.output' },
            { kind: 'case', id: 'orion.case' },
          ],
          withstand: { value: 200, unit: 'V', basis: 'dc' },
        },
      ]);
    }
  });
});
