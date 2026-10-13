# Human source adjudication v1

This additive review path repairs automated observations while keeping retained
source artifacts and the original preparation immutable. It reuses whole-intake
reconciliation, semantic interpretation, candidate construction, approval, and
promotion contracts. It does not introduce canonical properties or grant
engineering verification authority.

## Contracts and ownership

`human-adjudication.v1` names the intent, source proof, event, normalizer and
reviewed semantic validation policy. `data/schemas/human-adjudication.schema.json`
closes intent/proof fields and references existing intake and document artifacts.
The existing production schema and product-fact schema add optional proof/mapping
fields. Existing scalar decision policy versions remain replayable.

The browser submits source strings, exact retained quotations, model relationships,
existing property targets, typed qualifiers and reviewer rationale. It never
submits normalized values or authoritative canonical JSON. The server assigns
event IDs, timestamps, revisions, assertion IDs, normalized values and snapshots.
An actor is a local operator-entered label, not authenticated identity.

Each ready statement becomes a separate human qualified fact. Its proof retains
the intake, statement and referenced extraction artifacts. Detached evidence makes
downstream qualified-value replay independent of the job store. This deliberately
duplicates retained artifacts; storage size and replay cost need measurement
before corpus-scale use. Retention/licensing policy still applies to manufacturer
text. No canonical destination is written by an adjudication save.

`human_adjudication_original` preserves the original preparation. Events form
append-only per-group revisions with predecessor IDs/digests and the exact review
snapshot used at creation. Replacement references bind current facts by digest.
Ready events overlay their explicitly bound facts; drafts retain history without
suppressing observations or acquiring engineering scope. Revising a group replaces
its earlier effective human assertions and retains every preceding event.

Whole-input reconciliation and proposals are rebuilt. Current human mappings are
appended to the existing reviewed-semantic history under the new input snapshot.
Competing/multi-fact interpretations remain unresolved; ordering cannot choose a
winner. Legacy mappings of human facts are rejected to prevent bypassing v1 source
context checks. Legacy decisions on original automatic facts remain supported.

The existing job-store CAS and lock/atomic replacement machinery owns writes.
Stale snapshots and CAS conflicts fail without automatic retry. Active and recovery
archive streams replay against their original retained artifacts. Explicit
preparation recovery archives corrections and clears the active overlay; a new
capture cannot inherit them. Review DTOs expose allowlisted active/archived history,
not complete detached proof documents.

## Evidence and applicability

Quotes must occur exactly in retained blocks/cells. Cell keys address existing
row/column positions; they do not invent PDF coordinates. Values, declared units,
wording and explicit conditions must occur in the quotations. One assertion cannot
combine source captures.

Exact scope requires a requested model/part-number reference and a demonstrated
relationship: same manufacturer statement, exact retained opening heading,
retained HTML heading/section ownership, model table row, model header column, or
an explicit shared statement naming the model. Same-line checks reject ambiguous
tables; heading checks refuse intervening sections or multi-model headings.
Row/column checks use retained structured cells. Flattened PDF text cannot prove
table-column ownership. Sibling-only, missing or ambiguous scope remains a draft.

Grouping is conservative: duplicate fragments must share the same retained value
locator and preserve original values. Equal values in different cells are distinct
specifications. Genuine reconciliation conflicts cannot be collapsed through
grouping. Broader manufacturer-specification relationships require a future
explicit source-group contract. Splitting creates independently cited assertions;
adding a missed specification never replaces original observations.

### Source-context completeness

A reviewer quote is an exact excerpt, not proof that omitted source text is
irrelevant. The server derives the containing assertion from retained sentences,
lines, semicolon clauses or an unqualified conjunction split. It independently
reads governing HTML headings, relevant table headers and universal section or
same-block notes. Detached qualifiers with several possible owners, other
material table cells and ambiguous notes remain unresolved. PDF text does not
gain structural heading/table ownership from this policy.

Complete unconditional assertions still map directly. Cropped temperature,
duration, basis, state, comparison or measurement conditions cannot become
unconditional. Unfamiliar trailing scalar prose also requires a qualified or
unresolved representation. Values must match numeric boundaries, and units must
occur in the relevant source context. Explicit nominal voltage meaning remains
intrinsic to the existing nominal-voltage target. Separate source-delimited
assertions need not copy unrelated specifications from the whole paragraph.

`humanSourceContext` is server-derived and introduces no browser-owned context
claim. Extra context is stored as evidence with its existing retained locator and
as source conditions where needed. The original excerpt and complete detached
document remain unchanged. Temperature and duration require dedicated typed
fields; source-rating normalization preserves the complete applicable text.
Proof reconstruction, preview, event creation, event replay and candidate support
all run the same completeness checks. No old unsafe mapping is grandfathered;
an earlier v1 proof that cannot reconstruct under these safeguards fails closed
and requires explicit evidence review. No history is silently rewritten or
migrated. Legacy scalar decisions on original automatic facts remain supported.

This is a conservative structural policy, not general natural-language inference.
Complex shared qualifiers without retained ownership need an unresolved draft
and later evidence/representation work, rather than a guessed boundary.

