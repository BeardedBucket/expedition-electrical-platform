# Product selection (Phase 5)

Phase 6 now consumes this exact boundary; see [Recommendation](RECOMMENDATION.md).
Its additive `project_demand_schedules` handoff input supplies explicit Phase 3
accounting for existing requirement-owned demand endpoints when Phase 4 supplied
no schedule. Duplicate/unknown demand IDs or replacement of an existing schedule
reject. Identical existing schedules remain allowed with every upstream unresolved
condition retained. Endpoint identity/domain/required W and Phase 4/5 artifacts,
gates, revisions and fixed intents remain unchanged. No default schedule, product
record, generated assumption, dispatch or shared-capacity conclusion is introduced.
The recommendation source and exact passport retain the explicit late accounting.
Generic Phase 3 `schedule_provenance: { origin: 'evaluation_input' }` identifies late
timing independently of endpoint requirement provenance. Upstream schedules retain
`{ origin: 'requirement', requirement_id, pointer }` with the actual `/schedule`
locator, including identical late repetitions. Decisions and calculations preserve
both origins; missing provenance stays unknown. Existing handoff calls retain
their engineering behavior. Phase 3's trace revision is `1.3.0` with schema `2.0.0`.

Phase 5 is the parts picker. It evaluates every supplied canonical record against
each mandatory Phase 4 product role. Demand endpoints remain requirement-owned,
without appliance selection slots. Architecture composition, role counts, shared
domains and combined/separate functions remain Phase 4 authority. Phase 6 owns
tradeoffs and recommendations. Price, weight, manufacturer, ecosystem, inventory,
advisories, popularity and optional features supply no eligibility authority.

## Contracts and authority

The dedicated Node entry `@expedition/engineering-core/product-selection` exports
`evaluateProductSelection`, `serializeProductSelection`, `parseProductSelection`,
`replayProductSelection`, `bindProductSelection`, the policy and typed contracts.
It is absent from the browser index. Evaluation accepts a complete reconstructible
Phase 4 generation, a candidate ID, explicit canonical corpus, strict fixed-existing
intents and explicit homogeneous assembly intents. No filesystem, network, clock,
randomness, ingestion mutation, UI state or overlay enters evaluation.

Selector revision `product-selection/1.0.0`, input/output/policy schemas `1.0.0`
and policy revision `1.0.0` bind interpretation. The policy remains draft; running
tests or evaluating products does not approve it. Records retain their own review
status and source references. Like Phase 3, only `verification_status: verified`
permits canonical values to enter definitive engineering interpretation. Source
presence, raw text, provisional extraction, confidence and fuzzy matching do not.
Verified means the supplied canonical trust boundary, not certification by selection.

For each mandatory predicate:

| Truth   | Meaning                                                                        |
| ------- | ------------------------------------------------------------------------------ |
| YES     | Authoritative applicable evidence positively supports this requirement.        |
| NO      | Authoritative applicable evidence positively contradicts this requirement.     |
| UNKNOWN | Missing, withheld, unbound or context-unresolved evidence cannot prove either. |

Any NO makes a witness BLOCKED. Otherwise any UNKNOWN or unresolved required
upstream capacity makes it UNRESOLVED. Only all YES with resolved required upstream
capacity makes it ELIGIBLE. Every gate executes and remains retained after blockers.
A product is eligible if **one complete witness** is eligible; otherwise it is
unresolved if a witness remains unresolved, otherwise blocked. Truths from separate
witnesses are never combined. Symbolic unresolved assembly generation is separately
identified and does not assert counts, evaluated gates or a concrete binding.

Role `output_capacity` with `scope: required_output_sizing` and unresolved status
remains gating. Every lower-bound W predicate still executes. No sum, maximum-as-final
rating, schedule overlap, diversity or efficiency resolves that upstream condition.
Other typed capacity scopes remain separately deferred; current `storage_dispatch`
creates no discharge W gate. Missing individual W does not create a zero-W predicate.
All Phase 4 structural dependencies remain in the embedded generation and exact
downstream handoff. Optional/deferred observations never become mandatory merely
because they are missing, explicitly false or poorly reviewed.

## Exact product witnesses and canonical additions

Witnesses map abstract interfaces to exact canonical port IDs and required paths to
exact directed canonical path IDs. Finite exhaustive port assignments and matching
path alternatives retain all evidence and contradictions. A null marks an unavailable
interface/path witness; it supplies UNKNOWN, never an invented port. A multifunction
combined role uses one record and mutually consistent interfaces/paths for both
functions. Separate roles stay separate model alternatives, and exact handoff assigns
a distinct physical instance identity to each role even when the same model is used.

