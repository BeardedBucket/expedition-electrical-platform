---
description: Add repository quality, provenance, dependency, and license checks
---

Work only in the current local branch/worktree. Do not create branches, push commits, or open pull requests.
Add GitHub Actions workflows for pull requests that:
- run formatter/linter/typecheck/tests
- validate all YAML/JSON against schemas
- reject duplicate component/rule/advisory IDs
- flag records marked verified that lack source references
- check outbound source/CAD URLs when practical without making CI fragile
- run dependency vulnerability scanning using GitHub-supported tooling where available
- run dependency/license reporting and fail on a configurable denylist of incompatible software licenses
- verify third-party local CAD/assets have a recorded redistribution status of permitted
- generate a machine-readable data-quality report artifact

Do not claim a workflow proves legal compliance. Document that automated license checks are an aid and require human review.
