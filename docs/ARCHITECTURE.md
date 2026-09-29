# Architecture

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

The engineering core should remain reusable across domains. The initial profile is mobile/off-grid vehicle installations. A future stationary-installation profile may add different standards, code requirements, grounding/bonding rules, utility/service assumptions, environmental constraints, and component categories without changing the fundamental component/provenance/advisory architecture.

Advisory records are assessments over separately stored, source-attributed evidence. Severity and confidence remain independent, and policy actions (`inform`, `caution`, `suppress_recommendation`, or `exclude`) are not engineering compatibility results. Automatic assessment is conservative: litigation, community, forum, social, or news reports alone produce a review-needed result rather than a confirmed technical finding. Evaluation receives an explicit timestamp so stale and review-due states are deterministic. Human-reviewed decisions remain explicit and visible.

Advisory evaluation runs once before recommendation and builder overlay processing. A builder catalog or preference can narrow globally eligible candidates but cannot re-enable a suppressed or excluded candidate, and canonical component facts and engineering compatibility remain unchanged.
