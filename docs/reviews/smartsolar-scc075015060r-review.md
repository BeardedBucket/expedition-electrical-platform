# SmartSolar MPPT 75/15 review package

**Status: APPROVED BY EXPLICIT HUMAN DECISIONS.** This report records the
decisions in `victron-smartsolar-scc075015060r.review.json`.

The selected structured record is the exact `SCC075015060R` row from the
official Victron family page. Values below are emitted through the reviewed
structured-field mappings in the Victron acquisition profile.

|   # | Canonical target                             | Proposed value | Raw manufacturer evidence | Normalized value | Evidence locator                                                             | Caveat                                                                                                                      | Recommended disposition |
| --: | -------------------------------------------- | -------------- | ------------------------- | ---------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1 | `electrical.nominal_voltage_v` | 12 V and 24 V | `["12V","24V"]` | `[12,24]` V | `__NEXT_DATA__` → `$.props.pageProps` → `$.products[0].battery_voltage` | Product-page row states supported battery voltages; this is not a platform default. | APPROVED |
| 2 | `electrical.continuous_charge_current_a` | 15 A | `15A` | 15 A | `__NEXT_DATA__` → `$.props.pageProps` → `$.products[0].rated_charge_current` | Manufacturer-published exact-row value. | APPROVED |
| 3 | Evidence-only reviewed fact: maximum PV open-circuit voltage | 75 V | `75V` | 75 V | `__NEXT_DATA__` → `$.props.pageProps` → `$.products[0].max_pv_voltage` | Retained in source/fact lineage; not forced into an unsupported canonical field or topology assertion. | APPROVED AS EVIDENCE ONLY |

## Classification review

The source row title supports the reviewed product designation
`SmartSolar MPPT 75/15 Retail`. Category/product role
`solar_charge_controller` / MPPT solar charge controller is approved as
classification only; it does not establish electrical topology.

## Explicitly unsupported by this capture

No topology, port direction, PV/battery connection relationship, Bluetooth,
VE.Direct, app support, interoperability, efficiency, self-consumption,
temperature, dimensions, weight, nominal PV power, or protection claims are
prepared. The discovered PDF links remain discovered-only.
