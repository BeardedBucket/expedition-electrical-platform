# Phase 3 implementation handoff

This milestone implements a supplied-architecture whole-system backend proof
and portable **Engineering Passport**. It is ready for human review within its
explicit nominal-connectivity-and-device-demand scope. It does not certify an
installation or approve the current production product corpus.

## Checkout and Git state

- Primary checkout: `C:\Users\Bearded Bucket\Documents\GitHub\expedition-electrical-paltform`.
- Branch: `feat/whole-system-backend-proof` throughout.
- Starting and final HEAD: `5524f2ac494624f77482c7a8c624928d4f5cf471`.
- At start, local `main`, `origin/main`, HEAD and their merge base agreed at that
  revision, the merged Phase 2 lineage. No remote fetch was performed.
- Starting tracked index and working tree were clean. Final tracked changes are
  six unstaged modifications; the index is unchanged. Twenty-three task-authored
  new source/data/test/documentation files remain untracked.
- No branch/worktree creation, staging, commit, push, merge, repository permission
  change or production-component modification occurred. Protected local material
  was excluded from corpus inputs and validation.

## Human-review corrections

The follow-up review confirmed three portable-contract hazards and prompted a
rule-lifecycle audit. All corrections remain within Phase 3's original scope.

| Finding | Evidence and correction |
| --- | --- |
| Incomplete energy summary | Confirmed: the former state-ID list omitted the two unscheduled production instances. `result.energy` now has explicit `completeness`, `resolved_subtotal_energy_wh`, and structured `unresolved_contributions` for states, schedules and empty evaluations. Incomplete totals are prohibited by schema and discriminated types. |
| Evidence presence versus reliance | Confirmed: provisional values appeared under `consumed_facts` even though their values were withheld. The collection is now `examined_evidence`; every entry has `engineering_use.state` (`accepted_input` or `withheld`) and withheld reason. Every trace `evidence_refs` item repeats the use state. Accepted input means supplied to interpretation, not successful fit. |
| PV/DC continuity | Confirmed: current-type normalization allowed equal-nominal PV/DC wire/conductive continuity to satisfy. That source-context crossing is now unresolved. Known mismatch still blocks, unknown voltage remains unresolved, and reviewed solar conversion continues to satisfy. An ordinary DC conversion capability alone cannot erase the PV context. |
| Draft rule authority | No existing execution-gate violation was found: rule status is lifecycle metadata, JSON rules have no executor/approval gate, and existing profile calculations run against synthetic/unverified/reviewed profiles while preserving status. Rule schema distinguishes draft/reviewed/approved/deprecated; contributing policy requires reviewer sign-off but defines no automatic merge-time promotion. The rule stays draft. Its lifecycle now appears in the result with a non-approved-rule warning; satisfaction means the scoped proof, not approval. |

Twenty-four new regression cases cover these findings, including complete zero
versus incomplete zero, unscheduled instances, duration/horizon coverage, withheld
and accepted observations, qualifier rejection, forged evidence/result/lifecycle
labels with recomputed hashes, unsupported older schema, passive PV/DC continuity,
reviewed solar conversion, and existing lifecycle metadata behavior. Production
assertions and existing passport assertions were updated to the new shape.

The correction touches these existing Phase 3 files:
`data/rules/installed-system-proof.json`,
`data/schemas/engineering-passport.schema.json`,
`packages/engineering-core/src/engineering-passport-contracts.ts`,
`packages/engineering-core/src/installed-system-context.ts`,
`packages/engineering-core/src/installed-energy-evaluation.ts`,
`packages/engineering-core/src/installed-power-evaluation.ts`,
`packages/engineering-core/src/whole-system-evaluator.ts`,
`packages/engineering-core/tests/engineering-passport.test.ts`,
`packages/engineering-core/tests/production-passport.test.ts`,
`scripts/replay-engineering-passport.mjs`, and the three Phase 3 documentation
files. The only new correction source file is
`packages/engineering-core/tests/passport-contract-hardening.test.ts`.
Public passport loading/replay needs no new algorithm: its existing complete
reconstruction verifies all new fields and explicitly rejects old schemas.

