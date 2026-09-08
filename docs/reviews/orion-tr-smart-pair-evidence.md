# Orion-Tr Smart isolated pair — Checkpoint E evidence review

Status: **human review approved; canonical promotion attempted through the real create-only pipeline and blocked by the two pre-existing untracked historical draft paths**.

This package covers only the two requested exact identities:

| MPN            | Exact model                              | Direction                 |
| -------------- | ---------------------------------------- | ------------------------- |
| `ORI122436120` | Orion-Tr Smart 12/24-15A (360W) Isolated | 12 V input to 24 V output |
| `ORI241236120` | Orion-Tr Smart 24/12-30A (360W) Isolated | 24 V input to 12 V output |

The five historical comparison drafts remain untouched and are not authoritative.

## 1. Official source evidence

| Source ID                                      | URI                                                                                                                                    | Applicability                                              | Retrieval hash                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `victron.orion-tr-smart.product-page`          | <https://www.victronenergy.com/dc-dc-converters/orion-tr-smart>                                                                        | Direct family page; exact requested rows identified        | `sha256:2ffc3316a5446490111a38757f38943eefc1806a1e1bda2eeb1d6400ec6fb1c6` |
| `victron.orion-tr-smart.isolated-manual-rev14` | <https://www.victronenergy.com/upload/documents/Orion-Tr_Smart_DC-DC_Charger_-_Isolated/34439-Orion-Tr_Smart_DC-DC_Charger-pdf-en.pdf> | Exact 360-400 W table includes both requested columns      | `sha256:72f25089f86e52d047a78ec22a5a2c7d1e01f745b55f89c3d47ccf48865824c3` |
| `victron.orion-tr-smart.isolated-datasheet`    | <https://www.victronenergy.com/upload/documents/Datasheet-Orion-Tr-Smart-DC-DC-chargers-isolated-250-400W-EN-.pdf>                     | Current official family datasheet linked from product page | `sha256:7b9b069dc1937cff6c5e157c722ef7e9d4185a0da33d09be3b8e455af83d6bb2` |

The previously guessed manual URL that returned 404 is not used as evidence.

## 2. Existing constraint architecture audit

The accepted schema supports port-local voltage, current, power, electrical constraints, connection points, and conductive relationships. Checkpoint E-R added the exact generic `isolation_relationships` representation. Before E-R2, the constraint model still lacked a distinct continuous-rating semantic and a structured reference condition for nominal output voltage.

Checkpoint E-R2 adds the smallest generic rating extension: `continuous_rating` plus condition references. Temperature is represented explicitly as `{ path: "temperature_c", equals: 40 }`; the current rating's nominal-output condition references the output nominal-voltage constraint rather than duplicating a voltage value. No derating model is introduced.

## 3. Exact extracted facts and source locators

| Fact ID                                         | MPN(s)         | Extracted fact                                                      | Source locator                                                                                  |
| ----------------------------------------------- | -------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `extracted.fact.orion.122436120.input-voltage`  | `ORI122436120` | Input voltage range 8–17 V                                          | Rev 14 manual, p. 21, 360-400 W table, row “Input voltage range (1)”, column “12/24-15 (360 W)” |
| `extracted.fact.orion.241236120.input-voltage`  | `ORI241236120` | Input voltage range 16–35 V                                         | Rev 14 manual, p. 21, 360-400 W table, row “Input voltage range (1)”, column “24/12-30 (360 W)” |
| `extracted.fact.orion.122436120.output-voltage` | `ORI122436120` | Nominal output voltage 24 V                                         | Rev 14 manual, p. 21, row “Nominal output voltage”, column “12/24-15 (360 W)”                   |
| `extracted.fact.orion.241236120.output-voltage` | `ORI241236120` | Nominal output voltage 12 V                                         | Rev 14 manual, p. 21, row “Nominal output voltage”, column “24/12-30 (360 W)”                   |
| `extracted.fact.orion.122436120.output-current` | `ORI122436120` | Continuous output current 15 A at nominal output voltage and 40°C   | Rev 14 manual, p. 22, corresponding column                                                      |
| `extracted.fact.orion.241236120.output-current` | `ORI241236120` | Continuous output current 30 A at nominal output voltage and 40°C   | Rev 14 manual, p. 22, corresponding column                                                      |
| `extracted.fact.orion.122436120.power`          | `ORI122436120` | Continuous output power 360 W at 40°C                               | Rev 14 manual, p. 22, corresponding column                                                      |
| `extracted.fact.orion.241236120.power`          | `ORI241236120` | Continuous output power 360 W at 40°C                               | Rev 14 manual, p. 22, corresponding column                                                      |
| `extracted.fact.orion.pair.isolation`           | Both           | Galvanic isolation 200 V DC between input, output, and case         | Rev 14 manual, p. 22, row “Galvanic isolation”                                                  |
| `extracted.fact.orion.pair.configuration`       | Both           | Built-in Bluetooth configures, monitors, and updates the controller | Rev 14 manual, p. 3, “Configuring and monitoring”                                               |

Input current is intentionally unknown. It must not be calculated as output power divided by nominal input voltage and presented as a manufacturer fact.

