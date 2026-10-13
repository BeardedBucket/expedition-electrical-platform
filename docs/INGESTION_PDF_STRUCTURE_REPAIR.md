# PDF structural reconstruction contract

`pdf-source-layout.v1` supplements the unchanged `pdf-vector-grid.v1` and
`pdf-positioned-label-value.v1` mechanisms. It retains every ordinary text item,
its page/item locator, baseline, width, source font ascent/descent and upright
state. Renderer rules retain their operation number and source stroke width.
Extraction never confers manufacturer verification or canonical authority.

The existing PDF parser/output limits still apply: 32 MB input, 50,000 output
items, 2,000,000 retained UTF-16 code units, 100,000 code units per block and
50,000 structural records. Supplements consume these budgets, including their
duplicated source text and metadata. Partial text pages cannot acquire structural
scope. The text reader, page cleanup and loading-task destruction remain owned
by their existing `finally` blocks. An operator failure preserves completed raw
text and withholds that page's supplement. Missing font metrics withhold only the
new mechanism, preserving older mechanisms.

## Hypotheses and confirmation

Qualification revalidates the closed payload and all original item links against
the owning extraction artifact. The extraction/capture digests bind coordinates
and literals; a caller marker or source URL never attests product applicability.
Three independent reconstruction families operate on the same retained evidence:

- **Painted cells:** four edges must come from one renderer operation. A literal
  unique model header and a separate label header establish columns. Complete
  label/value regions must agree on source rows; competing or crossing cells
  withhold. Baselines establish row placement: source font metric boxes can
  overhang painted backgrounds. An em larger than the row is rejected. Nested
  backgrounds cannot truncate wrapped labels or values.
- **Open ruled tables:** a unique literal, larger page title precedes the table.
  Independently painted upper/lower horizontal rules bound rows. Text gaps only
  propose a seam; a unique largest gap and at least three independently repeated
  label/value seams confirm it. Competing seams and multiple independent rows
  inside one proposed relationship withhold.
- **Aligned model matrices:** printed, unique model headers define disjoint
  columns. At least three complete rows must independently repeat the label edge
  and populate every model column without crossings. Common source glyph
  intervals propose text lines. A distant/overlapping caption does not acquire
  table scope. Shared, partial, ambiguous or crossing columns do not permit
  sibling selection. Source group cells or bounded peer headings retain sections.

Three repeated rows is a conservative operating choice to exclude one incidental
alignment or a two-line caption. A quarter of the smaller source em admits only
label/column-edge alignment hypotheses despite PDF justification and float
rounding. Value items still require complete disjoint column/cell placement;
this heuristic cannot merge values, choose a model, compare engineering
measurements or confer authority alone. Source glyph-interval overlap establishes
line hypotheses without a coordinate epsilon. Stroke half-width is actual source
ink, independent of the em heuristic. These conservative heuristics need retained
source regressions and measured workloads before widening.

The 2,000,000-comparison envelope intentionally matches the earlier mechanism's
conservative operational ceiling. Extraction bounds item/rule and nested-region
work before pruning; qualification bounds retained record comparisons. No
benchmark establishing a universal optimum exists. This is neither a safety
factor nor a bound on all PDF.js CPU/RAM. Empty rectangles, redundant nested
backgrounds and unsupported drawing paths are omitted from the supplement;
their original text and captured bytes remain available. Upright tables on a
page containing rotated drawings may qualify independently; a rotated anchor
inside a proposed row rejects that row.

## Scope and notes

Retained font identities are assigned by first encounter within each page.
PDF.js process-wide document counters never enter evidence payloads or digests.
Distinct source fonts retain separate identities and their original ascent/descent
metrics. Repeated production extraction, qualification, reconciliation, proposals
and candidate projection are checked for exact equality under a fixed clock.

All facts retain source publisher/acquisition provenance, raw wording and literal
model identity. Model applicability is `exact_product`, with no unprinted SKU
attestation. Publisher attribution remains separately governed by the existing
official seed anchor and source Organization/site metadata policies.

Printed full-span peer headings scope subordinate painted rows. Independently
bounded merged heading cells can scope matrix rows. General notes require literal
all-specification/all-parameter/all-rating wording. A section-specific note needs
its literal section and stated quantity class; a numbered row note needs its
explicit source marker. Unknown note scope stays typed `unresolved`, preventing
projection. Note paragraph assembly uses source typography and explicit marker
boundaries; an unbounded final paragraph retains only its proven printed line
and withholds interpretation. All other raw page items remain in extraction;
they are not appended to every fact as guessed conditions.

When a new mechanism confirms the same source label, it supersedes v1's
unassigned-page-context fact for that page. Unrecovered rows still use v1. Both
extraction supplements and every raw item remain retained. Existing persisted
QualifiedFacts are not rewritten.

An entire one-unit dimension tuple with a unique explicit W/D/H permutation can
produce separate width/depth/height source selections. Original tuple literals,
axes and locators remain evidence and typed product-body scope. This is literal
selection, not conversion, installed orientation or an inferred axis convention.
Dual-unit tuples, L axes, incomplete axes and multipart/accessory scopes remain
unsplit. No rounding tolerance is invented.

## Interpretation and replay

Current interpretation is `semantic-assertions.v7` / bridge v12. The immutable v6
catalog, ownership guards and v11 dispatch remain explicit and replayable, along
with earlier versions. V7 adds closed quantity grammars only after frozen PDF
rows reached production qualification: battery input operating range, charging
input range, DC input operation/standby current, maximum charger current,
continuous/surge output-power wording, inverter/charger efficiency and backlight
off current. Continuous source power expressed in VA is apparent output power;
no real-power conversion is implied. Original labels, section/basis/condition
wording and explicit parenthesized durations remain qualified. V7 alone accepts
the new PDF producer's proven axis/body scope. No canonical target is added.

F remains source-native and precedes semantic comparison. A mapped proposal,
candidate or confidence score does not approve, finalize, promote or verify a
product. Test fixtures are project-authored PDFs exercising capture, extraction,
qualification, typed context, F, semantics and candidate projection. No
manufacturer documents are redistributed.

## Remaining structural limits

This is a focused repair, not general PDF table recognition. Family/abbreviated
headers without explicit variant relations, fragmented identifiers outside a
painted cell, missing unit/basis header hierarchies, min/nom/max or state columns,
shared spans without sufficient source boundaries, curved/unknown clipping and
unknown final-note scope can still withhold ordinary facts. Compound independent
quantities and competing unit presentations need further generic interpretation.
These are reported as upstream or semantic misses, not successful coverage.
True canonical representation gaps remain separate from these defects.
