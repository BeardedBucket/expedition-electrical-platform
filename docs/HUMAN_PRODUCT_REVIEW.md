# Human product review and guarded finalization

## Contract audit

`ProductionApproval` requires an ID, schema/artifact kind, reviewer string, timestamp,
decision, exact review-package reference, review-package snapshot and semantic snapshot.
The reviewer string represents an operator-entered label; there is no authentication.
`reviewed_decisions` optionally records human rationale as strings.

`validateProductionApproval` accepts rejected/deferred decisions without promotion
decisions and without a ProductCandidate. It also permits package-level approval
without selections, but that alone is insufficient for promotion.
`validateProductionApprovalForPromotion` requires an approved decision and structured
promotion decisions. `productionApprovalToPromotionReview` additionally requires a
candidate and binds the exact candidate, proposals, qualified facts and product evidence.
It rejects non-candidate fields/facts, overlapping approved/excluded fields and dangling
resolution/topology selections. `approvalMatchesReviewPackage` checks all three exact
package/snapshot bindings. The runtime repeats these checks before saving approval.

`ProductionPromotionDecisions` requires `approved_fields`, `evidence_acknowledged`,
`product_role` and `category`. Optional decisions are `excluded_fields`,
`excluded_fact_ids`, `reviewed_evidence_fact_ids`, `field_resolutions` (selected fact
and human rationale), and `topology_evidence`. The admin additionally requires at least
one explicitly selected field and acknowledgement set to true. Roles come from
`readComponentSchema()`; category is a nonempty human-entered string, with no enumeration.

`PromotionReview` is constructed through the existing production approval bridge.
`promoteProductionCandidate` runs the existing promotion engine and returns its actual
success/blocked/invalid result. An approval is not a guarantee that promotion will
succeed. Optional fact exclusions do not independently block promotion; the engine
retains authority over their effects.

`writeProductionPromotion` delegates successful promotion to the guarded canonical
writer; blocked/invalid results do not write. `CanonicalWriteRequest` accepts a
destination, optional filename, explicit write flag, overwrite flag and catalog
context. The operator API accepts none of these except literal `write:true`.
`CanonicalWriteResult` distinguishes written, dry_run, blocked and invalid, and separately
records collision and schema validity. The writer enforces the exact canonical filename,
safe destination containment, identity/file collisions, schema validation and exclusive
file creation (`wx`). Overwrite is unsupported.

`finalizeProductionIngest` validates accepted source-resolution provenance, performs
bound promotion and invokes the guarded writer. `IngestionJobService.finalizeJob`
persists `finalization_request` and `finalizing` before invoking it. It is one-shot:
even `write:false`, blocked and invalid results end in `finalized`. Exceptions end in
`finalization_failed`; an interrupted operation may remain `finalizing`. None permits
a second finalization, retry, reset or editing approval in place.

## State transitions

| Operation | Required state | Persisted outcome |
| --- | --- | --- |
| Prepare | created | preparing → review_ready or preparation_failed |
| Approve | review_ready with candidate and valid selections | approved |
| Reject | review_ready, including no candidate | review_rejected |
| Defer | review_ready, including no candidate | review_deferred |
| Confirm write | approved | finalizing → finalized or finalization_failed |

Source-resolution states and operations remain unchanged. Reject/defer do not invoke
promotion conversion. Approval does not invoke finalization. Terminal review and
finalization records are immutable through the operator interface.

## Preview finding

There is a pure proposal-producing seam, `promoteProductionCandidate`, but it is not
a canonical write preview: it does not check the filesystem or perform the additional
accepted-source-resolution checks in the finalizer. The writer's `write:false` operation
performs filesystem checks, and using it through `finalizeJob` is terminal. There is
no existing nonterminal runtime write-preview operation.

This slice therefore exposes the supported one-shot confirmed write. It does not expose
`write:false`, invoke writers directly from the API, reset state, duplicate jobs, weaken
binding, or add preview/retry states. The interface explains this limitation before
write confirmation. No new durable state architecture is required for this flow.

## Operator surface and API