## Implemented architecture and artifact

`InstalledSystemArchitecture` composes the existing `ReferenceSystem` installation
with an additive logical `InstalledPowerTopology` over its component instances.
The installation continues to own terminal wiring, conductors, locations and
interaction architecture. Explicit DC, PV DC and AC domains have optional nominal
V and AC Hz; absence remains unknown. Domain IDs can represent shared buses.
Logical bindings address exact canonical ports. Directed wire, power-path and
conductive edges establish connectivity; binding and equal voltages alone do not.
Supplied requirements select ordered routes. The evaluator chooses no route,
product, manufacturer or house voltage.

The backend-only `@expedition/engineering-core/engineering-passport` entry point
exports typed contracts, evaluation, strict serialization, loading and replay.
The evaluator composes existing power/current, load-state energy, battery-bank
and system-aggregation primitives. No engineering formula is reimplemented in
React or ingestion. The browser entry point is unchanged.

The passport contains:

- Schema/evaluator identity; exact requirements, topology and explicit assumptions;
  input digest.
- Exact selected canonical record snapshots and per-record/selected-corpus SHA-256
  digests; independent known-or-unknown manufacturer revision and review status.
- Versioned project rule metadata and content digest.
- Examined canonical evidence with identity-addressed paths, record digest, source
  references, review status, accepted-or-withheld engineering-use state, canonical
  projection and retained derivation lineage.
- Decisions with status, code, rule revision, inputs and evidence/assumption links;
  calculations explicitly marked derived with formula, inputs, units and output.
- Satisfied/blocked/unresolved result, device-side energy accounting, existing
  system aggregation, visible warnings and limitations; whole-artifact digest.

Source-native text/units not retained by canonical records are explicitly marked
unavailable. Canonical assertions do not claim manufacturer publication, and
canonical projection is separate from derivation. Record-level references do not
invent field-specific attribution. Project digests never become manufacturer
revisions. Advisory references remain visible and separate from specifications.

Evaluation is synchronous, deterministic and owns fresh copies. It has no clock,
network, randomness or filesystem input. Canonical JSON sorts object keys by code
point while preserving array order. Invalid/nonfinite, sparse, hidden/accessor,
cyclic or non-JSON values fail rather than silently disappear. Loading validates
the schema and hash, then reproduces the complete artifact from embedded inputs
with the supported implementation. Replay additionally checks external records
and rules. Altered status/trace is rejected even after recomputing envelope hashes.
These hashes establish content identity, not source authenticity.

## Acceptance findings and limitations

The complete project-authored fixture demonstrates explicit 12 V vehicle →
12/24 converter → 24 V house/storage/loads → 24/12 converter → 12 V load. Its
device-side scheduled demand is 750 Wh; its derived nominal bank is 2,400 Wh.
It is a numerical acceptance fixture, not a recommended design. Additional tests
exercise distinct inverter/charger AC input, AC output and DC interfaces, passive
continuity, controlled switching, and explicitly permitted series banks.

The real acceptance uses exactly these tracked canonical identities:

- `victron-energy.ori122436120`
- `victron-energy.ori241236120`
- `epoch-batteries.b24100a-c`
- `victron-energy.pmp242200100`
- `victron-energy.scc075015060r`
- `blue-sea-systems.6006`
- `victron-energy.shu050150050`

All seven retain `unverified` status, exact identity, sources and snapshots. The
result is unresolved, with unknown manufacturer revisions. All five modeled
idle contributions remain unknown; the two other instances lack full schedules.
No total energy is emitted. `completeness` is `incomplete` and the explicitly
resolved subtotal is zero. All five unknown states and both unscheduled instances
are listed directly in the energy object's unresolved contributions. All 26
examined product observations and their trace references are withheld. The
complete synthetic passport has 25 accepted inputs, an empty unresolved energy
collection and a total of 750 Wh. Both retain draft rule lifecycle.

