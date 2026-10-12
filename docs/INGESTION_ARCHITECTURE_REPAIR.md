# Ingestion semantic architecture and verification repair

The accepted authority corrections below remain in force. The v7/v2 vocabulary
and pressure comparison describe the corrected historical checkpoint. Current
v8/v3 context typing, archived replay, automatic retention and the workload
policy supersede its untyped-context limitation in
[Qualified context and semantic workload](INGESTION_CONTEXT_WORKLOAD.md).

This change separates source evidence, semantic interpretation, candidate projection,
product approval, canonical promotion, and engineering verification. It supplies
reviewable generic rules and a separate trusted-local verification action. It does
not approve the pressure corpus or establish installation suitability.

## Historical v7/v2 evidence and semantic boundaries

Checkpoint F remains source-native. Its original groups and reconciliation are
recomputed and validated independently; `source_label:*` remains an evidence key,
never an engineering target. The v7 production bridge adds a separate comparison
over explicit semantic concepts, normalized units, exact product applicability,
and complete qualifiers. It does not mutate F to obtain a favorable comparison.

`semantic-rules.ts` contains 24 closed, anchored label grammars. Recognition requires
an exact supported grammar and dimensionally valid numeric value or supported
voltage range. It never uses fuzzy matching, confidence scores, manufacturer
branches, product-name similarity, or an operator's category selection. Battery
quantities require explicit, unique, unconditional battery-role evidence from the
same capture, acquisition, and applicability scope. A DC-to-DC declaration can
provide domain context only in that same scope; competing or conditioned context
requires review. AC frequency and PV open-circuit voltage have explicit domain
guards. An ordinary label such as "voltage" or "amperage rating" is insufficient
to infer a port, direction, rating basis, or device function.

Every new recognized assertion carries the qualified source fact identity and
digest, supporting context facts, the complete rule descriptor, rule ID/revision,
descriptor digest, and interpreter revision (`semantic-assertions.v2`). Its source
wording, locators, conditions, and applicability remain reachable. These are
source-stated assertions; existing calculated battery quantities retain their
separate derivation, formula, assumptions, and input lineage.

Semantic comparison includes the target, applicability, and all qualifiers. Equal
values under different conditions remain separate assertions. Different exact
values under the same conditions become a conflict; unresolved units, domains,
roles, or inequalities do not become fabricated conflicts. There is no automatic
winner. Grouping retains all contributing facts rather than erasing evidence.

The v2 interpreter corrects qualifier loss without changing the v7 bridge or rule
catalog. Nonblank `qualifier` source text is preserved exactly in deterministic
`source_conditions`. If qualifier text is absent or blank,
`qualifier_context_unresolved` prevents automatic mapping/projection. Generic
`context` evidence can contain extraction-profile provenance rather than a source
assertion, so it also remains unresolved until that distinction is explicitly
modeled/reviewed; even nonblank context text is not copied into rating conditions.
Locators, notes, references, block IDs and cell IDs cannot supply condition meaning.
The complete source fact remains retained; its digest participates in comparison
when contextual evidence cannot be represented, preventing false agreement between
otherwise equal values with different unresolved evidence. Ordinary unconditioned
mass still uses the existing scalar representation. Equivalent reviewed legacy
battery interpretations remain separate, but cannot bypass unresolved context.

The context-field audit covers every known QualifiedFact field: metadata conditions,
duration, temperature and revision context are carried into qualifiers; applicability
is separately compared exactly; derived values, derivation and alternative
interpretations require human review. Raw wording/value/unit remain source evidence
and typed normalization inputs. Raw/normalized identifier and normalization-method
metadata identify source identity rather than rating conditions. Qualification
state gates recognition; qualifier name/version and acquisition/extraction/capture
references identify the qualification process and evidence origin, not engineering
meaning. Contextual evidence on supporting role/domain facts also prevents an
unconditional context inference. No meaning is inferred from locator or note text.

## Vocabulary and representation audit

