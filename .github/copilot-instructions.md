# Expedition Electrical Platform — Copilot Instructions

This repository is an engineering configurator, not a generic ecommerce app.

Before changing architecture or engineering behavior, read these repository files:
- `PROJECT_CHARTER.md`
- `docs/ARCHITECTURE.md`
- `docs/RATING_AND_ADVISORY_POLICY.md`
- `docs/LICENSE_POLICY.md`
- `AGENTS.md`

Core rules:
- Never hard-code 12 V, 24 V, 48 V, Victron, Epoch, Blue Sea, Tacoma, or any manufacturer/vehicle as the platform default.
- Treat system voltage, products, vehicles, standards, builder inventory, and commercial preferences as data.
- Engineering and safety constraints execute before builder inventory or commercial preference.
- Builder inventory or ranking must never make an incompatible or unsafe product eligible.
- Keep deterministic engineering calculations separate from UI code.
- Engineering rules must be human-readable, versioned, source-attributed, and covered by tests.
- Do not invent standards values, product specifications, dimensions, ratings, certifications, prices, or safety findings.
- AI-generated or parsed product data remains `unverified` until human review.
- Safety advisories are separate from product scores. Active advisories remain visible and may suppress recommendations.
- Third-party CAD/drawings/datasheets should be referenced by URL unless redistribution rights are documented.
- Use SI internally where practical and perform explicit unit conversion at boundaries. Never mix units implicitly.
- Calculations must declare assumptions including voltage, current, power, conductor material, length interpretation, temperature assumptions where applicable, and voltage-drop target.
- The same inputs plus the same data/rule versions must produce deterministic recommendations.
- Prefer TypeScript for shared web/rules code unless an existing module establishes another pattern.
- Add tests for every public calculation function and engineering-rule boundary.
- UI recommendations and warnings must expose a plain-language `Why?` explanation.
- Builder-specific embed mode preserves central engineering logic and applies inventory/preferences only after compatibility filtering.
- Do not scrape or republish copyrighted reviews. Store citations/links and project-authored summaries where permitted.

Repository-operation rule:
- Work only in the branch/worktree already provided by the user or environment.
- Do not create branches, push commits, open pull requests, change repository permissions, or modify GitHub App settings unless the user explicitly asks you to do so.
- If a requested operation requires unavailable GitHub permissions, complete all local file changes possible and report the exact blocked operation instead of retrying privileged actions.
