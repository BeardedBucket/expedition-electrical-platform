import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import pilot from '../../../data/ingestion/victron-multiplus-24-2000-50-50-120v.json' with { type: 'json' };
import type { ProductCandidate } from '../src/contracts.js';
import {
  promotionCandidateSnapshot,
  promoteCandidate,
  type PromotionReview,
} from '../src/promotion.js';
import { serializeCanonicalComponent, writeCanonicalComponent } from '../src/promotion-write.js';

const temporaryRoots: string[] = [];

const candidate = (): ProductCandidate =>
  JSON.parse(JSON.stringify(pilot.candidate)) as ProductCandidate;

const review = (overrides: Partial<PromotionReview> = {}): PromotionReview => ({
  schema_version: '1.0',
  id: 'review.human.pmp242200100',
  candidate_id: pilot.candidate.id,
  candidate_snapshot: promotionCandidateSnapshot(pilot.candidate, [pilot.source], pilot.facts),
  decision: 'approved',
  reviewer_id: 'reviewer.human',
  reviewed_at: '2026-09-06T12:00:00.000Z',
  approved_fields: Object.keys(pilot.candidate.field_evidence).sort(),
  evidence_acknowledged: true,
  product_role: 'inverter_charger',
  category: 'inverter_charger',
  ...overrides,
});

const promotion = (overrides: Partial<PromotionReview> = {}) =>
  promoteCandidate(candidate(), [pilot.source], pilot.facts, review(overrides));

const root = async (): Promise<string> => {
  const value = await mkdtemp(join(tmpdir(), 'expedition-promotion-'));
  temporaryRoots.push(value);
  return value;
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((value) => rm(value, { recursive: true })));
});

describe('canonical promotion write adapter', () => {
  it('defaults to dry-run and does not create a file', async () => {
    const destinationRoot = await root();
    const result = await writeCanonicalComponent({
      promotion: promotion(),
      destinationRoot,
    });

    expect(result.status).toBe('dry_run');
    expect(result.schema_valid).toBe(true);
    expect(result.path).toMatch(/victron-energy\.pmp242200100\.yaml$/);
    await expect(readFile(result.path ?? '', 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes an approved proposal and preserves provenance', async () => {
    const destinationRoot = await root();
    const result = await writeCanonicalComponent({
      promotion: promotion(),
      destinationRoot,
      write: true,
    });

    expect(result.status).toBe('written');
    const content = await readFile(result.path ?? '', 'utf8');
    const component = parseYaml(content);
    expect(component).toMatchObject({
      id: 'victron-energy.pmp242200100',
      manufacturer: 'Victron Energy',
      part_number: 'PMP242200100',
      verification_status: 'unverified',
    });
    expect(component.source_refs[0]).toMatchObject({
      id: pilot.source.id,
      review_id: 'review.human.pmp242200100',
    });
  });

  it('blocks an existing target without changing it', async () => {
    const destinationRoot = await root();
    const target = join(destinationRoot, 'victron-energy.pmp242200100.yaml');
    await writeFile(target, 'original\n', 'utf8');
    const result = await writeCanonicalComponent({
      promotion: promotion(),
      destinationRoot,
      write: true,
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((item) => item.code)).toContain('promotion_already_exists');
    expect(await readFile(target, 'utf8')).toBe('original\n');
  });

  it('blocks an identity collision even when the filename is absent', async () => {
    const destinationRoot = await root();
    const result = await writeCanonicalComponent({
      promotion: promotion(),
      destinationRoot,
      write: true,
      catalogComponents: [
        {
          id: 'different.filename',
          manufacturer: 'Victron Energy',
          model: 'Different label',
          part_number: 'PMP242200100',
        },
      ],
    });

    expect(result.status).toBe('blocked');
    expect(result.collision).toBe(true);
    expect(result.issues.map((item) => item.code)).toContain('promotion_already_exists');
  });

  it.each([
    ['../escape.yaml', 'write_path_invalid'],
    ['..\\escape.yaml', 'write_path_invalid'],
    ['C:\\escape.yaml', 'write_path_invalid'],
    ['nested/file.yaml', 'write_path_invalid'],
  ])('rejects unsafe filename %s', async (filename, code) => {
    const result = await writeCanonicalComponent({
      promotion: promotion(),
      destinationRoot: await root(),
      filename,
      write: true,
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((item) => item.code)).toContain(code);
  });

  it('blocks malformed or unapproved review results without writing', async () => {
    const destinationRoot = await root();
    const result = await writeCanonicalComponent({
      promotion: promotion({ decision: 'rejected' }),
      destinationRoot,
      write: true,
    });

    expect(result.status).toBe('blocked');
    expect(result.path).toBeUndefined();
  });

  it('rejects a schema-invalid proposal before writing', async () => {
    const valid = promotion();
    expect(valid.status).toBe('success');
    const result = await writeCanonicalComponent({
      promotion: {
        ...valid,
        proposal: { ...valid.proposal, id: 'INVALID ID' },
      },
      destinationRoot: await root(),
      write: true,
    });

    expect(result.status).toBe('invalid');
    expect(result.schema_valid).toBe(false);
    expect(result.issues.map((item) => item.code)).toContain('promotion_invalid_component');
  });

  it('serializes the same proposal deterministically without generated timestamps', async () => {
    const result = promotion();
    expect(result.status).toBe('success');
    const firstRoot = await root();
    const secondRoot = await root();
    const first = await writeCanonicalComponent({
      promotion: result,
      destinationRoot: firstRoot,
      write: true,
    });
    const second = await writeCanonicalComponent({
      promotion: result,
      destinationRoot: secondRoot,
      write: true,
    });

    expect(first.serialized).toBe(second.serialized);
    expect(first.serialized).toBe(serializeCanonicalComponent(result.proposal ?? {}));
    expect(first.serialized).not.toContain('created_at');
  });
});
