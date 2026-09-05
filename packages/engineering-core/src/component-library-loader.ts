import { parse as parseYaml } from 'yaml';
import type { ComponentLibraryRecord } from './component-library.js';
import {
  normalizeComponentLibraryRecord,
  validateComponentLibraryRecord,
} from './component-library.js';

export const loadComponentLibraryFile = async (
  filePath: string,
): Promise<
  | { ok: true; value: ComponentLibraryRecord; path: string }
  | { ok: false; errors: readonly string[]; path: string }
> => {
  try {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(filePath, 'utf8');
    const parsed =
      filePath.toLowerCase().endsWith('.yaml') || filePath.toLowerCase().endsWith('.yml')
        ? parseYaml(raw)
        : JSON.parse(raw);
    const validation = validateComponentLibraryRecord(parsed);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors, path: filePath };
    }
    return { ok: true, value: normalizeComponentLibraryRecord(validation.value), path: filePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown file loading error';
    return {
      ok: false,
      errors: [`Unable to load component file (${filePath}): ${message}`],
      path: filePath,
    };
  }
};
