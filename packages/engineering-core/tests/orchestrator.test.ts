import { describe, expect, it } from 'vitest';
import { demoData, orchestrateRecommendations } from '../src/index.js';

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
});