The 40°C condition is preserved as a rating applicability condition. The source does not establish ambient semantics, behavior above or below 40°C, or a derating curve.

## 4. PV voltage semantics

Not applicable. These are DC-DC converters, not PV controllers. No PV open-circuit, short-circuit, MPPT, or PV-to-battery semantics are introduced.

## 5. Current and power semantics

The 15 A and 30 A values are output-side continuous current ratings at nominal output voltage and 40°C. The 360 W value is continuous output power at 40°C. Neither output current is an input current rating. No peak-input current, input-power limit, or efficiency-derived input current is canonicalized.

## 6. Reviewed topology

Each candidate would use two logical DC ports and one directional conversion path:

| Candidate      | Input port                | Output port                                  | Directional path               |
| -------------- | ------------------------- | -------------------------------------------- | ------------------------------ |
| `ORI122436120` | `orion.input`, 8–17 V DC  | `orion.output`, nominal 24 V DC, 15 A, 360 W | `orion.input` → `orion.output` |
| `ORI241236120` | `orion.input`, 16–35 V DC | `orion.output`, nominal 12 V DC, 30 A, 360 W | `orion.input` → `orion.output` |

The proposed paths are not bidirectional. The existence of both variants does not establish reversible operation.

## 7. Stable IDs and provenance targeting

Stable product IDs are `victron-energy.ori122436120` and `victron-energy.ori241236120`. Stable source IDs and fact IDs are persisted in `data/ingestion/victron-orion-tr-smart-pair.json`. Every candidate fact is tied to an exact MPN and a source locator. Any future review/amendment must target the exact candidate ID, fact IDs, and source IDs; family-level evidence must not be allowed to leak sibling values.

## 8. HUMAN REVIEW TABLE — PRODUCT FACTS

|   # | Candidate      | Proposed fact                                     | Evidence                      | Review decision |
| --: | -------------- | ------------------------------------------------- | ----------------------------- | --------------- |
|   1 | `ORI122436120` | Exact model and MPN identity                      | Product page and Rev 14 table | Approved         |
|   2 | `ORI241236120` | Exact model and MPN identity                      | Product page and Rev 14 table | Approved         |
|   3 | `ORI122436120` | Input range 8–17 V                                | Rev 14 p. 21                  | Approved         |
|   4 | `ORI241236120` | Input range 16–35 V                               | Rev 14 p. 21                  | Approved         |
|   5 | `ORI122436120` | Nominal output 24 V                               | Rev 14 p. 21                  | Approved         |
|   6 | `ORI241236120` | Nominal output 12 V                               | Rev 14 p. 21                  | Approved         |
|   7 | `ORI122436120` | Continuous output 15 A at nominal output and 40°C | Rev 14 p. 22                  | Approved         |
|   8 | `ORI241236120` | Continuous output 30 A at nominal output and 40°C | Rev 14 p. 22                  | Approved         |
|   9 | Both           | Continuous output power 360 W at 40°C             | Rev 14 p. 22                  | Approved         |
|  10 | Both           | Input current remains unknown                     | No exact source fact captured | Approved as unknown |
|  11 | Both           | No peak input-current fact                        | No exact source fact captured | Approved as unknown |
|  12 | Both           | Bluetooth configuration/monitoring capability     | Rev 14 p. 3                   | Reviewed evidence only |

## 8A. HUMAN REVIEW TABLE — NEW ISOLATION MAPPING

The source fact is already approved. This is the only new human decision required by E-R.

|   # | Source fact ID                        | Source wording                            | Proposed canonical object ID        | Kind                              | Participants                                              | Voltage | Basis                      | Meaning                                                   | Explicit non-meaning                                                                                                                  | Source locator                             | Proposed disposition              |
| --: | ------------------------------------- | ----------------------------------------- | ----------------------------------- | --------------------------------- | --------------------------------------------------------- | ------- | -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------- |
|   1 | `extracted.fact.orion.pair.isolation` | `200 V dc between input, output and case` | `orion.input-output-case-isolation` | `galvanic` isolation relationship | `orion.input`, `orion.output`, product-local `orion.case` | 200 V   | V, DC, withstand/isolation | Product-local input/output/case separation withstand fact | Not a conductive relationship; not common-negative, chassis bonding, protective earth, installed grounding, or port operating voltage | Rev 14 manual, p. 22, `Galvanic isolation` | Approve / reject proposed mapping |

## 9. HUMAN REVIEW TABLE — TOPOLOGY

|   # | Candidate      | Proposed topology operation                      | Evidence                                             | Review decision               |
| --: | -------------- | ------------------------------------------------ | ---------------------------------------------------- | ----------------------------- |
|   1 | `ORI122436120` | Add logical DC input `orion.input`               | Exact 12/24 row                                      | Approved                       |
|   2 | `ORI122436120` | Add logical DC output `orion.output`             | Exact 12/24 row                                      | Approved                       |
|   3 | `ORI122436120` | Add directional path input → output              | Exact 12/24 product direction                        | Approved                       |
|   4 | `ORI241236120` | Add logical DC input `orion.input`               | Exact 24/12 row                                      | Approved                       |
|   5 | `ORI241236120` | Add logical DC output `orion.output`             | Exact 24/12 row                                      | Approved                       |
|   6 | `ORI241236120` | Add directional path input → output              | Exact 24/12 product direction                        | Approved                       |
|   7 | Both           | Add galvanic-isolation topology                  | Rev 14 says 200 V DC between input, output, and case | Approved                       |
|   8 | Both           | Add bidirectional path                           | No evidence; explicitly prohibited                   | Reject                        |
|   9 | Both           | Add common-negative or chassis-bond relationship | No evidence                                          | Reject                        |

