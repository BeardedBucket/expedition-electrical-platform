# Phase 6 recommendation and tradeoffs handoff

Primary checkout: `C:\Users\Bearded Bucket\Documents\GitHub\expedition-electrical-paltform`.
Branch: `feat/recommendation-tradeoffs`. Starting/current HEAD:
`e90bda5a28aeee3f50551a210ccd406fb27f0e7b`, equal to local `main` at branch
creation as recorded by the checkout reflog. No worktree/branch creation or switch,
index, commit, push, merge, rebase, reset, configuration, permissions or repository
maintenance operation was performed. Protected local paths were excluded from
content reads, enumeration, corpus membership and validation. Their pre-existing
untracked status metadata remains unchanged. All milestone changes are unstaged.

## Implemented result

The dedicated Node-only recommendation entry composes complete reconstructible
Phase 5 selections, explicit exact role choices and the existing Phase 3 evaluator.
Explicit option sets are authoritative caller intent. Automatic construction is
implemented as a complete deterministic bounded Cartesian product of retained
exact ELIGIBLE/UNRESOLVED witnesses, excluding BLOCKED witnesses without any
preference pruning. BigInt option/pair preflight reports overflow with complete
counts and deferred analysis, never samples/truncates. All supplied sources are
considered; the implementation does not claim enumeration of unsupplied Phase 5
artifacts or architectures. Fixed roles stay fixed, separate roles stay separate
physical instances, combined roles stay one role, and banks count physical units.

Unmaterializable missing-record/null-witness/symbolic-assembly candidates remain
separate with exact Phase 5 snapshots and reasons. Explicit unmaterializable choices
reject rather than inventing records, ports or quantities. Every materialized option
preserves the complete exact passport and its verbatim satisfied/unresolved/blocked
status. Separate satisfied and unresolved fronts retain every non-dominated option.
Blocked options and advisory-suppressed/excluded options stay inspectable with
structured exclusions; no cross-class ranking or opaque score exists.

Input/output/profile/policy contracts and policy revision: `1.0.0`. Engine revision:
`recommendation/1.0.0`. Policy lifecycle remains draft. Phase 3 now has an additive
optional schedule-provenance contract under schema `2.0.0`, with evaluator/rule
revision `1.3.0`. Phase 4 generation/contracts, Phase 5 selection artifacts/gates/
revisions and production records are unchanged.

The additive Phase 5 exact handoff option `project_demand_schedules` supplies explicit
late Phase 3 endpoint accounting when upstream scheduling was absent. Inspection
showed Phase 4 deliberately marks supplied schedules unresolved, while Phase 3 needs
explicit endpoint schedules for complete energy accounting. Late scheduling changes
no Phase 4 condition or endpoint identity/domain/required W. Unknown/duplicate IDs
and replacement of existing upstream schedules reject; identical upstream schedules
retain their unresolved interpretation. Missing timing stays unknown. Sources and
passports retain late schedules explicitly with independent machine-readable
`schedule_provenance`; original requirement provenance locates only the endpoint.
No generated assumptions, appliance records, default horizon, dispatch or shared
capacity interpretation was added. Existing handoff calls behave identically.

Facts retain typed semantic kind, stable subject/option identity, known/absent/unknown/NA
state, units, direct/derived identity, completeness, ownership, snapshot/source locators,
review state and source references. Derived quantities/totals carry exact source/fact
inputs, formulas, multiplicity, known subtotals and unresolved contributors. Original
units/wording absent from canonical records are explicitly unavailable, not recreated.

Prices remain explicit per-unit user/commercial/builder snapshots with currency and
source/context; only supplied timestamps survive. No FX lookup/conversion exists.
Mixed currencies remain separate subtotals with unknown overall cost. Owned equipment
is zero incremental acquisition cost only under explicit fixed-role cost basis.
Existing `weight_kg` supports complete/incomplete physical-unit totals; missing or
unreviewed contributions never become zero. Dimensions and qualified body exclusions
remain component facts without a fake system envelope/installation fit. No generic
component schema extension or production corpus change was needed.

Optional capability facts use explicit reviewed positive/negative canonical assertions.
Unknown remains distinct from absent; system facts prove only an explicitly available
function on some selected device, not installed protocol/integration/monitoring target.
Optional feature observations have explicit user/commercial/builder ownership at a
narrow boolean/absence/unknown/NA extension seam. Manufacturer count and selected
power-path count are descriptive until explicitly preferred. Legacy builder ranking
is not imported because its defaults/weights/unknown ordering do not implement this
portable exact-system boundary. Builder inventory interpretation is deferred.

