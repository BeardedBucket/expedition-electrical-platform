# Expedition Electrical Platform

An open, standards-driven configurator and reference platform for mobile/off-grid electrical systems used in truck campers, vans, trailers, expedition vehicles, and related builds.

## Core principle

The platform recommends architectures from engineering constraints rather than assuming a standard system voltage, manufacturer, or vehicle. 12 V, 24 V, 48 V, and future system voltages are candidates evaluated against load, cable length, cost, weight, efficiency, availability, serviceability, and component compatibility.

## Repository areas

- `data/` — human-reviewable component, builder, rule, and advisory data.
- `standards/` — standards-derived tables and provenance notes. Do not copy copyrighted standards text unless redistribution is permitted.
- `apps/configurator/` — React + Vite web application.
- `packages/engineering-core/` — framework-independent typed contracts and deterministic orchestration.
- `cad/` — project-created CAD plus manifests linking to manufacturer CAD. Do not redistribute third-party CAD unless its license explicitly permits it.
- `docs/` — architecture, governance, rating/advisory policy, safety, and data provenance.
- `examples/` — reference implementations such as the Tacoma popup proof of concept.

## Local commands

From the repository root, install dependencies with `npm install`. Run the configurator with
`npm run dev`, then use `npm run test`, `npm run lint`, `npm run build`, and
`npm run validate:data` for the focused verification commands. `npm run format:check` checks
Prettier formatting.

## Configurator proof of concept

`apps/configurator` is the current React proof-of-concept configurator. It collects system
requirements and renders deterministic core results without re-implementing the engineering
calculation stack. Current data is synthetic/development data. Real catalog and live product
integration remain future work.

The workspace keeps UI concerns in `apps/configurator` and engineering contracts/orchestration in
`packages/engineering-core`. The bootstrap dataset is explicitly synthetic: component, builder,
and advisory collections are empty, and its rule metadata is not an engineering specification.

## Licensing intent

- Software: Apache-2.0.
- Project-authored documentation and CAD: CC BY-SA 4.0.
- Project-authored structured data: CC BY-SA 4.0 initially; reassess ODbL if the database becomes a major standalone asset.
- Third-party manufacturer CAD, drawings, images, standards, and datasheets retain their original licenses/copyrights and should normally be linked, not copied.

See `docs/LICENSE_POLICY.md` before adding third-party material.

## Status

Early architecture and data-model phase. Engineering rules are expected to be human-reviewed, testable, versioned, and traceable to a source or explicit project assumption.
