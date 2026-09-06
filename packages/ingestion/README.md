# Ingestion contracts

This package defines the Phase 9B-2B representation boundary for product
source, extracted fact, and candidate component artifacts.

Artifacts produced by ingestion are untrusted and reviewable. They are not
canonical catalog records, and capture/normalization has no write path to
`data/components`. The engineering core remains independent of ingestion.

Unknown and conflicting values remain explicit. AI-assisted extraction is
never verification by itself. Canonical promotion and design selection are
outside this package and require a later reviewed pipeline.

## Reviewed promotion boundary

`promoteCandidate` is a pure, offline dry-run boundary from a
`ProductCandidate` to a canonical component proposal. It requires an explicit
approved `PromotionReview` with a reviewer, timestamp, approved fields,
evidence acknowledgement, category, and product role. Pending, rejected,
unresolved, or conflicting candidates never promote, and
`promotion_status: eligible` by itself is not approval.

The function validates the candidate using the existing ingestion validation,
retains source and the fact identifiers supporting approved canonical fields in
`source_refs` and its audit result, while omitted/evidence-only fact identifiers
remain available in the ingestion artifact, and
keeps promoted facts `unverified` unless a separate reviewed data process
establishes verification. Reviewer resolutions must select an existing
candidate fact and include rationale; dimensions remain omitted when their
canonical axis semantics are unresolved. Supplied catalog context is checked
for identity collisions and existing components are never overwritten.

The explicit write adapter is still dry-run by default. The offline pilot
command requires an approved review JSON file:

## Reviewed canonical amendment

The package also exposes a tested, dry-run-safe amendment flow for existing
canonical components. `proposeCanonicalAmendment` accepts the current canonical
record, the reviewed candidate delta, and a reviewed amendment contract that
includes the canonical component ID, approval metadata, allowed field actions,
field-level evidence, and an explicit expected snapshot identity. It applies
only explicitly approved `add` and `replace` fields, protects identity and
verification fields, rejects stale or replayed reviews, and refuses unresolved
evidence. The result includes a deterministic field change summary and additive
amendment history while preserving existing `source_refs`.
`writeCanonicalAmendment` requires an existing `<component-id>.yaml` target,
rechecks the parsed on-disk snapshot immediately before writing, validates the
proposal again, and uses a temporary sibling plus rename/rollback replacement
boundary. After the original is moved to a backup, replacement failure first
attempts restoration. If restoration succeeds, the temporary file is cleaned
and the backup is removed; if restoration fails, the backup is preserved and
its recovery path is reported. On Windows this prevents intentional deletion
of the only known-good record during cleanup; the short rename window is the
supported cross-platform guarantee. Without explicit authorization it emits a
dry-run proposal without mutating the catalog.

```text
npm run promote:pilot --workspace @expedition/ingestion -- --review review.json
npm run promote:pilot --workspace @expedition/ingestion -- --review review.json --write
```

Only the second command requests a write. The adapter validates the canonical
proposal against `data/schemas/component.schema.json` immediately before an
exclusive create-only write, rejects path traversal and absolute paths,
checks both canonical identity/MPN collisions and existing filenames, and
preserves the proposal's source provenance. Existing files are never
overwritten. The review file must contain an explicitly approved
`PromotionReview`; the pilot artifact never supplies or synthesizes approval.

The command is offline and reads only the checked-in pilot artifact, review
input, and canonical catalog. It does not capture source data, use live
network access, or automate Git. Canonical file creation is not final trust
approval: inspect `git diff`, run tests, and use the normal PR/code-review
workflow afterward. Unit tests use temporary directories and never write the
real `data/components/` catalog; CI and ordinary validation leave that catalog
unchanged.

## Source capture and extraction

Capture and interpretation are separate boundaries. `HttpSourceCaptureAdapter`
only retrieves bounded `http`/`https` responses and records retrieval metadata;
it does not execute scripts, use credentials, crawl, or infer source authority.
Loopback, private, and link-local hosts are rejected, including on every
manually followed redirect. Captures default to a 2 MB response limit, a
10 second timeout, and five redirects, with explicit timestamps and SHA-256
content hashes. DNS rebinding and public hostnames that resolve to private
addresses remain outside this boundary.

Captured bodies preserve raw bytes and only expose decoded text for HTML and
`text/*` media. `extractDocument` parses captured HTML as inert data, excluding `script`,
`style`, and `template` content while preserving headings, paragraphs, tables,
definition lists, and lists. PDFs and other media return an explicit
unsupported result. `extractProductFacts` emits only conservative provisional
raw claims using the `unmapped` field; labels and complete values remain
unchanged, and no units are converted or semantic fields guessed. External
text, including prompt-like instructions, is never executed or treated as
repository instructions. Authority is supplied by the caller when constructing
`ProductSource`.

The package has no canonical catalog write path. Tests use synthetic captured
content, stubbed fetch responses, and deterministic clocks; they never access
live websites.

## Normalization and reconciliation

Extraction preserves raw labels and values as provisional claims. Normalization
uses only an explicit, human-editable label registry; unknown labels, qualified
values, ranges, unsupported units, and dimension mismatches remain unresolved.
The small unit registry performs only explicit, dimension-safe conversions
(including mV/V, kW/W, kVA/VA, g/kg, and cm/m/mm).

Reconciliation is a pure operation over explicit sources, facts, and one
candidate identity. Manufacturer technical documentation, product pages,
support documentation, authorized distributors, secondary distributors, then
community/social sources are ordered for stable evidence processing, but
authority never deletes contradictory evidence. Identity or variant mismatches
remain visible and prevent a clean candidate. Candidate fields are built only
from agreeing normalized facts and always retain fact IDs in `field_evidence`.
Provisional evidence, conflicts, and incomplete identity require review;
normalization never verifies, approves, promotes, writes `data/components`, or
performs engineering or safety-advisory decisions. The same inputs produce the
same output regardless of input ordering.

## Phase 9B-2E Victron pilot

The live pilot is explicitly invoked with
`npm run ingest:pilot --workspace @expedition/ingestion`. It captures the
official Victron MultiPlus 24/2000/50-50 120V VE.Bus product page, extracts only
the exact SKU's focused fields, and writes provenance, hashes, facts, candidate,
and review output to `data/ingestion/`. The page body is not redistributed.

Offline replay uses `npm run replay:pilot --workspace @expedition/ingestion` and
rebuilds the candidate from the checked-in artifact without network access.
The artifact remains an ingestion candidate: no command in this phase writes
`data/components/`, approves facts, or promotes a product. A changed source
hash means the source must be re-reviewed and re-ingested; it does not
automatically replace existing evidence.

The artifact keeps the pilot target identity, source-observed MPN evidence, and
policy metadata separate. Offline replay validates the persisted source, facts,
candidate, evidence references, and structured review report, then compares
the reconstructed candidate and report to the persisted values. `data/ingestion/`
is intentionally outside canonical `validate:data` schemas and is covered by
this deterministic replay/test validation instead.

For this pilot, exact identity resolution is deterministic when the declared
pilot target MPN is `PMP242200100`, the captured official source contains the
same source-observed MPN, and no conflicting variant evidence is present.
`identity_status: verified` records that resolution rule; it does not verify
the extracted specifications or waive human review.
