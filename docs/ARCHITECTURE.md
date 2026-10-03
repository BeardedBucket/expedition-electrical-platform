# Architecture

## Resumable product-review deferral

`review_deferred` is an explicit human pause, distinct from terminal
`review_rejected`. The earlier Slice 2D implementation treated both as terminal;
this was corrected after the human stopped before deferring the schema-gap-only
Blue Sea review. The approval artifact's existing `deferred` enum is retained,
but runtime lifecycle authority now requires a rationale and current lifecycle
snapshot and appends the complete bound decision to `product_review_history`.
Optional reason classification belongs to the human, not diagnostics.

Explicit child-job resume appends a revisioned operator event and preserves the
entire preparation unchanged; it does not recapture, rebuild, reinterpret,
approve, or write. The deferred decision remains in history even though its
current pointer is cleared. Legacy terminal-defer records can explicitly resume
with their existing decision preserved as baseline evidence; absent historic
rationale remains unknown. Rejected and finalized records cannot use this route.
The batch only reflects paused children; batch preparation skips them.

A resumed review can separately enter history-preserving re-preparation.
Eligibility binds the exact preserved review and preparation-history count from
the resume event, making this permission one-use. The full old reviewed result
is archived before clearing the current preparation. Old semantic decisions,
including schema-gap dispositions, remain immutable in that revision; they are
not replayed under new schemas. Starting preparation and reviewing its new
proposals require separate explicit operator actions. Store validation checks
append-only history across archives and current review, exact lifecycle payload
preservation, and valid defer/resume transitions. Lifecycle snapshot checks
protect stale browser intent, while versioned reads, conditional saves, file
locks, and atomic replacement remain authoritative for racing writers.

## Empty preparation recovery and positioned PDF evidence

Slice 2D inspection of the accepted Blue Sea 6006 instruction PDF identified a
structure gap, not a capture/source-decision failure. Its original 303,948 bytes
remain in the durable preparation and match SHA-256
`1618923f816efde20d21492fc4b756e113831098cbcb18abea7329b3e71b1f83`.
PDF.js extracts text with page/item provenance, but reports no tagged structure
tree. Specification labels and values are separately positioned on repeated
baselines. The original preparation retained only independent text blocks;
ordinary text blocks do not qualify as label/value facts. A drawing dimension or
nearby text must not acquire a fabricated label or product applicability.

The bounded `pdf-positioned-label-value.v1` path preserves the original text
blocks and additionally recognizes one exact `Specifications` heading and one
larger shared-identifier title on the same page. The title must be an explicit
slash-separated list of distinct identifier tokens containing digits, not prose,
URL text, or a prefix match. Multiple such titles or specification headings are
ambiguous. This is an independently owned PDF source-shape rule, not an extension
of the HTML sole-model/DOM-span contract.

Only upright text, exact shared row baselines, exact repeated two-column starts,
non-overlapping cells, constant font height, and constant descending row pitch
are supported. Two paired rows are the minimum structural repetition needed to
establish columns, not an empirical confidence threshold. No geometric tolerance
is introduced: near alignment remains unsupported. A larger heading at the
same left edge ends the section. Interleaved unpaired rows, extra columns,
competing titles, wraps, and malformed layouts reject the run. An unpaired
left-column tail remains text and also withholds the immediately preceding pair,
because the tail could qualify its label. A right-column tail could continue a
value and rejects the run. Drawings and unsupported prose remain raw text.

Supplemental cells retain separate original page/item paths for labels, values,
identity, and heading; the table groups evidence rather than claiming native PDF
table tags or fabricated spans. Qualification requires exact requested MPN/SKU
membership in that title, verifies each cell against its retained raw item, and
rejects incomplete extraction and contradictory requested identifiers. Heading
context and a unique source footnote, when present, remain qualifier evidence.
This deliberately prevents automatic unconditional semantic projection: the new
facts are provisional source assertions awaiting human semantic review. Compound
values/units remain raw unless the existing unit parser supports them.

The supplement shares existing PDF item/text and table-cell budgets; its cells
count as output items and both duplicated label/value strings count toward the
retained-text budget. No supplemental table is retained when the aggregate would
exceed a bound, and no truncated source receives table scope. The source-shape
marker versions the new interpretation; source digests and document artifact
identity include the actual emitted structure. No source-trust policy or canonical
schema is changed. Auxiliary-document profile/seed support remains a separate
known follow-up, not the cause of the original zero-fact preparation.

The original empty-result same-job recovery is deliberately restricted to an empty,
unapproved `review_ready` preparation with no facts, candidate, proposals, or
semantic decisions. A human action bound to the current review snapshot archives
the complete prior result before returning to `created`; accepted source
decisions are unchanged. A separate preparation action captures/extracts again.
Append-only store validation and CAS protect history and stale/replayed requests.
See the ingestion runtime and operator runbooks for eligibility and sequencing.
Populated reviewed results additionally use the explicit resumed-review archival
contract above; ordinary populated reviews cannot use empty-result recovery.

## Explicit non-table product specification blocks

