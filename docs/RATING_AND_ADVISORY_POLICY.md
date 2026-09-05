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

Evidence records preserve source provenance and verification state separately from the advisory assessment. Severity describes impact while confidence describes support; neither is an opaque score. Policy action is explicit, and an active warning can remain technically eligible while suppression or exclusion affects recommendation eligibility. Evidence freshness and review-due state are calculated from an explicit evaluation timestamp, not an implicit wall clock, and old evidence is flagged rather than treated as false.

Automatic corroboration can raise confidence to `high` but does not mechanically publish `confirmed`; that state is reserved for an explicit reviewed decision in this phase. Non-confirming evidence is capped at automatic `caution`, while a reviewed decision may explicitly publish suppression or exclusion.

Litigation, community/forum/social reports, and news coverage are evidence that may require review; they do not independently establish a confirmed technical finding. Builder inventory and preference are applied only after global engineering and advisory filtering and cannot override safety policy. Canonical component facts never embed authoritative advisory state.
