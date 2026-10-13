# Representative corpus coverage

This document records the machine-derived corpus baseline for the representative
corpus expansion. Product facts below are transcribed from the in-scope canonical
records as they existed before expansion; this is a coverage inventory, not a
recommendation or a claim of installation suitability.

## Baseline snapshot

- Branch: `feat/corpus-expansion-coverage`
- Starting HEAD: `90d915a6e50c2c494848d264aa5f3edc8982c4c1`
- In-scope production records examined: 7
- Verification state: all 7 records are `unverified`; Phase 5 therefore cannot
  treat their canonical facts as engineering-authoritative.
- The baseline excludes local-only material and does not infer facts from
  product names, product families, source links, or records outside the
  canonical corpus.

## Per-record coverage

| Component ID                   | Manufacturer / model                                                   | Verification | Canonical role and selector-relevant coverage                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `victron-energy.pmp242200100`  | Victron Energy / 24/2000/50-50 120V VE.Bus                             | unverified   | Combined inverter/charger; nominal 24 V DC; 120 V AC, 60 Hz; 1,600 W continuous, 2,000 VA, 50 A continuous charge; explicit DC, AC-input, and AC-output ports and separate inversion and charging paths.                                                          |
| `victron-energy.scc075015060r` | Victron Energy / SmartSolar MPPT 75/15 Retail                          | unverified   | Solar charge controller; battery-side nominal 12 V or 24 V; 15 A charge rating; PV input path with 75 V maximum open-circuit constraint, 15 A short-circuit-current constraint, and 220 W / 440 W nominal PV power conditioned on the respective battery voltage. |
| `victron-energy.ori122436120`  | Victron Energy / Orion-Tr Smart 12/24-15A (360W) Isolated              | unverified   | DC-to-DC conversion, 12 V-class input range 8–17 V to 24 V output; 15 A / 360 W output ratings qualified at 40 °C; explicit conversion path and galvanic isolation relationship with 200 V DC withstand.                                                          |
| `victron-energy.ori241236120`  | Victron Energy / Orion-Tr Smart 24/12-30A (360W) Isolated              | unverified   | DC-to-DC conversion, 24 V-class input range 16–35 V to 12 V output; 30 A / 360 W output ratings qualified at 40 °C; explicit conversion path and galvanic isolation relationship with 200 V DC withstand.                                                         |
| `epoch-batteries.b24100a-c`    | Epoch Batteries / 24V 100Ah LiFePO4 Battery (2.56kWh)                  | unverified   | Storage; 25.6 V nominal, 100 Ah, 2,560 Wh; continuous discharge 120 A, 200 A peak for 60 s; declared series count 1–2, parallel count 1–4; recommended charge current 50 A; weight 21.999229945 kg.                                                               |
| `victron-energy.shu050150050`  | Victron Energy / SmartShunt 500A/50mV                                  | unverified   | Monitor role, dimensions 120 × 54 × 46 mm, input voltage range 6.5–70 V; explicit current/voltage measurement relationships and Bluetooth / VE.Direct communication endpoints. No protocol-compatibility assertion is present.                                    |
| `blue-sea-systems.6006`        | Blue Sea Systems / m-Series Mini On-Off Battery Switch with Knob - Red | unverified   | Disconnect role; switched-contact DC continuous-current rating 300 A and maximum DC voltage rating 48 V; exact terminal relationships and ON/OFF switching configurations. It is not a storage, conversion, or source product.                                    |

Source references are retained at record level. They do not establish
field-specific source attribution unless the canonical record provides that
binding. No native wording or manufacturer revision is inferred from these
summaries.

## Baseline coverage matrix

