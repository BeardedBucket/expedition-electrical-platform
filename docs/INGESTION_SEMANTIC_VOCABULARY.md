# Ingestion semantic vocabulary and product derivations

## Ownership and matching

The production semantic bridge maps source claims only after qualification and
whole-intake reconciliation. A label alone is insufficient: ordinary `Voltage`
on a battery means something different from the same word on a charger, and
`Length` may describe a cable, package, clearance, or product body. The bridge
first checks an exact-product, reviewed source region using
`reviewed-semantic-contexts.json`. That file binds a reviewed acquisition
profile **digest**, source table ordinal, and required neighboring labels to a
role and region. Its binding digest joins contextual proposal input digests,
and the proposal rationale identifies the vocabulary version. The procedural
matcher has no manufacturer branch. A missing
profile, changed digest, incomplete sibling set, ambiguous region, unmatched
exact product, or non-structural qualification yields no reviewed context.

Contextual exact-label mappings take precedence over older global explicit
aliases. Multiple matching contextual meanings fail closed. Unit families and
qualifiers are checked by the same normalizers and semantic safety gate as
other proposals. The reviewed battery specification vocabulary maps plain
`Voltage` to nominal/rated voltage only when separately labeled charging and
float rows establish the source distinction. Plain `Capacity` in Ah maps to
nominal capacity; `Ah PbEq` is a marketing equivalence and remains source
evidence. `Battery Type` maps only a recognized chemistry. The reviewed body
dimension region maps width to x, length or depth to y, and height to z; no
plain body-axis word enters a production semantic proposal without this
context. Older direct ProductFact normalization keeps its explicit axis
aliases so persisted pilot artifacts remain reproducible. Charging and float voltage
ranges remain separate battery fields, never nominal supply voltage.

Production battery-only aliases such as series count, usable DoD, and charge
or float voltage are accepted only with the reviewed battery context. The
legacy direct normalizer retains its historical flat aliases for persisted pilot
replay; that compatibility boundary is intentionally not used by production
semantic proposals.

Automatic proposals are immutable inputs to human semantic adjudication. A
`ReviewedSemanticDecision` is a separate, replayable event bound to an exact
proposal, its qualified facts, and a deterministic upstream input snapshot.
`buildReviewedSemanticInterpretation()` revalidates that binding and target
compatibility each time it is applied; stale events remain observable but do not
change the current interpretation. A one-product decision never changes the
automatic alias tables or contextual vocabulary. Candidate construction consumes
the automatic proposals plus that interpretation while retaining each proposal's
original target, disposition, and value for comparison.

The ingestion runtime persists decision events inside the durable job's prepared
candidate bridge. It creates proposal/fact references, input snapshots, revision
numbers, predecessor links, policy version, actor kind, event ID, and timestamp
from the current persisted job rather than accepting those bindings from a caller.
Each correction appends a new revision; earlier events remain immutable so replay
can validate the complete chain and preserve review provenance. Mutations are
allowed only while the job is `review_ready`, before approval or finalization, and
must carry the exact current review-package snapshot. Per-job runtime serialization
reduces same-process contention but is not the concurrency authority. The review
snapshot binds the action to what the operator saw; the store's durable checksum
token independently prevents any stale writer from replacing a job changed after
it was loaded. The runtime rebuilds the interpretation, candidate, and review
package before one conditional checksum-protected atomic job-record replacement.
The file store holds an exclusive per-job lock across checksum comparison and
replacement, so another process cannot pass the comparison and race the rename.
An existing lock is never stolen automatically; after a process crash, an operator
must verify the writer is gone before removing its orphaned lock, preferring a
fail-closed conflict over unsafe lock expiry.
Future shared/database stores must preserve this compare-and-swap contract using
their own transaction or locking mechanism. A failed validation or replacement
leaves the prior record intact. Older jobs without a decision-history property
load as an empty history. The deterministic Slice 1 validator remains the owner of
semantic meaning and evidence support; persisted decisions never teach automatic
aliases, target contracts, or profiles.

The ingestion-admin API records one reviewer-intent decision at
`POST /api/ingestion/jobs/{id}/review/semantic-decisions`. It allowlists proposal,
snapshot, selected-fact, actor-label, outcome, and outcome-specific semantic
intent fields. The expected review snapshot is the only client-supplied
concurrency binding; decision IDs and revisions, artifact references and
digests, input snapshots, policy version, actor kind, and timestamp are created
from the current persisted job by the runtime. The response uses the existing
safe operator view and includes the rebuilt interpretation, candidate, review
package state, current review snapshot, and an allowlisted decision summary.

Before an approved transition, the runtime evaluates semantic-review completion
from the persisted proposals and replayed reviewed interpretation. Derived
proposals are excluded because their deterministic derivation contract governs
them. Non-derived proposals already automatically mapped by the deterministic
pipeline do not need semantic re-entry; every other non-derived proposal needs
an active, current human disposition. `map`, `evidence_only`, `schema_gap`,
`reject`, `not_applicable`, and `unresolved` all count as explicit review.
Unresolved therefore satisfies reviewer accountability, not semantic
resolution: it remains visibly unresolved and projects no canonical fact, as do
the other non-map outcomes. An incomplete approval returns a conflict with the
proposal IDs still requiring disposition and leaves durable job state unchanged.
Legacy review-ready jobs without decision history remain loadable, but missing
history does not satisfy the new approval gate. Decisions cannot be recorded
after approval or finalization.

