---
description: Build component-library ingestion, validation, and compatibility filtering
---

Work only in the current local branch/worktree. Do not create branches, push commits, or open pull requests.
Use `data/schemas/component.schema.json` as the source contract. Build loaders and validators for YAML/JSON component records.

Implement compatibility filtering that can evaluate product voltage ranges, current/power limits, interfaces, required accessories/converters, physical dimensions where available, and advisory state. A component with missing critical data must not silently pass; surface `unknown` with an explanation.

Implement provenance display fields and verification state. Do not scrape or create product specifications. Add synthetic fixtures only.
