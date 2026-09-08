import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import artifact from '../../../data/ingestion/victron-smartshunt-shu050150050.json' with { type: 'json' };
import reviewArtifact from '../../../data/ingestion/victron-smartshunt-shu050150050.review.json' with { type: 'json' };
import { promotionCandidateSnapshot, promoteCandidate } from '../src/promotion.js';
import { writeCanonicalComponent } from '../src/promotion-write.js';
import { validateProductCandidate } from '../src/validation.js';

describe('SmartShunt promotion candidate contract', () => {
  it('rejects an incomplete projection instead of allowing reviewed promotion to bypass evidence', () => {
    const malformed = JSON.parse(JSON.stringify(artifact.candidate)) as Record<string, unknown>;
    delete malformed.field_evidence;

    const validation = validateProductCandidate(
      malformed as typeof artifact.candidate,
      artifact.sources,
      artifact.facts,
    );

    expect(validation.ok).toBe(false);
    expect(validation.issues.some((item) => item.code === 'schema_required')).toBe(true);
  });

  it('contains complete evidence for every proposed canonical field and topology target', () => {
    const candidate = artifact.candidate;
    const validation = validateProductCandidate(candidate, artifact.sources, artifact.facts);

    expect(validation.issues.filter((item) => item.category === 'invalid')).toEqual([]);
    expect(candidate.field_evidence).toEqual(
      expect.objectContaining({
        'dimensions_mm.x': expect.any(Array),
        'dimensions_mm.y': expect.any(Array),
        'dimensions_mm.z': expect.any(Array),
        'electrical.input_voltage_range_v': expect.any(Array),
        physical_connectors: expect.any(Array),
        physical_connector_associations: expect.any(Array),
      }),
    );
    expect(candidate.topology_evidence).toEqual(
      expect.objectContaining({
        'connection_point:smartshunt.battery-minus': expect.any(Array),
        'connection_point:smartshunt.system-minus': expect.any(Array),
        'connection_point:smartshunt.vbatt-plus': expect.any(Array),
        'connection_point:smartshunt.aux': expect.any(Array),
        'conductive_relationship:smartshunt.main-shunt-conduction': expect.any(Array),
        'measurement_instance:smartshunt.main-current': expect.any(Array),
        'measurement_instance:smartshunt.battery-voltage': expect.any(Array),
        'interaction_endpoint:smartshunt.bluetooth': expect.any(Array),
        'interaction_endpoint:smartshunt.ve-direct': expect.any(Array),
        'physical_connector:smartshunt.ve-direct.connector': expect.any(Array),
        'physical_connector_association:smartshunt.ve-direct.connector-association':
          expect.any(Array),
      }),
    );
  });

  it('produces a deterministic semantic snapshot and reaches proposal generation', () => {
    const first = promotionCandidateSnapshot(artifact.candidate, artifact.sources, artifact.facts);
    const second = promotionCandidateSnapshot(artifact.candidate, artifact.sources, artifact.facts);
    expect(first).toBe(second);
    expect(reviewArtifact.candidate_snapshot).toBe(first);
    const promotion = promoteCandidate(
      artifact.candidate,
      artifact.sources,
      artifact.facts,
      reviewArtifact,
    );
    expect(promotion.status).toBe('success');
    expect(promotion.proposal).toMatchObject({
      id: 'victron-energy.shu050150050',
      product_role: 'monitor',
      category: 'monitor',
      dimensions_mm: { x: 120, y: 54, z: 46 },
      electrical: { input_voltage_range_v: { min: 6.5, max: 70 } },
      verification_status: 'unverified',
      connection_points: expect.any(Array),
      conductive_relationships: expect.any(Array),
      measurement: expect.any(Object),
      interaction_endpoints: expect.any(Array),
      physical_connectors: expect.any(Array),
      physical_connector_associations: expect.any(Array),
    });
    expect(promotion.proposal).not.toHaveProperty('power_paths');
    expect(promotion.proposal).not.toHaveProperty('battery_port');
    expect(promotion.proposal?.electrical).not.toHaveProperty('nominal_voltage_v');
  });

  it('does not use the historical canonical-looking draft as candidate input', async () => {
    const historical = parseYaml(
      await readFile(
        '.local-corpus-draft-archive/victron-energy.smartshunt-shu050150050.yaml',
        'utf8',
      ),
    );
    expect(artifact.candidate).not.toBe(historical);
    expect(artifact.candidate.component_data).not.toHaveProperty('battery_port');
    expect(artifact.candidate.component_data).not.toHaveProperty('electrical.nominal_voltage_v');
  });

  it('writes once and blocks replay without changing the first canonical record', async () => {
    const destinationRoot = await mkdtemp(join(tmpdir(), 'smartshunt-promotion-'));
    try {
      const promotion = promoteCandidate(
        artifact.candidate,
        artifact.sources,
        artifact.facts,
        reviewArtifact,
      );
      const first = await writeCanonicalComponent({
        promotion,
        destinationRoot,
        write: true,
      });
      const second = await writeCanonicalComponent({
        promotion,
        destinationRoot,
        write: true,
      });

      expect(first.status).toBe('written');
      expect(second.status).toBe('blocked');
      expect(second.issues.map((item) => item.code)).toContain('promotion_already_exists');
      expect(await readFile(first.path!, 'utf8')).toBe(first.serialized);
    } finally {
      await rm(destinationRoot, { recursive: true });
    }
  });
});