`productionSemanticTargetContract()` is the explicit owner of canonical target
semantics and does not derive its registry from source-label aliases. Each
contract combines the component-schema value shape with a reviewed field path,
dimension, canonical unit, deterministic normalizer version, and any role or
context restriction. Schema storage capability alone does not grant semantic
mapping permission. Production automatic mappings route labels to these
contracts; a runtime invariant rejects any mapping whose declared dimension or
unit disagrees with its target. Production proposals and human decisions use
the same target normalizer, while automatic alias tables remain a separate
source-vocabulary layer.
Target normalization checks the same role and region eligibility as target
selection. Reviewed validation and candidate reconstruction share one effective
source-unit rule: an explicitly reviewed unit must be supported by retained
metadata or explicit raw evidence; otherwise a resolvable retained unit takes
precedence over a resolvable unit in the raw assertion. Unresolvable metadata
does not mask an explicit raw unit or change the immutable QualifiedFact.

Several existing manufacturer-fact fields have target contracts but no
automatic source-label alias yet: `electrical.continuous_input_current_a`,
`electrical.peak_input_current_a`, `electrical.peak_output_current_a`,
`electrical.output_voltage_range_v`,
`battery.charge_current.maximum_continuous_a`, and
`battery.charge_current.protection_limit_a`. A one-product human decision may
map supported retained evidence to these targets; it does not add or broaden
an automatic alias. The output voltage-range normalizer rejects AC/DC-qualified
values because the decision contract cannot yet retain those qualifiers.

Other schema paths intentionally remain unavailable as direct human targets.
`electrical.power_consumption_w` represents condition-qualified observations,
not an unqualified product scalar. `electrical.max_pv_voltage_v` is currently
classified as evidence-only. `efficiency_fraction` lacks a defined operating
basis; `service_clearances_mm` lacks a complete source-scope/local-face
contract; and generic `mounting`, port, capability, terminal, and topology
objects lack target-specific source normalizers. These are semantic-contract
gaps, not missing JSON Schema storage.

A `map` decision selects meaning, not a replacement measurement. For every
selected QualifiedFact the target contract must deterministically normalize
its retained raw assertion, and every resulting value must agree with the
decision value and with the other selected facts. Numeric comparison allows
only a four-ULP-scale binary floating-point representation difference; it is
not a source-measurement tolerance. A target without a deterministic normalizer
cannot be human-mapped.

Rationale is required for `map`, `reject`, `schema_gap`, and
`not_applicable`. The last outcome asserts why otherwise retained evidence does
not apply to this exact product or context, so its reason is audit evidence.
`evidence_only` and explicit `unresolved` remain valid without boilerplate.

To add a reviewed vocabulary, review the source profile, exact applicability,
table/region locators, neighboring terms, value units, and competing meanings.
Version the binding and pin its profile digest; add exact contextual aliases
and positive/negative tests. Never widen a global alias to make one source
work. The current binding records a specific reviewed source shape, not a
general product default.

## Published and derived values

Published DoD is stored as a fraction in
`battery.usable_depth_of_discharge_fraction`; the original percent text stays
in the qualified fact and candidate fact. Published maximum series voltage is
stored in `battery.maximum_series_voltage_v`. Both are source assertions.

`battery.usable_capacity_ah = nominal_capacity_ah × usable_depth_of_discharge_fraction`
uses exact-product, unambiguous, numeric published inputs. No absent DoD is
treated as 100%. `battery.allowed_series_count.max =
maximum_series_voltage_v / nominal_voltage_v` requires a positive, exact safe
integer voltage-class ratio. The series result is permission inferred from a
published constraint, not a recommendation to build that bank. Charging or
float voltage cannot enter this calculation, and a fractional quotient is not
floored. Existing battery-series advisories continue independently.

Each calculated semantic proposal, separate provisional calculated ProductFact,
and candidate `derived_fields` entry records
the rule version, formula, input field paths, qualified source fact IDs, durable
candidate ProductFact IDs, units, and assumptions. The approval snapshot binds
this metadata so changing a rule, input, or assumption after review invalidates
the approval. Promotion includes `derived_fields` only for selected calculated
fields and carries every input ProductFact and source reference into the
promoted provenance. A directly published usable capacity or series count takes precedence;
the calculation becomes a consistency check. A disagreement creates a
conflicting proposal and blocks candidate promotion pending human review.
Candidate projection requires both published input proposals to have projected
successfully, so a calculation cannot bypass source or normalization checks.
The calculated ProductFact has its own ID and field evidence; its raw value is
the calculation output rather than manufacturer wording. Its `derivation`
property contains resolvable ProductFact input IDs plus the original
QualifiedFact IDs, and its `Derived:` label prevents it from masquerading as a
published fact. A derived series-count object's `min: 1` is only the structural
lower bound of a positive count range; it is not an independently published
manufacturer minimum. The derived `max` is the value supported by the
published voltage relationship, and neither value recommends series operation.
Structured values such as voltage ranges and series-count bounds retain one
parent field evidence binding, since their min and max are one atomic assertion.
The atomic review rule is scoped to production bridge candidates; persisted
direct-ingestion pilot reports keep their existing validation semantics.

## Current boundaries

Resistance lacks a measurement definition (for example AC impedance versus DC
internal resistance and test conditions). Self-discharge needs a rate period,
temperature, and possibly state-of-charge basis. Cycle life needs DoD,
temperature, end-of-life criterion, and test regime. These remain source
evidence until a qualified representation can carry the relevant conditions;
none is copied into an unqualified scalar. `Ah PbEq` remains a marketing
equivalence. Group size is a form-factor designation, not body dimensions.
The optional schema fields here are source-spec fields, not installed-system
engineering defaults or safety findings.
