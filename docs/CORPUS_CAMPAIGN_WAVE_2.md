# Corpus Campaign Wave 2

Date: 2026-09-29. Starting HEAD: `9a75c1af96e69241546e6c51bb204061919aa3be`.

## Selection recorded before production network execution

Exactly 12 new products; four returning and eight new manufacturers; 12 roles. Source patterns below are hypotheses, not reviewed facts. MPN absent means unknown. Official listing identities were checked using manufacturer web sources; listing does not guarantee availability. Morningstar uses a different model column on the same family page, as expressly allowed by the campaign.

|Manufacturer|Model|MPN|Official URI|Role|Wave 1 manufacturer|Reason|Expected source shape|Hypothesized mechanism|
|---|---|---|---|---|---|---|---|---|
|REDARC|BCDC1225D|BCDC1225D|https://www.redarcelectronics.com/us/dual-input-25a-in-vehicle-dc-battery-charger|DC-DC/alternator charger|yes|Different charger; existing profile generalization|HTML table + linked PDFs|redarc.web.acquisition-profile|
|Battle Born Batteries|BBGC3|BBGC3|https://battlebornbatteries.com/products/270ah-12v-gc3-lifepo4-deep-cycle-batteries|LiFePO4 battery/BMS|yes|Different battery and variants; existing profile generalization|HTML specification tables + application state|battle-born-batteries.web.acquisition-profile|
|Samlex America|PST-2000-24|PST-2000-24|https://samlexamerica.com/products/2000-watt-pure-sine-wave-inverter-pst-2000-24/|inverter|yes|Different role and 24 V model; existing profile generalization|BR-delimited specifications + multiple PDFs|samlex-america.web.acquisition-profile|
|Morningstar|TS-MPPT-30|TS-MPPT-30|https://www.morningstarcorp.com/products/tristar-mppt/|MPPT controller|yes|Different exact family column; 12/24/48 V exposure|Model-column matrix + PDF-heavy documentation|model-column-scope.v1|
|Xantrex|FREEDOM XC PRO 3000|818-3010|https://xantrex.com/products/inverter-chargers/freedomxcpro/fxcpro-3000/|inverter/charger|no|New manufacturer; conditional electrical specifications|Exact page with specification structures + PDFs|No reviewed profile; structural qualifiers may apply|
|Progressive Dynamics|PD9345|PD9345|https://www.progressivedyn.com/pd9300/|AC charger/converter|no|Current converter family with retail suffix distinction|Family row tables + manuals and charging-mode PDFs|Exact-row qualification may apply|
|Eaton|CB185-100|CB185-100|https://www.eaton.com/us/en-us/skuPage.CB185-100.html|breaker/protection|no|48 V rated circuit protection; new enterprise source|Exact SKU page; dynamic application state + specification resources|No reviewed profile; structural qualifiers may apply|
|Balmar|SG200|SG200|https://balmar.net/product/sg200/|battery monitor|no|New monitor manufacturer; related technical family resource|Sparse exact page + linked technical resources|Exact-row qualification may apply|
|Indel B|CRUISE 65 ELEGANCE SILVER|unknown|https://www.indelb.com/us/product/cruise-65-elegance-silver/|DC refrigerator|no|Mobile/marine appliance; 12/24 V source exposure|Exact product page; HTML attributes + application data|No reviewed profile; structural qualifiers may apply|
|Pentair|4008-131-E65|4008-131-E65|https://www.pentair.com/en-us/flow/shurflo/shurflo-products/shurflo-rv-applications/water-delivery-pumps/shurflo-revolution-4008-series-by-pass-pump.html|water pump|no|24 V pump; aftermarket/OEM identity distinction|Family row specifications + several technical PDFs|Exact-row qualification may apply; prefixed identities uncertain|
|Webasto|Air Top 2000 STC|unknown|https://www.webasto.com/en-int/heating/air-heater/air-top-2000-stc.html|heater electrical control/load|no|Mobile heater; variants and electrical versus thermal power boundary|List specifications; image variant chart + PDFs|No reviewed profile; family ambiguity expected|
|Renogy|100W Lightweight Flexible Solar Panel|RNG-100DB-H-US|https://www.renogy.com/products/100-watt-12-volt-flexible-monocrystalline-solar-panel|solar module|no|Mobile source-side module; STC conditions|Shopify application JSON + label/value specs + downloads|No reviewed profile; exact structured-record mechanics may fit|


## Execution and preflight

Branch `feat/production-corpus-ingestion`; primary and only active worktree `C:/Users/Bearded Bucket/Documents/GitHub/expedition-electrical-paltform`. Starting and final HEAD/local feature/origin feature refs: `9a75c1af96e69241546e6c51bb204061919aa3be`. Preflight commands were run exactly as requested; status contained only the two protected untracked paths. Neither protected path was read or used. No branch/worktree change occurred.

The selection table above was written before the first production network batch. Exactly twelve new models, four returning manufacturers and eight new manufacturers were submitted. The same twelve intake definitions and stored child order were used for acceptance. No individual child retry, replacement or reset occurred. Exactly two network batches ran: observation and post-recovery acceptance. Manufacturer identity/listing verification through web search preceded ingestion; that research did not create ingestion evidence. MPNs are intake requests, not verified facts. No stock/availability claim is made.

The harness calls production `IngestionBatchService.createBatch/prepareBatch`, `IngestionJobService`, file stores, `HttpSourceCaptureAdapter`, and reviewed repository profiles. It follows discovery, acquisition, capture, extraction, qualification, whole-intake reconciliation, proposals, candidate bridge and review-package preparation. It records no review decision. Default transport/parser limits remained unchanged. Policy: depth one, fifty distinct discovered resources, twenty candidate captures plus seed, retained snapshots using production `LocalSnapshotStore`. These are existing conservative operating bounds, not electrical safety requirements. Occurrence counts include duplicate provenance and can exceed fifty. Capture success, authoritative disposition, complete extraction, resolved applicability and mapped semantics remain separate stages.

Unrestricted network execution was approved before observation because the prior Wave 1 campaign documented that restricted execution could not reach the sources. No failed restricted-network batch was created in Wave 2. Temporary harnesses and ordinary manufacturer snapshots remain in ignored `.tmp/` and `.local-ingestion/`; their retention does not authorize redistribution. Only source metadata, short labels and counts appear in this report.

## Batch outcomes and child identities

Observation **c920b08f-58f2-4b4f-993f-26b53e359c48**: mixed, 10 review_ready / 2 preparation_failed. Acceptance **95f55af5-d480-4270-9e5c-45839ab15f32**: mixed, 10 review_ready / 2 preparation_failed. Requested/stored counts were 12/12 for both; all approval/finalization/pending/other counts were zero.

| Model | Observation child | Acceptance child | Lifecycle (both) | Acquisition (acceptance) |
| --- | --- | --- | --- | --- |
| BCDC1225D | be1d7d7f-1e44-4283-9de3-21fa5c00b726 | 98001613-a6ad-401d-a7c6-655624f7c595 | review_ready | partially_acquired |
| BBGC3 | dce563c3-9993-4607-b477-d6f34c566bac | 7fda82b6-5961-4ec4-9ff7-d63ded8c18d2 | review_ready | acquired |
| PST-2000-24 | 9437c692-27cd-4e79-b027-0ed1444429f8 | ef213219-6278-4dad-a570-355e1847ab87 | review_ready | acquired |
| TS-MPPT-30 | 09b0a3b4-f0b5-4785-b740-025f23dbb89d | 1390c9d8-edbf-44c7-ae3c-fc49cdfa3480 | review_ready | acquired |
| FREEDOM XC PRO 3000 | a354c46d-e4f4-4181-925b-4e9a8129654b | 3b5ecd84-d2b4-469a-ac82-65bb98dc95e1 | review_ready | partially_acquired |
| PD9345 | 5f4d87a7-6cd8-4825-ae61-ac5da522fb3c | 29a147f7-1709-4c39-b6d1-9f2f3c3b817b | review_ready | partially_acquired |
| CB185-100 | ec12bf28-c486-4a0a-9b14-fee29a767f37 | 9bdf1b43-ae94-41bf-8c4e-664ada7beb63 | review_ready | partially_acquired |
| SG200 | 8470e4eb-98c6-4d8a-a30d-f8b2760c9321 | 2f25b144-7c75-4cd6-9ceb-45096294aaf5 | review_ready | partially_acquired |
| CRUISE 65 ELEGANCE SILVER | 0ceb48c6-8f77-437c-bce3-415fa462d646 | 13de8ba0-49d8-46fb-a226-801ebd0077a2 | preparation_failed | seed_failed |
| 4008-131-E65 | 2ac940ec-79f0-4bb2-af9f-d51497d6e39a | 93ce7e7f-ec05-4d16-8efc-158d3fdbcd47 | review_ready | acquired |
| Air Top 2000 STC | 121e9b5d-8286-4d77-a399-10caccb9982c | c8380e77-946b-4d2d-81d6-74c01b9beab2 | review_ready | acquired |
| 100W Lightweight Flexible Solar Panel | cbd4bf28-c314-43cc-b793-fb980138afac | 432d777d-01a2-4c0d-b23c-1e8e988d3844 | preparation_failed | unresolved_officiality |

