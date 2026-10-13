# Wave-1 operator runbook

Use the primary human-created branch and checkout. Build with `npm.cmd run build`.
Do not use `validate:data` against the whole local catalog during a protected-path
session. The Wave-1 scripts use explicit IDs and exact files; never pass a root
directory for recursive discovery. The normal tests/fixtures need no private TEMP
files. The public proposal profiles are incomplete metadata examples, not approved
products.

## One product: exact retained source to provisional proposal

Choose a **new private parent directory** and an exact investigation ID. The
terminal's TEMP may differ between sandbox and host; record the actual resolved
absolute path. The required leaf name prevents accidental writes into canonical
data. Captures/extractions use exclusive writes and never overwrite earlier
evidence. A retry or refresh uses a new parent, preserving failure records.

```powershell
$wave1Private = Join-Path $env:TEMP 'expedition-electrical-platform-reviews\my-wave1-run\engineering-corpus-wave1-private'
node scripts/engineering-corpus-wave1.mjs capture --ids p25 --output "$wave1Private"
node scripts/engineering-corpus-wave1.mjs extract --ids p25 --output "$wave1Private"
node scripts/engineering-corpus-wave1.mjs prepare-pv --ids p25 --model NPA200S-12J --output "$wave1Private"
node scripts/engineering-corpus-wave1.mjs prepare-production --ids p25 --output "$wave1Private"
```

Capture writes `p25.source` (private publisher bytes) and `p25.capture.json`
(URL/publisher/time/digest/rights/status). Extraction writes
`p25.extraction-v1.json` (private blocks/locators/diagnostics). Native PV authoring
writes `p25.preparation-v1.json` (source byte bindings, profile, unresolved review
queue). Existing pipeline preparation writes `p25.production-review-v1.json`;
its `review_ready` state only means a queue exists. This milestone's six offline
ordinary preparations have no qualified facts or candidates; source-context
qualification/integration remains necessary. Do not call them complete drafts.

Inspect exact model, source revision, selected native ownership, full surrounding
conditions, units and intended-use assertion inventory. Review the readable
statement against its containing source and exact bytes. Mechanical capture,
literal binding, extraction and proposed engineering meaning are different
success criteria. An agent's profile authoring is not human source correction.
`replayEngineeringPreparation(artifact, explicitRetainedSources)` verifies a
restart with exact bytes; missing files/digests fail, with no refetch fallback.

For the model-column controller example use one ID and exact **source header**:

```powershell
node scripts/engineering-corpus-wave1.mjs prepare-tracker --ids p07 --model 'MPPT 150/45' --output "$wave1Private"
```

That header is not a retail SKU. Tracker/terminal grouping remains unresolved.
Do not use the same header or a 250/100 family column as proof of a Tr/MC4 variant.

## Bounded batch, recoverable holds and source correction

```powershell
node scripts/engineering-corpus-wave1.mjs capture --ids p25,p26,p07,p08 --output "$wave1Private"
node scripts/engineering-corpus-wave1.mjs extract --ids p25,p26,p07,p08 --output "$wave1Private"
node scripts/engineering-corpus-wave1.mjs prepare-production --ids p25,p26,p07,p08 --output "$wave1Private"
```

Run this in a fresh parent; combining it with the one-product example would
intentionally fail exclusive writes. Campaign capture is sequential and uses
existing transport bounds. Failed/challenged sources remain held. Do not extract
a failed response or count a retained challenge page as manufacturer evidence.
`p06` COMVOLT is an identity/publisher hold and is skipped before capture.
Ambiguous sibling/kit ownership needs a complete primary source, not an alias or
adjacent-column value. A captured source can still need a different manual.

For actual durable jobs, start the existing local operator API and UI using
`npm.cmd run start:ingestion-api` and `npm.cmd run dev:ingestion-admin` in separate
terminals. Set private job/batch and eventual canonical roots through the
configuration documented in `apps/ingestion-admin/README.md`; source and byte
stores must remain in their established rights-aware lifecycle.

Use Add product or Batches with exact identities and official URLs. Prepare →
Evidence review queue → cite complete containing source → correct source/value/
ownership through the existing human source editor → inspect proposed meaning
and candidate evidence → preserve unresolved/schema-gap entries. Deferral and
resume preserve history; re-preparation is a separate explicit operation. A
missing unit, domain, coefficient, protocol, revision or source condition is a
hold. Never mark it absent/false just to close the queue. See the existing human
adjudication and operator READMEs for their durable CAS/history boundaries.

The Engineering profiles navigation route opens the new proposal JSON editor.
Paste a `*.profile.json` and optionally an explicit installed scenario. Validate
and preview shows original units, evidence IDs and model/revision, blockers versus
unknowns, formulas and assumptions. Edits clear stale previews. This route does
not save durable human decisions or approve products; private byte replay remains
required. The sidecar cannot be copied into a canonical record. Ordinary durable
jobs now support source-bound PV/controller quantities in the human source editor;
follow [the continuation acceptance runbook](ENGINEERING_CORPUS_WAVE1_CONTINUATION.md).
Atomic product review, promotion and verification remain separate human actions.

## Human authority STOP

After source corrections and complete candidate review, **STOP for personal human
product approval**. Only the human selects factual fields/assertion IDs under the
existing admission contract. Approval is followed by a separate human-authorized
promotion/write, then separate durable content-bound engineering verification.
Neither schema validation, source acceptance, an envelope pass nor ranking grants
any of these actions. This assignment stopped before all such actions and before
Git staging/commit/push/PR/merge.

## Reproducible isolated validation

```powershell
node scripts/generate-engineering-profile-schema.mjs --check
node scripts/run-wave1-fixtures.mjs
node scripts/engineering-corpus-wave1.mjs inventory
```

The fixture runner reads only two committed invented inputs, computes and strictly
replays their versioned envelopes, and prints digests, counts and measured local
elapsed time. Those timings do not benchmark source capture, review or fresh
dependency installation. To reproduce on a fresh clone: install the lockfile with
`npm.cmd ci`, build the workspaces, then run these commands without any private
environment variable or TEMP artifacts. This wave measured the fixture-only path
with private environment variables removed; an actual fresh clone/Node 22 Ubuntu
CI run is still the human PR/CI proof.

Authentic BMV/Morningstar/Samlex checks use the existing opt-in contract in
`apps/ingestion-admin/tests/fixtures/observations/README.md`. Supply exactly its
authorized observation directory and run `npm.cmd run test:genuine-observations`.
Missing or mismatched inputs must fail. That gate tests retained observations,
not original PDF extraction accuracy or source/product qualification.

Upload for external review: task-only patch, SHA-256 file manifest, handoff and
schema/consumer/coverage/testing reports. Public proposals and ledger are already
included as task paths. Do not upload private `.source`, full extraction JSON,
raw capture bodies, unlicensed documents, private benchmark outputs or protected
content. Source citations/digests and explicit hold inventories are in the ledger.
