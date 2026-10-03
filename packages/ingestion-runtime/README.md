# Ingestion job runtime

This Node-only package persists the production preparation result in a versioned job record. The record includes the full result, including captured source bytes and diagnostics. Runtime adapters, manufacturer profiles, capture policy, and clocks are supplied through `IngestionRuntimeDependencies`; they are not saved in a job. The ingestion-admin API uses `IngestionJobService` for the ordinary lifecycle and `IngestionBatchService` as a facade for child-job operations, semantic target discovery/preview, and semantic decisions.

`FileIngestionJobStore` takes an explicit storage root. Each record is checksum-checked and replaced through a temporary file and rename. Saves use an exclusive per-job lock around version comparison and replacement; the lock is not an operation lease. Finalization passes the stored review-ready result and submitted approval to the existing finalizer. The caller must still supply the canonical write request, including `write: true` for a write.

Only the final rename replacement retries transient `EPERM`, `EACCES`, or `EBUSY` contention: at most five attempts, separated by deterministic delays of 25, 50, 100, and 150 ms (325 ms total wait). The synced, closed temporary file is reused. The destination is never deleted or truncated before replacement, so the previous complete durable record remains available until a rename succeeds. Non-retryable errors propagate immediately; retry exhaustion propagates the final filesystem error through the existing API diagnostics, with temporary-file cleanup still attempted. Initial creation continues to use exclusive `wx` without replacement retries. The observed transient Windows error does not establish which external process caused the contention.

Every submitted `ProductionApproval` is validated and bound to the exact stored review package and semantic snapshot. Approved decisions also pass through the existing promotion-review conversion and transition to `approved`. Rejection moves to terminal `review_rejected`. Deferral moves to paused, explicitly resumable `review_deferred`, including when preparation has no candidate; neither state permits finalization.

Deferral requires a human rationale, a current `expected_lifecycle_snapshot`, and
optionally an operator-selected reason (`schema_gap`, `source_follow_up`,
`evidence_follow_up`, `operator_pause`, or `other`). The bound decision is appended
to `product_review_history` with a revision; no reason is inferred. Explicit
`resumeDeferredReview` requires the current lifecycle snapshot and an operator
label. It appends a resume event, removes only the current deferred decision
pointer (the full decision remains historical), and returns the same job to
`review_ready`. Evidence, candidate, semantic decisions, and their interpretation
remain byte-for-byte preserved. Code/schema changes never automatically resume
or reinterpret a paused review. Legacy deferred records preserve their exact
decision as the first historical event on explicit resume; missing rationale
or classification is not invented. These labels are not authenticated identities.

An explicit `reopenPreparation(id, expectedReviewSnapshot)` can recover an empty
`review_ready` result after a capability correction. Eligibility requires zero
QualifiedFacts, zero proposals, no candidate or semantic decisions, and no
approval/finalization. Populated or human-adjudicated reviews have a separate,
one-use continuation: after explicit resume, `reopenPreparation` may archive that
exact preserved review when both its review and lifecycle snapshots match. The
resume event binds the preparation-history count, preventing reuse after a later
preparation. The exact
review snapshot guards stale UI requests; the normal per-job serialization and
store CAS guard concurrent requests. The complete prior result is appended to
`preparation_recovery_history` before the current preparation is cleared and the
same job becomes `created`. Accepted source decisions and active source selection
are unchanged. No capture starts until a separate explicit preparation request.
Store validation enforces append-only history and binds each recovery to the
previous eligible result. Semantic history is append-only across archived and
current preparations: old schema-gap decisions stay in their original reviewed
revision, rather than being replayed under changed rules. A separate preparation
produces a new review needing fresh human dispositions. Replay in `created` conflicts; later empty attempts may be
reopened separately without deleting earlier results.

Operations are serialized per job within one service instance. The file lock protects cross-process compare-and-swap saves, but there is no cross-process claim or lease for the complete operation; production composition should run one API process per job directory. A process interrupted during preparation leaves a `preparing` record; interruption during finalization leaves a `finalizing` record. Neither state is automatically retried, because a finalization may already have written a canonical file. An operator must inspect the durable state and any finalization destination before recovery.

Before invoking the finalizer, the job persists `finalization_request` with `requested_at`, the exact `write_request` (including write authorization and destination), and `catalog_context` when supplied. This attempt remains present in `finalizing`, `finalized`, and `finalization_failed` records as evidence for later operator reconciliation. Non-serializable attempt data is rejected before changing state or invoking the finalizer.

The per-job lock has no expiry or automatic stealing. A crash can leave its lock file behind; an operator must verify that all writers for the job store are stopped before manually removing that exact orphan lock. Never clear it to force a live or uncertain writer to proceed, and never edit the durable job JSON to reset a lifecycle state. See the [ingestion-admin runbook](../../apps/ingestion-admin/README.md#maintaineroperator-runbook).
