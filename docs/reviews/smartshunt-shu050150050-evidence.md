# Product Corpus Sufficiency Checkpoint F — SmartShunt Evidence Handoff

Status: **evidence and candidate complete; human review required; canonical promotion not performed.**

This package targets only:

- Victron Energy SmartShunt 500A/50mV
- MPN `SHU050150050`

The historical file `data/components/victron-energy.smartshunt-shu050150050.yaml`
was not used as evidence, was not modified, and was not promoted.

## 1. Branch / HEAD / Git Status

- Branch: `feat/product-corpus-sufficiency`
- HEAD: `40fdc4c8f6dd348aeba7773c3f9fb4f723d2e68c`
- Existing PR: `BeardedBucket/expedition-electrical-platform#56`
- No stage, commit, push, merge, or new PR operation was performed.

Expected untracked historical drafts remain:

- `data/components/blue-sea-systems.m-series-6006.yaml`
- `data/components/victron-energy.ekrano-gx-bpp900480100.yaml`
- `data/components/victron-energy.smartshunt-shu050150050.yaml`

## 2. Acquisition Actions Performed

| URI | Result | Persisted | Reason |
|---|---|---:|---|
| `https://www.victronenergy.com/meters-and-sensors/smart-battery-shunt` | HTTP 200; live official product page | Yes | Exact page lists SmartShunt 500A/50mV and shared product behavior |
| `https://www.victronenergy.com/media/pg/SmartShunt/en/introduction.html` | HTTP 200; official manual HTML | Yes | Family size and measurement/interaction overview |
| `https://www.victronenergy.com/media/pg/SmartShunt/en/installation.html` | HTTP 200; official manual HTML | Yes | Exact terminal labels, M10 500A applicability, auxiliary wiring modes |
| `https://www.victronenergy.com/media/pg/SmartShunt/en/operation.html` | HTTP 200; official manual HTML | Yes | Direct vs derived/current-sign/history semantics |
| `https://www.victronenergy.com/media/pg/SmartShunt/en/interfacing.html` | HTTP 200; official manual HTML | Yes | Bluetooth, VE.Direct, GX, VRM, VE.Smart behavior |
| `https://www.victronenergy.com/media/pg/SmartShunt/en/technical-data.html` | HTTP 200; official manual HTML | Yes | Technical data, family and model-specific rows |
| `https://www.victronenergy.com/media/pg/SmartShunt/en/appendix.html` | HTTP 200; official manual HTML | Yes | SmartShunt 500A drawing section |
| `https://www.victronenergy.com/media/pg/SmartShunt/en/index-en.html` | HTTP 200; manual index | Yes as applicability support | Links the official PDF and manual tree |

The earlier `/battery-monitors/...` URLs were stale/incorrect and are not used.

## 3. Official Sources

The accepted sources, hashes, and applicability are persisted in
`data/ingestion/victron-smartshunt-shu050150050.json`.

| Source ID | URI | Revision/date | Content hash | Applicability |
|---|---|---|---|---|
| `victron.smartshunt.product-page` | `https://www.victronenergy.com/meters-and-sensors/smart-battery-shunt` | Current page; publication revision not stated | `sha256:148f5fb829766d94b10c491fa46bdb8890a420c2033b463244d5de963945ce7b` | Exact page lists `SmartShunt 500A/50mV` |
| `victron.smartshunt.manual.introduction` | `https://www.victronenergy.com/media/pg/SmartShunt/en/introduction.html` | Current manual HTML; page publication date not stated | `sha256:27dbf2f1cead944094d86437fcde91c0b3d19f90e1f6da937a0ddce707e94e71` | SmartShunt family, including 500A |
| `victron.smartshunt.manual.installation` | `https://www.victronenergy.com/media/pg/SmartShunt/en/installation.html` | Current manual HTML | `sha256:51ec26c2a4f6b2d74a775b32ec837d935d8dab19718afa3d1beb43e9203c170b` | Shared manual with explicit 500A M10 applicability |
| `victron.smartshunt.manual.operation` | `https://www.victronenergy.com/media/pg/SmartShunt/en/operation.html` | Current manual HTML | `sha256:a4acdd7b2414dd2b366fa9d3e749a966ec3e3ddb93835698457fbd42e9ad8c1a` | SmartShunt family, including 500A |
| `victron.smartshunt.manual.interfacing` | `https://www.victronenergy.com/media/pg/SmartShunt/en/interfacing.html` | Current manual HTML | `sha256:1f97cbdddd16ad89680f6a178b1277963f64fdff51dc01404b7d8b3ac69c072a` | SmartShunt family, including 500A |
| `victron.smartshunt.manual.technical-data` | `https://www.victronenergy.com/media/pg/SmartShunt/en/technical-data.html` | Current manual HTML | `sha256:f6c5d4348efc868d4d8fc6d5b2770354cd90108c45b7314bfd0ae0233157df14` | Family rows plus exact 500A dimensions/bolt row |
| `victron.smartshunt.manual.appendix` | `https://www.victronenergy.com/media/pg/SmartShunt/en/appendix.html` | Current manual HTML | `sha256:89b3965d030c92bebefc12040181f6b5424f0665323f52b3bdcfdbd3f0291a41` | Section `12.2. Dimensions SmartShunt 500A` |

