# Engineering schema and evidence corpus — Wave 1

This wave introduces working **provisional preparation and selected-envelope**
consumers. It does not establish general product completeness, qualify a source,
change Phase 3 passport authority, generate Phase 4 architectures, admit a Phase 5
binding, or influence Phase 6 tradeoffs. Commercial overlays have no input to the
new evaluator. The continuation adds atomic profile composition through existing
human source correction and an explicit installed PV gate. Sidecar JSON remains
provisional authoring; see [the durable integration and limits](ENGINEERING_CORPUS_WAVE1_CONTINUATION.md).

## Contracts and ownership

`engineering-profile.v1` contains exact component/model/revision ownership,
source observations, original numeric units, and optional typed PV, tracker,
shared capacity, AC mode and assembly structures. Missing revision is `null`;
missing quantities are omitted and remain unknown. A coefficient may be retained
without a proved application domain, but cannot be used until the domain is
established. Operating temperature is not a coefficient validity domain.

Each value refers to product-owned evidence IDs. Evidence retains publisher,
URL, retrieval timestamp, revision, exact locator, digest or explicit unknown,
limited observation and conditions. A source digest is content identity, not
publisher authentication, revision, qualification or approval. Manufacturer facts
and synthetic observations remain distinct. Numeric unit conversion happens only
in calculation traces; source units are not overwritten. `percent/K / 100` is
normalization, not a derived manufacturer rating. Power coefficient is never a
Vmp coefficient. A separately published Pmax is never replaced by Vmp × Imp.

Evidence IDs must additionally be unique across an installed envelope, because
result traces refer to those IDs directly. Collisions fail before calculation;
one product's evidence cannot become another product's indistinguishable trace.

The schema generator owns the portable schema and the inline copy in the
canonical component schema. Inline inclusion keeps existing standalone AJV
consumers independent of new external schema registration. It preserves unrelated
schema bytes; `node scripts/generate-engineering-profile-schema.mjs --check`
checks both copies using exact known paths. Core semantic validation additionally
checks evidence IDs, model/revision ownership, participant identities and ranges.
`engineering_profile` is an atomic approval field; detached member selection
cannot assert a complete participant/evidence structure. This is defensive
validation for source-adjudicated composition. Product approval remains separate.

No historical record is migrated. Records without the optional profile retain
their existing behavior and authority. New v1 documents must be explicitly
authored; v2 and unknown versions fail. Existing reviewed semantic dispatch and
passport/selection revisions are unchanged. An old semantic decision cannot be
replayed as approval of a new profile. Canonical verification already binds the
whole record content, including this additive field: adding or changing it cannot
inherit a previous content-bound verification event.

`engineering-preparation.v1` binds a proposed profile to explicit private UTF-8
source byte offsets, immutable digests and context locators. Replay requires the
same exact bytes and source metadata. It rejects missing/corrupt bytes, shifted
offsets, changed output, invented authority and unsupported versions. Source
literal binding and readable engineering interpretation are deliberately
separate: an author-proposed paraphrase is not proved text equivalence. Every
source interpretation remains a human review item, even with native ownership.
This sidecar has no approval/promotion API. Its queue is a proposal read-model;
the existing durable source-correction workspace remains the authoritative human
correction workflow for ordinary jobs.

## Executable scope and policy

`engineering-envelope.v2` evaluates explicitly installed homogeneous PV strings
per independently established tracker, and selected simultaneous operating modes.
It returns `ELIGIBLE`, `BLOCKED` and `UNRESOLVED` subchecks with formulas, inputs,
units, source IDs and assumptions. Known contradictions take precedence over
unresolved checks. Source-backed preparations have provisional authority and
cannot produce overall `ELIGIBLE`; only fully controlled synthetic inputs can
pass their selected model. Installation safety always remains `not_evaluated`.
This result is not a Phase 5 mandatory binding or a product recommendation.

PV calculations require explicit justified **cell** temperatures, reference
temperature/irradiance/spectrum, quantity-specific coefficients, application
domains and uncertainty. The linear temperature model evaluates both endpoint
temperatures: coefficient sign determines the worst Voc/Vmp endpoint. It does
not extrapolate outside its declared domain or generate an irradiance/I–V model.
Series and parallel counts are positive safe integers and are multiplied, not
expanded into resource-unbounded module loops. Mixed modules or unequal string
lengths on a tracker are unmodeled. Independently evidenced trackers may carry
different homogeneous groups; connector count never supplies tracker count.

Absolute Voc, module system voltage, source-qualified operating upper voltage, hot
running/start/restart margin, PV Isc/Imp, per-terminal current and reference power
are independent checks. The operating maximum explicitly declares a Voc-envelope
or Vmp-envelope basis; missing/unmodeled basis is unresolved. No detailed transition/I–V model is asserted. Battery charge
current is not a PV current limit. Current upper factors must be explicitly
justified and at least one; omission is unresolved. They are installation
assumptions about irradiance, temperature and uncertainty, not new manufacturer
coefficients. The caller supplies them; there is no default weather, coefficient,
current factor, safety margin or battery voltage. Missing connector/protection
evidence references leave installation constraints unresolved; their presence is
not an installation-compliance assessment. Fuse sizing/standards rules remain
outside this consumer.

