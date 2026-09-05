import { describe, expect, it } from 'vitest';
import { demoData, orchestrateRecommendations } from '../src/index.js';
import type { DemoData } from '../src/contracts.js';

describe('orchestrateRecommendations', () => {
  it('requires an explicit positive system voltage', () => {
    expect(() =>
      orchestrateRecommendations({ systemVoltageV: Number.NaN, loads: [] }, demoData),
    ).toThrow('user-selected system voltage');
    expect(() => orchestrateRecommendations({ systemVoltageV: 0, loads: [] }, demoData)).toThrow(
      'user-selected system voltage',
    );
  });

  it('returns empty recommendations for the empty synthetic collections', () => {
    const result = orchestrateRecommendations({ systemVoltageV: 24, loads: [] }, demoData);

    expect(result.recommendations).toEqual([]);
    expect(result.trace.datasets).toEqual(demoData.versions);
    expect(result.trace.ruleSet).toEqual(demoData.ruleSet);
    expect(result.trace.steps.at(-1)?.status).toBe('empty');
  });

  it('is deterministic for the same requirements and dataset versions', () => {
    const requirements = { systemVoltageV: 48, loads: [{ id: 'load-a', name: 'Example load' }] };

    expect(orchestrateRecommendations(requirements, demoData)).toEqual(
      orchestrateRecommendations(requirements, demoData),
    );
  });

  it('evaluates advisories after engineering status and preserves suppressed candidates for inspection', () => {
    const data: DemoData = {
      ...demoData,
      components: [
        { id: 'component.a', verificationStatus: 'verified', engineeringStatus: 'compatible' },
      ],
      advisories: [
        {
          id: 'advisory.a',
          affected_component_ids: ['component.a'],
          status: 'active',
          severity: 'moderate',
          confidence: 'low',
          evidence_ids: ['evidence.a'],
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
          summary: 'Synthetic advisory.',
          rationale: 'Synthetic rationale.',
          policy_action: 'suppress_recommendation',
        },
      ],
      evidence: [
        {
          id: 'evidence.a',
          affected_component_ids: ['component.a'],
          type: 'recall',
          sources: [{ id: 'source.a', type: 'synthetic', date_checked: '2026-09-01' }],
          date_checked: '2026-09-01',
          summary: 'Synthetic evidence.',
          verification_status: 'verified',
          status: 'active',
        },
      ],
    };
    const result = orchestrateRecommendations({ systemVoltageV: 24, loads: [] }, data, {
      evaluatedAt: '2026-09-04T00:00:00Z',
    });
    expect(result.recommendations).toEqual([]);
    expect(result.inspectableAdvisoryCandidates?.map((item) => item.id)).toEqual(['component.a']);
    expect(result.inspectableAdvisoryCandidates?.[0]?.engineeringStatus).toBe('compatible');
  });

  it('requires an explicit timestamp when advisory evaluation is loaded', () => {
    const data: DemoData = {
      ...demoData,
      advisories: [
        {
          id: 'advisory.requires-time',
          affected_component_ids: ['component.a'],
          status: 'active',
          severity: 'low',
          confidence: 'low',
          evidence_ids: [],
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
          summary: 'Synthetic advisory.',
          rationale: 'Synthetic rationale.',
          policy_action: 'inform',
        },
      ],
    };
    expect(() => orchestrateRecommendations({ systemVoltageV: 24, loads: [] }, data)).toThrow(
      'explicit evaluation timestamp',
    );
  });

  it('does not require a timestamp for legacy empty advisory/evidence data', () => {
    expect(orchestrateRecommendations({ systemVoltageV: 24, loads: [] }, demoData)).toEqual(
      orchestrateRecommendations({ systemVoltageV: 24, loads: [] }, demoData),
    );
  });
});