Existing advisory evaluation is reused with explicit records/evidence/timestamp/config.
Full assessments and warnings remain visible, with suppression/exclusion governing
recommendation admission separately from unchanged engineering truth. Missing context
is explicit unknown; empty context means only none in the supplied snapshot. Date
arithmetic requires timezone-explicit timestamps or ISO date-only values.

Profiles have explicit ordered priority tiers, equal-priority Pareto criteria, numeric
min/max or optional present/absent preference. Empty profiles tie all same-class options.
Hard requirements, unknown syntax, duplicate dimensions and opaque scores reject.
Within a tier, wins without losses dominate; opposing wins are incomparable; any
unknown/NA/unit mismatch withholds definite comparison. Lower tiers apply only after
complete higher-tier equality. Every dimension/reason/fact ID remains in pairwise
records, with decisive tier identifying authority. Code-point order stabilizes content
only and never breaks ties. Reordering sources/choices/equal-tier criteria preserves
truth; adding options changes fronts only via mathematical dominance.

Conservative configurable application bounds: 16 sources, 128 options, 8,128 potential
pairs, 32 criteria, 4,096 observations/accounting states and 100,000 fact records.
They have no empirical production tuning or engineering/safety meaning. Metadata
strings/source-reference bounds and independent earlier-layer ownership are documented
in [RECOMMENDATION.md](RECOMMENDATION.md), alongside near-code sequencing, copy,
preflight, unknown, currency, derivation and failure rationale. Errors return no partial
artifact. Operational overflow reports/rejects without preference pruning.

Serialization/parse reconstruct the entire selection → exact passport → facts →
pairs/fronts/exclusions/deferred artifact. Rehashed nested and envelope edits cannot
replace reconstruction. External replay additionally binds exact live profile, context,
choices, selections/corpus and policy. Hashes are content identity, not authenticity,
approval or evidence. Coherently changed authoritative inputs are new inputs and need
external identity comparison to distinguish them from the old artifact.

## Human-review correction: schedule provenance

The human-review finding was confirmed. The earlier handoff carried late timing
inside a demand whose only locator identified the original requirement. That
representation could misattribute timing to upstream intent; prose alone did not
repair it. The machine-readable correction is implemented below. Phase 6 remains
subject to human review, not approved by this handoff.

The generic optional Phase 3 field `project_demands[i].schedule_provenance` has
three closed forms:

- `{ origin: 'requirement', requirement_id, pointer }`: timing asserted by an
  upstream requirement; Phase 5 uses its exact original `/schedule` locator.
- `{ origin: 'evaluation_input' }`: explicit exact project/evaluation accounting
  input, with no fabricated external citation. Phase 5 emits this only when timing
  was absent upstream.
- `{ origin: 'unknown' }`: attribution not known. Legacy omission means unknown
  as well; no requirement or manufacturer origin is inferred.

Endpoint `provenance.requirement_id` and `provenance.pointer` continue to support
identity/domain/required W only. Schedule value and attribution are separate fields.
An identical late repetition of an upstream schedule retains upstream ownership;
different overrides, duplicate entries and unknown demand IDs still reject. The
schema requires a schedule when attribution is explicitly declared, without
supplying missing duration or W. Existing Phase 3 and Phase 5 callers retain valid
engineering/numerical behavior. No default schedule, generated assumption, fake
component or manufacturer evidence was introduced. Genuine assumptions remain
unchanged; demand timing evidence references remain empty.

Phase 3 keeps exact input snapshots intact. Each project-demand decision retains
the whole demand with independent schedule attribution, and each resolved
project-energy calculation retains endpoint provenance plus schedule provenance.
Omitted attribution becomes an explicit unknown in the trace only. The passport
alone exposes the distinction. Origins never affect structural status, gate truth,
shared capacity, dispatch, concurrency, safety or inherited unknowns. Complete
Phase 3 device-side accounting can coexist with unresolved overall authority.

Input and passport hashes include origin. Serialization/parsing/replay reconstruct
all trace outputs, rejecting rehashed input/decision/calculation origin edits.
Phase 6 reconstructs the authoritative Phase 5 handoff too, rejecting even a
coherently regenerated nested passport with a different origin. External
recommendation replay compares the exact live input/policy identity. Different
truthful standalone origins yield distinct input/passport identities with identical
engineering results. Hashes authenticate neither source nor author: coherently
evaluated changed standalone inputs are new valid artifacts; Phase 3's external
replay checks components/rules, not an unavailable requirement-source registry.

