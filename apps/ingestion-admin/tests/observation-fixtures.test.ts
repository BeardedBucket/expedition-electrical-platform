// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  genuineObservationRoot,
  loadObservation,
  projectObservations,
  validateObservationBytes,
} from './fixtures/observation-fixtures.js';

describe('portable observation fixture contract', () => {
  it.each(projectObservations)(
    'loads exact versioned project bytes for $key without an external artifact directory',
    async (spec) => {
      vi.stubEnv('EXPEDITION_GENUINE_OBSERVATIONS_DIRECTORY', undefined);
      try {
        const loaded = await loadObservation(spec);
        expect(loaded.observation.version).toBe('project-observation.v1');
        expect(loaded.observation.text).toContain(
          spec.key === 'controller' ? 'SC-11 SC-12' : spec.model,
        );
        expect(loaded.path).toBeInstanceOf(URL);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  it.each(projectObservations)('refuses altered project fixture bytes for $key', async (spec) => {
    const loaded = await loadObservation(spec);
    expect(() =>
      validateObservationBytes(Buffer.concat([loaded.bytes, Buffer.from(' ')]), spec),
    ).toThrow('Frozen observation identity changed');
  });
  it('explicit genuine loading fails when its prerequisite is absent', () => {
    vi.stubEnv('EXPEDITION_GENUINE_OBSERVATIONS_DIRECTORY', undefined);
    try {
      expect(() => genuineObservationRoot()).toThrow(
        'require EXPEDITION_GENUINE_OBSERVATIONS_DIRECTORY',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