Indel B failed before later Pentair and Webasto children prepared; Renogy failed last. No stuck preparing job, uncaught batch exception, cross-child abort or storage failure was observed. Review_ready means an evidence/diagnostic review package exists, not that canonical promotion is permitted.

## Acquisition and capture accounting

Selected resources exclude the seed; capture attempts/artifacts include it. Successful transport includes non-authoritative content. Observed bytes include failed response bodies and the terminal streamed chunk crossing a limit. Null response/media metadata remain unknown. Eaton HTTP/HTTPS catalog resources were distinct discovered URIs, not harness retries.

### Observation

| Model | Discovered occurrences | Selected | Attempts | Transport success / failed | Authoritative | Observed bytes |
| --- | --- | --- | --- | --- | --- | --- |
| BCDC1225D | 62 | 10 | 11 | 10 / 1 | 10 | 1865286 |
| BBGC3 | 195 | 20 | 21 | 21 / 0 | 21 | 11004728 |
| PST-2000-24 | 91 | 20 | 21 | 21 / 0 | 21 | 20668855 |
| TS-MPPT-30 | 81 | 20 | 21 | 21 / 0 | 21 | 27731681 |
| FREEDOM XC PRO 3000 | 46 | 20 | 21 | 21 / 0 | 20 | 4373113 |
| PD9345 | 23 | 15 | 16 | 16 / 0 | 15 | 33525281 |
| CB185-100 | 19 | 12 | 13 | 11 / 2 | 11 | 8707004 |
| SG200 | 19 | 10 | 11 | 11 / 0 | 6 | 933914 |
| CRUISE 65 ELEGANCE SILVER | 0 | 0 | 1 | 1 / 0 | 0 | 52192 |
| 4008-131-E65 | 19 | 10 | 11 | 11 / 0 | 11 | 3781780 |
| Air Top 2000 STC | 4 | 2 | 3 | 3 / 0 | 3 | 715237 |
| 100W Lightweight Flexible Solar Panel | 0 | 0 | 1 | 0 / 1 | 0 | 2005223 |

Totals: 151 captures, 147 transport successes, 4 transport failures, 139 authoritative captures, 115364294 observed bytes.

### Acceptance

| Model | Discovered occurrences | Selected | Attempts | Transport success / failed | Authoritative | Observed bytes |
| --- | --- | --- | --- | --- | --- | --- |
| BCDC1225D | 62 | 10 | 11 | 10 / 1 | 10 | 1865286 |
| BBGC3 | 195 | 20 | 21 | 21 / 0 | 21 | 11002368 |
| PST-2000-24 | 91 | 20 | 21 | 21 / 0 | 21 | 20668855 |
| TS-MPPT-30 | 81 | 20 | 21 | 21 / 0 | 21 | 27731681 |
| FREEDOM XC PRO 3000 | 46 | 20 | 21 | 21 / 0 | 20 | 4373113 |
| PD9345 | 23 | 15 | 16 | 16 / 0 | 15 | 33525313 |
| CB185-100 | 19 | 12 | 13 | 11 / 2 | 11 | 8707004 |
| SG200 | 19 | 10 | 11 | 11 / 0 | 6 | 933914 |
| CRUISE 65 ELEGANCE SILVER | 0 | 0 | 1 | 1 / 0 | 0 | 52192 |
| 4008-131-E65 | 19 | 10 | 11 | 11 / 0 | 11 | 3781780 |
| Air Top 2000 STC | 4 | 2 | 3 | 3 / 0 | 3 | 715237 |
| 100W Lightweight Flexible Solar Panel | 0 | 0 | 1 | 0 / 1 | 0 | 2001521 |

Totals: 151 captures, 147 transport successes, 4 transport failures, 139 authoritative captures, 115358264 observed bytes.

## Extraction, qualification, reconciliation and proposals

Counts below include ordinary and supplementary extraction artifacts. Supplementary artifacts reuse a capture and do not add network captures. QualifiedFact is an evidence artifact type; unresolved/unscoped facts are counted honestly and are not all safely applicable product specifications. Reconciliation tuples are single observation / agreement / conflict / unresolved. Proposal tuples are mapped / unsupported / conflicting / unresolved / evidence_only. Qualified values count candidate qualified-value assertions, not ordinary direct fields.

### Observation

| Model | Extraction status / media counts | Blocks / tables | QualifiedFacts | Groups (S/A/C/U) | Proposals (M/U/C/R/E) | Qualified values |
| --- | --- | --- | --- | --- | --- | --- |
| BCDC1225D | extracted: 11; text/html: 11 | 514 / 7 | 29 | 29: 29/0/0/0 | 29: 0/26/0/3/0 | 0 |
| BBGC3 | extracted: 22; text/html: 22 | 1038 / 3 | 15 | 15: 15/0/0/0 | 15: 3/12/0/0/0 | 0 |
| PST-2000-24 | extracted: 22; text/html: 17; application/pdf: 5 | 13752 / 0 | 10 | 8: 6/0/0/2 | 8: 0/4/0/4/0 | 0 |
| TS-MPPT-30 | extracted: 21; text/html: 11; application/pdf: 10 | 12660 / 1 | 19 | 19: 0/0/0/19 | 19: 0/0/0/19/0 | 0 |
| FREEDOM XC PRO 3000 | extracted: 20; text/html: 20 | 1201 / 0 | 0 | 0: 0/0/0/0 | 0: 0/0/0/0/0 | 0 |
| PD9345 | extracted: 15; text/html: 6; application/pdf: 9 | 3318 / 8 | 0 | 0: 0/0/0/0 | 0: 0/0/0/0/0 | 0 |
| CB185-100 | extracted: 11; text/html: 8; application/pdf: 3 | 12216 / 5 | 1 | 1: 1/0/0/0 | 1: 0/1/0/0/0 | 0 |
| SG200 | extracted: 5; unsupported: 1; text/html: 5; text/xml: 1 | 26 / 7 | 1 | 1: 1/0/0/0 | 1: 0/1/0/0/0 | 0 |
| CRUISE 65 ELEGANCE SILVER | none; none | 0 / 0 | 0 | not run | not run | not run |
| 4008-131-E65 | extracted: 11; text/html: 6; application/pdf: 5 | 2081 / 3 | 27 | 14: 0/1/0/13 | 14: 0/0/0/14/0 | 0 |
| Air Top 2000 STC | extracted: 3; text/html: 1; application/pdf: 2 | 321 / 0 | 0 | 0: 0/0/0/0 | 0: 0/0/0/0/0 | 0 |
| 100W Lightweight Flexible Solar Panel | none; none | 0 / 0 | 0 | not run | not run | not run |

Totals: **102 facts, 87 groups, 87 proposals**; reconciliation single_observation: 52; unresolved: 34; agreement: 1; proposals unsupported: 44; unresolved: 40; mapped: 3; qualified values 0.

### Acceptance