The existing Phase 3 revision comment owns interpretation/composition and requires
evaluator/rule revisions to move together. Portable trace semantics changed, so
both move from `1.2.0` to `1.3.0`; exact-revision replay rejects older artifacts.
The schema field is optional and preserves old valid inputs, so schema `2.0.0`
remains. Phase 5 artifacts do not consume late timing and remain `1.0.0`; Phase 6
is still the uncommitted `1.0.0` milestone. No mechanical revision bump elsewhere.

Documentation/comment work covers the attribution boundary, legacy unknown trace,
upstream ownership precedence, schema compatibility, revision ownership and replay
versus authenticity. No new limits, engineering constants or ownership mechanisms.

Correction-only inventory (12 files): five previously clean tracked files now
modified (installed-system rule, whole-system-input schema, passport contracts,
installed-system context, project-demand evaluator); one new regression file; and
six existing Phase 6 files revised (product-selection handoff, ARCHITECTURE,
PRODUCT_SELECTION, WHOLE_SYSTEM_BACKEND, RECOMMENDATION and this handoff).

## Tests and validation

Focused provenance correction tests: 29 across one new file, covering all 16
requested regression areas plus closed-schema and exact-revision boundaries.
No existing tests were weakened or changed.

Focused Phase 6 tests: 95 across two files. They exercise exact upstream status/gates,
satisfied/unresolved/blocked separation, nonmutating price/preference inputs, fixed and
bank physical counts, separate/combined functions, incomplete/mixed-currency subtotals,
capability/feature states, full pairwise tier truth, fronts, set ordering, no ambient
network/clock/randomness, bounded construction, deferred candidates, advisory governance,
late accounting ownership and rehashed nested semantic tampering/external replay.

Built API acceptance names seven tracked real records without corpus scans or review
repair: five unresolved exact options and 19 deferred candidates, preserved byte-identical
production files, complete public evaluate/serialize/parse/replay, atomic bound report
and browser export exclusion. No production component records were modified.

All final validation commands completed sequentially, with each npm process finished
before the next started. Windows esbuild required auto-review-approved execution outside
the filesystem sandbox for Vitest/Vite; no approval rejection occurred. The initial
sandbox startup failure, initial synthetic fixture assumptions and one missing `URL`
import in the new acceptance script were corrected before final passing validation.
Only explicitly touched files were write-formatted. `format:check` used the repository's
configured protected-safe globs, not a broad directory Prettier check. Final review
also removed repeated unchanged context/record hashing inside fact generation; all
test sequences below include the schedule-provenance correction. Its initial
focused run caught an incorrect new fixture assertion about the load domain; the
assertion now checks the exact upstream domain, and all 29 regressions pass.

| Exact command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Final result                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd test -- packages/engineering-core/tests/project-demand-schedule-provenance.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 29 passed, 1 file                                                                                                                                                    |
| `npm.cmd test -- packages/engineering-core/tests/recommendation.test.ts packages/engineering-core/tests/recommendation-integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 95 passed, 2 files                                                                                                                                                   |
| `npm.cmd test -- packages/engineering-core/tests/product-selection.test.ts packages/engineering-core/tests/product-selection-integration.test.ts packages/engineering-core/tests/product-selection-review-corrections.test.ts packages/engineering-core/tests/engineering-passport.test.ts packages/engineering-core/tests/passport-contract-hardening.test.ts packages/engineering-core/tests/installed-topology-boundaries.test.ts packages/engineering-core/tests/architecture-generation.test.ts packages/engineering-core/tests/architecture-demand-boundaries.test.ts packages/engineering-core/tests/architecture-phase3-witness.test.ts` | 321 passed, 9 files                                                                                                                                                  |
| `npm.cmd test -- packages/engineering-core`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1,155 passed, 45 files                                                                                                                                               |
| `npm.cmd test -- --run`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 2,842 passed, 118 files                                                                                                                                              |
| `npm.cmd run build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Exit 0; all five workspace builds                                                                                                                                    |
| `npm.cmd run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Exit 0                                                                                                                                                               |
| `npm.cmd run format:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Exit 0; configured protected-safe globs                                                                                                                              |
| `npm.cmd run validate:data -- --tracked-only --include-file data/rules/recommendation.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Exit 0; 22 data files, 24 schemas                                                                                                                                    |
| `npm.cmd run build:embed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Exit 0; IIFE and ESM                                                                                                                                                 |
| `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Exit 0; repeated after final handoff-only updates                                                                                                                    |
| `node scripts/recommendation-public-api-acceptance.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Exit 0; 7 unchanged real records, 5 unresolved exact options, 19 deferred candidates; public evaluate/serialize/parse/replay, atomic bound report, browser exclusion |

