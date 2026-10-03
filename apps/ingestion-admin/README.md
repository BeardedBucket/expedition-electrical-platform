# Local ingestion admin

## Resumable Defer checkpoint

**Defer = pause**, not terminal closure or rejection of valid evidence. A new
deferral requires a reviewer label, human rationale, and current lifecycle
snapshot. The optional reason classification is explicitly selected by the
operator; no diagnostic chooses it. The child enters `review_deferred` and keeps
the entire reviewed preparation, source decisions, candidate if present, and
semantic history. No write or automatic preparation occurs.

**Resume deferred review** is an explicit, confirmed child-job action. It requires
an operator label and current lifecycle snapshot; `POST /review/resume` appends
history and returns the same child to `review_ready` without rebuilding anything.
The complete earlier defer decision/rationale remains visible in pause/resume
history. Reload after a stale snapshot or CAS conflict.

After a later capability change, a resumed review may separately use **Archive
reviewed preparation for explicit re-preparation**. This preserves the complete
old result and semantic decisions in preparation history and returns to `created`.
**Start preparation** is separate, uses the accepted source, and produces a new
review. Old schema-gap decisions are historical, never automatically remapped by
new code or schema support.

**Reject = terminal non-promotion decision**. Neither rejected nor finalized jobs
can use resume. Batch preparation skips deferred children and has no review
decision or resume authority.

This separate maintainer workspace uses React/Vite for the browser and Node's built-in HTTP server for the API. The configurator remains separate. Node-only ingestion code runs through `IngestionJobService` and `FileIngestionJobStore`; the browser imports only erased DTO types. No new framework or database is required.

From the repository root, run:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run start:ingestion-api
```

In another terminal:

```powershell
npm.cmd run dev:ingestion-admin
```

Open <http://127.0.0.1:5174>. Keep the API terminal running during preparation. Vite proxies `/api/ingestion` to the local API, so browser requests use the same origin. The production browser build lives under `dist/browser`; the compiled API lives under `dist/server`. This slice provides a local development application, without public deployment or authentication.

## Configuration

Environment variables are explicit; no secrets are required. Set them in the terminal before starting the relevant process.

| Variable                    | Default                                                   | Purpose                                                             |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| `INGESTION_REPOSITORY_ROOT` | Repository root relative to npm's workspace cwd (`../..`) | Locate versioned manufacturer profiles                              |
| `INGESTION_JOB_ROOT`        | `<repository>/.local-ingestion/jobs`                      | Durable local jobs, ignored by Git                                  |
| `INGESTION_BATCH_ROOT`      | `<repository>/.local-ingestion/batches`                   | Durable batch membership; must be separate from the job root         |
| `INGESTION_CANONICAL_ROOT`  | `<repository>/data/components`                            | Destination for a separately confirmed canonical finalization write |
| `INGESTION_API_HOST`        | `127.0.0.1`                                               | API bind address; keep local                                        |
| `INGESTION_API_PORT`        | `4318`                                                    | API port; also set in the Vite terminal when overridden             |

The API loads and validates the existing JSON files in `data/ingestion/manufacturer-acquisition-profiles`, passing only reviewed profiles to the supported acquisition resolver. Unknown manufacturers retain the library's generic discovery and officiality behavior. `HttpSourceCaptureAdapter` performs real HTTP capture, retaining its existing network controls. There is no product-specific behavior.

The app's production policy sets `max_recursion_depth: 1`, `max_discovered_candidates: 50`, and `max_captured_candidates: 20`. Depth 1 enables discovery from captured links in this operator workflow; library defaults are unchanged. Retention is `not_retained`: the app creates no separate source snapshot assets, but the existing job runtime durably stores full preparation evidence. Keep that local job directory private; it is not a redistributable corpus.

These are bounded local acquisition operating choices, not engineering or source-trust
thresholds. The candidate counts limit discovery and network work independently;
they do not promise complete manufacturer coverage. No stronger measured sizing
basis is recorded. Reconsider them only with representative acquisition/resource
evidence, not to force an individual product to qualify.

The `INGESTION_ADMIN_ORIGIN` setting defaults to `http://127.0.0.1:5174`. It is the exact allowed browser origin through the Vite proxy, which can change the API Host header. Other origins must match the API host. Cross-site browser requests remain rejected.

## HTTP boundary

