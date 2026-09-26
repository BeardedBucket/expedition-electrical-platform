import type { ProductionCandidateBridgeResult } from './production-candidate-bridge.js';
import { productionApprovalToPromotionReview } from './production-approval-bridge.js';
import type { ProductionApproval, ReviewPackage } from './production-contracts.js';
import {
  promoteCandidate,
  type PromotionCatalogContext,
  type PromotionResult,
  type PromotionReview,
} from './promotion.js';

export interface ProductionPromotionResult {
  readonly review: PromotionReview;
  readonly result: PromotionResult;
}

/** Produce a canonical proposal through the existing reviewed promotion engine. */
export const promoteProductionCandidate = (
  approval: ProductionApproval,
  reviewPackage: ReviewPackage,
  bridge: ProductionCandidateBridgeResult,
  catalogContext?: PromotionCatalogContext,
): ProductionPromotionResult => {
  const normalizedBridge = {
    ...bridge,
    sources: [...bridge.sources].sort((left, right) => left.id.localeCompare(right.id)),
    facts: [...bridge.facts].sort((left, right) => left.id.localeCompare(right.id)),
  };
  const review = productionApprovalToPromotionReview(approval, reviewPackage, normalizedBridge);
  if (!normalizedBridge.candidate) throw new Error('Production candidate bridge has no candidate.');
  return {
    review,
    result: promoteCandidate(
      normalizedBridge.candidate,
      normalizedBridge.sources,
      normalizedBridge.facts,
      review,
      catalogContext,
    ),
  };
};