| Source concept                                                                                | Representation and boundary                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nominal, input, and output voltage; input/output/charge/discharge current                     | Qualified `source_rating` assertions retain direction, explicit AC/DC domain, and nominal/maximum/rated/continuous/peak/surge basis when stated. Maximum current is never silently relabeled continuous current.                     |
| Operating, output, rated, continuous, peak, apparent power                                    | Separate targets and W/VA dimensions; battery-voltage conditions, full-load context, temperature, duration, source footnotes, and revision context remain attached.                                                                  |
| Frequency, PV open-circuit voltage, idle/standby current, conditioned consumption             | Explicit quantity and domain rules; no endpoint or product-category inference. No idle/standby rating becomes an unconditional installed-load estimate.                                                                              |
| Efficiency and mass                                                                           | Exact ratio/mass unit conversion. Efficiency is bounded to [0, 1]. Unconditioned mass may project into the existing scalar; conditioned mass remains qualified.                                                                      |
| Battery capacity, energy, charge and float voltage                                            | Require source-authored battery role. Existing reviewed battery chemistry, DoD, body dimensions, explicit series constraints, and derivations remain separate legacy vocabulary. Unknown series/parallel permission remains unknown. |
| Isolation, grounding roles, bidirectional topology, ports, interfaces, protocol compatibility | No inference from words, endpoint existence, category, or family similarity. These need structured participants, direction/domain, protocol/capability evidence, or a reviewed generic interpretation that carries those relations.  |
| Resistance, cycle life, self-discharge, connector/form-factor/designation claims              | Existing evidence-only or unresolved boundaries remain. A label alone does not justify an electrical scalar; test regime, time basis, geometry or participants may be missing.                                                       |

The schema extension addresses a representation gap: existing scalar fields and
port/path objects cannot preserve a generic source rating's entire condition set
without asserting that the installation satisfies it. The new `source_rating`
kind and its closed target/qualifier vocabulary reside in the existing
`qualified_values` mechanism. The component, product-fact, and production schemas
intentionally repeat this contract because each is independently validated.
There are no manufacturer-specific fields. Positive battery-voltage conditions,
nonnegative magnitude values, and bounded efficiency are dimensional validity
constraints, not installation safety thresholds; signed net-flow observations
are outside this magnitude-rating vocabulary.

Condition strings preserve source assertions exactly; they are not executable
predicates. A consumer must explicitly interpret typed qualified values before
using them for engineering. Phase 5 does not acquire new topology, protocol,
grounding, or compatibility authority from these source ratings automatically.
Unknown data remains absent. Verification of a sparse record does not assert
that every relevant engineering field has been modeled.

## Historical v7/v2 rule governance and legacy replay

Rule definitions and interpreter changes are maintained through ordinary code
review with source/protocol rationale and positive and negative boundary tests.
No browser or API can install arbitrary caller-authored recognition rules.
The catalog in this working change is a proposal for maintainer review; test
success is not approval of these rules or of any product.

Candidate projection replays the recognized assertion against the current rule
catalog and checks the stored descriptor, interpreter, source, and value. A
changed v7 rule invalidates an old v7 artifact rather than rewriting its
provenance. Reprepare and review a new snapshot explicitly. Existing v6 artifacts
use the frozen legacy bridge, preserving the historical review contract; their
lineage remains resolvable through the original durable evidence and decisions.
Projection explicitly refuses legacy scalar assertions that would discard known
conditions or reinterpret a maximum/peak/surge rating as continuous. It preserves
the old proposal as evidence rather than rewriting it under the new rule.
The historical v6 bridge retains its limitations rather than retroactively
claiming it recognized the new vocabulary.

The reviewed scalar mapper is v2. It rejects condition or qualifier loss and
known maximum-to-continuous reinterpretation. Compatible unconditional v1
decisions still replay; unsafe conditional v1 decisions fail explicitly. For
recognized ordinary quantities, operators need not repeatedly select a target
for each product. A genuinely novel conditional quantity needs a reviewed
generic rule or an explicit unresolved/schema-gap disposition. This slice does
not introduce an arbitrary human-authored qualified-value editor or an automatic
conflict-resolution policy. Unsupported wording alone is not proof of a schema
gap; reviewers must identify the concept and the representation missing.

## Exact model-to-part applicability

`exact-model-part-relation.v1` accepts an explicit ordering matrix only from a
complete retained extraction. Distinct Model/Model Name and Part Number/MPN/SKU/
Ordering Code headers must identify one unique row with the exact requested
model and exact part identifier. Row/column/table/path locators must agree.
Spans, partial extraction, duplicates, one model with multiple ordering parts,
and an identifier shared by multiple models cause abstention. Matching trims
surrounding whitespace only; case, regional, packaging, and electrical suffixes
are not removed.

