# Ingestion contracts

This package defines the Phase 9B-2B representation boundary for product
source, extracted fact, and candidate component artifacts.

Artifacts produced by ingestion are untrusted and reviewable. They are not
canonical catalog records, and this package has no write path to
`data/components`. The engineering core remains independent of ingestion.

Unknown and conflicting values remain explicit. AI-assisted extraction is
never verification by itself. Canonical promotion and design selection are
outside this package and require a later reviewed pipeline.

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
