# Human correction workspace

The editable specification workspace has one **Correct or add information** entry point. It works for automatic mappings, unmapped observations and revisitable human decisions. The server's existing review-ready, unapproved, unfinalized gate owns edit authority. A correction never approves, promotes, publishes or engineering-verifies a product.

The reading order is current record, retained source evidence, correction-specific inputs, comparison, reason and save. Desktop panels share this sequence; container and viewport rules stack them on narrower screens. Technical identifiers and validation internals remain expandable. Human corrections remain provisional.

## Draft ownership and preview sequencing

The editor owns separate existing-record and missed-addition drafts. Changing correction type preserves both; the separate addition has its own group ID and replaces no existing facts. A retained source field, representation or property selection stays with its assertion. Closing or changing specifications asks before discarding unsaved work. Reconciliation choices do not grant grouping authority: the unchanged backend checks source positions and refuses conflicting or genuinely separate facts.

Source-only and model-only modes reuse current values. Engineering-only correction reuses a source seed without assigning a hidden property. The Node DTO convenience seed starts from the observation's original value coordinates and capture, uses actual retained cells/blocks, and checks each proposed model relationship with the existing domain validator. Literal, unambiguous duration/temperature and a recognized leading quantity/unit may prefill fields while preserving complete wording. This creates no engineering eligibility; discovery, preview and save independently revalidate source context. Failed or uncertain seeds remain visibly unresolved. Existing human statements retain their human origin.

Property discovery reuses the ordinary reviewed catalog, picker and explorer. A target-free representation filters discovery without selecting a property. Search, dropdown and explorer selection all enter the same preview path. Every requested interpretation in a split needs an explicit target; the server validates all assertions. Qualified representations retain material source conditions. An incomplete extraction uses draft-specific readiness, with no mapping promise.

The read-only preview tolerates an empty reason so source validation does not wait for audit prose. The server substitutes a validation-only reason internally to reuse the closed intent validator; this placeholder is never persisted and the response digest still binds the actual request. Durable saves retain strict nonempty rationale validation. Typing the reason does not invalidate an otherwise identical source preview.

Discovery and preview responses are ignored after their request becomes stale. A mapping recheck waits for refreshed discovery rather than submitting against a previous eligible list. Source-only previews do not rerun merely because irrelevant discovery state changes. Comparison displays normalized values only from the matching current server response, and distinguishes a valid interpretation from an assertion actually projected into the candidate. Conflicts and restrictions remain visible.

Failed saves keep input. A CAS refusal requires explicit reload and recheck; a replaced source group cannot be silently replayed onto another group. The returned durable response owns replacement proposal IDs, so a successful save selects the returned effective item. History distinguishes effective revisions, superseded revisions and unapplied drafts; original automatic observations remain visible when reopening a correction.

## Evidence navigation

Source search and engineering-property search have distinct labels and scopes. Source search filters the entire selected retained document before existing fifty-entry paging. Terms must all match retained text, entry kind or locator metadata. This is literal discovery, never semantic inference or a source authority upgrade.

Six result cards and 180-character synopses are presentation bounds chosen to keep the inline correction readable; neither truncates evidence or limits searchable entries. The expanded browser exposes the complete current page and its paging controls. Selected passage details and saved citations use full retained text. The 1400-pixel maximum overlay width is a presentation choice to keep passages and evidence roles legible, not an evidence or engineering limit.

Selecting a passage does not immediately modify a source assertion. The reviewer explicitly chooses statement, condition and/or model roles, then uses the passage. A model citation never automatically establishes a relationship. A source quote and an editable human interpretation remain separate. Replacing nonempty manufacturer wording from a quotation asks before discarding that wording. Flattened PDF text does not acquire verified table-cell or heading ownership through this UI.

The browser owns its modal focus and body-scroll lifetime, restores them on close, and keeps query, selection and roles in the parent navigator. Closing it does not remount the correction draft. Keyboard selection focuses the full passage; Escape and focus trapping work alongside native-dialog support. Layout stacks details under results at narrow widths.