The primary review surface groups proposals by canonical field. Every proposal keeps
its disposition, value and supporting references; multiple proposals and multiple
qualified facts remain separate. Evidence shows source wording, raw value, unit,
applicability, qualification, document title where available, capture URI, locators,
fact IDs and reconciliation conflicts/unresolved outcomes. Source links accept HTTP(S)
and use `target="_blank"` with `rel="noopener noreferrer"`. Missing information remains
unknown. Supporting references and IDs are secondary details. Existing preparation,
extraction and source diagnostics remain available below the decision editor.

Field decisions start as not reviewed. Only projected candidate fields can be selected
for placement; non-projected/unresolved proposals remain visible. The optional controls
map directly to the actual structured contract. A field resolution's rationale is a
human explanation, never fabricated semantic evidence. Role, category, reviewer and
evidence acknowledgement have no selected defaults.

For zero-fact/zero-proposal/no-candidate review_ready results, the surface explains that
no promotable candidate exists and offers reject/defer with only a reviewer label and
optional rationale. It never offers approval or asks for a fabricated role/category.

Routes, relative to `/api/ingestion/jobs/:id`:

- `POST /review/approve`: reviewer label, optional reviewed_decisions and exact structured
  promotion_decisions.
- `POST /review/reject` and `POST /review/defer`: reviewer label and optional reviewed_decisions.
- `POST /finalize`: exactly `{ "write": true }`.

The server derives IDs, timestamps, package references and both snapshots from persisted
review_ready state. Browser-supplied bindings, references, promotion results and
destinations are rejected. The runtime rechecks state/binding under its exclusive job
operation. Input/selection errors return 400, stale or invalid states return 409,
unknown jobs return 404 and unexpected failures retain sanitized/logged 500 behavior.

Each review action has a distinct confirmation describing its effect. Approval persists
the decisions and displays a durable summary: reviewer label, timestamp, selected fields,
role/category, acknowledgement, exclusions, optional rationale/resolutions and binding
details. A second explicit action identifies the canonical component, server-configured
destination and create-only/collision-protected behavior before authorizing a write.

Finalization displays the actual promotion status, write status, collision, issues and
durable runtime state separately. Interrupted/failed jobs have no invented recovery
action. The API uses `operatorConfiguration().canonicalRoot`; the browser cannot change it.

## DTO boundary

New projections allowlist field/evidence, human decision and finalization outcome data.
The field view is capped at 200 fields, 500 proposals per field and 1000 qualified facts
per proposal; oversized reviews visibly disable browser approval. Candidate fact
selections are capped at 1000. Captured bodies/bytes, extraction blocks, full jobs,
serialized canonical YAML, writer proposals/audit internals and absolute write paths
are not sent. Path-bearing collision/write-failure messages are sanitized; finalization
exceptions receive a local-diagnostics message. No iframe or source proxy is introduced.

## Validation and offline smoke

Thirty new tests cover the field editor and real local API/runtime pipeline: 16 UI tests
and 14 API tests. These include multiple evidence/proposal projection, source links,
locators, unresolved material, no-candidate decisions, explicit selections, forged inputs,
exact/stale binding, restart persistence, separate confirmations, collisions, blocked
promotion, failure states, accepted source provenance and intake immutability.

Focused results: UI 44/44 (including existing App tests), admin API 39/39, runtime 41/41,
production approval/promotion/finalization 67/67, and source-resolution regression 28/28.
Changed workspace and root builds passed. Final lint, format and diff checks are recorded
in the task handoff. No production component corpus was imported or modified for these checks.

The actual browser smoke used the real admin UI/API with deterministic synthetic captures
and temporary job/canonical storage. Candidate flow: prepare → review_ready → inspect
two fields and their multiple source facts/locators → select fields/role/category and
acknowledge evidence → confirm approve → approved with no write → separately confirm
canonical write → finalized with success/written. No-candidate flow: prepare → review_ready
with zero facts/proposals → reviewer label → confirm defer → review_deferred. Browser
reload and a newly constructed runtime service verified persisted outcomes; exactly one
fixture canonical file existed. Temporary server helpers were removed after smoke.

Three correction passes addressed test fixture assumptions/typing, blocked-result test
setup and compiled-server schema access. No shared ingestion/runtime authority, extraction,
qualification, canonical schema or source-resolution behavior was changed. Protected local
archive and Ekrano YAML were preserved; the protected YAML was not read or used.
