# Wave 1 durable source profiles and installed PV gate

The continuation connects a bounded PV/controller slice to ordinary durable
source correction, pending product candidates and actual Phase 3/5 mandatory
gates. It grants no product admission or installation certification. The real
Newpowa 12J/24J and SmartSolar 150/45 sources remain incomplete and held.

## Source to durable candidate

`capture → document extraction → ordinary review job → HumanSourceEditor →
humanProperties / previewHumanAdjudication → recordHumanAdjudication →
createHumanSourceEvent → rebuildHumanPreparation → reviewed semantic decision →
buildProductionProductCandidate → composeAdjudicatedProfile → pending candidate`.

The editor offers eight explicit published quantities: module Voc/Vmp/Isc/Imp,
Pmax and maximum system voltage; controller absolute PV Voc and maximum PV Isc.
No quantity or target is preselected. Read-only source suggestions reuse exact
model and containing-context proof; a suggestion is not a durable fact. The
operator still cites the retained source, verifies complete conditions, selects
the exact quantity/property, previews it and supplies a correction reason.

The source proof owns original documents, citations, raw value/unit, containing
assertions, headings/notes and exact intake. Numeric meaning must be adjacent to
the actual published literal; finding another quantity somewhere in the document
does not authorize a mapping. Flattened model columns, competing values and
uncertain conditions withhold interpretation. Only exact V/A/W literals are
supported by this adapter; other units/coefficients/ranges remain explicit work.

Each ready source member uses the existing human event and reviewed semantic
snapshot. Atomic composition binds all contributing member proofs to one profile
root. Source-stated evidence remains distinct from the typed human interpretation
and normalized value. `human_interpretation` identifies adapter version, event,
fact, original unit and source document revision. A document revision does not
become a manufacturer hardware revision; the latter remains null here. No STC,
temperature domain, uncertainty, tracker membership or physical port is inferred.

Candidate validation reconstructs the root from all support facts and source
metadata. Detached/tampered root values fail. Competing members withhold the whole
profile. CAS and append-only source/semantic history retain existing sequencing:
a correction invalidates the whole review snapshot; restart rebuilds against
retained original documents. This adapter changes no writer permissions, storage
ownership or approval protocol. Function-only imports between adjudication,
candidate validation and canonical identity are invoked after module initialization;
they carry no initialization-time state or ingestion-to-core dependency.

## Phase 3 and Phase 5 call paths

`evaluateInstalledPv(input, catalog, scenario) → bindInstalledPv →
buildPortableEngineeringEnvelope → requirements.mandatory_conditions →
evaluateInstalledSystem → Engineering Passport inherited:installed_pv decision`.

`generateArchitectures → evaluateProductSelection → bindProductSelection(
explicit choices, {installed_pv, pv_modules}) → bindInstalledPv → exact Phase 3`.

The Phase 5 handoff preserves every selected witness's original mandatory gate.
PV modules are explicit installation instances attached to an existing requirement-
owned solar source endpoint, rather than invented Phase 4 product roles. Their
record snapshots cannot conflict with the selected corpus. The controller must
match the selected instance and every string names each physical module instance,
its exact output port, tracker and terminal. Installed topology owns ports/domains independently of
profile tracker grouping. Optional PV input adds only mandatory failures/unknowns;
ordinary historical handoffs keep their existing shape and semantics.

`pv_binding` exposes exact catalog/input/scenario/envelope snapshots, reasons and
content digest for the consumer's explanation. `evaluateInstalledPv` returns an
exact replayable wrapper plus a real passport. `replayInstalledPv` reconstructs
both and refuses rehashed/tampered results. A standalone passport's inherited
digest is an identity reference, not evidence proof; retain the wrapper when
reviewing PV decisions. Outputs own copies. Existing passports and selection
artifacts are neither migrated nor silently reinterpreted.

A known model/count/protocol, cold Voc, PV Isc or source-supported terminal/tracker
contradiction outranks unknown revision/context. Missing source facts stay unknown.
Presence in a catalog, `verified` text without current content-bound verification,
synthetic evidence and commercial data cannot grant eligibility. The explicit
installed PV gate always remains at least UNRESOLVED because wiring/protection,
service/thermal/grounding/bonding, installation compliance, mixed I–V/yield and mode
transition/dispatch consumers are outside this slice. There is no caller Boolean
that clears these holds. A supplied protection evidence ID alone is insufficient.
Complete synthetic selected-envelope examples can pass their model and still
produce an unresolved actual installation gate. Real incomplete candidates need
port/path and intended-use review before an exact Phase 5 witness can materialize.