## Final A–AD trust audit

Answers apply to the implemented public typed/validated boundary and reproducible
outputs. Arbitrary coherently changed authoritative input snapshots represent new
inputs; external replay establishes identity with earlier snapshots.

| Check                                              | Answer and implemented protection                                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: preference changes YES/NO/UNKNOWN               | No. Upstream Phase 5 reconstructs; preference has no gate interpreter.                                                                                    |
| B: preference changes Phase 3 status               | No. The complete exact passport is preserved; status is copied verbatim.                                                                                  |
| C: BLOCKED enters a front                          | No. Automatic construction excludes blocked witnesses; exact blocked options are excluded with decisions.                                                 |
| D: UNRESOLVED equals confirmed                     | No. Separate status fields/fronts and no cross-class pairs.                                                                                               |
| E: missing data becomes zero/false/worst           | No. Explicit states and incomplete subtotals; unknown comparisons are incomparable.                                                                       |
| F: optional absence blocks engineering             | No. Optional facts are downstream and never enter mandatory gates.                                                                                        |
| G: preference becomes hard requirement             | No. Closed profile syntax rejects must/unknown fields; mandatory changes belong upstream.                                                                 |
| H: hidden brand/voltage/ecosystem default          | No. Empty profiles tie; only explicit criteria have authority.                                                                                            |
| I: serialization breaks ties                       | No. Sorted membership retains every tied option.                                                                                                          |
| J: lower tier overrides high unknown/conflict      | No. Only complete genuine tier equality advances authority.                                                                                               |
| K: opaque score becomes authority                  | No. Criterion relations, Pareto tiers and fronts; no scalar score.                                                                                        |
| L: price becomes manufacturer evidence             | No. Explicit context ownership separate from passport canonical evidence.                                                                                 |
| M: mixed currencies add                            | No. Unit-specific subtotals and unknown mixed total; no FX runtime.                                                                                       |
| N: missing weight yields complete total            | No. Missing/withheld input produces unknown aggregate with contributors.                                                                                  |
| O: body dimensions assert installed fit            | No. Component/qualified facts only; passport installation warnings persist.                                                                               |
| P: advisory/commercial rewrites engineering        | No. Existing advisory assessments govern admission separately; passports remain exact.                                                                    |
| Q: builder inventory makes incompatible acceptable | No. No inventory interpreter; explicit builder facts have no engineering authority.                                                                       |
| R: fixed equipment silently replaced               | No. Phase 5 exact handoff enforces retained fixed intent.                                                                                                 |
| S: Phase 4 roles silently merge/split              | No. Exact handoff preserves roles/topology; no repair logic.                                                                                              |
| T: one instance reused for separate roles          | No. One distinct Phase 4 role instance ID; model identity never establishes physical reuse.                                                               |
| U: null/unresolved identities fabricated           | No. Null/missing identities remain deferred; explicit materialization rejects.                                                                            |
| V: unmaterializable unknown disappears             | No. Separate deferred records retain exact candidate/witness/reasons even on construction overflow.                                                       |
| W: bounds truncate                                 | No. BigInt preflight reports automatic option/pair overflow; other limits reject atomically.                                                              |
| X: preferences prune before engineering            | No. Constructor has no preference/context inputs; complete retained exact choices are evaluated.                                                          |
| Y: unrelated option/reordering changes pair truth  | No. Pair relations depend only on the two exact fact sets/profile; set-order and unrelated-option regressions pass.                                       |
| Z: profile changes engineering status              | No. Same exact passports under changed profiles/commercial/policy contexts.                                                                               |
| AA: totals hide unresolved contributors            | No. Known subtotals, exact inputs and unresolved arrays remain structured.                                                                                |
| AB: facts lose ownership/provenance                | No. Independent schedule provenance repairs the confirmed finding; endpoint/trace/fact origins reconstruct exactly.                                       |
| AC: rehashed semantic edits survive                | No. Rehashed schedule-origin edits reject at both layers, including a coherent nested passport; changed authoritative inputs require external comparison. |
| AD: Phase 7 UI/app-contract work starts            | No. Portable core semantics only; no app DTO/UI/embed behavior.                                                                                           |

The confirmed schedule-attribution possibly-yes finding is corrected in the machine
contract. No possibly-yes finding remains in the re-run A–AD audit. Confirmed means satisfied only within the unchanged
passport scope, never installation certification or reviewed rule approval.

## Remaining limitations

