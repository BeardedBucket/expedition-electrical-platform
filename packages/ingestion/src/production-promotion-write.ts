import {
  writeCanonicalComponent,
  type CanonicalWriteRequest,
  type CanonicalWriteResult,
} from './promotion-write.js';
import type { ProductionPromotionResult } from './production-promotion.js';

/** Write a successful production proposal through the existing guarded writer. */
export const writeProductionPromotion = async (
  production: ProductionPromotionResult,
  request: Omit<CanonicalWriteRequest, 'promotion'>,
): Promise<CanonicalWriteResult> => {
  const promotion = production.result;
  if (promotion.status !== 'success' || !promotion.proposal)
    return {
      status: promotion.status === 'invalid' ? 'invalid' : 'blocked',
      issues: promotion.issues,
      schema_valid: false,
      collision: false,
    };

  return writeCanonicalComponent({ ...request, promotion });
};
