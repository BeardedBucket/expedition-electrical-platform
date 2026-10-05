# Whole-system backend proof

[Phase 6 recommendation](RECOMMENDATION.md) uses this evaluator through Phase 5's
exact handoff and preserves the complete passport verbatim. Explicit late endpoint
accounting is an additive handoff input. Generic Phase 3 `schedule_provenance`
distinguishes requirement-owned timing from explicit evaluation input; evaluator
and rule revision `1.3.0` retain that attribution in decisions and calculations.
All inherited blocked/unresolved conditions remain unchanged. Preference never alters
the passport's engineering status, warnings or assertion scope.

Phase 5's post-selection audit adds explicit requirement-owned `project_demands`
and inherited blocked/unresolved `mandatory_conditions`. See
[Product selection](PRODUCT_SELECTION.md) for the handoff and provenance contract.
These optional inputs preserve existing valid-input behavior and passport schema
2.0.0; evaluator/rule revision is now 1.3.0. Project endpoints have no product
instance, canonical evidence or invented idle demand. Their schedules participate
in device-side accounting with separate unresolved contributions. Inherited
unknowns cannot be omitted by the exact selection handoff or supplied as YES.

Phase 3 evaluates an explicitly supplied installed architecture. Its portable
artifact is an **Engineering Passport**. It produces no recommendation, product
selection, voltage preference, builder overlay, UI state or installation safety
certification. `result.status` is qualified by the machine-readable
`assertion_scope: nominal-connectivity-and-device-demand` and
`installation_safety: not_evaluated`.

## Ownership and existing-core composition

Phase 4's [architecture generator](ARCHITECTURE_GENERATION.md) shares the extracted
`nominal-domain-semantics.ts` pure helpers and `portable-json.ts` snapshot encoder.
The nominal DC/PV/AC and capability/path rules are unchanged; valid existing
passport digests retain their encoding. Shared encoding now also rejects array
accessors/hidden properties and sparse arrays with compensating extra keys.
Exact product evidence, installed routes, schedules, switching and battery-bank
permission remain owned by this Phase 3 evaluator. Abstract generation never
creates runtime witness records or weakens its canonical-review boundary.

The Node-only `@expedition/engineering-core/engineering-passport` package entry
point exposes `evaluateInstalledSystem`, `serializeEngineeringPassport`,
`parseEngineeringPassport` and `replayEngineeringPassport`. It is deliberately
absent from the browser index: SHA-256 uses Node crypto, while the existing
browser/calculation entry point remains unchanged. No network or filesystem
access occurs in evaluation; file loading/export belongs to the application or
test boundary. Ingestion captures, jobs, qualified extraction artifacts and
semantic-review internals are not inputs.

`InstalledSystemArchitecture` contains `installation: ReferenceSystem` and
`power_topology: InstalledPowerTopology`. The installation remains the sole
owner of existing component instances, locations, terminal wiring, conductors,
interaction architecture and source references. The additive topology supplies
logical electrical-power semantics over the same instance IDs. It neither
duplicates product definitions nor changes the old reference-system schema.
Legacy terminal/conductor/communication views are preserved and validated with
the existing validator; logical routes do not assert that those views constitute
a complete installation or that a logical wire has suitable ampacity/protection.

The composition has separate modules for validated snapshot/trace ownership,
topology and routes, schedules and banks, and final passport assembly. It reuses
`conversionPowerToCurrent`, `directPowerToCurrent`, `evaluateLoadStateEnergy`,
`deriveBatteryBank` and `evaluateSystem`. It does not replace the recommendation
orchestrator, enumerate alternative battery banks or create a parallel formula
engine. Two legacy result representations are deliberately adapted: device-side
states do not publish the primitive's signed battery observations, and a bank
aggregate does not carry its primitive's `manufacturer` unit-energy label.

## Electrical domains and routes

Domains have stable IDs, explicit `dc`, `pv_dc` or `ac` kind, optional nominal
voltage in V, and optional frequency in Hz. Omitted numeric values are unknown.
PV remains a distinct installed source context even though its logical product
port is DC. Equality compares declared nominal design points exactly: no voltage
tolerance, chemistry equivalence or manufacturer-specific nominal conversion is
invented. An AC domain requires explicit frequency for a resolved match.