## 4. Exact-SKU / Family Applicability

Exact 500A applicability:

- the live product page explicitly lists `SmartShunt 500A/50mV`
- the manual identifies four SmartShunt sizes: 300A, 500A, 1000A, 2000A
- the technical table explicitly gives 500A dimensions and M10 shunt bolts
- the appendix has a dedicated `Dimensions SmartShunt 500A` section
- shared family facts are retained only where the manual labels them as shared

Sibling isolation:

- no 300A, 1000A, or 2000A offset was assigned to the 500A product
- the ambiguous family `Offset Less than 10 / 10 / 20 / 40 mA` row remains unresolved
- no IP65-specific fact was imported
- the optional temperature sensor is retained as an accessory dependency, not an integrated product feature

## 5. Existing Architecture Audit

| Concept | Current destination | Result |
|---|---|---|
| Capabilities | `capabilities` | Exact generic destination exists for monitoring and communication |
| Logical ports | `ports` | Existing generic destination; no conversion port is created |
| Electrical connection points | `power_paths[].connection_points` / topology contracts | Existing generic destination; candidate keeps product-local terminal IDs |
| Conductive relationship | `power_paths[].conductive_relationships` | Existing generic destination; suitable for a non-directional shunt path |
| Power path | `power_paths` | Correctly absent; SmartShunt is not a converter |
| Current measurement | `measurement.instances` | Exact generic destination exists; target is conductive relationship |
| Voltage measurement | `measurement.instances` | Exact generic destination exists; target is Vbatt+ connection point |
| Measurement target | `conductive_relationship`, `connection_point`, or `port` | Exact generic destination exists |
| Auxiliary alternatives | Existing switching/configuration vocabulary plus evidence layer | Candidate preserves modes as alternatives; no simultaneous activation |
| Accessory dependency | `required_accessories` / review evidence | Existing generic destination exists |
| Self-consumption | Electrical/self-consumption product fact | Existing product-fact destination; no daily-energy derivation |
| Interaction endpoint | Existing reviewed interaction architecture | Existing generic interaction evidence architecture exists |
| Physical connector | Interaction/connector topology contracts | Logical VE.Direct endpoint remains distinct from physical connector |
| Provenance | Source/fact/review evidence contracts | Existing exact destination exists |

No actual source-backed concept requires a product-specific architecture branch.

## 6. Generic Architecture Gaps

NONE requiring implementation for this evidence package.

Evidence-only items:

- derived/calculated/history information is retained as reviewed evidence rather than flattened into direct measurement instances
- mutually exclusive auxiliary modes remain evidence/configuration semantics rather than simultaneous component capabilities
- physical VE.Direct connector identity requires human review of the drawing/connector representation before canonical promotion
- the technical-table offset row is unresolved because the captured HTML does not map its four values explicitly to the four models

## 7. Historical Draft Comparison

Historical path:
`data/components/victron-energy.smartshunt-shu050150050.yaml`

Matches:

- manufacturer: Victron Energy
- MPN: SHU050150050
- product family: SmartShunt
- monitor and communication capabilities
- voltage/current measurement intent

Conflicts or unsupported flattening:

- `battery_port` is not a source-backed exact terminal identity
- `electrical.nominal_voltage_v: [12, 24]` is unsupported by this evidence package and is removed from candidate semantics
- `battery_port` direction `bidirectional` is not a canonical intrinsic direction claim
- direct measurement targets are flattened to one port instead of a conductive relationship and Vbatt+ connection point
- no distinction exists between direct measurement and calculated/derived information
- auxiliary modes and optional temperature-sensor dependency are missing
- self-consumption is missing
- interaction endpoint and physical connector separation is missing
- exact source hashes, locators, fact IDs, and review binding are missing

## 8. Product-Local Electrical Topology

Source-backed product-local objects proposed for review:

- `smartshunt.battery-minus`: M10 high-current connection, labeled BATTERY MINUS
- `smartshunt.system-minus`: M10 high-current connection, labeled SYSTEM MINUS
- `smartshunt.vbatt-plus`: fused positive supply/sense connection
- `smartshunt.aux`: configurable auxiliary connection
- `smartshunt.main-shunt-conduction`: non-directional conductive relationship between the two high-current terminals

The manual instructs that all loads, inverters, chargers, solar chargers, and other charge sources connect after the shunt on SYSTEM MINUS. That is installation guidance and measurement coverage semantics; it is not an intrinsic conversion direction.

## 9. Connection Points / Terminals

| ID | Manufacturer wording | Evidence | Applicability |
|---|---|---|---|
| `smartshunt.battery-minus` | BATTERY MINUS, M10 bolt for 500A model | `extracted.fact.smartshunt.main-terminals`; installation 3.4 paragraphs 1-2; technical row `Shunt connection bolts` | Exact 500A |
| `smartshunt.system-minus` | SYSTEM MINUS, M10 bolt for 500A model | same as above | Exact 500A |
| `smartshunt.vbatt-plus` | Vbatt+ terminal with fused positive cable | `extracted.fact.smartshunt.vbatt-plus`; installation 3.4 paragraphs 3-4 | SmartShunt family, applicable to exact target |
| `smartshunt.aux` | Aux terminal | `extracted.fact.smartshunt.aux`; installation 3.5 | SmartShunt family, applicable to exact target |

## 10. Conductive Relationships

Proposed relationship:

- ID: `smartshunt.main-shunt-conduction`
- participants:
  - `smartshunt.battery-minus`
  - `smartshunt.system-minus`
- directionality: none
- semantic kind: conductive relationship

power_path present?:
- NO

why:
- the SmartShunt measures current through a shunt; it does not convert electrical energy
- no directional conversion path is created
- battery-side/system-side labels remain product-local installation and measurement semantics

## 11. Electrical Ratings / Constraints

Source-backed candidate facts:

- supply voltage range: 6.5–70 VDC
- auxiliary battery input voltage range: 6.5–70 VDC
- current draw: less than 1 mA
- operating temperature: -40 to +50 C
- battery capacity configuration: 1–9999 Ah
- current resolution: ±0.01 A
- voltage resolution: ±0.01 V
- current measurement accuracy: ±0.4%
- voltage measurement accuracy: ±0.3%
- 500A model dimensions: 46 x 120 x 54 mm
- 500A model high-current bolts: M10

The 500A value is not promoted as a continuous ampacity, absolute maximum, or unrestricted measurement range.

## 12. 500A / 50mV Source-Backed Semantic Interpretation

The exact official product page identifies the variant as `SmartShunt 500A/50mV`, and the appendix contains the `Dimensions SmartShunt 500A` section with the 500A/50mV drawing.

Supported interpretation:

- `500A/50mV` is the manufacturer product designation for the 500A model paired with a 50mV shunt rating/designation.
- 500A is not promoted as continuous conductor ampacity, absolute maximum current, recommended system current, or unrestricted measurement range.
- 50mV is not promoted as normal system voltage, generic voltage-drop criterion, or absolute voltage limit.
- no additional current-duration or overload semantics are inferred.

Human review is required before assigning a canonical constraint kind to either value.

## 13. Direct Measurement Instances

Proposed product-local measurement instances:

1. `smartshunt.main-current`
   - quantity: current
   - target: `conductive_relationship:smartshunt.main-shunt-conduction`
   - evidence: `extracted.fact.smartshunt.direct-measurements`

