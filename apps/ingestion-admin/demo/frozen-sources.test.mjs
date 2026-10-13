import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genuineObservationRoot } from '../tests/fixtures/observation-fixtures.ts';
import { loadFrozenSourceScenarios } from './frozen-sources.mjs';
import { createDemoController } from './scenarios.ts';
const owned = [];
afterEach(() => {
  for (const parent of owned.splice(0)) {
    if (
      path.dirname(path.resolve(parent)) !== path.resolve(os.tmpdir()) ||
      !path.basename(parent).startsWith('frozen-loader-test-')
    )
      throw new Error('Unsafe loader test cleanup');
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
function invalidFixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-loader-test-'));
  owned.push(parent);
  const root = path.join(parent, 'expedition-document-extraction-benchmark');
  fs.mkdirSync(path.join(root, 'outputs', 'pdfplumber-text'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifact-manifest.json'), '[]');
  fs.writeFileSync(path.join(root, 'outputs', 'pdfplumber-text', 'victron-bmv-712.json'), '{}');
  return root;
}
describe('Self-contained frozen-loader refusal boundaries', () => {
  it('refuses wrong bytes using only two exact test-owned files', () => {
    const root = invalidFixture();
    const read = vi.spyOn(fs, 'readFileSync');
    try {
      expect(() => loadFrozenSourceScenarios(root)).toThrow('Frozen observation identity changed');
      expect(
        read.mock.calls.map(([file]) => path.relative(root, file).replaceAll('\\', '/')),
      ).toEqual(['artifact-manifest.json', 'outputs/pdfplumber-text/victron-bmv-712.json']);
    } finally {
      read.mockRestore();
    }
  });
  it('refuses an escaping resolved filename before reading outside its root', () => {
    const root = invalidFixture();
    const original = fs.realpathSync;
    const realpath = vi
      .spyOn(fs, 'realpathSync')
      .mockImplementation((file, ...args) =>
        String(file).endsWith('victron-bmv-712.json')
          ? path.join(root, '..', 'outside.json')
          : original(file, ...args),
      );
    const read = vi.spyOn(fs, 'readFileSync');
    try {
      expect(() => loadFrozenSourceScenarios(root)).toThrow('Frozen observation escapes');
      expect(read.mock.calls.map(([file]) => path.relative(root, file))).toEqual([
        'artifact-manifest.json',
      ]);
    } finally {
      read.mockRestore();
      realpath.mockRestore();
    }
  });
});
if (process.env.EXPEDITION_RUN_GENUINE_OBSERVATIONS === '1') {
  const root = genuineObservationRoot();
  describe('Genuine retained-source lab isolation', () => {
    it('reads only three hash-checked observations and their identity manifest; never follows external PDF/capture/baseline paths', async () => {
      const read = vi.spyOn(fs, 'readFileSync');
      let scenarios;
      try {
        scenarios = loadFrozenSourceScenarios(root);
        expect(
          read.mock.calls.map(([file]) =>
            path.relative(fs.realpathSync(root), file).replaceAll('\\', '/'),
          ),
        ).toEqual([
          'artifact-manifest.json',
          'outputs/pdfplumber-text/victron-bmv-712.json',
          'outputs/pdfplumber-text/morningstar-sunsaver-10l.json',
          'outputs/pdfplumber-text/samlex-evo-2212.json',
        ]);
      } finally {
        read.mockRestore();
      }
      expect(scenarios).toHaveLength(3);
      for (const scenario of scenarios) {
        expect(scenario.targets).toEqual([]);
        expect(scenario.risk).toContain('scripted empty');
        const file = path.join(
          root,
          'outputs',
          'pdfplumber-text',
          scenario.id.replace('retained-', '') + '.json',
        );
        const bytes = fs.readFileSync(file),
          observation = JSON.parse(bytes);
        expect(scenario.retainedSource.observation_digest).toBe(
          'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'),
        );
        for (const item of scenario.items) {
          const fact = item.evidence[0];
          expect(observation.text.split('\n')).toContain(fact.raw_value);
          expect(fact.source_context.wording).toBe(fact.raw_value);
          expect(fact.source_context.capture_id).toBeUndefined();
          expect(fact.applicability).toEqual({ kind: 'unknown' });
          expect(fact.qualification).toBeUndefined();
          expect(fact.source_context.conditions).toBeUndefined();
          expect(
            fact.locators
              .filter((entry) => entry.role !== 'value')
              .every((entry) => entry.role === 'context'),
          ).toBe(true);
        }
        const controller = createDemoController(scenario);
        expect(controller.current().intake.product_model).toBe(scenario.identity.product_model);
        expect(controller.current().intake.manufacturer_part_number).toBeUndefined();
        await expect(controller.client.prepare(scenario.id)).rejects.toThrow('Unavailable');
      }
    });
    it('refuses altered observation bytes without modifying a frozen artifact', () => {
      const original = fs.readFileSync;
      const read = vi
        .spyOn(fs, 'readFileSync')
        .mockImplementation((file, ...rest) =>
          String(file).endsWith('victron-bmv-712.json')
            ? Buffer.from('{}')
            : original(file, ...rest),
        );
      try {
        expect(() => loadFrozenSourceScenarios(root)).toThrow(
          'Frozen observation identity changed',
        );
      } finally {
        read.mockRestore();
      }
    });
  });
}