| Coverage dimension                     | Observed baseline                                                                                                       | Gap / interpretation boundary                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manufacturers                          | Victron Energy (5), Epoch Batteries (1), Blue Sea Systems (1)                                                           | Most power-conversion coverage is from one manufacturer; the two alternatives are limited to storage and switching.                                                                         |
| Storage voltage and assembly           | One 24 V-class battery product; source-backed series and parallel count ranges are present.                             | No in-scope 12 V or 48 V storage product; one manufacturer and one capacity/rating profile only.                                                                                            |
| Inversion and AC                       | One combined 24 V inverter/charger with 120 V, 60 Hz output and a 1,600 W continuous rating.                            | No in-scope inverter-only product, alternate manufacturer, 12 V architecture, or 48 V architecture.                                                                                         |
| AC charging                            | Charging is represented only as the AC-to-DC path of the combined inverter/charger.                                     | No standalone AC charger to exercise a split inverter-plus-charger architecture.                                                                                                            |
| Solar conversion                       | One MPPT product supports 12 V and 24 V battery-side nominal values and has PV input voltage/current/power constraints. | No 48 V product and no independent manufacturer or materially different MPPT envelope.                                                                                                      |
| DC conversion / vehicle charging       | Two isolated, directed products cover 12→24 V and 24→12 V conversion; both carry temperature-qualified output ratings.  | No alternate manufacturer, same-voltage vehicle charger, or non-isolated example in the current records. Product naming alone does not establish vehicle/alternator charging applicability. |
| Exact ports and power paths            | Exact interfaces and paths are present for the inverter/charger, MPPT, and both converters.                             | Record verification is unverified, so these facts are retained evidence but not authoritative selector inputs. Other records do not declare equivalent conversion paths.                    |
| Monitoring and communication           | One monitor has Bluetooth and VE.Direct endpoints and direct measurement relationships.                                 | Endpoint presence does not prove a compatible protocol, target, or installed monitoring function.                                                                                           |
| Switching / distribution / protection  | One disconnect has an explicit contact rating, terminals, and switching states.                                         | The selector's modeled required product roles do not include protection-layout synthesis; no such capability is claimed.                                                                    |
| Idle / standby / quiescent consumption | No in-scope canonical record establishes a selector-ready idle/quiescent value.                                         | Absence from these records is not evidence that a manufacturer does not publish it.                                                                                                         |
| Dimensions / weight                    | Weight exists for the battery; dimensions exist for the monitor.                                                        | Incomplete and role-skewed physical coverage; individual dimensions are not installed envelopes or fit proof.                                                                               |
| Selector outcomes                      | No product is established as eligible from this baseline; all records are unverified.                                   | The authoritative positive/negative/unresolved distribution must be measured using explicit scenarios after reviewed records are promoted.                                                  |

### Matrix gaps to address

The clearest corpus gaps are non-Victron alternatives for major conversion
roles, 12 V and 48 V storage, useful 48 V conversion and solar products,
distinct inverter-only and standalone charger products, and additional
manufacturer-supported battery assembly and communication states. Coverage
should be expanded only where exact-product authoritative evidence and the
existing generic ingestion/mapping contracts can support it. Unknowns remain
unknown; neither this matrix nor a missing canonical field asserts manufacturer
non-publication.

## Pre-ingestion expansion selection

The following 20 intake candidates were selected before the new production batch.
None is one of the seven baseline products. The set spans 16 manufacturers and
storage, inverter/charger, inverter, charger, DC-DC charging, solar, protection,
monitoring, and mobile-load roles. The selected roles and product-page links are
intake scope only: they do not assert verified canonical roles, exact electrical
compatibility, product availability, or any specification. Voltage diversity is
an explicit acquisition objective; exact-product voltage and other facts must
come from the captured manufacturer evidence and remain subject to semantic
review.

The selection reuses official product URIs previously recorded in the Wave 1
and Wave 2 campaign plans because those candidates cover roles and manufacturers
absent from this seven-record canonical baseline. Those campaign reports are
selection history, not substitutes for the new batch's retained source evidence
or human decisions.

