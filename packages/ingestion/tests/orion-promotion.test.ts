import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import artifact from '../../../data/ingestion/victron-orion-tr-smart-pair.json' with { type: 'json' };
import review1224 from '../../../data/ingestion/victron-orion-tr-smart.ori122436120.review.json' with { type: 'json' };
import review2412 from '../../../data/ingestion/victron-orion-tr-smart.ori241236120.review.json' with { type: 'json' };
import { promoteCandidate } from '../src/promotion.js';
import { writeCanonicalComponent } from '../src/promotion-write.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('reviewed Orion pair promotion', () => {
  it('promotes both exact MPNs independently with reviewed topology and constraints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'expedition-orion-promotion-'));
    roots.push(root);
    const reviews = [review1224, review2412];
    const expected = [
      { id: 'victron-energy.ori122436120', min: 8, max: 17, output: 24, current: 15 },
      { id: 'victron-energy.ori241236120', min: 16, max: 35, output: 12, current: 30 },
    ];

    for (const [index, review] of reviews.entries()) {
      const candidate = artifact.candidate_proposals[index];
      const promotion = promoteCandidate(candidate, artifact.sources, artifact.facts, review);
      expect(promotion.status).toBe('success');
      expect(promotion.proposal?.id).toBe(expected[index].id);
      expect(promotion.proposal?.verification_status).toBe('unverified');

      const written = await writeCanonicalComponent({
        promotion,
        destinationRoot: root,
        write: true,
      });
      expect(written.status).toBe('written');
      const component = parseYaml(await readFile(written.path!, 'utf8'));
      expect(component.ports).toHaveLength(2);
      expect(component.ports[0]).toMatchObject({
        id: 'orion.input',
        voltage_v: { min: expected[index].min, max: expected[index].max },
      });
      expect(component.ports[1]).toMatchObject({
        id: 'orion.output',
        voltage_v: expected[index].output,
      });
      expect(component.ports[1].constraints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'orion.output.continuous-current',
            kind: 'continuous_rating',
            value: expected[index].current,
            conditions: expect.arrayContaining([
              { path: 'temperature_c', equals: 40 },
              {
                path: 'output_voltage',
                reference: {
                  constraint_id: 'orion.output.nominal-voltage',
                  relation: 'nominal',
                },
              },
            ]),
          }),
          expect.objectContaining({
            id: 'orion.output.continuous-power',
            kind: 'continuous_rating',
            value: 360,
            conditions: [{ path: 'temperature_c', equals: 40 }],
          }),
        ]),
      );
      expect(component.isolation_relationships).toEqual([
        expect.objectContaining({
          id: 'orion.input-output-case-isolation',
          participants: expect.arrayContaining([
            { kind: 'port', id: 'orion.input' },
            { kind: 'port', id: 'orion.output' },
            { kind: 'case', id: 'orion.case' },
          ]),
          withstand: { value: 200, unit: 'V', basis: 'dc' },
        }),
      ]);
      expect(component.conductive_relationships).toBeUndefined();
      expect(component.ports[0].current_a).toBeUndefined();
    }
  });

  it('blocks replay without overwriting the first canonical write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'expedition-orion-replay-'));
    roots.push(root);
    const candidate = artifact.candidate_proposals[0];
    const promotion = promoteCandidate(candidate, artifact.sources, artifact.facts, review1224);
    const first = await writeCanonicalComponent({ promotion, destinationRoot: root, write: true });
    const second = await writeCanonicalComponent({
      promotion,
      destinationRoot: root,
      write: true,
    });

    expect(first.status).toBe('written');
    expect(second.status).toBe('blocked');
    expect(second.issues.map((item) => item.code)).toContain('promotion_already_exists');
    expect(await readFile(first.path!, 'utf8')).toBe(first.serialized);
  });

  it('matches the repository canonical records written by reviewed promotion', async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const expected = ['victron-energy.ori122436120.yaml', 'victron-energy.ori241236120.yaml'];
    for (const filename of expected) {
      const component = parseYaml(
        await readFile(join(repositoryRoot, 'data', 'components', filename), 'utf8'),
      );
      expect(component.verification_status).toBe('unverified');
      expect(component.source_refs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidate_id: expect.stringContaining('victron.orion-tr-smart.'),
            review_id: expect.stringMatching(/^review\.human\.ori/),
          }),
        ]),
      );
    }
  });
});