Orion conditional port data does not supply reviewed efficiency or acceptable
review status. Epoch's 25.6 V unit nominal value is not silently equated with a
24 V domain; its logical-port voltage is missing. MultiPlus retains separate
interfaces but lacks port-specific V/Hz. SmartSolar context-dependent limits
remain unresolved. Blue Sea and SmartShunt connection points are preserved without
inventing logical ports. No neighboring-product substitution, repair or promotion
was used. The acceptance test checks production file contents remain unchanged.

Current boundaries are deliberately explicit:

- `result.assertion_scope` is `nominal-connectivity-and-device-demand` and
  `installation_safety` is `not_evaluated`, including when status is satisfied.
- Operating envelopes, PV Voc/Isc, contextual constraints, AC power-factor current,
  shared/concurrent converter capacity, requested isolation, environmental fit,
  recharge/source-energy trajectories and autonomy are unresolved where requested.
- Reviewed single-path DC conversion propagates explicit efficiency; independent
  known endpoint power/current limits still constrain nominal route demand. This
  does not prove delivered energy or conductor ampacity.
- Device-side scheduled energy is not battery demand. Full-duration per-instance
  schedules are required; unknown idle draw withholds total energy. Battery
  aggregate V/Ah/Wh remain derived, and unit baseline power scales by unit count.
- Series permission requires reviewed manufacturer evidence. Balancing,
  maintenance, protection, wiring and installation approval remain separate.
- Body dimensions never establish installed clearance/orientation/ventilation.
  Ground/chassis words never establish a bonding role. These remain visible
  warnings or unresolved context. No universal grounding solver is implemented.

## Deliberate adaptations and compatibility

The proof is scoped rather than filled with invented missing engineering rules.
Unsupported requested assertions remain unresolved. Source-native units are not
reconstructed through ingestion. No architecture generation, ranking, builder
policy, UI, CAD, stationary rules or product promotion was added.

The backend is a Node package subpath because it uses SHA-256 from Node crypto;
it adds no browser dependency. Legacy device-energy primitive battery labels and
bank aggregate manufacturer labels are removed from the new output where they
would incorrectly characterize derived device/system observations. Existing
public primitive behavior is unchanged.

Canonical changes are additive manufacturer revision and port frequency fields,
plus admitting `electrical: null` to align the schema with the pre-existing loader
and TypeScript unknown-data contract. No product record is edited. Named schema
registration enables reuse of canonical schemas. Data validation gains explicit
tracked-file scope and named new-file inclusion to honor protected paths; its
default standalone behavior remains unchanged. Root lint excludes local drafts.

Passport schema revision is `2.0.0`; evaluator is
`installed-system-proof/1.1.0` and the actual project rule dataset is revision
`1.1.0`, still draft. The schema major change deliberately replaces
`known_energy_wh`, `unresolved_state_ids`, `consumed_facts` and trace `fact_ids`
with the self-describing contracts above. Existing input and canonical schemas
retain their identities. Earlier exports remain untouched and are explicitly
unsupported: no implicit migration could strengthen their incomplete semantics.

## File inventory

Modified tracked files (6):

| File | Change |
| --- | --- |
| `data/schemas/component.schema.json` | Revision/frequency fields and null electrical contract |
| `docs/ARCHITECTURE.md` | Implemented Phase 3 ownership, provenance, scope and replay |
| `eslint.config.js` | Protected local-draft exclusion |
| `packages/engineering-core/package.json` | Backend package subpath |
| `packages/engineering-core/src/component-library.ts` | Additive canonical types/frequency validation |
| `scripts/validate-data.mjs` | Schema registration and explicit data-file scope |

New files (23):