The typed evaluator registry covers capability, interface domain/direction, nominal
V, AC Hz, output W, nominal storage Wh, directed path, distinct interfaces and isolation.
A new predicate adds its localized interpreter and boundary tests; it must first exist
in the authoritative Phase 4 contract. Output W comes only from the bound output port.
Product headline W or other paths/ports cannot supply it. The shared Phase 3 pure
`includesValue`/`maximum` interpretation supplies nominal scalar/range checks.

Modeled port constraints are preserved and conservatively prevent numerical gates
from asserting applicability. Temperature, operating-mode, voltage/source and other
conditional ratings need future typed interpreters; they are not guessed or discarded.
Path isolation is a path-local fact, not proof of installed isolation across parallel
routes. Phase 3 continues to withhold that installed assertion.

Three optional canonical representations close discovered model gaps:

- `unsupported_capabilities`: explicit source-backed negative types. Missing positive
  entries remain unknown. Conflicting positive/negative assertions are rejected.
- Capability `port_ids`: when supplied, binding authority for every owned directed
  path's endpoints. Canonical validation rejects excluded participants; witness
  interpretation also checks this generically. An exact canonical power path can
  establish association without a list, but no participants are inferred without
  an exact relationship. Storage capability must explicitly refer to its bound
  storage ports; missing association remains unresolved.
- Power-path `isolated`: explicit true/false assertion; omission stays unknown.

Canonical `category` becomes optional metadata; missing classification cannot reject
an otherwise proven product. Promotion retains its independent explicit classification
review requirement. Existing records remain valid without edits. There is no production
specification change, fabricated negative assertion, migration or manufacturer exception.

Evidence snapshots use Phase 3's examined-evidence shape: exact component/digest,
member/field path, canonical value, accepted/withheld state, review state, original
record source references and available derivation lineage. Record-level references
do not fabricate field-specific attribution. Native wording/units unavailable in
canonical data remain explicitly not retained, rather than being reconstructed.
Canonical assertions do not automatically mean manufacturer-published facts.

## Fixed equipment and storage assemblies

Fixed-existing intent restricts that role to its exact model and optional exact bank
counts. It uses identical gates and may be eligible, blocked or unresolved. Missing
owned records retain intent with `fixed_component_record_missing` and no fabricated
record/witness. Other roles remain selectable. Preferred-if-possible is not implemented.
Each absent fixed record still retains every mandatory UNKNOWN gate with empty evidence
and null interface/path identities, plus unknown stacking gates for explicit bank counts.
Missing fixed products and null interface/path witnesses cannot form an exact installed
handoff; the adapter rejects them while the portable selection remains available for
upstream resolution. No replacement or architecture repair occurs.

A fixed role cannot also occur in standalone `assemblies`; its counts belong on
the fixed binding. Duplicate explicit role/model/kind/count intents reject before
evaluation. Different count or model alternatives for a nonfixed role remain valid.
An explicit intent matching an automatically generated candidate reuses that result;
this does not authorize duplicate user input. Admission limits still apply first.

Homogeneous assembly ownership binds exact model, series and parallel counts. Explicit
assemblies permit testing contradictions; fixed assemblies preserve owned counts.
Automatic generation retains the direct unit and at most one useful minimum assembly
per model, derived only when authoritative scalar nominal unit V and applicable unit
Wh (direct or V × Ah) establish a unique positive integer series ratio and minimum
positive parallel count for all current nominal energy predicates. An authoritative
parallel permission minimum can raise the minimum interconnected
bank count above the energy-only count. A native single unit introduces no interconnection.
For that fixed series ratio every larger parallel count adds no mandatory engineering feasibility: only nominal
V/Wh are current storage requirements. It is a reduction of alternatives, not preference.
No source/load/dispatch power participates. A noninteger ratio cannot satisfy the exact
homogeneous scalar voltage target. Unknown scalar/reduction inputs retain a symbolic
unresolved assembly instead of enumerating arbitrary quantities. An explicit reviewed
absence of energy storage cannot be overcome by symbolic assembly generation.

Counts above one on an axis require reviewed `allowed_series_count` or
`allowed_parallel_count` respectively. Missing permission is UNKNOWN; an authoritative
range excluding the count is NO. An axis of count one introduces no inter-unit connection
and needs no stacking permission at this selection boundary. Phase 3's selected-bank
contract independently retains its stricter complete count-permission/Ah requirements;
selection eligibility cannot approve a bank installation. Calculations use the same
nominal identities as `deriveBatteryBank`, but retain arithmetic independently of
permission so unknown permissions do not erase reviewable proposed bank arithmetic.
Bank voltage = unit port voltage × series count; Ah = unit Ah × parallel count;
Wh = unit Wh × series × parallel. Missing inputs produce no calculation. Every calculation
is `derived`, with exact inputs, formula, unit and input evidence. Calculated bank values
never become manufacturer-published facts. The assembly discriminant/model/count owner
can be extended to a separately modeled heterogeneous assembly; none is implemented.

