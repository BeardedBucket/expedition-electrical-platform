# Corpus campaign Wave 1

## Coverage recovery continuation

### Final architectural review corrections

Three narrow review findings were addressed without another network batch or
profile changes. The existing persisted `document_extraction.blocks[].kind` enum
already contains `structured` in `data/schemas/production-ingestion.schema.json`;
`DocumentBlockKind` and the `validateDocumentExtraction` runtime allowlist also
contain it. No schema/allowlist edit was needed. A real supplementary profile
document and its QualifiedFact now pass both runtime and production JSON-schema
validation in regression tests, preserving the closed enum contract.

Model-column observations now snapshot the notes/separators established at their
source position. Later context cannot qualify an earlier row. Repeated separators
accumulate conservative forward context without inferring section resets or global
scope. Tests cover an earlier Voltage fact with no later Charger-mode qualifier,
a subsequent Current fact retaining that qualifier, a second separator, unattached
notes and deterministic repeated qualification.

The supplementary item envelope now counts **retained supplementary blocks plus
QualifiedFact observations before artifact construction**, with their combined sum
bounded by the unchanged HTML `max_items = 10,000`. Exact-bound tests retain 101
blocks and 9,899 observations; the one-over case (101 + 9,900) rejects the entire
supplement, retains no blocks/facts and reports partial/source_incomplete. Tests use
real HTML extraction and the actual default, with input-byte and per-block text
bounds intact. Ordinary extraction limits are unchanged.

Offline replay of all eight retained Wave 1 inputs produced no count/disposition
changes for any product; Blue Sea remains a failed seed with no extracted evidence.
All seven prepared products remain deterministic across documents, qualifications,
facts, reconciliation, proposals, bridge and package, with source SHA-256 verified.
Each review-package digest also matches the pre-correction offline result.
Morningstar remains 19 facts/19 groups/19 proposals, mapped 0, unsupported 0,
conflicts 0, unresolved 19, qualified values 0. Historical live results and the
previous replay metadata were not rewritten. Correction replay metadata is kept in
ignored `.local-ingestion/corpus-wave1-coverage-corrections/offline-statistics.json`.

Focused correction/schema/boundary, Ekrano table-scope and qualified-value tests:
202 passed across four files (57 recovery, 32 production contracts, 46 table scope,
67 qualified-value lifecycle). The relevant ingestion suite ran once and passed
1,258 tests across 48 files. Root build, requested lint with `.tmp/**` excluded,
format:check and git diff --check passed. No network, validate:data, staging, commit or
push was performed for these corrections.

The original run below remains historical evidence. The continuation is a source
capability recovery, with no promotion or approval. Acquisition profile review is
review of source selectors/mechanics only. All recovered claims remain provisional.

### Historical capability migration matrix

| Capability / historical basis                                                                                   | Earlier path                                                                                                                     | Production gap found                                                                                                                                           | Continuation result                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw record + reviewed property mappings (`d17abb48`, `structured-fact-extraction.ts`)                           | Exact selected raw record, typed JSON values, property locators; provisional ProductFacts plus legacy normalization              | Production preparation extracted HTML but did not consume the reviewed record mappings                                                                         | Migrated into capture/acquisition/document-bound QualifiedFacts; no legacy normalized candidate bypass                                                    |
| Exact SKU, reviewed script/media/path/collection (`manufacturer-acquisition.ts`; `194f06ea` profile means-test) | Unique exact raw SKU, official domains, source-shape strategies                                                                  | Selection survived as an API but was not connected to production qualification                                                                                 | Selection preserved and connected; duplicate script nodes now explicitly ambiguous                                                                        |
| Raw HTML table and definition rows (`fact-extraction.ts`, `document-extraction.ts`; `305e306c`)                 | Provisional row label/value evidence, optional entire text blocks                                                                | Production required exact identity cells or sole model header; ordinary page specifications stayed empty                                                       | Exact reviewed page identity plus reviewed regions; simple two-cell tables, alternating DT/DD, LI and BR label/value structures                           |
| Model-column family tables                                                                                      | Native cells retained source row/column data; legacy generic rows did not establish safe target-column scope                     | Readable Morningstar model matrix had no production qualifier                                                                                                  | New generic unique exact model header qualifier; no span expansion, sibling borrowing or range splitting                                                  |
| Exact identity rows and sole whole-table model (`4d9996ef`, `production-contracts.ts`)                          | Production exact row and `whole-table-product-scope.v1` already existed                                                          | Must not be weakened by new fallbacks                                                                                                                          | Preserved precedence; existing 46 table-scope regressions pass, including Ekrano synthetic whole-table behavior                                           |
| SmartSolar manual/table evidence (`victron-smartsolar-scc075015060r.json` and D/R review files)                 | Curated provisional facts and explicit reviewed constraints from PDF revision 10; JSON product-page record separately documented | Does not demonstrate a general PDF parser that retained semantic table cells; present PDF extraction is bounded ordered text with unsupported-table diagnostic | PDF qualification remains unsupported where it needs layout reconstruction. Historical human-selected rows are not imported as machine-qualified evidence |
| SmartShunt manual sections (`victron-smartshunt-shu050150050.json`)                                             | Several sources explicitly point to HTML manual introduction/installation/operation/technical-data                               | A "manual" source is not necessarily PDF; human interpretation is separate from extraction                                                                     | Existing HTML exact-row/whole-table support preserved; no paragraph-to-fact inference or new installation rules                                           |
| Canonical field mappings and normalization (`field-mapping.ts`, `normalize-fact.ts`)                            | Human-readable generic labels, unit conversion and structured arrays                                                             | Must not transplant normalized legacy facts as reviewed production facts                                                                                       | Existing production proposal/bridge gates reused. Supported voltage sets now reject the entire malformed/partial set instead of dropping members          |
| Candidate construction (`candidate-builder.ts`, production candidate/semantic bridges)                          | Legacy provisional candidate assembly, separate human review                                                                     | Calling legacy builder would bypass production evidence ownership                                                                                              | No legacy candidate path added; ordinary reconciliation/proposals/review package preserved                                                                |
| Commerce/wiki action discovery                                                                                  | Readable or official action links could consume bounded capture slots                                                            | Cart, edit/login/index/backlink actions scheduled as evidence                                                                                                  | Generic action eligibility exclusion retains discovery/provenance but spends no capture slot; redirect destination guard uses the same policy             |

Historical inspection used the listed current files and focused `git log`/`git
show` of relevant code/data paths. It never inspected the protected draft archive
or protected Ekrano component. Curated historical manual facts demonstrate human
review capability, not general automated PDF structure recovery.

### Offline retained Wave 1 before / after

Every successfully prepared original product had zero facts, groups, proposals,
mapped, unsupported, conflicts, unresolved and qualified values. Blue Sea failed
before extraction, so downstream baseline counts are unavailable, not asserted
zeros. The table shows original baseline to the new rules on the same retained
source bytes. Profile bindings were explicitly revised in the offline comparison;
historical jobs/captures/snapshots were not rewritten.

| Product       | Facts       | Groups      | Proposals   | Mapped      | Unsupported | Conflicts   | Unresolved  | Qualified values |
| ------------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ---------------- |
| MultiPlus-II  | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0            |
| TS-MPPT-60    | 0 → 19      | 0 → 19      | 0 → 19      | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 19      | 0 → 0            |
| BCDC1240D     | 0 → 29      | 0 → 29      | 0 → 29      | 0 → 0       | 0 → 26      | 0 → 0       | 0 → 3       | 0 → 0            |
| BB10012       | 0 → 16      | 0 → 16      | 0 → 16      | 0 → 3       | 0 → 13      | 0 → 0       | 0 → 0       | 0 → 0            |
| Blue Sea 5026 | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable      |
| PICO          | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0            |
| CRX 50 E      | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0       | 0 → 0            |
| SEC-1230UL    | 0 → 8       | 0 → 6       | 0 → 6       | 0 → 0       | 0 → 2       | 0 → 0       | 0 → 4       | 0 → 0            |

Recovered shape/ownership details:

