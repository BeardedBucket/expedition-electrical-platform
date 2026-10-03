# Official source resolution

## Boundary and durable artifacts

Source resolution sits between validated ProductIntake and source acquisition. It uses the existing production artifact schema, SHA-256 references, deterministic snapshots, and checksummed file job store. It introduces no database, search service, or product promotion approval system.

An MPN-only ProductIntake remains URL-less. Candidate submission records a separate versioned `source_resolution` artifact plus its `source_capture` artifact in `source_resolution_attempts`. The resolution binds the original intake digest, exact requested identity, attempt ID, proposed/normalized/final URLs, discovery method, capture reference, retrieval time, domain evidence, bounded observations, diagnostics, disposition, and explicit local operator decision metadata.

The first accepted artifact reference is retained as `accepted_source_resolution`. `active_source_resolution` explicitly identifies the accepted source selected for the current preparation; legacy jobs without that field use their original accepted reference until a recovery cycle is recorded. Accepted/rejected decisions, captures, candidate evidence, and original intake cannot be rewritten through the file store. A pending artifact can acquire a decision; its captured evidence cannot change. Reload validates references, identity, state, and preparation binding. Rejected attempts remain in order when another candidate is submitted.

## State and operator flow

```text
source_resolution_required
  → submit candidate → source_resolution_review
    → reject → source_resolution_required → submit another candidate
    → accept → created → explicit Start preparation → normal preparation result
    → acquisition failure → preparation_failed
      → explicit Choose another official source → source_resolution_required
        → submit candidate → source_resolution_review → explicit accept/reject
```

Neither unresolved state permits preparation. Acceptance is a human source-identity decision and requires a pending attempt with an actual final URL; it does not require a successful capture. The resolution decision and capture result are independent: failed/non-authoritative captures remain visible and unchanged when an operator accepts or rejects the proposed source. Accepting a failed capture confirms identity only; ordinary preparation must acquire and qualify the source again, and a failed/non-authoritative acquisition stops before extraction. A decided attempt cannot be reviewed again. Accepted attempts remain immutable; only the explicit acquisition-failure recovery flow can establish a later accepted attempt as active for preparation.

URL-present intake keeps its existing workflow and does not enter this screen. The source-review screen distinguishes the requested identity, candidate source, domain evidence, identity observations, capture diagnostics, and decision. When capture has failed, the UI makes clear that acceptance records source identity only and that acquisition must still succeed before extraction. Acceptance does not start preparation automatically and does not approve product facts.

After an accepted source later fails at the acquisition seed, a human may explicitly reopen source selection on the same job. The action is eligible only for a durable `preparation_failed` result with `reason: acquisition_failed`, `acquisition.status: seed_failed`, and a currently accepted source; unrelated processing failures and later lifecycle states cannot use it. The recovery event stores the previous accepted-source reference and the complete failed preparation result before clearing the current preparation and active-source pointer. All previous resolution and capture artifacts remain append-only. Choosing another source is not retroactive rejection or invalidation of the earlier source decision: the new URI must go through ordinary candidate capture and a separate human accept/reject decision. Only the newly accepted source becomes active for a later preparation, and acquisition must succeed before extraction. The recovery request is serialized through the normal per-job lock and expected-version compare-and-swap save; stale or replayed requests conflict.

## Capture, officiality, and identity evidence

Candidate submission uses the existing HTTP(S) URI validation and production capture machinery. The HTTP adapter continues to enforce private-network/DNS and redirect safety checks. No guessed URL, third-party search, manufacturer search strategy, crawler, or automatic acceptance is implemented.

Domain evidence distinguishes:

- `profile_supported`: a reviewed profile for the requested manufacturer supports both requested and captured final domains; publisher and profile configuration digest are retained.
- `no_reviewed_profile`: operator-proposed source without reviewed-domain corroboration; no publisher or profile verification is invented.
- `outside_reviewed_domains`: reviewed profile exists but requested/final URL is outside its approved official domains. Capture can supply evidence for human inspection, but acceptance does not override acquisition policy.
- `final_domain_unobserved`: requested domain has reviewed support, but capture supplied no final URL. Missing redirect/final evidence is unknown rather than an off-domain assertion.

Human acceptance confirms source identity intent. Production acquisition separately rechecks current domain policy, redirect officiality, content quality, and expected content. An accepted off-domain candidate can therefore produce `preparation_failed` with `unresolved_officiality`. Missing publisher evidence remains missing in the candidate bridge; it is not replaced with the intake manufacturer. This preserves existing qualification and authority semantics.

Existing document extraction supplies the title, headings, and source locators. Exact manufacturer/model/MPN occurrences use case-sensitive boundaries and preserve the requested spelling. Substrings, prefixes, suffixes, case differences, nearest text, and mere occurrence do not establish product identity or trigger acceptance. No confidence score/tier is added. At most 30 observations and 30 diagnostics are stored per attempt. The operator DTO shows at most the latest 50 attempts and reports truncation while the durable record retains complete history. It excludes captured body/bytes, entire extraction blocks, internal provenance, and snapshot filesystem locations.

## Preparation and review binding

`ProductionIngestWorkflowRequest` and `SourceAcquisitionRequest` accept `source_resolution` explicitly. Acquisition uses its accepted final URI as the seed, without deriving/replacing ProductIntake. The acquisition artifact references the accepted resolution and includes that reference in its deterministic snapshot.

Each durable preparation result retains the original intake, the source selected for that attempt, and actual acquisition captures. Recovery history retains complete acquisition-failed preparation results across a later attempt. ReviewPackage references the active resolution; its digest participates in both review-package identity and semantic snapshot. Existing approval matching therefore rejects decisions for a different resolution even when product values are identical. Finalization verifies resolution, acquisition references, and a rebuilt exact review package before entering the existing promotion/writer path.

## Local API

- `POST /api/ingestion/jobs/:id/source-resolution/candidates` with `{ "official_product_uri": "https://…" }`.
- `POST /api/ingestion/jobs/:id/source-resolution/accept` with `{ "attempt_id": "…" }`.
- `POST /api/ingestion/jobs/:id/source-resolution/reject` with `{ "attempt_id": "…" }`.
- `POST /api/ingestion/jobs/:id/source-resolution/reopen` with an empty JSON object after an eligible acquisition failure.
- Normal GET job detail includes the bounded `source_resolution` section.

Invalid inputs return 400, unknown jobs return 404, invalid state/stale attempt operations return 409, and unexpected failures retain the existing sanitized/logged 500 behavior. Existing local origin and request-size checks apply. No rationale field was introduced because this API has no existing generic source-review note pattern. Review metadata records the local operator method and timestamp; it makes no authenticated-person claim.

## Future discovery

`captureSourceResolutionCandidate` is the capture/evidence boundary; discovery method is recorded separately from disposition/review. A future provider can add a discovery method and supply candidates to the same artifact/review lifecycle. No speculative provider interface or provider selection policy was added.
