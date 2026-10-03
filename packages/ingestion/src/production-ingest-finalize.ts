import type { ProductionApproval } from './production-contracts.js';
import type { ProductionIngestWorkflowResult } from './production-ingest-workflow.js';
import {
  promoteProductionCandidate,
  type ProductionPromotionResult,
} from './production-promotion.js';
import { writeProductionPromotion } from './production-promotion-write.js';
import type { CanonicalWriteRequest, CanonicalWriteResult } from './promotion-write.js';
import type { PromotionCatalogContext } from './promotion.js';
import { artifactDigest } from './production-contracts.js';
import { assertAcceptedSourceResolution } from './source-resolution.js';
import { buildProductionReviewPackage } from './production-review-package.js';

export type ReviewReadyProductionIngest = Extract<
  ProductionIngestWorkflowResult,
  { readonly status: 'review_ready' }
>;

export interface ProductionIngestFinalizeResult {
  readonly promotion: ProductionPromotionResult;
  readonly write_result: CanonicalWriteResult;
}

/** Complete an approved review using the existing promotion and guarded writer. */
export const finalizeProductionIngest = async (
  prepared: ReviewReadyProductionIngest,
  approval: ProductionApproval,
  writeRequest: Omit<CanonicalWriteRequest, 'promotion'>,
  catalogContext?: PromotionCatalogContext,
): Promise<ProductionIngestFinalizeResult> => {
  if (prepared.source_resolution) {
    assertAcceptedSourceResolution(prepared.intake, prepared.source_resolution);
    const expected = buildProductionReviewPackage({
      intake: prepared.intake,
      source_resolution: prepared.source_resolution,
      reconciliation: prepared.reconciliation,
      bridge: prepared.bridge,
    });
    if (
      artifactDigest(expected) !== artifactDigest(prepared.review_package) ||
      prepared.source_acquisitions.some(
        (item) => item.source_resolution?.digest !== artifactDigest(prepared.source_resolution),
      )
    )
      throw new Error('Prepared source resolution does not match the exact review provenance.');
  } else if (prepared.review_package.source_resolution) {
    throw new Error('Prepared source resolution artifact is missing.');
  }
  const promotion = promoteProductionCandidate(
    approval,
    prepared.review_package,
    prepared.bridge,
    catalogContext,
  );
  const write_result = await writeProductionPromotion(promotion, writeRequest);
  return { promotion, write_result };
};
