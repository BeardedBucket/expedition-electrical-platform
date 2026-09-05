---
description: Add builder-aware inventory overlays and lead routing
---

Work only in the current local branch/worktree. Do not create branches, push commits, or open pull requests.
Implement builder profiles from `data/schemas/builder.schema.json`.

Requirements:
- Generic/direct traffic uses the full eligible global component library.
- Builder-origin traffic applies that builder's inventory allow/deny rules only after safety and engineering compatibility filtering.
- Builder preference may rank compatible in-inventory choices but may never make an unsafe/incompatible choice eligible.
- If no compatible stocked product exists, show a structured inventory gap rather than degrading the engineering recommendation.
- Carry a non-secret source/builder identifier through the session for attribution and inquiry routing.
- Final inquiry action should resolve to the originating builder when known; otherwise use the generic project flow.
- Design this so a builder can embed the centrally hosted app without maintaining a fork.

Add tests proving builder constraints cannot override engineering exclusions.