| Model | Extraction status / media counts | Blocks / tables | QualifiedFacts | Groups (S/A/C/U) | Proposals (M/U/C/R/E) | Qualified values |
| --- | --- | --- | --- | --- | --- | --- |
| BCDC1225D | extracted: 11; text/html: 11 | 514 / 7 | 29 | 29: 29/0/0/0 | 29: 0/26/0/3/0 | 0 |
| BBGC3 | extracted: 22; text/html: 22 | 1038 / 3 | 15 | 15: 15/0/0/0 | 15: 3/12/0/0/0 | 0 |
| PST-2000-24 | extracted: 22; text/html: 17; application/pdf: 5 | 13752 / 0 | 10 | 8: 6/0/0/2 | 8: 0/4/0/4/0 | 0 |
| TS-MPPT-30 | extracted: 21; text/html: 11; application/pdf: 10 | 12660 / 1 | 19 | 19: 0/0/0/19 | 19: 0/0/0/19/0 | 0 |
| FREEDOM XC PRO 3000 | extracted: 21; text/html: 21 | 1205 / 0 | 17 | 17: 0/0/0/17 | 17: 0/0/0/17/0 | 0 |
| PD9345 | extracted: 15; text/html: 6; application/pdf: 9 | 3318 / 8 | 0 | 0: 0/0/0/0 | 0: 0/0/0/0/0 | 0 |
| CB185-100 | extracted: 12; text/html: 9; application/pdf: 3 | 12221 / 5 | 18 | 18: 18/0/0/0 | 18: 0/16/0/1/1 | 0 |
| SG200 | extracted: 5; unsupported: 1; text/html: 5; text/xml: 1 | 26 / 7 | 1 | 1: 1/0/0/0 | 1: 0/1/0/0/0 | 0 |
| CRUISE 65 ELEGANCE SILVER | none; none | 0 / 0 | 0 | not run | not run | not run |
| 4008-131-E65 | extracted: 11; text/html: 6; application/pdf: 5 | 2081 / 3 | 27 | 14: 0/1/0/13 | 14: 0/0/0/14/0 | 0 |
| Air Top 2000 STC | extracted: 3; text/html: 1; application/pdf: 2 | 321 / 0 | 0 | 0: 0/0/0/0 | 0: 0/0/0/0/0 | 0 |
| 100W Lightweight Flexible Solar Panel | none; none | 0 / 0 | 0 | not run | not run | not run |

Totals: **136 facts, 121 groups, 121 proposals**; reconciliation single_observation: 69; unresolved: 51; agreement: 1; proposals unsupported: 59; unresolved: 58; mapped: 3; evidence_only: 1; qualified values 0.

### Qualification and parser diagnostics

| Model | Observation qualification diagnostics | Acceptance qualification diagnostics | Acceptance extraction diagnostics |
| --- | --- | --- | --- |
| BCDC1225D | source_not_qualifiable: 10; applicability_unresolved: 7 | source_not_qualifiable: 10; applicability_unresolved: 7 | none |
| BBGC3 | source_not_qualifiable: 21; applicability_unresolved: 3 | source_not_qualifiable: 21; applicability_unresolved: 3 | none |
| PST-2000-24 | source_not_qualifiable: 21 | source_not_qualifiable: 21 | table_extraction_unsupported: 5 |
| TS-MPPT-30 | source_not_qualifiable: 20 | source_not_qualifiable: 20 | table_extraction_unsupported: 10 |
| FREEDOM XC PRO 3000 | source_not_qualifiable: 20 | source_not_qualifiable: 20; unsupported_structure: 2 | none |
| PD9345 | source_not_qualifiable: 15; applicability_unresolved: 8 | source_not_qualifiable: 15; applicability_unresolved: 8 | table_extraction_unsupported: 9 |
| CB185-100 | applicability_unresolved: 4; source_not_qualifiable: 10 | applicability_unresolved: 4; source_not_qualifiable: 10 | table_extraction_unsupported: 3 |
| SG200 | source_not_qualifiable: 5; applicability_unresolved: 6 | source_not_qualifiable: 5; applicability_unresolved: 6 | unsupported_media_type: 1 |
| CRUISE 65 ELEGANCE SILVER | none | none | none |
| 4008-131-E65 | source_not_qualifiable: 9; applicability_unresolved: 9 | source_not_qualifiable: 9; applicability_unresolved: 9 | table_extraction_unsupported: 5 |
| Air Top 2000 STC | source_not_qualifiable: 3 | source_not_qualifiable: 3 | table_extraction_unsupported: 2 |
| 100W Lightweight Flexible Solar Panel | none | none | none |

All retained authoritative HTML/PDF extraction completed without parser failures or parser input/page/item/text/cell bound crossings. PDF text-only extraction explicitly reports `table_extraction_unsupported`. Balmar oEmbed XML is `unsupported_media_type`, with no inferred facts. CSS/JSON captures classified `content_type_mismatch` and challenge pages do not enter qualification. Renogy crossed a transport HTML limit, not a parser-input limit. No OCR or PDF geometry inference occurred.

### Exact mechanisms and generalization

| Model | Acceptance facts | Mechanism / reviewed rule or profile | Scope and material limits |
| --- | --- | --- | --- |
| BCDC1225D | 29 | reviewed-html-page-scope.v1 / redarc.web.acquisition-profile / exact-product-specification-table | Unchanged Wave 1 SKU selector and specification table; all exact MPN scope. |
| BBGC3 | 15 | reviewed-html-page-scope.v1 / battle-born-batteries.web.acquisition-profile / exact-product-specification-tables | Unchanged profile; exact visible default BBGC3 SKU. No other selected/heated/smart variant gets this scope. |
| PST-2000-24 | 10 | reviewed-html-page-scope.v1 / samlex-america.web.acquisition-profile / exact-product-specification-lines | Unchanged Specifications heading and BR-delimited mechanism; input/mode context retained. |
| TS-MPPT-30 | 19 | production-qualified-fact / model-column-scope.v1 | Same generic matrix path, exact different target column. Source footnote/separator context stays unresolved where required. |
| FREEDOM XC PRO 3000 | 17 | reviewed-html-page-scope.v1 / xantrex.web.acquisition-profile / exact-model-specification-rows | New generic model_label_value_rows; 10 inverter + 5 charger + 2 regulatory facts. General specifications region rejects Part Number identity axis; accessory header rejects. All section headings preserved as material qualifiers. |
| CB185-100 | 18 | 17 reviewed-html-page-scope.v1 / eaton.web.acquisition-profile / exact-product-specification-tables; 1 existing production-qualified-fact exact target row | New profile; existing ordinary row observation is an unsupported table-label observation, not a technical electrical assertion. |
| SG200 | 1 | production-qualified-fact / exact target-row qualification | Manual-index identity/description observation only, not monitor electrical consumption. |
| 4008-131-E65 | 27 | production-qualified-fact / exact target-row qualification and unresolved source-native row observations | 18 exact target technical observations across three source tables; 9 unresolved navigation observations remain unresolved. Voltage/current rows have missing cell units, so neither bare 24 nor bare 4 is silently assigned a unit. |

REDARC, Battle Born, Samlex and Morningstar all generalized without edits to their source profiles, field mappings or qualifier mechanisms. Xantrex and Eaton demonstrate bounded profile extension into new manufacturers. No manufacturer/model/product-ID source-code conditional was added.

### Zero-fact products

| Product | Exact reason | Disposition |
| --- | --- | --- |
| PD9345 | Family table uses compound PD9345(V), with explicit retail suffix meaning; resources contain combined model lists. No unique exact row/column for PD9345. PDF text has no supported table semantics. | LEGITIMATE UNSUPPORTED CONTENT; no suffix stripping or inferred variant membership. |
| CRUISE 65 ELEGANCE SILVER | Seed HTTP 200, 52,192 bytes, non_authoritative challenge_detected; seed_failed acquisition, no extraction. | SOURCE-SPECIFIC LIMITATION; no bypass or retailer substitution. |
| Air Top 2000 STC | Family list and image variant overview have no safely bound reviewed exact technical region; bare PDF text is unsupported qualification content. | LEGITIMATE UNSUPPORTED CONTENT; no asserted exact fuel/voltage/control variant. |
| 100W Lightweight Flexible Solar Panel | HTML seed response_too_large: observation 2,005,223 streamed bytes, acceptance 2,001,521; existing 2,000,000-byte HTML allowance. No complete payload/snapshot or extraction. | SOURCE-SPECIFIC LIMITATION at existing supported transport boundary; no arbitrary budget increase. |

## Findings and classifications

