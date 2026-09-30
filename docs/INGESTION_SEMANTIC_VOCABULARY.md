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
