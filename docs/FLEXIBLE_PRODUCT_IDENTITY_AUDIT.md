# Flexible product identity and canonical intake suggestions

## Contract and behavior

`ProductIntake` retains its existing artifact identity/version metadata and requires non-empty
`manufacturer` and `product_model`. `manufacturer_part_number` and `official_product_uri`
are optional; at least one must be supplied. Supplied identifiers cannot be blank, null,
or non-string. URLs use the existing HTTP(S) capture URI policy, including blocked-host
checks. The API trims surrounding whitespace without changing case or spelling. The form
omits blank optional controls from the request. Persisted intake properties remain absent.
The JSON schema adds an either-identifier requirement while accepting existing two-identifier
artifacts; historical intake digests are not rewritten.

With a URL and no MPN, acquisition uses the supplied official seed. Qualification uses exact
model row/cell evidence only when no MPN is requested and emits `exact_product`, rather than
claiming that a model is an MPN. With MPN supplied, exact MPN matching retains precedence.
Prefix matches, mismatched explicit identities, missing row evidence, and multiple exact
identity rows in a table remain unresolved. Publisher metadata, officiality, corroboration,
semantic mapping, review snapshot consistency, and approval requirements remain enforced.
Source facts may contain an MPN but never mutate intake. An MPN-less candidate retains
provisional identity completeness and requires human review; promotion omits `part_number`
when the candidate has none. No confidence number, percentage, tier, or correctness score
was added. Existing identity lifecycle states express evidence completeness/review needs.

With MPN and no URL, the runtime creates and durably reloads a
`source_resolution_required` job. Preparation is rejected before changing state, calling
an adapter, or creating capture artifacts. The UI displays the unresolved state, does not
automatically prepare it, and does not poll it as a running operation. Standalone workflow
and acquisition entry points also stop with explicit source-resolution messages.
There is no URL amendment operation in the current operator API: a maintainer can create
a new intake with a verified URL, preserving the original request.

## Identity-assumption audit

Classification: **A** already safe with absence; **B** adapted within existing generic
semantics; **C** operation genuinely needs the identifier. Manufacturer and model remain
required throughout this production path. Classifications below concern optional identifiers.