- Morningstar: exact TS-MPPT-60 header column in the official product seed model
  matrix, 19 source observations. A global/unattached note remains qualifier
  evidence, leaving all proposals unresolved; no sibling TS-MPPT-30/45 values used.
- REDARC: visible exact SKU in `div[itemprop=sku]`, reviewed
  `table#product-attribute-specs-table`, 29 label/value rows. Marketing title is
  not substituted for SKU; decorative/related-product tables are outside the rule.
- Battle Born: exact `span[data-testid=product-sku]`, reviewed
  `table.product-spec-table__table`, 16 source rows across specification, dimensions
  and accepted-voltage tables. Related product pages cannot inherit intake scope.
- Samlex: repeated identical visible `h2.o-product--sku` subjects, reviewed
  specifications accordion with exact heading and BR-delimited labels, eight
  observations/six groups. Dual-unit weight and dimensions remain unresolved;
  raw strings are not repaired or unit interpretations invented.

Remaining zero products: Victron retained shared-MPN/multi-variant cells and
ambiguous family scope, without an exact supported column for this SKU; PICO seed
contained variant controls but no safely bound technical specification region
(captured sibling products cannot supply it); Dometic retained a sparse dynamic
specification heading without populated structures or reviewed exact JSON selector;
Blue Sea retained only the original HTTP 403 failure. These are explicit coverage
or source-access limits, not evidence of unsupported electrical properties.

Repeated offline runs compare deterministic document, qualification, fact,
reconciliation, proposal, bridge and review-package serialization for all seven
prepared products and verify source SHA-256 before extraction. All comparisons
match. Ignored comparison metadata is stored at
`.local-ingestion/corpus-wave1-coverage-recovery/offline-statistics.json`. The old
analysis helper's `replay.json` was overwritten during an early new-rule comparison;
it is no longer the original replay measurement file. Original measurements and
digests recorded later in this report remain the historical record; original jobs,
captures and snapshots are unchanged. No comparison is presented as an unchanged
old-rule replay when its qualification rules differ.

### Implementation and safety boundary

New generic modules are `model-column-qualification.ts`,
`profile-qualified-evidence.ts` and `evidence-uri.ts`. Production workflow and
qualification call these additions. Schema/types permit inert reviewed HTML
selector chains; REDARC profile was revised and Battle Born/Samlex profiles added
from retained seed structure. No product identifier appears in implementation
branches. Profile provenance points to this report and the observed seed hash;
manufacturer bytes remain exclusively in ignored runtime snapshots.

All facts require authoritative linked capture/acquisition, complete extraction,
exact intake/profile digest bindings and byte-backed decoding. Raw records,
property/DOM locators, source units, conditions and profile context are retained.
Ambiguous scripts/records/identity axes, spans, nested tables, malformed definition
pairs, empty values, ambiguous page rules and unsupported prose are rejected or
left unknown. Compound values and notes remain raw. Ordinary HTML bounds also
bound supplementary output; excess rejects the whole supplement. These limits,
ordering, ownership, condition handling and architectural distinctions are
documented beside the code and in `ARCHITECTURE.md`.

The 54 new tests cover positive/rejection fixtures for the migrated shapes,
determinism, source ownership, profile status, byte tampering, text substitution,
identity ambiguity, sibling exclusion, missing/compound values, conditions,
structured arrays/units/locators, action discovery scheduling and redirect blocking.
Existing Ekrano table-scope and qualified-value lifecycle tests remain intact.
Action tests prove metadata survives while a single capture slot goes to an
eligible technical URI; legitimate technical query/export links stay eligible.

### Single live acceptance batch and final checks

Exactly one new network batch ran, with no per-product retries or child
replacement: `f391031d-22de-48dd-be5d-a8c4d983e2d6`, created
2026-09-29T06:57:12.737Z, completed 2026-09-29T06:58:37.687Z. Aggregate **mixed**:
seven review_ready, one preparation_failed. All approval/finalization counts are
zero. Storage is `.local-ingestion/corpus-wave1-coverage-acceptance/`.

| Product       | Child ID                             | State              | Discovered occurrences / selected children | Captures / authoritative | Observed bytes | Facts / groups / proposals | Mapped / unsupported / conflicts / unresolved / qualified values |
| ------------- | ------------------------------------ | ------------------ | ------------------------------------------ | ------------------------ | -------------- | -------------------------- | ---------------------------------------------------------------- |
| MultiPlus-II  | 59ed60bb-7e6b-475e-98ee-249bc79f2878 | review_ready       | 92 / 20                                    | 21 / 20                  | 2,221,505      | 0 / 0 / 0                  | 0 / 0 / 0 / 0 / 0                                                |
| TS-MPPT-60    | 0a94033d-471b-467d-9a23-d27b4a859da6 | review_ready       | 81 / 20                                    | 21 / 21                  | 27,731,681     | 19 / 19 / 19               | 0 / 0 / 0 / 19 / 0                                               |
| BCDC1240D     | d3e3aefb-2249-40bc-beb9-7879e83fdcd6 | review_ready       | 84 / 13                                    | 14 / 13                  | 2,430,851      | 29 / 29 / 29               | 0 / 26 / 0 / 3 / 0                                               |
| BB10012       | 6ae4baab-b0f5-48da-9904-2094c41ea1e6 | review_ready       | 194 / 20                                   | 21 / 21                  | 14,620,885     | 16 / 16 / 16               | 3 / 13 / 0 / 0 / 0                                               |
| Blue Sea 5026 | c29d217c-5dc6-422a-b836-89cfad4ac260 | preparation_failed | 0 / 0                                      | 1 / 0                    | 4,544          | no extraction              | unavailable                                                      |
| PICO          | bf6f52d3-88b7-425a-8b81-246ed4798881 | review_ready       | 50 / 16                                    | 17 / 15                  | 4,631,341      | 0 / 0 / 0                  | 0 / 0 / 0 / 0 / 0                                                |
| CRX 50 E      | 132ceeb8-63b6-4e6e-84e1-040be8d85cc7 | review_ready       | 5 / 4                                      | 5 / 4                    | 1,674,303      | 0 / 0 / 0                  | 0 / 0 / 0 / 0 / 0                                                |
| SEC-1230UL    | 38993942-668f-483b-98a7-1468d274ca4b | review_ready       | 86 / 20                                    | 21 / 21                  | 18,657,346     | 8 / 6 / 6                  | 0 / 2 / 0 / 4 / 0                                                |

Totals: 592 discovered provenance occurrences (not unique-resource count), 113
selected child resources plus eight seeds; 121 capture attempts, 119 transport
successes, 115 authoritative captures, four non-authoritative, two failed;
71,972,456 observed bytes. Recovered facts/groups/proposals total 72/70/70.
Proposals: three mapped, 41 unsupported, zero conflicting, 26 unresolved;
qualified-value assertions zero. Counts measure coverage, not product confidence.

Final source diagnostics: Blue Sea seed HTTP 403; REDARC training resource HTTP
404; Victron raw wiki export MIME mismatch; Simarine two JSON endpoint MIME
mismatches and one unsupported XML extraction; Dometic dealer authentication wall.
PDF table extraction remains explicitly unsupported (Victron 1, Morningstar 10,
Battle Born 1, Samlex 5). Victron also had one no-extractable-text document and one
source_incomplete qualification; these produced no facts. Remaining table
applicability diagnostics: Victron 18, REDARC 9, Battle Born 3, PICO 8. Ordinary
unqualifiable-source diagnostics persist; recovery supplements do not hide them.
No source truncation was accepted as complete evidence.

The live run excluded 11 action candidate occurrences (Victron 5, Morningstar 1,
Simarine 4, Samlex 1). Simarine captures fell from the original 21 to 17. Freed
Victron slots exposed `do=plugin_bookcreator__addtobook`, which the initial deny
list missed and captured once. This is disclosed resource waste, not technical
evidence. After the batch, a generic namespaced mutation-verb filter closed that
gap and passed an offline regression; no second network run was made. Final code
also explicitly checks profile official domains and retains label-only matrix
separators as qualifier context. These conservative guards did not change any
prepared acceptance artifact when replayed; future acquisition will exclude the
namespaced action. Live acquisition under that final filter was not remeasured.
Broad navigation/sibling pages remain a bounded scheduling efficiency limitation;
they never establish target applicability or evidence confidence.

