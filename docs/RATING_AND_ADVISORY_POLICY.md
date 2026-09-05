# Product Evidence, Rating, and Advisory Policy

## Purpose

Help users distinguish technical fit from real-world confidence without turning the project into a retailer review aggregator.

## Separate signals

- Engineering fit
- Documentation quality
- Serviceability
- Field reliability evidence
- Independent test evidence
- Manufacturer support history
- Evidence freshness
- Active safety/advisory state

No single score may conceal an active safety advisory.

## Advisory levels

- `info` — documentation/firmware/known quirk; no recommendation suppression.
- `watch` — emerging concern with incomplete evidence; show warning.
- `advisory` — significant unresolved concern; suppress default recommendation unless explicitly allowed by project governance.
- `critical` — verified recall/regulatory action or sufficiently established safety defect; exclude affected revisions from recommendation.

## Evidence categories

Examples include regulator notices, manufacturer bulletins, independent engineering tests/teardowns, reproducible laboratory tests, multiple independent field reports, warranty/failure patterns, trusted technical forums, and litigation documents. Litigation alone is an allegation source, not a technical finding.

## Human review

AI may identify candidate patterns or summarize evidence. Publishing or changing an advisory severity requires a human-reviewed pull request with cited evidence and an explicit rationale.