Bindings address an instance, canonical logical-port ID and domain ID. A port
cannot be assigned to multiple domains. Binding does not imply a wire. Domains
also serve as shared bus endpoints; two domains with equal voltage remain
distinct until an explicit edge connects them.

Edges are directed `wire`, `power_path` or `conductive`. Bidirectional operation
requires two explicit edges. Wire edges honor input/output port direction and
preserve current type, nominal voltage and AC frequency. A conductive edge
binds a canonical conductive relationship and its port participants; selected
switch configurations must explicitly enable controlled relationships. Absent
switch selection is unresolved; OFF is blocked. A disconnect without controlled
switching evidence remains unresolved: relationship existence cannot establish
closed state. Connection-point-only passive
products remain representable in the existing installation but are unresolved
in this port-only logical view; no logical port is fabricated for them.

Power-path edges must bind exact from/to ports on one instance and match the
canonical directed path and capability. Only explicit DC/DC, solar conversion,
inversion and charging capabilities authorize their respective domain types.
Distribution or passive roles cannot supply voltage conversion. Missing product
paths/port values remain unresolved. Known incompatible direction/domain values
block. Unverified values never supply even a negative engineering assertion.

PV source context is retained when evaluating installed continuity. A wire or
conductive relationship crossing between `pv_dc` and ordinary `dc` is unresolved
even when both nominal voltages match; nominal equality does not establish the
unmodeled source/operating interpretation. Known voltage mismatch still blocks;
missing voltage remains unresolved. A reviewed explicit `solar_energy_conversion`
path can establish the modeled boundary. An ordinary DC conversion capability
alone does not establish PV context. This is neither a universal controller
requirement nor a manufacturer-specific rule. Mapping PV to canonical DC current
type is reserved for port matching and supported point-current arithmetic.

Each supply requirement names an ordered, cycle-free edge sequence. The engine
checks that exact route and never discovers or chooses a replacement. When
power is requested, an output port's declared upper power rating is checked.
For a reviewed single-path DC converter, explicit efficiency propagates demand
backwards and the existing core computes input power/current and checks the
input port's upper current rating. Missing rating/efficiency is unresolved.
Any independent known endpoint/port power or DC current rating also constrains
the requested nominal point; a larger watt rating cannot erase a smaller ampere
limit. These are lower-bound point demands with conductor losses unmodeled, not
claims about delivered power or conductor ampacity. Known AC current limits
require separate power-factor evidence and therefore remain unresolved here.
Product-global efficiency is not attributed to one mode of a multi-path device.
Shared converter use remains unresolved without concurrency context. Internal
isolation facts are preserved but a requested installed isolation assertion
remains unresolved because parallel-route separation is not evaluated.

Product port constraints involving operating context, temperature, PV Voc/Isc,
startup, recovery or relational headroom prevent a complete flat nominal
interpretation. They are preserved and reported unresolved, not discarded to
obtain a pass. This intentionally bounded evaluator does not implement those
additional rule interpreters. Scalar port voltage is a nominal-point comparison,
not a full operating-window proof. Product-global voltage/frequency fields never
populate otherwise unknown ports of multi-function devices.

## Requirements, assumptions, schedules and banks

Input requirements, architecture and explicit user/project assumptions are
copied intact into the passport. Input schemas reject builder/commercial fields.
Environment, autonomy and source-availability inputs are retained, but requested
assertions involving them remain unresolved because the corresponding complete
operating profiles are not implemented here.

Requirement-owned `project_demands` carry direct `requirement_id` and exact source
JSON `pointer` in their provenance, preserved in decision and calculation inputs.
They create no assumptions or manufacturer evidence. Optional `assumption_ids`
must resolve to genuine input assumptions when an actual dependency is declared;
unrelated upstream assumptions remain intact. These requirement locators do not
reference a separate Phase 3 registry: Phase 5 reconstructs the source Phase 4
requirements, while standalone Phase 3 treats them as explicit project input.
Missing W/schedule/duration/horizon stays unknown; explicit zero stays zero. A project
demand can receive power but cannot act as a wire source.

