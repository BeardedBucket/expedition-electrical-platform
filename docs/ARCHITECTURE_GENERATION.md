# Architecture generation (Phase 4)

[Phase 6 recommendation](RECOMMENDATION.md) compares exact downstream systems
without changing this layer's roles, topology or mandatory conditions. Supplying
late Phase 3 accounting never resolves Phase 4's existing schedule/shared-capacity
interpretation or becomes a preference-owned engineering requirement.

The implemented downstream [Phase 5 selector](PRODUCT_SELECTION.md) consumes
this v2 contract without changing role count, topology, capacity or demand authority.
Its exact Phase 3 handoff retains requirement-owned demand without appliance records.

Phase 4 transforms explicit end-system requirements into abstract electrical
architectures and required product-role predicates. It generates the engineering
filters. It does not apply them to products, choose an exact binding, or recommend
an architecture. A corpus coverage gap belongs to Phase 5 and cannot change the
electrical structure generated here.

The implemented pipeline is requirements → demand endpoints → bounded architecture choices →
domains and directed routes → required product/assembly roles and their predicates
→ nominal structural evaluation. Future
Phase 5 applies real product evidence to the predicates and supplies an exact
installed architecture to Phase 3. Future Phase 6 compares bindings and tradeoffs.

## API and input ownership

The Node-only `@expedition/engineering-core/architecture-generation` entry point
exports `generateArchitectures`, `serializeArchitectureGeneration`,
`parseArchitectureGeneration`, `replayArchitectureGeneration`,
`architectureGenerationPolicy` and the typed contracts. It is absent from the
browser index and has no runtime component-library, ingestion, advisory,
builder, recommendation, filesystem, network, clock or randomness dependency.
The only Node primitive in generation is SHA-256 content hashing.

`ArchitectureGenerationInput` schema 2.0.0 preserves exact `requirements` and
explicit `PassportAssumption` entries. The legacy recommendation `Requirements`
requires a fixed voltage and lacks load domains; Phase 3's requirements address
already-bound ports and routes. Neither is silently adapted into end-system
intent. This additive boundary keeps those existing consumers unchanged.

Requirements have an ID, optional fixed house voltage, explicit load domains,
individual delivered load powers, charging source contexts/domains, and optional
storage intent/nominal energy. Source charge power is explicitly **house-side
delivered output**, not alternator, PV or shore capacity. Load power is an
individual delivered requirement, not an assertion of simultaneous operation.
Optional schedules and autonomy are retained as unresolved interpretation in
this revision. Unsupported installation/environment/source-availability requests
have structured kind/statement entries and remain unresolved.

AC voltage and Hz must be supplied for a resolved domain. Missing DC/PV voltage,
load/charging output power, storage intent or requested storage capacity stays
unknown. Explicit zero W/Wh remains explicit zero. Invalid/nonpositive V/Hz,
negative W/Wh, duplicate requirement IDs, nonportable JSON and unknown keys are
rejected; they are not engineering contradictions silently discarded from a list.
Known contradictory declarations, such as DC frequency, a solar source declared
as ordinary DC, or absent storage with a storage-capacity requirement, produce
visible blocked candidates. Explicitly unsupported interpretation stays unresolved.

Text assumptions are preserved but never parsed into numbers or topology.
`used_assumption_ids` is empty, with an input-level warning when assumptions were
supplied. The policy's nominal interpretation is a generation rule, not an invented
manufacturer assertion or a guessed efficiency/reserve value.

## Policy, bounds and deterministic expansion

`data/rules/architecture-generation.json` is a **draft project policy** under the
existing rule lifecycle vocabulary, with a closed policy schema and rationale.
12/24/48 V are the project's mobile/off-grid exploration families, consistent
with the charter and current voltage comparison presentation. They are not an
industry standard, preference ordering, or manufacturer-derived default.
Policy data explicitly enables differing-voltage DC load conversion and separate
or combined inversion/shore-charging functions. No product availability is read.

The voltage and arrangement arrays are set-like: duplicate dimensions collapse
before topology allocation. Numeric voltage ordering and code-point arrangement
ordering provide reproducible iteration, not ranking. An explicitly fixed voltage
is the sole voltage choice. If policy excludes it, a blocked candidate preserves
that contradiction instead of substituting another voltage.

