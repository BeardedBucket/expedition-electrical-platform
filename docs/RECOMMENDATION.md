# Recommendation and tradeoffs (Phase 6)

The Node-only `@expedition/engineering-core/recommendation` entry exports
`evaluateRecommendation`, `serializeRecommendation`, `parseRecommendation`,
`replayRecommendation`, `recommendationPolicy` and portable TypeScript contracts.
The browser/core index remains unchanged. Runtime evaluation performs no file,
network, clock, randomness, locale-sensitive ordering or ambient builder lookup.

Phase 6 compares explicit exact engineering options. Phase 4 owns requirements,
roles and topology; Phase 5 owns retained witnesses and mandatory gate truth;
Phase 3 owns exact system evaluation. Preference owns none of those decisions.
Input/output/profile/policy contracts and policy revision are `1.0.0`; engine
revision is `recommendation/1.0.0`. The project policy is draft. Evaluation does
not approve it, product facts, installed systems or advisory evidence.

## Exact option construction

Each source contains one fully reconstructible `ProductSelectionResult` and
explicit Phase 3 handoff options. Multiple sources permit cross-architecture
comparison without changing any architecture. A `SystemOptionChoice` names the
exact selection digest and one retained binding for every mandatory role,
including exact homogeneous bank counts where applicable. Explicit choices
can include blocked bindings for excluded analysis. Unknown selection identity,
duplicate choices, missing roles, substitutions outside fixed intent and
missing/null witness identity reject.

The pipeline is existing `bindProductSelection` → existing
`evaluateInstalledSystem` → complete Engineering Passport → tradeoff facts →
comparison. No second engineering evaluator exists. Exact selected records,
Phase 4 requirement-owned endpoints, domains, routes and mandatory conditions
reach Phase 3 unchanged. Separate roles have separate physical instance IDs even
when their model is identical; combined roles stay one role. Bank multiplicity
is an explicit physical unit count, not several invented roles.

`construction.mode: automatic` takes the complete Cartesian product of every
retained exact ELIGIBLE or UNRESOLVED binding in each source. BLOCKED witnesses
are excluded from automatic construction, but remain in the embedded selection.
There is no preference input to the choice constructor, top-N, sampling,
availability filter or witness union. Every exact option is evaluated by Phase 3
before any preference relation is computed. This is exhaustive over supplied
Phase 5 alternatives, including that layer's assembly reduction, not an assertion
that every imaginable design or bank count was explored.

BigInt preflight computes the full product/sum and conservative all-option pair
count. If either option or pair budget is exceeded, automatic construction
returns `option_space_bound_exceeded`, the exact decimal count, role counts,
bounds, no partial exact options, and retained deferred analysis. Callers can
supply an intentional explicit complete choice set instead. Explicit admission
overflow throws. A zero-choice role makes the complete product empty; it is
checked before allocating any prefix combinations. Iterative construction avoids
recursion depth depending on role count. No bound changes feasibility.

Unmaterializable unresolved candidates remain in `deferred`: missing fixed
records, null interface/path identities and symbolic assembly generation. Each
entry retains its exact selection digest, role, candidate snapshot, binding ID
when one exists, construction reasons and selected Phase 5 non-YES reasons.
Symbolic candidates have no evaluated binding or invented count. These entries
never enter an exact-system front and are retained even when another role or an
option-space bound prevents complete construction.

## Late exact demand accounting

Inspection found a Phase 5 handoff limitation: it admitted exact device schedules
but could only obtain requirement-owned endpoint schedules from Phase 4. Phase 4
deliberately retains supplied schedule interpretation as unresolved, while Phase 3
requires explicit schedules for complete energy accounting. Phase 6 cannot remove
that upstream condition or relabel the result.

The additive handoff option `project_demand_schedules` supplies explicit Phase 3
endpoint accounting when the upstream endpoint has no schedule. It identifies
existing demand IDs and explicit states/durations/optional state W. It changes
neither endpoint identity, domain, required delivered W nor upstream predicates.
Unknown demand IDs, duplicate schedules or replacement of an existing upstream
schedule reject. Supplying an identical upstream schedule is permitted and retains
all inherited conditions, including `schedule_energy_unmodeled`. Missing timing
still yields incomplete Phase 3 accounting. No schedule is inferred from text,
price, preference, product capability or a default horizon.