The reviewed-profile `explicit_label_value_blocks` region (profile schema 1.5)
represents source-authored, directly owned label/value blocks. It is a sibling of
`model_label_value_rows`, whose Xantrex header and repeated model attribute remain
unchanged. A block rule uses one exact official intake seed, a reviewed value-cell
identity selector, and one specification container. Exactly one selected value must
equal the requested model. The first direct row must be a labeled model row whose
value is that same selected node. A sole direct section heading and sole region
bind context; all rows, labels, values, and value lines must be directly owned by
their declared parents. Other selected regions, competing identity values, extra
children, nested axes, mixed labeled/unlabeled lines, and malformed late rows
reject the entire region before any of its observations become facts. The two
direct row children are structural label/value arity, not a resource limit.

One value line yields its exact raw text. Multiple unlabeled lines remain one
ordered raw array, rather than a fabricated combined scalar. Explicit `Label:
value` lines become separate observations with the parent block label and section
heading preserved as material conditions. This retains Charging Mode / Input and
Output separately without interpreting their electrical meaning. Repeated nested
labels and mixed line forms reject the region. Empty values remain unknown and
produce a diagnostic, never zero or false; an explicit sublabel ending at its
colon rejects the malformed region rather than becoming a flat value. QualifiedFacts retain raw value and
label paths, and context evidence points to the actual section heading and parent
label paths. These facts are structural proposals; semantic mapping, engineering
interpretation, and human review remain separate.

