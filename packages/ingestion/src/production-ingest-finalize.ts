import type { ProductionApproval } from './production-contracts.js';
import type { ProductionIngestWorkflowResult } from './production-ingest-workflow.js';
import {
  promoteProductionCandidate,
  type ProductionPromotionResult,
} from './production-promotion.js';
import { writeProductionPromotion } from './production-promotion-write.js';
import type { CanonicalWriteRequest, CanonicalWriteResult } from './promotion-write.js';
import type { PromotionCatalogContext } from './promotion.js';

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
  const promotion = promoteProductionCandidate(
    approval,
    prepared.review_package,
    prepared.bridge,
    catalogContext,
  );
  const write_result = await writeProductionPromotion(promotion, writeRequest);
  return { promotion, write_result };
};
