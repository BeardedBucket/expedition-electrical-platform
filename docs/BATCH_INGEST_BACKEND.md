# Batch ingest backend boundary

Batch ingest is a runtime-core feature that groups ordinary ingestion jobs. It
does not create a parallel product-ingestion lifecycle or duplicate child
product state.

## Persisted contract and storage

A v1 batch record contains:

- `schema_version`
- `id`
- `created_at`
- `updated_at`
- `job_ids`: an ordered list of unique ordinary ingestion job IDs
- `requested_count`: exactly equal to `job_ids.length`

The list must contain 1–50 jobs. The hard maximum of 50 is shared by service
validation and durable-store validation. Fifty is bounded headroom for the
expected campaign size of roughly 20–30 products while keeping v1 processing
sequential. A service-specific `maxBatchSize` may narrow this limit, but cannot
widen it; configured limits must be integers from 1 through 50.

Job and batch records must use distinct storage roots, conventionally
`jobs/` and `batches/`. Both stores use UUID-named JSON records, so sharing a
directory would cause batch listing to interpret job records as batches and
surface them as corrupt. Production composition must provide separate
namespaces.

Batch records contain only stable identity and ordered child job IDs. Ordinary
`IngestionJob` records remain the authoritative lifecycle state. Reads derive
the summary from current child records; exact per-child and per-state counts
are primary. The coarse state is only a summary:

- `pending` means every child is `created`, `source_resolution_required`, or
  `source_resolution_review`.
- `preparing`, `review_ready`, `approved`, and `finalized` are returned when
  every child has that same state.
- `failed` means every child has a runtime failure state:
  `preparation_failed` or `finalization_failed`.
- `review_rejected` and `review_deferred` are human dispositions, not runtime
  failures.
- Heterogeneous lifecycle outcomes generally produce `mixed`; a mixed batch
  with both ready and failed children remains `mixed`.

`updated_at` is a batch metadata/orchestration timestamp, not the timestamp of
the latest child lifecycle change. Child jobs may change independently through
review or finalization, so consumers must read the current child records for
freshness. Read operations (`getBatch()` and `listBatches()`) do not update it.
Each `prepareBatch()` invocation updates it after its sequential orchestration
pass, including an invocation that finds no eligible children.

The file-backed batch store uses checksum-protected payloads and atomic replace
writes. Batch identity and ordered child membership are immutable after
creation. Corrupt batch records remain visible as errors.

## Creation and preparation behavior

All `ProductIntake` values are validated before the first ordinary child job is
created. Malformed-input rejection is therefore atomic with respect to child
creation. After prevalidation succeeds, an unexpected `createJob`, storage, or
I/O failure may occur after earlier ordinary jobs were created. The existing
job store has no transactional multi-job rollback/delete facility, so those
children may remain as orphan ordinary jobs. The batch operation must not
report that no children were created in that case. V1 does not add transaction
or rollback machinery.

`prepareBatch()` processes children sequentially in stored order and invokes
only the standard `prepareJob()` path for jobs still in `created`. A failed
child does not stop preparation of later children. Repeated calls do not retry
children that are no longer `created`; there is no implicit retry policy.
Batch preparation does not approve, finalize, or write canonical product
records.

## Scope

Runtime core is complete for this slice:

- Durable batch metadata store and shared hard size contract.
- Batch validation, ordered grouping, live aggregate read model, and listing.
- Sequential preparation of eligible child jobs.
- Runtime regressions for persistence integrity, state semantics, failure
  isolation, idempotence, and restart reconstruction.

Deferred to later slices:

- Thin admin HTTP API.
- Admin UI and dashboard views.
- CSV/import layer.
- Bounded concurrency.
- Retry policy.
- Transactional batch creation or rollback.
- Batch-level approval/finalization orchestration.
