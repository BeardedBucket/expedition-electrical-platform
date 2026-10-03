import { artifactDigest, reviewPackageSnapshot } from '@expedition/ingestion';
import type { ProductionApproval } from '@expedition/ingestion';
import type { IngestionJob } from './job-service.js';

export const DEFER_REASONS = [
  'schema_gap',
  'source_follow_up',
  'evidence_follow_up',
  'operator_pause',
  'other',
] as const;
export type DeferReason = (typeof DEFER_REASONS)[number];

export type ProductReviewEvent =
  | {
      readonly action: 'deferred';
      readonly revision: number;
      readonly approval: ProductionApproval;
      readonly reason?: DeferReason;
    }
  | {
      readonly action: 'resumed';
      readonly revision: number;
      readonly recorded_at: string;
      readonly actor_label: string;
      readonly review_snapshot: string;
      readonly preparation_history_count: number;
    };

export interface DeferReviewRequest {
  readonly expected_lifecycle_snapshot: string;
  readonly reason?: DeferReason;
}
export interface ResumeReviewRequest {
  readonly expected_lifecycle_snapshot: string;
  readonly actor_label: string;
}
export class ProductReviewLifecycleError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Binds operator intent to the lifecycle as well as the review. A resumed review
 * may have identical evidence, but an earlier tab must not defer/reopen it again.
 * Store CAS remains authoritative for races after this check.
 */
export function productReviewLifecycleSnapshot(job: IngestionJob): string {
  return artifactDigest({
    state: job.state,
    updated_at: job.updated_at,
    review:
      job.preparation?.status === 'review_ready'
        ? reviewPackageSnapshot(job.preparation.review_package)
        : undefined,
    approval: job.approval,
    history: job.product_review_history ?? [],
    preparation_history_count: job.preparation_recovery_history?.length ?? 0,
  });
}

/** Resume grants only a one-use, explicit re-preparation option for the exact
 * preserved review. It never replays semantic decisions under current rules.
 */
export function isResumedPreparationRecoveryEligible(job: IngestionJob): boolean {
  const last = job.product_review_history?.at(-1);
  return (
    job.state === 'review_ready' &&
    job.preparation?.status === 'review_ready' &&
    !job.approval &&
    !job.finalization_request &&
    !job.final_result &&
    last?.action === 'resumed' &&
    last.review_snapshot === reviewPackageSnapshot(job.preparation.review_package) &&
    last.preparation_history_count === (job.preparation_recovery_history?.length ?? 0)
  );
}
