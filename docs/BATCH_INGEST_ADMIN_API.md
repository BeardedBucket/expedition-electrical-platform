# Batch ingest admin API

This API exposes the existing ingestion batch runtime as a thin admin HTTP layer. It reuses the standard `IngestionJobService` for child jobs and stores batch metadata under a distinct durable namespace.

## Routes

- `POST /api/ingestion/batches`
  - Body: JSON array of `ProductIntake` objects.
  - Success: `201` with a thin batch DTO.
  - Rejected: `400` for empty, malformed, or oversized arrays.
- `GET /api/ingestion/batches`
  - Success: `200` with a deterministic list of batch summaries.
- `GET /api/ingestion/batches/:id`
  - Success: `200` with the batch detail DTO.
  - Missing batch: `404` using the standard API error shape.
- `POST /api/ingestion/batches/:id/prepare`
  - Success: `200` with the refreshed batch summary.
  - No implicit retry loop; child jobs already beyond `created` are left alone.

## DTO boundary

The response is intentionally thin:

- `id`
- `created_at`
- `updated_at`
- `requested_count`
- ordered `job_ids`
- coarse `state`
- emitted counts
- ordered child `id`/`state` summaries

It does not expose raw capture bodies, source bytes, complete `IngestionJob` objects, file-system paths, or stack traces.

## Production composition

Ordinary job storage remains under the existing `.local-ingestion/jobs` root. Batch lifecycle storage is separated into `.local-ingestion/batches` so batch records never share a job namespace. The admin layer creates one `IngestionJobService` and passes that same instance into one `IngestionBatchService` instead of creating a second job lifecycle.

## Runtime limits and semantics

- Each batch accepts 1–50 product intakes.
- Validation occurs before child job creation.
- Batch preparation delegates only to the normal `prepareJob()` path for child jobs still in `created`.
- No approval/finalization routes are added for batches.
- No canonical product write is performed from batch routes.
- No UI or CSV import is included in this slice.
