import { readFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
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
  'embed.tsx',
  'embed-demo.tsx',
];

describe('browser app boundary', () => {
  it('does not import Node-only loader entry points in browser-facing sources', () => {
    const offenders = browserFiles.filter((file) => {
      const source = readFileSync(join(process.cwd(), 'apps', 'configurator', 'src', file), 'utf8');
      return forbiddenLoaderNames.some((name) => source.includes(name));
    });

    expect(offenders).toEqual([]);
  });

  it('keeps the dedicated production embed artifact free of Node-only imports and network loaders', () => {
    const artifactDirectory = join(process.cwd(), 'apps', 'configurator', 'dist', 'embed');
    if (!existsSync(artifactDirectory)) {
      return;
    }
    const artifactSource = readdirSync(artifactDirectory)
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(join(artifactDirectory, file), 'utf8'))
      .join('\n');
    expect(artifactSource).not.toMatch(
      /node:fs|node:path|component-library-loader|builder-overlay-loader|advisory-loader/,
    );
    expect(artifactSource).not.toMatch(/XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
  });
});
