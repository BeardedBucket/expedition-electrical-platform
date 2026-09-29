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

### Bounded source-capture bytes

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
