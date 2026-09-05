---
description: Bootstrap the configurator workspace without inventing engineering values
---
Read `PROJECT_CHARTER.md`, `docs/ARCHITECTURE.md`, `docs/COPILOT_WORKFLOW.md`, `.github/copilot-instructions.md`, `AGENTS.md`, and all schemas under `data/schemas/`.

Work only in the current local branch/worktree. Do not create branches, push commits, or open pull requests.

Create the initial web application as a TypeScript workspace/monorepo using a maintained stack appropriate for a centrally hosted web configurator and later embeddable widget. Keep engineering calculations in a framework-independent package separate from UI code. Add linting, formatting, unit tests, schema validation, and local build/test scripts.

Do not add fabricated component specifications or standards values. Seed only clearly labeled synthetic/demo data where tests require it.

The first milestone must run locally, render a basic requirements form, load data through typed interfaces, and display an empty recommendation result with trace/debug information showing rule-set and dataset versions.

At completion, report:
- files created or changed
- architecture choices
- commands to install/run/test
- assumptions needing human approval
- any operation blocked by permissions