Optional `schedule_provenance` owns timing attribution separately from endpoint
`provenance`. Its closed forms are `{ origin: 'requirement', requirement_id, pointer }`
(locator to the actual requirement schedule), `{ origin: 'evaluation_input' }`
(explicit accounting declaration with no invented external citation), and
`{ origin: 'unknown' }`. Omission also means unknown. The exact input snapshot keeps
omission intact; project-demand decisions and each resolved project-energy
calculation expose an explicit unknown origin rather than infer a source. Declaring
provenance requires a schedule value, but does not supply missing power or duration.
Phase 5 attributes existing schedules to their requirement `/schedule` pointer,
including identical late repetitions, and labels newly supplied timing as
evaluation input. Standalone Phase 3 callers can use the same generic forms.
No assumption or manufacturer evidence is created by any origin label.

The optional field preserves legacy valid inputs and numerical behavior under
schema `2.0.0`. Trace semantics changed, so evaluator and rule revisions move
together from `1.2.0` to `1.3.0`; older revision passports require their matching
implementation and fail current exact-revision replay. Origin participates in input
and passport hashes and reconstruction. Input/trace discrepancies reject even when
rehashed. Coherently evaluated changed inputs are new artifacts: standalone replay
checks live components/rules, not an external requirement document or project-input
registry. A hash or origin label authenticates neither source nor author. Phase 6
additionally reconstructs the handoff from its authoritative selection/input and
external replay compares the original recommendation input identity.

Inherited `mandatory_conditions` preserve only the selected witness's non-YES
gate/assembly reasons and applicable required upstream dependencies. Model aggregate
diagnostics are broader and have no exact trace authority. The role remains the
condition ID, and `subject_id` identifies the selected binding. Generic Phase 3
condition interpretation retains a blocker even if another model witness is eligible.

Each instance needs a full-duration schedule relative to explicit
`evaluation_hours`. States for one instance declare mutually exclusive occupancy
of that horizon; durations must sum exactly to it. No always-on duration, duty,
quantity or idle power default is inserted. This is duration accounting, not an
ordered time-domain/concurrency solver. Overlapping occupancy cannot be certified
by this contract. Missing schedules/durations/horizon withhold total energy.

An active `load` can have an explicit demand requirement tied to a named
assumption; that is a project demand, not a product specification. Installed
device idle/standby/quiescent/off demand requires an applicable reviewed
canonical observation. Qualified consumption is selected by exact assertion ID
and complete qualifier context. Its explicit electrical domain and discrete
supply voltage must match the installed domain (unit voltage for a series bank).
Whole-device state must match; quiescent requires that measurement basis.
Display-off alone cannot establish idle. There is no interpolation, ignored
qualifier, neighboring-product substitution or conversion of ratings to
consumption. An unconditional consumption field is used only for an active
state, never as evidence of idle state.

`result.energy` is independently self-describing. Its
`resolved_subtotal_energy_wh` sums only resolved device-state contributions.
`completeness` is `complete` or `incomplete`; `unresolved_contributions` contains
state power/duration failures, per-instance schedule omissions or unknown/mismatched
coverage, and an evaluation-level entry when no states exist. Missing schedules
are represented here even when no state ID exists. Zero resolved subtotal is
not zero total demand. `total_energy_wh` is required only in the complete branch
and prohibited in the incomplete branch by schema and discriminated TypeScript
types. Complete accounting has an empty unresolved collection; incomplete
accounting requires a nonempty collection. The trace preserves both included and
omitted contributions. The complete total is device-side scheduled energy,
not battery demand or required storage: efficiency losses, reserve and source
trajectories remain separate. Legacy signed battery fields are omitted from
published device-state results. Every calculated Wh or DC nominal current has a
formula, inputs, rule identity and applicable evidence references/assumption IDs.

A selected identical-unit bank supplies explicit series/parallel counts and
domain; one installation instance addresses that aggregate bank, not several
alternative configurations. Manufacturer count permission, unit voltage,
capacity and storage capability must be known and reviewed. Arithmetic alone
cannot establish permission. Permitted series banks derive their aggregate port
nominal voltage from a scalar unit-port voltage; unsupported range interpretation
remains unresolved. Unit baseline demand is multiplied by actual bank unit
count, avoiding undercounted parasitic demand. Aggregate voltage, Ah and Wh are
derived even when unit energy is a canonical assertion. Series balancing,
maintenance, installation wiring and advisory review remain separate warnings.
Heterogeneous banks and automatic alternatives are not implemented.