Comparisons use unrounded finite IEEE-754 values and inclusive source maxima and
minima. There is no epsilon or invented precision/safety allowance. Published
fractional upper/lower uncertainty is applied before comparison. Permitted power
clipping is reported separately and cannot override an absolute violation.
Reference Pmax sum is not yield, temperature-adjusted output or energy production.

Shared capacity groups retain explicit paths, mode, W/VA/A, optional battery count
and temperature conditions, exclusions and unresolved conditions. The required
group inventory is caller-owned; individual-port success cannot substitute for
it. Boundary demands already include their upstream losses exactly once. The
consumer sums those demands and adds no loss term. W/VA/A mismatch remains
unresolved; no guessed PF/voltage conversion or dispatch/source-priority solver
is implemented. Unknown conditions cannot make a group unconditional.

AC conductor relationships are mode-specific. Bypass source presence and phase/
conductor voltages are checked independently of inversion. Line-to-neutral loads
name a leg; line-to-line loads affect both legs. The scenario's relationship
describes the required installed supply relationship. Per-leg/neutral limits and
neutral/grounding context must be explicit. Neutral current is supplied, not
inferred from balanced watts or nonlinear loads. A listed bypass voltage never
becomes inverter output. Mode transitions and compliance remain unmodeled.

Assembly manifests distinguish required, included and optional modules.
Included packaging is not proof of installation; an absent optional member is
not required. Present members need independent model/revision/count/protocol
proof. Parent energy, output and accuracy are not copied to children. Unknown
protocol cannot pass on endpoint or cable shape. This is explicit assembly
checking, not automatic selection or storage-bank generation.

Portable envelope replay reconstructs the result from its exact supported-version
inputs, not just a recomputed digest. Input and result snapshots are owned copies;
mutating a caller's object cannot alter a saved artifact. No network, wall clock,
randomness, inventory preference or private cache enters evaluation.

## Evidence campaign and extractor experiment

The exact-file ledger lives in `data/ingestion/engineering-wave1/inventory.json`.
The independent assertion-name inventory was frozen before capture and contains
no expected numerical answers. The exact freeze timestamp was not recorded;
it is explicitly unknown. Its initially unmeasured timestamp was removed without
changing assertion names/counts. The ledger digest is refreshed after formatting.
This inventory is used for reporting, never extractor/normalizer input.

Public files contain only project-authored schemas/fixtures, URLs, metadata and
limited attributed facts. Publisher HTML/PDF/extracted text and complete byte
bindings remain private. No redistribution grant is claimed. Normal fixtures
have invented identities, limits, permissions and reference conditions; numeric
resemblance to a source never makes them product acceptance. Default corpus
validation deliberately ignores non-production ingestion campaign artifacts;
the explicit Wave-1 fixture/profile validator tests them without scanning any
component catalog. No new production evidence storage/deduplication design is
introduced. The runner uses the existing capture limits and snapshot protocol.

Native-list PV preparation requires one exact first Product Code row and direct
sibling specification lists in one owning container. Native-model-grid authoring
requires one exact literal model header and source-declared flat HTML spans.
Every row is validated before returning observations. No PDF column reconstruction,
model aliases, oracle values, compound grammar extension or continuation guessing
is added. Header ownership is not SKU identity or tracker grouping. Conditions
and full containing context remain human qualification holds.

The grid experiment preserves 150/45 versus held-out 150/35 ownership in the same
retained HTML. It does not repair the frozen Morningstar/MEAN WELL PDF benchmark
and has no demonstrated increase in accepted usable production claims. It stays
an isolated authoring API; historical extractor/semantic paths are unchanged.
The frozen 341/254 and 77 denominators remain separate historical measurements,
not a current Wave-1 coverage claim. Reviewer time has not been measured.

## G6/G7 consumer audit and next boundaries

| Gap | Inspected evidence / existing representation                                                                                                                                                                                                                                       | Remaining essential work                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G6  | DDR-120 source retains distinct A/B/C families, peak-duration notes and derating graphs; existing directional ports/constraints/qualified ratings can retain many scalar facts. Epoch/Battle Born source captures and existing battery/switch backbone remain separately governed. | Qualify exact family/output column, graph domain, voltage/temperature/load/altitude and recovery context; obtain a reviewed piecewise relation before executing derating. No curve was digitized or inferred. Source-backed battery/BMS/heater/series permissions and switch carry-versus-interruption remain incomplete. |
| G7  | BMV-712 capture matches its historical PDF digest; current measurement participants and genuine observation gate preserve the shunt/accuracy distinction.                                                                                                                          | Acquire/qualify denominator, range, temperature, A/mV transfer, calibration and accessory revision; introduce quantity-specific error/uncertainty consumers together. A 500 A shunt measurement basis cannot become monitor throughput. No new accuracy field is asserted by this wave.                                   |

Other unfinished boundaries: complete source-qualified reference/coefficient and
tracker-grouping authoring through durable profiles; 250/100-Tr
versus MC4 tracker qualification; source priority and loss-conversion modeling;
mode transitions/serial cohorts; complete assembly protocols; independent corpus
denominator replay and timed reviewer experiment; broader review-ready drafting.
These need evidence and a focused authority-preserving implementation slice.
