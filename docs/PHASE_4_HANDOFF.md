# Phase 4 implementation and review-correction handoff

Phase 4 generates product-independent abstract electrical architectures. The review
corrections separate demand, topology, mandatory product roles and capacity. No exact
product compatibility, installation approval, selection or recommendation is asserted.

## Checkout and final Git state

- Primary checkout: `C:\Users\Bearded Bucket\Documents\GitHub\expedition-electrical-paltform`.
- Branch throughout: `feat/architecture-generation`.
- Starting/current HEAD: `911f0c1522257abcde1ed23790b52ff814ad69cc`.
- At start, local `main`, `origin/main` and HEAD agreed at the merged Phase 3
  revision; the main ancestry check passed. No fetch/pull or integration ran.
- Tracked index/worktree were clean at start. Final tracked changes are seven
  unstaged modifications; the index remains unchanged. Twenty task-authored
  new files remain untracked. Protected local content was preserved and excluded
  from fixtures, evidence, corpus membership and validation input scopes.
- No staging, commit, push, merge, rebase, reset, branch/worktree creation,
  repository configuration/permission change or component record change occurred.

Tracked files changed:

1. `docs/ARCHITECTURE.md`
2. `docs/WHOLE_SYSTEM_BACKEND.md`
3. `packages/engineering-core/package.json`
4. `packages/engineering-core/src/installed-power-evaluation.ts`
5. `packages/engineering-core/src/installed-system-context.ts`
6. `packages/engineering-core/src/passport-integrity.ts`
7. `scripts/validate-data.mjs`

New files:

1. `data/rules/architecture-generation.json`
2. `data/schemas/architecture-generation-input.schema.json`
3. `data/schemas/architecture-generation-policy.schema.json`
4. `data/schemas/architecture-generation.schema.json`
5. `docs/ARCHITECTURE_GENERATION.md`
6. `docs/PHASE_4_HANDOFF.md`
7. `packages/engineering-core/src/architecture-generation.ts`
8. `packages/engineering-core/src/architecture-generation-contracts.ts`
9. `packages/engineering-core/src/architecture-generation-validation.ts`
10. `packages/engineering-core/src/architecture-candidate-builder.ts`
11. `packages/engineering-core/src/abstract-power-evaluation.ts`
12. `packages/engineering-core/src/nominal-domain-semantics.ts`
13. `packages/engineering-core/src/portable-json.ts`
14. `packages/engineering-core/tests/architecture-generation.test.ts`
15. `packages/engineering-core/tests/architecture-phase3-witness.test.ts`
16. `packages/engineering-core/tests/portable-json.test.ts`
17. `packages/engineering-core/tests/fixtures/architecture-requirements.ts`
18. `packages/engineering-core/tests/fixtures/architecture-witness.ts`
19. `packages/engineering-core/src/architecture-demand-groups.ts`
20. `packages/engineering-core/tests/architecture-demand-boundaries.test.ts`

## Review findings: evidence and conclusions

Findings 1, 2, 3 and 5 were confirmed in the pre-correction implementation:
`buildArchitectureCandidate` created conversion/inverter and mandatory load
roles inside its per-load loop, copied native load W onto storage, and
`generateArchitectures.canCombine` counted AC endpoints rather than functional
domains. Existing tests explicitly enforced those outcomes. Finding 4 identified
the resulting shared-capacity gap: no shared topology existed to retain that
unknown. Finding 7's Phase 5 handoff needed the same contract correction.

Finding 6's possible forced-conversion interpretation was not confirmed:
`powerPathDomainStates` intentionally permits generic controlled `charging`
for DC→DC, including equal nominal voltages. Abstract `function: charger` is
intent, not a mandatory canonical product category. This is now documented and
tested. Unlike source/house voltages additionally retain an explicit
`dc_to_dc_conversion` capability gate on the charging role. No alternator, BMS,
relay or switching synthesis was added.

Findings 8 and 9 described properties to preserve, rather than confirmed defects:
bounded corpus-independent generation and shared Phase 3 nominal semantics were
already present. Import/regression tests and full validation preserve them.

## Corrected ownership and generic behavior

The Node-only `@expedition/engineering-core/architecture-generation` entry point
accepts closed end-system requirements and explicit versioned project policy.
Legacy recommendation and exact-installed-system APIs remain unchanged. Runtime
generation has no catalog, ingestion, advisory, builder, recommendation, filesystem,
network, clock or randomness dependency. SHA-256 provides content identity only.