Physical dimensions remain snapshot product facts. Every instance has a visible
installed-envelope warning: no required orientation, connector/service/bend or
ventilation clearance is invented. Chassis/ground terminal wording is preserved
without becoming a global grounding role. Optional installed bonding contexts
retain domain, terminal, intended role and source-reference IDs; their electrical
meaning remains unresolved. No grounding solver is implemented.

## Provenance and portability

The passport schema version and evaluator revision identify this implemented
contract. The bound rule dataset is the actual project-authored
`data/rules/installed-system-proof.json`, not a manufactured corpus version or
standards table. Its rationale and assumptions describe nominal-point scope.
No standards-derived numeric constants are introduced. Fundamental zero/one
arithmetic boundaries, exact nominal equality and array/count requirements are
mathematical/structural, not safety margins. Future behavior changes require
updating evaluator/rule revision together and the associated boundary tests.
Revision 1.0.1 separates state calculation IDs from system summary IDs and
rejects ambiguous/duplicate trace identities. Earlier draft proof exports remain
on disk but are explicitly unsupported by current replay, rather than silently
reinterpreted. Installed/requirement IDs use the repository's lowercase
alphanumeric/dot/underscore/hyphen vocabulary; colon separates generated trace
namespaces. Human assumption statements remain unrestricted nonempty text.
Revision 1.0.2 additionally enforces independent known endpoint/current ratings
along the supplied nominal route. This changes interpretation, so both rule data
and evaluator revision change; old proof artifacts cannot silently replay as new.

The review corrections use passport schema `2.0.0`, evaluator revision
`installed-system-proof/1.1.0` and rule revision `1.1.0`. Removing the ambiguous
energy/evidence field names is an intentional portable-contract break; old
artifacts are rejected rather than implicitly migrated or relabeled. Inputs and
canonical component/reference-system schemas keep their existing identities.

Rule `status` retains the existing `draft`/`reviewed`/`approved`/`deprecated`
lifecycle vocabulary from `data/schemas/rule.schema.json`. This repository has no
JSON-rule execution/promotion gate. Existing `evaluateEngineeringRules` computes
against profiles marked synthetic/unverified/reviewed and retains profile status
in the trace; `DatasetStatus` is a separate vocabulary, not a rule approval model.
`CONTRIBUTING.md` requires reviewer sign-off for engineering-rule changes but
defines no automatic status transition on merge. The new rule remains `draft`.
Executing it can satisfy the declared numerical/nominal proof without approving
the rule. `result.rule_lifecycle_status` repeats the bound rule status beside the
result; a non-approved rule produces a visible `rule_review_required` warning.
No status is promoted by evaluation, tests or integration. A human-reviewed change
to lifecycle metadata changes rule content/digest and requires replay review.

Selected canonical records are copied in full, sorted by component ID, and
bound to SHA-256 digests of canonical JSON content. The corpus digest hashes the
selected ID/record-digest pairs; unrelated catalog records do not participate.
This is the smallest coherent project-data snapshot, not a raw file-byte digest
or ingestion revision. The existing loader's normalized record, when used, is
the actual supplied evaluation record; replay needs that same representation.

`examined_evidence` identifies component/digest and identity-addressed field or
member path. Each observation has explicit `engineering_use`: `accepted_input`
means its reviewed value was returned to engineering interpretation; `withheld`
with reason `record_not_verified` means the value was examined but not supplied
as an engineering input. Accepted input does not mean applicable, sufficient,
compatible or manufacturer-published: qualifiers and constraints still determine
the resulting decision. No engineering authority follows from collection presence.
Decision/calculation `evidence_refs` link identities with their engineering-use
state inline, including withheld evidence cited to explain unresolved decisions.
They retain canonical value, actual verification status, record-level
source references/locators and any existing `derived_fields` lineage. A whole
port/path assertion can be examined structured evidence. Record references do not
fabricate field-specific source attribution. `canonical_assertion` deliberately
does not mean `manufacturer-published`; absence of derivation metadata never
proves publication. `product_derivation` remains distinguishable from an
assertion and from new system calculations.

Canonical projection/normalized representation is labeled separately from
derived calculations. Source-native text and units are explicitly
`not_retained_in_canonical_record`; engineering never reconstructs them by
reading ingestion artifacts. No second ingestion/unit normalization engine is
introduced. A normalized canonical V/W/mm value does not assert that those were
the manufacturer's original units. Actual manufacturer revision can be supplied
through the additive canonical `manufacturer_revision` field; its passport state
is `recorded` with independent verification status. Missing/null remains
`unknown`. A Git revision, project digest or retrieval date is never substituted.

