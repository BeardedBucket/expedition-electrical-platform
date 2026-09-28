import {
  artifactReference,
  reviewPackageSnapshot,
  validateProductionApproval,
  productionApprovalToPromotionReview,
  type ApprovalDecision,
  type ProductionApproval,
} from '@expedition/ingestion';
import type { IngestionJob } from '@expedition/ingestion-runtime';
import { randomUUID } from 'node:crypto';
import { readComponentSchema } from '@expedition/engineering-core';

const schemaProperties = readComponentSchema().properties as Record<string, { enum?: unknown[] }>;
export const productRoles = (schemaProperties.product_role.enum ?? []).filter(
  (value): value is string => typeof value === 'string',
);
export class ProductReviewError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** The browser supplies human decisions only. All authority bindings come from durable state. */
export function constructApproval(
  job: IngestionJob,
  decision: ApprovalDecision,
  input: Record<string, unknown>,
): ProductionApproval {
  if (job.state !== 'review_ready' || job.preparation?.status !== 'review_ready')
    throw new ProductReviewError(409, `Cannot review job in state ${job.state}.`);
  const allowed = [
    'reviewer_id',
    'reviewed_decisions',
    ...(decision === 'approved' ? ['promotion_decisions'] : []),
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new ProductReviewError(
      400,
      'Send only the reviewer label and supported human decisions.',
    );
  if (typeof input.reviewer_id !== 'string' || !input.reviewer_id.trim())
    throw new ProductReviewError(400, 'Enter a reviewer label (not an authenticated identity).');
  const pkg = job.preparation.review_package;
  const approval = {
    ...input,
    reviewer_id: input.reviewer_id.trim(),
    schema_version: '1.0',
    artifact_kind: 'approval',
    id: `approval.${randomUUID()}`,
    decision,
    reviewed_at: new Date().toISOString(),
    review_package: artifactReference('review_package', pkg, pkg.id, pkg.schema_version),
    review_package_snapshot: reviewPackageSnapshot(pkg),
    semantic_snapshot: pkg.semantic_snapshot,
  } as ProductionApproval;
  const issues = validateProductionApproval(approval);
  if (issues.length) throw new ProductReviewError(400, issues.join('; '));
  if (decision === 'approved') {
    if (!job.preparation.bridge.candidate)
      throw new ProductReviewError(
        409,
        'No promotable candidate was produced. Reject or defer this job.',
      );
    const selections = approval.promotion_decisions;
    if (!selections?.approved_fields.length || selections.evidence_acknowledged !== true)
      throw new ProductReviewError(
        400,
        'Explicitly approve at least one field and acknowledge its source evidence.',
      );
    if (!productRoles.includes(selections.product_role))
      throw new ProductReviewError(400, 'Choose a supported product role.');
    try {
      productionApprovalToPromotionReview(approval, pkg, job.preparation.bridge);
    } catch (error) {
      throw new ProductReviewError(
        400,
        error instanceof Error ? error.message : 'Invalid human selections.',
      );
    }
  }
  return approval;
}
