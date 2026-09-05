# Architecture

## Logical layers

1. **Physical constants and calculations** — deterministic formulas such as power/current relationships and conductor resistance calculations.
2. **Standards datasets** — human-entered, versioned tables derived from standards under an allowed-use process.
3. **Engineering rules** — human-reviewable rules that transform requirements into constraints, warnings, and candidate architectures.
4. **Global component library** — product facts, dimensions, electrical limits, weight, links, cost snapshots, CAD/drawing availability, and compatibility metadata.
5. **Safety/advisory layer** — time-aware advisories, recalls, watch items, affected revisions, evidence, and disposition.
6. **Builder overlay** — inventory, preferred products, services, regions, lead routing, and optional builder-specific pricing.
7. **Recommendation engine** — selects and scores candidates without allowing commercial preference to defeat engineering constraints.
8. **Configurator UI/embed** — generic hosted app plus builder-aware embeddable mode.

## Recommendation precedence

Safety exclusion / mandatory constraint
→ engineering compatibility
→ architecture suitability
→ builder inventory (when applicable)
→ builder preference
→ evidence confidence / field history
→ price / availability / user preference

## Important distinction

A product may score highly for engineering fit while carrying an active advisory. The advisory state is never hidden inside a single weighted score.

## Domain profiles

The engineering core should remain reusable across domains. The initial profile is mobile/off-grid vehicle installations. A future stationary-installation profile may add different standards, code requirements, grounding/bonding rules, utility/service assumptions, environmental constraints, and component categories without changing the fundamental component/provenance/advisory architecture.
