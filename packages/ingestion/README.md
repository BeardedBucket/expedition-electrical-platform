# Ingestion contracts

This package defines the Phase 9B-2B representation boundary for product
source, extracted fact, and candidate component artifacts.

Artifacts produced by ingestion are untrusted and reviewable. They are not
canonical catalog records, and this package has no write path to
`data/components`. The engineering core remains independent of ingestion.

Unknown and conflicting values remain explicit. AI-assisted extraction is
never verification by itself. Canonical promotion and design selection are
outside this package and require a later reviewed pipeline.