| File | Responsibility |
| --- | --- |
| `data/rules/installed-system-proof.json` | Versioned project interpretation rationale |
| `data/schemas/installed-power-topology.schema.json` | Runtime topology validation |
| `data/schemas/whole-system-input.schema.json` | Explicit input validation |
| `data/schemas/engineering-passport.schema.json` | Portable artifact validation |
| `packages/engineering-core/src/installed-power-topology.ts` | Domain/binding/edge contracts |
| `packages/engineering-core/src/engineering-passport-contracts.ts` | Input, evidence, trace and artifact types |
| `packages/engineering-core/src/passport-integrity.ts` | Strict JSON, schema validation and digest ownership |
| `packages/engineering-core/src/engineering-passport.ts` | Public loading, serialization and replay |
| `packages/engineering-core/src/installed-system-context.ts` | Validated snapshots, identities and evidence/decision ownership |
| `packages/engineering-core/src/installed-power-evaluation.ts` | Supplied topology and nominal route evaluation |
| `packages/engineering-core/src/installed-energy-evaluation.ts` | Qualified schedules and explicit banks |
| `packages/engineering-core/src/whole-system-evaluator.ts` | Existing-core composition and final artifact |
| `packages/engineering-core/tests/engineering-passport.test.ts` | Passport trust boundaries (35 tests) |
| `packages/engineering-core/tests/installed-topology-boundaries.test.ts` | Additional topology/energy boundaries (26 tests) |
| `packages/engineering-core/tests/production-passport.test.ts` | Exact production-corpus acceptance (1 test) |
| `packages/engineering-core/tests/passport-contract-hardening.test.ts` | Human-review corrections (24 tests) |
| `packages/engineering-core/tests/fixtures/whole-system.ts` | Complete mixed-domain synthetic input |
| `packages/engineering-core/tests/fixtures/production-system.ts` | Explicit seven-record real-system input |
| `packages/engineering-core/tests/fixtures/single-device-system.ts` | Focused generic boundary fixtures |
| `packages/engineering-core/tests/fixtures/passport-artifact.ts` | Opt-in exclusive proof export |
| `scripts/replay-engineering-passport.mjs` | Independent explicit-file process replay |
| `docs/WHOLE_SYSTEM_BACKEND.md` | Implemented behavior, rationale and limitations |
| `docs/PHASE_3_HANDOFF.md` | This inventory, evidence and trust audit |

Documentation and nearby comments explain snapshot/copy ownership, replay guards,
trace namespaces, explicit switching, exact nominal equality, unknown-versus-zero,
qualifier matching, series permission, aggregate derivation and backend boundaries.
The review corrections additionally document energy completeness, evidence use,
PV source-context boundaries, lifecycle metadata and the schema break close to
their implementations and in the architecture/domain documentation.
No standards numeric constants or copyrighted standards material were introduced.

## Validation evidence

Final npm commands ran sequentially. Tests were offline/deterministic. Windows
esbuild/build execution required sandbox escalation; automatic review approved it.

| Exact command | Result |
| --- | --- |
| `npm.cmd test -- packages/engineering-core/tests/passport-contract-hardening.test.ts packages/engineering-core/tests/engineering-passport.test.ts packages/engineering-core/tests/installed-topology-boundaries.test.ts packages/engineering-core/tests/production-passport.test.ts` | Exit 0; 86 tests, 4 files |
| `npm.cmd test -- packages/engineering-core` | Exit 0; 784 tests, 35 files |
| `npm.cmd test -- --run` | Exit 0; 2,470 tests, 108 files |
| `npm.cmd run build` | Exit 0; all core/ingestion/runtime/configurator/admin builds |
| `npm.cmd run lint` | Exit 0 |
| `npm.cmd run format:check` | Exit 0; configured globs only |
| `npm.cmd run validate:data -- --tracked-only --include-file data/rules/installed-system-proof.json` | Exit 0; 19 data files, 15 schemas |
| `git diff --check` | Exit 0; no whitespace errors |
| `npm.cmd run build:embed` | Exit 0; additional repository compatibility check |
| `node scripts/replay-engineering-passport.mjs .tmp/phase3-proof-hardened-01a1029c/positive.passport.json .tmp/phase3-proof-hardened-01a1029c/positive.catalog.json` | Exit 0; exact replay, satisfied scoped result, complete energy |
| `node scripts/replay-engineering-passport.mjs .tmp/phase3-proof-hardened-01a1029c/production.passport.json .tmp/phase3-proof-hardened-01a1029c/production.catalog.json` | Exit 0; exact replay, unresolved result, incomplete energy, all evidence withheld |

