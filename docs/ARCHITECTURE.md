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

## Builder overlay catalog model

The builder overlay uses a canonical component catalog keyed by stable component IDs rather than manufacturer names, labels, or SKUs. Builder-owned commercial metadata such as price, currency, lead time, and notes stays in the overlay and is never treated as canonical engineering truth.

Eligibility flows in layers: engineering compatibility and safety/advisory checks happen first, then builder catalog availability and preference are applied. Generic mode returns all globally eligible candidates without builder restrictions, while a resolved builder only operates on globally eligible candidates and may return an `inventory_gap` when eligible products exist but none are currently supported by that builder.

## Configurator boundary

React owns input collection, application state, explicit evaluation timestamp creation, and presentation of deterministic engine outputs. The engineering core owns calculations, compatibility checks, advisory decisions, recommendation eligibility, builder overlay semantics, and trace provenance. The UI may group or label engine-returned results, but it does not re-create the underlying decision policy.

Unknown or insufficient data is a first-class state. An unknown fit is not the same as an incompatible product, and the UI must preserve that distinction rather than collapsing it into a synthetic failure state.

Builder-specific mode applies only after global engineering and advisory eligibility. Builder inventory and preference can narrow the list of globally eligible candidates, but cannot override global ineligibility or re-enable suppressed or excluded candidates. Unresolved builder identity does not silently fall back to generic mode.

Advisory evaluation receives an explicit `evaluatedAt` from the app boundary. The engineering core does not implicitly consult the wall clock when deterministic advisory state is required.

Deferred work remains future-facing: real product and catalog ingestion, live advisory feeds, and embed/widget integration for later phases.

## Domain profiles

The engineering core should remain reusable across domains. The initial profile is mobile/off-grid vehicle installations. A future stationary-installation profile may add different standards, code requirements, grounding/bonding rules, utility/service assumptions, environmental constraints, and component categories without changing the fundamental component/provenance/advisory architecture.

Advisory records are assessments over separately stored, source-attributed evidence. Severity and confidence remain independent, and policy actions (`inform`, `caution`, `suppress_recommendation`, or `exclude`) are not engineering compatibility results. Automatic assessment is conservative: litigation, community, forum, social, or news reports alone produce a review-needed result rather than a confirmed technical finding. Evaluation receives an explicit timestamp so stale and review-due states are deterministic. Human-reviewed decisions remain explicit and visible.

Advisory evaluation runs once before recommendation and builder overlay processing. A builder catalog or preference can narrow globally eligible candidates but cannot re-enable a suppressed or excluded candidate, and canonical component facts and engineering compatibility remain unchanged.
