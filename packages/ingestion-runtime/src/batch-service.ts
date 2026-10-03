import { randomUUID } from 'node:crypto';
import { validateProductIntake, type ProductIntake } from '@expedition/ingestion';
import { IngestionJobService, type IngestionJob, type IngestionJobState } from './job-service.js';
import { MAX_INGESTION_BATCH_SIZE } from './batch-contract.js';
import type { IngestionBatch, IngestionBatchStore } from './batch-store.js';

export { MAX_INGESTION_BATCH_SIZE } from './batch-contract.js';

export type IngestionBatchState =
  'pending' | 'preparing' | 'review_ready' | 'failed' | 'approved' | 'finalized' | 'mixed';

export interface IngestionBatchChildSummary {
  readonly id: string;
  readonly state: IngestionJobState;
}

export interface IngestionBatchReadModel extends IngestionBatch {
  readonly state: IngestionBatchState;
  readonly job_count: number;
  readonly counts: {
    readonly source_resolution_required: number;
    readonly source_resolution_review: number;
    readonly created: number;
    readonly preparing: number;
    readonly review_ready: number;
    readonly preparation_failed: number;
    readonly approved: number;
    readonly review_rejected: number;
    readonly review_deferred: number;
    readonly finalizing: number;
    readonly finalized: number;
    readonly finalization_failed: number;
    readonly pending: number;
    readonly failed: number;
    readonly other: number;
  };
  readonly jobs: readonly IngestionBatchChildSummary[];
}

export interface IngestionBatchRuntimeDependencies {
  readonly store: IngestionBatchStore;
  readonly jobService: IngestionJobService;
  readonly now?: () => string;
  readonly newId?: () => string;
  readonly maxBatchSize?: number;
}

const isInitialPreparationEligible = (state: IngestionJobState): boolean => state === 'created';
const exactJobStates = [
  'source_resolution_required',
  'source_resolution_review',
  'created',
  'preparing',
  'review_ready',
  'preparation_failed',
  'approved',
  'review_rejected',
  'review_deferred',
  'finalizing',
  'finalized',
  'finalization_failed',
] as const;

const summarizeBatchState = (jobs: readonly IngestionJob[]): IngestionBatchState => {
  if (!jobs.length) return 'pending';

  const uniqueStates = new Set(jobs.map((job) => job.state));
  const terminalFailureStates = new Set(['preparation_failed', 'finalization_failed']);
  const reviewDispositions = new Set(['review_rejected', 'review_deferred']);

  const allPending = jobs.every((job) =>
    ['created', 'source_resolution_required', 'source_resolution_review'].includes(job.state),
  );
  if (allPending) return 'pending';
  if (jobs.every((job) => job.state === 'preparing')) return 'preparing';
  if (jobs.every((job) => job.state === 'review_ready')) return 'review_ready';
  if (jobs.every((job) => job.state === 'approved')) return 'approved';
  if (jobs.every((job) => job.state === 'finalized')) return 'finalized';
  if (jobs.every((job) => terminalFailureStates.has(job.state))) return 'failed';
  if (jobs.every((job) => reviewDispositions.has(job.state))) return 'mixed';
  if (
    jobs.some((job) => terminalFailureStates.has(job.state)) ||
    jobs.some((job) => reviewDispositions.has(job.state))
  )
    return 'mixed';
  if (uniqueStates.size > 1) return 'mixed';
  return 'mixed';
};

export class IngestionBatchService {
  constructor(private readonly dependencies: IngestionBatchRuntimeDependencies) {
    const configuredLimit = dependencies.maxBatchSize;
    if (
      configuredLimit !== undefined &&
      (!Number.isInteger(configuredLimit) ||
        configuredLimit < 1 ||
        configuredLimit > MAX_INGESTION_BATCH_SIZE)
    ) {
      throw new Error(
        `Batch size limit must be an integer between 1 and ${MAX_INGESTION_BATCH_SIZE}.`,
      );
    }
  }

  private timestamp(): string {
    return (this.dependencies.now ?? (() => new Date().toISOString()))();
  }

  private maxBatchSize(): number {
    return Math.min(
      this.dependencies.maxBatchSize ?? MAX_INGESTION_BATCH_SIZE,
      MAX_INGESTION_BATCH_SIZE,
    );
  }

  async createBatch(intakes: readonly ProductIntake[]): Promise<IngestionBatchReadModel> {
    if (!Array.isArray(intakes))
      throw new Error('Batch input must be an array of product intakes.');
    if (intakes.length === 0) throw new Error('Batch must contain at least one product intake.');
    if (intakes.length > this.maxBatchSize())
      throw new Error(`Batch size exceeds the maximum of ${this.maxBatchSize()} products.`);
    for (const intake of intakes) {
      const issues = validateProductIntake(intake);
      if (issues.length) throw new Error(`Invalid product intake in batch: ${issues.join('; ')}`);
    }
    const now = this.timestamp();
    const jobIds: string[] = [];
    for (const intake of intakes) {
      const job = await this.dependencies.jobService.createJob(intake);
      jobIds.push(job.id);
    }
    const batch: IngestionBatch = {
      schema_version: '1.0',
      id: (this.dependencies.newId ?? randomUUID)(),
      created_at: now,
      updated_at: now,
      job_ids: jobIds,
      requested_count: jobIds.length,
    };
    await this.dependencies.store.create(batch);
    return this.getBatch(batch.id);
  }