Requirement-only loads are `ArchitectureDemandEndpoint` objects, separately
listed under `demand_endpoints`. Their `kind: end_use_demand` and
`product_binding: not_required` distinguish them from mandatory corpus slots.
They preserve load identity, domain reference, optional W/schedule/isolation,
branch topology and exact input/decision provenance. Absence remains absent;
explicit false and zero remain explicit. Stable endpoint IDs permit future
optional application associations without imposing appliance selection today.

Complete equal DC V or AC V/Hz requirements share one output domain and functional
boundary. Explicit isolation, unknown compatibility and materially different
requirements retain separate boundaries. Group IDs hash the full domain tuple
(plus endpoint identity for a dedicated boundary), independent of count and W.
Groups/members are code-point sorted and retain original array-index provenance.
Common supply edges precede separate endpoint branches. A native DC group needs
no converter; unlike DC needs conversion; AC needs inversion; PV source context
remains explicit. Abstract continuity does not size conductors, panels or protection.

Every independently known demand W remains an output-side lower-bound predicate.
The role's `output_capacity` references its interface, served endpoints and
lower-bound constraint IDs. Multiple endpoints retain `concurrency_not_asserted`
and an unresolved candidate; missing W adds `demand_power_unknown`. No powers
are summed, no maximum is presented as a final rating, and no schedule overlap,
diversity or efficiency is inferred. Shared architectures remain in the result.
A single known demand specifies only the requested output-sizing scope, not an
exact product rating or simultaneous-operating approval.

One compatible AC group and one shore source support both combined/separate
arrangements, even with multiple demand endpoints. Combined roles keep distinct
AC input/output and bidirectional DC interfaces with directed inversion/charging.
Different AC domains or multiple shore sources have no arbitrary pairing search;
a combined-only unsupported cardinality retains an unresolved diagnostic topology.

Storage receives only explicitly supported capability/interface/nominal Wh gates.
Co-location supplies no dispatch authority; native load W is never copied onto
storage. `scope: storage_dispatch` remains unresolved with no numerical lower
bounds and `storage_dispatch_not_asserted`. Its later sizing check is deferred.
This input revision has no storage-discharge requirement/rule that could justify
such a predicate. Missing discharge is not zero. Source existence proves no dispatch.

Phase 5 handoff is requirements → demand endpoints → architecture domains/topology
→ required product/assembly roles → role predicates and capacity dependencies
→ future product filters → exact bindings and explicitly known endpoint associations
→ Phase 3 whole-system evaluation. Phase 5 filters `required_roles`, not every
demand endpoint. Satisfied lower-bound gates cannot resolve unknown shared capacity.
No Phase 5 filtering or optional-product association feature was implemented.

## Portable contract, policy, bounds and trust

Input/result versions, generator revision and bundled draft policy revision are
2.0.0 (generator `architecture-generation/2.0.0`). The policy schema requires
`load_supply_arrangement: shared_compatible_domains`; role schemas require
capacity collections, candidate schemas require endpoints, and role functions
exclude load. The v2 parser rejects v1 artifacts without reinterpretation or migration.
Policy lifecycle remains explicit; generation/tests never approve a draft rule.

Search remains voltage × AC arrangement: at most 16 voltage entries × two
arrangements = 32 candidates. Fixed voltage narrows only that dimension. Admission
caps remain 64 loads and 16 sources; narrow policies reject larger input. Grouping
is one deterministic partition, without another search dimension or per-load
Cartesian expansion. Topology/provenance growth is linear in admitted requirements.
Bounds reject before allocation, never truncate. Raw considered/deduplicated counts
and full digest-based identity remain portable and reproducible.

These are conservative application operating limits without measured production
evidence, not safety thresholds or standards values. Metadata caps (128-character
input IDs, 512-character generated IDs, 4096-character text, 64 schedule/assumption/
unsupported entries and 16 policy references) likewise bound retained work.
Reconsider them only for supported larger input or operational evidence. Rationale
is in the policy, architecture documentation and nearby ownership/boundary comments.
No standards-derived constants or manufacturer specifications were introduced.

Artifacts embed exact independent input/policy snapshots, full candidate/envelope
digests and all decisions/provenance. Closed schemas, hash verification and complete
deterministic reconstruction reject forged endpoints, capacity, constraints,
statuses and scopes even after rehashing. Exact external replay checks live snapshots.
Hash identity does not authenticate policy approval or product evidence.

## Phase 3 compatibility and acceptance

Shared `nominal-domain-semantics.ts` functions retain Phase 3's passive/domain/path
interpretation. Evidence review, exact ports/ratings, banks, switching, schedules
and passport assembly remain Phase 3-owned. No runtime witness products are created.
Shared portable encoding preserves valid existing JSON digests and passport exports;
invalid accessor/hidden/sparse arrays remain rejected by the existing Phase 4 hardening.