2. `smartshunt.battery-voltage`
   - quantity: voltage
   - target: `connection_point:smartshunt.vbatt-plus`
   - evidence: `extracted.fact.smartshunt.direct-measurements`

Auxiliary readings are not promoted as simultaneous direct measurements because the manual states that one auxiliary input is configured for one selected function.

## 14. Derived / Calculated Quantities

The manual explicitly describes these as calculated, estimated, accumulated, or historical rather than direct electrical sensor readings:

- power
- state of charge
- consumed Ah
- time-to-go
- deepest/last/average/cumulative discharge data
- charged/discharged energy
- cycle and synchronization history
- minimum/maximum voltage history

These remain evidence-backed information categories pending a generic semantic destination review. They are not represented as direct measurement instances.

## 15. Measurement Targets

Proposed targets:

- current: main conductive relationship
- battery voltage: Vbatt+ / battery-side voltage connection
- second battery voltage: Aux in `second_battery_voltage` mode
- midpoint deviation: Aux in `midpoint_voltage` mode
- temperature: Aux in `temperature_with_optional_sensor` mode

No installed-system object such as house battery, starter battery, alternator, chassis, or load is created. The product-local labels are preserved only where the source uses them.

## 16. Auxiliary Input / Configurable Modes

The Aux input supports one selected mode:

- second battery voltage
- midpoint battery-bank monitoring
- battery temperature monitoring

The modes are alternatives, not simultaneous defaults.

The manual identifies:

- second battery mode as monitoring a second battery such as a starter or auxiliary battery
- midpoint mode for series or series/parallel banks
- temperature mode using an optional temperature sensor

## 17. Accessory Dependencies

Temperature measurement requires the optional `Temperature sensor for BMV-712 Smart and BMV-702`, identified by the manual as a separately purchased sensor.

The base SmartShunt is not treated as containing an integrated temperature sensor.

Other interaction accessories remain separate:

- VE.Direct cable for GX connection
- VE.Direct-to-USB interface for USB/VictronConnect
- GX device for system/remote monitoring

## 18. Self-Consumption

Source fact:

- current draw `< 1 mA`
- source: `extracted.fact.smartshunt.self-consumption`
- locator: technical-data section 11.1, row `Current draw`

Meaning:
- manufacturer product current-draw fact

Not meaning:
- not daily Ah
- not daily Wh
- not 24-hour energy
- not an assumed installed duty cycle
- not tied to an invented battery voltage

## 19. Interaction Endpoints

Proposed logical endpoints:

- `smartshunt.bluetooth`
  - mechanism: Bluetooth
  - information/application: VictronConnect
- `smartshunt.ve-direct`
  - mechanism: VE.Direct
  - functions: read data and change settings; automatic periodic readings are described

Additional source-backed interaction relationships:

- optional USB path through VE.Direct-to-USB interface
- VE.Direct connection to GX device and VRM portal
- Bluetooth VE.Smart networking for exchange of battery data with supported Victron products

No compatibility evaluator or installed relationship is implemented.

## 20. Physical Connectors

| Stable ID | Connector family/type | Product-local role | Associated endpoint(s) | Directionality asserted? |
|---|---|---|---|---|
| `smartshunt.ve-direct.connector` | VE.Direct physical communication connector | Product data/configuration connection | `smartshunt.ve-direct` | No |
| `smartshunt.vbatt-plus.connection` | Product electrical connection point | Fused positive supply/sense | None | No |
| `smartshunt.aux.connection` | Product electrical connection point | Configurable auxiliary input | None | No |
| `smartshunt.battery-minus.connection` | M10 high-current terminal | BATTERY MINUS | `smartshunt.main-shunt-conduction` | No |
| `smartshunt.system-minus.connection` | M10 high-current terminal | SYSTEM MINUS | `smartshunt.main-shunt-conduction` | No |

The VE.Direct connector is kept distinct from the VE.Direct logical endpoint. No pin-level model is added.

## 21. Bluetooth / VictronConnect Evidence

The product page states that the SmartShunt connects via Bluetooth to VictronConnect, and the manual states that Bluetooth is used for setup and monitoring.

