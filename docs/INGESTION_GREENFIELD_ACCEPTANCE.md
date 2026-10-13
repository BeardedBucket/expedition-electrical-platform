# Greenfield ingestion ownership and acceptance

Fresh production ingestion uses `semantic-assertions.v6` and
`production-semantic-bridge.v11`. The old v3/v8 pressure corpus remains a separate
regression. Its persisted observations do not acquire new context typing.
Archived v2, v3, v4 and v5 rules replay with their original descriptor digests and
grammars; current rules never silently reinterpret an existing reviewed artifact.
The pressure replay command accepts an explicit `--interpreter=semantic-assertions.v3`
for that frozen regression and reports the interpreter used.

## Native source ownership

The initial campaign ran `source-product-html.v1.0.0` qualification after
document extraction, before profile qualification. This is a generic source
structure contract, independent of manufacturer, product category and profile
name. A sole literal JSON-LD `Product`, sole `main` and sole `h1` must agree on the
source product name. Exact source MPN/SKU equality establishes identifier scope;
otherwise exact source model/name equality can establish product scope without
attesting a different order identifier. No fuzzy or case-insensitive identifier
matching supplies applicability. Direct intake evidence for an unmatched owner
can survive unresolved; unrelated discovered product pages cannot supply facts
for the intake product.

Supported quantities come from literal `PropertyValue` records with a closed
metadata shape, source-owned inline label/value pairs, grouped definition lists,
and single-cell label/value tables beneath recognized specification headings.
Extra property metadata, nested competing structure and merged quantity cells
abstain rather than discard possible qualifiers. Full-width section rows can
carry source conditions forward; they never supply a quantity. Source/model
header pairs and complete merged footnotes have separate closed structural
rules. Unknown span ownership remains unresolved.

These producers use the existing HTML byte, item and text bounds, rather than a
second independently tuned acceptance budget. Parser completeness and source
capture byte/digest bindings are required independently. A complete capture does
not imply complete extraction, qualification or engineering interpretation.
Literal source `Organization` name/URL on the same hostname can declare a
publisher only when unique and fully captured. Hostnames alone do not invent
publisher identity. The upstream slice adds a narrowly bound same-origin seed
anchor attribution and separate publishing-site metadata; see
[upstream repair](INGESTION_UPSTREAM_REPAIR.md) for the current contracts.

Producer revision 2 types generated scope explanations as
`qualification_provenance` and source-authored section/qualifier text as
`source_semantic`. Optional `physical_scope: product_body` is valid only on a
document-qualification source-semantic context. It permits explicitly named body
width/depth/height to retain their local axes; it supplies neither installation
orientation nor service clearance. Length is not silently converted into depth.

## Quantity interpretation and abstention

The v4 grammar expansion handles closed ordinary forms such as input/output
voltage with explicit AC/DC units, postfix continuous/peak power basis, charge
and discharge current, capacity, and bracketed label units. Source recommendations,
operating durations and section conditions remain attached to qualified values.
A source-owned battery-type observation may establish battery role only through
its own closed grammar and exact shared capture/applicability. A product name,
category or list of supported chemistries cannot establish that role. A connected
battery voltage on a monitor/controller is not that device's nominal rating.

V5 additionally withholds competing explicit units and trailing same-dimension
numeric measurements. A second mass measurement is not an operating condition.
Both source literals remain available for comparison; no rounding tolerance or
preferred unit is invented. Unit-only suffixes remain distinct from a second
measurement. Different-dimension time qualifiers on a peak quantity remain
conditions. The legacy-equivalence route cannot override these abstentions.
The v4 catalog is frozen separately so its historical replay remains reproducible.

Evidence URI validation rejects explicit commerce/action endpoints, including
script suffixes and mutating query actions. Discovery, HTTP redirects and the
production capture boundary all apply this check; a custom or recorded adapter
cannot bypass it. This is an I/O ownership boundary, independent of officiality:
an official hostname does not make an action endpoint a document. Ordinary
technical script pages and words containing an endpoint substring remain valid.

## Acceptance accounting

The usefulness denominator is independently inspected, source-observable,
in-scope engineering assertions with a current canonical or declared qualified
mechanism. An assertion is a meaning, subject and operating condition; duplicate
observations and translations do not increase coverage. Identity, commercial,
marketing, packaging, navigation and out-of-domain assertions stay separate.
Genuine missing model contracts are reported separately from the current-model
denominator. Retained opaque text and zero-authority identity evidence earn no
engineering coverage. A candidate package does not by itself prove coverage,
product approval, source verification or engineering eligibility.

The frozen campaign records first-pass and corrected production jobs separately.
Offline replay uses the original captured bytes through the normal job workflow;
additional official-source captures are labeled supplemental and never improve
the matched-input primary result. Fresh jobs, raw bodies and manufacturer PDF
inspection outputs remain in TEMP as test evidence. The campaign's retained-body
adapter seam is disclosed separately from default production retention.
Project-authored integration fixtures exercise actual producers from capture to
candidate without redistributing manufacturer documents or constructing facts.

The preserved v5 inspected Round A/B inventory yielded only 25 correctly represented
assertions out of 219 eligible assertions. Round C produced no candidate content.
Ordinary voltage/current/power/dimension assertions still disappear in PDF table
structure, HTML variant ownership or generic interpretation. These are ingestion
architecture defects, not legitimate human ambiguity. The acceptance gate remains
unmet. The TEMP audit records its non-exhaustive auxiliary-manual scope explicitly;
these counts must not be described as complete coverage of every captured page.
Blocked/challenged/oversized acquisition is reported independently, including
available official alternatives and fallback limitations. No semantic dispositions,
approvals, promotions, component writes or engineering verification occur in the
campaign.
