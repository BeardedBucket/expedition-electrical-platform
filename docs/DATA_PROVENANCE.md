# Data Provenance Requirements

Typed QualifiedFact context records producer purpose and revision without
inferring meaning from text. Automatic retained evidence stores complete source
snapshots and exact policy/rule digests with `projection_authority: none`.
Untyped persisted context remains unresolved; only bound typed provenance can be
ignored as an engineering condition. See
[context and retention provenance](INGESTION_CONTEXT_WORKLOAD.md).

Generic semantic assertions bind their exact source fact/context, complete rule
descriptor and interpreter revision. Conditions and applicability stay attached;
derived values retain separate input/formula lineage. Engineering verification
separately binds exact canonical content and its source/amendment and promotion
lineage in an append-only revision chain. SHA-256 identifies content and detects
stale or inconsistent replay; it is not a signature or authenticated identity.
History-less `verified` status establishes no current engineering authority.
Verification binds the exact recorded canonical write destination as well as its
durable origin. Non-text or blank qualifier/context evidence remains attached
to the source fact and explicitly unresolved; locator/note metadata cannot invent
its meaning. The current actor is an operator-supplied local audit label. See [the semantic
and verification provenance contract](INGESTION_ARCHITECTURE_REPAIR.md).

Every factual component record should identify where its values came from.

Preferred source order:

1. manufacturer datasheet/manual/drawing
2. manufacturer support response or official product page
3. independent certified test data
4. reputable distributor technical listing
5. trusted independent measurement, clearly labeled as such

Each externally sourced field may include `source_refs`. Never present an inferred or AI-extracted value as manufacturer-confirmed without verification.

Pricing is a timestamped observation, not a permanent product fact.
