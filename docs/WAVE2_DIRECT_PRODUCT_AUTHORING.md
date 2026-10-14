# Wave 2 direct manufacturer authoring

Automatic extraction is one discovery mechanism. Direct document reasoning can
prepare a nonauthoritative proposal even when extraction emits no facts. Neither
mechanism supplies human review, admission, verification or installation authority.

## Source and normalization boundaries

`source-grounded-draft.v1` preserves exact model, separate optional MPN/hardware
revision, source URL/publisher/retrieval/document revision, original physical
units, normalized values, conditions, locators and complete document hashes.
Source literals, reconstructed numeric ranges and authored descriptions are
distinct presentations; descriptions are not invented verbatim quotations.
Document revision, hardware revision and project digest remain distinct.

Each fact has a page/table/model-column or HTML section/field locator. Its context
hash is the whole retained document, not a purported independently authenticated
field excerpt. Import spans must cover exactly that document, preserving complete
headings/footnotes without requiring PDF fact extraction. Hashes establish bytes,
not publisher authenticity, model meaning, applicability or truth. All meanings
remain Codex-prepared/unreviewed. Original bodies/renderings/jobs remain private;
only metadata and limited authored facts may enter the public review artifact.

Identity values and declared conversions are checked.
Literal text identity requires exact original/normalized equality; it cannot
silently change AC phase or map a literal into a boolean/object. Explicit range
reconstruction, declared numeric conversions and labeled authored summaries keep
their existing meanings. This tightens v1 validation without rewriting genuine
drafts or adding a text canonicalization scheme; invalid historical literals
refuse replay rather than acquiring a new semantic interpretation.
Inch/pound/centimeter,
kilo/milli, percentage and time factors are definitions, not safety margins. NOCT
plus/minus normalization is distinct from an ambient-to-cell thermal model.
Alternate-unit rounding and conflicting source rows stay ambiguous; no tolerance
repairs them. Total cell count is not series topology. Pmax tolerance does not
supply Voc/Vmp/Isc/Imp uncertainty. Dielectric test voltage is not working voltage
or installed insulation coordination.

`projectAuthoredComponent` creates a machine-validated unverified export with
typed proposed PV, battery, instrument and AC facts where their meanings fit.
It creates no human interpretation/event. Source specification stays beside these
projections. Ambiguous size is withheld from simplified geometry; body size is
never installed clearance. Converter logical TB1/TB2 labels map actual source pin
groups/ranges, and its internal directed path follows the source block diagram.
No installation wire, tracker/terminal alias or unconditional power/current cap
is generated. Unproved interfaces stay missing.

## Durable import and human inspection

Existing `IngestionJobService.previewAuthoredDraft` is read only;
`importAuthoredDraft` freezes the exact proposal against the current job version
and original retained acquisition bytes. Explicit supporting source jobs must
name the same manufacturer/model and remain unapproved. Captured documents can
support preparation even when extraction failed. Capture success is separate
from extraction, automatic qualification and human meaning.

Imports are append-only ordinary-job attachments, not replacement preparations,
candidates, human decisions or approval snapshots. Inputs are copied before the
first await. Existing per-job queue, file lock, CAS, fsync and atomic replacement
own persistence. Same base-version/proposal retries are idempotent only while
source preparation stays current. Different stale edits return409. Foreign
source/model/publisher, cropped proof, unknown version/authority, unit/value drift
and rewritten history fail closed.

Imports intentionally own private copies of complete source preparations, so
later source/semantic recovery cannot detach historical meanings from their bytes.
This duplicates source-bearing storage; it does not enlarge parser/transport
caps or assert a bound on total job storage. Supporting snapshots are owned copies,
not a live cross-job transaction; primary CAS atomically saves that package.
Region hash caching is local to one validation call and confers no model/semantic
ownership. Crash/lock recovery follows the existing store rules.

Operator detail shows current/historical proposals, changed/retained fields,
original/normalized units, conditions, locators and hashes. Registered job,
proposal digest and source ID permit exact private downloads. The endpoint never
fetches a live URL or opens a browser-selected path. Attachments use no-store and
nosniff; publisher HTML cannot execute in the operator origin. Live publisher
links are labeled potentially changed. Rendering/downloading saves no decision.