| ID | Classification | Stage ownership / evidence | Resolution |
| --- | --- | --- | --- |
| W2-01 | GENERIC CAPABILITY GAP | Xantrex explicit model-headed two-cell DIV row structures were captured completely but produced zero facts. | Repaired with declarative model_label_value_rows and identity_region narrowing; 17 facts on retained bytes and acceptance. |
| W2-02 | PROFILE / DECLARATIVE COVERAGE GAP | Eaton exact SKU heading and structurally simple specification tables captured; only an ordinary label observation qualified. | Added reviewed Eaton source mechanics; 17 additional facts with unchanged existing table mechanism. |
| W2-03 | LEGITIMATE UNSUPPORTED CONTENT | PD9345(V), combined model lists, heater family variants, Xantrex general Part Number axis and accessory table. | Conservative boundaries retained; no family/suffix/layout inference. |
| W2-04 | SOURCE-SPECIFIC LIMITATION | Indel B challenge; Renogy HTML bound; two Eaton catalog URIs response_too_large; REDARC training HTTP 404. | Failures isolated and recorded; unchanged transport limits, no retries/bypass. |
| W2-05 | SOURCE-SPECIFIC LIMITATION | Xantrex seed/document UI did not expose PDF resources admitted by static discovery; Balmar exact seed lacks bound electrical specs. Navigation and document indexes consume bounded resources. | Report actual acquired media, not researched PDFs as captured evidence. No script execution or unreviewed domain allowance. |
| W2-06 | LEGITIMATE UNSUPPORTED CONTENT | PDFs are text-only; Balmar XML unsupported; CSS/JSON content-type mismatch diagnostics. | Explicit media contracts preserved. |
| W2-07 | FUTURE PRODUCT/ENGINEERING MODEL | Source-native labels, conditional domains, STC, BMS, heater thermal/electrical distinctions, pump units and installer constraints require established downstream semantics. | No field-map expansion, confidence scoring, condition flattening or engineering/recommendation logic. |

No existing intended implementation defect was demonstrated. W2-01 and W2-02 were repaired in this conversation; no remaining demonstrated generic defect was deferred into a micro-task. Unsupported/unresolved proposals are not qualification failures and no mappings were added to improve counts. No real-corpus conflict was observed; this is not evidence that every source agrees. Existing conflict/review guards pass synthetic regression tests.

## Implementation, profile review and tests

Changed `profile-qualified-evidence.ts`, `manufacturer-acquisition.ts`, the additive acquisition-profile JSON schema, and two new declarative profiles. `identity_region` requires exactly one source container with one exact reviewed heading before visible identity comparison. The model-row contract requires one sole first two-cell header, empty first header cell, exact model second cell, all rows directly owned by the container, exactly two direct cells per row, and the same exact source model attribute on every value. Third cells, nested rows/cells, spans, identity axes, late/duplicate headers, outside text and omitted element children reject the entire region before facts are emitted. Missing values remain unknown. Context requires a unique enclosing reviewed container/heading and remains a material qualifier. Two is structural label/value arity, not a performance quota; no limits or dependencies changed. Existing completeness, byte-digest and source/capture/acquisition/profile ownership gates still apply.

Profile version 1.4 is additive; older profiles remain readable. Eaton publisher/manufacturer and official domain are preserved; identity uses the exact native SKU heading, specification regions exclude distributor tables. Xantrex identity is narrowed to the inverter specification section and compares the native model header; each admitted region independently repeats that target model, excluding accessories and sibling products. Profile source hashes below identify the reviewed observation bytes, not reviewed product facts.

| Profile | Observed official seed | Observed content digest |
| --- | --- | --- |
| eaton.web.acquisition-profile | https://www.eaton.com/us/en-us/skuPage.CB185-100.html | sha256:ca8e1f4a868c0410e29148e733f8451bcf13dffc74c0a6d8c424c65d47f976f9 |
| xantrex.web.acquisition-profile | https://xantrex.com/products/inverter-chargers/freedomxcpro/fxcpro-3000/ | sha256:3d1dffd8a6b27b659b046518120703cb4b52b1ffd8fc02c1394fcdfaeeb73633 |

Added 16 deterministic synthetic regression cases to `coverage-recovery.test.ts` (73 total): actual profile use on two synthetic models/SKUs, exact scope and source locators, deterministic results, material headings/temperature context, malformed/competing structures and atomic rejection, empty values, sibling/accessory exclusion and schema requirements. Permanent tests contain no manufacturer documents. Documentation/comments in `ARCHITECTURE.md` and source types/parser record the structural invariant, rejection semantics, scope/ownership boundaries, context preservation and existing shared bounds.

Focused suite passed after fixing its fixture loader to match the repository test environment. The first sandbox test invocation could not load Vitest configuration due to Windows directory permissions; unrestricted test execution was then approved. Final ingestion/runtime suites: **54 files / 1,332 tests passed**. Build passed; lint with `.tmp/**` ignored passed; format check passed after formatting only the changed test; diff check passed. No validate:data command was needed: focused actual-profile schema tests cover this additive contract. No package-lock/dependency change.

## Offline replay evidence

Observation preparation was replayed before fixes: every available stored extraction, qualification, fact set, reconciliation, proposals, bridge and review package reproduced identically. After fixes, ALL ten prepared Wave 2 products were rebuilt twice from retained, digest-verified bytes using production extraction/qualification/supplementary/reconciliation/proposal/bridge/package APIs. New profiles were explicitly rebound in new offline acquisition artifacts; original acquisitions, captures, bytes and jobs were not rewritten. Changed configuration necessarily changes dependent evidence/package digests. Unaffected product package digests remained exactly equal to observation. Source byte digests never changed during replay.

| Model | Offline recovered facts / groups / proposals | Two complete rebuilds identical | Acceptance stored-output replay identical | Acceptance replayed authoritative sources |
| --- | --- | --- | --- | --- |
| BCDC1225D | 29 / 29 / 29 | true | true | 10 |
| BBGC3 | 15 / 15 / 15 | true | true | 21 |
| PST-2000-24 | 10 / 8 / 8 | true | true | 21 |
| TS-MPPT-30 | 19 / 19 / 19 | true | true | 21 |
| FREEDOM XC PRO 3000 | 17 / 17 / 17 | true | true | 20 |
| PD9345 | 0 / 0 / 0 | true | true | 15 |
| CB185-100 | 18 / 18 / 18 | true | true | 11 |
| SG200 | 1 / 1 / 1 | true | true | 6 |
| CRUISE 65 ELEGANCE SILVER | 0 / not run / not run | not available | not available | 0 |
| 4008-131-E65 | 27 / 14 / 14 | true | true | 11 |
| Air Top 2000 STC | 0 / 0 / 0 | true | true | 3 |
| 100W Lightweight Flexible Solar Panel | 0 / not run / not run | not available | not available | 0 |

147 retained capture snapshots verified in observation and 147 in acceptance, including non-authoritative challenge/media content. Renogy has no complete retained payload to replay. Indel B has digest-verified challenge bytes but no authoritative extraction/preparation; it is not reported as a successful empty downstream replay. Acceptance replay used zero network fetches and matched stored output completely for all ten prepared products.

| Wave 1 model | Sources replayed | All stored outputs identical |
| --- | --- | --- |
| MultiPlus-II 48/3000/35-32 230V | 20 | true |
| TS-MPPT-60 | 21 | true |
| BCDC1240D | 13 | true |
| BB10012 | 21 | true |
| Blue Sea 5026 | 0 | unavailable seed, no replay |
| PICO Battery Monitor | 15 | true |
| CoolMatic CRX 50 E | 4 | true |
| SEC-1230UL | 21 | true |

All seven available Wave 1 acceptance preparations were rechecked, including its four nonzero products; all stored outputs identical. Wave 1 report/source evidence was not overwritten. The combined deterministic test suites also preserve Ekrano scope/qualification, structured records, model columns, exact page scope, source ownership, qualified values, read-only URI exclusion, PDF bounds and batch isolation.

## Combined corpus and ingestion exit assessment

Combined corpus: **20 distinct products and 16 manufacturers**, with at least twelve materially different roles and 12/24/48 V exposure. Wave 1 accepted 72 facts / 70 groups / 70 proposals; Wave 2 accepted 136 / 121 / 121; combined **208 facts / 191 groups / 191 proposals** across twelve nonzero products. Balmar's one observation is a manual-index identity description, so nonzero-product count is not a technical-specification coverage claim. Snapshot duplicates are not independent-source corroboration.

