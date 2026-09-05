---
description: Implement deterministic electrical calculations and rule evaluation framework
---

Work only in the current local branch/worktree. Do not create branches, push commits, or open pull requests.
Implement the engineering-core package using deterministic pure functions and explicit units.

Build the framework for these calculations without inventing standards-derived thresholds:
- DC power/current conversion using explicit nominal/operating voltage inputs
- round-trip conductor length handling
- conductor voltage drop from resistance-per-length data
- conductor power loss and percent voltage drop
- candidate wire-gauge filtering from external ampacity/derating data
- candidate system-voltage comparison for the same load power

All standards-dependent values must be loaded from versioned external data files. If a required value is absent, return a structured `insufficient_data` result rather than assuming a number.

Add boundary and unit tests. The rule evaluator must produce a machine-readable decision trace containing inputs, rule IDs/versions, results, warnings, and source references.
