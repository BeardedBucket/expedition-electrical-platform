import type { JsonObject, ProductCandidate, ProductFact, ProductSource } from './contracts.js';
import { promoteCandidate, type PromotionReview, type PromotionResult } from './promotion.js';
import { writeCanonicalComponent, type CanonicalWriteResult } from './promotion-write.js';

export type CorpusWorkflowState =
  | 'source_missing'
  | 'source_captured'
  | 'candidate_ready'
  | 'review_pending'
  | 'review_approved'
  | 'promotion_ready'
  | 'promoted'
  | 'amendment_required'
  | 'blocked';

export interface CorpusWorkItem {
  readonly schema_version: '1.0';
  readonly id: string;
  readonly manufacturer: string;
  readonly acquisition_profile_id?: string;
  readonly source_uri: string;
  readonly requested_identity: Readonly<Record<string, string>>;
  readonly expected_component_id: string;
  readonly artifact_paths: Readonly<{
    readonly source?: string;
    readonly candidate?: string;
    readonly review?: string;
  }>;
}

export interface CorpusWorkflowInput {
  readonly work_item: CorpusWorkItem;
  readonly source?: ProductSource;
  readonly facts?: readonly ProductFact[];
  readonly candidate?: ProductCandidate;
  readonly review?: PromotionReview;
  readonly canonical_components?: readonly JsonObject[];
  readonly destination_root?: string;
  readonly write?: boolean;
}

export interface CorpusWorkflowResult {
  readonly state: CorpusWorkflowState;
  readonly work_item: CorpusWorkItem;
  readonly promotion?: PromotionResult;
  readonly write?: CanonicalWriteResult;
  readonly reasons: readonly string[];
}

const identityCollision = (
  candidate: ProductCandidate,
  components: readonly JsonObject[],
): boolean =>
  components.some(
    (component) =>
      component.id === candidate.id ||
      (candidate.identity.manufacturer_part_number !== undefined &&
        component.manufacturer === candidate.identity.manufacturer &&
        component.part_number === candidate.identity.manufacturer_part_number &&
        component.id !== candidate.id),
  );

export const assessCorpusWorkflow = (input: CorpusWorkflowInput): CorpusWorkflowResult => {
  const { work_item: workItem } = input;
  if (!input.source) {
    return { state: 'source_missing', work_item: workItem, reasons: ['source_not_persisted'] };
  }
  if (!input.candidate) {
    return { state: 'source_captured', work_item: workItem, reasons: ['candidate_not_persisted'] };
  }
  if (input.candidate.promotion_status === 'blocked') {
    return {
      state: 'blocked',
      work_item: workItem,
      reasons: input.candidate.review_reasons ?? ['candidate_blocked'],
    };
  }
  if (!input.review || input.review.decision !== 'approved') {
    return {
      state: 'review_pending',
      work_item: workItem,
      reasons: ['explicit_approved_review_required'],
    };
  }
  if (identityCollision(input.candidate, input.canonical_components ?? [])) {
    return {
      state: 'amendment_required',
      work_item: workItem,
      reasons: ['exact_canonical_identity_already_exists'],
    };
  }
  if (!input.facts) {
    return {
      state: 'blocked',
      work_item: workItem,
      reasons: ['candidate_facts_not_persisted'],
    };
  }

  const promotion = promoteCandidate(input.candidate, [input.source], input.facts, input.review, {
    components: input.canonical_components ?? [],
  });
  if (promotion.status !== 'success') {
    return {
      state: 'blocked',
      work_item: workItem,
      promotion,
      reasons: promotion.issues.map((item) => item.code),
    };
  }
  if (!input.destination_root) {
    return {
      state: 'promotion_ready',
      work_item: workItem,
      promotion,
      reasons: ['approved_promotion_ready_for_atomic_write'],
    };
  }

  return {
    state: 'review_approved',
    work_item: workItem,
    promotion,
    reasons: ['approved_review_requires_explicit_write_authorization'],
  };
};

export const executeCorpusWorkflow = async (
  input: CorpusWorkflowInput,
): Promise<CorpusWorkflowResult> => {
  const assessed = assessCorpusWorkflow(input);
  if (assessed.state !== 'review_approved' || !assessed.promotion || !input.destination_root) {
    return assessed;
  }
  const write = await writeCanonicalComponent({
    promotion: assessed.promotion,
    destinationRoot: input.destination_root,
    catalogComponents: input.canonical_components,
    write: input.write === true,
  });
  return {
    ...assessed,
    state: write.status === 'written' ? 'promoted' : 'review_approved',
    write,
    reasons:
      write.status === 'written'
        ? ['canonical_component_created']
        : ['atomic_write_not_authorized_or_blocked'],
  };
};