| #   | Manufacturer          | Requested model                                               | Requested MPN  | Intake role                       | Official manufacturer source                                                                                                                                         |
| --- | --------------------- | ------------------------------------------------------------- | -------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Victron Energy        | MultiPlus-II 48/3000/35-32 230V                               | PMP482305012   | Inverter/charger                  | [Product](https://www.victronenergy.com/inverters-chargers/multiplus-ii)                                                                                             |
| 2   | Morningstar           | TS-MPPT-60                                                    | TS-MPPT-60     | Solar MPPT                        | [Product](https://www.morningstarcorp.com/products/tristar-mppt/)                                                                                                    |
| 3   | REDARC                | BCDC1240D                                                     | BCDC1240D      | DC-DC / alternator charger        | [Product](https://www.redarcelectronics.com/us/dual-input-40a-in-vehicle-dc-battery-charger)                                                                         |
| 4   | Battle Born Batteries | BB10012                                                       | BB10012        | Battery / BMS                     | [Product](https://battlebornbatteries.com/products/100ah-12v-lifepo4-deep-cycle-battery)                                                                             |
| 5   | Blue Sea Systems      | ST Blade Fuse Block - 12 Circuits with Negative Bus and Cover | 5026           | DC protection / distribution      | [Product](https://www.bluesea.com/products/5026/ST%20Blade%20Fuse%20Block%20-%2012%20Circuits%20with%20Negative%20Bus%20and%20Cover)                                 |
| 6   | Simarine              | PICO Battery Monitor                                          | PICO           | Monitoring / control              | [Product](https://simarine.net/product/pico-battery-monitor/)                                                                                                        |
| 7   | Dometic               | CoolMatic CRX 50 E                                            | 9105306726     | DC refrigerator / load            | [Product](https://www.dometic.com/en/product/dometic-coolmatic-crx-50-e-9105306726)                                                                                  |
| 8   | Samlex America        | SEC-1230UL                                                    | SEC-1230UL     | AC battery charger / power supply | [Product](https://samlexamerica.com/products/12-volt-30-amp-battery-charger-safety-listed/)                                                                          |
| 9   | REDARC                | BCDC1225D                                                     | BCDC1225D      | DC-DC / alternator charger        | [Product](https://www.redarcelectronics.com/us/dual-input-25a-in-vehicle-dc-battery-charger)                                                                         |
| 10  | Battle Born Batteries | BBGC3                                                         | BBGC3          | LiFePO4 battery / BMS             | [Product](https://battlebornbatteries.com/products/270ah-12v-gc3-lifepo4-deep-cycle-batteries)                                                                       |
| 11  | Samlex America        | PST-2000-24                                                   | PST-2000-24    | Inverter                          | [Product](https://samlexamerica.com/products/2000-watt-pure-sine-wave-inverter-pst-2000-24/)                                                                         |
| 12  | Morningstar           | TS-MPPT-30                                                    | TS-MPPT-30     | Solar MPPT                        | [Product](https://www.morningstarcorp.com/products/tristar-mppt/)                                                                                                    |
| 13  | Xantrex               | FREEDOM XC PRO 3000                                           | 818-3010       | Inverter/charger                  | [Product](https://xantrex.com/products/inverter-chargers/freedomxcpro/fxcpro-3000/)                                                                                  |
| 14  | Progressive Dynamics  | PD9345                                                        | PD9345         | AC charger / converter            | [Product](https://www.progressivedyn.com/pd9300/)                                                                                                                    |
| 15  | Eaton                 | CB185-100                                                     | CB185-100      | Breaker / protection              | [Product](https://www.eaton.com/us/en-us/skuPage.CB185-100.html)                                                                                                     |
| 16  | Balmar                | SG200                                                         | SG200          | Battery monitor                   | [Product](https://balmar.net/product/sg200/)                                                                                                                         |
| 17  | Indel B               | CRUISE 65 ELEGANCE SILVER                                     | Not supplied   | DC refrigerator / load            | [Product](https://www.indelb.com/us/product/cruise-65-elegance-silver/)                                                                                              |
| 18  | Pentair               | 4008-131-E65                                                  | 4008-131-E65   | Water pump / load                 | [Product](https://www.pentair.com/en-us/flow/shurflo/shurflo-products/shurflo-rv-applications/water-delivery-pumps/shurflo-revolution-4008-series-by-pass-pump.html) |
| 19  | Webasto               | Air Top 2000 STC                                              | Not supplied   | Heater / electrical load          | [Product](https://www.webasto.com/en-int/heating/air-heater/air-top-2000-stc.html)                                                                                   |
| 20  | Renogy                | 100W Lightweight Flexible Solar Panel                         | RNG-100DB-H-US | Solar module                      | [Product](https://www.renogy.com/products/100-watt-12-volt-flexible-monocrystalline-solar-panel)                                                                     |

Operator-supplied model and MPN values remain requested identities. The batch
must preserve source failures, non-authoritative captures, unsupported structures,
unresolved mappings, and schema gaps as such. No candidate is to be approved,
finalized, promoted, or marked verified before the batched human semantic review
boundary.

## Production preparation and human-review handoff

The selected inputs were created as one ordinary 20-child batch through the
ingestion-admin API. Batch ID: `23345c90-2e8e-40a5-abba-a740102ca412`.
Preparation completed with 17 children `review_ready` and three
`preparation_failed`; all 20 jobs remain in their prepared/failed states, with
zero approvals or finalizations. The 17 durable review packages are embedded in
their respective job records under the isolated ignored store
`.local-ingestion/corpus-expansion-20261005/`. The review UI is running at
`http://127.0.0.1:5175/` and the API at `http://127.0.0.1:4319/`; open the batch
above and review each child individually. The existing service on port 4318 was
left untouched.

The seed hashes below are SHA-256 hashes of the captured response-body bytes,
not hashes of the whole review package. A digest can identify a rejected error
or verification page as well as an authoritative product page; disposition and
HTTP status therefore remain part of the identity. `No digest` means capture
did not retain a complete response body.

| Requested model                                               | Job ID                                 | Seed response (HTTP / disposition) | Seed response SHA-256                                                                        | Review package; qualified facts / proposals / unresolved items | Candidate       |
| ------------------------------------------------------------- | -------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------- |
| MultiPlus-II 48/3000/35-32 230V                               | `d6329cc8-4b54-4ec5-affe-104c37975c0e` | 200 / authoritative                | `ff5c58d3aaed1f70f3a1fffa77858f555b6dd58ff09550f20d3fda41c431e946`                           | `review-package.c8daf3d4dd34010ca1d4d94a`; 0 / 0 / 0           | No              |
| TS-MPPT-60                                                    | `e549f6f5-9211-49ea-b421-632f44faea51` | 200 / authoritative                | `c5f3a9bb07b928982ce7b4c5d08cc1aa3e60bc126207ff21b6857e21058977a5`                           | `review-package.d45d53426beb371bfe55bc1f`; 19 / 19 / 19        | No              |
| BCDC1240D                                                     | `206040ff-7e75-4b9a-b00e-5ca5fcba248f` | 200 / authoritative                | 0                                                                                            | 0                                                              | No              |
| BB10012                                                       | `dc95eb21-2b28-448b-ae28-972d41e828ac` | 200 / authoritative                | 9                                                                                            | 8                                                              | Yes; unreviewed |
| ST Blade Fuse Block - 12 Circuits with Negative Bus and Cover | `95efd8a5-3c15-4cc7-9d66-dc0cb71b1b60` | 403 / failed                       | `967a9ce15e884642e6b67cecf67aac70975b620d421154a50e95097dbbfecd97` (403 response body)       | No package; acquisition failed                                 | No              |
| PICO Battery Monitor                                          | `60c39501-bd4f-4efc-9706-2d458cc29eea` | 200 / authoritative                | `e9c238d7edfefa9ba607c6a3c4fb1a2184b56456f7bfb4e47a1283e0eddd0e0b`                           | `review-package.5c404bcf5d720d03fcd516b8`; 0 / 0 / 0           | No              |
| CoolMatic CRX 50 E                                            | `9d9b78ee-ad5a-432e-af59-4224a7572b5a` | 200 / authoritative                | `c7f25cd68d8ae2bac8296d430f8292ca8ca269309c31e866f6c28d9fc32f8761`                           | `review-package.c2314cbd896ce421ae63ca17`; 0 / 0 / 0           | No              |
| SEC-1230UL                                                    | `05d11b4f-6a4e-4412-8304-36ba62421a84` | 200 / authoritative                | `5e743c8e0e0a9542336536b072d1fafdec8972daa9e9d63928e984a72d7a2454`                           | `review-package.e0d346f770adfa28010e1a1a`; 8 / 6 / 6           | No              |
| BCDC1225D                                                     | `f9743b3d-5860-417f-9735-5a0255af7fca` | 200 / authoritative                | 0                                                                                            | 0                                                              | No              |
| BBGC3                                                         | `feabf403-f123-414c-bc6c-95b247fbf36a` | 200 / authoritative                | 9                                                                                            | 8                                                              | Yes; unreviewed |
| PST-2000-24                                                   | `6b523a87-8652-453a-99c4-177eba82ee2a` | 200 / authoritative                | `55c499412370bd9345a631098469018b80eb3330c7e96aecb0e41abbdc7c1d8f`                           | `review-package.eda955ed45383eded4dd016f`; 10 / 8 / 8          | No              |
| TS-MPPT-30                                                    | `35a95970-60dd-4fdb-b3f1-d35a4276d357` | 200 / authoritative                | `d5ca02b7a694a056f8543cebcf1d63caa0bcb8cc8442ce00bca1145c5b543507`                           | `review-package.5dcfaad5a3d9b53da8946e29`; 19 / 19 / 19        | No              |
| FREEDOM XC PRO 3000                                           | `8cdceb45-8a2e-4843-a1c5-9b9e9ab88a97` | 200 / authoritative                | 0                                                                                            | 0                                                              | No              |
| PD9345                                                        | `a36d5d5d-c4e8-44f2-b7be-a81863819ad9` | 200 / authoritative                | `281074ea7c5937425ce722c92ef052b4bb3944a177686ec95b623837c7761ebc`                           | `review-package.970ca0d605311546741833c0`; 0 / 0 / 0           | No              |
| CB185-100                                                     | `197804dd-3250-4b9c-9ac7-da5a5c7d281a` | 200 / authoritative                | `8ea7e5079248b79dcc3eae96612d2235c41df697e9187dc9762653b155fe6b3c`                           | `review-package.39f22bf488906855912f719b`; 18 / 18 / 18        | No              |
| SG200                                                         | `a53e7c35-f73b-49d3-b3a5-3e285bdb7630` | 200 / authoritative                | `1a64f73e519c545488846ea07b469526827b0bdd3c96ff3454b50250700b41e0`                           | `review-package.b0b25193abb4b4b91f32f26f`; 1 / 1 / 1           | No              |
| CRUISE 65 ELEGANCE SILVER                                     | `86cd53bc-bfdc-4339-9bd2-7931a1770091` | 200 / non-authoritative            | `47f8eef2970f26c6a78eb961d98a41ff568521ab10f60175af67a13e88d3d14f` (human-verification page) | No package; acquisition failed                                 | No              |
| 4008-131-E65                                                  | `f9d78a48-0a04-4746-b0cf-fc5c8b91819e` | 200 / authoritative                | `555800608532d7db1f20a7ee68590317175842de6619e6c0fe79bc047b8a5141`                           | `review-package.5e282554ac27ac5f1422c8f2`; 27 / 14 / 14        | No              |
| Air Top 2000 STC                                              | `5de01ba5-1850-4eff-b77e-abfeea3d5a56` | 200 / authoritative                | `a22880bce4efe78841302cc6081ec527c0bb34854f1ae439360a21fccd31f273`                           | `review-package.a172d4f2cfbb8bd417daf34e`; 0 / 0 / 0           | No              |
| 100W Lightweight Flexible Solar Panel                         | `30f62430-ddc2-46f5-b75f-f5690fb8559f` | No HTTP status / failed            | No digest; response exceeded the existing 2,000,000-byte HTML transport limit                | No package; acquisition failed                                 | No              |

Across the batch, 274 source captures were recorded: 256 authoritative, 12
non-authoritative, and 6 failed. Preparation produced 208 QualifiedFacts and
195 semantic proposals; 169 review-package items remain unresolved and no
conflicts were asserted. Five review-ready packages have no QualifiedFacts,
while only the two Battle Born battery jobs have projected candidates. These
counts describe pipeline output, not reviewed product truth or selector
eligibility. No raw source bodies or extracted prose were added to this document.

### Human-review and verification boundary

Every prepared package still requires human review of exact identity, source
applicability, semantics, provenance, and unresolved dispositions. Empty packages
and the three failed jobs are not positive product evidence; do not infer that
the product lacks a specification. No human decision has been recorded, and no
canonical product data has changed.

Promotion writes `unverified`, and Phase 5 continues to accept only verified
engineering evidence. The architecture repair adds an explicit, separate
trusted-local operator verification action after an approved successful
canonical write. It binds exact record content, lineage, policy, audit label and
promotion origin; changed content requires re-verification. Operator labels are
unauthenticated. None of the original batch jobs has used this lifecycle. See
[the architecture repair](INGESTION_ARCHITECTURE_REPAIR.md).

### Reproduction commands

The workspace build passed with `npm.cmd run build`. The isolated operator API
was started with `npm.cmd run start:ingestion-api`, setting
`INGESTION_API_PORT=4319`, `INGESTION_JOB_ROOT` and `INGESTION_BATCH_ROOT` to
the isolated directory above, `INGESTION_REPOSITORY_ROOT` to the repository
root, and `INGESTION_ADMIN_ORIGIN=http://127.0.0.1:5175`. The review UI was
started with `INGESTION_API_PORT=4319 npm.cmd run dev --workspace
@expedition/ingestion-admin -- --port 5175`. The batch used
`POST /api/ingestion/batches` followed by
`POST /api/ingestion/batches/23345c90-2e8e-40a5-abba-a740102ca412/prepare`.
The API's existing operator policy was unchanged: discovery depth 1, at most 50
discovered candidates and 20 candidate captures per intake, plus its seed.

The preceding tables record the frozen preparation baseline. The batch, jobs,
source captures, and review packages are ignored local runtime data, not
redistributable product records. No original-job review decision, approval,
finalization, promotion, canonical write, verification, selector-coverage run,
or Phase 7 work has occurred. Architecture implementation and isolated synthetic
validation are described below; they do not rewrite this baseline.

## Historical corrected-v2 architecture repair: offline comparison

The current bridge was replayed over exact TEMP copies of all 20 original jobs
and the batch. The harness validates durable envelopes, recomputes unchanged
source-native F, repeats semantic/candidate projection deterministically, replays
qualification over retained extractions, and checks copied bytes. Original
evidence remains frozen. Raw captured response bodies are unavailable; no source
was refetched and no extraction-from-bytes improvement is claimed.

| Product                         |        QualifiedFacts | Required dispositions before → after | Mapped after | Projected proposals after |
| ------------------------------- | --------------------: | -----------------------------------: | -----------: | ------------------------: |
| MultiPlus-II 48/3000/35-32 230V |                     0 |                                0 → 0 |            0 |                         0 |
| TS-MPPT-60                      |                    19 |                              19 → 14 |            5 |                         0 |
| BCDC1240D                       |                    29 |                              29 → 29 |            0 |                         0 |
| BB10012                         |                    16 |                                5 → 9 |            9 |                         8 |
| ST Blade Fuse Block             | 0; acquisition failed |                                0 → 0 |            0 |                         0 |
| PICO Battery Monitor            |                     0 |                                0 → 0 |            0 |                         0 |
| CoolMatic CRX 50 E              |                     0 |                                0 → 0 |            0 |                         0 |
| SEC-1230UL                      |                     8 |                                6 → 7 |            0 |                         0 |
| BCDC1225D                       |                    29 |                              29 → 29 |            0 |                         0 |
| BBGC3                           |                    15 |                                4 → 8 |            9 |                         8 |
| PST-2000-24                     |                    10 |                                8 → 9 |            0 |                         0 |
| TS-MPPT-30                      |                    19 |                              19 → 14 |            5 |                         0 |
| FREEDOM XC PRO 3000             |                    17 |                              17 → 17 |            0 |                         0 |
| PD9345                          |                     0 |                                0 → 0 |            0 |                         0 |
| CB185-100                       |                    18 |                              18 → 18 |            0 |                         0 |
| SG200                           |                     1 |                                1 → 1 |            0 |                         0 |
| CRUISE 65 ELEGANCE SILVER       | 0; acquisition failed |                                0 → 0 |            0 |                         0 |
| 4008-131-E65                    |                    27 |                              14 → 14 |            0 |                         0 |
| Air Top 2000 STC                |                     0 |                                0 → 0 |            0 |                         0 |
| Renogy 100W flexible panel      | 0; acquisition failed |                                0 → 0 |            0 |                         0 |
| **Total**                       |               **208** |                        **169 → 169** |       **28** |                    **16** |

The corrected replay has 197 proposals: 28 mapped, 76 unsupported, 92 unresolved
and one evidence-only. The pre-correction milestone had 55 mapped, 65 unresolved,
142 human dispositions, five provisional candidates and 45 projected proposals.
The correction preserves previously ignored context evidence, withholding 27
formerly mapped proposals. Context text can contain extraction-profile provenance;
it cannot automatically become manufacturer rating conditions. The two battery
candidates now project 16 proposals in total; none is approved or verified.
Morningstar's ten mapped ratings still cannot project without publisher metadata.

The complete v2 TEMP pressure report classifies all 169 remaining dispositions:
132 unrecognized source-vocabulary fallbacks, two recognized value/unit cases,
34 recognized context/applicability cases, and one evidence-only item. Seven
context cases also retain a value/unit reason. No conflict or unclassified row
occurs here. No reviewed schema/model gap is asserted; absent mapper rules do not
prove gaps, and this frozen input has no human-reviewed decisions. Every row
retains product/job/proposal identity, labels, target, disposition, concept/rule,
review reasons and projection diagnostics. A complete human-readable table and
JSON accompany the correction handoff, so repetitive vocabulary remains visible.

Qualification replay still yields 208 facts and the same five empty packages.
The three acquisition failures remain separate from semantic failures. Remaining
unrecognized labels need a reviewed interpretation or an explicit human
disposition; unresolved values/units/context stay unresolved. Zero facts does
not mean zero specifications. See [the implementation and governance record](INGESTION_ARCHITECTURE_REPAIR.md)
for generic vocabulary, exact model/part evidence, legacy replay, local authority,
and limitations. No third-party bodies or extracted prose are imported here.

## Current context-typed/workload-closure comparison

The v8/v3 replay preserves all historical results above. All 208 frozen facts stay
unchanged; old untyped context cannot be upgraded from wording. Of 197 proposals,
14 are mapped, 55 unsupported, 114 unresolved and 14 evidence-only. The 183
non-mapped proposals include 13 exact automatic retained-evidence classifications
and 170 actual required human dispositions. No current candidate package or
proposal projects: publisher metadata blocks the ten Morningstar mappings and
withheld contextual inputs block battery derivations. Candidate absence is a
projection limitation, not a statement that the products are incompatible.

| Product / job                                                                                                             | Facts | Human corrected v2 → current | Mapped | Automatic retained | Non-mapped | Projected |
| ------------------------------------------------------------------------------------------------------------------------- | ----: | ---------------------------: | -----: | -----------------: | ---------: | --------: |
| Victron Energy / MultiPlus-II 48/3000/35-32 230V / `d6329cc8-4b54-4ec5-affe-104c37975c0e`                                 |     0 |                        0 → 0 |      0 |                  0 |          0 |         0 |
| Morningstar / TS-MPPT-60 / `e549f6f5-9211-49ea-b421-632f44faea51`                                                         |    19 |                      14 → 13 |      5 |                  1 |         14 |         0 |
| REDARC / BCDC1240D / `206040ff-7e75-4b9a-b00e-5ca5fcba248f`                                                               |    29 |                      29 → 26 |      0 |                  3 |         29 |         0 |
| Battle Born Batteries / BB10012 / `dc95eb21-2b28-448b-ae28-972d41e828ac`                                                  |    16 |                       9 → 16 |      2 |                  0 |         16 |         0 |
| Blue Sea Systems / ST Blade Fuse Block - 12 Circuits with Negative Bus and Cover / `95efd8a5-3c15-4cc7-9d66-dc0cb71b1b60` |     0 |                        0 → 0 |      0 |                  0 |          0 |         0 |
| Simarine / PICO Battery Monitor / `60c39501-bd4f-4efc-9706-2d458cc29eea`                                                  |     0 |                        0 → 0 |      0 |                  0 |          0 |         0 |
| Dometic / CoolMatic CRX 50 E / `9d9b78ee-ad5a-432e-af59-4224a7572b5a`                                                     |     0 |                        0 → 0 |      0 |                  0 |          0 |         0 |
| Samlex America / SEC-1230UL / `05d11b4f-6a4e-4412-8304-36ba62421a84`                                                      |     8 |                        7 → 7 |      0 |                  0 |          7 |         0 |
| REDARC / BCDC1225D / `f9743b3d-5860-417f-9735-5a0255af7fca`                                                               |    29 |                      29 → 26 |      0 |                  3 |         29 |         0 |
| Battle Born Batteries / BBGC3 / `feabf403-f123-414c-bc6c-95b247fbf36a`                                                    |    15 |                       8 → 15 |      2 |                  0 |         15 |         0 |
| Samlex America / PST-2000-24 / `6b523a87-8652-453a-99c4-177eba82ee2a`                                                     |    10 |                        9 → 9 |      0 |                  0 |          9 |         0 |
| Morningstar / TS-MPPT-30 / `35a95970-60dd-4fdb-b3f1-d35a4276d357`                                                         |    19 |                      14 → 13 |      5 |                  1 |         14 |         0 |
| Xantrex / FREEDOM XC PRO 3000 / `8cdceb45-8a2e-4843-a1c5-9b9e9ab88a97`                                                    |    17 |                      17 → 17 |      0 |                  0 |         17 |         0 |
| Progressive Dynamics / PD9345 / `a36d5d5d-c4e8-44f2-b7be-a81863819ad9`                                                    |     0 |                        0 → 0 |      0 |                  0 |          0 |         0 |
| Eaton / CB185-100 / `197804dd-3250-4b9c-9ac7-da5a5c7d281a`                                                                |    18 |                      18 → 14 |      0 |                  4 |         18 |         0 |
| Balmar / SG200 / `a53e7c35-f73b-49d3-b3a5-3e285bdb7630`                                                                   |     1 |                        1 → 1 |      0 |                  0 |          1 |         0 |
| Indel B / CRUISE 65 ELEGANCE SILVER / `86cd53bc-bfdc-4339-9bd2-7931a1770091`                                              |     0 |                        0 → 0 |      0 |                  0 |          0 |         0 |
| Pentair / 4008-131-E65 / `f9d78a48-0a04-4746-b0cf-fc5c8b91819e`                                                           |    27 |                      14 → 13 |      0 |                  1 |         14 |         0 |
| Webasto / Air Top 2000 STC / `5de01ba5-1850-4eff-b77e-abfeea3d5a56`                                                       |     0 |                        0 → 0 |      0 |                  0 |          0 |         0 |
| Renogy / 100W Lightweight Flexible Solar Panel / `30f62430-ddc2-46f5-b75f-f5690fb8559f`                                   |     0 |                        0 → 0 |      0 |                  0 |          0 |         0 |

The complete TEMP audit includes all 109 previous groups, all 114 current
groups, 170 human rows, 13 automatic-retention rows, 14 mapped rows and eight
stage limitations. Human work separates 118 interpretation/accountability
items, two value/unit cases and 50 context/applicability cases. No true conflict
or reviewed schema/model gap is asserted in this replay. Exact policy/rule/source
identities and per-proposal diagnostics remain in the full report. Five empty
review-ready packages and three acquisition failures are preserved. These counts
are diagnostics and establish no engineering authority. See
[the producer, rule and workload contract](INGESTION_CONTEXT_WORKLOAD.md).