`prepare-wave2-authored-drafts.mjs` requires named private receipts and a fresh
external output. It uses ordinary retained-source jobs, validates drafts/component
exports, previews/imports/restarts/retries and checks zero human events/approvals.
No directory/catalog discovery occurs. Hosted manufacturer-linked files remain
proposed intake: transport officiality does not certify publisher/model/variant.

An active attachment cannot approve an older automatic candidate as though it
included new authored meanings. Human source/candidate integration is deliberate
through source correction or explicitly reviewed export; unsupported mappings
remain held. This is a review-package path, not a privileged approval route.

## Current consumers and archived rules

Fresh operating bindings/evaluations are v2. Battery temperature location/heater
prerequisite applies before either sign of comparison. Installed shunt transfer,
accuracy range and temperature applicability precede their limits. Nominal A/mV
is not maximum measured current, protection, throughput or battery capacity.
Accuracy transfer cannot be borrowed from an included-accessory row; absent
percentage denominator stays unknown. Explicit archived v1 wrappers reconstruct
their original diagnostics, without silent upgrade. Rehashed changed outputs
fail replay. Historical source/artifact files are never rewritten.

`installed-source-draft-scenario.v1` binds exact instances to declared quantity,
mode, direction, domain, unit and conditions. The registry owns predicate meaning:
callers cannot invert minimum clearance, use nominal/typical data as maximum,
compare W to VA or use signed flow as demand magnitude. All source conditions
must apply before YES/NO. Competing applicable values abstain, including the
converter's shared low/full input boundary. Unknown revision applicability
abstains; known opposing revisions contradict. Current/duration ratings never
prove recovery/duty or BMS transitions. Clearance, directional voltage/current/
power, VA, AC phase and installation-temperature diagnostics add mandatory
Phase3 conditions. Actual Phase5 handoff retains prior architecture/selection/PV
holds. Positive bounded predicates still retain source and installation authority
holds; they are never independent engineering verification.

PV reference diagnostics own exact physical pieces/counts under a declared
arrangement. Reuse/count contradictions block.
Controller-wide limits belong to one array group per physical controller in this
version; repeated groups are rejected rather than reusing its full input budget.
Independent tracker/group sharing requires separate source and installation proof.
Explicit module temperature,
irradiance and spectrum must match source reference. Same-model equal-length
strings allow traced Voc reference arithmetic. Series Isc additionally requires
equivalent normalized reference ratings, conditions and any applied coefficient,
manufacturer/model/MPN/hardware revision, retained-source digest and document
revision. Separate component/fact IDs may share these assertions. Equal numbers
from different source editions do not prove equivalence in this bounded model;
they remain UNRESOLVED pending reconciliation. Mismatched series currents never
select the first module, minimum or maximum. Source fact IDs remain visible and
independent supported NOs still block; mixed I-V/yield is not modeled.
Relative percent/fraction and absolute V/K/A/K coefficients retain units and
require an independently stated temperature domain. Plotted points, ambient
range, NOCT and gamma-Pmax cannot supply beta-Vmp or coefficient domains.

Generic source headroom is separate from Vmp limits. For explicit controller
state/battery voltage, a passive source's proven Voc upper bound can establish a
necessary NO when it cannot satisfy that threshold. Startup is strict greater-
than; the published running minimum permits equality. Passing this upper-bound
test cannot prove operating voltage, startup, restart or hysteresis. No tracker,
port, wire, protection or compliance proof is invented.

## Coverage, formatting and remaining gates

Eight drafts retain directly examined model-owned electrical, conditional,
physical, mode, connection, communications and installation facts beyond automatic
ingestion. The coverage report separately identifies representation/consumer
disposition and declared intended-use requirements. Stateful controls, detailed
curves, protection/recovery, physical fit and disputed documents remain facts or
explicit gaps. Partial-reviewable is distinct from complete original intended-use
readiness, review, admission and verification. Not found in an examined document
never means the manufacturer does not publish it elsewhere.

Readiness generation uses repository Prettier with frozen source inputs. Two
outputs from identical inputs must match byte-for-byte. Historical341/254 and77
extraction denominators remain separate from authoring counts. Normal CI uses
invented sources; genuine byte/authoring checks require explicit private inputs.
Operator visual/timing acceptance and Ubuntu/Node22 CI remain human gates.
