# Local ingestion admin

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

| Variable                    | Default                                                   | Purpose                                                                    |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `INGESTION_REPOSITORY_ROOT` | Repository root relative to npm's workspace cwd (`../..`) | Locate versioned manufacturer profiles                                     |
| `INGESTION_JOB_ROOT`        | `<repository>/.local-ingestion/jobs`                      | Durable local jobs, ignored by Git                                         |
| `INGESTION_CANONICAL_ROOT`  | `<repository>/data/components`                            | Reserved destination for the next slice; never read or written by this app |
| `INGESTION_API_HOST`        | `127.0.0.1`                                               | API bind address; keep local                                               |
| `INGESTION_API_PORT`        | `4318`                                                    | API port; also set in the Vite terminal when overridden                    |

The API loads and validates the existing JSON files in `data/ingestion/manufacturer-acquisition-profiles`, passing only reviewed profiles to the supported acquisition resolver. Unknown manufacturers retain the library's generic discovery and officiality behavior. `HttpSourceCaptureAdapter` performs real HTTP capture, retaining its existing network controls. There is no product-specific behavior.

The app's production policy sets `max_recursion_depth: 1`, `max_discovered_candidates: 50`, and `max_captured_candidates: 20`. Depth 1 enables discovery from captured links in this operator workflow; library defaults are unchanged. Retention is `not_retained`: the app creates no separate source snapshot assets, but the existing job runtime durably stores full preparation evidence. Keep that local job directory private; it is not a redistributable corpus.

The `INGESTION_ADMIN_ORIGIN` setting defaults to `http://127.0.0.1:5174`. It is the exact allowed browser origin through the Vite proxy, which can change the API Host header. Other origins must match the API host. Cross-site browser requests remain rejected.

## HTTP boundary

| Route                                  | Input                                                                                                                    | Response                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `POST /api/ingestion/jobs`             | JSON with exactly `manufacturer`, `product_model`, `manufacturer_part_number`, `official_product_uri` (nonempty strings) | 201 operator detail DTO, state `created`                                          |
| `POST /api/ingestion/jobs/:id/prepare` | No body                                                                                                                  | 200 operator detail DTO after preparation completes, including persisted failures |
| `GET /api/ingestion/jobs/:id`          | UUID job ID                                                                                                              | 200 operator detail DTO                                                           |
| `GET /api/ingestion/jobs`              | None                                                                                                                     | `{ jobs: OperatorJobSummary[] }`, latest updated first; ID ascending breaks ties  |

The server constructs a versioned `ProductIntake` with `intake.<random UUID>` as a convenience intake ID. It does not derive canonical product identity from this ID. Existing runtime intake validation remains authoritative; source URI and officiality handling stay in acquisition/capture.

Shape/JSON/intake errors return 400; malformed job IDs return 400; unknown jobs return 404; unsupported methods return 405; conflicting preparation states return 409; oversized bodies return 413; unsupported content types return 415. Unexpected failures return a generic 500 without a stack trace. Cross-site browser requests and mismatched origins return 403. There are no approval, rejection, defer, finalization, or raw source content routes.

`server/operator-views.ts` explicitly projects the durable record into operator DTOs. Summaries include identity, timestamps, state, and artifact-backed counts/statuses. Detail adds intake, acquisition counts/issues, source metadata, extraction counts/capability/remediation, qualification, facts, reconciliation groups, proposals, candidate fields/evidence, review package references/counts/snapshot, and terminal diagnostics. Source bodies, byte arrays, extracted block text/tables, raw provenance, approval records, and finalization requests are excluded. Missing information remains absent in JSON and displays as unknown; known zero and false values remain visible.

Listing extends the store abstraction with optional `listJobIds`; the file store ignores non-record entries and the service loads every listed record through normal checksum/schema validation. Corrupt records fail visibly rather than disappearing from the list.

## Operator flow and persistence

Add Product requires all four fields. Create & Prepare first persists the job, navigates to `#/jobs/<id>`, then submits preparation. The job page polls created/preparing jobs once per second without invented progress. Terminal results stop polling. A created job can be prepared from its job page. Refresh job retries retrieval after a connection error. Recent jobs provides durable links and counts.

Review separates sources, extraction, qualified evidence, reconciliation/proposals, candidate, review package, and diagnostics. `not_attempted`, duplicate selection, unsupported extraction, no qualifiable facts, and qualified evidence remain distinct. `review_ready` with zero facts/proposals and no candidate is a neutral review result: “No product candidate was produced from the currently qualified evidence.” Evidence and proposals remain provisional pending human review.

Completed jobs can be retrieved after browser or API restart. This first slice inherits the runtime's single-process exclusivity: run one API process per job directory. If the process terminates during preparation, the persisted `preparing` state is retained; there is no automatic restart/retry of an interrupted operation. Review its state and create a new job as needed. Background queues and interrupted-operation recovery are outside this slice.

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
