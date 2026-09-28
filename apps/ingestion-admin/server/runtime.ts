import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  HttpSourceCaptureAdapter,
  validateManufacturerAcquisitionProfile,
  type ManufacturerAcquisitionProfile,
} from '@expedition/ingestion';
import {
  FileIngestionBatchStore,
  FileIngestionJobStore,
  IngestionBatchService,
  IngestionJobService,
} from '@expedition/ingestion-runtime';

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
  const defaultJobRoot = join(repositoryRoot, '.local-ingestion', 'jobs');
  const defaultBatchRoot = join(repositoryRoot, '.local-ingestion', 'batches');
  return {
    host: env.INGESTION_API_HOST ?? '127.0.0.1',
    browserOrigin: env.INGESTION_ADMIN_ORIGIN ?? 'http://127.0.0.1:5174',
    port,
    repositoryRoot,
    jobRoot: resolve(env.INGESTION_JOB_ROOT ?? defaultJobRoot),
    batchRoot: resolve(env.INGESTION_BATCH_ROOT ?? defaultBatchRoot),
    canonicalRoot: resolve(env.INGESTION_CANONICAL_ROOT ?? join(repositoryRoot, 'data/components')),
    profileRoot: join(repositoryRoot, 'data/ingestion/manufacturer-acquisition-profiles'),
  };
}

export async function createProductionOperatorService(
  config: ReturnType<typeof operatorConfiguration>,
) {
  const profiles = await loadReviewedProfiles(config.profileRoot);
  const adapter = new HttpSourceCaptureAdapter();
  const jobService = new IngestionJobService({
    store: new FileIngestionJobStore(config.jobRoot),
    preparationRequest: () => ({ adapter, profiles, policy: operatorPolicy }),
  });
  const batchService = new IngestionBatchService({
    store: new FileIngestionBatchStore(config.batchRoot),
    jobService,
  });
  return Object.assign(batchService, { jobService });
}

export async function loadReviewedProfiles(profileRoot: string) {
  const profiles: ManufacturerAcquisitionProfile[] = [];
  for (const name of (await readdir(profileRoot)).filter((name) => name.endsWith('.json')).sort()) {
    const raw: unknown = JSON.parse(await readFile(join(profileRoot, name), 'utf8'));
    const validation = validateManufacturerAcquisitionProfile(raw);
    if (!validation.ok) throw new Error(`Invalid manufacturer acquisition profile: ${name}`);
    const profile = raw as ManufacturerAcquisitionProfile;
    if (profile.profile_status === 'reviewed') profiles.push(profile);
  }
  return profiles;
}