The original part-number qualification pass remains. A supplemental model pass
is allowed only after the relation is proved in that same document; rebuilt
facts retain both ordering cells as applicability evidence and the original
capture identity. The relation is never borrowed across documents. Synthetic
tests demonstrate model-column qualification, sibling isolation, and negative
ambiguity boundaries. Retained-corpus qualification still yields the same 208
facts: no empirical recovery of the five empty packages is claimed.

## Separate engineering verification

The current application is a trusted, loopback-only local operator tool.
`operator_label` is operator-supplied audit text, **not authenticated identity**.
No login/RBAC subsystem or public deployment is introduced. The service owns
timestamp, canonical path, promotion origin, and record content; the browser
supplies only its expected snapshot and explicit verification intent.

Promotion continues to write `unverified`. After a successful approved promotion
and recorded canonical write, the operator can separately load the exact record,
inspect it, enter a label, acknowledge verification intent, and verify. Semantic
completion, approval, finalization, batch preparation, or candidate recognition
never invokes verification. The API requires the matching finalized durable job,
approval, promotion and successful write identities. It refuses stale snapshots,
wrong lifecycle states, malformed history, and historical origin mismatches.

The server-selected path is the absolute destination recorded by the successful
durable write, validated against the configured root and exact `<component-id>.yaml`
leaf. Host path operations preserve Windows drive/case semantics. Physical root
and destination checks reject leaf redirects outside that root. Root A followed
by root B containing an identical same-ID record fails closed; the service cannot
borrow A's write identity for B. Verification proves the destination again under
the shared record lock, then reads and replaces that same physical file. The
browser supplies neither root nor path. Filesystem owners remain inside the local
trust boundary; this is not protection against hostile concurrent filesystem edits.

`canonical-engineering-verification.v1` events bind the component ID, exact canonical content
snapshot and SHA-256, source/amendment lineage digest, policy, actor kind/label,
server timestamp, promotion origin, linear revision, and previous event digest.
Content identity excludes only verification status/history; it conservatively
includes all other metadata and preserves missing fields. The expected action
snapshot includes history as well, preventing replay of an old verification.
Hashes establish identity and accidental/stale/tamper detection, **not signatures
or authentication**. A coherent malicious rewrite by a trusted filesystem owner
is outside this local trust boundary.

Verification and supported canonical amendments share an exclusive per-record
`.authority.lock`. There is no expiry, automatic stealing, retry loop, or wait
budget: contention fails, and the operator reloads. A verification rereads under
the lock, validates the exact snapshot, appends the event, and atomically replaces
the YAML record using its own uniquely created temporary file. Cleanup ownership
is local to that operation. Cleanup failure can be reported after replacement;
inspect/reload rather than blindly retrying. Stop all writers and inspect the
record before manually recovering an orphan lock. YAML duplicate-object aliases
are disabled because event snapshots intentionally share values in memory;
sorted aliases could otherwise precede anchors. Injected filesystem adapters
own their atomicity; real default writes use the shared lock.

A supported content-changing amendment persists `unverified`, retaining previous
events. External edits invalidate the current event; the Node loader downgrades
stale authority and selection validation refuses it. Reverification requires a
new explicit action over the changed content. Valid unchanged records preserve
their missing fields through loading. A literal `verified` status without valid
content-bound event history has no current engineering authority. The Node loader
downgrades it to `unverified`; direct Phase 5 selection validation refuses it.
There is no grandfather exemption or automatic production-history fabrication.
Schema conformance describes record structure, not verification authority.
Synthetic selection fixtures explicitly construct test-only content-bound events
where authority is needed, with a helper restricted to synthetic fixture IDs.
Verification logic with Node cryptography is a separate
Node export, not a browser write-authority API.

Ordinary canonical amendment APIs cannot add, remove or replace verification
history or its nested fields: the closed canonical field allowlist excludes it,
and the writer copies only explicitly approved amendment fields. Unapproved
candidate history is ignored. Focused regressions cover all three patch actions,
history-less and history-bearing originals, nested event fields, byte-preserving
rejection, retained historical events on a supported amendment, and required
explicit reverification. Only the separate verification transition appends events.

A future hosted adapter must supply authenticated principals and authorization
before invoking this lifecycle, own trusted timestamps and durable event storage,
and version the authority policy accordingly. Reusing an operator label or these
digests as an authenticated principal would violate that boundary.

## Historical corrected-v2 offline production pressure evidence

