# Published power consumption observations

## Existing semantic audit

The component schema and ingestion field mappings previously had no canonical
power-consumption target. `electrical.continuous_power_w` and
`electrical.apparent_power_va` describe ratings, not a device's consumption at a
published condition. `load_consumption` is a capability classification, not a
measurement. Engineering `LoadStateEnergyInput` accepts explicit `powerW`,
`voltageV`, duration, and a caller-supplied state classification. Battery-power and
calculation primitives also accept explicit power inputs; they do not establish
canonical source observations. The existing load-state vocabulary includes
quiescent, but it is not reused to conflate a measurement basis with device state.

The existing target-discriminated `qualified_values` lifecycle already preserves
atomic value/qualifier/evidence relationships and selects them by ID. It is
extended here rather than replaced. No acquisition, extraction, topology,
engineering orchestration, or admin source changes are required.

## Canonical contract

`electrical.power_consumption_w` denotes one published unsigned watt observation.
Its qualified canonical value is a finite number greater than or equal to zero.
Its closed qualifiers object is nonempty in both TypeScript and runtime validation
and permits only:

| Qualifier           | Type and meaning                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `supply_voltage_v`  | Optional finite positive number; exact discrete supply-voltage condition in volts.                                                    |
| `display`           | Optional `{ state: off }` or `{ state: on, brightness_percent?: number }`. Brightness is finite, 0–100, and valid only with state on. |
| `operating_state`   | Optional whole-device `idle`, `standby`, `sleep`, `active`, or `off`, requiring an explicit source assertion.                         |
| `measurement_basis` | Optional `typical`, `nominal`, `maximum`, `minimum`, or `quiescent`, requiring explicit source meaning.                               |
| `electrical_domain` | Optional `ac` or `dc`, established by evidence for this observation. Missing is unknown.                                              |

Unknown keys, empty qualifiers, invalid values, and duplicate canonical IDs fail
validation. Absent qualifiers never acquire defaults. Future operating-state and
basis members are schema/type supported; this slice does not add parsers for
unpublished or ambiguous state labels.

Whole-device `off` cannot coexist with display `on`, with or without brightness.
This is the only cross-state restriction introduced here. Display off still does
not imply whole-device off; active, idle, standby, and sleep may have either display
state. Quiescent remains an independent measurement basis.

The schema also names the optional direct electrical field for truly
unconditional published consumption. Neither accepted display row populates it.
No direct-field label mapping is introduced in this slice.

## Conservative source normalization and fan-out

The initial label grammar accepts case/whitespace-normalized `Power draw display
off` and `Power draw display on (N% brightness)`, where N is an explicit number
from 0 to 100. It is exact grammar matching, not fuzzy matching. A plain generic
power-draw label does not establish the supported display condition.

Each pipe-separated value segment must contain a nonnegative watt number with
an explicit W unit and a positive supply-voltage number with an explicit V unit.
The `@` marker is optional; ordinary spacing variations are accepted. An optional
AC/DC suffix on that segment's voltage establishes its domain. If a separate
source unit is supplied, it must agree with W. No external row supplies a missing
voltage or domain. A, VA, missing units, arbitrary trailing annotations,
malformed segments, and contradictory duplicate conditions fail the complete
row closed. There is no partial-projection contract. Equal duplicate observations
within a row are deterministically deduplicated; segment order does not select a
winner. There is no fixed count of segments or fixed voltage list.

A field mapping may now return multiple normalized observations. The production
semantic bridge fans a safely reconciled group into one proposal for each complete
atomic observation. All proposals retain the same original QualifiedFact
references, acquisition/extraction evidence, and actual reconciliation provenance.
No source QualifiedFact is duplicated. If a group has several source observations,
all complete normalized sets must agree before fan-out. Existing unresolved or
conflicting reconciliation groups remain blocked; this slice does not introduce
new reconciliation winner selection or complex multi-row comparison policy.

Each qualified assertion ID hashes target, normalized value, qualifiers, and
sorted actual supporting QualifiedFact IDs. Each semantic proposal ID hashes its
complete proposal content, including fact/evidence references and input digests.
Normalized atomic observation ordering is deterministic, and source segment order
does not select a winner. Changing source representation can change evidence-bound
artifact IDs even when normalized semantic observations are equivalent. These IDs
do not establish automatic supersession across re-ingestion. Review snapshots
remain evidence-bound, and approval cannot transfer between distinct snapshots. The
candidate bridge emits a distinct provisional ProductionFact projection for each
atomic assertion, hashing the source QualifiedFact digest and assertion. Those
are projection/evidence nodes, not new independent source observations; the raw
multi-point row remains intact on each. Re-normalization validates the selected
point against the entire source row. Calling singular normalization without a
selection does not arbitrarily choose a point from a multi-point row.

Two power rows can therefore remain two reconciliation groups while yielding six
mapped proposals and assertions. Together with qualified voltage and body
dimensions, a four-row acceptance has eight qualified assertions. A 30-label
Ekrano-shaped synthetic fixture retains 30 singleton groups and yields 34
proposals: eight mapped, 26 unsupported. No other mappings are added.

## Source meaning and downstream use

For the synthetic Ekrano-shaped acceptance, display off produces 2.6, 3.0, and
3.7 W at 12, 24, and 48 V. Display on at 100% brightness produces 6.2, 6.6, and
7.4 W at those published voltage points. The separate DC supply-voltage row does
not inject electrical domain into these power observations. Whole-device state
and measurement basis remain absent.

- Display off is not device idle, standby, sleep, or device off.
- Display on is not an assertion of whole-device active state.
- Idle and standby are distinct whole-device states.
- Quiescent is an explicit measurement basis, not a synonym for idle or standby.
- Absent idle, standby, or quiescent observations mean unknown, never zero.
- Published voltage points are discrete; they authorize no interpolation.
- Watts are never derived from current × voltage or apparent power in this path.

Engineering component loaders validate and preserve the assertions without
materializing direct values. Existing consumers remain unchanged. No baseline
load or preferred voltage point is selected. A future consumer must explicitly
understand display/device state, measurement basis, domain, voltage, and any
required schedule before using an observation as a whole-system baseline.

## Review, promotion, and amendments

The existing operator DTO displays each qualified ID independently, even when
many share the power target. `approved_qualified_value_ids` selects complete
assertions; empty ordinary `approved_fields` is supported. Review packages bind
the complete proposal/candidate/evidence snapshots. Selected assertions promote
whole; unselected points do not. Source references contain only evidence published
by that source, and the audit retains ID-bound evidence.

Canonical amendments use the same add/replace operations and snapshot/history
contracts. Adding or replacing one 24 V point reparses the complete supporting
row and proves that exact value and complete qualifier object are present. The
candidate's ID-bound evidence remains authoritative. A human selection cannot
invent a relationship, substitute another voltage point, or introduce a domain,
device state, or basis that the selected source assertion does not establish.
Replace preserves the canonical ID and changes value/qualifiers atomically;
history retains the previous assertion and supporting facts. No special power
writer or amendment path is introduced.