Endpoint provenance continues to locate the original requirement and its exact
power/domain, not to claim that late scheduling was present at that locator.
The generic Phase 3 `schedule_provenance` independently labels late timing
`{ origin: 'evaluation_input' }`, without an invented external citation. Existing
upstream timing receives `{ origin: 'requirement', requirement_id, pointer }`,
where `pointer` locates the original requirement's `/schedule`. Identical late
repetition retains upstream ownership. Missing provenance remains unknown, and
legacy omission is exposed as `{ origin: 'unknown' }` in the trace. Schedule values
remain separate from both provenance objects. The passport alone preserves this
distinction in its exact input, project-demand decisions and resolved schedule-energy
calculation inputs. No manufacturer fact, appliance record or generated assumption
is created. The reusable ownership check executes before expansion, including
bounded or empty option spaces.

Phase 3's optional input schema addition preserves schema `2.0.0`; evaluator and
rule revisions move together to `1.3.0` because portable trace semantics change.
Phase 5 artifact/schema/revision remains unchanged because selection does not
consume this downstream input. Phase 6 remains the uncommitted `1.0.0` milestone.
Existing valid callers retain numerical and engineering behavior. Origin participates
in exact identity and full reconstruction at both layers; rehashed input/trace edits
reject. A coherently evaluated new standalone project input remains a new valid
artifact, not authenticated source evidence. Recommendation reconstructs its
authoritative upstream handoff, and external replay also compares exact live inputs.

## Engineering classes and advisory governance

Each option copies the verbatim passport `result.status`: `satisfied`, `unresolved`
or `blocked`. Passport assertion scope, installation safety `not_evaluated`, rule
lifecycle, decisions, warnings, unknowns and exact selection gates remain portable.
All-YES Phase 5 bindings alone cannot create a satisfied Phase 3 system.
Missing price, weight or optional capability has no engineering authority.

`fronts.satisfied` and `fronts.unresolved` are independent arrays of fronts.
The first satisfied front is the current confirmed recommendation set within
the passport's declared scope. It can contain multiple options; no tie breaker
selects one. With no satisfied options, unresolved fronts remain explicitly
unresolved alternatives. Blocked options stay in `options` with complete passports,
facts and engineering exclusions, but never appear in either front. There are no
cross-class preference comparisons or flattened engineering/preference scores.

The existing mature `evaluateComponentAdvisories` evaluator runs on each distinct
selected model when explicit advisory records, evidence, timestamp and configuration
are supplied. Its full assessments/trace/warnings remain visible. Existing
suppression/exclusion actions govern recommendation admission separately; they
never change a gate, canonical fact or passport status. Caution remains visible
and admitted. Missing advisory context produces an UNKNOWN advisory fact and
`advisory_context_missing`, not an assertion that no advisories exist. Explicit
empty context means only no applicable advisory in that supplied snapshot.

Advisory date arithmetic accepts explicit timezones or ISO date-only values
(date-only parsing is UTC); the evaluation timestamp itself requires a timezone.
No wall clock is consulted. Existing advisory validation/evidence policy is reused;
Phase 6 does not publish or upgrade findings. Canonical advisory references and
passport review warnings remain intact even when no assessment context is supplied.

## Structured facts and completeness

`TradeoffFact` retains semantic kind, stable fact/option identity, system or
role/model/physical-quantity subject, explicit state/value, unit, direct/derived
identity, completeness and ownership/provenance. States are `known`, `absent`,
`unknown` and `not_applicable`. Missing numeric facts have no numeric value.
Explicit zero and false remain explicit. Absent differs from unobserved; NA differs
from both and cannot establish a priority-tier tie.

Provenance binds exact snapshots, JSON-pointer locators, review state, supplied
source references and available product derivation metadata. Canonical product
assertions are not automatically manufacturer-published assertions. Unverified
weight, dimensions and optional capability observations remain withheld from
definite preference interpretation. Original units/wording unavailable in the
canonical record are explicitly `not_retained_in_canonical_record`; Phase 6 does
not reconstruct them from ingestion. Record-level sources do not invent field-level
attribution. Metadata manufacturer identity remains descriptive exact input identity,
with its review state retained; empty identity is unknown.

