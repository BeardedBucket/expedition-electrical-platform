import { randomUUID } from 'node:crypto';
import {
  approvalMatchesReviewPackage,
  artifactDigest,
  artifactReference,
  assertAcceptedSourceResolution,
  buildProductionProductCandidate,
  buildProductionReviewPackage,
  captureSourceResolutionCandidate,
  finalizeProductionIngest,
  prepareProductionIngestReview,
  productionApprovalToPromotionReview,
  PRODUCTION_SCHEMA_VERSION,
  reviewPackageSnapshot,
  evaluateSemanticReviewCompletion,
  previewReviewedSemanticMapping,
  reviewedSemanticTargetsForFacts,
  reviewedSemanticInputSnapshot,
  REVIEWED_SEMANTIC_POLICY_VERSION,
  validateReviewedSemanticDecision,
  validateProductIntake,
  validateProductionArtifactSchema,
  validateProductionApproval,
  type CanonicalWriteRequest,
  type JsonValue,
  type ProductIntake,
  type ProductionApproval,
  type ProductionIngestFinalizeResult,
  type ProductionIngestWorkflowRequest,
  type ProductionIngestWorkflowResult,
  type PromotionCatalogContext,
  type ReviewReadyProductionIngest,
  type ReviewedSemanticDecision,
  type SourceResolutionArtifact,
  type SourceCaptureArtifact,
  type ArtifactReference,
  type ReviewedSemanticMappingPreview,
  type ReviewedSemanticTargetDescriptor,
} from '@expedition/ingestion';
import { assertJsonInput, deserializeJob, serializeJob } from './codec.js';
import { JobStoreConflictError, type IngestionJobStore } from './job-store.js';
import { isPreparationRecoveryEligible, PreparationRecoveryError } from './preparation-recovery.js';
import {
  DEFER_REASONS,
  isResumedPreparationRecoveryEligible,
  productReviewLifecycleSnapshot,
  ProductReviewLifecycleError,
  type ProductReviewEvent,
  type DeferReviewRequest,
  type ResumeReviewRequest,
} from './product-review-lifecycle.js';

export type IngestionJobState =
  | 'source_resolution_required'
  | 'source_resolution_review'
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
  readonly source_resolution_attempts?: readonly {
    readonly resolution: SourceResolutionArtifact;
    readonly capture: SourceCaptureArtifact;
  }[];
  /** The first accepted reference is retained as a durable historical binding. */
  readonly accepted_source_resolution?: ArtifactReference<'source_resolution'>;
  /** Explicit source currently selected for preparation; absent during source review. */
  readonly active_source_resolution?: ArtifactReference<'source_resolution'>;
  readonly source_resolution_recovery_history?: readonly {
    readonly requested_at: string;
    readonly method: 'local_operator';
    readonly previous_source_resolution: ArtifactReference<'source_resolution'>;
    readonly preparation: ProductionIngestWorkflowResult;
  }[];
  readonly preparation?: ProductionIngestWorkflowResult;
  readonly preparation_recovery_history?: readonly {
    readonly requested_at: string;
    readonly method: 'local_operator';
    readonly previous_review_snapshot: string;
    readonly preparation: ReviewReadyProductionIngest;
  }[];
  readonly approval?: ProductionApproval;
  readonly product_review_history?: readonly ProductReviewEvent[];
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

interface SemanticDecisionRequestBase {
  readonly proposal_id: string;
  readonly expected_review_snapshot: string;
  readonly selected_fact_ids?: readonly string[];
  readonly actor_label: string;
}

export type SemanticDecisionRequest =
  | (SemanticDecisionRequestBase & {
      readonly outcome: 'map';
      readonly target: string;
      readonly normalized_value: JsonValue;
      readonly normalized_unit?: string;
      readonly source_unit?: string;
      readonly rationale: string;
    })
  | (SemanticDecisionRequestBase & {
      readonly outcome: 'schema_gap';
      readonly schema_gap: { readonly concept_key: string; readonly explanation: string };
      readonly rationale: string;
    })
  | (SemanticDecisionRequestBase & {
      readonly outcome: 'reject' | 'not_applicable';
      readonly rationale: string;
    })
  | (SemanticDecisionRequestBase & {
      readonly outcome: 'evidence_only' | 'unresolved';
      readonly rationale?: string;
    });