The final retained-byte replay used zero network fetches, rebuilt ordinary and
supplementary artifacts in original order and matched document extraction,
qualification, facts, reconciliation, proposals, candidate bridge and review
package for **all seven** prepared products, including after the post-batch guards.
Blue Sea cannot be replayed as extracted evidence. Exact metadata is retained in
`statistics.json`, `acceptance-metadata.json` and `replay.json` in acceptance
storage; no manufacturer bytes are copied into this report.

Validation: focused recovery tests 54/54; ingestion and runtime regression suites
passed, **1,313 tests across 54 files** (1,255 ingestion and 58 runtime). Existing table-scope suite
46/46 and qualified-value lifecycle suite 67/67 pass. Root build, requested lint
with `.tmp/**` excluded, format:check and diff whitespace check pass. No repository
validate:data command ran; existing unit tests validate isolated synthetic temp
catalogs. Documentation covers profile vs fact review, deterministic artifact
ownership, bounds, conditions, URI eligibility and unchanged PDF limitations.

Starting/final HEAD is unchanged at
`f90da6922c3f996a678c8bf5abf5ea02a609bea5`; branch/worktree remain the original
`feat/production-corpus-ingestion` primary checkout. Production changes are in
capture types, field mapping, HTTP capture, manufacturer acquisition, source
acquisition, production contracts/workflow and exports plus the three new modules.
Configuration changes are the acquisition-profile schema, revised REDARC and new
Battle Born/Samlex profiles. New recovery tests and this report/architecture
documentation complete the diff. Protected pre-existing files are preserved.

The demonstrated all-empty migration blocker is fixed for supported source shapes.
Wave 2 can proceed as an observation/review campaign, with explicit limits for
dynamic pages, ambiguous variant scope, inaccessible seeds and PDF structure.
No generic NLP/OCR/PDF layout reconstruction is added. No further small code
defect is known from these checks; broader navigation waste and unsupported
semantic labels remain visible limitations. No product was approved/finalized,
no canonical record written, no confidence scoring or product-specific code
branch added, no protected-path contents accessed, no manufacturer artifact added
to git, and nothing was staged, committed or pushed.

## Scope and conclusion

Campaign date: **2026-09-28 America/Denver / 2026-09-29 UTC**. Initial restricted-network batch began 2026-09-29T05:51:35.979Z. Approved unrestricted recovery batch began 2026-09-29T05:52:07.358Z and completed 2026-09-29T05:53:54.450Z. Analysis and offline replay occurred on the same local campaign date.

Starting and final repository HEAD: `f90da6922c3f996a678c8bf5abf5ea02a609bea5`. Branch: `feat/production-corpus-ingestion`. Only worktree: `C:/Users/Bearded Bucket/Documents/GitHub/expedition-electrical-paltform` (primary). Local feature ref and origin feature ref matched HEAD at preflight.

The original approved network recovery batch ended **mixed: seven review_ready, one preparation_failed**. All seven prepared products yielded **zero QualifiedFacts, reconciliation groups, semantic proposals and qualified-value assertions**. These measurements are preserved below. The continuation audit corrected the original "no blocker" conclusion: readable HTML specifications and previously supported structured-record mechanics exposed a **material production capability/migration blocker**. Review-ready only established preparation of diagnostic packages. The recovery section below records the implementation and acceptance evidence; it does not retroactively change the original batch results or claim that provisional evidence is reviewed product data.

## Preflight and execution boundaries

Preflight reported the branch above; HEAD, local feature ref and origin feature ref each resolved to the exact HEAD above. `git worktree list` returned only the primary worktree. Starting status was:

```text
?? .local-corpus-draft-archive/
?? data/components/victron-energy.ekrano-gx-bpp900480100.yaml
```

Both protected paths remained untouched: no content inspection, import, modification or use. Ekrano GX was excluded. No branch change, staging, commit, push, merge or pull request occurred.

The harness called production `IngestionBatchService.createBatch` and `prepareBatch`, `IngestionJobService`, `FileIngestionBatchStore` and `FileIngestionJobStore`, with `HttpSourceCaptureAdapter` and the repository reviewed acquisition profiles. No substitute ingestion logic or extraction rules were used. Operator policy was depth 1, 50 distinct discovered resources and 20 candidate captures, plus the seed; default transport/parser limits remained unchanged. Candidate-record counts can exceed 50 because duplicate discovery/provenance records are distinct from normalized resources. Existing reviewed profiles were loaded and validated; manufacturers without matching profiles used the ordinary seed-host policy, with no invented profile or added domain allowance.

The only policy difference from the default operator setup was `retention_status: retained` with production `LocalSnapshotStore`, needed for offline replay. Durable jobs, captures and extraction artifacts remain in ordinary ignored `.local-ingestion/` runtime storage; temporary harnesses are in ignored `.tmp/`. No manufacturer material was imported into tracked content. Retention for this local observation is not an assertion of redistribution permission.

Sequential builds of `@expedition/ingestion` and `@expedition/ingestion-runtime` passed before execution to ensure compiled runtime code matched the checkout. No full test suite or validate:data was run.

## Selection fixed before ingestion

Exactly eight distinct products, eight manufacturers and eight materially different roles. Official manufacturer pages established intake identity and listing presence; no retailer/distributor/forum URI was used. Listing presence is not a guarantee of stock or regional availability. Operator-supplied MPNs remain requests, not verified extracted facts. Voltage diversity is selection context from official family/product documentation, not a canonical assertion. The Dometic current page is sparse; its family documentation describes 12/24 V operation, without establishing every exact SKU variant through this run.