The mixed project-authored fixture (12 V vehicle, 12/24 V DC demand, 120 V/60 Hz AC,
36 V PV, 230 V/50 Hz shore and 2400 Wh nominal storage) still produces six unranked
structurally viable candidates, each with three separate demand endpoints:

| House V | AC functions | Mandatory product roles | Structural status |
| --- | --- | --- | --- |
| 12 | combined | 5 | structurally_viable |
| 12 | separate | 6 | structurally_viable |
| 24 | combined | 5 | structurally_viable |
| 24 | separate | 6 | structurally_viable |
| 48 | combined | 6 | structurally_viable |
| 48 | separate | 7 | structurally_viable |

All six instantiate and round-trip through Phase 3 using test-only project-authored
witnesses. The adapter explicitly supplies synthetic concrete loads for endpoints,
1 W observations/one-hour schedules and one-unit bank permission; those are test
inputs, never runtime product facts or mandatory selection slots. Shared-domain
witnesses preserve Phase 3's existing unresolved shared capacity while directed
nominal edges satisfy. Withheld witness review remains unresolved; passive substitution
for conversion remains blocked. No nominal evaluator was duplicated or weakened.

Existing tests use only the seven explicitly named tracked Phase 3 acceptance
records for empty/reordered/manufacturer-changed/gained/lost corpus contexts.
Artifacts stay identical. The transitive runtime-import audit remains green;
closed input/policy schemas reject product/commercial injection.

The original ignored v1 export remains untouched:
`.tmp/phase4-proof-01a103d2/mixed-architecture-generation.json`, result digest
`sha256:4da512932a5a85133ed8205e7c18134c3adad0896130ad220906998b66dd5f8b`.
The built v2 public Node export passed generate/serialize/parse/exact-replay
acceptance, retaining separate exports under `.tmp/phase4-proof-v2-01a103d2/`:

- `mixed-architecture-generation.json`: result digest
  `sha256:b956a4a7bd01f03a149530a83abd284a9512e36d6deb990d3dee8fe2ec709f17`.
- `shared-ac-architecture-generation.json`: result digest
  `sha256:045f5f27582ec208362132ea8d0458b6a25a55dfd2a8f81d2be5488c18b27a49`.

Shared acceptance retains combined/separate candidates with two demand endpoints,
one inversion boundary and unresolved output capacity. The prior v1 artifact was
rejected by the v2 parser and byte-compared unchanged; its file SHA-256 remains
`58042180de28f4b02011f625256ce45ea7906d965acc1a021832b634e6430a8e`.
Ordinary tests create no proof exports. No existing local content was removed.

## Tests and exact validation

The task now has 121 tests: generation (74, obsolete dedicated-load/storage-power
expectations corrected), demand boundaries (28 new), Phase 3 witnesses (8 adapted)
and portable JSON (11). Review tests cover shared DC/AC, provenance, unresolved/no-sum
capacity, isolation/domain separation, nonmandatory endpoints/future association
identity, storage authority, combined functions, equal/unlike vehicle voltage,
bounds, contradictory source provenance, v2 replay/forgery and shared Phase 3 witnesses. Existing corpus/import tests
and Phase 1–3 regression suites pass.

The retained final validation sequence completed each npm command before starting
the next. One intermediate lint invocation started while build was still running;
build completion was then verified and all remaining checks repeated sequentially.
Final validation results:

| Command | Result |
| --- | --- |
| `npm.cmd test -- packages/engineering-core/tests/architecture-generation.test.ts packages/engineering-core/tests/architecture-demand-boundaries.test.ts packages/engineering-core/tests/architecture-phase3-witness.test.ts packages/engineering-core/tests/portable-json.test.ts packages/engineering-core/tests/installed-topology-boundaries.test.ts packages/engineering-core/tests/passport-contract-hardening.test.ts` | Exit 0: 171 tests, 6 files |
| `npm.cmd test -- packages/engineering-core` | Exit 0: 905 tests, 39 files |
| `npm.cmd test -- --run` | Exit 0: 2591 tests, 112 files |
| `npm.cmd run build` | Exit 0: all workspace builds |
| `npm.cmd run lint` | Exit 0 |
| `npm.cmd run format:check` | Exit 0: repository-configured globs |
| `npm.cmd run validate:data -- --tracked-only --include-file data/rules/architecture-generation.json` | Exit 0: 20 data files, 18 schemas; strict Phase 4 policy included |
| `npm.cmd run build:embed` | Exit 0: both dedicated embed formats |
| `git diff --check` | Exit 0: no whitespace errors |

