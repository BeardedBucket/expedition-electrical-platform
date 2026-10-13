import { defineConfig } from 'vitest/config';

if (!process.env.EXPEDITION_GENUINE_OBSERVATIONS_DIRECTORY)
  throw new Error(
    'Explicit genuine-source gate requires EXPEDITION_GENUINE_OBSERVATIONS_DIRECTORY. See apps/ingestion-admin/tests/fixtures/observations/README.md.',
  );

export default defineConfig({
  test: {
    include: [
      'apps/ingestion-admin/tests/human-adjudication.test.ts',
      'apps/ingestion-admin/demo/frozen-sources.test.mjs',
    ],
    environment: 'jsdom',
    env: { EXPEDITION_RUN_GENUINE_OBSERVATIONS: '1' },
    testNamePattern:
      'genuine frozen manufacturer observations|Genuine retained-source lab isolation',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
