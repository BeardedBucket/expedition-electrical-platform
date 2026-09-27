import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  HttpSourceCaptureAdapter,
  validateManufacturerAcquisitionProfile,
  type ManufacturerAcquisitionProfile,
} from '@expedition/ingestion';
import { FileIngestionJobStore, IngestionJobService } from '@expedition/ingestion-runtime';

export const operatorPolicy = {
  max_recursion_depth: 1,
  max_discovered_candidates: 50,
  max_captured_candidates: 20,
  retention_status: 'not_retained',
} as const;

export function operatorConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const repositoryRoot = resolve(env.INGESTION_REPOSITORY_ROOT ?? '../..');
  const port = Number(env.INGESTION_API_PORT ?? 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid INGESTION_API_PORT.');
  return {
    host: env.INGESTION_API_HOST ?? '127.0.0.1',
    browserOrigin: env.INGESTION_ADMIN_ORIGIN ?? 'http://127.0.0.1:5174',
    port,
    repositoryRoot,
    jobRoot: resolve(env.INGESTION_JOB_ROOT ?? join(repositoryRoot, '.local-ingestion/jobs')),
    canonicalRoot: resolve(env.INGESTION_CANONICAL_ROOT ?? join(repositoryRoot, 'data/components')),
    profileRoot: join(repositoryRoot, 'data/ingestion/manufacturer-acquisition-profiles'),
  };
}

export async function createProductionOperatorService(
  config: ReturnType<typeof operatorConfiguration>,
) {
  const profiles: ManufacturerAcquisitionProfile[] = [];
  for (const name of (await readdir(config.profileRoot))
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    const raw: unknown = JSON.parse(await readFile(join(config.profileRoot, name), 'utf8'));
    const validation = validateManufacturerAcquisitionProfile(raw);
    if (!validation.ok) throw new Error(`Invalid manufacturer acquisition profile: ${name}`);
    const profile = raw as ManufacturerAcquisitionProfile;
    if (profile.profile_status === 'reviewed') profiles.push(profile);
  }
  const adapter = new HttpSourceCaptureAdapter();
  return new IngestionJobService({
    store: new FileIngestionJobStore(config.jobRoot),
    preparationRequest: () => ({ adapter, profiles, policy: operatorPolicy }),
  });
}