| Exit dimension | Evidence / practical limit | Assessment |
| --- | --- | --- |
| Batch stability / isolation | Two 12-child batches preserved order and completed 10/2 mixed; no cross-child abort/storage error. | Demonstrated. |
| Acquisition diversity | HTML, PDFs up to 30,449,484 bytes, family resources, sparse/dynamic pages, challenge, transport and media failures. | Demonstrated within documented transport/static discovery contract. |
| Extraction diversity | Complete HTML table/list/definition/line evidence and PDF text; unsupported XML explicit. | Demonstrated; no PDF table/OCR promise. |
| Qualification generalization | Four unchanged mechanisms work on different requested models; Xantrex/Eaton recovery and exact Pentair rows. | Demonstrated for reviewed forms. |
| Profile extensibility | Two source-mechanics profiles plus additive schema/row contract; no product branches. | Demonstrated, new DIV mechanism has one real manufacturer example. |
| Structured-record recovery | Permanent exact-SKU/provenance/duplicate-rejection tests pass; Wave 2 Renogy payload rejected before complete capture. | Real nonempty structured-record generalization remains unconfirmed in this 20-product corpus. |
| Variant applicability | Two Morningstar target columns across waves; no neighboring pump/charger/battery value substitution; compound PD9345(V) rejected. | Demonstrated supported boundaries; unsupported families stay explicit. |
| Replay / provenance | All ten Wave 2 preparations identical offline; all seven Wave 1 preparations unchanged; snapshots SHA-256 verified. | Demonstrated with bound source/locator/profile/config references. |
| Unsupported / conflict handling | Explicit source/media/structure diagnostics, unresolved navigation evidence, pump agreement; zero observed conflicts. | Rejection/unknown handling demonstrated; positive real conflict/qualified-value outcomes remain unobserved, synthetic guards pass. |
| Review packages | Ten acceptance packages, no approval/finalization. Three mapped proposals from BBGC3; all other dispositions retained. | Demonstrated preparation; no promotion-readiness claim. |

### BLOCKING INGESTION CLOSURE

No remaining demonstrated implementation defect or general ingestion blocker. Before claiming corpus-based closure for all supported mechanisms, two evidence checks remain: independent real-source confirmation of the new DIV model-row mechanism, and nonempty real exact-SKU structured-record qualification/generalization. This is a closure-validation gap, not a requirement to ingest every source or make every product nonzero.

### NON-BLOCKING / DEFERRED

Manufacturer challenge pages, oversized HTML/catalogs, sparse/dynamic documents, OCR/PDF geometry, unresolved family/retail suffix semantics, heater variants, domain/condition semantic expansion, monitor consumption, engineering interpretation and commercial navigation efficiency remain deferred. Source-specific inaccessibility and policy-limit rejection do not invalidate isolated successes. Conflict preservation and qualified-value guards are covered by synthetic tests; additional live conflict/qualified-value observations would strengthen evidence but no regression/blocker was demonstrated.

**Recommendation: targeted Wave 3 needed**, restricted to independent confirmation of the repaired DOM-row contract and a genuine exact-SKU structured application record with technical properties. Existing REDARC/Battle Born/Samlex/Morningstar generalization needs no repeat broad campaign. Do not expand to thirty products for its own sake. After those narrow checks, proceed to the ingestion closure pass (including the required behavior-preserving repository comment/documentation audit); no claim of completed repository-wide audit is made here.

## Selected resources and source extraction ledger

The per-product acceptance ledger records every selected capture including the seed, requested URI, transport HTTP/media/observed bytes, authoritative disposition and extraction results. Observation equivalents, every discovered occurrence, complete qualifiers/raw values, source digests and exact candidate locators remain in the ignored durable artifacts. The observation/acceptance selected URI lists were compared below; changes in live content are not nondeterministic offline parsing.