export interface SemanticTargetDiscoveryRequest {
  readonly expected_review_snapshot: string;
  readonly selected_fact_ids?: readonly string[];
}

export interface SemanticMapPreviewRequest {
  readonly expected_review_snapshot: string;
  readonly selected_fact_ids?: readonly string[];
  readonly target: string;
  readonly source_unit?: string;
}

export interface SemanticTargetDiscovery {
  readonly proposal_id: string;
  readonly targets: readonly ReviewedSemanticTargetDescriptor[];
}

export class SemanticDecisionError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

export class SemanticReviewIncompleteError extends Error {
  readonly status = 409;
  constructor(readonly proposal_ids: readonly string[]) {
    super(
      `Semantic review is incomplete; disposition is required for proposal(s): ${proposal_ids.join(', ')}.`,
    );
  }
}

export class SourceResolutionError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

const acceptedResolutionForReference = (
  job: IngestionJob,
  reference: ArtifactReference<'source_resolution'> | undefined,
): SourceResolutionArtifact | undefined =>
  reference
    ? job.source_resolution_attempts?.find(
        ({ resolution }) =>
          resolution.disposition === 'accepted' && artifactDigest(resolution) === reference.digest,
      )?.resolution
    : undefined;

const currentSourceResolutionReference = (
  job: IngestionJob,
): ArtifactReference<'source_resolution'> | undefined => {
  if (job.active_source_resolution) return job.active_source_resolution;
  // Older jobs used the immutable first-accepted reference as their active source.
  // Recovery history makes an absent active pointer an intentional unselected state.
  if (job.source_resolution_recovery_history?.length) return undefined;
  return job.accepted_source_resolution;
};

export const isSourceSelectionRecoveryEligible = (job: IngestionJob): boolean => {
  const currentReference = currentSourceResolutionReference(job);
  return (
    job.state === 'preparation_failed' &&
    job.preparation?.status === 'preparation_failed' &&
    job.preparation.reason === 'acquisition_failed' &&
    job.preparation.acquisition.status === 'seed_failed' &&
    !job.approval &&
    !job.finalization_request &&
    !!currentReference &&
    !!acceptedResolutionForReference(job, currentReference)
  );
};

export class IngestionJobService {
  private readonly busy = new Set<string>();
  // This queue reduces same-process contention; durable store CAS is authoritative.
  private readonly decisionTails = new Map<string, Promise<void>>();
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

  private readVersionedJob(id: string) {
    return this.dependencies.store.loadVersioned(id);
  }

  private semanticProposalFacts(
    preparation: ReviewReadyProductionIngest,
    proposalId: string,
    selectedFactIds?: readonly string[],
  ) {
    const proposal = preparation.proposals.find((item) => item.id === proposalId);
    if (!proposal)
      throw new SemanticDecisionError(400, 'The requested semantic proposal is not current.');
    if (proposal.derivation)
      throw new SemanticDecisionError(
        400,
        'Calculated or derived semantic proposals cannot receive human decisions.',
      );
    const factsById = new Map(preparation.qualified_facts.map((fact) => [fact.id, fact]));
    const factsByDigest = new Map(
      preparation.qualified_facts.map((fact) => [artifactDigest(fact), fact]),
    );
    const boundFacts = (proposal.fact_refs ?? []).map((reference) => {
      const fact = factsByDigest.get(reference.digest);
      if (
        reference.kind !== 'qualified_fact' ||
        !reference.reference ||
        !fact ||
        fact.id !== reference.reference ||
        factsById.get(fact.id) !== fact
      )
        throw new Error(
          'The current semantic proposal contains a foreign or stale fact reference.',
        );
      return fact;
    });
    if (!boundFacts.length)
      throw new SemanticDecisionError(
        400,
        'The current semantic proposal has no supporting facts.',
      );
    const selectedIds = selectedFactIds ?? boundFacts.map((fact) => fact.id);
    if (
      !Array.isArray(selectedIds) ||
      selectedIds.length === 0 ||
      new Set(selectedIds).size !== selectedIds.length
    )
      throw new SemanticDecisionError(400, 'Select one or more distinct supporting facts.');
    const boundFactIds = new Set(boundFacts.map((fact) => fact.id));
    const selectedFacts = selectedIds.map((factId) => {
      const fact = factsById.get(factId);
      if (!fact || !boundFactIds.has(factId))
        throw new SemanticDecisionError(
          400,
          `Selected qualified fact '${factId}' does not support this proposal.`,
        );
      return fact;
    });
    return { proposal, boundFacts, selectedFacts };
  }

