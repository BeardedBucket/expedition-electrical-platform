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

| Operation     | Required state                                   | Persisted outcome                              |
| ------------- | ------------------------------------------------ | ---------------------------------------------- |
| Prepare       | created                                          | preparing → review_ready or preparation_failed |
| Approve       | review_ready with candidate and valid selections | approved                                       |
| Reject        | review_ready, including no candidate             | review_rejected                                |
| Defer         | review_ready, including no candidate             | review_deferred                                |
| Resume review | review_deferred                                 | review_ready, exact prior review preserved      |
| Confirm write | approved                                         | finalizing → finalized or finalization_failed  |

Source-resolution states and operations remain unchanged. Reject/defer do not invoke
promotion conversion. Approval does not invoke finalization. Reject is terminal;
Defer is a resumable pause, not rejection of the product or evidence. Finalization
records remain terminal through the operator interface.

Deferral preserves the entire current reviewed preparation, including source,
capture/acquisition, candidate if present, semantic decisions and completion.
`product_review_history` is append-only; each deferred event stores the exact
bound `ProductionApproval`, optional operator-selected reason, and revision.
Rationale is mandatory for new deferrals. Resume records the operator label,
timestamp, exact review snapshot, preparation-history count, and next event revision.
It clears only the current decision pointer while retaining its full history.
Both operations use per-job serialization, durable versioned reads, conditional
CAS saves, and atomic replacement. The lifecycle snapshot additionally blocks
an old browser intent after a defer/resume cycle with identical review evidence.

Resume does not rebuild a candidate or reinterpret semantic decisions. For later
schema/rule capability changes, a separate explicit preparation-reopen action
archives the complete resumed review, including schema-gap decisions, and returns
to `created`. Start preparation is yet another explicit action using the accepted
source. Old schema gaps remain historical; new preparation requires new review.
The one-use reopen permission is bound to the exact resumed snapshot/history count.

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

The primary review surface gives each semantic proposal one card in its authoritative
category: REVIEW REQUIRED, REVIEWED / DISPOSITIONED, AUTOMATICALLY MAPPED, or
DERIVED / CALCULATED. A proposal that contributes to a projected field carries that
field's separate product-approval control on the same card; the lower product-review
section does not repeat the proposal, evidence, or field decision. When several
proposals contribute to one candidate field, one card owns the shared field-level
decision and the other cards link to that control. Semantic disposition and product
approval remain separate domain decisions. Evidence shows source wording, raw value,
unit, applicability, qualification, document title where available, capture URI,
locators, fact IDs and reconciliation conflicts/unresolved outcomes. Source links accept
HTTP(S) and use `target="_blank"` with `rel="noopener noreferrer"`. Missing information
remains unknown. Supporting references and IDs are secondary details. Existing
preparation, extraction and source diagnostics remain available below the decision editor.

Measurement review keeps provenance visible in two distinct representations: the exact
SOURCE-STATED assertion retained with its source evidence, and the normalized / converted
canonical value with the target contract's canonical unit. For example, `13.15 in` remains
the source assertion while `334.01 mm` is the canonical representation; the browser only
renders these server-provided values and units. Display values use the semantic domain's
existing deterministic conversion-noise canonicalizer, limited to values within its
existing four-ULP bound; the underlying candidate and engineering values are not rounded
or rewritten for presentation. This removes binary floating-point artifacts such as
`180.08599999999998 mm` while retaining the exact source assertion `7.09 in`. A unit
conversion is not a calculated or derived fact. Only a proposal carrying explicit
derivation metadata belongs in the CALCULATED / DERIVED group.

Field decisions start as not reviewed and appear on the primary card for a projected
semantic work item. Only projected candidate fields can be selected for placement;
non-projecting dispositions remain visible in REVIEWED / DISPOSITIONED and receive no
product-field approval control. Optional field resolution is offered only when multiple
supporting facts or recorded conflicts make selection meaningful; a field with one
unambiguous fact does not require a resolution interaction. The controls map directly to
the actual structured contract. A field resolution's rationale is a human explanation,
never fabricated semantic evidence. Role, category, reviewer and evidence acknowledgement
remain product-level controls and have no selected defaults.