Focused iteration failures were corrected before the passing sequence. Vite/esbuild
requires approved execution outside the filesystem sandbox to resolve this Windows
checkout's parent path; no approval rejection occurred. Only explicitly touched
files were write-formatted; no broad write formatter or protected-path corpus scan ran.

## Remaining limitations and documentation

No source availability/dispatch/balance/recharge trajectory, schedule energy/autonomy,
efficiency/input current, usable storage/reserve/bank permission, final shared
capacity, PV operating/Voc/Isc windows, installed isolation across parallel paths,
bonding, panel/protection/switching/conductor synthesis or installation access/
ventilation is asserted. Requested unsupported interpretation stays unresolved;
other later checks stay deferred. No customer/embed UI, ingestion/promotion,
advisory, builder preference, ranking, stationary rules or CAD behavior changed.

Documentation in `ARCHITECTURE_GENERATION.md`, architecture/Phase 3 links and nearby
comments explains endpoint ownership, functional grouping, product-slot granularity,
unresolved shared capacity, storage authority, generic charging, bounded growth,
snapshot ownership, provenance and Phase 5 handoff. No non-obvious limit or default
was introduced without scope/rationale. Review remains at the declared nominal scope.

## Final A–X trust audit

Each answer is No at the implemented Phase 4 boundary and trusted explicit
project-policy input; none remains possibly yes.

| Check | Protection/evidence |
| --- | --- |
| A: Current availability influences generation | No catalog argument or runtime corpus import; varied/empty corpus artifacts identical. |
| B: Manufacturer/product becomes a default | Generic policy/roles only; closed schemas reject product/commercial injections. |
| C: Missing input becomes numeric assumption | Optional numbers retained; missing power/voltage/energy unresolved; prose never interpreted. |
| D: Unknown becomes blocked/viable without evidence | Explicit unresolved dependencies retained; known contradictions separate; reconstruction prevents stronger labels. |
| E: Source voltage determines house voltage | Independent 12/24/48 exploration; fixed voltage alone narrows house choices. |
| F: Unlike domains connect without conversion | Shared passive/domain checks block mismatches; directed conversion/charging paths explicitly required. Unknown DC load voltage asserts no necessary converter. |
| G: Passive hardware becomes conversion | Only permitted canonical functional path types authorize conversion; passive replacement and distribution capability tests block. |
| H: PV context disappears on nominal equality | `pv_dc` retained; explicit solar conversion; passive/generic DC crossings remain unresolved. |
| I: Battery series/parallel permission invented | Storage role only; no runtime banks/counts/permissions; test witnesses explicitly authored and isolated. |
| J: Structural status becomes exact compatibility | Explicit abstract scope and product-binding `not_evaluated`; no compatibility label. |
| K: Constraint provenance is lost | Every gate/route carries exact input pointer and decision; resolvability tested; forged provenance rejected. |
| L: Ordering changes engineering truth | Code-point/numeric deterministic iteration; independent conjunctive gate outcomes; blocker/unknown aggregation retains dependencies. |
| M: Duplicates/IDs make replay unreliable | Set dimension collapse, final digest map, full candidate/envelope digests, deterministic reconstruction and external replay checks. |
| N: Expansion becomes unbounded | Schema/policy admission caps and pre-allocation unique expansion rejection; maximum 32 tested. |
| O: Commercial/builder preference changes generation | Closed product-free input/policy and transitive runtime graph tests. |
| P: Grounding invented from terms | IDs/text do not synthesize bonding; structured requested bonding remains unresolved without topology. |
| Q: Phase 5 selection occurs | No product records, catalog membership, gate execution or exact binding in runtime generation. |
| R: Phase 6 ranking occurs | Deterministic enumeration has no recommendation, price, weight, manufacturer or preference score. |
| S: UI receives installation approval | Machine scope/safety fields prohibit approval labels; forged scope/status/safety rejected after rehash. Future consumers must preserve this contract. |
| T: Load count silently dictates converter/inverter count | One domain partition owns role count; 64 compatible demands still have one conversion role. Isolation/different domains explicitly separate. |
| U: Demand mistaken for mandatory catalog slot | Separate closed endpoint contract with not_required binding; no load role or load-consumption slots. |
| V: Co-located load creates storage power authority | No copied W gates; explicit unresolved storage dispatch and deferred sizing. |
| W: Missing concurrency becomes aggregate rating | Individual lower bounds only; shared capacity and candidate unresolved; no sum/diversity/schedule inference. |
| X: Unknown shared capacity prevents shared topology | Shared domains/routes/roles retained; combined AC arrangement remains representable with unresolved capacity. |

PHASE 4 READY FOR HUMAN REVIEW
