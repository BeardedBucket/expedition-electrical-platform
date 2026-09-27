import { randomUUID } from 'node:crypto';
import {
  approvalMatchesReviewPackage,
  finalizeProductionIngest,
  prepareProductionIngestReview,
  productionApprovalToPromotionReview,
  validateProductIntake,
  validateProductionApproval,
  type CanonicalWriteRequest,
  type ProductIntake,
  type ProductionApproval,
  type ProductionIngestFinalizeResult,
  type ProductionIngestWorkflowRequest,
  type ProductionIngestWorkflowResult,
  type PromotionCatalogContext,
  type ReviewReadyProductionIngest,
} from '@expedition/ingestion';
import { assertJsonInput, deserializeJob, serializeJob } from './codec.js';
import type { IngestionJobStore } from './job-store.js';

export type IngestionJobState =
  | 'created'
  | 'preparing'
  | 'review_ready'
  | 'preparation_failed'
  | 'approved'
  | 'review_rejected'
  | 'review_deferred'
  | 'finalizing'
  | 'finalized'
  | 'finalization_failed';

export interface FinalizationRequest {
  readonly requested_at: string;
  readonly write_request: Omit<CanonicalWriteRequest, 'promotion'>;
  readonly catalog_context?: PromotionCatalogContext;
}

export interface IngestionJob {
  readonly schema_version: '1.0';
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly intake: ProductIntake;
  readonly state: IngestionJobState;
  readonly preparation?: ProductionIngestWorkflowResult;
  readonly approval?: ProductionApproval;
  readonly finalization_request?: FinalizationRequest;
  readonly final_result?: ProductionIngestFinalizeResult;
  readonly error?: { readonly operation: 'prepare' | 'finalize'; readonly message: string };
}

export interface IngestionRuntimeDependencies {
  readonly store: IngestionJobStore;
  readonly preparationRequest: (
    intake: ProductIntake,
  ) => Omit<ProductionIngestWorkflowRequest, 'intake'>;
  readonly prepare?: typeof prepareProductionIngestReview;
  readonly finalize?: typeof finalizeProductionIngest;
  readonly now?: () => string;
  readonly newId?: () => string;
}

export class IngestionJobService {
  private readonly busy = new Set<string>();
  constructor(private readonly dependencies: IngestionRuntimeDependencies) {}

  private timestamp(): string {
    return (this.dependencies.now ?? (() => new Date().toISOString()))();
  }

  private async exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(id))
      throw new Error(`Ingestion job ${id} already has an operation in progress.`);
    this.busy.add(id);
    try {
      return await work();
    } finally {
      this.busy.delete(id);
    }
  }

  async createJob(intake: ProductIntake): Promise<IngestionJob> {
    const issues = validateProductIntake(intake);
    if (issues.length) throw new Error(`Invalid product intake: ${issues.join('; ')}`);
    assertJsonInput(intake);
    const now = this.timestamp();
    const job: IngestionJob = {
      schema_version: '1.0',
      id: (this.dependencies.newId ?? randomUUID)(),
      created_at: now,
      updated_at: now,
      intake,
      state: 'created',
    };
    serializeJob(job);
    await this.dependencies.store.create(job);
    return job;
  }

  getJob(id: string): Promise<IngestionJob> {
    return this.dependencies.store.load(id);
  }

  async listJobs(): Promise<readonly IngestionJob[]> {
    if (!this.dependencies.store.listJobIds) throw new Error('Job listing is not supported.');
    const jobs: IngestionJob[] = [];
    for (const id of await this.dependencies.store.listJobIds()) jobs.push(await this.getJob(id));
    return jobs.sort((left, right) =>
      left.updated_at === right.updated_at
        ? left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0
        : left.updated_at > right.updated_at
          ? -1
          : 1,
    );
  }

  async prepareJob(id: string): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const job = await this.getJob(id);
      if (job.state !== 'created') throw new Error(`Cannot prepare job in state ${job.state}.`);
      await this.dependencies.store.save({
        ...job,
        state: 'preparing',
        updated_at: this.timestamp(),
      });
      let preparation: ProductionIngestWorkflowResult;
      try {
        preparation = await (this.dependencies.prepare ?? prepareProductionIngestReview)({
          ...this.dependencies.preparationRequest(job.intake),
          intake: job.intake,
        });
      } catch (error) {
        const updated: IngestionJob = {
          ...job,
          state: 'preparation_failed',
          updated_at: this.timestamp(),
          error: { operation: 'prepare', message: String(error) },
        };
        await this.dependencies.store.save(updated);
        return updated;
      }
      const updated: IngestionJob = {
        ...job,
        state: preparation.status,
        preparation,
        updated_at: this.timestamp(),
      };
      await this.dependencies.store.save(updated);
      return updated;
    });
  }

  async submitApproval(id: string, approval: ProductionApproval): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const job = await this.getJob(id);
      if (job.state !== 'review_ready' || job.preparation?.status !== 'review_ready')
        throw new Error(`Cannot approve job in state ${job.state}.`);
      const issues = validateProductionApproval(approval);
      if (issues.length) throw new Error(`Invalid production approval: ${issues.join('; ')}`);
      if (!approvalMatchesReviewPackage(approval, job.preparation.review_package))
        throw new Error('Production approval does not match the exact review package.');
      if (approval.decision === 'approved')
        productionApprovalToPromotionReview(
          approval,
          job.preparation.review_package,
          job.preparation.bridge,
        );
      const updated: IngestionJob = {
        ...job,
        state:
          approval.decision === 'approved'
            ? 'approved'
            : approval.decision === 'rejected'
              ? 'review_rejected'
              : 'review_deferred',
        approval,
        updated_at: this.timestamp(),
      };
      await this.dependencies.store.save(updated);
      return updated;
    });
  }

  async finalizeJob(
    id: string,
    writeRequest: Omit<CanonicalWriteRequest, 'promotion'>,
    catalogContext?: PromotionCatalogContext,
  ): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const job = await this.getJob(id);
      if (job.state !== 'approved' || job.preparation?.status !== 'review_ready' || !job.approval)
        throw new Error(`Cannot finalize job in state ${job.state}.`);
      // Validate and detach the attempt before persisting or invoking any writer.
      const finalization_request = deserializeJob(
        serializeJob({
          requested_at: this.timestamp(),
          write_request: writeRequest,
          ...(catalogContext === undefined ? {} : { catalog_context: catalogContext }),
        }),
      ) as FinalizationRequest;
      await this.dependencies.store.save({
        ...job,
        state: 'finalizing',
        finalization_request,
        updated_at: this.timestamp(),
      });
      let final_result: ProductionIngestFinalizeResult;
      try {
        final_result = await (this.dependencies.finalize ?? finalizeProductionIngest)(
          job.preparation as ReviewReadyProductionIngest,
          job.approval,
          finalization_request.write_request,
          finalization_request.catalog_context,
        );
      } catch (error) {
        const updated: IngestionJob = {
          ...job,
          state: 'finalization_failed',
          finalization_request,
          updated_at: this.timestamp(),
          error: { operation: 'finalize', message: String(error) },
        };
        await this.dependencies.store.save(updated);
        return updated;
      }
      const updated: IngestionJob = {
        ...job,
        state: 'finalized',
        finalization_request,
        final_result,
        updated_at: this.timestamp(),
      };
      await this.dependencies.store.save(updated);
      return updated;
    });
  }
}