Derived facts retain formulas, exact fact inputs with multiplicity or exact
source inputs with locators/values/units, per-unit known subtotals and unresolved
contributors. Product derivations remain distinct from new system calculations.
Arithmetic overflow rejects instead of publishing an infinite value. Exact input
and result snapshots remain independent of mutable caller-owned objects.

Supported initial facts/dimensions are:

| Kind                      | Ownership and interpretation                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purchase cost             | Explicit per-physical-unit commercial/user/builder observations; never product engineering evidence.                                                               |
| Weight                    | Existing `weight_kg` canonical fact, preserved in kg; exact bank/role quantities multiply it. No schema extension was necessary.                                   |
| Dimensions                | Individual `dimensions_mm` and each qualified body assertion with full exclusions/qualifiers. Never summed into system L/W/H, fit or installation envelope.        |
| Physical component count  | Actual selected single-device instances plus homogeneous bank unit multiplicity. Requirement-only demand is not a device.                                          |
| Existing reuse            | Count only explicit fixed-existing bound physical units. Matching manufacturer/model establishes no ownership.                                                     |
| Manufacturer count        | Distinct exact nonempty supplied identity strings, descriptive unless explicitly preferred. No fuzzy identity/brand scoring.                                       |
| Selected power path count | Number of exact selected functional paths across roles. A measurable proxy, not subjective complexity, route depth, installed integration or concurrent operation. |
| Optional capabilities     | Reviewed explicit canonical positive/negative capability assertions. Incomplete positive lists cannot prove absence.                                               |
| Optional features         | Explicit boolean/absent/unknown/NA user/commercial/builder observations at the narrow extension seam. No canonical override.                                       |
| Advisory context          | Separately owned existing advisory evaluation over explicit snapshots, preserving source/evidence and governance actions.                                          |

Optional capability system facts mean an explicitly present function exists on
at least one selected product. They do not establish installed CAN compatibility,
battery telemetry, monitoring target, protocol connectivity or an integrated
ecosystem. A separate selected product can supply the generic monitoring function.
Without a positive assertion, all applicable products must explicitly assert absence
to prove absence; any unknown withholds that conclusion. An existential positive
can be complete while other component observations remain unknown: those unknown
contributors stay visible and are not interpreted as absent. Arbitrary optional
feature observations use the same explicitly documented existential availability
semantics, with product facts retained individually. Specific system integration
requires a future generic interpreter with evidence, rather than a product name.

`preference_data.completeness` measures data for the explicit active criteria,
independently of engineering status. An empty profile requires no preference
comparison data. Descriptive facts can still have their own incomplete state.
Component-level reason codes and aggregate contributors expose missing price,
weight, unknown capabilities, mixed currencies and incomplete comparisons without
claiming a publication/ingestion cause.

## Cost, currency and totals

Prices are explicit snapshots identified by component ID, amount, three-uppercase-
letter currency token and source owner/reference/context. One selected observation
per model rejects ambiguity; callers resolve quotes upstream. Timestamps survive
only when explicitly supplied. The currency token is an exact unit identifier,
not validation against a live currency list. There is no FX interpreter or lookup.
Package pricing, tax, shipping and quotes for an aggregate bank must be translated
into an explicit supported per-unit basis upstream, never inferred.

Fixed equipment still requires a price or explicit `owned_no_incremental_acquisition_cost`
basis scoped to selection digest and fixed role. Only that explicit basis supplies
zero incremental acquisition cost for the project, with explicit currency/source.
It cannot apply to nonfixed equipment or authorize replacement. It overrides a
generic per-unit purchase quote only for that already-owned role.

For price/weight, aggregation is `sum(per_unit_value * physical_quantity)`.
Incomplete results have UNKNOWN state, independently grouped `known_subtotals`,
and `unresolved_contributors`; no total value is published. Different currencies
are never added: their subtotals remain separate and the overall cost is unknown
with `mixed_currency`. Complete totals require every contribution and a single
compatible unit/currency. Different complete single-currency options cannot be
compared numerically across currency units. A zero-component cost has no currency
basis and remains unknown; an empty physical weight sum is explicitly zero kg.
Dimensions have no numeric system aggregation.

## Preference profile, pairs and fronts