| Route                                                       | Input                                                                                                                                                | Response                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST /api/ingestion/jobs`                                  | JSON with required `manufacturer`, `product_model` and at least one of `manufacturer_part_number`, `official_product_uri` (supplied values nonempty) | 201 operator detail DTO, state `created` or `source_resolution_required`          |
| `POST /api/ingestion/jobs/:id/prepare`                      | No body                                                                                                                                              | 200 operator detail DTO after preparation completes, including persisted failures |
| `GET /api/ingestion/jobs/:id`                               | UUID job ID                                                                                                                                          | 200 operator detail DTO                                                           |
| `GET /api/ingestion/jobs`                                   | None                                                                                                                                                 | `{ jobs: OperatorJobSummary[] }`, latest updated first; ID ascending breaks ties  |
| `POST /api/ingestion/batches`                               | Non-empty array of 1–50 ordinary product-intake identity records                                                                                     | 201 `{ summary, job_ids }`                                                        |
| `GET /api/ingestion/batches`                                | None                                                                                                                                                 | `{ batches: BatchSummary[] }`                                                     |
| `GET /api/ingestion/batches/:id`                            | UUID batch ID                                                                                                                                        | 200 `{ summary, job_ids }`                                                        |
| `POST /api/ingestion/batches/:id/prepare`                   | No body                                                                                                                                              | 200 refreshed `{ summary, job_ids }`                                              |
| `POST /api/ingestion/jobs/:id/review/approve`               | Explicit reviewer label and selected promotion decisions                                                                                             | 200 operator detail DTO after human approval                                      |
| `POST /api/ingestion/jobs/:id/review/reject`                | Explicit reviewer label                                                                                                                              | 200 operator detail DTO after rejection                                           |
| `POST /api/ingestion/jobs/:id/review/defer`                 | Reviewer label, nonempty reviewed_decisions rationale, expected_lifecycle_snapshot, optional defer_reason                                              | 200 DTO in paused review_deferred state |
| `POST /api/ingestion/jobs/:id/review/resume`                | expected_lifecycle_snapshot and actor_label only                                                                                                      | 200 DTO for same preserved review_ready child |
| `POST /api/ingestion/jobs/:id/finalize`                     | Explicit `{ write: true }` after approval                                                                                                            | 200 operator detail DTO with promotion and canonical write result                 |
| `POST /api/ingestion/jobs/:id/source-resolution/candidates` | Proposed official product URL                                                                                                                        | Captured source resolution attempt                                                |
| `POST /api/ingestion/jobs/:id/source-resolution/accept`     | Explicit attempt ID                                                                                                                                  | Accepted source identity, with product evidence still unreviewed                  |
| `POST /api/ingestion/jobs/:id/source-resolution/reject`     | Explicit attempt ID                                                                                                                                  | Rejected source identity attempt                                                  |
| `POST /api/ingestion/jobs/:id/source-resolution/reopen`     | Empty JSON object; eligible only after accepted-source acquisition failure                                                                           | Same job reopens source selection; prior decision and failed preparation remain in history |

The server constructs a versioned `ProductIntake` with `intake.<random UUID>` as a convenience intake ID. It does not derive canonical product identity from this ID. Existing runtime intake validation remains authoritative; source URI and officiality handling stay in acquisition/capture.

Shape/JSON/intake errors return 400; malformed job IDs return 400; unknown jobs return 404; unsupported methods return 405; conflicting lifecycle states return 409; oversized bodies return 413; unsupported content types return 415. Unexpected failures return a generic 500 without a stack trace. Cross-site browser requests and mismatched origins return 403. There is no raw source content route.

`server/operator-views.ts` explicitly projects the durable record into operator DTOs. Summaries include identity, timestamps, state, and artifact-backed counts/statuses. Detail adds intake, acquisition counts/issues, source metadata, extraction counts/capability/remediation, qualification, facts, reconciliation groups, proposals, candidate fields/evidence, review package references/counts/snapshot, human decision and finalization summaries, and terminal diagnostics. Its `pipeline_summary` counts actual persisted capture dispositions, extraction results and retained blocks, QualifiedFacts, reconciliation groups/outcomes, proposal dispositions, and candidate field evidence. A retained block is extracted structure, not a QualifiedFact. Capture, extraction, qualification, semantic mapping, candidate projection, and human approval remain distinct stages. Source bodies, byte arrays, and extracted block text/tables are excluded; allowlisted source evidence and locators for reviewable proposals remain available in the human review DTO. Missing information remains absent in JSON and displays as unknown; known zero and false values remain visible.

Listing extends the store abstraction with optional `listJobIds`; the file store ignores non-record entries and the service loads every listed record through normal checksum/schema validation. Corrupt records fail visibly rather than disappearing from the list.

## Operator flow and persistence

Add Product requires all four fields. Create & Prepare first persists the job, navigates to `#/jobs/<id>`, then submits preparation. The job page polls created/preparing jobs once per second without invented progress. Terminal results stop polling. A created job can be prepared from its job page. Refresh job retries retrieval after a connection error. Recent jobs provides durable links and counts.

