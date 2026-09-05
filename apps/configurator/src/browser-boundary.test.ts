import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const forbiddenLoaderNames = [
  'component-library-loader',
  'builder-overlay-loader',
  'advisory-loader',
];

const browserFiles = [
  'App.tsx',
  'configurator-model.ts',
  'components/BuilderContextSection.tsx',
  'components/ConstraintSections.tsx',
  'components/LoadsSection.tsx',
  'components/ResultsPanel.tsx',
  'components/SystemBasicsSection.tsx',
];

describe('browser app boundary', () => {
  it('does not import Node-only loader entry points in browser-facing sources', () => {
    const offenders = browserFiles.filter((file) => {
      const source = readFileSync(join(process.cwd(), 'apps', 'configurator', 'src', file), 'utf8');
      return forbiddenLoaderNames.some((name) => source.includes(name));
    });

    expect(offenders).toEqual([]);
  });
});
