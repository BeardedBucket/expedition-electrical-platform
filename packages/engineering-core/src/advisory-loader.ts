import { parse as parseYaml } from 'yaml';
import type { AdvisoryRecord, EvidenceRecord } from './advisory.js';
import { validateAdvisoryCollection, validateEvidenceRecord } from './advisory.js';

export const loadAdvisoryFile = async (
  filePath: string,
): Promise<
  | {
      ok: true;
      advisories: readonly AdvisoryRecord[];
      evidence: readonly EvidenceRecord[];
      path: string;
    }
  | { ok: false; errors: readonly string[]; path: string }
> => {
  try {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(filePath, 'utf8');
    const parsed =
      filePath.toLowerCase().endsWith('.yaml') || filePath.toLowerCase().endsWith('.yml')
        ? parseYaml(raw)
        : JSON.parse(raw);
    const record = parsed as Record<string, unknown>;
    const evidenceInput = Array.isArray(record.evidence) ? record.evidence : [];
    const advisoryInput = Array.isArray(record.advisories) ? record.advisories : [parsed];
    const evidenceResults = evidenceInput.map(validateEvidenceRecord);
    const evidenceErrors = evidenceResults.flatMap((result) =>
      result.ok ? [] : result.errors.map((error) => `${error.path}: ${error.message}`),
    );
    const evidence = evidenceResults.flatMap((result) => (result.ok ? [result.value] : []));
    const advisoryErrors = validateAdvisoryCollection(advisoryInput, evidence).map(
      (error) => `${error.path}: ${error.message}`,
    );
    if (evidenceErrors.length > 0 || advisoryErrors.length > 0)
      return { ok: false, errors: [...evidenceErrors, ...advisoryErrors], path: filePath };
    return { ok: true, advisories: advisoryInput as AdvisoryRecord[], evidence, path: filePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown file loading error';
    return {
      ok: false,
      errors: [`Unable to load advisory file (${filePath}): ${message}`],
      path: filePath,
    };
  }
};
