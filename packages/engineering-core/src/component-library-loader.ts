import { parse as parseYaml } from 'yaml';
import type { ComponentLibraryRecord } from './component-library.js';
import { hasCurrentCanonicalVerification } from './canonical-verification.js';
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
    const normalized = normalizeComponentLibraryRecord(validation.value);
    return {
      ok: true,
      value:
        normalized.verification_status === 'verified' &&
        !hasCurrentCanonicalVerification(normalized as unknown as Record<string, unknown>)
          ? { ...normalized, verification_status: 'unverified' }
          : normalized,
      path: filePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown file loading error';
    return {
      ok: false,
      errors: [`Unable to load component file (${filePath}): ${message}`],
      path: filePath,
    };
  }
};