Generation searches only voltage × AC functional arrangement. This revision
combines functions when exactly one AC functional demand group and one shore source
exist. Multiple compatible AC endpoints can belong to that group. Otherwise
separate functional roles are generated and inapplicable arrangements collapse.
If both functions exist with unsupported multiple-domain/source cardinality and a
combined-only policy, a separate diagnostic topology is retained **unresolved**;
it does not assert that the requested combination has been implemented. There is
no arbitrary pairing or Cartesian product over loads. Policy explicitly selects
`load_supply_arrangement: shared_compatible_domains`: one deterministic partition,
not another expansion dimension. Complete equal DC V or AC V/Hz domains share;
explicit isolation, unknown compatibility and PV consumption retain dedicated
boundaries. Domain grouping is independent of power, schedules and corpus.

The policy admission bounds are at most 64 loads and 16 charging sources; the
schema admits at most 16 voltage entries and two arrangement entries. The maximum
32 candidates follows directly from those dimensions. Policies can narrow these
bounds. All limits are conservative application operating limits without measured
production evidence, not safety thresholds or electrical standards. Linear role,
edge and trace growth per candidate is bounded by load/source admission. Revisit
them if a supported requirements corpus or operational measurements justify more
capacity. Exceeding input bounds or the unique candidate expansion budget rejects
before candidate construction, never silently truncates alternatives.

The input schema also limits IDs to 128 characters, descriptions/statements to
4096 characters, schedules to 64 states per load, assumptions/unsupported requests
to 64 entries, and policy source references to 16. These are conservative metadata
and retained-input bounds without empirical production tuning. Output IDs have
512-character headroom for namespaced input identities. These bounds are separate
from candidate counts and electrical interpretation and should change only with
supported larger inputs. They are not ingestion/parser transport limits.

`expansion.explored` records raw policy combinations considered, including repeated
and inapplicable dimensions; `deduplicated` is that count minus retained candidates.
The admission budget applies to unique supported combinations allocated, so raw
considered combinations may exceed a narrowed candidate budget. A final digest-keyed
map additionally prevents equivalent constructed candidates being repeated.
`complete: true` means complete within this implemented bounded transformation
set, not exhaustive enumeration of all possible electrical designs.

## Domains, roles and paths

Every load becomes an `ArchitectureDemandEndpoint` with its own identity,
`source_requirement_id`, known W, exact schedule, optional isolation and provenance.
`kind: end_use_demand` and `product_binding: not_required` distinguish it from a
mandatory product slot. Its `domain_id` resolves the retained electrical domain;
a directed branch wire and supply route establish its connection. No catalog load
record is required. A future application can associate an exact product with a
stable endpoint ID independently; this revision implements no such association.

One compatible target group owns a shared domain and, when needed, one conversion
or inversion role. Role/domain identities hash the full domain tuple (plus the
load identity for a dedicated boundary), independent of endpoint count/power.
Members and groups are code-point sorted; original array indexes remain in exact
provenance. A native DC group gets direct nominal continuity without a converter.
Known differing or explicitly isolated DC gets a conversion boundary; AC gets
inversion. Unknown DC voltage retains unresolved provisional direct continuity.
Shared output edges precede independent endpoint branch edges. These abstract
wires assert nominal connectivity, not panel, conductor or protection design.

Shared roles retain every independently known load W as a separate output-side
lower-bound predicate with original provenance. They never sum, select a maximum
as a final rating, infer schedule overlap or invent efficiency/diversity. The
`output_capacity` collection references the interface, served endpoints and
lower-bound constraint IDs. Multiple demands yield `status: unresolved` with
`concurrency_not_asserted`; missing W adds `demand_power_unknown`. This propagates
an unresolved candidate while preserving the shared architecture. A single known
demand marks only its requested output-sizing scope specified, not an exact
product rating or simultaneous operating approval.

Every requested vehicle charging source gets a charging path, including when its
voltage equals house voltage. Charging is a distinct function, not an unnecessary
generic conversion inserted on a native load path. A 12 V vehicle therefore
retains 12 V input and 24/48 V output on the respective house candidates.
The shared nominal helper intentionally permits `charging` for DC→DC at equal
or differing voltage. It means controlled charging, not mandatory voltage
conversion, a specific DC/DC charger category or a manufacturer implementation.
Same-voltage vehicle roles require charging evidence and directed distinct
interfaces, but no `dc_to_dc_conversion` gate. Unlike nominal voltages additionally
require that conversion capability on the same role. Role `function: charger`
is intent, not a canonical product-role filter. Detailed alternator/BMS/relay
and switching synthesis remain outside this boundary.
Shore sources keep supplied AC voltage/frequency and require a charging path;
inversion does not imply charging. Solar preserves `pv_dc` and a required
`solar_energy_conversion` path even when nominal voltage equals house DC.
PV consumption context is unsupported and remains unresolved.

