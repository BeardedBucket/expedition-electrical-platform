# Synthetic specification review lab

Run from the repository root in PowerShell:

```powershell
$reviewLabDir = node apps/ingestion-admin/demo/build.mjs
node apps/ingestion-admin/demo/serve.mjs "$reviewLabDir"
```

Open the printed `DEMO_URL` in a browser. The server binds loopback on an OS-selected unused port and serves exactly three assets. Ctrl+C stops it; the build remains in its fresh TEMP directory. No production server, suggestions loader, retained-store listing, capture adapter or canonical writer starts. Browser API definitions are bundled through shared UI imports, but are not called: every scenario remains `review_ready`, engineering verification never mounts, and unimplemented client operations throw locally. The static page also denies API connections through Content Security Policy. Source links use invented `example.test` URIs.

Choose a scenario, then **Open selected scenario**. Opening a scenario discards unsaved form input; recorded demo decisions survive scenario switches in memory until page reload. Enter any synthetic reviewer label. The label is unauthenticated. The UI uses the real ProductReview/SemanticAdjudication components. Eligible targets, conversion values and failure responses are explicitly scripted fixtures; this is a usability lab, not backend acceptance or captured manufacturer evidence. The real HTTP contract is validated separately using existing focused TEMP fixtures.

The shape/risk boundaries draw on the frozen [semantic mapping audit](../../../docs/REAL_PRODUCT_SEMANTIC_MAPPING_AUDIT.md), [identity audit](../../../docs/FLEXIBLE_PRODUCT_IDENTITY_AUDIT.md), [Wave 3 observation](../../../docs/CORPUS_CAMPAIGN_WAVE_3.md), and the preserved maintainer scenario baseline. These documents distinguish body/install dimensions, electrical direction/mode, missing concepts, exact identity and non-projection. The original 15 scenarios are synthetic proxies, not replays or new claims about named products. The optional frozen-source build described below now adds authorized retained observations read-only; no benchmark or retained record is changed.

| Scenario                     | Risk / useful exercise                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 01 Eligible scalar           | Map 40 A, explain, save and next; finish 60 A unresolved; return to saved review.                                      |
| 02 Continuous / time-limited | Same numeric rating with explicit five-second and temperature qualifiers; scalar preview refuses the conditioned item. |
| 03 Surge                     | Three-second, temperature-bound output power; retain or leave unresolved.                                              |
| 04 Accuracy / resolution     | Explicit invented 500 A shunt basis and precision; report a possible missing property, never ampacity.                 |
| 05 Sibling                   | Preview can convert; saving does not establish requested DEMO-1 applicability from DEMO-2.                             |
| 06 Shared table              | Ambiguous model column; bound subject/alternative text remains visible.                                                |
| 07 Input / output            | Compare readable directional property descriptions and units.                                                          |
| 08 Operating state           | Separate no-load, standby and quiescent consumption; no direct scalar target.                                          |
| 09 Physical                  | Body width is eligible; mounting spacing and installed clearance cannot borrow it.                                     |
| 10 Units                     | Exact 11.5 in source beside scripted 292.1 mm conversion; no editable numeric result.                                  |
| 11 Conflict                  | Both observations selected refuses preview; deliberately select one and explain.                                       |
| 12 Unsupported concept       | Conditional front ingress statement; missing-property report creates no engineering field.                             |
| 13 Missing provenance        | Scope, units, source and conditions remain unknown; no invented defaults.                                              |
| 14 Layout / scale            | 240 proposals, long notes/IDs/URIs/digests/locators; searchable queue, one active editor, lazy diagnostics.            |
| 15 Recovery / history        | Prior unresolved decision, failed save, stale save, failed reload, and append-only correction.                         |

Manual visual acceptance (human review remains required):

1. Use actual browser responsive viewport widths **360, 390, 768, 1024, 1280, 1440 CSS pixels**, at 100% zoom. At desktop, expect the queue alongside the connected evidence/editor workspace when space permits. At tablet/narrow widths, expect readable stacked ordering. No page-wide horizontal scrolling or character-per-line metadata columns is acceptable.
2. Repeat scenario 14 with **Constrained container width** set to every listed width inside a wide desktop viewport. The control limits the review container; it does not emulate a browser viewport. Also test 200% zoom. Search `Source specification 239 `; clear search and scroll the queue. Open exact evidence locations/capture details and use their local horizontal scrollers to read/copy full technical strings. Long notes must wrap by words.
3. In scenario 01 choose Map, search `output amps`, choose Continuous output current, inspect source versus converted value, add rationale, and Save and next. Verify only the next heading receives focus, the queue shrinks, and no approval occurs. Record unresolved on the last item, return to saved review, open the reviewed queue and revisit both outcomes. Revisit records through the queue without expanding diagnostics.
4. Open each `?` help control with Tab, Enter/click/tap; read with a screen reader. Escape and Close must return/retain focus on the trigger. Leaving the control closes help. Required rationale, unknown context and authority warnings must remain visible without opening help. Compare input/output and W/VA descriptions under matching-property details.
5. Exercise scenarios 02–13 using the scenario index. Confirm actual duration/temperature/basis and conflicting observations remain visible, exact source identifiers remain accessible, and unsupported meanings can be safely retained/unresolved. Mapping failure must preserve notes and allow an explicit safe decision. Do not strip conditions to obtain a preview.
6. In scenario 15 click each failure control immediately before saving. Failed save preserves input/history. Stale save reloads but does not replay; inspect and explicitly recheck. For failed reload, explicitly reload again and reconfirm evidence. Correcting a decision appends a revision; inspect history in **Product field approval and advanced proposal details**. Product approval choices remain separate and unavailable in this synthetic lab.
7. Inspect the active specification and advanced area at every width. Only one editor should dominate the normal flow. Diagnostics should remain closed initially and should not introduce a second editor. Save/next should be visually primary, with disabled reasons understandable. Capture desktop and narrow screenshots for human acceptance, and record any remaining readability or hierarchy defects.