When an accepted source fails during acquisition, Sources exposes **Choose another official source** only for the durable acquisition-failure classification. That action preserves the prior accepted decision, capture, and full failed preparation result, then opens the ordinary candidate capture and explicit human source-decision flow on the same job. It neither rejects the prior source nor chooses, accepts, or retries a replacement. See [Official source resolution](../../docs/OFFICIAL_SOURCE_RESOLUTION.md) for the lifecycle and eligibility contract.

After an extraction capability correction, **Reopen empty preparation** is a
separate operator action for a `review_ready` result with zero QualifiedFacts,
zero proposals, no candidate or semantic decisions, and no approval/finalization.
`POST /api/ingestion/jobs/:id/preparation/reopen` requires only
`{ "expected_review_snapshot": "sha256:..." }` from the displayed result. A stale
snapshot or ineligible/replayed transition returns 409. The complete previous
preparation is preserved in append-only history; the accepted source and same
job/batch membership remain unchanged. The UI displays prior preparation
summaries without exposing captured bytes. Reopening returns to `created` and
does not recapture automatically: **Start preparation** remains a separate human
action. Do not reopen merely to retry unchanged unsupported extraction.

An explicitly resumed review also exposes the same archival endpoint, requiring
both `expected_review_snapshot` and `expected_lifecycle_snapshot`. This separate
eligibility permits preserving a populated, human-adjudicated review after a
defer/resume cycle. Complete prior semantic decisions remain in the archived
preparation; they are never applied automatically to a new preparation.

The job page defaults to **Overview**: product and job identity, preparation status, persisted pipeline stage counts, fields eligible for selection, unresolved count, and the next action. **Reviewable fields** contains explicit human selections; proposal source evidence and locators expand on demand. **Unresolved** lists unsupported or unresolved proposals, candidate non-projection reasons, and review package issues. **Evidence / facts** retains extraction and qualification outcomes, QualifiedFacts, reconciliation groups, all proposals, candidate projection, and the review package. **Sources** shows acquisition attempts and capture dispositions, plus official source resolution when needed. **Diagnostics** shows terminal runtime diagnostics. Switching sections does not discard in-progress human selections. `not_attempted`, duplicate selection, unsupported extraction, no qualifiable facts, and qualified evidence remain distinct.

Facts can be recovered while no semantic proposal reaches projection. An unsupported proposal means the current semantic mapper did not produce a canonical value; it does not prove the source assertion false. An absent value stays unknown, not zero or unsupported. A candidate field is only a provisional placement backed by source evidence. Human approval explicitly selects fields or qualified assertions and records a decision; it does not write a canonical component. Finalization is a separate, confirmed action available only after approval. Rejection and deferral remain explicit human decisions and do not promote sparse evidence.

Completed jobs can be retrieved after browser or API restart. Run one API process per job directory: service operations are serialized per job only within that process, while the file-store lock protects conditional record replacement rather than leasing the whole operation. If a process stops during preparation or finalization, the durable job can remain `preparing` or `finalizing`; neither state is automatically resumed, reset, or retried. Inspect the job and API diagnostics before deciding what to do. In particular, inspect `finalization_request` and the configured canonical destination before treating an interrupted finalization as unwritten.

## Local API terminal diagnostics

Each response includes a server-generated `X-Request-Id`. Unexpected HTTP 500s keep the generic browser JSON message and emit a structured JSON line through `console.error` to stderr with timestamp, request ID, method, pathname (without query), operation, job ID when present, and standard Error name/message/stack. Error causes are restricted to four additional levels, with each cause name/message limited to 2,000 characters and stack to 8,000 characters; cycles and arbitrary non-Error objects are represented by omission markers. Custom exception properties, request bodies, durable jobs, source bodies/bytes, and approval records are never serialized by the logger.

