# Project Charter

## Mission

Create an open engineering platform that helps DIY builders, professional outfitters, and system designers configure mobile/off-grid electrical systems from needs and constraints while keeping recommendations transparent, reproducible, standards-aware, and serviceable.

## Non-negotiable principles

1. **Voltage agnostic.** 12 V, 24 V, 48 V, and future voltages are evaluated rather than treated as defaults.
2. **Engineering before inventory.** Builder inventory may constrain which compatible product is recommended, but cannot override safety or engineering compatibility.
3. **Explain every recommendation.** Users can inspect the assumptions, calculations, rules, standards references, warnings, and alternatives.
4. **Human-reviewed engineering data.** AI can scaffold tables, code, tests, and draft extracted data, but engineering rules and product facts must be reviewable and attributable.
5. **Reproducible outcomes.** The same inputs with the same data/rule versions produce the same recommendation.
6. **Serviceability matters.** Packaging, access, disconnect location, cable bend radius, ventilation, and maintainability are first-class constraints.
7. **Safety advisories are separate from ratings.** Emerging safety concerns can suppress or warn on a recommendation even if a product has strong historical reputation.
8. **Manufacturer neutrality.** No manufacturer is hard-coded as the standard.
9. **Builder overlays are optional.** Direct/DIY users receive recommendations from the broad global library. Builder-origin traffic can be constrained to that builder's supported inventory and preferences.
10. **Open interfaces.** The configurator should be embeddable on third-party builder websites while remaining centrally maintained.

## Initial reference implementation

A 2016-era Toyota Tacoma long-bed popup camper build is the first proof of concept. It is a reference implementation, not a platform assumption.

## Future domain expansion

Stationary/off-grid installations are a planned future domain. The proof of concept remains mobile-first, but core data models and calculation packages should avoid unnecessary vehicle-only assumptions so a stationary profile can be added later without rewriting the engineering core. Stationary-specific code requirements, permitting, grounding/bonding, service equipment, and jurisdictional rules are not part of the initial proof of concept.

## Out of scope for v0.x

- Automatic certification of completed installations.
- Replacing licensed standards or professional engineering review.
- Automatically publishing unverified safety allegations.
- Full automated CAD synthesis from arbitrary drawings.