The frozen batch is `23345c90-2e8e-40a5-abba-a740102ca412`: 20 jobs, 16
manufacturers, 17 review-ready, three preparation-failed, 274 captures (256
authoritative, 12 non-authoritative, six failed), 208 QualifiedFacts and 191
source-native F groups. The original 21 batch/job envelopes remain unchanged.
No original job was approved, finalized, promoted, written, or verified.

`scripts/ingestion-pressure-replay.mjs` reads explicitly supplied physical TEMP
copies with validated envelopes and exact batch membership. It recomputes F,
runs the current semantic and candidate bridges twice, separately replays
qualification over retained extraction artifacts, and checks copied input bytes.
It never calls a capture adapter, network, store mutation, approval, promotion,
writer, or verifier. It refuses authority-bearing inputs and existing output
files; its only write is a new TEMP report. Physical path checks account for
Windows TEMP aliases. Raw response bodies were not retained in the frozen jobs,
so extraction cannot be rerun from bytes; qualification replay uses only the
retained extraction artifacts. No refetch or bypass was performed.

| Metric                       | Frozen v6 baseline | Current v7 replay |
| ---------------------------- | -----------------: | ----------------: |
| QualifiedFacts               |                208 |               208 |
| Semantic proposals           |                195 |               197 |
| Mapped proposals             |                 26 |                28 |
| Unsupported proposals        |                 88 |                76 |
| Unresolved proposals         |                 80 |                92 |
| Evidence-only proposals      |                  1 |                 1 |
| Human dispositions required  |                169 |               169 |
| Projected candidate packages |                  2 |                 2 |

The pre-correction milestone had 55 mapped, 65 unresolved and 142 required human
dispositions, with five provisional candidate packages and 45 projected proposals.
The corrected interpreter withholds 27 formerly mapped proposals: all carry
unresolved context evidence or rely on contextual role/domain evidence. This is
an authority correction, not an optimization of counts. The corrected replay
has two provisional battery candidates with 16 projected proposals; candidate
existence is neither approval nor engineering eligibility. Morningstar's ten
recognized proposals still do not project because publisher metadata is missing.

Source-label fallback targets decrease from the frozen 161 to 132. The new v2
diagnostic report classifies all 169 remaining dispositions: 132 unrecognized
source-vocabulary fallbacks (including unresolved source-native comparisons),
two recognized value/unit limitations, 34 recognized context/applicability
limitations, and one evidence-only item. Seven of the 34 context cases also have
a value/unit limitation: context takes diagnostic precedence and all reasons
remain recorded. Conflict and other unclassified interpretation categories are
supported but have zero rows here. No reviewed schema/model gap is asserted:
this input has no human-reviewed decisions, and a missing mapper rule does not
establish a representation gap. This does not prove that no real gaps exist.

Every remaining row includes job/product identity, proposal ID, original/fallback
and normalized labels, target, disposition, recognized concept/rule/interpreter,
review reasons, rationale and non-projection diagnostics. The complete JSON and
human-readable table accompany the correction handoff in TEMP. Reporting adds
no semantic authority. All remaining dispositions require human accountability.
Retained extraction counts, original F outcomes, and zero-fact stages accompany
each product in the TEMP diagnostic report.

Blue Sea's HTTP 403, Indel B's HTTP 200 verification challenge, and Renogy's
existing HTML transport-limit failure remain acquisition limitations. They are
not product facts and were not retried or bypassed. Five review-ready zero-fact
packages remain qualification/extraction/applicability limitations. No new
parser/transport size, retry, timeout, or discovery budgets were introduced.
See [corpus coverage](CORPUS_COVERAGE.md) for the complete per-product comparison.

## Review scope and remaining limitations

Review the generic grammar/qualifier catalog, cross-schema contract, retained
legacy replay, exact ordering-matrix proof, and local verification lifecycle as
one architectural change. Boundary tests include recognized and abstaining
values, condition/domain/role isolation, stale rule/source replay, maximum versus
continuous ratings, qualification ambiguity, lineage/history tampering, stale
verification, path and lock contention, amendment invalidation, API ownership,
and explicit UI intent. Full validation and final integrity evidence accompany
the TEMP handoff rather than being claims of reviewed product truth.

Coverage remains incomplete: raw-body extraction replay is unavailable, publisher
metadata can block projection, genuinely ambiguous facts require human judgment,
and new structured topology/protocol interpretations remain separate work.
The existing seven canonical records remain unverified, and Phase 5's verified
gate remains in force. This repair does not add Phase 7 work or run selector
coverage using the unreviewed pressure products.
