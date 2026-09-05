---
description: Implement safety advisory and evidence-confidence behavior
---

Work only in the current local branch/worktree. Do not create branches, push commits, or open pull requests.
Implement the advisory model from `data/schemas/advisory.schema.json` and the policy in `docs/RATING_AND_ADVISORY_POLICY.md`.

Keep advisories separate from ratings. Apply `recommendation_effect` after matching product/revision applicability:
- none
- warn
- suppress_default
- exclude

Build UI primitives for an advisory banner, affected revisions, evidence sources, manufacturer response, review dates, and recommendation effect.

Do not implement automated publication of AI-detected concerns. Provide an interface for candidate advisories to remain draft until human-approved data exists in the repository.