Observed browser status: the final isolated build was rendered at all six listed viewport widths without measured page-wide horizontal overflow. At 1440px the queue/evidence/editor widths were approximately 225/517/513px. A synthetic scalar save advanced focus and the returned queue. Narrow explorer cancellation and desktop selection preserved the draft and returned focus to the Browse trigger. Desktop and narrow screenshots are supplied with the task handoff. Human visual acceptance, 200% browser zoom and touch/screen-reader checks remain required. Automated structural assertions do not establish visual acceptance.

## Authentic frozen-source reference lab

Run `node apps/ingestion-admin/demo/build.mjs --frozen` from the repository. Then run `node apps/ingestion-admin/demo/serve.mjs "<exact TEMP directory printed by build>"` and open the loopback URL it prints. Stop that terminal with Ctrl+C when finished. The ordinary build without `--frozen` still contains the original 15 invented scenarios.

The optional build reads only `artifact-manifest.json` and three exact JSON text observations in `$env:TEMP/expedition-document-extraction-benchmark/outputs/pdfplumber-text/`. It checks their frozen SHA-256 identities, source metadata and page. BMV-712 Smart, Morningstar SS-10L-12V and Samlex EVO-2212 retain original extracted text rows and headings. No oracle/adjudication output, external PDF, capture or preparation path is followed. Manufacturer text is injected into a fresh TEMP browser bundle, never copied into repository fixtures. The PDF digest is metadata retained in the observation; the external PDF was not reopened or rehashed.

These examples are **assembled isolated review DTOs**, not actual qualified facts from a production job. Flattened table rows do not prove column/model membership; applicability and qualification remain unknown. No capture artifact ID/reference is invented. Eligibility is explicitly scripted empty and saves affect memory only. Backend target discovery is tested separately using existing synthetic focused HTTP fixtures; it was not run against these authentic observations. A real integrated path needs genuine capture-bound qualification/preparation artifacts outside this UI task. Do not interpret the reference lab as successful product ingestion or beta/V1 completeness.

## Final human usability review

Use real browser/device viewport widths 360, 390, 768, 1024, 1280 and 1440 CSS pixels, plus 200% browser zoom. The lab's constrained-container selector is useful for an extra layout check but is not actual browser viewport emulation. Confirm:

1. Queue → evidence → interpretation order, readable desktop columns or narrow stacking, no page-wide horizontal overflow. Long exact IDs/locators/URIs remain locally scrollable and copyable. Product-level authority actions remain separate.
2. Single exact source summary has no checkbox. Competing statements start unselected; choose beside wording. Changing binding clears the target/preview and retains rationale. Source selection never means mapped status.
3. Search source values/status in one-item, multi-item and 240-item jobs. Verify counts, clear, empty state and reviewed-group discovery without losing a draft.
4. Choose Map. Type `output amps`, `current`, `voltage`, `dimensions`, and a nonexistent phrase. See eligible and known unavailable concepts without automatic selection. Open explorer; search/category/filter, read details, cancel/Escape and return to the same form. Select only an eligible exact property; confirm server preview.
5. Tab to help leaves it closed. Click/tap/Enter/Space toggles both ways; Close and Escape restore sensible focus. Check focus visibility and screen-reader labels. Essential model/condition warnings stay visible.
6. For all six dispositions, inspect readiness and focus missing fields. Optional rationale stays optional for unresolved/evidence-only. Save-and-next moves only after successful persistence. Correct a durable decision and inspect append-only history. Exercise stale/failed-save recovery with retained input.
7. Inspect sibling model mismatch, 500 A measurement basis, surge duration/temperature and operating-state limitations. A normalized number must not imply model projection, approval or verification.
8. Open each authentic retained-source scenario and inspect its exact identity disclosure. Observe unproven qualification, no eligible mapping, and safe unresolved/evidence-only review. These are source-faithful UI references with explicitly simulated discovery.

Human acceptance of usability and visual quality remains required. Screenshots and browser measurements in the task handoff report only actions actually performed, never review-time estimates or engineering acceptance.
