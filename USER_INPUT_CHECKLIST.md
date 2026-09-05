# Owner / Maintainer Input Checklist

You do not need all of this before development starts. Fill items as they become known.

## Project identity

- Project/repository name:
- Short description:
- Public project/site name:
- Generic inquiry destination (optional initially):
- Maintainer display name or GitHub handle:

## Licensing decisions

- Software license: Apache-2.0 proposed
- Project-authored docs/CAD/data license: CC BY-SA 4.0 proposed
- Commercial/non-commercial restriction desired? (Recommendation: avoid NC if builder ecosystem use is desired.)

## Initial engineering sources

For each standard/reference you are legally able to use:
- Standard/reference name:
- Edition/year:
- Which rules/tables we intend to derive:
- Exact section references:
- Redistribution limitations:
- Human reviewer:

## First component records

For each chosen/reference product, copy `data/templates/component.yaml` and provide or verify:
- manufacturer/model/part number
- official product URL
- official datasheet/manual URL
- CAD or dimensional drawing URL
- voltage/current/power ratings
- dimensions and weight
- interfaces/communications
- mounting orientation/clearance requirements
- price source/date (optional)
- redistribution terms for CAD if known

## Builder profile (later)

Copy `data/templates/builder.yaml` and fill:
- builder ID
- display name
- website/inquiry URL
- service regions
- supported services
- supported system voltages
- stocked component IDs or manufacturers
- preferred components/manufacturers

## Reference Tacoma build

When available:
- truck/camper scan or verified dimensions
- exact Epoch battery model/part number
- exact MultiPlus 24/2000 SKU/120 V variant
- final MPPT models
- exact Orion XS topology/model
- Blue Sea 360 panel modules/breakers/disconnects
- Ekrano GX model
- selected busbars and high-current fuses
- 24→12 V converter model
- roof and portable solar candidate wattage/Voc/Isc