Focused iterations added 86 Phase 3 tests, including 24 review regressions. During
the review corrections an initial schema test found a local reference typo; it
was corrected before the passing regression/full-validation sequence. Earlier
in the original implementation, an initial full-suite attempt encountered
stale ignored ingestion build exports; the root build refreshed them, and the
complete final suite passed. Final formatting initially identified the touched
component loader; formatting only that file resolved it. No unrelated write-mode
formatter ran. Plain default data scanning was deliberately replaced by the
scoped command above to honor protected local paths.

Latest local proof exports are six ignored files under
`.tmp/phase3-proof-hardened-01a1029c/`: positive/production passport, exact catalog
and input JSON. The package test export was enabled through
`PHASE3_PROOF_DIRECTORY` for that new directory and restored afterward. Ordinary
tests produce no exports. Earlier task-authored draft exports are preserved.

Latest passport digests:

- Positive: `sha256:02a7f3f95c81ff30208e95458af6574009273521b3053c94646bfd9f305fe4b9`.
- Production: `sha256:2ba879da97b4c69732f4223d63b238a699f94dcd70dffcabc21fe344035fa25f`.

## Final A–M trust audit

Each answer is **No at the implemented backend boundary**, subject to the
explicit scope and existing canonical review contract described above.

| Check | Protection and evidence |
| --- | --- |
| A: Unsupported product information becomes engineering fact | Unverified/partial records remain unresolved; exact snapshots/review status and examined paths retained. Evidence and inline references explicitly distinguish withheld from accepted inputs. No product promotion. |
| B: Missing becomes zero/default/false | Missing inputs produce unresolved decisions or validation errors. Energy alone states completeness and resolved subtotal; incomplete total is prohibited, with all unresolved state/schedule/evaluation classes represented. |
| C: Normalization becomes publication or derivation | Canonical projection is separate; source-native absence explicit; canonical assertion never claims publication; existing derivation lineage retained. |
| D: Calculation becomes source-published | Calculation kind is derived with rule, formula, units, input/evidence links. Bank aggregates and device demand do not inherit misleading legacy labels. |
| E: Domains silently connect | Explicit directed edges and supplied routes required; equal-voltage distinct buses are disconnected without edges. AC/DC/Hz/V checks preserve unknowns. PV/DC source-context crossings cannot satisfy passive nominal continuity or ordinary DC conversion alone. |
| F: Passive hardware converts voltage | Wire/conductive edges preserve domains; passive/distribution capabilities cannot authorize conversion. Disconnect state requires explicit evidence. |
| G: Series arithmetic grants permission | Reviewed storage capability and manufacturer count permissions required before bank arithmetic can satisfy. Unknown/prohibited counts tested. |
| H: Dimensions become installed envelope | Body facts remain snapshots; every instance has an installed-envelope warning. No clearances inferred. |
| I: Unknown idle disappears | Full-duration schedules and matching reviewed consumption evidence required; unknown states and missing schedules withhold total. Unit baseline scales with bank unit count. |
| J: Ground words define role | Separate domain/terminal/intended-role context retained but not certified; terminology only causes review warnings. |
| K: Commercial preference changes compatibility | Input schema rejects builder/commercial policy; no recommendation layer invoked. |
| L: Changed evidence replays as original | Exact record/rule/evaluator identities checked; missing, duplicate and changed records fail. Complete reconstruction rejects forged results/traces. |
| M: Weak state ambiguously invites stronger UI assertion | Explicit status, scope, not-evaluated safety, draft lifecycle warning, energy completeness/omissions and evidence-use states retained. Forged stronger energy, evidence, trace and lifecycle labels are rejected even after rehashing. A future UI must preserve this contract. |

Remaining concerns are declared product-data and engineering coverage limitations,
not hidden defaults or a pending architecture decision. Verified input remains an
existing trust boundary; digest/replay does not authenticate a manufacturer.
Future consumers need to honor scope and unresolved evidence. Human review should
assess this new interpretation/rule contract before integration. No commit or
push has been performed.