| Production boundary / implementation | Class | Findings and disposition |
| --- | --- | --- |
| `production-contracts.ts`: ProductIntake | B | Both identifiers were required strings. Now optional with explicit either-identifier validation. Artifact metadata remains required. |
| `production-ingestion.schema.json`: productIntake | B | Required both identifiers. Now `anyOf` requires at least one; supplied strings must be non-empty, with supported URL scheme. |
| `validateProductIntake` | B | Replaced four-field requirement with required manufacturer/model, optional-present checks, existing URI policy, and either-identifier rule. Validation reports malformed runtime types without throwing. |
| `source-acquisition.ts`: domain policy, seed capture, discovery, acquisition artifact | C (URL), A (MPN) | All discovery starts from captured seed content. URL is necessary; no MPN requirement. Missing URL stops before domain policy or capture. No guessed paths/domains or fake capture URI. |
| `http-capture.ts`, `source-capture.ts`, capture adapters/types | C (source URI), A (MPN) | Operate on an explicit source request URI and evidence metadata, rather than ProductIntake MPN. Existing capture contracts remain unchanged. |
| `document-extraction.ts`, extraction adapters, extraction artifact builder | A | Operate on captured evidence, source references, blocks/cells and extraction diagnostics. Neither optional intake identifier is used to invent document content. |
| `production-contracts.ts`: qualification target, determineApplicability, qualifyFromBlock | B | Existing target precedence is explicit identifier, MPN, model. Exact model fallback existed but mislabeled evidence as MPN/SKU. Fixed binding kind; added conservative multi-row ambiguity handling. |
| `manufacturer-acquisition.ts`: acquireManufacturerRecord | C (MPN) | Separate embedded-record acquisition operation intentionally requires an exact MPN to select a raw JSON record. It already returns `requested_identity_missing_part_number`. Not called by production review preparation; not loosened to guess a record. |
| `manufacturer-acquisition.ts`: resolveManufacturerAcquisitionProfile / Strategy | A | Profile selection uses case/whitespace-equivalent established manufacturer spellings, then strategy matching uses a supplied URI. These functions select policies, not product URLs. |
| `reconciliation.ts`: fact grouping and whole-intake reconciliation | A | Uses artifact/digest scope and explicit applicability bindings, including existing `exact_product`. No intake MPN requirement or fallback guesses. Existing corroboration policy remains. |
| `reconciliation.ts`: legacy product reconciliation / identityStatus | A | ProductIdentity already permits absent MPN. Compatible model claims yield provisional identity completeness; missing/conflicting claims remain explicit. Retained this conservative behavior. |
| `production-semantic-bridge.ts` | A | Uses source labels, qualified applicability, reconciliation, explicit field mappings and referenced artifacts. Neither optional identifier is a canonical fact default. |
| `production-candidate-bridge.ts`: applicableIdentity / candidate construction | B | Comparison previously called `.trim()` on required MPN. Guarded missing MPN; existing exact-product model claim is supported; candidate identity omits absent MPN. Source officiality/publisher requirements remain. |
| `candidate-builder.ts`, `contracts.ts`, normalization / validation | A | ProductIdentity already optional; source claims and identity lifecycle states remain explicit. Provisional candidates require review; unresolved/conflicting candidates are blocked. |
| `production-review-package.ts` / ReviewPackage | A | Exact candidate/intake comparisons allow both MPN values absent. Digests and source/fact/proposal evidence references bind the request and review snapshot. No invented identifier. |
| `production-approval-bridge.ts`, `production-promotion.ts`, `production-ingest-finalize.ts`, guarded writers | A | Require matching review package/snapshots and human evidence decisions. No MPN/URL minimum beyond supported candidate/source evidence. Tested URL-only human approval and actual temporary canonical write. |
| `promotion.ts`: canonical ID, proposal identity / proposal record | A (ID), B (record) | ID already uses manufacturer/model when MPN absent. Replaced absent-MPN `null` insertion with omission; kept existing collision and canonical schema validation. |
| `corpus-workflow.ts` / canonical collision validation | A | Existing MPN collision checks are conditional on presence; canonical IDs remain independently checked. No invented part number. |
| `production-ingest-workflow.ts` | B / C (URL acquisition) | Validates flexible request, omits absent qualification MPN, preserves original intake and refuses URL-less acquisition explicitly. |
| ingestion-runtime `job-service.ts`, `job-store.ts` | B | Creation now distinguishes `created` from `source_resolution_required`; durable state allowlist updated. Preparation still only permits `created`. |
| ingestion-runtime `codec.ts` | A | Tagged encoding preserves property absence separately from present undefined. JSON intake validation rejects undefined input properties; no identifier defaults on reload. |
| ingestion-admin `server/api.ts` | B | Exact allowlist retained. Manufacturer/model required; only supplied optional properties normalized/validated. Either-identifier POST works, neither fails, unresolved prepare returns 409. |
| ingestion-admin `server/operator-views.ts` | A | Projects optional identity properties without substitute facts; HTTP JSON omits undefined identifiers. New runtime state propagates directly. |
| ingestion-admin browser `api.ts` | B | Draft controls remain strings for editing. HTTP payload omits blank optional values. Suggestions use an independent project-data endpoint. |
| ingestion-admin `App.tsx` | B | Only manufacturer/model required. Shows identifier guidance, explicit absence and source-resolution state. Preserves deliberate blank reset, success reset, failure preservation, and active-draft stability. |
| pilot/configuration modules (`epoch-pilot.ts`, `victron-pilot.ts`, `pilot-config.ts`) | C for their exact-MPN replay operations | Separate known-product replay contracts intentionally require MPN. These are not generic ProductIntake production requirements and remain unchanged. |
| scripts | A | No ProductIntake identity consumer found. Data validation is deliberately not run over the local protected draft. Regression tests validate temporary catalogs instead. |
| tests | B | Existing two-identifier fixtures continue to pass. Added contract, applicability, ambiguity, full promotion/write, durable omission/state, API omission, canonical suggestions, free-entry and UI scoping tests; retained existing reset tests. |

## Source-resolution architecture boundary

`SourceAcquisitionRequest` contains ProductIntake; `acquireOfficialSources` captures its
`official_product_uri` and discovers links/embedded document URLs from that captured seed.
The SourceCaptureArtifact requires a real `requested_uri`. Neither the HTTP adapter nor
profile/strategy resolution searches for an official product page from MPN. The separate
embedded manufacturer-record extractor also starts with already captured HTML.

Reviewed profiles for Epoch Batteries, REDARC and Victron Energy provide official domains,
publisher identity, optional approved/document domains, reviewed strategy path constraints,
provenance and document-role/content rules. No reviewed manufacturer alias table is currently present.
Strategy reference URIs are profile evidence, not a general product lookup table.