  async getBatch(id: string): Promise<IngestionBatchReadModel> {
    const batch = await this.dependencies.store.load(id);
    const jobs = await Promise.all(
      batch.job_ids.map(async (jobId) => this.dependencies.jobService.getJob(jobId)),
    );
    const counts = {
      source_resolution_required: jobs.filter((job) => job.state === 'source_resolution_required')
        .length,
      source_resolution_review: jobs.filter((job) => job.state === 'source_resolution_review')
        .length,
      created: jobs.filter((job) => job.state === 'created').length,
      preparing: jobs.filter((job) => job.state === 'preparing').length,
      review_ready: jobs.filter((job) => job.state === 'review_ready').length,
      preparation_failed: jobs.filter((job) => job.state === 'preparation_failed').length,
      approved: jobs.filter((job) => job.state === 'approved').length,
      review_rejected: jobs.filter((job) => job.state === 'review_rejected').length,
      review_deferred: jobs.filter((job) => job.state === 'review_deferred').length,
      finalizing: jobs.filter((job) => job.state === 'finalizing').length,
      finalized: jobs.filter((job) => job.state === 'finalized').length,
      finalization_failed: jobs.filter((job) => job.state === 'finalization_failed').length,
      pending: jobs.filter((job) =>
        ['created', 'source_resolution_required', 'source_resolution_review'].includes(job.state),
      ).length,
      failed: jobs.filter((job) =>
        ['preparation_failed', 'finalization_failed'].includes(job.state),
      ).length,
      other: jobs.filter(
        (job) => !exactJobStates.includes(job.state as (typeof exactJobStates)[number]),
      ).length,
    };
    const summary: IngestionBatchReadModel = {
      ...batch,
      state: summarizeBatchState(jobs),
      job_count: jobs.length,
      counts,
      jobs: jobs.map((job) => ({ id: job.id, state: job.state })),
    };
    return summary;
  }

  async listBatches(): Promise<readonly IngestionBatchReadModel[]> {
    const batches = await this.dependencies.store.list();
    return Promise.all(batches.map((batch) => this.getBatch(batch.id)));
  }

  async prepareBatch(id: string): Promise<IngestionBatchReadModel> {
    const batch = await this.dependencies.store.load(id);
    for (const jobId of batch.job_ids) {
      const job = await this.dependencies.jobService.getJob(jobId);
      if (isInitialPreparationEligible(job.state)) {
        await this.dependencies.jobService.prepareJob(jobId);
      }
    }
    const nextBatch: IngestionBatch = {
      ...batch,
      updated_at: this.timestamp(),
    };
    await this.dependencies.store.save(nextBatch);
    return this.getBatch(id);
  }

  createJob(intake: ProductIntake): Promise<IngestionJob> {
    return this.dependencies.jobService.createJob(intake);
  }

  getJob(id: string): Promise<IngestionJob> {
    return this.dependencies.jobService.getJob(id);
  }

  listJobs(): Promise<readonly IngestionJob[]> {
    return this.dependencies.jobService.listJobs();
  }

  prepareJob(id: string): Promise<IngestionJob> {
    return this.dependencies.jobService.prepareJob(id);
  }

  submitSourceResolutionCandidate(id: string, uri: string): Promise<IngestionJob> {
    return this.dependencies.jobService.submitSourceResolutionCandidate(id, uri);
  }

  decideSourceResolution(
    id: string,
    attemptId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<IngestionJob> {
    return this.dependencies.jobService.decideSourceResolution(id, attemptId, decision);
  }

  reopenSourceSelection(id: string): Promise<IngestionJob> {
    return this.dependencies.jobService.reopenSourceSelection(id);
  }

  reopenPreparation(
    id: string,
    expectedReviewSnapshot: string,
    expectedLifecycleSnapshot?: string,
  ): Promise<IngestionJob> {
    return this.dependencies.jobService.reopenPreparation(
      id,
      expectedReviewSnapshot,
      expectedLifecycleSnapshot,
    );
  }

  resumeDeferredReview(
    id: string,
    request: Parameters<IngestionJobService['resumeDeferredReview']>[1],
  ): Promise<IngestionJob> {
    return this.dependencies.jobService.resumeDeferredReview(id, request);
  }

  submitApproval(
    id: string,
    approval: Parameters<IngestionJobService['submitApproval']>[1],
    deferral?: Parameters<IngestionJobService['submitApproval']>[2],
  ): Promise<IngestionJob> {
    return this.dependencies.jobService.submitApproval(id, approval, deferral);
  }

  recordSemanticDecision(
    id: string,
    request: Parameters<IngestionJobService['recordSemanticDecision']>[1],
  ): ReturnType<IngestionJobService['recordSemanticDecision']> {
    return this.dependencies.jobService.recordSemanticDecision(id, request);
  }

  discoverSemanticTargets(
    id: string,
    proposalId: string,
    request: Parameters<IngestionJobService['discoverSemanticTargets']>[2],
  ): ReturnType<IngestionJobService['discoverSemanticTargets']> {
    return this.dependencies.jobService.discoverSemanticTargets(id, proposalId, request);
  }

  previewSemanticMapping(
    id: string,
    proposalId: string,
    request: Parameters<IngestionJobService['previewSemanticMapping']>[2],
  ): ReturnType<IngestionJobService['previewSemanticMapping']> {
    return this.dependencies.jobService.previewSemanticMapping(id, proposalId, request);
  }

  finalizeJob(
    id: string,
    writeRequest: Parameters<IngestionJobService['finalizeJob']>[1],
    catalogContext?: Parameters<IngestionJobService['finalizeJob']>[2],
  ): Promise<IngestionJob> {
    return this.dependencies.jobService.finalizeJob(id, writeRequest, catalogContext);
  }
}