| Order | Manufacturer          | Exact intake model                                            | MPN supplied | Category                        | Official intake URI                                                                                                                  | Diversity / expected source pattern                                                      |
| ----- | --------------------- | ------------------------------------------------------------- | ------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1     | Victron Energy        | MultiPlus-II 48/3000/35-32 230V                               | PMP482305012 | Inverter/charger                | [Product](https://www.victronenergy.com/inverters-chargers/multiplus-ii)                                                             | 48 V variant; extensive multi-model HTML manuals and resource collection; mixed expected |
| 2     | Morningstar           | TS-MPPT-60                                                    | TS-MPPT-60   | Solar MPPT                      | [Product](https://www.morningstarcorp.com/products/tristar-mppt/)                                                                    | 12/24/36/48 V family; model-column matrix and multilingual manuals; mixed expected       |
| 3     | REDARC                | BCDC1240D                                                     | BCDC1240D    | DC-DC/alternator charger        | [Product](https://www.redarcelectronics.com/us/dual-input-40a-in-vehicle-dc-battery-charger)                                         | Dual-input charger; HTML specifications and linked resources; mixed expected             |
| 4     | Battle Born Batteries | BB10012                                                       | BB10012      | Battery/BMS                     | [Product](https://battlebornbatteries.com/products/100ah-12v-lifepo4-deep-cycle-battery)                                             | Battery and BMS context; Shopify tables and manual; mixed expected                       |
| 5     | Blue Sea Systems      | ST Blade Fuse Block - 12 Circuits with Negative Bus and Cover | 5026         | DC protection/distribution      | [Product](https://www.bluesea.com/products/5026/ST%20Blade%20Fuse%20Block%20-%2012%20Circuits%20with%20Negative%20Bus%20and%20Cover) | Passive branch protection topology and ratings; HTML-first expected                      |
| 6     | Simarine              | PICO Battery Monitor                                          | PICO         | Monitoring/control              | [Product](https://simarine.net/product/pico-battery-monitor/)                                                                        | Modular monitor, operating states and interfaces; mixed expected                         |
| 7     | Dometic               | CoolMatic CRX 50 E                                            | 9105306726   | DC refrigerator/load            | [Product](https://www.dometic.com/en/product/dometic-coolmatic-crx-50-e-9105306726)                                                  | 12/24 V appliance; dynamic specifications and document links; mixed expected             |
| 8     | Samlex America        | SEC-1230UL                                                    | SEC-1230UL   | AC battery charger/power supply | [Product](https://samlexamerica.com/products/12-volt-30-amp-battery-charger-safety-listed/)                                          | Selectable charger/power-supply modes and AC input; mixed/PDF-heavy expected             |

## Restricted-network attempt and explicit recovery

Original batch: `5e949203-c228-4495-b75c-5390da99c2b1`, aggregate `failed`, eight `preparation_failed` children. Each seed returned `network_error: TypeError: fetch failed`, without an HTTP response, bytes_observed, media type or digest. Those missing metadata remain unknown; they are not zero-byte successful captures. No downstream extraction or replay was possible in that attempt. The original batch is preserved unchanged at `.local-ingestion/corpus-wave1/`.

| Order | Original child job ID                  |
| ----- | -------------------------------------- |
| 1     | `6899e981-0e85-418d-8399-bf6dda824755` |
| 2     | `10027710-d2a0-441b-94d0-a3f47d86fbbb` |
| 3     | `24d66a83-9044-4985-aca1-8418a960f952` |
| 4     | `0f11eb79-a0dd-4378-8c6a-c53ea040516c` |
| 5     | `e1d4e853-9cda-4693-aed5-843e721f5233` |
| 6     | `dffb4af7-1065-4404-b60e-293b5a9961c4` |
| 7     | `f4e97e98-64fd-43e3-83eb-f4c03bc3e8a5` |
| 8     | `364992d3-aeb2-41a6-a750-a1b0d33c86fa` |

All eight immediate failures reproduced the restricted execution pattern. Explicit execution approval authorized one unrestricted recovery batch for the same product set. Its successful manufacturer responses establish that the initial all-product failure was environmental rather than a demonstrated ingestion defect. This was a disclosed, approved deviation from a single batch attempt, not an automatic retry of failed children: original child jobs were neither reset nor re-prepared. No recovery child was retried or replaced.

## Recovery batch and child outcomes

Batch ID: `4492bd0c-e7f4-469b-b805-dfcd9c011d8a`. Stored order below equals creation order and final `job_ids`. Aggregate **mixed**, requested/job count **8/8**, `review_ready: 7`, `preparation_failed: 1`; all approval/finalization/pending/other counts are zero. Storage: `.local-ingestion/corpus-wave1-network-recovery/`.

| Order | Model                                                         | Child job ID                           | Lifecycle          | Acquisition        |
| ----- | ------------------------------------------------------------- | -------------------------------------- | ------------------ | ------------------ |
| 1     | MultiPlus-II 48/3000/35-32 230V                               | `2559a7c2-3311-40d9-a137-c6057fbec57e` | review_ready       | partially_acquired |
| 2     | TS-MPPT-60                                                    | `84080eba-4cfc-4d5f-a3a0-cab9e4ff6bdb` | review_ready       | acquired           |
| 3     | BCDC1240D                                                     | `725ab822-a62d-482c-b8ae-50d5de2726fa` | review_ready       | partially_acquired |
| 4     | BB10012                                                       | `0b87c0ad-5ddc-41e8-92dc-6adb2e38cd10` | review_ready       | acquired           |
| 5     | ST Blade Fuse Block - 12 Circuits with Negative Bus and Cover | `0851632b-8efe-412d-9479-c3000dfaa944` | preparation_failed | seed_failed        |
| 6     | PICO Battery Monitor                                          | `0854ef19-67a9-4758-98d7-a4efe22da790` | review_ready       | partially_acquired |
| 7     | CoolMatic CRX 50 E                                            | `a3a7f16a-852c-4d46-9764-e37f3a38a44b` | review_ready       | partially_acquired |
| 8     | SEC-1230UL                                                    | `3419f767-2ea5-40cc-8a5c-05329ecc474d` | review_ready       | acquired           |

The Blue Sea failure was returned as `preparation_failed / acquisition_failed / seed_failed`. Later Simarine, Dometic and Samlex children prepared successfully, confirming failure isolation on this observed run. No thrown parser/store errors, stuck preparing jobs or cross-child aborts occurred.

## Capture accounting

Selected candidates exclude the seed and include failed attempts. Captures include seed artifacts. Transport success is separate from authoritative disposition: a 200 response can be non-authoritative. Successful bytes count only successful transport payloads; observed acquisition bytes include failed HTTP-response bodies. Failed captures are recorded, not concealed by partial or review-ready status.

| Model                                                         | Selected candidates | Captures | Transport success / failed | Authoritative | Successful bytes | Observed acquisition bytes |
| ------------------------------------------------------------- | ------------------- | -------- | -------------------------- | ------------- | ---------------- | -------------------------- |
| MultiPlus-II 48/3000/35-32 230V                               | 20                  | 21       | 21 / 0                     | 18            | 2199573          | 2199573                    |
| TS-MPPT-60                                                    | 20                  | 21       | 21 / 0                     | 21            | 27733149         | 27733149                   |
| BCDC1240D                                                     | 13                  | 14       | 13 / 1                     | 13            | 2309640          | 2430851                    |
| BB10012                                                       | 20                  | 21       | 21 / 0                     | 21            | 14622065         | 14622065                   |
| ST Blade Fuse Block - 12 Circuits with Negative Bus and Cover | 0                   | 1        | 0 / 1                      | 0             | 0                | 4544                       |
| PICO Battery Monitor                                          | 20                  | 21       | 21 / 0                     | 19            | 5925283          | 5925283                    |
| CoolMatic CRX 50 E                                            | 4                   | 5        | 5 / 0                      | 4             | 1674331          | 1674331                    |
| SEC-1230UL                                                    | 20                  | 21       | 21 / 0                     | 21            | 18641334         | 18641334                   |

Recovery total: 125 capture artifacts, 123 transport successes and 2 HTTP failures. Every product stayed below its ordinary 40,000,000-byte acquisition scheduling threshold. No source transport or parser budget crossing was observed.

## Extraction, qualification and downstream accounting

| Model                                                         | Extraction statuses           | Media types                        | Retained blocks / tables | QualifiedFacts | Groups: single / agreement / conflict / unresolved | Proposals: mapped / unsupported / conflicting / unresolved | Qualified values |
| ------------------------------------------------------------- | ----------------------------- | ---------------------------------- | ------------------------ | -------------- | -------------------------------------------------- | ---------------------------------------------------------- | ---------------- |
| MultiPlus-II 48/3000/35-32 230V                               | extracted: 18                 | text/html: 17; application/pdf: 1  | 2872 / 18                | 0              | 0 / 0 / 0 / 0                                      | 0 / 0 / 0 / 0                                              | 0                |
| TS-MPPT-60                                                    | extracted: 21                 | text/html: 11; application/pdf: 10 | 12660 / 1                | 0              | 0 / 0 / 0 / 0                                      | 0 / 0 / 0 / 0                                              | 0                |
| BCDC1240D                                                     | extracted: 13                 | text/html: 13                      | 657 / 9                  | 0              | 0 / 0 / 0 / 0                                      | 0 / 0 / 0 / 0                                              | 0                |
| BB10012                                                       | extracted: 21                 | text/html: 20; application/pdf: 1  | 2165 / 3                 | 0              | 0 / 0 / 0 / 0                                      | 0 / 0 / 0 / 0                                              | 0                |
| ST Blade Fuse Block - 12 Circuits with Negative Bus and Cover | none                          | none                               | 0 / 0                    | 0              | not run                                            | not run                                                    | not run          |
| PICO Battery Monitor                                          | extracted: 18; unsupported: 1 | text/html: 18; text/xml: 1         | 1662 / 12                | 0              | 0 / 0 / 0 / 0                                      | 0 / 0 / 0 / 0                                              | 0                |
| CoolMatic CRX 50 E                                            | extracted: 4                  | text/html: 4                       | 355 / 0                  | 0              | 0 / 0 / 0 / 0                                      | 0 / 0 / 0 / 0                                              | 0                |
| SEC-1230UL                                                    | extracted: 21                 | text/html: 16; application/pdf: 5  | 12237 / 0                | 0              | 0 / 0 / 0 / 0                                      | 0 / 0 / 0 / 0                                              | 0                |

Blue Sea retained zero extraction/fact artifacts because acquisition failed; reconciliation/proposals/qualified assertions were not run, rather than successful empty results. Every other child retained useful source content but yielded no facts. For prepared children, zero conflict/unresolved groups means there were no fact groups to compare; it does not mean all published information agreed or was resolved. No qualified-value assertion or consumption operating-state proposal was produced.

| Model                                                         | Qualification diagnostics                                | Extraction diagnostics           |
| ------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------- |
| MultiPlus-II 48/3000/35-32 230V                               | source_not_qualifiable: 18; applicability_unresolved: 18 | table_extraction_unsupported: 1  |
| TS-MPPT-60                                                    | source_not_qualifiable: 21; applicability_unresolved: 1  | table_extraction_unsupported: 10 |
| BCDC1240D                                                     | source_not_qualifiable: 13; applicability_unresolved: 9  | none                             |
| BB10012                                                       | source_not_qualifiable: 21; applicability_unresolved: 3  | table_extraction_unsupported: 1  |
| ST Blade Fuse Block - 12 Circuits with Negative Bus and Cover | none                                                     | none                             |
| PICO Battery Monitor                                          | source_not_qualifiable: 19; applicability_unresolved: 12 | unsupported_media_type: 1        |
| CoolMatic CRX 50 E                                            | source_not_qualifiable: 4                                | none                             |
| SEC-1230UL                                                    | source_not_qualifiable: 21                               | table_extraction_unsupported: 5  |

No `source_incomplete` outcomes, `partial_source`, parser failures, page/item/input/per-block/total-text/table-cell limit diagnostics were observed. Qualification completeness was incomplete when no facts could be established; that is distinct from truncated extraction. All PDFs retained text with `table_extraction_unsupported`; no PDF tables or OCR were inferred. Simarine XML was honestly retained as unsupported, with zero blocks.

## Findings and exclusive classifications

| ID    | Classification                   | Observation / stage ownership                                                                                                                                                                                                                                                              | Impact / disposition                                                                                                                                                                                                                                 |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1-01 | SOURCE-SPECIFIC LIMITATION       | Restricted execution could not fetch any of eight seeds; transport stage. Approved unrestricted execution recovered seven preparations.                                                                                                                                                    | Environment limitation resolved for observation. Not a manufacturer defect or ingestion-code defect.                                                                                                                                                 |
| W1-02 | SOURCE-SPECIFIC LIMITATION       | Blue Sea official seed HTTP 403, 4,544 observed response bytes; acquisition stopped for this child. REDARC training link HTTP 404, 121,211 observed bytes; other captures continued.                                                                                                       | Blue Sea product-specific preparation blocker; no retry/bypass. REDARC linked-resource failure non-blocking. No generic corpus blocker demonstrated.                                                                                                 |
| W1-03 | SOURCE-SPECIFIC LIMITATION       | Victron raw wiki export declared HTML but did not look like HTML; edit/login resources were authentication walls. Dometic dealer resource was classified authentication_wall.                                                                                                              | Non-authoritative sources excluded from qualification. These classifier dispositions were not manually overridden or asserted as verified publisher intent.                                                                                          |
| W1-04 | LEGITIMATE UNSUPPORTED CONTENT   | All 17 PDFs extracted text but no table structures or QualifiedFacts; extraction/qualification ownership.                                                                                                                                                                                  | Expected supported-policy boundary, not a parser failure. No OCR requirement or image-only PDF was observed.                                                                                                                                         |
| W1-05 | LEGITIMATE UNSUPPORTED CONTENT   | Morningstar has exact target in a column header, not a supported target data row. Victron has shared MPN cells and multi-model tables. REDARC/Battle Born tables lack the required exact whole-table product header; Simarine retained tables are not sufficient target identity evidence. | Current row/whole-table qualification rejects these shapes honestly. No unsupported model-column qualification or URL-derived table scope was invented.                                                                                              |
| W1-06 | SOURCE-SPECIFIC LIMITATION       | Dometic served a sparse page with no retained specification tables; Samlex published specifications in non-table presentation. Generic/static discovery retained related/navigation content as well as technical documents.                                                                | Prepared diagnostic packages, with no implied source completeness or verified product facts. Dynamic/external document paths and unscoped specifications require separately scoped future support.                                                   |
| W1-07 | LEGITIMATE UNSUPPORTED CONTENT   | Simarine oEmbed XML reached extraction as unsupported_media_type; its JSON endpoints were non-authoritative content_type_mismatch.                                                                                                                                                         | Explicit media boundary; no generic JSON/XML semantic parser added.                                                                                                                                                                                  |
| W1-08 | SOURCE-SPECIFIC LIMITATION       | Navigation, sibling products, multilingual files and action-style URLs consumed selected-resource slots. Simarine included add-to-cart query links; Victron included wiki edit/login/index/backlink URLs.                                                                                  | Bounded traversal remained deterministic; no cross-product fact leakage occurred. Review read-only URL eligibility and document-priority coverage before increasing campaign size. No authenticated action or purchase was performed by the harness. |
| W1-09 | FUTURE PRODUCT/ENGINEERING MODEL | Charging modes, battery/BMS limits, branch topology, appliance duty/temperature conditions and monitor states may need downstream engineering interpretation.                                                                                                                              | Selection diversity context only: no QualifiedFact or qualified-value result establishes these engineering assertions in this wave. Not an ingestion blocker.                                                                                        |

No finding is classified INGESTION DEFECT: none demonstrated violation of the current intended supported behavior. Findings W1-04/05 are acquisition-independent and reproduced by offline qualification of retained structures; their applicability diagnostics match the existing conservative contract. The qualification implementation was inspected at `packages/ingestion/src/production-contracts.ts` (target row matching and whole-table-product-scope.v1). Published identity somewhere on a page does not establish every table as exact-product evidence.

Distinct source admission and resource accounting were inspected against `packages/ingestion/src/source-acquisition.ts`. More than 50 candidate records does not itself violate the 50-distinct-resource limit. No collapsed conflicts, lost facts, detached source bytes, mismatched source ownership or nondeterministic artifact was demonstrated. With zero facts, several of these failure classes remain untested rather than proven absent.

## Offline deterministic replay

Victron (HTML-heavy manual indexes/specifications plus one seven-page PDF) and Morningstar (ten PDFs, including an 11,857,649-byte English manual) were replayed from production digest-verified snapshots. No second network fetch occurred. Extraction artifacts were rebuilt with original source capture/acquisition references, then qualification, whole-intake reconciliation, semantic proposals, candidate bridge and review package were reconstructed with the production APIs. Both full serialized output comparisons and per-extraction artifact digest comparisons matched.

| Model                           | Sources replayed | Digest / extraction / qualification / facts / reconciliation / proposals / bridge / package | Review-package digest                                                     |
| ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| MultiPlus-II 48/3000/35-32 230V | 18               | all identical                                                                               | `sha256:798afddaa24a2069b4b5af895d9e18ad47dbab84088c1e68121353065d25d1a0` |
| TS-MPPT-60                      | 21               | all identical                                                                               | `sha256:2066b6b5c962a76d988bb9acf25c6c8063a6a4942d0854a34cab9708a4727e08` |

These checks demonstrate repeatable retained-content parsing and package identity, including acquisition-bound evidence references. Empty fact/proposal/group sets make downstream equality a limited result, not a claim of deterministic conflict handling or qualified-value construction on nonempty real evidence. No positive semantic coverage was manufactured.

## Original blocker interpretation and next decisions — superseded

The following interpretation and follow-up list are preserved as the original
observation-only report, **not the current conclusion**. The continuation audit
identified the all-empty production source-shape gap as a material capability/
migration blocker and implemented recovery in this same conversation, as detailed
above. The original issue classifications and measurements remain historical.

**True ingestion blockers: none demonstrated. Small Copilot-ready ingestion-defect blockers: none. Cross-cutting ingestion-defect blockers: none.** No implementation was performed. Blue Sea accessibility blocks that child only. Zero usable facts across all seven preparations materially limits promotion readiness and the campaign’s semantic coverage, but the observed source patterns are unsupported qualification content, not automatically defects.

Original implementation-ready follow-up investigations (subsequently authorized by the continuation request):

- Qualification owner: decide whether exact model-column HTML matrices should become supported. Reproduce using retained Morningstar seed extraction: TS-MPPT-60 appears as a header in column 4, with adjacent variants; current qualification returns applicability_unresolved. Define span/duplicate/variant safeguards and provenance before implementation.
- Acquisition owner: review action-style URL admission. Retained Simarine seed links led to GET captures with add-to-cart queries; retained Victron index links led to wiki action URLs. Existing structural eligibility admits these URLs. Define read-only evidence URI policy and bounded ordering tests before declaring a contract defect or selecting an implementation owner.
- Source-profile owner: assess reviewed document-domain/navigation support for REDARC US, Simarine and Dometic using retained acquisition candidates; do not grant domains or dynamic-page scope from assumptions.

For Wave 2, first obtain explicit review of these coverage limits and decide whether to broaden qualification policy as a separate task. Select a corpus subset with documented supported target-row or exact whole-table patterns alongside diverse unsupported cases, so nonempty reconciliation/proposals/qualified assertions can actually be observed. Preserve manufacturer/category/voltage diversity; do not optimize merely for mapped counts. Investigate inaccessible seeds without silently substituting retailers or bypassing controls. Measure useful technical-document coverage versus navigation/cross-language captures before scaling to 20–30 products. Keep future duty-cycle, topology and safety interpretation separate from ingestion.

## Extraction source ledger

The ledger includes every attempted extraction, including navigation and unsupported XML, so technical sources and irrelevant captures remain distinguishable by URI. Counts retain metadata only; manufacturer text is not reproduced. Every ledger entry has zero QualifiedFacts; page count is not applicable for HTML/XML. Sources classified non-authoritative or failed were not extracted and appear in the capture diagnostics ledger below.

### Victron Energy — MultiPlus-II 48/3000/35-32 230V

| Source URI                                                                                                                      | Media           | Status    | Pages | Blocks | Tables | Extraction diagnostics          |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------- | ----- | ------ | ------ | ------------------------------- |
| [Source](https://www.victronenergy.com/inverters-chargers/multiplus-ii)                                                         | text/html       | extracted | n/a   | 976    | 2      | none                            |
| [Source](https://www.victronenergy.com/media/pg/Automatic_Generator_start-stop/en/index-en.html)                                | text/html       | extracted | n/a   | 10     | 0      | none                            |
| [Source](https://www.victronenergy.com/media/pg/Energy_Storage_System/en/index-en.html)                                         | text/html       | extracted | n/a   | 11     | 0      | none                            |
| [Source](https://www.victronenergy.com/media/pg/MultiPlus-II_120V/en/index-en.html)                                             | text/html       | extracted | n/a   | 11     | 0      | none                            |
| [Source](https://www.victronenergy.com/media/pg/MultiPlus-II_230V/en/index-en.html)                                             | text/html       | extracted | n/a   | 11     | 0      | none                            |
| [Source](https://www.victronenergy.com/media/pg/MultiPlus-II_4k_4k5_6k5_10k_230V/en/index-en.html)                              | text/html       | extracted | n/a   | 10     | 0      | none                            |
| [Source](https://www.victronenergy.com/media/pg/MultiPlus-II_External_Transfer_Switch_application/en/index-en.html)             | text/html       | extracted | n/a   | 12     | 0      | none                            |
| [Source](https://www.victronenergy.com/media/pg/Pre-RMA_Bench_Test_Instructions/en/index-en.html)                               | text/html       | extracted | n/a   | 10     | 0      | none                            |
| [Source](https://www.victronenergy.com/media/pg/Solar_&_Wind_Priority/en/index-en.html)                                         | text/html       | extracted | n/a   | 11     | 0      | none                            |
| [Source](https://www.victronenergy.com/media/pg/VictronConnect_configuration_guide_for_VE.Bus_products/en/index-en.html)        | text/html       | extracted | n/a   | 11     | 0      | none                            |
| [Source](https://www.victronenergy.com/media/pg/MultiPlus-II_120V/en/technical-specifications-mp-ii-120v.html)                  | text/html       | extracted | n/a   | 455    | 6      | none                            |
| [Source](https://www.victronenergy.com/media/pg/MultiPlus-II_230V/en/technical-specifications-mp-ii-230v.html)                  | text/html       | extracted | n/a   | 444    | 6      | none                            |
| [Source](https://www.victronenergy.com/media/pg/MultiPlus-II_4k_4k5_6k5_10k_230V/en/technical-specifications-mp-ii-k-230v.html) | text/html       | extracted | n/a   | 303    | 4      | none                            |
| [Source](https://www.victronenergy.com/live/ve.bus:manual_parallel_and_three_phase_systems)                                     | text/html       | extracted | n/a   | 130    | 0      | none                            |
| [Source](https://www.victronenergy.com/live/_export/xhtml/ve.bus:manual_parallel_and_three_phase_systems)                       | text/html       | extracted | n/a   | 130    | 0      | none                            |
| [Source](https://www.victronenergy.com/live/ve.bus:manual_parallel_and_three_phase_systems?do=backlink)                         | text/html       | extracted | n/a   | 4      | 0      | none                            |
| [Source](https://www.victronenergy.com/live/ve.bus:manual_parallel_and_three_phase_systems?do=export_pdf)                       | application/pdf | extracted | 7     | 277    | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.victronenergy.com/live/ve.bus:manual_parallel_and_three_phase_systems?do=index)                            | text/html       | extracted | n/a   | 56     | 0      | none                            |

### Morningstar — TS-MPPT-60

| Source URI                                                                                                          | Media           | Status    | Pages | Blocks | Tables | Extraction diagnostics          |
| ------------------------------------------------------------------------------------------------------------------- | --------------- | --------- | ----- | ------ | ------ | ------------------------------- |
| [Source](https://www.morningstarcorp.com/products/tristar-mppt/)                                                    | text/html       | extracted | n/a   | 45     | 1      | none                            |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/datasheet-tristar-mppt-de.pdf)                          | application/pdf | extracted | 2     | 335    | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/datasheet-tristar-mppt-en.pdf)                          | application/pdf | extracted | 2     | 314    | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/datasheet-tristar-mppt-es.pdf)                          | application/pdf | extracted | 2     | 333    | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/datasheet-tristar-mppt-fr.pdf)                          | application/pdf | extracted | 2     | 333    | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/datasheet-tristar-mppt-pt.pdf)                          | application/pdf | extracted | 2     | 326    | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/technical-doc-tristar-mppt-modbus-specification-en.pdf) | application/pdf | extracted | 29    | 2153   | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/operation-manual-tristar-mppt-de.pdf)                   | application/pdf | extracted | 33    | 1604   | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/operation-manual-tristar-mppt-en.pdf)                   | application/pdf | extracted | 39    | 3583   | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/operation-manual-tristar-mppt-es.pdf)                   | application/pdf | extracted | 33    | 1488   | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/wp-content/uploads/operation-manual-tristar-mppt-fr.pdf)                   | application/pdf | extracted | 33    | 1621   | 0      | table_extraction_unsupported: 1 |
| [Source](https://www.morningstarcorp.com/firmware/tristar-mppt-firmware/)                                           | text/html       | extracted | n/a   | 173    | 0      | none                            |
| [Source](https://www.morningstarcorp.com/accessories/)                                                              | text/html       | extracted | n/a   | 50     | 0      | none                            |
| [Source](https://www.morningstarcorp.com/how-to-buy/)                                                               | text/html       | extracted | n/a   | 14     | 0      | none                            |
| [Source](https://www.morningstarcorp.com/product_category/solar-charge-controllers/)                                | text/html       | extracted | n/a   | 109    | 0      | none                            |
| [Source](https://www.morningstarcorp.com/product-catalogs/)                                                         | text/html       | extracted | n/a   | 21     | 0      | none                            |
| [Source](https://www.morningstarcorp.com/product-registration/)                                                     | text/html       | extracted | n/a   | 33     | 0      | none                            |
| [Source](https://www.morningstarcorp.com/products/)                                                                 | text/html       | extracted | n/a   | 31     | 0      | none                            |
| [Source](https://www.morningstarcorp.com/support/)                                                                  | text/html       | extracted | n/a   | 58     | 0      | none                            |
| [Source](https://www.morningstarcorp.com/support/library/?_document_product=1152)                                   | text/html       | extracted | n/a   | 18     | 0      | none                            |
| [Source](https://www.morningstarcorp.com/support/library/?_document_product=1152&_document_type=meter-map)          | text/html       | extracted | n/a   | 18     | 0      | none                            |

### REDARC — BCDC1240D

| Source URI                                                                                  | Media     | Status    | Pages | Blocks | Tables | Extraction diagnostics |
| ------------------------------------------------------------------------------------------- | --------- | --------- | ----- | ------ | ------ | ---------------------- |
| [Source](https://www.redarcelectronics.com/us/dual-input-40a-in-vehicle-dc-battery-charger) | text/html | extracted | n/a   | 97     | 2      | none                   |
| [Source](https://www.redarcelectronics.com/us/bcdc-50amp-rear-install-wiring-kit)           | text/html | extracted | n/a   | 59     | 1      | none                   |
| [Source](https://www.redarcelectronics.com/us/battery-chargers/60a-fuse-kit)                | text/html | extracted | n/a   | 36     | 2      | none                   |
| [Source](https://www.redarcelectronics.com/us/bcdc-50amp-across-engine-bay-wiring-kit)      | text/html | extracted | n/a   | 58     | 1      | none                   |
| [Source](https://www.redarcelectronics.com/us/contact-us)                                   | text/html | extracted | n/a   | 19     | 0      | none                   |
| [Source](https://www.redarcelectronics.com/us/go-further-with-onx-offroad)                  | text/html | extracted | n/a   | 23     | 0      | none                   |
| [Source](https://www.redarcelectronics.com/us/redarc-range)                                 | text/html | extracted | n/a   | 65     | 0      | none                   |
| [Source](https://www.redarcelectronics.com/us/redvision-essentials-display)                 | text/html | extracted | n/a   | 83     | 1      | none                   |
| [Source](https://www.redarcelectronics.com/us/smart-battery-monitor)                        | text/html | extracted | n/a   | 55     | 2      | none                   |
| [Source](https://www.redarcelectronics.com/us/support)                                      | text/html | extracted | n/a   | 35     | 0      | none                   |
| [Source](https://www.redarcelectronics.com/finder)                                          | text/html | extracted | n/a   | 21     | 0      | none                   |
| [Source](https://www.redarcelectronics.com/us/battery-chargers/dc-dc)                       | text/html | extracted | n/a   | 71     | 0      | none                   |
| [Source](https://www.redarcelectronics.com/us/battery-chargers/dual-battery-isolators)      | text/html | extracted | n/a   | 35     | 0      | none                   |

### Battle Born Batteries — BB10012

| Source URI                                                                                                 | Media           | Status    | Pages | Blocks | Tables | Extraction diagnostics          |
| ---------------------------------------------------------------------------------------------------------- | --------------- | --------- | ----- | ------ | ------ | ------------------------------- |
| [Source](https://battlebornbatteries.com/products/100ah-12v-lifepo4-deep-cycle-battery)                    | text/html       | extracted | n/a   | 185    | 3      | none                            |
| [Source](https://battlebornbatteries.com/cdn/shop/files/BB10012_BB1002H_Manual.pdf?v=11314806988442144120) | application/pdf | extracted | 30    | 1049   | 0      | table_extraction_unsupported: 1 |
| [Source](https://battlebornbatteries.com/blogs/product-resources)                                          | text/html       | extracted | n/a   | 103    | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bb10012-bb1002h-data-sheet)               | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bb10012-bb1002h-manual)                   | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bb10012i-bb1002ih-data-sheet)             | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bb1275-data-sheet)                        | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bb5024-data-sheet)                        | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbbs1012-data-sheet)                      | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbbs2012-data-sheet)                      | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbbs3012-data-sheet)                      | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbgc2-bbgc2h-data-sheet)                  | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbgc2i-bbbgc2ih-data-sheet)               | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbgc3-bbgc32h-data-sheet)                 | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbgc3i-bbbgc3ih-data-sheet)               | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbi2000-bbic2000-data-sheet)              | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbpv-12-120-data-sheet)                   | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbpv-12-200fld-data-sheet)                | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbpv-12-230-data-sheet)                   | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/bbpv-24-375b-data-sheet)                  | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://battlebornbatteries.com/blogs/product-resources/ws48-12x-data-sheet)                      | text/html       | extracted | n/a   | 46     | 0      | none                            |

### Blue Sea Systems — ST Blade Fuse Block - 12 Circuits with Negative Bus and Cover

No extraction: failed seed acquisition.

### Simarine — PICO Battery Monitor

| Source URI                                                                                                                            | Media     | Status      | Pages | Blocks | Tables | Extraction diagnostics    |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- | ----- | ------ | ------ | ------------------------- |
| [Source](https://simarine.net/product/pico-battery-monitor/)                                                                          | text/html | extracted   | n/a   | 85     | 1      | none                      |
| [Source](https://simarine.net/support/)                                                                                               | text/html | extracted   | n/a   | 186    | 0      | none                      |
| [Source](https://simarine.net/product-category/uncategorized/)                                                                        | text/html | extracted   | n/a   | 89     | 0      | none                      |
| [Source](https://simarine.net/product/combo-shunts-sc303-and-sc503/)                                                                  | text/html | extracted   | n/a   | 84     | 1      | none                      |
| [Source](https://simarine.net/product/extension-data-cable-8m/)                                                                       | text/html | extracted   | n/a   | 80     | 0      | none                      |
| [Source](https://simarine.net/product/inclinometer/)                                                                                  | text/html | extracted   | n/a   | 78     | 0      | none                      |
| [Source](https://simarine.net/product/pico-battery-monitor/?add-to-cart=176079)                                                       | text/html | extracted   | n/a   | 88     | 1      | none                      |
| [Source](https://simarine.net/product/pico-battery-monitor/?add-to-cart=176092)                                                       | text/html | extracted   | n/a   | 88     | 1      | none                      |
| [Source](https://simarine.net/product/pico-battery-monitor/?add-to-cart=176463)                                                       | text/html | extracted   | n/a   | 88     | 1      | none                      |
| [Source](https://simarine.net/product/pico-battery-monitor/?add-to-cart=188482)                                                       | text/html | extracted   | n/a   | 88     | 1      | none                      |
| [Source](https://simarine.net/product/pico-blue-set/)                                                                                 | text/html | extracted   | n/a   | 94     | 1      | none                      |
| [Source](https://simarine.net/product/pico-cover/)                                                                                    | text/html | extracted   | n/a   | 83     | 1      | none                      |
| [Source](https://simarine.net/product/pico-one-set/)                                                                                  | text/html | extracted   | n/a   | 98     | 1      | none                      |
| [Source](https://simarine.net/product/quadro-shunt-modules-scq25-scq50-and-scq25t/)                                                   | text/html | extracted   | n/a   | 85     | 1      | none                      |
| [Source](https://simarine.net/product/radar-tank-level-sender/)                                                                       | text/html | extracted   | n/a   | 83     | 1      | none                      |
| [Source](https://simarine.net/product/str-tank-adapter/)                                                                              | text/html | extracted   | n/a   | 89     | 0      | none                      |
| [Source](https://simarine.net/product/temperature-sensor/)                                                                            | text/html | extracted   | n/a   | 97     | 1      | none                      |
| [Source](https://simarine.net/product/via/)                                                                                           | text/html | extracted   | n/a   | 79     | 0      | none                      |
| [Source](https://simarine.net/wp-json/oembed/1.0/embed?url=https%3A%2F%2Fsimarine.net%2Fproduct%2Fpico-battery-monitor%2F&format=xml) | text/xml  | unsupported | n/a   | 0      | 0      | unsupported_media_type: 1 |

### Dometic — CoolMatic CRX 50 E

| Source URI                                                                         | Media     | Status    | Pages | Blocks | Tables | Extraction diagnostics |
| ---------------------------------------------------------------------------------- | --------- | --------- | ----- | ------ | ------ | ---------------------- |
| [Source](https://www.dometic.com/en/product/dometic-coolmatic-crx-50-e-9105306726) | text/html | extracted | n/a   | 113    | 0      | none                   |
| [Source](https://www.dometic.com/en/support)                                       | text/html | extracted | n/a   | 79     | 0      | none                   |
| [Source](https://www.dometic.com/en/support/faq)                                   | text/html | extracted | n/a   | 81     | 0      | none                   |
| [Source](https://www.dometic.com/en/support/warranty)                              | text/html | extracted | n/a   | 82     | 0      | none                   |

### Samlex America — SEC-1230UL

| Source URI                                                                                                                                           | Media           | Status    | Pages | Blocks | Tables | Extraction diagnostics          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------- | ----- | ------ | ------ | ------------------------------- |
| [Source](https://samlexamerica.com/products/12-volt-30-amp-battery-charger-safety-listed/)                                                           | text/html       | extracted | n/a   | 44     | 0      | none                            |
| [Source](https://samlexamerica.com/wp-content/uploads/2020/01/12001-SEC-1230UL-0920-ES.pdf)                                                          | application/pdf | extracted | 1     | 128    | 0      | table_extraction_unsupported: 1 |
| [Source](https://samlexamerica.com/wp-content/uploads/2020/01/12001-SEC-1230UL-0920.pdf)                                                             | application/pdf | extracted | 1     | 123    | 0      | table_extraction_unsupported: 1 |
| [Source](https://samlexamerica.com/wp-content/uploads/2021/03/11001-SEC-1215-1230-2415UL-0920_Hrez.pdf)                                              | application/pdf | extracted | 56    | 3129   | 0      | table_extraction_unsupported: 1 |
| [Source](https://samlexamerica.com/wp-content/uploads/2023/04/Samlex-America_2023-Product-Catalogue-0423_R2_Lrez.pdf)                                | application/pdf | extracted | 36    | 4059   | 0      | table_extraction_unsupported: 1 |
| [Source](https://samlexamerica.com/contact/?message=I%20have%20a%20question%20about%2012%20Volt,%2030%20Amp%20Battery%20Charger.%20Safety%20listed.) | text/html       | extracted | n/a   | 17     | 0      | none                            |
| [Source](https://samlexamerica.com/products/)                                                                                                        | text/html       | extracted | n/a   | 61     | 0      | none                            |
| [Source](https://samlexamerica.com/products/automatic-charge-separator-acr-160/)                                                                     | text/html       | extracted | n/a   | 33     | 0      | none                            |
| [Source](https://samlexamerica.com/products/battery-guard-bgw-200/)                                                                                  | text/html       | extracted | n/a   | 36     | 0      | none                            |
| [Source](https://samlexamerica.com/products/battery-guard-bgw-40/)                                                                                   | text/html       | extracted | n/a   | 33     | 0      | none                            |
| [Source](https://samlexamerica.com/products/battery-guard-bgw-60/)                                                                                   | text/html       | extracted | n/a   | 33     | 0      | none                            |
| [Source](https://samlexamerica.com/products/battery-monitor-bw-01/)                                                                                  | text/html       | extracted | n/a   | 24     | 0      | none                            |
| [Source](https://samlexamerica.com/products/battery-monitor-bw-03/)                                                                                  | text/html       | extracted | n/a   | 28     | 0      | none                            |
| [Source](https://samlexamerica.com/resources-support/)                                                                                               | text/html       | extracted | n/a   | 26     | 0      | none                            |
| [Source](https://samlexamerica.com/resources-support/brochures-guides/)                                                                              | text/html       | extracted | n/a   | 16     | 0      | none                            |
| [Source](https://samlexamerica.com/wp-content/uploads/2023/03/40200-0004-2023-Samlex-Product-Catalogue-0223-ES_Lrez.pdf)                             | application/pdf | extracted | 36    | 4186   | 0      | table_extraction_unsupported: 1 |
| [Source](https://samlexamerica.com/product-category/ac-dc-power-supplies/)                                                                           | text/html       | extracted | n/a   | 97     | 0      | none                            |
| [Source](https://samlexamerica.com/product-category/ac-dc-power-supplies/?pf=base-station-radio-cabinets)                                            | text/html       | extracted | n/a   | 34     | 0      | none                            |
| [Source](https://samlexamerica.com/product-category/ac-dc-power-supplies/?pf=desktop)                                                                | text/html       | extracted | n/a   | 38     | 0      | none                            |
| [Source](https://samlexamerica.com/product-category/ac-dc-power-supplies/?pf=rack-mount)                                                             | text/html       | extracted | n/a   | 46     | 0      | none                            |
| [Source](https://samlexamerica.com/product-category/battery-chargers/)                                                                               | text/html       | extracted | n/a   | 46     | 0      | none                            |

## Capture diagnostic ledger

| Manufacturer     | URI                                                                                                                                 | Disposition       | Reason                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------- |
| Victron Energy   | [Source](https://www.victronenergy.com/live/_export/raw/ve.bus:manual_parallel_and_three_phase_systems)                             | non_authoritative | content_type_mismatch |
| Victron Energy   | [Source](https://www.victronenergy.com/live/ve.bus:manual_parallel_and_three_phase_systems?do=edit)                                 | non_authoritative | authentication_wall   |
| Victron Energy   | [Source](https://www.victronenergy.com/live/ve.bus:manual_parallel_and_three_phase_systems?do=login&sectok=)                        | non_authoritative | authentication_wall   |
| REDARC           | [Source](https://www.redarcelectronics.com/us/training-resources)                                                                   | failed            | http_status           |
| Blue Sea Systems | [Source](https://www.bluesea.com/products/5026/ST%20Blade%20Fuse%20Block%20-%2012%20Circuits%20with%20Negative%20Bus%20and%20Cover) | failed            | http_status           |
| Simarine         | [Source](https://simarine.net/wp-json/oembed/1.0/embed?url=https%3A%2F%2Fsimarine.net%2Fproduct%2Fpico-battery-monitor%2F)          | non_authoritative | content_type_mismatch |
| Simarine         | [Source](https://simarine.net/wp-json/wp/v2/product/3672)                                                                           | non_authoritative | content_type_mismatch |
| Dometic          | [Source](https://www.dometic.com/en/support/find-a-dealer)                                                                          | non_authoritative | authentication_wall   |

## Review packages and retained local evidence

| Manufacturer          | Review package ID                       |
| --------------------- | --------------------------------------- |
| Victron Energy        | review-package.61c1d5177bd6365f4040459f |
| Morningstar           | review-package.97edfa7c3c4e94ea7a79d403 |
| REDARC                | review-package.cb27b082cc63273ad6144f8b |
| Battle Born Batteries | review-package.aca579f1959235f23579d141 |
| Blue Sea Systems      | not prepared                            |
| Simarine              | review-package.8715b85612b44f5829f3c91a |
| Dometic               | review-package.6ad8e0bc24c5952556536a4b |
| Samlex America        | review-package.a6597615e34fd94be49fe6b0 |

The ignored recovery directory retains `campaign.json`, `final-batch.json`, `network.json`, `statistics.json`, `replay.json`, durable `jobs/` and `batches/`, and production `snapshots/`. These local artifacts are not redistributed or tracked. No downloaded manufacturer artifacts were created outside ordinary ignored runtime storage, so there were none requiring external temporary-source cleanup. No manuals/datasheets or copied manufacturer text were added to git.

## Handoff validation

`git diff --check` passed. Final HEAD remained the starting HEAD. Final exact `git status --short`:

```text
?? .local-corpus-draft-archive/
?? data/components/victron-energy.ekrano-gx-bpp900480100.yaml
?? docs/CORPUS_CAMPAIGN_WAVE_1.md
```

Only the campaign report is a new non-ignored repository file. Production code unchanged. No product approval, finalization, canonical write, staged change, commit, push or pull request. Protected paths untouched. Documentation records policy limits, retention ownership, partial acquisition versus extraction/qualification completeness, transport failures, empty-result semantics and replay limitations; no behavior or existing code comment changed.