A validated prepare request emits `PREPARE REQUEST START`, followed by exactly one `PREPARE REQUEST COMPLETE` (returned durable state and elapsed milliseconds) or `PREPARE REQUEST FAILED` (elapsed milliseconds and error). A returned `preparation_failed` job is a completed HTTP/runtime request and logs COMPLETE with that state. Unexpected prepare failures carry full standard Error diagnostics; expected 4xx prepare failures carry only a concise message without a stack. Other unexpected 500s emit `REQUEST FAILED`; other expected 4xx errors are not logged.

To reproduce after review, start the API in a visible terminal, start Vite in another terminal, open `http://127.0.0.1:5174`, and submit the same four product fields through Add Product. In browser developer tools, inspect the prepare response's `X-Request-Id`, and match it to the API terminal START and terminal event. If the failure recurs, the FAILED event identifies the actual exception and causes while the browser retains the sanitized message. Record the job ID/state before retrying; do not infer a cause from a later successful request.

## Validation tests

From the repository root:

```powershell
npm.cmd test -- --run apps/ingestion-admin/tests/api.test.ts apps/ingestion-admin/src/App.test.tsx
```

API tests use the real durable runtime and production pipeline with a deterministic synthetic capture adapter, never live manufacturer requests. They cover both candidate outcomes, reload through a fresh service, raw-evidence exclusion, errors, profile configuration, and deterministic listing. Frontend tests inject mocked API responses. No canonical corpus data is needed for these tests.

Canonical intake suggestions are served at `GET /api/ingestion/suggestions` from validated reviewed manufacturer profiles and tracked verified component records. Free entry remains allowed. Model/MPN suggestions are scoped to exact manufacturer/model identity; unreviewed jobs are never a suggestion source.

MPN-only intake is persisted awaiting official source resolution and cannot prepare evidence yet. See [the identity audit](../../docs/FLEXIBLE_PRODUCT_IDENTITY_AUDIT.md) for the resolver architecture boundary and validation contract.

Suggestion loading is lazy and isolated to its endpoint. A loading failure returns HTTP 503 with a safe unavailable message; job routes remain usable through free entry. Each later suggestion request can retry. Failed loading never returns an authoritative empty list.

## Batch operator workflow

The Batches navigation uses the existing batch API to create one durable group from 1–50 ordinary product-intake records, list persisted batches, inspect server-provided timestamps/state/counts and ordered child states, and prepare eligible children. The form reuses the same four operator identity fields and validation requirements as Add Product; the server constructs the versioned `ProductIntake` records. It rejects an invalid size or missing product identity rather than truncating or silently dropping an entry.

A batch is only an orchestration/grouping layer: its children remain the authoritative individual jobs. Prepare invokes the existing child preparation flow; it neither approves nor finalizes children, writes canonical data, nor retries failed or reviewed children. Mixed child outcomes and exact lifecycle states stay visible, and each child links to its existing job review route. Approval, rejection, defer, and finalization remain available only in the individual job workflow.

## Maintainer/operator runbook

### Single-product workflow

1. Start the API and browser UI as described above. Keep both bound to loopback; this local maintainer app does not provide authentication or public deployment.
2. In **Add Product**, enter the manufacturer, exact product model, and either an official product URI or an MPN. Create & Prepare persists the intake before preparation. MPN-only jobs require source resolution; see [official source resolution](../../docs/OFFICIAL_SOURCE_RESOLUTION.md). Review the requested and final URI, domain evidence, exact identity observations, and capture result before accepting a source. Accepting a source confirms source-identity intent only; it does not verify product facts or start preparation.
3. On the job page, inspect each pipeline stage independently: acquisition/capture dispositions; extraction status, media, and diagnostics; QualifiedFacts and applicability; reconciliation groups; semantic proposals; candidate projection; and the review package. `review_ready` means the review package exists, not that a candidate is promotable. A captured block is not a QualifiedFact, a QualifiedFact is not a semantic mapping, and an automatic mapping is not product approval.
4. Complete every required semantic disposition in the **REVIEW REQUIRED** group before approval. Inspect retained source wording, provenance, and locators. Mapping targets come from the server; use its preview to compare the source assertion and unit with the normalized canonical value. The browser does not compute mappings. `evidence_only`, `schema_gap`, `reject`, `not_applicable`, and `unresolved` are explicit human dispositions; `unresolved` satisfies review accountability but remains unresolved and projects no canonical fact. Automatic mappings remain visible and can be corrected through the same decision flow. Every correction appends a revision; it does not edit prior history. See [human review and guarded finalization](../../docs/HUMAN_PRODUCT_REVIEW.md) and [semantic vocabulary](../../docs/INGESTION_SEMANTIC_VOCABULARY.md).
5. Approve only an available candidate, selecting the fields or qualified assertions supported by reviewed evidence and supplying the required role, category, reviewer label, and evidence acknowledgement. A job without a candidate cannot be approved; defer or reject it instead. Semantic review completion is server-authoritative and bound to the current review snapshot.
6. Finalization is a separate, explicit, one-shot action. The API accepts only `write: true`; the browser cannot choose the destination. The guarded writer checks the canonical ID/filename, path containment, catalog identity and filename collisions, component schema, and exclusive create. It never overwrites. A collision, blocked promotion, or invalid proposal is still a terminal finalization result; there is no dry-run/retry route through the job lifecycle.
7. Validate and load the resulting component. For the normal repository catalog, `npm.cmd run validate:data` validates the complete repository data tree. For an isolated destination, use the writer's `schema_valid` result and load the exact created file with `loadComponentLibraryFile(filePath)` from `@expedition/engineering-core`; `loadCanonicalCatalog(destinationRoot)` is a parse-only catalog reader, not a substitute for schema validation.