This establishes:

- product interaction capability
- information readout/configuration mechanism

It does not establish:

- arbitrary third-party interoperability
- network-wide publication
- installed runtime availability
- automatic data consumption by an unspecified device

## 22. VE.Direct Evidence

The technical data lists a VE.Direct communication port.

The interfacing chapter states:

- VE.Direct can connect to a GX device
- VE.Direct-to-USB can connect to a computer or VictronConnect
- the VE.Direct protocol can read data and change settings
- readings are automatically sent periodically

This is represented as:

- logical endpoint: `smartshunt.ve-direct`
- physical connector: `smartshunt.ve-direct.connector`

No protocol parser or compatibility logic is implemented.

## 23. Measurement vs Information-Exposure Boundary

Direct:
- battery voltage
- battery current

Auxiliary configurable reading:
- second battery voltage
- midpoint voltage deviation
- battery temperature with optional sensor

Calculated/derived:
- power
- state of charge
- consumed Ah
- time-to-go

Historical/statistical:
- discharge, energy, cycle, synchronization, voltage, and alarm history

Externally exposed:
- readings/configuration via VictronConnect, Bluetooth, VE.Direct, GX, VRM, and VE.Smart networking where the source states the relevant mechanism

No category is collapsed into another.

## 24. Candidate

- candidate ID: `victron.smartshunt.shu050150050`
- candidate snapshot: `sha256:ca5c6f5672818465822024f3a473cfeeac7f1e7f84cab79d20d4eb6607ed8b6f`
- candidate artifact/path: `data/ingestion/victron-smartshunt-shu050150050.json`
- review status: pending
- promotion status: review_required

The candidate uses only persisted official source evidence. The historical YAML is excluded from candidate construction.

## 25. Provenance

| Proposed object | Fact IDs | Source IDs |
|---|---|---|
| exact identity | `identity.500a-50mv`, `family.sizes` | product page, introduction, appendix |
| main terminals | `main-terminals`, `500a-m10` | installation, technical-data |
| Vbatt+ | `vbatt-plus` | installation |
| Aux | `aux`, `aux-measurement` | installation, operation |
| conductive relationship | `main-terminals`, `current-sign` | installation, operation |
| direct current/voltage | `direct-measurements` | operation |
| self-consumption | `self-consumption` | technical-data |
| VE.Direct | `ve-direct` | technical-data, interfacing |
| Bluetooth | `bluetooth` | product page, introduction, operation |
| derived information | `derived-information` | operation |
| 500A dimensions/bolts | `500a-dimensions`, `500a-m10` | technical-data, appendix |

## 26. HUMAN REVIEW TABLE A — Identity / Product Facts

| # | Fact ID | Source / locator | Proposed mapping | Meaning | Does not mean | Disposition |
|---:|---|---|---|---|---|---|
| 1 | `identity.500a-50mv` | product page, product-variant-list | Exact identity `SHU050150050` | Exact SmartShunt 500A/50mV product | Not another SmartShunt size or IP65 variant | NEEDS HUMAN DECISION |
| 2 | `family.sizes` | introduction §2.2 | Family applicability boundary | Four family sizes exist | Does not assign sibling facts to 500A | NEEDS HUMAN DECISION |
| 3 | `500a-dimensions` | technical data §11.1 | 500A dimensions | Exact 500A model dimensions | Not a rating or electrical limit | NEEDS HUMAN DECISION |

## 27. HUMAN REVIEW TABLE B — Electrical Ratings / Constraints

| # | Fact ID | Source / locator | Proposed mapping | Conditions | Does not mean | Disposition |
|---:|---|---|---|---|---|---|
| 1 | `500a-rating` | appendix §12.2 | Preserve 500A/50mV designation | Exact 500A drawing | Not continuous ampacity or absolute maximum | NEEDS HUMAN DECISION |
| 2 | `supply-range` | technical data, Supply voltage range | Supply operating range 6.5–70 VDC | Product supply | Not system nominal voltage | NEEDS HUMAN DECISION |
| 3 | `aux-range` | technical data, auxiliary input row | Auxiliary input range 6.5–70 VDC | Aux battery mode | Not all auxiliary modes simultaneously active | NEEDS HUMAN DECISION |
| 4 | `self-consumption` | technical data, Current draw | Product draw `<1 mA` | Product operating fact | Not daily energy | NEEDS HUMAN DECISION |
| 5 | `accuracy-resolution` | technical data, Resolution & Accuracy | Preserve measurement resolution/accuracy facts | Quantity-specific | Not a system tolerance or runtime reading | NEEDS HUMAN DECISION |
| 6 | `model-specific-offset` | technical data, Offset | Keep unresolved | Four-value family row lacks explicit mapping | Not safe to assign 500A offset | REJECT MAPPING / RETAIN EVIDENCE |