A combined inverter/charger is one abstract single-device role, with distinct
AC input, AC output and bidirectional DC interfaces and separately directed
charging/inversion paths. It does not assert a combined product exists, AC
passthrough, islanding/transfer behavior, concurrent operation or shared capacity.
Separate functions have separate roles with their own interfaces and paths.

Storage is an `energy_storage` role at house voltage. Its binding scope permits
a future evidence-supported storage assembly. No battery product, unit voltage,
unit count, bank construction, series permission or usable capacity is invented.
An explicit minimum nominal Wh requirement is copied as a predicate. Mere load
co-location supplies no storage discharge authority. No load W predicate is
transferred to storage, and conversion losses supply no storage input rating.
Storage `output_capacity` has `scope: storage_dispatch`, `status: unresolved`,
no numerical lower bounds and `storage_dispatch_not_asserted`; the corresponding
later check is deferred. Required output sizing participates in candidate status. Storage dispatch is
recorded as a deferred scope because no discharge requirement has been asserted;
it does not itself change nominal structural status.
This input revision has no explicit storage discharge requirement or dispatch
rule, so none can be inferred from text, topology or source existence.

## Candidate and predicate contracts

`ArchitectureGenerationResult` embeds exact input/policy snapshots and digests.
Each `ArchitectureCandidate` binds those digests, generator revision, choices,
demand endpoints, required roles, domains, product-interface bindings, directed wire/required-path edges,
ordered routes, used assumptions, decisions and structural evaluation. Candidate
IDs are full SHA-256 semantic-body digests with an `architecture.` prefix. A
candidate has its own digest; the complete result has an envelope digest.
Changed exact input or policy content intentionally changes identity, including
metadata, lifecycle and array order in the preserved snapshots. Object property
insertion order does not. Sorted construction order uses namespaced requirement
IDs, retaining pointers to the original input array indexes.

`RequiredProductRole` exposes independent typed predicates:

- canonical capability type;
- interface domain/direction;
- nominal V and AC Hz at that interface;
- minimum delivered output W at the relevant side;
- minimum nominal storage Wh;
- directed functional path with capability and exact interface correspondence;
- distinct interfaces/cardinality;
- requested path isolation.

Every endpoint, capacity state, predicate and route has structured provenance to an exact input JSON pointer
and generation decision. Every decision repeats policy ID/revision and carries
structured code/status, requirement pointers, subject IDs and explanatory text.
No predicate invents efficiency, alternator capacity, product current, battery
permissions, physical clearance, conductor rating or standards-derived margin.

Structural decision subjects are observation IDs qualified by kind, such as
`domain.house`, `edge.e0`, `route.supply.low12` or
`constraint.storage.c1`. Their qualification resolves the domain/edge/route or
role-local constraint in the topology/roles. Generation-choice subjects refer
directly to the generated role/domain IDs. Both retain stable decision IDs.

An interface predicate's `domain_id` resolves into the retained candidate domain.
Its canonical product current type is DC for both `dc` and `pv_dc`, while PV source
context must remain visible for directed path interpretation. Required direction
describes operation; later product evidence must support that direction, including
bidirectional evidence where explicitly required. Minimum-output predicates refer
to the named output/bidirectional interface. Distinct-interface and path predicates
must be bound consistently on the same role/device, not satisfied by unrelated
capabilities or by conflating ports. Storage-assembly binding requires actual
manufacturer evidence later. Function labels are abstract intent, not category or
product-role claims that can override these predicates.

Phase 5 filters only `required_roles` against contextual product evidence; it
must also preserve each role's unresolved output-sizing dependencies. It must not
create mandatory appliance selection from `demand_endpoints` or treat satisfied
individual lower bounds as resolution of shared capacity. Exact bindings and any
explicitly known end-use associations then provide Phase 3 installed inputs.
An endpoint without a corpus appliance is no product-coverage gap for that demand.

The artifact declares future filter outcomes `eligible`, `blocked`, `unresolved`
and aggregation `any_blocked_else_any_unresolved_else_eligible`. Every predicate
is required; insufficient product evidence cannot satisfy it. Filter ordering may
optimize work but must preserve all decision authority. This is a handoff contract;
no gate executes against products in Phase 4. Later canonical review, contextual
ratings, supported operating envelopes and exact whole-system evaluation remain
required. Eligible at a role gate does not imply a complete product binding.

## Structural authority and Phase 3 reuse

The structural status is `structurally_viable`, `blocked`, or `unresolved`, with
explicit decision-ID lists. All results carry:

```text
assertion_scope: abstract-nominal-topology-and-role-requirements
product_binding: not_evaluated
installation_safety: not_evaluated
policy_lifecycle_status: <exact supplied policy lifecycle>
```

