# Frozen upstream ingestion repair

This slice uses the existing 341-row A/B/C engineering audit and retained captures
as offline regression evidence. The audit never enters production qualification or
semantic interpretation. Its inventory is unchanged; source-observable assertions
with current contracts form the denominator, while the 87 model gaps remain a
separate backlog. No live campaign, approval, canonical write or verification is
part of this slice. The milestone remains unapproved.

## Source-painted PDF structure

`pdf-vector-grid.v1` is a deterministic structural payload in an existing
`structured` document block. It retains ordinary PDF.js text items, their exact
page/item locators, coordinates and full text extent, plus source-painted line
endpoints, stroke ink and page-local operator indices. Ordinary text remains
independently retained. Qualification does not reparse a PDF or consult the audit.
The reader validates the closed payload and links every item to the corresponding
raw document block; a marker alone does not grant ownership.

The producer follows PDF.js 5.4's compressed renderer path encoding. Only upright
rectilinear strokes and filled rectangles contribute boundaries. Source stroke
width supplies endpoint joining allowance; there is no invented alignment
tolerance. Balanced graphics state owns transform, clipping and opacity. Unknown
or curved clips, transformed rotations, form/group internals, invisible strokes,
incomplete paths, dashed boundaries and malformed state abstain. Rectangular clips admit only wholly
contained paths. Graphics decoding failure withholds that page's supplement and
preserves complete ordinary text. Page cleanup remains in `finally`.

Four source boundaries must enclose the whole text run. Boundary-crossing items
and competing cells abstain. An explicit Model(s)/Product(s) row with source
vertical dividers can establish model headers, including open-topped headers;
it cannot establish quantity cells. A unique literal model match establishes
`exact_product`, without asserting an unprinted sales SKU. Closed quantity cells
below that header must enclose the selected column, and have one owning label
cell to the left of the first model column. Distinct sibling values in an
undivided spanning cell remain ambiguous. Raw label, value, unit wording and
every original item locator remain attached. Row/column locators are supplemental
indices of the retained structure, not claims of native PDF table tags.

Unassigned page text below the model header remains `source_semantic` qualifier
evidence. Its section/footnote scope is explicitly unresolved. This protects
conditions from disappearing, but currently prevents many useful values from
automatic projection. It is a reconstruction limitation, not proof that all of
these source assertions genuinely require human review. Multiple label columns,
hierarchical sections, merged multi-row headers, unit columns, state/basis columns,
scoped footnotes, dimensional tuple fan-out and fragmented model identifiers are
not yet generically reconstructed. Range/inequality text can survive as a raw
value, but does not acquire meaning from geometry alone. The rounded clipping of
one frozen matrix and unmatched family headers in others remain unsupported.

The supplement shares existing item, table-cell and retained-text limits.
Duplicated text items and vector rules count as metadata items, serialized JSON
counts as retained UTF-16 text, and over-budget supplemental output abstains.
The 100,000-character per-block bound also applies to the payload. PDF.js operator
decoding is an internal allocation, not a hard memory/CPU quota. Placement has a
conservative operational envelope of `items × (rules + items) <= 2,000,000` to
bound the initial quadratic work. This is an operating choice without measured
production timing evidence, not an engineering threshold. Large-table support
should replace it with indexed placement and measured budgets. Raw text/structure
remain evidence when placement abstains; no truncated extraction grants scope.

## HTML ownership and source attribution

`source-product-html` qualifier revision 2 accepts a unique native Product or
ProductGroup and its primary source heading. A ProductGroup's selected `hasVariant`
must be a unique Product with literal requested identity equality. Engineering
values, category and product-name guesses never select a SKU. Parent properties
retain family applicability, while explicitly selected child properties retain
their exact source scope. No inferred inheritance upgrades the parent ratings.
Literal `PropertyValue.unitText` remains source unit evidence under a closed
property shape; unknown metadata abstains.

Repeated source UL/OL specification rows require exactly two inline children.
Ownership comes from a recognized specification heading, or a unique explicit
Product Code/Model/MPN/SKU/Part Number row within a common list-only parent. A
competing identity row rejects the group. This supports adjacent native list
columns without CSS selectors or manufacturer-specific code. Existing definition
lists, tables, inline pairs and condition evidence remain supported; general
tab/panel ownership and unresolved variants remain limitations.

A fully captured unique source Organization name and same-host URL can declare
a publisher. A direct authoritative depth-zero seed anchor can attribute that
publisher to a linked PDF only when requested and final origins both equal the
seed's final origin. Metadata records the seed capture digest and anchor locator;
this grants no model or SKU applicability. Redirected/cross-origin resources do
not inherit attribution.

Separately, unique native Open Graph `og:site_name` and `og:url` can retain a
publishing-site display label when the canonical URL equals the captured final
URL exactly. This is the [Open Graph publishing-site meaning](https://ogp.me/),
not verification of a legal manufacturer identity. Its distinct basis, source
locators and content digest are retained. A hostname alone supplies no publisher.

## Semantics and authority

The preceding frozen repair used `semantic-assertions.v6` / bridge v11; v5/v10 and earlier
catalogs retain their replay behavior and digests. V6 accepts the new HTML producer
revision and adds module weight plus closed PV Pmax, Vmp, Imp and Isc forms only
after the upstream frozen replay demonstrated actual QualifiedFacts. Independent
same-capture/same-applicability cell-technology and module physical properties
establish PV module subject. Names, category and supported chemistries cannot.
Pmax is qualified maximum DC output power; MPP and short-circuit observations
retain their source basis and output direction. They never become continuous
ratings. Existing Voc uses output direction only with that independently proven
module owner. No new canonical targets or fields are introduced.

F reconciliation remains source-native and precedes typed semantic comparison.
Provisional mappings and candidate content are reviewable proposals. They supply
no product approval or engineering verification. Opaque retained text, unsupported
properties and provenance alone earn no engineering coverage. A row reaching a
QualifiedFact without representable meaning remains a semantic miss; a missing
section/condition hierarchy remains an upstream qualification defect even when
the semantic layer safely withholds it. The final TEMP audit records both the
classification and this structural root cause.

Project-authored PDF and HTML fixtures exercise capture, extraction, ownership,
qualification, typed context, F, semantics and candidate projection without hand
constructed QualifiedFacts. Sibling models, duplicate identity, missing boundaries,
unscoped notes, graphics state and publisher negatives protect the trust boundary.
No manufacturer PDF or raw capture is redistributed in this repository.

The subsequent focused [PDF reconstruction contract](INGESTION_PDF_STRUCTURE_REPAIR.md)
documents `pdf-source-layout.v1` and current v7/v12 interpretation, including
independent painted/open/aligned mechanisms, scoped notes, axis selection,
structural heuristics and remaining unsupported families. V6/v11 stays replayable.
