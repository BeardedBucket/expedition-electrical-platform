# Official source resolution

## Boundary and durable artifacts

Source resolution sits between validated ProductIntake and source acquisition. It uses the existing production artifact schema, SHA-256 references, deterministic snapshots, and checksummed file job store. It introduces no database, search service, or product promotion approval system.

An MPN-only ProductIntake remains URL-less. Candidate submission records a separate versioned `source_resolution` artifact plus its `source_capture` artifact in `source_resolution_attempts`. The resolution binds the original intake digest, exact requested identity, attempt ID, proposed/normalized/final URLs, discovery method, capture reference, retrieval time, domain evidence, bounded observations, diagnostics, disposition, and explicit local operator decision metadata.

The accepted artifact reference is stored separately as `accepted_source_resolution`. Accepted/rejected decisions, captures, candidate evidence, and original intake cannot be rewritten through the file store. A pending artifact can acquire a decision; its captured evidence cannot change. Reload validates references, identity, state, and preparation binding. Rejected attempts remain in order when another candidate is submitted.

## State and operator flow

```text
source_resolution_required
  → submit candidate → source_resolution_review
    → reject → source_resolution_required → submit another candidate
    → accept → created → explicit Start preparation → normal preparation result
```

Neither unresolved state permits preparation. Acceptance requires an authoritative capture with an actual final URL. Failed/non-authoritative captures remain reviewable and rejectable. A decided attempt cannot be reviewed again. Accepted sources cannot be replaced in this slice, so stale downstream approvals cannot survive a replacement operation.

URL-present intake keeps its existing workflow and does not enter this screen. The source-review screen distinguishes the requested identity, candidate source, domain evidence, identity observations, capture diagnostics, and decision. Acceptance does not start preparation automatically and does not approve product facts.

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

The durable preparation result retains the original intake, accepted resolution, and actual acquisition captures. ReviewPackage references the resolution; its digest participates in both review-package identity and semantic snapshot. Existing approval matching therefore rejects decisions for a different resolution even when product values are identical. Finalization verifies resolution, acquisition references, and a rebuilt exact review package before entering the existing promotion/writer path.

## Local API

- `POST /api/ingestion/jobs/:id/source-resolution/candidates` with `{ "official_product_uri": "https://…" }`.
- `POST /api/ingestion/jobs/:id/source-resolution/accept` with `{ "attempt_id": "…" }`.
- `POST /api/ingestion/jobs/:id/source-resolution/reject` with `{ "attempt_id": "…" }`.
- Normal GET job detail includes the bounded `source_resolution` section.

Invalid inputs return 400, unknown jobs return 404, invalid state/stale attempt operations return 409, and unexpected failures retain the existing sanitized/logged 500 behavior. Existing local origin and request-size checks apply. No rationale field was introduced because this API has no existing generic source-review note pattern. Review metadata records the local operator method and timestamp; it makes no authenticated-person claim.

## Future discovery

`captureSourceResolutionCandidate` is the capture/evidence boundary; discovery method is recorded separately from disposition/review. A future provider can add a discovery method and supply candidates to the same artifact/review lifecycle. No speculative provider interface or provider selection policy was added.