Unverified/partially verified canonical records are preserved, but cannot satisfy
consumed engineering evidence. Verified canonical data is the existing trusted
product-data input boundary, not a certification created by this evaluator.
The passport preserves every supplied record and does not approve product facts.
Schema validation requires verified entries to be accepted inputs and all other
review states to be withheld. Reconstruction additionally checks exact observation
and reference use states against embedded canonical records; rehashing a relabeled
observation, trace or result cannot authorize it.

Serialization orders object keys by code point and preserves array order, notably
route order. It rejects undefined, nonfinite values, sparse arrays, cycles,
non-JSON objects and hidden/accessor properties rather than silently erasing or
coercing them. Evaluation owns fresh copies; later caller mutation cannot change
an evaluated snapshot. Rule metadata is recursively frozen. No clock, network,
randomness, timestamp or locale ordering enters evaluation.

Loading validates schemas and integrity, then reconstructs the complete passport
from embedded inputs/records with the supported rule/evaluator implementation.
Every result, trace, provenance object and digest must reproduce exactly. A
stronger edited status fails even with a recomputed envelope hash. Replay also
checks external canonical membership/content: missing/duplicate/changed records
or changed rule data/evaluator identity fail explicitly. Hashes provide content
integrity, not cryptographic source authenticity or promotion authorization.

Advisory references remain intact and visible in snapshots/warnings. No advisory
assessment, severity, confidence or reputation becomes a rating, voltage or
capacity. Advisory evaluation is not run by this slice. Builder policy is not
accepted and cannot change compatibility. Later selection/recommendation/UI
consumers must preserve the passport's states, scope, warnings and provenance.

## Acceptance and independent replay

The project-authored complete fixture demonstrates 12 V vehicle source →
explicit 12/24 converter → 24 V house/storage/loads, plus an explicit 24/12
converter and 12 V load. It resolves within the declared nominal scope with
750 Wh of device-side scheduled demand and a derived 2,400 Wh nominal bank.
Those are numerical test fixtures, not an engineering design recommendation.
Additional fixtures prove distinct AC input/output frequencies/voltages on one
inverter/charger, switching, allowed series topology and unknown boundaries.

Production acceptance names the seven tracked canonical records explicitly,
without scanning local-only material. It preserves all seven `unverified`
statuses and demonstrates an incomplete replayable result. Orion paths retain
their directed ports and conditional ratings but lack accepted review/efficiency;
Epoch's unit nominal voltage is not inferred to equal the installation's 24 V
design point; its port voltage is absent. MultiPlus retains separate AC/DC
ports/paths but has no port-specific voltage/frequency facts. SmartSolar's
contextual constraints remain uninterpreted. Blue Sea and SmartShunt retain
their connection-point structures; no logical ports or baseline schedules are
invented. All five modeled idle contributions are unknown; the two additional
instances have unresolved schedule coverage. No total energy is emitted. No
record is repaired, substituted, promoted or changed.
All five unknown states and both unscheduled instances are represented directly
inside `result.energy.unresolved_contributions`. The zero resolved subtotal is
explicitly incomplete. All examined production evidence and its references are
withheld from engineering use.

Opt-in test-boundary exports write passport/input/exact-catalog JSON to a caller
chosen new directory within repository `.tmp`, with exclusive creation to
protect existing files. Ordinary tests write no such artifacts. After building
the core, a fresh Node process can independently load/replay the exports:

```powershell
node scripts/replay-engineering-passport.mjs PATH_TO_PASSPORT.json PATH_TO_CATALOG.json
```

Data validation supports `--tracked-only --include-file
data/rules/installed-system-proof.json` to validate tracked data and this new
named rule while excluding protected local-only corpus material. The default
standalone validator behavior is unchanged. Named schemas are registered before
compilation so the passport schemas reuse canonical boundaries. `electrical:
null` is now admitted by the component schema to match the pre-existing loader
and TypeScript unknown-data contract; it does not become zero/unsupported.
Port-specific frequency is an additive optional field with range validation.

The old orchestrator, configurator, ingestion, advisories and builder overlays
retain their public behavior. Automatic architecture generation, product choice,
ranking, stationary rules, CAD and product promotion remain outside Phase 3.