A new official-source resolver must sit after intake validation/persistence and before
seed acquisition. It needs an approved discovery mechanism constrained by reviewed
manufacturer/domain data; captured official evidence proving the exact requested MPN and
model (including distinguishing variants); source locators, retrieval/content provenance,
and an explicit resolved/unresolved/ambiguous outcome. A resolved seed should be a separate,
versioned evidence artifact bound to the original intake digest, rather than rewriting the
operator-supplied request. Redirect officiality and capture policies must still apply.
Choice of discovery provider/search policy, resolver artifact contract and human acceptance
boundary requires architecture review before implementing this stage. No crawler/search
architecture was introduced in this task.

## Suggestions and matching

The API exposes `GET /api/ingestion/suggestions`. The server uses Git's tracked canonical
component inventory and the existing `loadComponentLibraryFile` validation/normalization
API, exported through a package subpath. It excludes the protected Ekrano path before
opening any file. It never walks the local archive, includes untracked drafts, or reads
previous jobs. Product model/MPN suggestions require `verification_status: verified` and
retain the canonical component ID as provenance. Partially verified and unverified records
cannot supply product suggestions. Reviewed acquisition profiles are schema-validated by
the shared runtime loader and supply established manufacturer spellings.

At audit time all seven tracked components are unverified, so the current product suggestion
list is empty. Manufacturer suggestions are Epoch Batteries, REDARC and Victron Energy.
Model and MPN scoping is implemented and tested using verified-record fixtures; it becomes
available when authoritative verified records exist. No source URL suggestions are offered.

Matching trims query whitespace and compares case-insensitively. Manufacturer suggestion
search uses substring matching for display only. Model lists require case/whitespace-exact
manufacturer selection; MPN lists additionally require exact model selection. `Victron`
does not scope models for `Victron Energy`. No fuzzy alias or free-text rewrite occurs.
Application-owned datalists and explicit selectable canonical-value buttons preserve full
free entry. Explicit buttons also surface matches with surrounding query whitespace,
independently of native datalist filtering. Browser-history autocomplete stays disabled.

## Validation and correction record

Implementation corrections covered runtime profile-loader extraction, existing mocked-create
state propagation and evidence fixture requirements (reviewed publisher plus existing
corroboration). No source/review requirements were relaxed to make a test pass. Schema edits
were narrowed to the intake definition; formatting is restricted to changed files.

Validation passed: 767 ingestion tests across 37 files, 32 runtime tests across three files, 18 admin API/suggestion tests across two files, and 15 frontend tests (832 tests total). The 32 focused identity tests also passed after verifying uppercase HTTP(S) schemes against the existing capture policy. Root build (all workspaces), lint, format:check and git diff --check passed. Vitest/Vite configuration access required approved sandbox retries; no code changes were made to bypass the sandbox. No branches, commits, staging, pushes,
merges, PRs, or repository-permission changes were performed. The protected archive and
Ekrano YAML were preserved and not read or used.

## Focused optional-service correction

API startup supplies a lazy suggestion provider; it no longer awaits suggestion data. Only
GET /api/ingestion/suggestions invokes that provider. Successful requests return the same
suggestion DTO. Failures return HTTP 503 and the safe message “Canonical suggestions
unavailable. Free entry remains available.” Internal details remain in the existing
request-context diagnostic log. No failed load is replaced with an empty corpus, including
an unconfigured provider. Each request may retry; no cache or retry infrastructure was added.
Job create/get/list/prepare remain independent of this optional provider.

The operator now sees: “Official source resolution is required before preparation. This job
preserves your original request. Until source resolution is implemented, create a new intake
with a verified official manufacturer URL.” No amendment or automatic resolution operation
was added. All approved identity, applicability, promotion, suggestion provenance and form
reset behavior remains unchanged.

The engineering-core manifest change is exactly one package export:
`./component-library-loader` maps types to `./dist/component-library-loader.d.ts` and import
to `./dist/component-library-loader.js`. The existing loader implementation and build script
are unchanged. There is no new engineering-core dependency, browser runtime import, or
circular package dependency. The Node-only admin suggestion service consumes this subpath;
browser references to its DTO use erased TypeScript type imports.

Focused correction validation: 20 API/suggestion tests, 16 frontend tests, 32 runtime tests
and 54 identity/workflow/finalization tests passed (122 total). All four requested workspace
builds, lint, format:check and git diff --check passed. Implementation and tests passed on
the first pass; no additional correction pass was needed.