## Versions and engineering corrections

Current envelope rule/result and portable wrapper are v2. Explicit archived v1
code/schema retains historical replay semantics, including its old operating
basis; replay never upgrades an old decision into a corrected current decision.
`engineering-profile.v1` adds optional basis, inventory and interpretation members.
Historical records without them are unchanged. The current schema generator keeps
portable/canonical copies synchronized; legacy schema is private to v1 replay.

Operating maximum requires independently supported Voc or Vmp meaning on its
limit evidence. The basis enum alone is a proposal. Current production durable
adjudication has no operating-basis member; real limits therefore abstain even
with that enum or a human interpretation of another quantity. Controlled synthetic
tests require an explicit quantity clause on the limit evidence and retain
synthetic authority. Absolute cold Voc stays independent.
Per-check provenance references the quantities, coefficients, uncertainty and
limits actually used, with declared installation assumptions. Shared capacity
requires an explicit complete source group inventory for the selected mode;
caller subsets cannot hide any known declared mode constraint. Full installation
suitability is still outside the selected envelope even with a complete inventory.

### Installed PV integrity correction

`installed-pv-scenario.v2` maps string IDs to ordered arrays of
`{instance_id, port_id}`. Missing/null arrays mean unknown inventory; an explicit
array whose length contradicts positive integral `series_count` is a known NO.
Every physical piece belongs to one string only. Component-instance references
resolve to exact catalog snapshots, preserving manufacturer/model and hardware
revision (including null). Known owner/model/revision disagreements, reused
instances, wrong declared ports and wrong PV domains block or reject. Phase 5
requires exactly one declared DC output port and refuses unrelated module entries.

`installed-pv-binding.v2` includes those resolved physical identity snapshots.
If physical inventory, module identity or output ports are incomplete, its
`envelope` is null: no installed Ns/Np power/current/voltage conclusions are
manufactured. A present envelope has `inventory-bound-model-diagnostic` scope;
unknown hardware revisions and authority remain explicit mandatory holds. Known
envelope NO still precedes missing connection evidence.

Missing topology bindings or independent connection proof are unresolved, rather
than evidence of electrical incompatibility. Known wrong domain/port witnesses
block. Domain co-membership and array order never prove series wiring. Phase 5
adds the declared port/domain associations but generates no module wire edges;
`pv_series_parallel_connection_proof_unmodeled` remains required for every
installation. Inherited Phase 4/5 graph and gates retain their ownership.

Installed scenario/binding v1 cannot establish physical series/parallel ownership:
binding and replay explicitly reject it as unprovable, with no automatic migration.
Re-author v2 from independently established physical inventory. Historical
portable engineering-envelope v1 replay uses its unchanged archived evaluator
and schema. The pre-review current envelope v2 source-context guard is tightened;
old v2 outputs that no longer reconstruct fail exact replay rather than being
silently accepted. No historical artifact files are rewritten.

## Operator acceptance and remaining evidence

1. Use a private controlled job store; capture the exact source and prepare through
   the existing API. Inspect exact model/revision, units, rights and full context.
2. Open source correction, add the missed specification or correct its meaning,
   choose PV/controller representation, exact quantity, source citations and root
   property. Preview; unresolved context prevents saving a ready interpretation.
3. Save only the deliberate source decision with its rationale. Reload/restart;
   inspect the pending profile root, all support facts and source/document hashes.
   Try a stale save and an altered root: both must fail. This is source review.
4. Provide explicit installed string/temperature/current/topology assumptions to
   the backend bridge. Inspect formula/source traces and the actual inherited
   Phase 3 decision. Selected-role callers also inspect `pv_binding` and the
   original Phase 5 mandatory witness gates. Known NOs remain blocked.
5. STOP for human product review. No action in this continuation approves,
   promotes or independently verifies a real product. Full reference conditions,
   coefficients/domains, tracker terminals, protection and intended-use evidence
   must be acquired and separately reviewed before live admission is considered.

The reusable source-context suggestion attempt is measured on exact independent
page-2 observations with unchanged historical 254/77 denominators. No native HTML
experiment proves PDF table recovery. Zero added usable claims is an observed
negative result; full denominator replay needs the original full production corpus
and matching reviewer adjudication, not an oracle-driven reconstruction. Human
reviewer time is not measured. G6/G7 remain evidence-first follow-ons: no thermal
curves, BMS thresholds, shunt throughput/accuracy transfer or series permission is
invented. Default tests and fixtures require no developer TEMP evidence.