No full integration/protocol/monitoring-target solver, installed layout/clearance/
conductor/protection/bonding/ventilation proof, new shared-capacity/schedule/dispatch
interpreter, heterogeneous bank construction, package/tax/shipping pricing, FX,
ambient inventory/profile ranking, live advisory feed, corpus expansion, or Phase 7/8
application/UI contract was added. Automatic completeness is scoped to supplied exact
Phase 5 retained alternatives. Expanded corpora can produce an option-space report;
explicit complete choice sets remain available. Missing canonical native wording/units
cannot be recovered by Phase 6. The inherited draft/review/installation limitations
remain visible in every passport.

## Changed files and final Git state

Tracked modified files (12):

- `data/rules/installed-system-proof.json`
- `data/schemas/whole-system-input.schema.json`
- `packages/engineering-core/src/engineering-passport-contracts.ts`
- `packages/engineering-core/src/installed-system-context.ts`
- `packages/engineering-core/src/project-demand-evaluation.ts`

- `docs/ARCHITECTURE.md`
- `docs/ARCHITECTURE_GENERATION.md`
- `docs/PRODUCT_SELECTION.md`
- `docs/WHOLE_SYSTEM_BACKEND.md`
- `packages/engineering-core/package.json`
- `packages/engineering-core/src/product-selection-handoff.ts`
- `scripts/validate-data.mjs`

New task files (17):

- `packages/engineering-core/tests/project-demand-schedule-provenance.test.ts`

- `data/rules/recommendation.json`
- `data/schemas/recommendation-input.schema.json`
- `data/schemas/recommendation-policy.schema.json`
- `data/schemas/recommendation.schema.json`
- `docs/PHASE_6_HANDOFF.md`
- `docs/RECOMMENDATION.md`
- `packages/engineering-core/src/preference-comparison.ts`
- `packages/engineering-core/src/recommendation-contracts.ts`
- `packages/engineering-core/src/recommendation-validation.ts`
- `packages/engineering-core/src/recommendation.ts`
- `packages/engineering-core/src/system-option-construction.ts`
- `packages/engineering-core/src/tradeoff-facts.ts`
- `packages/engineering-core/tests/fixtures/recommendation.ts`
- `packages/engineering-core/tests/recommendation-integration.test.ts`
- `packages/engineering-core/tests/recommendation.test.ts`
- `scripts/recommendation-public-api-acceptance.mjs`

Final task status was obtained with explicit pathspecs for the 29 named task files;
tracked status/index/HEAD were checked separately. The two protected pre-existing
untracked entries below are retained from initial status metadata; their contents
were never read/enumerated and they were not re-scanned for this handoff.

```text
 M data/rules/installed-system-proof.json
 M data/schemas/whole-system-input.schema.json
 M packages/engineering-core/src/engineering-passport-contracts.ts
 M packages/engineering-core/src/installed-system-context.ts
 M packages/engineering-core/src/project-demand-evaluation.ts
 M docs/ARCHITECTURE.md
 M docs/ARCHITECTURE_GENERATION.md
 M docs/PRODUCT_SELECTION.md
 M docs/WHOLE_SYSTEM_BACKEND.md
 M packages/engineering-core/package.json
 M packages/engineering-core/src/product-selection-handoff.ts
 M scripts/validate-data.mjs
?? .local-corpus-draft-archive/
?? data/components/victron-energy.ekrano-gx-bpp900480100.yaml
?? data/rules/recommendation.json
?? data/schemas/recommendation-input.schema.json
?? data/schemas/recommendation-policy.schema.json
?? data/schemas/recommendation.schema.json
?? docs/PHASE_6_HANDOFF.md
?? docs/RECOMMENDATION.md
?? packages/engineering-core/src/preference-comparison.ts
?? packages/engineering-core/src/recommendation-contracts.ts
?? packages/engineering-core/src/recommendation-validation.ts
?? packages/engineering-core/src/recommendation.ts
?? packages/engineering-core/src/system-option-construction.ts
?? packages/engineering-core/src/tradeoff-facts.ts
?? packages/engineering-core/tests/fixtures/recommendation.ts
?? packages/engineering-core/tests/recommendation-integration.test.ts
?? packages/engineering-core/tests/recommendation.test.ts
?? packages/engineering-core/tests/project-demand-schedule-provenance.test.ts
?? scripts/recommendation-public-api-acceptance.mjs
```

HEAD and branch remain unchanged. The staged diff is empty. No changes are staged,
committed or pushed. Phase 7 has not started.

PHASE 6 READY FOR HUMAN REVIEW