The source-shape research capture of the official [EcoFlow 800W Alternator
Charger](https://us.ecoflow.com/products/800w-alternator-charger) on 2026-09-29
(SHA-256 `ae5b41a69fd7ef43395213e097bd3bfed0a6587c28dfcdc0e60bc515a5be10ab`)
showed one section with 14 direct blocks and first block `Model` =
`EF-FC-301-1`. Its reviewed declarative profile bound that retained capture
through the ordinary preparation function and produced 18 provisional facts,
including separate mode Input/Output observations. This is offline source-shape
research, not a Wave 3 production batch or reviewed product evidence. The new
region reuses the existing digest-verified HTML input and retained-output
budgets; it adds no independent size, depth, or item limit. Reconsider its
structural contract only when another independently inspected source demonstrates
a safely expressible shape, rather than relaxing ownership for a count increase.

## Serialized application-state boundary

The 2026-09-29 raw capture of the official [Dometic SeaStar I7800
Dual](https://www.dometic.com/en-us/product/dometic-seastar-i7800-dual-4)
(SHA-256 `dc411484cebe19a48d438b1619194a87bb80e0fc241791e5ec54b1a0a2012393`)
contains exact SKU `9610001409` and technical attributes in a Next.js Flight
`variants[].product` fragment. That fragment is physically present in inert HTML
script text, but its 14 script elements carry executable
`self.__next_f.push([1, ...])` wrappers, no unique script ID or JSON media type,
and a framework record stream with chunk markers and `$` references. Decoding
the outer quoted strings offline is possible without executing JavaScript;
reducing the complete inner stream to one uniquely selectable, source-owned raw
record would require a defined Flight grammar, continuation/reference handling,
and atomic malformed-stream rejection. A substring or regex extraction would not
establish record completeness or sibling isolation. The plain JSON-LD Product
instead uses the page slug as SKU and lacks these exact variant attributes.

This source remains **unsupported framework content** under the current
structured-record contract. No Flight decoder or new parser bounds are introduced.
A future separately scoped decoder would need a stable finite grammar, reviewed
script and record selection, exact duplicate rejection, provenance to frame and
property, and measured bounds for script bytes, frames, nesting, references, and
decoded output before it could be considered. The presence of parseable quoted
strings alone does not justify those assumptions. The exact-record Wave 3 source
gap therefore remains open.

## Reviewed source-shape recovery into production evidence

Contextual battery vocabulary and product-data derivations are specified in
[Ingestion semantic vocabulary](INGESTION_SEMANTIC_VOCABULARY.md). Reviewed
source mechanics and exact product applicability establish the context; the
semantic layer proposes meanings and calculations but cannot approve, finalize,
or write canonical facts. Promotion approval snapshots include derivation
metadata and all resolvable input lineage, so a changed formula, input, or
assumption cannot pass an earlier approval.

Wave 2 adds declarative `identity_region` narrowing and
`model_label_value_rows` regions; see `CORPUS_CAMPAIGN_WAVE_2.md` for the
captured-source review. Identity narrowing requires exactly one container with
exactly one matching reviewed heading before the existing exact visible identity
check. It does not interpolate a model into selectors or grant sibling pages
scope. Existing profiles omit this option and retain their prior behavior.

The new row form is an explicit DOM contract, not CSS layout inference: all rows
must be direct container children and have exactly two direct selected cells.
The sole first header has an empty label cell and the exact requested model in
its value cell. Every subsequent value cell must repeat that exact model in the
reviewed source attribute. Additional cells, nested rows/cells, spans, competing
headers, identity axes, unselected children and text outside cells reject the
entire region before facts are emitted. Two is the label/value structural arity,
not an adjustable resource quota. Empty data values remain unknown and do not
borrow the next row. One enclosing reviewed context container and one heading
are required; the heading is retained conservatively as a material qualifier,
including charger/inverter domain context, without interpreting its meaning.
Raw labels and values retain temperature, duration and mode wording. Semantic
mapping and qualified-value contracts are unchanged.

The additive profile schema accepts the new structural configuration only on the
new region kind. New profiles use schema version 1.4; older profile contracts
remain readable. Source provenance, profile digests, exact intake seed ownership,
byte verification, ordinary extraction completeness and shared supplementary
output bounds still gate this path. Profile source mechanics are reviewed;
generated product facts remain provisional. The Wave 2 Eaton profile uses the
existing simple-table mechanism without a manufacturer-specific implementation.

The Wave 1 capability audit is recorded in `CORPUS_CAMPAIGN_WAVE_1.md`. Legacy
`extractProductFacts` and `extractStructuredProductFacts` remain separate APIs;
production review preparation does not call them or copy their normalized output.
`prepareProfileQualifiedEvidence` adapts the reviewed record-selection mechanics
into ordinary document evidence and `QualifiedFact` artifacts, then uses the same
whole-intake reconciliation, semantic proposals, candidate bridge and review
package as existing table qualification. A reviewed acquisition profile establishes
source mechanics, never reviewed product facts or permission to promote them.

Structured selection requires one reviewed script/path/collection and a unique
exact raw SKU. Property paths are declarative own-property paths, with raw JSON
types, units, full selected record, profile digest and record/property locator
retained. Missing properties remain missing; duplicate records or script nodes
are ambiguous. No family record or neighboring SKU supplies a missing value.

The generic `model-column-scope.v1` qualifier follows exact-row and existing
whole-table scope rules. It requires an explicit unique Model/SKU/Variants header
with a uniquely matching target, source-declared columns and complete extraction.
It rejects spans, repeated axes, duplicate headers, nested tables and inconsistent
cell locators. It never expands a merged cell, transfers a neighboring value or
splits a compound value. Notes and separators become conservative forward context:
each observation snapshots the context established at its source position. Later
notes cannot qualify earlier facts; this rule does not infer global scope or reset
context when another separator appears.

Reviewed HTML profiles may declare conjunctive tag/id/class/attribute descendant
selectors for visible exact identity and specific specification regions. Only the
exact intake seed can acquire this scope; manufacturer domain or URL text alone
cannot. Tables require structurally simple label/value rows; definition lists
require direct alternating DT/DD siblings; labeled lists require direct LI nodes;
line specifications require explicit BR boundaries. Plain prose is unsupported.
Specified region headings narrow source selection; conditional captions/labels
are retained as qualifiers, so semantic label recognition cannot erase conditions.
Multiple page rules, competing identities and malformed structures reject scope.

Supplementary extraction is owned by the production preparation loop, after the
ordinary extraction and qualification for each authoritative capture. It verifies
capture/acquisition/intake/profile bindings and SHA-256 of retained source bytes;
independently supplied text cannot replace those bytes. It reuses the HTML input,
item and per-block text bounds intentionally. The supplementary item envelope
counts retained blocks plus QualifiedFact observations before artifact construction;
their sum must not exceed the ordinary HTML `max_items` default. Exceeding any output
bound rejects all facts from that supplement and reports partial evidence. The
ordinary complete extraction is required, so this path cannot evade parser limits.
Supplemental artifact IDs bind the source evidence and reviewed configuration;
they are deterministic and receive no approval, confidence or canonical status.

Read-only URI eligibility is independent of officiality and capture success.
Discovered commerce/account/wiki action links retain metadata and officiality but
are excluded before scheduling, consuming no capture slot. Transport enforces
the same boundary on seed requests and redirects before destination fetches.
Explicit action tokens are blocked; technical query/export/download endpoints
remain eligible. This small generic deny list is empirical Wave 1 policy, not a
general proof that all GET endpoints are read-only. Discovery and byte budgets
remain independently owned by acquisition and capture. PDF text extraction and
its unsupported table/layout diagnostic are unchanged.

## Logical layers

1. **Physical constants and calculations** — deterministic formulas such as power/current relationships and conductor resistance calculations.
2. **Standards datasets** — human-entered, versioned tables derived from standards under an allowed-use process.
3. **Engineering rules** — human-reviewable rules that transform requirements into constraints, warnings, and candidate architectures.
4. **Global component library** — product facts, dimensions, electrical limits, weight, links, cost snapshots, CAD/drawing availability, and compatibility metadata.
5. **Safety/advisory layer** — time-aware advisories, recalls, watch items, affected revisions, evidence, and disposition.
6. **Builder overlay** — inventory, preferred products, services, regions, lead routing, and optional builder-specific pricing.
7. **Recommendation engine** — selects and scores candidates without allowing commercial preference to defeat engineering constraints.
8. **Configurator UI/embed** — generic hosted app plus builder-aware embeddable mode.

## Recommendation precedence

Safety exclusion / mandatory constraint
→ engineering compatibility
→ architecture suitability
→ builder inventory (when applicable)
→ builder preference
→ evidence confidence / field history
→ price / availability / user preference

## Important distinction

A product may score highly for engineering fit while carrying an active advisory. The advisory state is never hidden inside a single weighted score.

## Builder overlay catalog model

The builder overlay uses a canonical component catalog keyed by stable component IDs rather than manufacturer names, labels, or SKUs. Builder-owned commercial metadata such as price, currency, lead time, and notes stays in the overlay and is never treated as canonical engineering truth.

Eligibility flows in layers: engineering compatibility and safety/advisory checks happen first, then builder catalog availability and preference are applied. Generic mode returns all globally eligible candidates without builder restrictions, while a resolved builder only operates on globally eligible candidates and may return an `inventory_gap` when eligible products exist but none are currently supported by that builder.

## Configurator boundary

React owns input collection, application state, explicit evaluation timestamp creation, and presentation of deterministic engine outputs. The engineering core owns calculations, compatibility checks, advisory decisions, recommendation eligibility, builder overlay semantics, and trace provenance. The UI may group or label engine-returned results, but it does not re-create the underlying decision policy.

Unknown or insufficient data is a first-class state. An unknown fit is not the same as an incompatible product, and the UI must preserve that distinction rather than collapsing it into a synthetic failure state.

Builder-specific mode applies only after global engineering and advisory eligibility. Builder inventory and preference can narrow the list of globally eligible candidates, but cannot override global ineligibility or re-enable suppressed or excluded candidates. Unresolved builder identity does not silently fall back to generic mode.

Advisory evaluation receives an explicit `evaluatedAt` from the app boundary. The engineering core does not implicitly consult the wall clock when deterministic advisory state is required.

Product ingestion is a first-class backend subsystem responsible for acquiring and capturing source evidence, extracting, qualifying, and reconciling claims, preparing proposals for review, and promoting reviewed facts while preserving provenance and historical revisions. It keeps uncertainty and review status explicit and remains separate from installed-system engineering, compatibility, architecture generation, recommendation, and UI concerns.

### Qualified-fact reconciliation outcomes

Reconciliation groups source-native observations by established intake/candidate
scope, source label, and applicability identity. It preserves every fact and
does not select a winner or assign confidence. Its outcomes are:

- `single_observation`: exactly one present, safely qualified observation in an
  established group, with an available label and resolved applicability. The
  qualification must be `exact` or `structurally_supported`, with no unsafe
  conditions, duration, temperature/revision context, derivation, or alternative
  interpretations under the existing observation context gate. No pairwise
  comparison occurred; the comparison array is empty. Complex source-native
  values need not parse as scalars to receive this outcome.
- `agreement`: at least two present observations, with all required pairwise
  comparisons safe and mechanically equal. This is multiple-observation
  agreement; it does not prove independent-source corroboration. Fact IDs may
  share a capture or acquisition.
- `conflict`: a safe pairwise comparison establishes contradictory values.
  Other unresolved comparisons remain visible alongside the conflict.
- `unresolved`: missing members, unsafe qualification/context, non-comparable
  evidence, or another existing safety reason prevents the other outcomes.

Unscoped, scope-inconsistent, and label-unavailable facts retain their separate
whole-intake accounting categories. Groups are recomputed from current evidence:
a later comparable observation can change `single_observation` to `agreement`
or `conflict`; prior results do not mask new disagreement.

Source authority remains outside reconciliation. The production workflow checks
official acquisition and authoritative captures before qualification, and the
candidate bridge checks those boundaries again before projection. The standalone
reconciliation API does not establish source authority. Neither outcome grants
canonical truth, reviewed status, source independence, or promotion authority.

The semantic bridge accepts `single_observation` and `agreement` into its existing
mapping/normalization pipeline while retaining the actual F outcome in provenance.
Context safety, explicit field mappings, evidence references, and human review
remain required; unknown labels remain unsupported. The additive outcome is
serialized in preparation job state using the existing codec and schema version;
legacy outcomes remain readable. Recomputed results and dependent proposal/review
digests reflect the new semantics; historical snapshots are not rewritten.

Candidate intake identity remains a request, including any operator-supplied MPN.
Legacy candidate identity verification requires a matching explicit MPN claim
from an applicable manufacturer technical, product, or support source, as well
as the existing identity completeness and compatibility checks. Model-only
claims leave an MPN-containing identity provisional and requiring review; they
never become MPN source claims. Conflicting identity claims remain visible and
block verification regardless of source authority. Identity verification does
not verify provisional extracted facts or remove their human-review requirement.

### Structured HTML extraction evidence

HTML table cells retain their own `th`/`td` header/data role and optional
source-declared `colspan`, `rowspan`, and valid `scope` values. Row and column
coordinates remain one-based DOM ordinals, not an expanded grid. Missing or
malformed spans and scope are omitted; explicit positive safe-integer spans,
including one, are retained. Existing table/cell locators remain unchanged.

Cells containing `sup` or `sub` may additionally retain ordered `inline_segments`
with ordinary text, superscript, and subscript roles. These are flat text runs,
not a DOM tree: the nearest enclosing script element determines a run's role,
while ordinary formatting wrappers add no role. Separate script elements remain
separate runs. Runs use the parent cell's locator and the existing text-length
budget; truncation is diagnosed. Existing whitespace-cleaned label/value text
remains available unchanged. Segments preserve DOM text with whitespace cleanup
and need not reconstruct the legacy text collector's inserted separators.

This evidence asserts neither product identity nor footnote meaning. The HTML
extractor version identifies the enriched output, and artifact hashing includes
the optional structure. Existing schema-version 1.0 artifacts remain valid.
PDF extraction remains text-only and does not infer HTML cell structure.

### Structured whole-table product qualification

`whole-table-product-scope.v1` can qualify HTML label/value specifications at
`exact_product` scope independently of an intake MPN. Existing exact target
data-row qualification takes precedence, including its duplicate-row rejection.
The new rule requires complete extraction, acquisition/capture references,
consistent table/cell locators, and a sole first-row header whose explicit
colspan equals every subsequent row's structural width. Widths sum source spans
without expanding cells. Nontrivial rowspans, peer/later headers, multi-value
layouts, explicit model/variant/part-number labels, and additional target-like
identity locations remain unresolved.

The header must exactly match the requested model under trim-only identity
comparison. Alternatively, one ordinary-text run may match while trailing
superscript runs each contain only a positive bracketed decimal reference marker
such as `[1]`. Raw header text must agree with those segments. Subscripts,
unbracketed superscripts, interleaved ordinary text, and arbitrary bracketed raw
suffixes are not ignored. This narrow rule classifies reference-like structure;
it does not verify a linked footnote or the intake's MPN.

Each specification remains provisional and structurally supported, with native
label/value evidence and a model applicability binding. Header context and the
rule rationale remain traceable through existing evidence fields. Full-width
single data cells serve only as separators. No semantic mapping, reconciliation,
candidate identity verification, or PDF qualification policy changes here.

### Bounded technical-resource acquisition

The retained resource set is the result of a deterministic bounded priority-aware
traversal, not the first 50 resources from the former lexical traversal. Generic
capture priority may change which depth-one resources enter that set. The global
limits remain 50 distinct normalized resources and 20 candidate captures by
default; the seed capture is separate. Structural manual-link admission, reviewed
domain eligibility, bounded duplicate provenance, redirect suppression, and the
depth-one maximum remain unchanged.

### Document source locators

Document block `locator` and optional `source_location` both carry source-location
metadata in the production TypeScript contract and runtime validator. Their
optional `ordinal` must be a positive integer. Current PDF extraction records the
raw PDF.js item position within each page, including positions skipped from
retained output; it is not a global retained-block index. Page and raw ordinal
also appear in deterministic PDF paths/fragments and therefore block IDs.
HTML locators may omit ordinal. This metadata does not assert semantic grouping
of PDF text. The closed inline serialized block-locator schema previously omitted
ordinal despite production emission; permitting it corrects schema drift without
changing extraction, artifact hashing, or location meaning. The inline schema
retains its legacy string-valued `row`, distinct from the numeric row in the
shared location schema, so this correction adds only ordinal rather than replacing
the inline schema and altering unrelated serialized compatibility.

### Bounded source-capture bytes

PDF extraction has an independent parser-input ceiling of 32,000,000 bytes,
owned explicitly by the extraction layer and intentionally aligned with the
current PDF transport ceiling. Neither production constant controls the other.
Transport still uses the unchanged 32,000,000-byte per-resource/absolute PDF allowance and
40,000,000-byte whole-acquisition allowance. Explicit byte counts are authoritative;
32,000,000 bytes is decimal 32 MB, approximately 30.52 MiB.

The former shared 8,388,608-byte (8 MiB) extraction gate was introduced in
`305e306c6832783bb7e8cb9e1148e1131243b732` (Add production document extraction).
The inspected history contains no architectural justification for that numeric
value. It prevented a successfully captured 28,630,824-byte official manual from
reaching PDF.js. That observation justifies supporting the admitted size class;
it does not establish that this manual represents all PDFs. HTML retains the
8,388,608-byte extraction ceiling, and text-only dispatch semantics are unchanged.
Callers can still supply independent extraction limits.

PDF.js 5.4.149 receives an in-memory Uint8Array, with one explicit parser-owned
full-source copy because its worker messaging transfers and detaches the input
buffer. The captured source remains available for digest and snapshot identity.
For a full-buffer Uint8Array, PDF.js's input normalization returns that array;
its worker/Node loopback messaging transfers it rather than cloning another
full byte array. No Buffer conversion or text decode occurs in the PDF extractor.
HTTP capture assembles streamed chunks into a contiguous byte array (both exist
transiently); it now decodes only HTML/text media, avoiding a discarded full-body
PDF string. Source classification still decodes at most a 65,536-byte inspection
prefix. File snapshot reads still copy the readFile Buffer to Uint8Array;
this pre-existing replay path is unchanged. At parser entry there are two explicit
source-byte representations: preserved capture/replay bytes and transferred
parser bytes. This count excludes transport temporaries and parser-internal
objects, decompressed streams, fonts, and caches; it is not a RAM measurement.

The extractor consumes PDF.js text chunks page by page rather than collecting
an entire page's text array. It preserves page/item ordinals across chunks,
cancels the stream at the item boundary, releases its reader, cleans each page,
and destroys the loading task on success or failure. Stream cancellation supplies
the Error reason required by PDF.js's message handler before it marks the stream
closed. Defaults remain 1,000 pages and 100,000 characters per block; PDF output
has independent block and total-text budgets described below. The declared text
cap is now enforced for PDF blocks as well as HTML. The HTML table-cell ceiling
remains 50,000 per table, with table blocks subject to the item cap; PDF table
structure remains unsupported and produces zero tables. There is no separate
table-count setting. Parser exceptions, including cleanup failures, produce an
explicit failed result with no fabricated blocks.

These are application input/output bounds, not hard limits on all PDF.js internal
allocations or CPU time. PDF.js initializes document metadata in memory and can
expand compressed streams internally; no independent extraction wall-clock or
process timeout exists. Evaluation is disabled and worker fetching is disabled;
no rendering or OCR is requested. Larger admitted input does not guarantee full
extraction. Page, item, or text limits produce diagnosed bounded partial results;
source authority, snapshot verification, qualification, and review remain
separate unchanged boundaries. No OCR or image extraction was added.

### PDF retained-output policy

PDF extraction independently owns a default maximum of **50,000 retained cleaned
PDF.js text blocks** and **2,000,000 total retained UTF-16 code units**. HTML still
uses 10,000 structural items; it ignores the PDF-only total-text setting.
The numerically equal HTML 50,000-cell-per-table ceiling is independently owned
and counts different units; it is not coupled to the PDF retained-block cap.
`PdfDocumentExtractionLimits.max_total_text_code_units` measures the sum of
retained block string lengths after whitespace cleanup and the independent
100,000-code-unit per-block cap. Internal cleaned spaces count. No inter-block
spaces or separators are inserted or counted.
The historical `max_text_length` name is unchanged; its current JavaScript
string slicing/length implementation also measures UTF-16 code units.
Existing `max_items` overrides
remain effective for either extractor; async dispatch and retained-capture replay
also forward the optional PDF-only total-text override. Explicit caller overrides
can narrow or enlarge these defaults; these are trusted application settings.

The historical shared PDF 10,000 value first appeared in checkpoint
`1ac4f9069cb1a2d11a1974c77a737fb4f558dfc7` and landed in
`305e306c6832783bb7e8cb9e1148e1131243b732`; no numeric rationale was recovered.
HTML structures and PDF.js text items are different units. The 2026-09-29 single
production capture of the official 260-page technical manual produced 19,519 raw
item positions, 12,886 cleaned nonempty items, and 500,972 code units. Its source
was 28,630,824 bytes (SHA-256
`3b2201d910470551b4b959f27d993aeda07c06a6bf5efcdcc3a6d58cd6dd92f5`).
The legacy output stopped on page 201, with the last retained raw ordinal 13:
10,000 blocks, 393,795 code units, 3,354,719 JSON bytes. The first omitted item
was page 201, raw ordinal 14. A count-only page-stream
diagnostic preceded a production replay with an explicit 12,887-item diagnostic
override. Full output was 4,325,460 JSON bytes and repeated identically; extraction
took approximately 1.29 seconds on that diagnostic host, not a performance SLA.
The prior project-authored 101-page/10,100-block experiment was 3,091,729 JSON bytes.

For the manual, per-page retained counts were min/median/p95/max 3/47/90/175;
per-page cleaned code units were 59/1,748/3,593/8,178. Item lengths were
1/24/123/143. Items of at most 1, 3, and 10 code units accounted for
1,591 (12.35%), 2,518 (19.54%), and 4,249 (32.97%) respectively. Samples from
pages 1, 30, 100, 180, and 260 mixed headings, line-sized phrases, words,
bullet markers, and code-like fragments. They do not establish paragraph or
table semantics. One-item-per-block remains a source-faithful mechanical
representation, preserving raw page order and skipped-item ordinals. Aggregation
solely to reduce counts would change evidence content, membership, and identity
without an established generic grouping rule; none is introduced.

The round 50,000/2,000,000 limits are conservative operating defaults with roughly
fourfold headroom over this representative large technical PDF, not standards
values, manufacturer exceptions, or a claim about every admitted PDF. Count bounds
block/locator metadata and per-block hashing costs; total text independently bounds
retained strings and prevents the former count-times-per-block allowance from
permitting enormous logical output. Neither source bytes nor block count alone
predicts decompressed text or artifact size. JSON escaping, duplicated locator
metadata, hashing, serialization, and persisted copies add allocation and storage
cost; no exact RAM measurement or independent artifact-byte quota is asserted.
Both budgets remain necessary, since many tiny items create metadata overhead
while a few long items can dominate text. Existing qualification iterates blocks
but does not infer facts from bare PDF text; this manual still yields zero facts.
Persistence has no independent 10,000-block contract assumption or extraction
artifact-byte quota. These limits do not cap parser-internal allocation or CPU.

Before retaining each block, streaming extraction checks count and then the
total-text allowance. The first crossing block is omitted whole; a remaining
allowance can therefore be unused. Earlier per-block truncation remains explicitly
diagnosed. Exactly filling a budget at EOF is complete; an additional nonempty
item triggers `item_limit_reached` or the additive `total_text_limit_reached`.
Partial output is a deterministic useful source prefix, never complete coverage
or verified facts. Even a zero-block budget stop is partial, not image-only.
Qualification treats the new diagnostic as incomplete coverage; the closed
diagnostic schema and runtime allowlist both admit it. Existing stream-finally
ownership cancels with Error, releases the lock, cleans the page, stops subsequent
pages, and destroys the task; cleanup failures remain contained parser failures.
Capture bytes and digest ownership are unchanged. Input/page/per-block limits,
no OCR, and no PDF table inference remain independent.

Reconsider these defaults when a broader supported corpus or measured operational
allocation/storage/latency evidence demonstrates insufficient headroom or excessive
cost. Such evidence could justify smaller limits, larger bounded defaults, or a
separate artifact budget. This single manual supports a conservative default,
not removal of output boundaries or semantic grouping.

Each HTTP response has an internal media-aware transport allowance: `text/html`
and `text/*` are limited to 2,000,000 bytes, `application/pdf` to 32,000,000
bytes, and other or unknown binary media to 4,000,000 bytes. An absolute
per-response ceiling of 32,000,000 bytes applies to every class. The PDF
allowance reflects measured manufacturer evidence, including a 28,630,824-byte
technical manual; this measurement is policy rationale, not a manufacturer-
specific exception or rule.

An explicitly supplied `max_bytes` can only narrow the applicable media-class
allowance. The default whole-acquisition scheduling threshold is 40,000,000
bytes and includes the seed plus candidate captures. `Content-Length` is only
an early-rejection hint, never byte-accounting truth. Actual streamed bytes
drive `bytes_observed` and aggregate accounting. A stream reader may deliver a
final chunk that crosses the remaining threshold before cancellation; that
chunk is reported and counted, so observed acquisition bytes can exceed the
configured threshold. Once the threshold is exhausted, no later candidate
capture begins.

Source-resolution candidate capture inherits the shared per-response
media-aware policy automatically. It is a separate single capture and does not
share the multi-capture acquisition aggregate budget. This policy does not add
raw response bodies to durable production artifacts or job records.

Scheduling uses transient acquisition metadata, never confidence or reviewed
product semantics. A tuple puts technical resources with exact requested model
or MPN context before technical resources whose context is not asserted, then
support/product navigation, then generic resources. Within each technical tier:

1. Potential expansion-capable structural manual/document indexes (only at depth
   zero with depth-one discovery enabled).
2. Explicit technical specifications, specification sheets, and concrete datasheets.
3. Manuals and installation material.
4. Dimensions, drawings, cut-outs, and schematics.
5. Certificates, compatibility, and firmware material.

Signals come from the URI leaf, label, inferred role, structural context, and
immediate parent provenance. A child's exact model/MPN context may come from its
manual parent's URI; the seed product URI does not confer product specificity on
every linked resource. Identity matching is case-insensitive, uses spaces,
hyphens, and underscores as equivalent separators, and requires complete token
boundaries. It does not fuzzy-match or infer irrelevance from absent identity.
Broad support/navigation collections remain below concrete technical documents.
Declared CAD/media/archive URI forms remain generic scheduling candidates; their
eligibility is unchanged. Index priority is only a pre-capture hint: actual
expansion still requires authoritative official HTML under the existing rule.

One owning occurrence per normalized resource enters each priority comparison.
The first pending occurrence supplies its metadata; per-parent occurrences remain
lexically ordered and newly discovered children are inserted first. Duplicate
occurrences retain bounded provenance without priority votes or independent
captures. Equal tuples use the existing normalized-URI/method/raw-URI/label/locator
comparator. Newly discovered children immediately compete with pending seeds.
No additional HTTP work is performed for ranking. Captured content, redirects,
MIME types, extraction, qualification, and proposal outcomes are not priority
inputs. Same inputs and capture responses reproduce membership, traversal,
selection, and artifact snapshots.

Deferred work remains future-facing: live advisory feeds and embed/widget integration for later phases.

## Canonical qualified product values

Published consumption observations extend this lifecycle through
`electrical.power_consumption_w`; see
[Power consumption semantics](POWER_CONSUMPTION_SEMANTICS.md) for the closed
conditions, source-row fan-out, and explicit downstream-consumer boundary.

Unconditional source assertions continue using existing direct canonical fields.
Materially qualified assertions use the additive `qualified_values` collection.
Each member binds a product-local `id`, a schema-supported `target`, a normalized
`value`, and typed `qualifiers` atomically. These are canonical product assertions,
not evidence-only metadata. Multiple members may share a target under different
qualifier contexts. A materially qualified assertion must never also populate its
unconditional direct field. Unrecognized material qualifier meaning prevents
projection, rather than being discarded to fit a direct field.

The initial target union supports `electrical.input_voltage_range_v` with explicit
`electrical_domain: ac | dc`, and `dimensions_mm` with
`physical_scope: { kind: physical_body, exclusions: [...] }`. Exclusions currently
support `connectors` and `mounting_accessories`. Domain is never inferred from
plain V, category, manufacturer, or system expectations. Body dimensions remain
distinct from mounted/installed envelopes and service clearances. Future operating
state, duration, temperature, measurement, and location qualifier kinds extend
the typed target/qualifier union without changing the surrounding assertion shape.

Initial production IDs hash target, normalized value, qualifiers, and sorted
source-qualified fact IDs using the existing deterministic artifact hash pattern.
Recognized qualifier context also participates in reconciliation grouping; values
remain outside group identity, so different values under the same context conflict.
They identify a proposal's initial assertion; they do not establish automatic
supersession across re-ingestion. Candidate `qualified_value_evidence` maps each
assertion ID to supporting fact IDs. Review packages bind the complete candidate
and evidence snapshots. New-product approval explicitly selects
`approved_qualified_value_ids`; package approval or ordinary `approved_fields`
does not select qualified assertions. Promotion copies each selected assertion
whole and preserves ID-bound evidence in its audit and source references. Each
source reference contains only the qualified supporting facts produced by that
source; the promotion audit retains the complete assertion evidence set.

The operator review DTO presents qualified assertions separately from ordinary
field paths, including their IDs, complete values and qualifiers, and the existing
allowlisted source evidence and locators. Human review selects each ID independently.
Approval requires an ordinary field or qualified ID selection plus the existing
role, category, and evidence acknowledgement. Canonical writing remains a separate
explicit finalization action.

Ordinary field paths use `field_actions`/`field_changes`. Qualified members use
dedicated `qualified_value_operations` addressed by ID: `add` requires an absent
ID, and `replace` requires an existing ID with the same target. Replacement
atomically replaces value and qualifiers while preserving ID. Remove is
deliberately unsupported. Array indexes, whole-array field actions, nested edits,
and target-only replacement are prohibited. Human review explicitly chooses the
canonical ID to replace; no fuzzy re-ingestion matching is performed.

The candidate's nonempty ID-bound evidence is authoritative. Optional operation
and review evidence representations must agree with it after distinct/sorted
normalization; review cannot invent a candidate evidence relationship. Every fact
must support the complete assertion and
belong to the candidate evidence set. Amendments apply to an in-memory clone,
validate the complete proposed component, and use the existing whole-component
snapshot and write boundary. History appends the complete added assertion or
complete previous/replacement assertions, operation ID, fact IDs, review/candidate
IDs, and expected previous canonical snapshot. Existing history is retained;
stale snapshots and replayed review IDs remain blocked.

Loaders preserve qualified assertions without materializing direct fields.
Consumers must explicitly understand qualifiers before using these values;
existing voltage and geometry consumers continue using direct fields and retain
unknown results when those fields are absent. Source raw wording and units remain
separate evidence. Dual-unit dimension presentations are checked using overlapping
rounding intervals at their published decimal precision after deterministic unit
conversion; this is not an engineering tolerance. Canonical values retain the
first published numeric representation converted to millimeters without rounding.

## Domain profiles

### Installed-system backend proof and Engineering Passport

The implemented Phase 3 backend is documented in
[Whole-system backend](WHOLE_SYSTEM_BACKEND.md). It composes the existing core's
calculation, load-state, battery-bank and system-aggregation functions. The
Node-only `@expedition/engineering-core/engineering-passport` entry point is
separate from the browser index and has no ingestion-runtime dependencies.

An `InstalledSystemArchitecture` owns one existing `ReferenceSystem` installation
and an additive `InstalledPowerTopology` over those same component instances.
Electrical domains, logical-port bindings, directed wiring, selected canonical
power paths and conductive relationships are explicit. Domain assignment does
not create connectivity. Neither passive hardware nor a product/category name
creates a conversion path. Multi-function devices retain distinct interfaces.

`evaluateInstalledSystem` receives the exact architecture, requirements,
assumptions and canonical product records; it selects no products or routes.
Its `EngineeringPassport` binds complete supplied record snapshots, their
SHA-256 digests, exact examined canonical evidence, review states, rule metadata,
decisions, calculations, unresolved dependencies and warnings. Its
`examined_evidence` collection distinguishes accepted inputs from withheld
observations, and trace references repeat that use state. Evidence presence alone
does not establish engineering reliance. Manufacturer
revision remains independently unknown or explicitly recorded with review
status. A project digest never supplies that revision. Original source wording
and units unavailable in canonical records are explicitly not retained, rather
than reconstructed from ingestion or asserted as published.

The result's machine-readable assertion scope is
`nominal-connectivity-and-device-demand`; installation safety is explicitly
`not_evaluated`. Unknown idle demand withholds total scheduled energy. The energy
summary has explicit completeness, resolved subtotal and structured unresolved
state/schedule/evaluation contributions, including instances with no schedule.
PV/DC source-context continuity remains unresolved on nominal equality alone;
an explicit reviewed solar-conversion path supplies the modeled boundary. Rule
lifecycle is visible beside the result; executing a draft proof does not approve it.
Device energy does not become battery-side energy, physical body dimensions do not
become installed envelope, and permitted series counts do not imply balancing
or installation approval. Unsupported environmental, autonomy, source-energy,
isolation and shared-capacity assertions remain unresolved when requested.
Advisory references stay separate; no advisory assessment or builder policy
becomes an electrical fact.

Strict JSON loading reconstructs the entire evaluation from embedded snapshots
and rejects changed results or traces even if an envelope hash is recomputed.
Replay additionally requires exact external record content and supported rule
data/evaluator revision. No network, clock or randomness enters evaluation.
The production acceptance deliberately remains incomplete on the currently
unverified corpus; it neither repairs records nor upgrades their status.

The engineering core should remain reusable across domains. The initial profile is mobile/off-grid vehicle installations. A future stationary-installation profile may add different standards, code requirements, grounding/bonding rules, utility/service assumptions, environmental constraints, and component categories without changing the fundamental component/provenance/advisory architecture.

Advisory records are assessments over separately stored, source-attributed evidence. Severity and confidence remain independent, and policy actions (`inform`, `caution`, `suppress_recommendation`, or `exclude`) are not engineering compatibility results. Automatic assessment is conservative: litigation, community, forum, social, or news reports alone produce a review-needed result rather than a confirmed technical finding. Evaluation receives an explicit timestamp so stale and review-due states are deterministic. Human-reviewed decisions remain explicit and visible.

Advisory evaluation runs once before recommendation and builder overlay processing. A builder catalog or preference can narrow globally eligible candidates but cannot re-enable a suppressed or excluded candidate, and canonical component facts and engineering compatibility remain unchanged.