### REDARC — BCDC1225D

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://www.redarcelectronics.com/us/dual-input-25a-in-vehicle-dc-battery-charger) | 200 | text/html | 244570 | success | authoritative | extracted: 94/2; none; extracted: 2/0; none |
| [Source](https://www.redarcelectronics.com/us/bcdc-25amp-rear-install-wiring-kit) | 200 | text/html | 175542 | success | authoritative | extracted: 59/1; none |
| [Source](https://www.redarcelectronics.com/us/bcdc-25amp-across-engine-bay-wiring-kit) | 200 | text/html | 175686 | success | authoritative | extracted: 58/1; none |
| [Source](https://www.redarcelectronics.com/us/contact-us) | 200 | text/html | 126301 | success | authoritative | extracted: 19/0; none |
| [Source](https://www.redarcelectronics.com/us/go-further-with-onx-offroad) | 200 | text/html | 131971 | success | authoritative | extracted: 23/0; none |
| [Source](https://www.redarcelectronics.com/us/redarc-range) | 200 | text/html | 195952 | success | authoritative | extracted: 65/0; none |
| [Source](https://www.redarcelectronics.com/us/redvision-essentials-display) | 200 | text/html | 212982 | success | authoritative | extracted: 83/1; none |
| [Source](https://www.redarcelectronics.com/us/smart-battery-monitor) | 200 | text/html | 188323 | success | authoritative | extracted: 55/2; none |
| [Source](https://www.redarcelectronics.com/us/support) | 200 | text/html | 157459 | success | authoritative | extracted: 35/0; none |
| [Source](https://www.redarcelectronics.com/us/training-resources) | 404 | text/html | 121211 | failed | failed: http_status | not extracted |
| [Source](https://www.redarcelectronics.com/finder) | 200 | text/html | 135289 | success | authoritative | extracted: 21/0; none |

Review package: review-package.42f5b67e02b2c8803ed592c6. Profile binding: redarc.web.acquisition-profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Battle Born Batteries — BBGC3

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://battlebornbatteries.com/products/270ah-12v-gc3-lifepo4-deep-cycle-batteries) | 200 | text/html | 651279 | success | authoritative | extracted: 57/3; none; extracted: 4/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources) | 200 | text/html | 761460 | success | authoritative | extracted: 103/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbgc3-bbgc32h-data-sheet) | 200 | text/html | 504351 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbgc3-bbgc32h-manual) | 200 | text/html | 504179 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bb10012-bb1002h-data-sheet) | 200 | text/html | 504902 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bb10012i-bb1002ih-data-sheet) | 200 | text/html | 504517 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bb1275-data-sheet) | 200 | text/html | 504799 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bb5024-data-sheet) | 200 | text/html | 504745 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbbs1012-data-sheet) | 200 | text/html | 504391 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbbs2012-data-sheet) | 200 | text/html | 504391 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbbs3012-data-sheet) | 200 | text/html | 504872 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbgc2-bbgc2h-data-sheet) | 200 | text/html | 504341 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbgc2i-bbbgc2ih-data-sheet) | 200 | text/html | 504928 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbgc3i-bbbgc3ih-data-sheet) | 200 | text/html | 504928 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbi2000-bbic2000-data-sheet) | 200 | text/html | 504554 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbpv-12-120-data-sheet) | 200 | text/html | 504881 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbpv-12-200fld-data-sheet) | 200 | text/html | 504974 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbpv-12-230-data-sheet) | 200 | text/html | 504881 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbpv-24-375b-data-sheet) | 200 | text/html | 505032 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/ws48-12x-data-sheet) | 200 | text/html | 504797 | success | authoritative | extracted: 46/0; none |
| [Source](https://battlebornbatteries.com/blogs/product-resources/battle-born-ws500-pro-buying-guide) | 200 | text/html | 505166 | success | authoritative | extracted: 46/0; none |

Review package: review-package.2a100a9555d4fec099b12b07. Profile binding: battle-born-batteries.web.acquisition-profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Samlex America — PST-2000-24

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://samlexamerica.com/products/2000-watt-pure-sine-wave-inverter-pst-2000-24/) | 200 | text/html | 95772 | success | authoritative | extracted: 52/0; none; extracted: 2/0; none |
| [Source](https://samlexamerica.com/wp-content/uploads/2026/07/12001-PST-2000-12-24-48-0826-ES.pdf) | 200 | application/pdf | 396311 | success | authoritative | extracted: 156/0; table_extraction_unsupported: 1 |
| [Source](https://samlexamerica.com/wp-content/uploads/2026/07/12001-PST-2000-12-24-48-0826.pdf) | 200 | application/pdf | 399654 | success | authoritative | extracted: 167/0; table_extraction_unsupported: 1 |
| [Source](https://samlexamerica.com/products/200a-inverter-installation-kit/) | 200 | text/html | 90457 | success | authoritative | extracted: 46/0; none |
| [Source](https://samlexamerica.com/wp-content/uploads/2023/04/Samlex-America_2023-Product-Catalogue-0423_R2_Lrez.pdf) | 200 | application/pdf | 5866515 | success | authoritative | extracted: 4059/0; table_extraction_unsupported: 1 |
| [Source](https://samlexamerica.com/wp-content/uploads/2026/07/11001-PST-1500-2000-12-24-48_0726_Lrez.pdf) | 200 | application/pdf | 4376457 | success | authoritative | extracted: 4490/0; table_extraction_unsupported: 1 |
| [Source](https://samlexamerica.com/products/) | 200 | text/html | 141546 | success | authoritative | extracted: 61/0; none |
| [Source](https://samlexamerica.com/products/24-volt-15-amp-battery-charger-safety-listed/) | 200 | text/html | 93195 | success | authoritative | extracted: 44/0; none |
| [Source](https://samlexamerica.com/products/30-amps-transfer-switch/) | 200 | text/html | 91566 | success | authoritative | extracted: 42/0; none |
| [Source](https://samlexamerica.com/products/automatic-charge-separator-acr-160/) | 200 | text/html | 90753 | success | authoritative | extracted: 33/0; none |
| [Source](https://samlexamerica.com/products/battery-guard-bgw-200/) | 200 | text/html | 95139 | success | authoritative | extracted: 36/0; none |
| [Source](https://samlexamerica.com/products/remote-control-for-pst-1500-pst-2000-and-pst-3000-inverters-rc-300/) | 200 | text/html | 95693 | success | authoritative | extracted: 52/0; none |
| [Source](https://samlexamerica.com/resources-support/) | 200 | text/html | 88360 | success | authoritative | extracted: 26/0; none |
| [Source](https://samlexamerica.com/resources-support/brochures-guides/) | 200 | text/html | 110790 | success | authoritative | extracted: 16/0; none |
| [Source](https://samlexamerica.com/wp-content/uploads/2023/03/40200-0004-2023-Samlex-Product-Catalogue-0223-ES_Lrez.pdf) | 200 | application/pdf | 7767845 | success | authoritative | extracted: 4186/0; table_extraction_unsupported: 1 |
| [Source](https://samlexamerica.com/product-category/ac-dc-power-supplies/) | 200 | text/html | 171106 | success | authoritative | extracted: 97/0; none |
| [Source](https://samlexamerica.com/product-category/ac-dc-power-supplies/?pf=base-station-radio-cabinets) | 200 | text/html | 138932 | success | authoritative | extracted: 34/0; none |
| [Source](https://samlexamerica.com/product-category/ac-dc-power-supplies/?pf=desktop) | 200 | text/html | 140119 | success | authoritative | extracted: 38/0; none |
| [Source](https://samlexamerica.com/product-category/ac-dc-power-supplies/?pf=rack-mount) | 200 | text/html | 144583 | success | authoritative | extracted: 46/0; none |
| [Source](https://samlexamerica.com/product-category/battery-chargers/) | 200 | text/html | 142813 | success | authoritative | extracted: 46/0; none |
| [Source](https://samlexamerica.com/product-category/battery-chargers/?pf=12-vdc-2) | 200 | text/html | 131249 | success | authoritative | extracted: 23/0; none |

Review package: review-package.58daed564363afc17ff3d14e. Profile binding: samlex-america.web.acquisition-profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Morningstar — TS-MPPT-30

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://www.morningstarcorp.com/products/tristar-mppt/) | 200 | text/html | 226201 | success | authoritative | extracted: 45/1; none |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/datasheet-tristar-mppt-de.pdf) | 200 | application/pdf | 206608 | success | authoritative | extracted: 335/0; table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/datasheet-tristar-mppt-en.pdf) | 200 | application/pdf | 199839 | success | authoritative | extracted: 314/0; table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/datasheet-tristar-mppt-es.pdf) | 200 | application/pdf | 201239 | success | authoritative | extracted: 333/0; table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/datasheet-tristar-mppt-fr.pdf) | 200 | application/pdf | 200623 | success | authoritative | extracted: 333/0; table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/datasheet-tristar-mppt-pt.pdf) | 200 | application/pdf | 203718 | success | authoritative | extracted: 326/0; table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/technical-doc-tristar-mppt-modbus-specification-en.pdf) | 200 | application/pdf | 259038 | success | authoritative | extracted: 2153/0; table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/operation-manual-tristar-mppt-de.pdf) | 200 | application/pdf | 4117009 | success | authoritative | extracted: 1604/0; table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/operation-manual-tristar-mppt-en.pdf) | 200 | application/pdf | 11857649 | success | authoritative | extracted: 3583/0; table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/operation-manual-tristar-mppt-es.pdf) | 200 | application/pdf | 4114783 | success | authoritative | extracted: 1488/0; table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/operation-manual-tristar-mppt-fr.pdf) | 200 | application/pdf | 4109786 | success | authoritative | extracted: 1621/0; table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/firmware/tristar-mppt-firmware/) | 200 | text/html | 199916 | success | authoritative | extracted: 173/0; none |
| [Source](https://www.morningstarcorp.com/accessories/) | 200 | text/html | 205037 | success | authoritative | extracted: 50/0; none |
| [Source](https://www.morningstarcorp.com/how-to-buy/) | 200 | text/html | 170987 | success | authoritative | extracted: 14/0; none |
| [Source](https://www.morningstarcorp.com/product_category/solar-charge-controllers/) | 200 | text/html | 229893 | success | authoritative | extracted: 109/0; none |
| [Source](https://www.morningstarcorp.com/product-catalogs/) | 200 | text/html | 193360 | success | authoritative | extracted: 21/0; none |
| [Source](https://www.morningstarcorp.com/product-registration/) | 200 | text/html | 259716 | success | authoritative | extracted: 33/0; none |
| [Source](https://www.morningstarcorp.com/products/) | 200 | text/html | 197323 | success | authoritative | extracted: 31/0; none |
| [Source](https://www.morningstarcorp.com/support/) | 200 | text/html | 198376 | success | authoritative | extracted: 58/0; none |
| [Source](https://www.morningstarcorp.com/support/library/?_document_product=1152) | 200 | text/html | 201408 | success | authoritative | extracted: 18/0; none |
| [Source](https://www.morningstarcorp.com/support/library/?_document_product=1152&_document_type=meter-map) | 200 | text/html | 179172 | success | authoritative | extracted: 18/0; none |

Review package: review-package.60929c31698439b62366c650. Profile binding: no reviewed profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Xantrex — FREEDOM XC PRO 3000

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://xantrex.com/products/inverter-chargers/freedomxcpro/fxcpro-3000/) | 200 | text/html | 196468 | success | authoritative | extracted: 74/0; none; extracted: 4/0; none |
| [Source](https://xantrex.com/products/) | 200 | text/html | 151262 | success | authoritative | extracted: 9/0; none |
| [Source](https://xantrex.com/support/) | 200 | text/html | 153288 | success | authoritative | extracted: 6/0; none |
| [Source](https://xantrex.com/support/get-customer-support/) | 200 | text/html | 155396 | success | non_authoritative: challenge_detected | not extracted |
| [Source](https://xantrex.com/support/glossary/) | 200 | text/html | 222871 | success | authoritative | extracted: 186/0; none |
| [Source](https://xantrex.com/support/warranty-privacy-policies/) | 200 | text/html | 160736 | success | authoritative | extracted: 98/0; none |
| [Source](https://xantrex.com/industry-solutions/specialty/) | 200 | text/html | 179186 | success | authoritative | extracted: 22/0; none |
| [Source](https://xantrex.com/products/accessories/) | 200 | text/html | 169732 | success | authoritative | extracted: 30/0; none |
| [Source](https://xantrex.com/products/accessories/freedom-x-bluetooth-remote-panel/) | 200 | text/html | 178689 | success | authoritative | extracted: 41/0; none |
| [Source](https://xantrex.com/products/backup-power/) | 200 | text/html | 156310 | success | authoritative | extracted: 12/0; none |
| [Source](https://xantrex.com/products/battery-chargers/) | 200 | text/html | 275468 | success | authoritative | extracted: 20/0; none |
| [Source](https://xantrex.com/products/inverter-chargers/) | 200 | text/html | 533714 | success | authoritative | extracted: 25/0; none |
| [Source](https://xantrex.com/products/inverter-chargers/freedom458/) | 200 | text/html | 199005 | success | authoritative | extracted: 80/0; none |
| [Source](https://xantrex.com/products/inverter-chargers/freedomex/) | 200 | text/html | 200712 | success | authoritative | extracted: 75/0; none |
| [Source](https://xantrex.com/products/inverter-chargers/freedomhf/) | 200 | text/html | 200472 | success | authoritative | extracted: 76/0; none |
| [Source](https://xantrex.com/products/inverter-chargers/freedomsw-rvc/) | 200 | text/html | 195980 | success | authoritative | extracted: 63/0; none |
| [Source](https://xantrex.com/products/inverter-chargers/freedomsw/) | 200 | text/html | 221272 | success | authoritative | extracted: 76/0; none |
| [Source](https://xantrex.com/products/inverter-chargers/freedomsw230v/) | 200 | text/html | 195975 | success | authoritative | extracted: 68/0; none |
| [Source](https://xantrex.com/products/inverter-chargers/freedomxc/) | 200 | text/html | 218498 | success | authoritative | extracted: 89/0; none |
| [Source](https://xantrex.com/products/inverter-chargers/freedomxc230v/) | 200 | text/html | 194132 | success | authoritative | extracted: 73/0; none |
| [Source](https://xantrex.com/products/inverter-chargers/freedomxcpro/) | 200 | text/html | 213947 | success | authoritative | extracted: 78/0; none |

Review package: review-package.51b1879a8cb314abb945d88e. Profile binding: xantrex.web.acquisition-profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Progressive Dynamics — PD9345

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://www.progressivedyn.com/pd9300/) | 200 | text/html | 223317 | success | authoritative | extracted: 35/2; none |
| [Source](https://www.progressivedyn.com/service/installation-guides/) | 200 | text/html | 216072 | success | authoritative | extracted: 18/0; none |
| [Source](https://www.progressivedyn.com/wp-content/uploads/Support/manuals/PD9300/PD9300-Manual-English.pdf) | 200 | application/pdf | 476344 | success | authoritative | extracted: 651/0; table_extraction_unsupported: 1 |
| [Source](https://www.progressivedyn.com/wp-content/uploads/Support/manuals/PD9300/PD9300-Manual-French.pdf) | 200 | application/pdf | 345970 | success | authoritative | extracted: 454/0; table_extraction_unsupported: 1 |
| [Source](https://www.progressivedyn.com/contents/) | 200 | text/html | 212762 | success | authoritative | extracted: 18/0; none |
| [Source](https://www.progressivedyn.com/discontinued-product-resources/) | 200 | text/html | 224596 | success | authoritative | extracted: 22/1; none |
| [Source](https://www.progressivedyn.com/support-manuals-troubleshooting-guides/) | 200 | text/html | 245871 | success | authoritative | extracted: 64/3; none |
| [Source](https://www.progressivedyn.com/support-technical-information/) | 200 | text/html | 229271 | success | authoritative | extracted: 28/2; none |
| [Source](https://www.progressivedyn.com/wp-content/uploads/Sales/Progressive-Dynamics-2020-Catalog.pdf) | 200 | application/pdf | 30449484 | success | authoritative | extracted: 1493/0; table_extraction_unsupported: 1 |
| [Source](https://www.progressivedyn.com/wp-content/plugins/advanced-product-fields-for-woocommerce/assets/css/frontend.min.css?ver=1.7.1) | 200 | text/css | 1321 | success | non_authoritative: content_type_mismatch | not extracted |
| [Source](https://www.progressivedyn.com/wp-content/uploads/Support/manuals/PD9300/9300-Pendant-Operation.pdf) | 200 | application/pdf | 178488 | success | authoritative | extracted: 164/0; table_extraction_unsupported: 1 |
| [Source](https://www.progressivedyn.com/wp-content/uploads/Support/manuals/PD9300/AGM-profile.pdf) | 200 | application/pdf | 130364 | success | authoritative | extracted: 150/0; table_extraction_unsupported: 1 |
| [Source](https://www.progressivedyn.com/wp-content/uploads/Support/manuals/PD9300/Flooded_Lead_Acid_Profile.pdf) | 200 | application/pdf | 123848 | success | authoritative | extracted: 82/0; table_extraction_unsupported: 1 |
| [Source](https://www.progressivedyn.com/wp-content/uploads/Support/manuals/PD9300/Lithium-profile.pdf) | 200 | application/pdf | 118651 | success | authoritative | extracted: 83/0; table_extraction_unsupported: 1 |
| [Source](https://www.progressivedyn.com/wp-content/uploads/Support/manuals/PD9300/PD9300-Battery-Selector.pdf) | 200 | application/pdf | 272973 | success | authoritative | extracted: 37/0; table_extraction_unsupported: 1 |
| [Source](https://www.progressivedyn.com/wp-content/uploads/Support/manuals/Technical-library/Guides/PD9300-Lithium-Charging-Cycle.pdf) | 200 | application/pdf | 75981 | success | authoritative | extracted: 19/0; table_extraction_unsupported: 1 |

Review package: review-package.3ed557d466c6cdf7e59ee658. Profile binding: no reviewed profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Eaton — CB185-100

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://www.eaton.com/us/en-us/skuPage.CB185-100.html) | 200 | text/html | 175229 | success | authoritative | extracted: 66/5; none; extracted: 5/0; none |
| [Source](https://www.eaton.com/us/en-us/skuPage.CB185-100.pdf) | 200 | application/pdf | 71236 | success | authoritative | extracted: 80/0; table_extraction_unsupported: 1 |
| [Source](https://www.eaton.com/us/en-us/products.html) | 200 | text/html | 103997 | success | authoritative | extracted: 27/0; none |
| [Source](https://www.eaton.com/us/en-us/support.html) | 200 | text/html | 105343 | success | authoritative | extracted: 30/0; none |
| [Source](https://www.eaton.com/us/en-us/support/electrical-circuit-protection/contact-me-bussmann-aftermarket-products.html?primaryProductTaxonomy=electrical-circuit-protection%2Ffuses-and-fuse-holders) | 200 | text/html | 178739 | success | authoritative | extracted: 27/0; none |
| [Source](https://www.eaton.com/us/en-us/support/tools/part-number-search.html) | 200 | text/html | 98826 | success | authoritative | extracted: 26/0; none |
| [Source](http://www.eaton.com/content/dam/eaton/products/electrical-circuit-protection/fuses/bussmann-series-catalogs/bus-ele-cat-1007-full-line-catalog-complete.pdf) | not run / unknown | not run / unknown | 0 | failed | failed: response_too_large | not extracted |
| [Source](https://www.eaton.com/content/dam/eaton/products/electrical-circuit-protection/fuses/bussmann-series-catalogs/bus-ele-cat-1007-full-line-catalog-complete.pdf) | not run / unknown | not run / unknown | 0 | failed | failed: response_too_large | not extracted |
| [Source](https://www.eaton.com/content/dam/eaton/products/electrical-circuit-protection/fuses/retail-product-profiles/bus-ele-cat-5084-full-line-retail.pdf) | 200 | application/pdf | 7150081 | success | authoritative | extracted: 11370/0; table_extraction_unsupported: 1 |
| [Source](https://www.eaton.com/content/dam/eaton/products/electrical-circuit-protection/fuses/retail-product-profiles/bus-ele-pp-10730-pog-auto-4ft.pdf) | 200 | application/pdf | 420632 | success | authoritative | extracted: 463/0; table_extraction_unsupported: 1 |
| [Source](https://www.eaton.com/us/en-us/products/electrical-circuit-protection.html) | 200 | text/html | 125973 | success | authoritative | extracted: 29/0; none |
| [Source](https://www.eaton.com/us/en-us/products/electrical-circuit-protection/fuses-and-fuse-holders.html) | 200 | text/html | 138834 | success | authoritative | extracted: 39/0; none |
| [Source](https://www.eaton.com/us/en-us/products/thermal-management-solutions/eaton-and-boyd-thermal.html) | 200 | text/html | 138114 | success | authoritative | extracted: 59/0; none |

Review package: review-package.2381cb861eccbe91a39c9ce8. Profile binding: eaton.web.acquisition-profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Balmar — SG200

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://balmar.net/product/sg200/) | 200 | text/html | 186087 | success | authoritative | extracted: 8/0; none |
| [Source](https://balmar.net/manuals-for-discontinued-products/) | 200 | text/html | 179327 | success | authoritative | extracted: 2/1; none |
| [Source](https://balmar.net/operation-manuals/) | 200 | text/html | 192567 | success | authoritative | extracted: 9/5; none |
| [Source](https://balmar.net/balmar-technology/alternator-dimensions/) | 200 | text/html | 183447 | success | authoritative | extracted: 5/1; none |
| [Source](https://balmar.net/contact-technical-support/) | 200 | text/html | 172710 | success | authoritative | extracted: 2/0; none |
| [Source](https://balmar.net/wp-content/plugins/elementor-pro/assets/css/widget-woocommerce-product-additional-information.min.css?ver=4.2.3) | 200 | text/css | 153 | success | non_authoritative: content_type_mismatch | not extracted |
| [Source](https://balmar.net/wp-content/plugins/elementor-pro/assets/css/widget-woocommerce-product-images.min.css?ver=4.2.3) | 200 | text/css | 1039 | success | non_authoritative: content_type_mismatch | not extracted |
| [Source](https://balmar.net/wp-content/plugins/elementor-pro/assets/css/widget-woocommerce-product-meta.min.css?ver=4.2.3) | 200 | text/css | 965 | success | non_authoritative: content_type_mismatch | not extracted |
| [Source](https://balmar.net/wp-json/oembed/1.0/embed?url=https%3A%2F%2Fbalmar.net%2Fproduct%2Fsg200%2F) | 200 | application/json | 2661 | success | non_authoritative: content_type_mismatch | not extracted |
| [Source](https://balmar.net/wp-json/oembed/1.0/embed?url=https%3A%2F%2Fbalmar.net%2Fproduct%2Fsg200%2F&format=xml) | 200 | text/xml | 2860 | success | authoritative | unsupported: 0/0; unsupported_media_type: 1 |
| [Source](https://balmar.net/wp-json/wp/v2/product/23390) | 200 | application/json | 12098 | success | non_authoritative: content_type_mismatch | not extracted |

Review package: review-package.27b770d25053549f8f112f72. Profile binding: no reviewed profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Indel B — CRUISE 65 ELEGANCE SILVER

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://www.indelb.com/us/product/cruise-65-elegance-silver/) | 200 | text/html | 52192 | success | non_authoritative: challenge_detected | not extracted |

Review package: not prepared. Profile binding: no reviewed profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Pentair — 4008-131-E65

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://www.pentair.com/en-us/flow/shurflo/shurflo-products/shurflo-rv-applications/water-delivery-pumps/shurflo-revolution-4008-series-by-pass-pump.html) | 200 | text/html | 148685 | success | authoritative | extracted: 47/3; none |
| [Source](https://www.pentair.com/content/dam/extranet/web/nam/shurflo/data-sheets/pds-4008-101-X65.pdf) | 200 | application/pdf | 444885 | success | authoritative | extracted: 181/0; table_extraction_unsupported: 1 |
| [Source](https://www.pentair.com/content/dam/extranet/web/nam/shurflo/data-sheets/pds-4008-131-X65.pdf) | 200 | application/pdf | 445459 | success | authoritative | extracted: 184/0; table_extraction_unsupported: 1 |
| [Source](https://www.pentair.com/content/dam/extranet/web/nam/shurflo/data-sheets/pds-4008-171-X65.pdf) | 200 | application/pdf | 453370 | success | authoritative | extracted: 180/0; table_extraction_unsupported: 1 |
| [Source](https://www.pentair.com/content/dam/extranet/web/nam/shurflo/data-sheets/pds-4028-100-X54.pdf) | 200 | application/pdf | 443063 | success | authoritative | extracted: 178/0; table_extraction_unsupported: 1 |
| [Source](https://www.pentair.com/content/dam/extranet/web/nam/shurflo/manuals/911-1008-4008-rv-by-pass-pump-iom.pdf) | 200 | application/pdf | 1060622 | success | authoritative | extracted: 1008/0; table_extraction_unsupported: 1 |
| [Source](https://www.pentair.com/en-us/flow/shurflo/shurflo-products.html) | 200 | text/html | 197251 | success | authoritative | extracted: 171/0; none |
| [Source](https://www.pentair.com/en-us/flow/shurflo/shurflo-products/shurflo-agricultural-industrial-applications.html) | 200 | text/html | 147764 | success | authoritative | extracted: 34/0; none |
| [Source](https://www.pentair.com/en-us/flow/shurflo/shurflo-products/shurflo-marine-applications.html) | 200 | text/html | 147949 | success | authoritative | extracted: 35/0; none |
| [Source](https://www.pentair.com/en-us/flow/shurflo/shurflo-products/shurflo-rv-applications.html) | 200 | text/html | 147568 | success | authoritative | extracted: 35/0; none |
| [Source](https://www.pentair.com/en-us/flow/shurflo/shurflo-products/shurflo-rv-applications/water-delivery-pumps.html) | 200 | text/html | 145164 | success | authoritative | extracted: 28/0; none |

Review package: review-package.eeb98c09a3be4dc856c40787. Profile binding: no reviewed profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Webasto — Air Top 2000 STC

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://www.webasto.com/en-int/heating/air-heater/air-top-2000-stc.html) | 200 | text/html | 215309 | success | authoritative | extracted: 41/0; none |
| [Source](https://www.webasto.com/content/dam/global-brand/business-fields/heating/air-heater/documents/240806_Datasheet_Air%20Top%202000_STC_EN.pdf.coredownload.inline.pdf) | 200 | application/pdf | 254848 | success | authoritative | extracted: 143/0; table_extraction_unsupported: 1 |
| [Source](https://www.webasto.com/content/dam/global-brand/business-fields/heating/air-heater/documents/240813_Datasheet_AirTopSerie_RecreationalVehicles_EN.pdf.coredownload.inline.pdf) | 200 | application/pdf | 245080 | success | authoritative | extracted: 137/0; table_extraction_unsupported: 1 |

Review package: review-package.d8179a5f47db3f8b3c45b812. Profile binding: no reviewed profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Renogy — 100W Lightweight Flexible Solar Panel

| Selected URI (seed included) | HTTP | Observed media | Observed bytes | Transport | Capture disposition / reason | Extraction status; blocks/tables; diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| [Source](https://www.renogy.com/products/100-watt-12-volt-flexible-monocrystalline-solar-panel) | not run / unknown | not run / unknown | 2001521 | failed | failed: response_too_large | not extracted |

Review package: not prepared. Profile binding: no reviewed profile. Qualified-value assertions: 0; all generated facts/proposals remain provisional.

### Live selection comparison

| Model | Selected/captured URI order unchanged across network batches |
| --- | --- |
| BCDC1225D | true |
| BBGC3 | true |
| PST-2000-24 | true |
| TS-MPPT-30 | true |
| FREEDOM XC PRO 3000 | true |
| PD9345 | true |
| CB185-100 | true |
| SG200 | true |
| CRUISE 65 ELEGANCE SILVER | true |
| 4008-131-E65 | true |
| Air Top 2000 STC | true |
| 100W Lightweight Flexible Solar Panel | true |

## Retention and final repository handoff

Observation storage `.local-ingestion/corpus-wave2-observation/`; recovery `.local-ingestion/corpus-wave2-offline-recovery/`; acceptance `.local-ingestion/corpus-wave2-acceptance/`. Ordinary storage includes campaign/batch IDs, durable jobs, captures, candidates, extraction artifacts, facts, reconciliation, proposals, review packages, network accounting, source-shape inspection metadata, detailed statistics, offline comparison results and digest-verified snapshots. These ignored manufacturer artifacts were not added to git.

Final `git diff --check` passed. Final exact `git status --short`:

```text
 M data/schemas/manufacturer-acquisition-profile.schema.json
 M docs/ARCHITECTURE.md
 M packages/ingestion/src/manufacturer-acquisition.ts
 M packages/ingestion/src/profile-qualified-evidence.ts
 M packages/ingestion/tests/coverage-recovery.test.ts
?? .local-corpus-draft-archive/
?? data/components/victron-energy.ekrano-gx-bpp900480100.yaml
?? data/ingestion/manufacturer-acquisition-profiles/eaton.json
?? data/ingestion/manufacturer-acquisition-profiles/xantrex.json
?? docs/CORPUS_CAMPAIGN_WAVE_2.md
```

No approval, finalization, canonical product write, product-specific production branch, staging, commit, push, merge, PR, repository-permission change or manufacturer artifact added to git. Protected paths untouched. Starting/final HEAD identical. Only the five tracked files above and three new campaign/profile files belong to this slice.