## Engineering meaning

Direct values reuse existing field descriptors, unit conversion and schema checks.
Direction, continuous/nominal meaning and physical axes require source support.
Material conditions refuse scalar projection. Physical body dimensions are distinct
from installation envelopes, clearances, bezels and cutouts.
Context checks use the complete source wording; an editable label cannot remove
material qualifiers. A scalar body coordinate requires an explicit source axis.
Multiplication `x` does not establish an X axis. A body-dimension triple requires
documented H × W × D order and reuses the existing governed parser's coordinate
mapping; neither the reviewer nor the UI can guess its order.

Source ratings use existing governed targets and the canonical `source_rating`
union. Units must match the governed quantity. Direction/domain/product role,
rating basis, RMS measurement basis, duration, temperature, revision and comparison
are evidence-bound. Existing supported voltage ranges preserve both bounds.
Peak/surge ratings with unknown duration remain unresolved. The complete source
wording is retained as a source condition so unmodeled context cannot disappear.
These strings do not assert that a particular installation satisfies them.

Existing source-observation parsers support supply voltage ranges, physical body
dimensions and operating consumption where their governed contracts can retain
the source context. Unsupported material qualifiers refuse representation. Missing
measurement-accuracy, installation-envelope or other canonical concepts remain
model gaps; they are not approximated by neighboring fields.

Human mappings remain provisional/manual and require product review. Approval,
promotion and content-bound engineering verification remain separate. Approved,
finalizing or finalized jobs cannot accept source edits. Material content changes
cannot inherit an earlier verification digest.

## API, UI and limits

Current-job review routes expose `human-evidence`, `human-properties`,
`human-preview`, and `human-adjudication`. All bind the exact review snapshot.
Discovery validates current source/qualifiers and runs the same normalizer used
by preview/save/replay. Catalog presentation never grants eligibility.

The source-first workspace offers correction, split, missed-specification addition,
duplicate-fragment selection, drafts and revision history. Search, dropdown and
explorer share the same selection-to-preview path. Effects discard stale responses;
failed saves retain inputs. An explicit reload rechecks current same-group bindings;
a group replaced elsewhere requires reopening its current correction.

Evidence paging returns 50 full entries per page: a UI reading/response bound,
not an extraction quota. The existing 16 KiB HTTP JSON bound also applies to
adjudication intents. Quote the relevant passage; nothing is silently truncated.
The lab uses loopback port 5177 to avoid Chromium's unsafe ephemeral ports; it fails
if occupied and never stops another listener.

The controlled corpus measurement test samples one correction, eight revisions,
twenty assertions in one event and twenty events citing the same document. Its
80 KiB synthetic tail represents retained-document duplication, not a source
limit. Five replay samples report median/maximum duration without a timing gate;
the thirty-second test budget bounds this local workload. Measured duplication
warrants a future versioned, portable evidence bundle keyed by artifact/capture
digests, with document identity, schema version and exact citations bound in every
proof. The bundle must accompany exported history and preserve source rights;
runtime lookup cannot depend on a global mutable store. This correction does not
implement that storage redesign. See the final task handoff for measured bytes,
sample durations and the distinction between pre-existing pipeline duplication
and event-proof duplication.

## Isolated validation and visual review

`apps/ingestion-admin/tests/human-adjudication.test.ts` uses fresh TEMP stores and
exact authorized frozen observation files. Frozen identities are hash-checked.
Genuine BMV supply wording has a positive normalizer/replay case and a real backend
discovery/preview/candidate/restart case in a clearly controlled HTML text envelope.
That envelope does not validate original PDF layout or manufacturer-host
authentication. Genuine BMV precision and ambiguous Morningstar column ownership
are refused. Synthetic evidence is explicitly identified; frozen files are unchanged.

Run `node apps/ingestion-admin/demo/human-lab-build.mjs`, then run
`node <returned-TEMP-directory>/server.mjs <returned-TEMP-directory>` and open its
printed URL in a browser. This lab uses real review contracts and a synthetic HTML
capture; no source fetch, approval, promotion, verification or canonical destination
is configured. Ctrl+C closes the task-owned listener; builds/jobs remain in TEMP.

For manual review, use desktop width and the lab's 390-pixel review width. Enter a
reviewer label, open source correction, cite the exact-model current paragraph and
its model relationship, enter label/value/unit/wording and rationale, choose the
same-statement relationship, and select a direct continuous input-current property.
Confirm the server preview is 0.5 A for 500 mA, save, reload, and reopen the revision.
Check keyboard help/focus, legible locators, no horizontal page overflow, retained
inputs after failure, and queue → source → decision reading order. Repeat with the
150 A / 5 seconds / 25°C paragraph using a source rating and explicit output
direction, duration and temperature. Test missing qualifiers and sibling evidence
refusals, split assertions and unresolved drafts. Product approval remains unavailable
in this lab even if its UI is displayed.

Automated tests cannot substitute for visual acceptance. If browser automation is
blocked, desktop and narrow visual acceptance remains pending human review.