## 28. HUMAN REVIEW TABLE C — Connection Points / Conductive Topology

| # | Fact ID | Source / locator | Proposed object | Meaning | Does not mean | Disposition |
|---:|---|---|---|---|---|---|
| 1 | `main-terminals` | installation §3.4 | `battery-minus` and `system-minus` | Product-local high-current terminals | Not intrinsic conversion direction | NEEDS HUMAN DECISION |
| 2 | `500a-m10` | technical data, Shunt connection bolts | M10 terminal metadata | Exact 500A terminal size | Not cable sizing or ampacity | NEEDS HUMAN DECISION |
| 3 | `main-terminals` | installation §3.4 | Non-directional conductive relationship | Current passes through shunt | Not a power_path | NEEDS HUMAN DECISION |
| 4 | `current-sign` | operation §5.1 | Measurement sign convention | Negative out / positive in relative to battery | Not energy-conversion direction | NEEDS HUMAN DECISION |

## 29. HUMAN REVIEW TABLE D — Direct Measurements

| # | Fact ID | Source / locator | Proposed measurement | Target | Does not mean | Disposition |
|---:|---|---|---|---|---|---|
| 1 | `direct-measurements` | operation §5.1 | Main current | `smartshunt.main-shunt-conduction` | Not a battery-system instance binding | NEEDS HUMAN DECISION |
| 2 | `direct-measurements` | operation §5.1, Voltage | Battery voltage | `smartshunt.vbatt-plus` | Not an assumed 12/24/48 V default | NEEDS HUMAN DECISION |

## 30. HUMAN REVIEW TABLE E — Derived / Calculated Quantities

| # | Fact ID | Source / locator | Proposed information class | Meaning | Does not mean | Disposition |
|---:|---|---|---|---|---|---|
| 1 | `derived-information` | operation §5.1 | Calculated power | Derived from product measurements | Not direct current/voltage sensing | NEEDS HUMAN DECISION |
| 2 | `derived-information` | operation §5.1 | Calculated SOC, consumed Ah, time-to-go | Derived/estimated monitor information | Not a guaranteed runtime or system solver | NEEDS HUMAN DECISION |
| 3 | `derived-information` | operation §5.5 | Historical/statistical information | Stored history and events | Not instantaneous measurement | NEEDS HUMAN DECISION |

## 31. HUMAN REVIEW TABLE F — Auxiliary / Configurable Measurement Behavior

| # | Fact ID | Source / locator | Proposed mode | Dependency | Does not mean | Disposition |
|---:|---|---|---|---|---|---|
| 1 | `aux` | installation §3.5 | Second-battery voltage | Selected Aux mode | Not simultaneous with midpoint/temperature | NEEDS HUMAN DECISION |
| 2 | `aux` | installation §3.5.2 | Midpoint voltage/deviation | Selected Aux mode, series bank wiring | Not a generic battery topology solver | NEEDS HUMAN DECISION |
| 3 | `aux` | installation §3.5.3 | Battery temperature | Optional external sensor | Not integrated temperature sensing | NEEDS HUMAN DECISION |

## 32. HUMAN REVIEW TABLE G — Self-Consumption

| # | Fact ID | Source / locator | Proposed mapping | Meaning | Does not mean | Disposition |
|---:|---|---|---|---|---|---|
| 1 | `self-consumption` | technical data, Current draw | Product current draw `<1 mA` | Manufacturer current-draw fact | Not daily Ah/Wh or fixed duty cycle | NEEDS HUMAN DECISION |

## 33. HUMAN REVIEW TABLE H — Interaction Endpoints

