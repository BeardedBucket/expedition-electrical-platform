import type { IngestionJob } from './job-service.js';

export class PreparationRecoveryError extends Error {
  readonly status = 409;
}

/** Empty-result recovery cannot replace reviewed evidence. Populated reviews
 * use the separate explicit resumed-review archival contract.
 */
export function isPreparationRecoveryEligible(
  job: Pick<
    IngestionJob,
    'state' | 'preparation' | 'approval' | 'finalization_request' | 'final_result'
  >,
): boolean {
  return (
    job.state === 'review_ready' &&
    job.preparation?.status === 'review_ready' &&
    job.preparation.qualified_facts.length === 0 &&
    !job.preparation.bridge.candidate &&
    job.preparation.proposals.length === 0 &&
    (job.preparation.bridge.reviewed_semantic_decisions?.length ?? 0) === 0 &&
    !job.approval &&
    !job.finalization_request &&
    !job.final_result
  );
}