## Isolated interactive lab

From the repository root in PowerShell:

```powershell
$labDirectory = node apps/ingestion-admin/demo/human-lab-build.mjs
node "$labDirectory/server.mjs" "$labDirectory"
```

Open the printed URL in a browser. The build and each job store use a newly created TEMP directory. The server rejects a storage argument outside its exact TEMP prefix and fails if port 5177 is occupied. The launching terminal owns server lifetime; use Ctrl+C to stop it. No live canonical destination, approval, promotion, verification or external source-fetch capability is provided. The asset map and scenario endpoint are bounded; browser job queries do not become filesystem paths.

Thirteen selectable synthetic fixtures cover automatic/wrong/unmapped interpretations, wrong values, missed and combined facts, duplicates, missing model scope, sibling/ambiguous refusal, qualified/cropped ratings and many retained passages. Reopen/supersede/history, preview failure, stale save and narrow navigation are additional interactive actions on these fixtures. Scripted automatic faults change only fresh synthetic observations; capture and document digests are checked unchanged. Real normalization, validation, candidate construction, CAS and replay remain active. Genuine frozen manufacturer-wording tests are separate and do not establish original PDF/table qualification.

The transport-failure button arms one explicitly simulated client failure. Retrying uses the real API. The concurrent-correction button records a real, separate TEMP correction and intentionally leaves the displayed snapshot stale. An explicit reload cannot blindly replay a replaced group.

## Manual acceptance

Use a desktop viewport around 1440 CSS pixels and a real narrow viewport around 390 pixels; the lab's width control additionally exercises container layout. Visual acceptance requires human inspection, independently of test success.

1. Open automatic, wrong-property and unmapped scenarios. Confirm one correction entry, original/current values above source search, clear provisional origin, no default property, and input-current preview of 0.5 A without source retyping. Check dropdown, inline search and full property explorer.
2. Correct the wrong-value scenario to the retained 500 mA using explicit statement and row-model evidence. Switch to model repair, then a missed addition and back; entered drafts must survive. Add the missed paragraph with the same-statement relationship.
3. Split the combined passage into mass and current assertions; inspect each assertion's required fields and preview. Associate only the duplicate same-cell observations. Confirm genuine conflicts cannot be merged or presented as unconditional mappings.
4. Repair missing model scope using the actual EX-1 row. Try sibling or ambiguous evidence: the server must refuse unsupported scope. Save an unresolved draft with a reason rather than forcing a mapping.
5. Map the qualified rating using output direction, five seconds and 25°C. Inspect normalized and qualified results. Crop to 150 A and omit material conditions in the cropped scenario: validation must refuse. Do not bypass it.
6. Inspect current/proposed values and units, enter a correction reason, save, reopen and supersede. Confirm returned current item, original extraction, effective/superseded revisions, rationale/citations and no approval or verification.
7. Arm one preview failure; confirm input remains, no authoritative result appears, and explicit recheck succeeds. Record a concurrent TEMP correction; stale save must refuse without automatic replay. Inspect the retained input and explicit reload/reopen guidance.
8. Search few/many passages, including positive and empty searches. Open the full source browser, select a passage and explicit roles, close with Escape and confirm restored focus/query/draft. Search beyond the first fifty entries.
9. At narrow width, repeat correction and both explorers by keyboard. Inspect text wrapping, source values, tables/identifiers, focused help, primary save, status/error readability, focus restoration and absence of whole-page horizontal scroll or unnecessary nested scrolling.

## Remaining boundaries

This UI does not add canonical properties or infer missing manufacturer meaning. Unavailable catalog concepts and genuine canonical-model gaps remain unresolved. Evidence search scans existing retained documents; DTO seed generation and replay still use the existing evidence-storage architecture. Corpus-scale detached evidence duplication and eager seed construction remain performance/storage concerns for a separately scoped redesign. No broader documentation audit or foundational engineering change is part of this UX slice.
