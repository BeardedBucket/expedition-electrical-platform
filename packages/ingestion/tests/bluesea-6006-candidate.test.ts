import { describe, expect, it } from 'vitest';
import artifact from '../../../data/ingestion/blue-sea-systems-m-series-6006.json' with { type: 'json' };
import { promotionCandidateSnapshot } from '../src/promotion.js';
import { validateIngestionArtifacts } from '../src/validation.js';

describe('Blue Sea 6006 product candidate', () => {
  it('validates the complete pending candidate and evidence set', () => {
    const result = validateIngestionArtifacts(artifact.sources, artifact.facts, artifact.candidate);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('unresolved');
    expect(result.issues.every((issue) => issue.category === 'unresolved')).toBe(true);
  });

  it('preserves passive switching semantics without conversion topology', () => {
    const { component_data: componentData } = artifact.candidate;
    expect(componentData.power_paths ?? []).toEqual([]);
    expect(
      (componentData.power_paths ?? []).every(
        (path) => !Object.prototype.hasOwnProperty.call(path, 'constraints'),
      ),
    ).toBe(true);
    expect(componentData.connection_points).toEqual([
      expect.objectContaining({ id: 'bluesea.6006.terminal-1' }),
      expect.objectContaining({ id: 'bluesea.6006.terminal-2' }),
    ]);
    expect(componentData.conductive_relationships).toEqual([
      expect.objectContaining({
        id: 'bluesea.6006.main-contact',
        participants: [
          { kind: 'connection_point', id: 'bluesea.6006.terminal-1' },
          { kind: 'connection_point', id: 'bluesea.6006.terminal-2' },
        ],
      }),
    ]);
    expect(componentData.switching).toEqual({
      controlled_relationship_ids: ['bluesea.6006.main-contact'],
      configurations: [
        { id: 'bluesea.6006.off', label: 'OFF', active_relationship_ids: [] },
        {
          id: 'bluesea.6006.on',
          label: 'ON',
          active_relationship_ids: ['bluesea.6006.main-contact'],
        },
      ],
    });
    expect(componentData).not.toHaveProperty('power_paths');
    expect(componentData).not.toHaveProperty('capabilities');
  });

  it('binds every field and topology reference to persisted facts', () => {
    const factIds = new Set(artifact.facts.map((fact) => fact.id));
    const references = [
      ...Object.values(artifact.candidate.field_evidence).flat(),
      ...Object.values(artifact.candidate.topology_evidence ?? {}).flat(),
    ];

    expect(references.every((factId) => factIds.has(factId))).toBe(true);
    expect(artifact.candidate.identity_source_ids).toEqual([
      'bluesea.mseries.6006.product-page',
      'bluesea.mseries.6006.instructions',
    ]);
  });

  it('produces a deterministic semantic snapshot for future human review', () => {
    const first = promotionCandidateSnapshot(artifact.candidate, artifact.sources, artifact.facts);
    const second = promotionCandidateSnapshot(artifact.candidate, artifact.sources, artifact.facts);

    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('binds the independently acquired instructions and lockout evidence', () => {
    const instructions = artifact.sources.find(
      (source) => source.id === 'bluesea.mseries.6006.990520240',
    );
    const lockout = artifact.sources.find(
      (source) => source.id === 'bluesea.mseries.6006.990520240',
    );
    expect(instructions?.content_hash).toBe(
      'sha256:0d61fee8fde4b90f438a4e83cc72ee702f3bcc22445b33fda871bbc6640782f1',
    );
    expect(lockout?.applicability).toBe('explicitly_reviewed');
    expect(
      artifact.facts.some(
        (fact) =>
          fact.id === 'extracted.fact.bluesea.6006.removable-knob-service-lockout' &&
          fact.raw_value === 'Removable knob for security and service lockout',
      ),
    ).toBe(true);
    expect(artifact.candidate.component_data).toBeDefined();
  });

  it('keeps short-duration ratings as informational facts, not canonical constraints', () => {
    const relationship = artifact.candidate.component_data.conductive_relationships?.[0] as {
      constraints?: Array<{ value?: number; duration?: { value: number; unit: string } }>;
    };
    expect(relationship.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 300, domain: 'dc' }),
        expect.objectContaining({ value: 48, domain: 'dc' }),
      ]),
    );
    expect(relationship.constraints).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 500 }),
        expect.objectContaining({ value: 775 }),
        expect.objectContaining({ value: 1500 }),
      ]),
    );
    expect(
      artifact.facts.filter((fact) =>
        ['500', '775', '1500'].includes(String(fact.normalized_value ?? fact.raw_value)),
      ).length,
    ).toBeGreaterThanOrEqual(3);
    expect(artifact.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ normalized_value: 775, raw_unit: 'A DC for 1 min' }),
        expect.objectContaining({ normalized_value: 1500, raw_unit: 'A DC for 10 sec' }),
      ]),
    );
  });

  it('does not infer interruption capability from the unresolved 25 A label', () => {
    const relationship = artifact.candidate.component_data.conductive_relationships?.[0] as {
      interruption_capabilities?: unknown;
    };
    expect(relationship.interruption_capabilities).toBeUndefined();
    expect(
      artifact.facts.find(
        (fact) => fact.id === 'extracted.fact.bluesea.6006.switching-25a-unresolved',
      )?.fact_state,
    ).toBe('unresolved');
  });
});