For zero-fact/zero-proposal/no-candidate review_ready results, the surface explains that
no promotable candidate exists and offers terminal Reject or resumable Defer.
Defer requires a reviewer label and rationale; optional reason classification has
no inferred default. Neither action needs a fabricated role/category.

Routes, relative to `/api/ingestion/jobs/:id`:

- `POST /review/approve`: reviewer label, optional reviewed_decisions and exact structured
  promotion_decisions.
- `POST /review/reject`: reviewer label and optional reviewed_decisions.
- `POST /review/defer`: reviewer label, nonempty reviewed_decisions rationale,
  expected_lifecycle_snapshot, and optional defer_reason.
- `POST /review/resume`: expected_lifecycle_snapshot and actor_label only.
- `POST /finalize`: exactly `{ "write": true }`.

The server derives IDs, timestamps, package references and both snapshots from persisted
review_ready state. Browser-supplied bindings, references, promotion results and
destinations are rejected. The runtime rechecks state/binding under its exclusive job
operation. Input/selection errors return 400, stale or invalid states return 409,
unknown jobs return 404 and unexpected failures retain sanitized/logged 500 behavior.

## Human semantic adjudication

The Product Review surface keeps semantic proposals in separate server-projected groups:
proposals requiring disposition, active human dispositions, automatic mappings that need
no re-entry, and calculated/derived results. Each source proposal retains its own raw
assertion, bound qualified facts, source/document links and locators. Derived proposals are
not offered as human semantic evidence.
An automatic mapping remains complete without human re-entry, but a non-derived mapped
proposal offers optional correction controls; opening them does not change completion.
The automatic target and its canonical value remain visible while a human disposition
is recorded through the same append-only decision flow; the canonical value is never
described as the original/source assertion.

Canonical mapping targets are discovered from the ingestion domain's explicit canonical
target contracts and filtered against the current proposal's retained fact context. They
are not derived from source-label aliases and are not authored in React. The reviewer
chooses meaning and supporting facts; the server/domain runs the same deterministic
normalization contract used during persisted decision replay. A non-persisting preview
shows exact source assertions beside the normalized canonical value/unit. The browser
renders the preview and submits those exact server-produced normalized fields; it does
not calculate or edit them. Retained source units take precedence when resolvable, then
an explicit raw-value unit may be recovered. A reviewer-selected unit is accepted only
when the existing contract can verify that unit against explicit retained source text.
Ambiguous, unsupported or dimension-incompatible units fail closed.

The reviewer may instead record `evidence_only`, `schema_gap`, `reject`,
`not_applicable`, or explicit `unresolved`. Schema gaps require a concept key, explanation
and rationale; map, reject and not-applicable require rationale. Evidence-only and
unresolved may omit rationale. Explicit unresolved means the proposal was reviewed, but
its semantic meaning remains unresolved and no canonical fact is projected.

Decisions are append-only. A correction records another revision linked to the previous
decision; it never edits an earlier event in place. Each successful disposition rebuilds
the candidate and review package, returns the new snapshot and updates completion from
the authoritative server result. A stale snapshot or a state change returns a conflict:
the UI reloads current state and requires the operator to inspect and reconfirm rather
than replaying old intent. Product field approval is co-located with the semantic proposal
card only when the current server projection shows that proposal contributes to a
candidate field. Qualified candidate assertions retain their separate product-approval
IDs and are presented on their semantic card when one exists. A semantic correction
changes the review snapshot and clears prior product field selections, resolutions,
qualified-value selections, fact decisions, topology selections and evidence
acknowledgement so the operator must review the server-refreshed projection. Product approval remains behind the existing server
completion gate, and finalization authority is unchanged.

The complete sequence is:

evidence → semantic proposal → human disposition when required → deterministic
map preview when mapping → persisted append-only decision → rebuilt candidate/review
package → semantic review completion → ordinary product approval → finalization/promotion.

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
