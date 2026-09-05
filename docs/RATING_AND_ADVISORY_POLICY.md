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

A `reviewed_decision` is validated as a whole before it can become effective: its status, severity, confidence, and policy action must be recognized values, its rationale and reviewer must be non-empty, and its `reviewed_at` timestamp must fall on or after the advisory's `created_at` and on or before its `updated_at`. A malformed reviewed decision is reported as a validation problem and the automatic assessment remains in effect instead — it can never silently become policy. `reviewDueGraceDays` (default `0`) extends the review-due check so a review is only flagged as due once the evaluation timestamp reaches the configured grace period past the advisory's due date; negative or non-finite grace values are normalized to `0` rather than accepted, so a misconfigured grace period cannot mask an overdue review.

The advisory data schema mirrors this: a modern, authoritative Phase 5 record must declare its full lifecycle/evidence shape (including a schema-validated `reviewed_decision` when present), while a separate, explicitly documented legacy branch preserves compatibility with pre-Phase 5 fixtures and templates. The two shapes are intentionally distinct rather than a single all-optional shape, so repository data validation rejects a malformed or minimal authoritative record instead of silently accepting it.