### Batch workflow

Create a batch from ordinary intake records in **Batches**, inspect its ordered child IDs, then use **Prepare** once to prepare children still in `created`. Read the child state for each outcome; the coarse batch state is a summary and mixed child states remain distinct. Open each child and perform its own source resolution, semantic review, approval/rejection/deferral, and finalization through the single-job workflow above. The batch has no semantic, approval, finalization, canonical-write, or retry authority. Batch metadata and child jobs persist separately; after restart, reload the batch to reconstruct its summary from the current child records. See [batch backend contract](../../docs/BATCH_INGEST_BACKEND.md) and [batch API](../../docs/BATCH_INGEST_ADMIN_API.md).

### Failure, stale review, and lock recovery

Do not collapse failures from different stages into a single “bad product” result:

| Observation | Meaning and operator response |
| --- | --- |
| Capture failed or was non-authoritative | Inspect the requested/final URI, HTTP status, redirect/officiality evidence, and capture diagnostics. A transport failure is not an extraction or semantic failure. |
| Extraction unsupported/partial/failed | Inspect media type and extraction diagnostics. PDF text extraction does not imply table/layout qualification; unsupported structure is not a product specification. |
| No or sparse QualifiedFacts | Treat this as acquisition/extraction/qualification or identity/applicability evidence, not as a semantic adjudication success. Do not manufacture facts to continue. |
| Reconciliation conflict or unresolved applicability | Inspect the exact source facts and applicability. Conflicting evidence stays visible; do not choose a winner automatically. |
| Unsupported/unresolved semantic proposal | Use the human semantic workflow only when the retained assertion and provenance support a meaningful disposition. A `schema_gap` is not evidence that the product has a particular value. |
| HTTP 409 stale review | Reload the job, inspect the current evidence and review snapshot, and reconfirm intent. Never replay a previous payload against a changed snapshot. |
| `preparation_failed` / `finalization_failed` | Read the durable job and API request diagnostics. Do not reset or retry the job automatically. Finalization may have written a file before an interruption or error. |

Each file-store save uses an exclusive per-job `.<job-id>.lock` around the durable compare-and-swap and replacement. The lock has no expiry and is never stolen automatically. If a process crashes while holding it, first verify that every writer for this job store is stopped. Inspect the job record and, for a finalization, the recorded request and configured destination. Only after verifying the writer is dead may an operator manually remove that exact orphan lock so a later conditional save can proceed. Never remove a live writer's lock, delete a durable job to clear an error, or retry `preparing`/`finalizing` by editing JSON or calling private runtime methods. The API has no reset/retry endpoint for interrupted `preparing` or `finalizing` operations. The explicit source-selection, reviewed-preparation archival, and deferred-review resume endpoints described above are separate, eligibility-checked child transitions, not interrupted-operation recovery.

The application defaults `INGESTION_CANONICAL_ROOT` to `data/components`. For acceptance or writer testing, point it to a new disposable directory **before starting the API** and verify that the API startup log reports that exact destination. The writer still performs the real create-only, containment, collision, and schema checks there. Do not test a write against the real catalog or overwrite an existing component.