## 10. HUMAN REVIEW TABLE — CONSTRAINT SEMANTICS

|   # | Candidate      | Proposed semantic                               | Evidence                                            | Review decision                                             |
| --: | -------------- | ----------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
|   1 | `ORI122436120` | Input operating range 8–17 V                    | Rev 14 p. 21                                        | Approved                                                     |
|   2 | `ORI241236120` | Input operating range 16–35 V                   | Rev 14 p. 21                                        | Approved                                                     |
|   3 | `ORI122436120` | Output nominal 24 V                             | Rev 14 p. 21                                        | Approved                                                     |
|   4 | `ORI241236120` | Output nominal 12 V                             | Rev 14 p. 21                                        | Approved                                                     |
|   5 | `ORI122436120` | Output continuous current 15 A at 40°C          | Rev 14 p. 22                                        | Approved                                                     |
|   6 | `ORI241236120` | Output continuous current 30 A at 40°C          | Rev 14 p. 22                                        | Approved                                                     |
|   7 | Both           | Output continuous power 360 W at 40°C           | Rev 14 p. 22                                        | Approved                                                     |
|   8 | Both           | Galvanic isolation 200 V DC                     | Rev 14 p. 22                                        | Approved                                                     |
|   9 | Both           | Input current                                   | Not published in captured evidence                  | Unknown; do not derive                                      |
|  10 | Both           | Input absolute maximum, output peak, efficiency | Not established for exact row in accepted semantics | Unknown                                                     |

## 10A. HUMAN REVIEW TABLE — NEW CONTINUOUS-RATING MAPPINGS

The raw current and power facts are already approved. These are only the new canonical semantic interpretations.

| # | Candidate | Source fact | Proposed object | Canonical meaning | Conditions preserved | Explicit non-meaning | Disposition |
|---:|---|---|---|---|---|---|---|
| 1 | `ORI122436120` | `extracted.fact.orion.122436120.output-current` | `orion.output.continuous-current` | `continuous_rating`, current, 15 A on output port | `temperature_c = 40`; output voltage references `orion.output.nominal-voltage` | Not nominal current, peak current, short-circuit current, input current, or unconditional rating | Approve / reject |
| 2 | `ORI122436120` | `extracted.fact.orion.122436120.power` | `orion.output.continuous-power` | `continuous_rating`, power, 360 W on output port | `temperature_c = 40` | Not nominal power, peak power, input power, or unconditional rating | Approve / reject |
| 3 | `ORI241236120` | `extracted.fact.orion.241236120.output-current` | `orion.output.continuous-current` | `continuous_rating`, current, 30 A on output port | `temperature_c = 40`; output voltage references `orion.output.nominal-voltage` | Not nominal current, peak current, short-circuit current, input current, or unconditional rating | Approve / reject |
| 4 | `ORI241236120` | `extracted.fact.orion.241236120.power` | `orion.output.continuous-power` | `continuous_rating`, power, 360 W on output port | `temperature_c = 40` | Not nominal power, peak power, input power, or unconditional rating | Approve / reject |

## 11. Canonical promotion result

The E-R3 review artifacts approve the exact candidate snapshots and all listed mappings. The reviewed promotion preflight succeeds for both candidates and produces the expected canonical IDs. The real create-only writer was then executed with the repository catalog and blocked both writes because the historical untracked files already occupy the target canonical paths. Neither file was overwritten or deleted.

The likely operations are:

1. Add the two exact candidates through source → candidate → approved review → promotion.
2. Add two DC ports and one directional DC conversion path per product.
3. Attach exact input operating ranges and output-side current/power facts only if the accepted generic semantic target is demonstrated.
4. Keep input current and unsupported limits unknown.
5. Add `orion.input-output-case-isolation` only after the new generic mapping decision is approved, with the published 200 V DC withstand value and exact port/case participants.

## 12. Tests and validation boundary

The persisted artifact provides deterministic exact-identity, sibling-exclusion, directional, side-specific current/power, and provenance targets for the focused ingestion tests. The E-R3 promotion tests exercise independent writes in an isolated temporary catalog and replay blocking. The repository canonical paths remain unchanged because create-only collision safeguards correctly blocked them.

## 13. Final verdict

**B. PARTIAL — HISTORICAL DRAFT COLLISION REQUIRES USER ACTION.**

Primary official evidence is now captured for both exact MPNs, with exact row/column locators and hashes. Canonical promotion is intentionally not ready: human decisions are still required for the new isolation mapping. The five historical comparison drafts remain untouched.