| # | Fact ID | Source / locator | Proposed endpoint | Conditions | Does not mean | Disposition |
|---:|---|---|---|---|---|---|
| 1 | `bluetooth` | product page; product-description | `smartshunt.bluetooth` | VictronConnect app | Not arbitrary interoperability | NEEDS HUMAN DECISION |
| 2 | `ve-direct` | technical data; VE.Direct row | `smartshunt.ve-direct` | VE.Direct cable or USB adapter/GX path | Not a protocol compatibility guarantee | NEEDS HUMAN DECISION |
| 3 | `gx` | product page; product-description | Information exposure to GX/VRM | Connected GX device | Not automatic installed relationship | NEEDS HUMAN DECISION |

## 34. HUMAN REVIEW TABLE I — Physical Connectors / Associations

| # | Fact ID | Source / locator | Proposed connector | Association | Directionality | Disposition |
|---:|---|---|---|---|---|---|
| 1 | `ve-direct` | technical data; interfacing §6.2/6.4 | `smartshunt.ve-direct.connector` | `smartshunt.ve-direct` | Not asserted | NEEDS HUMAN DECISION |
| 2 | `500a-m10` | technical data | `smartshunt.battery-minus.connection` and `system-minus.connection` | conductive relationship | Not asserted | NEEDS HUMAN DECISION |
| 3 | `vbatt-plus` | installation §3.4 | `smartshunt.vbatt-plus.connection` | supply/sense function | Not asserted | NEEDS HUMAN DECISION |
| 4 | `aux` | installation §3.5 | `smartshunt.aux.connection` | auxiliary measurement modes | Not asserted | NEEDS HUMAN DECISION |

## 35. HUMAN REVIEW TABLE J — Source Applicability / Sibling Isolation

| # | Fact ID | Applicability decision | Explicit exclusion | Disposition |
|---:|---|---|---|---|
| 1 | `identity.500a-50mv` | Exact SHU050150050 | 300A/1000A/2000A/IP65 substitutions | NEEDS HUMAN DECISION |
| 2 | `500a-dimensions` | Exact 500A row | Other model dimensions | NEEDS HUMAN DECISION |
| 3 | `500a-m10` | Exact 500A bolt row | 300A M8 row leakage | NEEDS HUMAN DECISION |
| 4 | `model-specific-offset` | Unresolved; do not map | All four family offset values | REJECT MAPPING |
| 5 | `aux` temperature mode | SmartShunt family with external sensor | Integrated sensor claim | NEEDS HUMAN DECISION |

## 36. Remaining Unknowns

- whether 500A should receive any canonical `continuous`, `maximum`, or `measurement_range` constraint kind
- whether 50mV should receive any canonical constraint kind
- exact connector-instance representation for VE.Direct after human review
- exact model-specific offset for the 500A row
- canonical representation of derived/calculated/history information
- canonical representation of mutually exclusive auxiliary modes
- exact measured-current sign semantic target
- exact source-backed dimensions drawing values beyond the captured technical row

## 37. Future Whole-System Data Contract

Later backend logic can consume:

- a non-conversion conductive shunt path
- product-local terminal identities
- direct current and voltage measurement targets
- selectable auxiliary measurement mode
- external temperature-sensor dependency
- self-consumption current draw
- logical Bluetooth and VE.Direct endpoints
- separate physical connector identities
- derived/history information as non-direct product information
- exact source/fact/review provenance

This checkpoint does not implement:

- installed-system binding
- shunt sizing
- conductor/fuse sizing
- SOC simulation
- protocol compatibility
- information propagation evaluation

## 38. Tests Added / Changed

No generic architecture gap required implementation in this evidence-only checkpoint.

Existing generic tests already cover:

- conductive relationships distinct from power paths
- measurement targets referencing conductive relationships
- measurement quantity validation
- reviewed interaction evidence and applicability
- provenance targeting
- missing-data handling

No SmartShunt-specific test branch was added.

## 39. Focused Validation

Focused validation was not run because this checkpoint stopped at candidate and review-package construction, as required. No canonical promotion or generic implementation change was made.

## 40. Full Validation

Not run. The requested successful endpoint is the persisted official evidence, deterministic candidate, architecture audit, and review package before promotion. Running the full suite without implementation changes would not validate a new behavior.