A versioned explicit profile contains ordered tiers of equal-priority criteria.
Numeric criteria explicitly `minimize` or `maximize`; optional availability criteria
explicitly `prefer_present` or `prefer_absent`. Empty tiers reject; an entirely
empty profile is valid and makes every same-class pair tied. Duplicate dimensions,
unknown syntax, weights/scores, brand defaults and hard `must` requirements reject.
Real mandatory changes belong upstream and require regeneration/reselection.

Each pair retains exact option IDs and common engineering status, every criterion,
fact IDs, tier, dimension relation and reason, plus final relation and decisive
tier. Relations are `preferred`, `worse`, `tied`, `incomparable`. All criteria stay
inspectable, including lower tiers that were not authoritative after comparison
stopped. Structured records, not generated prose, are truth.

Within one tier, complete comparable equality ties. Wins without losses dominate;
opposing wins remain an incomparable tradeoff. Any unknown, NA, incompatible type
or currency unit withholds a definite tier conclusion. Lower tiers participate
only after complete genuine higher-tier equality. They cannot resolve a higher
unknown or tradeoff. No unknown is best/worst or equal by convenience.

Front construction retains all non-dominated admitted options, removes that front
and repeats over the remaining same-class set. It has no scalar score. Cycles
reject rather than invent ordering. Code-point sorting stabilizes serialization
only; it never resolves a tie. Source/choice/equal-tier criteria are set-like and
normalized; priority tier order, source handoff content and upstream snapshots
remain exact. Adding an option does not change an existing pair's truth; fronts
can change only through dominance relationships. New upstream selection content
intentionally changes selection/option identities, even when numerical facts tie.

## Operational bounds, portability and extension ownership

Policy defaults are 16 selection sources, 128 exact options, 8,128 possible pairs
(`128 * 127 / 2`), 32 criteria, 4,096 observations/accounting states and 100,000
tradeoff fact records. These are conservative configurable positive safe-integer
application budgets without measured production tuning, not electrical safety
limits or corpus facts. Observations include supplied price/ownership/features,
advisory/evidence records and exact device/demand schedule states. Fact-count
preflight independently controls options × roles × feature cardinality. It rejects
overflow before materialization. Automatic option/pair overflow reports; all other
admission/semantic failures throw atomically with no partial artifact.

Input source/reference/context/ID strings are bounded at 4,096/512 characters;
policy source-reference membership is bounded at 16. These conservative metadata
bounds have no empirical tuning and are independently owned by the Phase 6 schema.
Existing Phase 3/4/5 schemas retain their own limits. Revisit budgets only with
supported larger projects and measured memory/work/storage requirements. Increasing
one budget does not silently lift another, and no limit uses preferences to prune.

The envelope binds normalized exact input/profile/context/handoff/selection snapshots,
policy content/digest and engine revision. Each option has stable exact engineering
identity derived from its selection/choice and passport digest; `option_digest`
additionally binds its facts and advisory/preference data. Facts have stable
option/kind/subject identity; their content is bound by the option/envelope digests.
Loading reconstructs the complete Phase 5 selection, exact Phase 3 evaluations,
facts, comparisons, fronts, exclusions, deferred membership and traces. Rehashed
semantic edits cannot substitute for reproducibility. External replay additionally
requires unchanged live selection/corpus/choice/profile/context/policy identity.
Hashes are content identities, not authenticity, approval, evidence or signatures.
Coherently changed authoritative inputs are new inputs; external replay distinguishes
them from the previous snapshot.

Builder price/feature ownership is explicit. The legacy builder ranker has hidden
weights/defaults/unknown ranking and lacks this exact portable-system boundary,
so it is not imported into Phase 6. Inventory/profile interpretation remains a narrow
future extension; no ambient tenant or builder state is consumed. New optional
facts can extend the semantic kinds/interpreters and tests without changing
engineering authority. Mature advisory interpretation is reused, not recreated.
Expanded canonical corpora flow through the existing Phase 5 contracts without
record migration or recommendation redesign; bounds can report larger spaces.

Phase 7 may adapt these portable semantics into a stable application boundary.
No app DTO, badges, cards, sorting dropdowns, customer wording, UI/embed behavior,
certification, installed-fit solver, mandatory preference filters or production
corpus expansion is included here.
