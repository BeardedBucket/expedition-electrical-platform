import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { loadComponentLibraryFile } from '@expedition/engineering-core/component-library-loader';
import type { ComponentLibraryRecord } from '@expedition/engineering-core';
import type { ManufacturerAcquisitionProfile } from '@expedition/ingestion';
import { loadReviewedProfiles, type operatorConfiguration } from './runtime.js';

export interface IntakeSuggestions {
  manufacturers: string[];
  products: { manufacturer: string; model: string; mpn?: string; provenance: string }[];
}

/** Validated records supply values; unreviewed jobs are never consulted. */
export function buildIntakeSuggestions(
  records: readonly ComponentLibraryRecord[],
  profiles: readonly ManufacturerAcquisitionProfile[],
): IntakeSuggestions {
  const products = records
    .filter((record) => record.verification_status === 'verified')
    .map((record) => ({
      manufacturer: record.manufacturer,
      model: record.model,
      ...(record.part_number ? { mpn: record.part_number } : {}),
      provenance: `verified component: ${record.id}`,
    }))
    .sort((a, b) => a.provenance.localeCompare(b.provenance));
  return {
    manufacturers: [
      ...new Set([
        ...products.map((product) => product.manufacturer),
        ...profiles
          .filter((profile) => profile.profile_status === 'reviewed')
          .map((profile) => profile.manufacturer),
      ]),
    ].sort(),
    products,
  };
}

export async function loadIntakeSuggestions(config: ReturnType<typeof operatorConfiguration>) {
  // Git's canonical file inventory excludes local drafts before any file is opened.
  const { stdout } = await promisify(execFile)('git', ['ls-files', '-z', '--', 'data/components'], {
    cwd: config.repositoryRoot,
  });
  const records: ComponentLibraryRecord[] = [];
  for (const name of stdout
    .split('\0')
    .filter(
      (name) =>
        /\.ya?ml$/.test(name) &&
        name !== 'data/components/victron-energy.ekrano-gx-bpp900480100.yaml',
    )
    .sort()) {
    const loaded = await loadComponentLibraryFile(join(config.repositoryRoot, name));
    if (!loaded.ok) throw new Error(`Invalid canonical suggestion record: ${name}`);
    records.push(loaded.value);
  }
  return buildIntakeSuggestions(records, await loadReviewedProfiles(config.profileRoot));
}
