# Tacoma Popup Reference Build

First proof-of-concept implementation.

Known design direction:

- compact popup camper on Toyota Tacoma long bed
- center floor/standing aisle remains open
- utility volumes forward of the wheel wells
- fresh-water system on driver side
- electrical system on passenger side
- sealed separation between water and electrical compartments
- user-facing breaker/control panel; master battery disconnect is externally accessible and not hidden behind service panels
- 24 V is currently a strong candidate for this reference build, not a platform default
- future rooftop HVAC intended to be DC-powered
- two independent solar MPPT channels: fixed roof array and ground-deploy array
- alternator DC-DC charging

Vehicle and component geometry will be added as verified CAD or simplified reference envelopes.

The forthcoming reference-system document will keep catalog product facts separate from
installation facts. Component instances will reference stable catalog IDs, while locations,
nodes, connections, conductors, and paths describe this installation. Unknown measurements and
selections remain explicit rather than being replaced with guessed values. The topology kernel
does not duplicate engineering calculations; those remain in `packages/engineering-core`.