## 41. Protected Architecture Check

- stale `/battery-monitors/...` paths were not used as evidence
- historical SmartShunt YAML was not used as evidence or candidate input
- no sibling leakage
- no shunt-as-converter model
- no fake power_path
- no installation convention converted to intrinsic conversion direction
- 500A and 50mV semantics were not inflated
- direct and derived quantities remain distinct
- measurement remains distinct from information exposure
- VE.Direct remains distinct from its physical connector
- auxiliary alternatives remain mutually exclusive
- external temperature-sensor dependency remains explicit
- no hidden SOC, voltage, runtime, or daily-energy assumptions
- no manufacturer-specific engineering branch
- no fake review or verification inflation
- no frontend or whole-system logic
- missing data remains unknown, not zero or false

## 42. Files Changed

Tracked:

- `data/ingestion/victron-smartshunt-shu050150050.json`
- `docs/reviews/smartshunt-shu050150050-evidence.md`

Untracked historical drafts:

- `data/components/blue-sea-systems.m-series-6006.yaml`
- `data/components/victron-energy.ekrano-gx-bpp900480100.yaml`
- `data/components/victron-energy.smartshunt-shu050150050.yaml`

The historical SmartShunt YAML was not modified.

## 43. Git Diff Summary

At handoff:

- `git status --short`
  - `?? data/components/blue-sea-systems.m-series-6006.yaml`
  - `?? data/components/victron-energy.ekrano-gx-bpp900480100.yaml`
  - `?? data/components/victron-energy.smartshunt-shu050150050.yaml`
  - the two new Checkpoint F artifacts are not staged
- `git diff --stat`
  - no tracked diff output before the new artifacts were added
- `git diff --name-only`
  - no tracked diff output before the new artifacts were added
- `git diff --check`
  - no output

The new Checkpoint F files remain unstaged and should be reported by status in the final working-tree snapshot.

## 44. Staged / Committed / Pushed / PR

- staged: NO
- committed: NO
- pushed: NO
- new PR: NO
- existing PR: #56

## 45. Deviations

NONE.

## 46. Blockers

NONE for evidence acquisition and candidate construction.

Canonical promotion remains intentionally blocked by the required human-review boundary.

## 47. Verdict

**A. SMARTSHUNT EVIDENCE COMPLETE — HUMAN REVIEW REQUIRED**

The official evidence package and deterministic candidate are complete. The exact product is not promoted, the historical draft remains untouched, and the package stops at the required human-review boundary.

## 48. Exact User Action Required

The following numbered decisions are required before any canonical amendment:

1. Approve or reject exact identity `SmartShunt 500A/50mV`, MPN `SHU050150050`.
2. Approve or reject the product-local terminals `BATTERY MINUS`, `SYSTEM MINUS`, `Vbatt+`, and `Aux`.
3. Approve or reject the non-directional conductive relationship between BATTERY MINUS and SYSTEM MINUS, with no power path.
4. Approve or reject direct current measurement targeting the conductive relationship.
5. Approve or reject direct battery-voltage measurement targeting `Vbatt+`.
6. Approve or reject the source-backed interpretation of `500A/50mV` without assigning ampacity, absolute-maximum, or system-voltage semantics.
7. Approve or reject supply and auxiliary voltage ranges, accuracy/resolution facts, dimensions, and M10 terminal metadata.
8. Approve or reject the `<1 mA` product current-draw fact without deriving daily energy.
9. Approve or reject the mutually exclusive Aux modes: second-battery voltage, midpoint monitoring, and temperature monitoring.
10. Approve or reject the optional external-temperature-sensor dependency.
11. Approve or reject calculated/derived information categories: power, SOC, consumed Ah, and time-to-go.
12. Approve or reject historical/statistical information categories.
13. Approve or reject logical Bluetooth/VictronConnect and VE.Direct interaction endpoints.
14. Approve or reject the separate VE.Direct physical connector instance and its non-directional association.
15. Approve or reject exact-SKU applicability and sibling isolation, including rejection of the unresolved model-specific offset mapping.
16. Approve or reject promotion of the candidate only after the above decisions are recorded through the existing human-review/amendment pipeline.

Do not begin another product.
