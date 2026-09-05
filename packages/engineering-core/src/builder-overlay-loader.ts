import { parse as parseYaml } from 'yaml';
import type { BuilderProfile } from './contracts.js';
import { validateBuilderProfileRecord } from './builder-overlay.js';

export const loadBuilderProfileFile = async (
  filePath: string,
): Promise<
  | { ok: true; value: BuilderProfile; path: string }
  | { ok: false; errors: readonly string[]; path: string }
> => {
  try {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(filePath, 'utf8');
    const parsed =
      filePath.toLowerCase().endsWith('.yaml') || filePath.toLowerCase().endsWith('.yml')
        ? parseYaml(raw)
        : JSON.parse(raw);
    const validation = validateBuilderProfileRecord(parsed);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors, path: filePath };
    }
    return { ok: true, value: validation.value, path: filePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown file loading error';
    return {
      ok: false,
      errors: [`Unable to load builder file (${filePath}): ${message}`],
      path: filePath,
    };
  }
};