## Portability, bounds and failure ownership

Results embed independent exact input/policy snapshots, canonical corpus sorted by ID,
candidate digest, selector revision, all roles/witnesses/gates, upstream and deferred
capacity and complete evidence/calculations. Sorting is code-point order for serialization,
without engineering meaning. Corpus is a supplied set; record order does not alter the
artifact. Changes to record content, Phase 4 input/provenance or policy change identity.
Unrelated membership changes the corpus identity but not another model's evaluation.

Closed input/policy/envelope schemas reject unsupported channels. Nested result semantics
are checked by complete deterministic reconstruction rather than duplicating every
Phase 4 and evidence schema. Hashes provide content identity only. Rehashed changes to
gates, reasons, witness, provenance or calculations fail reconstruction. External replay
also requires the exact live generation/corpus/intents/policy; embedded snapshots do
not authenticate review or source facts. Serialized edits to authoritative inputs are
new inputs and cannot be detected as tampering without external replay identity.

The policy bounds 512 supplied records, 4,096 witnesses per concrete model/assembly,
100,000 total witness evaluations and 1,024 units per explicit/generated assembly.
Explicit assembly-intent admission shares the total-work bound, including duplicates.
These are deliberately conservative application limits without measured production
tuning, not safety/standards values. Per-model bounds control Cartesian growth; total
bounds control retained gates/evidence across roles; unit bounds avoid pathological
counts/arithmetic. Phase 4 separately owns role/input cardinality. Configurable positive
safe-integer limits can be revised with supported workloads and resource measurements.
Limits reject with an exception, never truncate legitimate products or alternatives.
Each evaluation owns all mutable work and fresh JSON copies; an exception returns no
partial artifact. No async/race/cancellation resource ownership is introduced.

## Exact Phase 3 handoff and corpus follow-up

`bindProductSelection` requires an explicit exact witness for every mandatory role.
It preserves Phase 4 domains/edges/routes and endpoint W/schedules, and uses only real
selected product records. It cannot silently pick a better witness, merge roles or reuse
one physical instance. Optional application device schedules/evaluation horizon are
explicit inputs; no baseline schedule is inserted.

The post-selector audit found Phase 3 required a product port even for project-owned
demand. The additive `project_demands` contract now owns endpoint/domain, exact W,
schedule and direct requirement ID/JSON pointer provenance. Endpoints
resolve topology routes directly and are prohibited from serving as wire sources.
They never become component instances or examined manufacturer evidence. Explicit
schedule W is used; active states may use that endpoint's explicit required W; other
states have no power fallback. Missing W/schedules/duration/horizon remain incomplete.
Existing exclusive-state arithmetic is reused for device-side energy, with separate
project-demand unresolved contributions and trace. No concurrency/dispatch is inferred.

The handoff copies genuine upstream assumptions unchanged and creates none for
explicit requirements. Demand/decision/calculation inputs retain the exact requirement
locator, with empty manufacturer evidence. Optional `provenance.assumption_ids` cite
only genuine dependencies and must resolve in the input assumptions. Requirement
ID/pointer are direct source locators, not references to a separate Phase 3 registry;
Phase 5 reconstructs their Phase 4 origin, while standalone Phase 3 accepts explicit
project input without certifying an unavailable external requirement document.

Generic `mandatory_conditions` carry inherited blocked/unresolved conditions; satisfied
labels are prohibited so a hash/label cannot replace supporting evidence. The handoff
includes each chosen witness's failure/unknown and Phase 4's structural unknowns/blockers.
Model-level aggregate diagnostics retain all witnesses; inherited reason codes use
only the selected binding's non-YES normal/assembly gates and required upstream
capacity dependencies, deduplicated and sorted. The condition ID retains the role;
its `subject_id` is the exact selected binding ID. Unselected and YES reasons never
become installed-system failure provenance. Phase 3 interprets the generic condition
contract without a Phase 5 special case.
Project demands can establish scheduled energy without resolving Phase 4's unsupported
source dispatch or other mandatory scopes. Passport schema stays `2.0.0` with additive
optional inputs; evaluator/rule revision is `1.3.0` including independent schedule
attribution in portable decisions/calculations. Old valid input behavior is
preserved, but older evaluator artifacts must not be silently replayed as the new revision.

Reason codes distinguish actual mismatch, explicit negative capability, fact missing,
non-authoritative evidence, contextual rating, missing binding, upstream requirements,
missing fixed record, assembly permission and unsupported reduction. They permit later
corpus coverage metrics by role/predicate and unresolved class. They do not claim facts
were unpublished, not ingested or not mapped when canonical provenance cannot establish
that cause. Large corpus expansion, contextual interpreters, heterogeneous banks,
recommendation/ranking, installed safety and Phase 6 remain outside this milestone.
