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

## Builder embed (Phase 7)

The configurator exposes a browser-safe `mountConfiguratorEmbed(element, config)` entry point. The
dedicated browser artifact is produced by `npm run build:embed` at
`apps/configurator/dist/embed/`; it bundles the embed entry and React for drop-in browser use and
does not include the demo entry. It mounts the same Phase 6 configurator model used by the
standalone app; builder mode only narrows globally eligible candidates after engineering and
advisory evaluation. An unresolved builder is explicit and never falls back to generic
recommendations.

```ts
const embed = mountConfiguratorEmbed(document.querySelector('#configurator')!, {
  mode: 'builder',
  builderId: 'builder.northwind',
  visibleSections: ['system-basics', 'loads', 'builder-context', 'results', 'inquiry'],
  readOnly: false,
  theme: { accent: 'blue', density: 'compact' },
  initialConfiguration: { selectedVoltage: 24, loads: [] },
  inquiryDestination: 'builder-inquiry-route',
  onResult: (payload) => console.log(payload.evaluatedAt, payload.candidates),
  onInquiry: (payload) => console.log(payload.inquiryDestination, payload.componentId),
});
```

The returned controller provides `updateConfig(config)` and `dispose()`. Updating replaces the
configuration and resets local form/result state. The embed owns the contents of the supplied
container, so callers should provide a dedicated empty element; `dispose()` unmounts React and
clears that container. The public evaluation payload is a compact candidate summary rather than
the internal trace/orchestration model. Events include `embed_ready`, `evaluation_completed`,
`inquiry_requested`, `builder_unresolved`, and `validation_error`.

Host configuration controls presentation, visible sections, initial form values, and callbacks. The
theme accepts only named accent, radius (`compact`, `rounded`, or `pill`), and density tokens;
semantic status styles remain owned by the embed. Hosts cannot change engineering status, advisory
policy, or recommendation eligibility.
`inquiryDestination` is opaque routing metadata only; the embed does not navigate or send requests.
Evaluation timestamps are generated once at the application boundary and can be deterministically
injected with `clock`. Phase 7 uses bundled synthetic data only and performs no network or backend
handoff. See `apps/configurator/embed-demo.html` for a small offline host example. The standalone
configurator and embed share the same model and recommendation path.

## Licensing intent

- Software: Apache-2.0.
- Project-authored documentation and CAD: CC BY-SA 4.0.
- Project-authored structured data: CC BY-SA 4.0 initially; reassess ODbL if the database becomes a major standalone asset.
- Third-party manufacturer CAD, drawings, images, standards, and datasheets retain their original licenses/copyrights and should normally be linked, not copied.

See `docs/LICENSE_POLICY.md` before adding third-party material.

## Status

Early architecture and data-model phase. Engineering rules are expected to be human-reviewed, testable, versioned, and traceable to a source or explicit project assumption.