Known blockers take precedence over unresolved dependencies, and all dependencies
remain retained. Structural viability means only that the requested nominal
relationships and role predicates are supported by the implemented rules. A
structurally viable candidate can lack any corpus match. No safety or exact-product
compatibility status follows from it. Non-approved policy emits a review warning;
running generation/tests never changes lifecycle metadata. Policy is a trusted
explicit project/application input, not a UI/user commercial-preference channel.
Embedded metadata and hashes do not authenticate approval; live-policy replay
checks exact content when the artifact is consumed across application boundaries.

`nominal-domain-semantics.ts` extracts Phase 3's unchanged status aggregation,
current-type projection, passive continuity and capability/domain interpretation.
Both phases call it. Exact evidence consumption, port ratings, switching, bank
permission, schedules and passport assembly stay owned by Phase 3. Phase 4's
abstract evaluator checks the same nominal path meanings plus abstract role
references/interface correspondence and explicit ordered routes; it does not
manufacture runtime records to call an exact-product API.

`portable-json.ts` shares Phase 3's canonical serialization and SHA-256 helpers,
with the existing passport exports preserved. It additionally closes two array
snapshot holes: accessor/hidden properties and sparse arrays with compensating
extraneous keys. Descriptors are checked before reading elements. Valid existing
JSON encodings/digests are unchanged. Evaluation owns fresh JSON copies, including
independent candidate arrays. No caller mutation rewrites retained input/policy.

Loading validates closed schemas and integrity and reconstructs the **complete**
artifact with the supported generator revision and embedded explicit policy.
Input/result schema versions, generator revision and bundled policy revision are
2.0.0. The policy schema now requires the explicit grouping strategy; output
schemas require endpoints and capacity collections and remove the load role
function. Version 1.0.0 artifacts are rejected, never silently migrated or
reinterpreted. Existing local proof exports remain untouched.
Forged constraints, trace/provenance, statuses, scopes, lifecycle labels or
duplicates fail even after recomputing envelope and candidate hashes. Replay
also requires exact external input and policy snapshots. Hashes are content
identity, not signatures, manufacturer verification or authorization.

## Acceptance, independence and limitations

`tests/fixtures/architecture-requirements.ts` supplies 12 V vehicle charging,
24 V/120 W and 12 V/300 W DC loads, a 120 V/60 Hz/800 W AC load, 36 V nominal
PV charging, deliberately different 230 V/50 Hz shore input, and explicit
2400 Wh nominal storage. Those are project-authored requirements, not a
recommended design or manufacturer specifications. They produce six unranked
structurally viable candidates: 12/24/48 V × combined/separate functions.
The 12 V house converts upward for the 24 V load; 24 V serves that load directly
and converts downward for 12 V; 48 V converts to both DC load domains.

Test-only `architecture-witness.ts` adapts product roles and demand endpoints into
project-authored canonical records to pass all six candidates through Phase 3's
exact nominal evaluator and passport round trip. Its complete synthetic 1 W
device observations/one-hour schedules and expressly permitted one-unit storage
bank serve Phase 3's other required scopes. No route power or loss/efficiency
assertion is claimed by these witnesses. Withheld witness review leaves Phase 3
unresolved while Phase 4 remains structurally viable. Shared-domain witnesses
preserve Phase 3's existing unresolved shared-capacity
result while all directed nominal edges satisfy. Endpoint synthetic load records
exist only in this explicit test adapter, never in the Phase 4 mandatory selection
surface. Test witnesses are absent from the runtime dependency graph.

Corpus independence tests use only the seven explicitly named tracked Phase 3
acceptance records, with empty/reversed/changed/gained/lost catalog contexts.
Artifacts stay identical. A transitive runtime-import test additionally prevents
product loaders, ingestion, overlays or recommendation from entering generation.
Closed input/policy schemas reject commercial/product injections. Protected local
paths are never corpus members or validation inputs.

Current limitations are explicit: no energy/autonomy sizing from schedules,
source availability/balance, storage-free operating proof, efficiency/input
ratings, shared/concurrent product capacity, operating/PV Voc/Isc windows,
isolation solver, passive protection/distribution synthesis, bonding, installation
access/ventilation/conductor sizing, or multi-source/multi-domain combined-device
pairing. Requested unsupported interpretation remains unresolved; other later
checks are visible in `deferred_checks` without making product coverage an
architecture blocker. No customer/embed UI, product filtering/binding, ingestion
promotion, recommendation, advisory assessment or stationary rules were added.
