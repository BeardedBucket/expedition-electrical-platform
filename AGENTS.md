# Agent Guide

Before making architectural changes, read `PROJECT_CHARTER.md` and `docs/ARCHITECTURE.md`.

For engineering calculations or rule changes:
- keep functions deterministic;
- use explicit units;
- add tests at boundaries;
- never fabricate source values;
- keep standards-derived values in versioned data, not buried in code.

For component data:
- use official sources first;
- mark extracted fields `verification_status: unverified` until reviewed;
- link third-party CAD rather than copying it unless redistribution is allowed.
