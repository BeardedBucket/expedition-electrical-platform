import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadFrozenSourceScenarios } from './frozen-sources.mjs';
import { createDemoController } from './scenarios.ts';
const root = path.join(os.tmpdir(), 'expedition-document-extraction-benchmark');
describe('Authentic retained-source lab isolation', () => {
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
        String(file).endsWith('victron-bmv-712.json') ? Buffer.from('{}') : original(file, ...rest),
      );
    try {
      expect(() => loadFrozenSourceScenarios(root)).toThrow('Frozen observation identity changed');
    } finally {
      read.mockRestore();
    }
  });
});
