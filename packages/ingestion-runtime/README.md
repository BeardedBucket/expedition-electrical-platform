# Ingestion job runtime

This Node-only package persists the existing production preparation result in a versioned job record. The record includes the full result, including captured source bytes and diagnostics. Runtime adapters, manufacturer profiles, capture policy, and clocks are supplied through `IngestionRuntimeDependencies`; they are not saved in a job. A later API adapter can call `createJob`, `prepareJob`, `getJob`, `submitApproval`, and `finalizeJob`.

`FileIngestionJobStore` takes an explicit storage root. Each record is checksum-checked and replaced through a temporary file and rename. Finalization passes the stored review-ready result and submitted approval to the existing finalizer. The caller must still supply the canonical write request, including `write: true` for a write.

Every submitted `ProductionApproval` is validated and bound to the exact stored review package and semantic snapshot. Approved decisions also pass through the existing promotion-review conversion and transition to `approved`. Rejected and deferred decisions transition to terminal `review_rejected` and `review_deferred` states, including when preparation has no candidate; neither state permits finalization.

Operations are serialized per job within one service instance. This initial store has no cross-process claim or lease. A process interrupted during preparation leaves a `preparing` record; interruption during finalization leaves a `finalizing` record. Neither state is automatically retried, because a finalization may already have written a canonical file. An operator workflow needs an explicit recovery procedure before enabling multiple workers or automatic retries.

Before invoking the finalizer, the job persists `finalization_request` with `requested_at`, the exact `write_request` (including write authorization and destination), and `catalog_context` when supplied. This attempt remains present in `finalizing`, `finalized`, and `finalization_failed` records as evidence for later operator reconciliation. Non-serializable attempt data is rejected before changing state or invoking the finalizer.