  private assertSemanticReviewEditable(
    job: IngestionJob,
    expectedReviewSnapshot: string,
  ): ReviewReadyProductionIngest {
    if (
      job.state !== 'review_ready' ||
      job.preparation?.status !== 'review_ready' ||
      job.approval ||
      job.finalization_request ||
      job.final_result
    )
      throw new SemanticDecisionError(
        409,
        `Semantic decisions are only editable before approval while the job is review_ready (current state: ${job.state}).`,
      );
    const preparation = job.preparation;
    if (expectedReviewSnapshot !== reviewPackageSnapshot(preparation.review_package))
      throw new SemanticDecisionError(409, 'The reviewed package changed; reload before editing.');
    return preparation;
  }

  async discoverSemanticTargets(
    id: string,
    proposalId: string,
    request: SemanticTargetDiscoveryRequest,
  ): Promise<SemanticTargetDiscovery> {
    const job = await this.getJob(id);
    const preparation = this.assertSemanticReviewEditable(job, request.expected_review_snapshot);
    const proposal = preparation.proposals.find((item) => item.id === proposalId);
    if (!proposal)
      throw new SemanticDecisionError(400, 'The requested semantic proposal is not current.');
    if (proposal.derivation) return { proposal_id: proposalId, targets: [] };
    const { selectedFacts } = this.semanticProposalFacts(
      preparation,
      proposalId,
      request.selected_fact_ids,
    );
    return {
      proposal_id: proposalId,
      targets: reviewedSemanticTargetsForFacts(
        selectedFacts,
        preparation.qualified_facts,
        preparation.source_acquisitions,
      ),
    };
  }

  async previewSemanticMapping(
    id: string,
    proposalId: string,
    request: SemanticMapPreviewRequest,
  ): Promise<ReviewedSemanticMappingPreview> {
    const job = await this.getJob(id);
    const preparation = this.assertSemanticReviewEditable(job, request.expected_review_snapshot);
    const { selectedFacts } = this.semanticProposalFacts(
      preparation,
      proposalId,
      request.selected_fact_ids,
    );
    try {
      const preview = previewReviewedSemanticMapping(
        request.target,
        selectedFacts,
        preparation.qualified_facts,
        preparation.source_acquisitions,
        request.source_unit,
      );
      return preview;
    } catch (error) {
      throw new SemanticDecisionError(
        400,
        error instanceof Error ? error.message : 'Semantic mapping preview is invalid.',
      );
    }
  }

  private async exclusiveSemanticDecision<T>(id: string, work: () => Promise<T>): Promise<T> {
    const predecessor = this.decisionTails.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.then(() => gate);
    this.decisionTails.set(id, tail);
    await predecessor;
    try {
      return await this.exclusive(id, work);
    } finally {
      release();
      if (this.decisionTails.get(id) === tail) this.decisionTails.delete(id);
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
      state: intake.official_product_uri ? 'created' : 'source_resolution_required',
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

  async submitSourceResolutionCandidate(id: string, uri: string): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const { job, version } = await this.readVersionedJob(id);
      if (job.state !== 'source_resolution_required' || job.intake.official_product_uri)
        throw new SourceResolutionError(
          409,
          `Cannot submit a source candidate in state ${job.state}.`,
        );
      if (typeof uri !== 'string' || !uri.trim() || uri.length > 4096)
        throw new SourceResolutionError(
          400,
          'Provide a candidate HTTP(S) URL of at most 4096 characters.',
        );
      let attempt: Awaited<ReturnType<typeof captureSourceResolutionCandidate>>;
      try {
        attempt = await captureSourceResolutionCandidate(
          {
            ...this.dependencies.preparationRequest(job.intake),
            intake: job.intake,
          },
          uri.trim(),
          `resolution.${randomUUID()}`,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith('Invalid source resolution candidate:')
        )
          throw new SourceResolutionError(400, error.message);
        throw error;
      }
      const updated: IngestionJob = {
        ...job,
        state: 'source_resolution_review',
        updated_at: this.timestamp(),
        source_resolution_attempts: [...(job.source_resolution_attempts ?? []), attempt],
      };
      await this.dependencies.store.save(updated, version);
      return updated;
    });
  }

  async decideSourceResolution(
    id: string,
    attemptId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const { job, version } = await this.readVersionedJob(id);
      if (job.state !== 'source_resolution_review' || job.intake.official_product_uri)
        throw new SourceResolutionError(
          409,
          `Cannot review a source candidate in state ${job.state}.`,
        );
      const attempt = job.source_resolution_attempts?.find(
        (item) => item.resolution.attempt_id === attemptId,
      );
      if (!attempt || attempt.resolution.disposition !== 'pending')
        throw new SourceResolutionError(409, 'The requested source attempt is not pending review.');
      if (decision !== 'accepted' && decision !== 'rejected')
        throw new SourceResolutionError(400, 'Unknown source resolution decision.');
      const resolved: SourceResolutionArtifact = {
        ...attempt.resolution,
        disposition: decision,
        review: { reviewed_at: this.timestamp(), method: 'local_operator' },
      };
      if (decision === 'accepted') {
        if (!resolved.final_uri)
          throw new SourceResolutionError(409, 'A final URL is required to accept a source.');
        assertAcceptedSourceResolution(job.intake, resolved);
      }
      const updated: IngestionJob = {
        ...job,
        state: decision === 'accepted' ? 'created' : 'source_resolution_required',
        updated_at: this.timestamp(),
        source_resolution_attempts: job.source_resolution_attempts!.map((item) =>
          item === attempt ? { ...item, resolution: resolved } : item,
        ),
        ...(decision === 'accepted'
          ? {
              ...(job.accepted_source_resolution
                ? {}
                : {
                    accepted_source_resolution: artifactReference(
                      'source_resolution',
                      resolved,
                      resolved.id,
                      resolved.schema_version,
                    ),
                  }),
              active_source_resolution: artifactReference(
                'source_resolution',
                resolved,
                resolved.id,
                resolved.schema_version,
              ),
            }
          : {}),
      };
      await this.dependencies.store.save(updated, version);
      return updated;
    });
  }

  async reopenSourceSelection(id: string): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const { job, version } = await this.readVersionedJob(id);
      if (!isSourceSelectionRecoveryEligible(job) || !job.preparation)
        throw new SourceResolutionError(
          409,
          'Source selection can only be reopened after an accepted source fails during acquisition.',
        );
      const previousSource = currentSourceResolutionReference(job);
      if (!previousSource)
        throw new SourceResolutionError(409, 'No active accepted source is available to recover.');
      const requestedAt = this.timestamp();
      const updated: IngestionJob = {
        ...job,
        state: 'source_resolution_required',
        updated_at: requestedAt,
        active_source_resolution: undefined,
        preparation: undefined,
        error: undefined,
        source_resolution_recovery_history: [
          ...(job.source_resolution_recovery_history ?? []),
          {
            requested_at: requestedAt,
            method: 'local_operator',
            previous_source_resolution: previousSource,
            preparation: job.preparation,
          },
        ],
      };
      await this.dependencies.store.save(updated, version);
      return updated;
    });
  }

  async reopenPreparation(
    id: string,
    expectedReviewSnapshot: string,
    expectedLifecycleSnapshot?: string,
  ): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const { job, version } = await this.readVersionedJob(id);
      if (
        (!isPreparationRecoveryEligible(job) && !isResumedPreparationRecoveryEligible(job)) ||
        job.preparation?.status !== 'review_ready' ||
        reviewPackageSnapshot(job.preparation.review_package) !== expectedReviewSnapshot ||
        (expectedLifecycleSnapshot !== undefined &&
          expectedLifecycleSnapshot !== productReviewLifecycleSnapshot(job)) ||
        (isResumedPreparationRecoveryEligible(job) && !expectedLifecycleSnapshot)
      )
        throw new PreparationRecoveryError(
          'Only the current empty review or explicitly resumed review can be reopened for preparation.',
        );
      const requestedAt = this.timestamp();
      const updated: IngestionJob = {
        ...job,
        state: 'created',
        updated_at: requestedAt,
        preparation: undefined,
        error: undefined,
        preparation_recovery_history: [
          ...(job.preparation_recovery_history ?? []),
          {
            requested_at: requestedAt,
            method: 'local_operator',
            previous_review_snapshot: expectedReviewSnapshot,
            preparation: job.preparation,
          },
        ],
      };
      await this.dependencies.store.save(updated, version);
      return updated;
    });
  }

  async prepareJob(id: string): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const { job, version } = await this.readVersionedJob(id);
      if (job.state !== 'created') throw new Error(`Cannot prepare job in state ${job.state}.`);
      const sourceReference = currentSourceResolutionReference(job);
      const resolution = acceptedResolutionForReference(job, sourceReference);
      if (!job.intake.official_product_uri) {
        if (!resolution)
          throw new SourceResolutionError(409, 'Accept a source resolution before preparation.');
        assertAcceptedSourceResolution(job.intake, resolution);
      }
      const preparingJob: IngestionJob = {
        ...job,
        state: 'preparing',
        updated_at: this.timestamp(),
      };
      const currentVersion = await this.dependencies.store.save(preparingJob, version);
      let preparation: ProductionIngestWorkflowResult;
      try {
        preparation = await (this.dependencies.prepare ?? prepareProductionIngestReview)({
          ...this.dependencies.preparationRequest(job.intake),
          intake: job.intake,
          ...(resolution ? { source_resolution: resolution } : {}),
        });
      } catch (error) {
        const updated: IngestionJob = {
          ...preparingJob,
          state: 'preparation_failed',
          updated_at: this.timestamp(),
          error: { operation: 'prepare', message: String(error) },
        };
        await this.dependencies.store.save(updated, currentVersion);
        return updated;
      }
      const updated: IngestionJob = {
        ...preparingJob,
        state: preparation.status,
        preparation,
        updated_at: this.timestamp(),
      };
      await this.dependencies.store.save(updated, currentVersion);
      return updated;
    });
  }

  async submitApproval(
    id: string,
    approval: ProductionApproval,
    deferral?: DeferReviewRequest,
  ): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const { job, version } = await this.readVersionedJob(id);
      if (job.state !== 'review_ready' || job.preparation?.status !== 'review_ready')
        throw new Error(`Cannot approve job in state ${job.state}.`);
      const issues = validateProductionApproval(approval);
      if (issues.length) throw new Error(`Invalid production approval: ${issues.join('; ')}`);
      if (!approvalMatchesReviewPackage(approval, job.preparation.review_package))
        throw new Error('Production approval does not match the exact review package.');
      if (approval.decision === 'deferred') {
        if (!approval.reviewed_decisions?.some((rationale) => rationale.trim()))
          throw new ProductReviewLifecycleError(400, 'Deferral requires a human rationale.');
        if (
          !deferral ||
          deferral.expected_lifecycle_snapshot !== productReviewLifecycleSnapshot(job)
        )
          throw new ProductReviewLifecycleError(
            409,
            'The product-review lifecycle changed; reload before deferring.',
          );
        if (deferral.reason !== undefined && !DEFER_REASONS.includes(deferral.reason))
          throw new ProductReviewLifecycleError(400, 'Unknown deferral reason.');
      }
      if (approval.decision === 'approved')
        productionApprovalToPromotionReview(
          approval,
          job.preparation.review_package,
          job.preparation.bridge,
        );
      if (approval.decision === 'approved') {
        // Evaluate the review artifacts loaded with this CAS version; the caller cannot assert
        // completion, and no transition is saved unless these current bindings pass.
        const completion = evaluateSemanticReviewCompletion(
          job.preparation.proposals,
          job.preparation.bridge.reviewed_semantic_interpretation,
        );
        if (!completion.complete)
          throw new SemanticReviewIncompleteError(
            completion.required_dispositions.map((requirement) => requirement.proposal_id),
          );
      }
      const updated: IngestionJob = {
        ...job,
        state:
          approval.decision === 'approved'
            ? 'approved'
            : approval.decision === 'rejected'
              ? 'review_rejected'
              : 'review_deferred',
        approval,
        ...(approval.decision === 'deferred'
          ? {
              product_review_history: [
                ...(job.product_review_history ?? []),
                {
                  action: 'deferred' as const,
                  revision: (job.product_review_history?.length ?? 0) + 1,
                  approval,
                  ...(deferral?.reason ? { reason: deferral.reason } : {}),
                },
              ],
            }
          : {}),
        updated_at: this.timestamp(),
      };
      await this.dependencies.store.save(updated, version);
      return updated;
    });
  }

  async resumeDeferredReview(id: string, request: ResumeReviewRequest): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const { job, version } = await this.readVersionedJob(id);
      if (
        job.state !== 'review_deferred' ||
        job.approval?.decision !== 'deferred' ||
        job.preparation?.status !== 'review_ready' ||
        job.finalization_request ||
        job.final_result ||
        !approvalMatchesReviewPackage(job.approval, job.preparation.review_package) ||
        request.expected_lifecycle_snapshot !== productReviewLifecycleSnapshot(job)
      )
        throw new ProductReviewLifecycleError(
          409,
          'Only the current deferred review may be explicitly resumed.',
        );
      if (typeof request.actor_label !== 'string' || !request.actor_label.trim())
        throw new ProductReviewLifecycleError(400, 'An operator label is required.');
      // Older terminal-defer records have no event stream. Preserve their exact
      // bound decision as the baseline, without inventing a reason or rationale.
      const history: readonly ProductReviewEvent[] = job.product_review_history?.length
        ? job.product_review_history
        : [{ action: 'deferred', revision: 1, approval: job.approval }];
      const recordedAt = this.timestamp();
      const updated: IngestionJob = {
        ...job,
        state: 'review_ready',
        approval: undefined,
        updated_at: recordedAt,
        product_review_history: [
          ...history,
          {
            action: 'resumed',
            revision: history.length + 1,
            recorded_at: recordedAt,
            actor_label: request.actor_label.trim(),
            review_snapshot: reviewPackageSnapshot(job.preparation.review_package),
            preparation_history_count: job.preparation_recovery_history?.length ?? 0,
          },
        ],
      };
      await this.dependencies.store.save(updated, version);
      return updated;
    });
  }

  async recordSemanticDecision(
    id: string,
    request: SemanticDecisionRequest,
  ): Promise<IngestionJob> {
    return this.exclusiveSemanticDecision(id, async () => {
      const { job, version } = await this.readVersionedJob(id);
      const preparation = this.assertSemanticReviewEditable(job, request.expected_review_snapshot);
      if (typeof request.actor_label !== 'string' || !request.actor_label.trim())
        throw new SemanticDecisionError(400, 'An operator label is required.');

      const { proposal, boundFacts, selectedFacts } = this.semanticProposalFacts(
        preparation,
        request.proposal_id,
        request.selected_fact_ids,
      );

      const decisions: readonly ReviewedSemanticDecision[] =
        preparation.bridge.reviewed_semantic_decisions ?? [];
      const history = decisions
        .filter((decision) => decision.proposal_ref.reference === proposal.id)
        .sort((left, right) => left.revision - right.revision);
      const previous = history[history.length - 1];
      const recordedAt = this.timestamp();
      const decision: ReviewedSemanticDecision = {
        schema_version: PRODUCTION_SCHEMA_VERSION,
        artifact_kind: 'reviewed_semantic_decision',
        id: `reviewed-semantic-decision.${randomUUID()}`,
        revision: history.length + 1,
        ...(previous
          ? {
              previous_decision: artifactReference(
                'reviewed_semantic_decision',
                previous,
                previous.id,
                previous.schema_version,
              ),
            }
          : {}),
        proposal_ref: artifactReference(
          'semantic_proposal',
          proposal,
          proposal.id,
          proposal.schema_version,
        ),
        fact_refs: boundFacts.map((fact) =>
          artifactReference('qualified_fact', fact, fact.id, fact.schema_version),
        ),
        selected_fact_refs: selectedFacts.map((fact) =>
          artifactReference('qualified_fact', fact, fact.id, fact.schema_version),
        ),
        input_snapshot: reviewedSemanticInputSnapshot({
          intake: preparation.intake,
          source_acquisitions: preparation.source_acquisitions,
          facts: preparation.qualified_facts,
          reconciliation: preparation.reconciliation,
          proposals: preparation.proposals,
        }),
        outcome: request.outcome,
        actor: { kind: 'operator_label', identifier: request.actor_label.trim() },
        recorded_at: recordedAt,
        validation_policy_version: REVIEWED_SEMANTIC_POLICY_VERSION,
        ...(request.outcome === 'map'
          ? {
              target: request.target,
              normalized_value: request.normalized_value,
              ...(request.normalized_unit ? { normalized_unit: request.normalized_unit } : {}),
              ...(request.source_unit ? { source_unit: request.source_unit } : {}),
              rationale: request.rationale,
            }
          : {}),
        ...(request.outcome === 'schema_gap'
          ? { schema_gap: request.schema_gap, rationale: request.rationale }
          : {}),
        ...(request.outcome === 'reject' || request.outcome === 'not_applicable'
          ? { rationale: request.rationale }
          : {}),
        ...(request.outcome === 'evidence_only' || request.outcome === 'unresolved'
          ? request.rationale
            ? { rationale: request.rationale }
            : {}
          : {}),
      };
      const decisionIssues = validateReviewedSemanticDecision(decision);
      if (decisionIssues.length) throw new SemanticDecisionError(400, decisionIssues.join('; '));
      const nextDecisions = [...decisions, decision];
      const bridgeInput = {
        intake: preparation.intake,
        captures: preparation.captures,
        source_acquisitions: preparation.source_acquisitions,
        facts: preparation.qualified_facts,
        reconciliation: preparation.reconciliation,
        proposals: preparation.proposals,
        reviewed_semantic_decisions: nextDecisions,
      };
      let bridge: ReturnType<typeof buildProductionProductCandidate>;
      if (request.outcome === 'map') {
        try {
          bridge = buildProductionProductCandidate(bridgeInput);
        } catch (error) {
          // Map input is accepted only when deterministic replay can normalize retained evidence.
          throw new SemanticDecisionError(
            400,
            error instanceof Error ? error.message : 'Semantic decision is invalid.',
          );
        }
      } else {
        bridge = buildProductionProductCandidate(bridgeInput);
      }
      const review_package = buildProductionReviewPackage({
        intake: preparation.intake,
        ...(preparation.source_resolution
          ? { source_resolution: preparation.source_resolution }
          : {}),
        reconciliation: preparation.reconciliation,
        bridge,
      });
      const changedArtifacts = [decision, review_package];
      const schemaIssues = changedArtifacts.flatMap((artifact) =>
        validateProductionArtifactSchema(artifact).map(
          (issue) => `${artifact.artifact_kind}: ${issue}`,
        ),
      );
      if (schemaIssues.length)
        throw new Error(
          `Rebuilt semantic review artifacts are invalid: ${schemaIssues.join('; ')}`,
        );

      const updated: IngestionJob = {
        ...job,
        preparation: { ...preparation, bridge, review_package },
        updated_at: recordedAt,
      };
      try {
        await this.dependencies.store.save(updated, version);
      } catch (error) {
        if (error instanceof JobStoreConflictError)
          throw new SemanticDecisionError(409, error.message);
        throw error;
      }
      return updated;
    });
  }

  async finalizeJob(
    id: string,
    writeRequest: Omit<CanonicalWriteRequest, 'promotion'>,
    catalogContext?: PromotionCatalogContext,
  ): Promise<IngestionJob> {
    return this.exclusive(id, async () => {
      const { job, version } = await this.readVersionedJob(id);
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
      const finalizingJob: IngestionJob = {
        ...job,
        state: 'finalizing',
        finalization_request,
        updated_at: this.timestamp(),
      };
      const finalizingVersion = await this.dependencies.store.save(finalizingJob, version);
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
          ...finalizingJob,
          state: 'finalization_failed',
          finalization_request,
          updated_at: this.timestamp(),
          error: { operation: 'finalize', message: String(error) },
        };
        await this.dependencies.store.save(updated, finalizingVersion);
        return updated;
      }
      const updated: IngestionJob = {
        ...finalizingJob,
        state: 'finalized',
        finalization_request,
        final_result,
        updated_at: this.timestamp(),
      };
      await this.dependencies.store.save(updated, finalizingVersion);
      return updated;
    });
  }
}
