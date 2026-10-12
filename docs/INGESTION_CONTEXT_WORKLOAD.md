# Qualified context and semantic workload

This continuation keeps the accepted verification, durable destination,
amendment-history and Phase 5 boundaries intact. It changes source-context
representation and semantic accountability. Rules are proposals for ordinary
maintainer code review; validation does not approve products or rules.

## Producer-owned context

`qualified-context.v1` is optional on QualifiedFact evidence with role `context`
or `qualifier`. Its closed kinds are `source_semantic`,
`qualification_provenance`, and `unresolved`. Producer identity and revision 2
record the implementation that knows the purpose of the evidence. The revision
marks the typed producer contract, not a manufacturer document revision.

| Producer                                                      | Known purpose and ownership                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile-qualified-evidence.ts`                               | Source qualifier cells/text are `source_semantic`; the separately generated extraction-profile/qualification explanation is `qualification_provenance`. Original source cells, locators and metadata conditions remain retained.    |
| `production-contracts.ts` document qualification              | Source qualifier rows/text are `source_semantic`; the generated whole-table model-header scope proof is `qualification_provenance`. Its source reference binds the owning extraction. Applicability is still checked independently. |
| `model-column-qualification.ts`                               | Source qualifier evidence is `source_semantic`; ordering-matrix applicability evidence keeps its separate role and exact document proof.                                                                                            |
| QualifiedFact builders, runtime codec, candidate ProductFacts | Preserve optional typing and complete evidence. They do not infer types for persisted observations.                                                                                                                                 |

The production producer audit used tracked ingestion sources, including every
literal `context`/`qualifier` evidence constructor and its helper calls. Neither
locator/note text nor a profile name, category or manufacturer establishes a
semantic kind. Consumers validate policy, producer and revision. Ignorable
provenance additionally requires role `context` and a source reference matching
the fact's owning capture or extraction kind/digest. Foreign or unsupported
typing fails closed. Source-authored text remains in qualified source conditions;
blank/missing text and explicit unresolved context block automatic projection.
Old role `qualifier` remains a source assertion when it has usable text. Old
untyped role `context` remains unresolved even if its words resemble provenance.

| Consumer                              | Boundary                                                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic semantic interpreter          | Only bound typed provenance can be ignored as an engineering condition. Semantic text is retained exactly; mixed/unresolved context remains visible.                                                                                   |
| Source-native reconciliation F        | Typed source-semantic context is an unsafe comparison condition. Provenance is retained without supplying a value or a semantic key. Untyped persisted inputs preserve historical F replay; the semantic layer independently abstains. |
| Legacy and reviewed scalar projection | Refuse source qualifiers/context that would disappear from a scalar. Pure bound provenance may remain in lineage without changing that scalar.                                                                                         |
| Candidate and qualified-value replay  | Reconstruct assertions against the stored supported interpreter and exact source facts, descriptors and digests. Supporting role/domain/body-scope facts receive the same context guards.                                              |
| Operator view                         | Shows source context text/typing and an allowlisted retention-rule summary in a separate automatically retained-evidence section. Full source evidence remains available; internal writer paths are not added.                         |

`semantic-assertions.v3` and `production-semantic-bridge.v8` own this historical
context/workload slice. Current greenfield production uses v5/v10; see
[greenfield ingestion](INGESTION_GREENFIELD_ACCEPTANCE.md) for the later producer
and grammar contracts. Frozen v8/v3 artifacts retain this slice's 28-rule catalog.
Frozen v7/v2 artifacts replay with the unchanged 24-rule v2
catalog and conservative context handling. Frozen v6 uses its legacy bridge;
current candidate guards still refuse context loss. Unsupported v1 assertion
interpretation does not acquire authority. Rule digests include the interpreter;
neither a stored assertion nor a human decision silently inherits new grammar.

## Automatic retention has no engineering authority

`retained-evidence.v1` has five closed exact grammars, each revision 1. They
classify observation ownership rather than parsing engineering values:

| Rule                                 | Exact normalized labels                              | Rationale                                                                                   |
| ------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `retained.identity.brand`            | brand; manufacturer name                             | Organization attribution supplies no capability or compatibility.                           |
| `retained.identity.trade_identifier` | GTIN; GTIN_barcode; UPC; catalog number; OEM model # | Exact identifiers remain evidence and do not select a variant or establish a specification. |
| `retained.identity.product_name`     | product name                                         | Display-name words are never interpreted as product role or ratings.                        |
| `retained.commercial.packaging`      | packaging type                                       | Commercial packaging is distinct from body geometry or installed envelope.                  |
| `retained.commercial.warranty`       | warranty                                             | Terms do not establish reliability, lifetime, safety or permission.                         |

The empirical grouped audit motivated these grammars, and the descriptors state
the independent ownership rationale. Case/whitespace normalization is explicit;
no fuzzy, category, product-name or manufacturer matching occurs. Every group
member must match a rule through exact QualifiedFact references/digests. Mixed
groups, true reconciliation conflicts, derived observations and alternative
interpretations abstain. Complete source snapshots, qualifiers and rule digests
are retained so a future layer can reinterpret them without losing evidence.

The resulting `evidence_only` proposal has
`projection_authority: none`, no proposed value, qualified value or engineering
assertions, and exact policy/rule/revision/source proof. Candidate construction
cannot project it. Review completion closes it only for the automatic
interpretation entry with valid replayed proof. A bare `evidence_only`,
`unsupported`, or `source_label:*` observation still requires human disposition.
Hashes are replay identities, not signatures or authenticated product approval.

Certifications, standards, mounting and installation restrictions, capabilities,
generic categories, section labels and unknown words are excluded. Persisted
section-looking labels do not prove structural ownership; no text-based migration
or blanket heading exemption was added. Producers already retain document/table
structure as extraction evidence. If a future producer creates structural
observations, it must supply an explicit structural-role contract before they can
close automatically. Current ambiguous observations remain human-reviewable.

## Generic rules and existing representation

The v3 catalog has 28 rules: four additions and three descriptor revisions.
All require exact/structurally supported whole-product applicability, exact unit
parsing, unambiguous reconciliation and complete representable source context.
Conditions, duration, temperature and source revision remain qualified; they
never imply that an installed system satisfies those conditions.

| Rule change                                                                  | Sufficient source semantics, units and guards                                                                                                                                                                                    | Projection                                                                                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `generic.weight` revision 2                                                  | Adds exact `product weight` to mass labels; mass units convert to kg. No electrical domain/role is inferred.                                                                                                                     | Existing scalar `weight_kg` only without conditions; conditioned mass stays qualified.                                                         |
| `generic.charge_voltage` revision 2                                          | Adds explicit max/maximum charge-voltage basis; V or exact V range, independent source-authored battery product role required. A charger's supported-battery voltage is not a battery property.                                  | Qualified `battery.charging_voltage_range_v`, preserving maximum basis.                                                                        |
| `generic.frequency` revision 2                                               | Adds exact `(configurable)` suffix; Hz and explicit AC domain required.                                                                                                                                                          | Qualified `electrical.frequency_hz`; source configurability is retained, never an installed setpoint.                                          |
| `generic.solar_input_voltage` revision 1                                     | Exact solar input voltage/range with optional maximum basis; V, DC/PV input direction established by the source grammar.                                                                                                         | Qualified existing input-voltage target with exact PV label retained. No open-circuit equivalence or array-fit claim.                          |
| `generic.body_width`, `generic.body_depth`, `generic.body_height` revision 1 | Explicit body-axis label, or a unique same-capture/acquisition/applicability `Dimension scope`/`Physical scope: physical body` source assertion without conditions. Length units convert to mm. Bare/product axes alone abstain. | Qualified `dimensions_mm.x/y/z` in component-local width/depth/height convention. No installed orientation, clearance or envelope implication. |

Tests cover each added grammar, exact conversion, conditional retention, absent
or competing scope, wrong units, foreign/legacy context, wrong electrical domain,
battery-owner absence, stale rule/policy proof and historical interpreter replay.
The body's three targets extend existing `source_rating` enums in component,
product-fact and production schemas; they add no installed geometry defaults.
The optional context/proof shapes are closed in the applicable schemas. The
production proposal evidence-reference schema also now admits the acquisition,
extraction and QualifiedFact reference kinds already emitted by production,
matching the existing runtime contract rather than narrowing away provenance.

All 109 corrected grouped rows are audited individually in the TEMP handoff
against current rules, canonical normalizers, qualified values, port/path and
constraint ownership. Their complete source values remain in the TEMP evidence.
The following boundaries explain why remaining vocabulary is not a schema gap:

| Concept family                                   | Existing representation and unresolved requirement                                                                                                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voltage/current/power, efficiency, idle/standby  | Scalar and qualified source-rating targets exist. Bare Voltage/Amps/Watts/Input/Output lack quantity role, domain, direction or rating basis. Multi-option values need option semantics rather than an arbitrary chosen scalar.                          |
| Battery chemistry/capacity/voltage               | Existing battery and charger/port structures differ. Supported-chemistry lists and connected-battery ranges cannot establish the product's own battery chemistry/nominal voltage. Pb-equivalent Ah is not nominal capacity.                              |
| Body dimensions/form factors                     | Existing axes, legacy reviewed body region and qualified axes exist. Multi-axis order, length/depth ambiguity, packaging and group-size designations require explicit geometry ownership.                                                                |
| Fuse, interrupt and pole ratings                 | Existing protection/constraint and port structures need protected participants, AC/DC and voltage basis, device-versus-required-external-fuse role and pole topology. A bare current magnitude does not establish interrupt capability.                  |
| Temperature/install restrictions                 | Existing installation conditions and qualified context can preserve evidence. Operating, storage, ambient and conditioned rating temperature are different; a label alone cannot establish installation satisfaction or a complete range interpretation. |
| Resistance, cycle life, self-discharge, accuracy | Test regime, quantity definition, period, end-of-life criterion and voltage/temperature basis remain unknown. Retention does not fabricate those missing conditions.                                                                                     |
| Certifications/material/connectors/control       | Potentially meaningful source claims remain human work. Endpoint existence does not establish protocol compatibility; material or compliance words do not establish engineering safety.                                                                  |
| Plumbing flow/pressure and navigation sections   | Outside present electrical engineering ownership. Retained evidence supplies no selector quantity; ambiguous old structural facts remain human-reviewable rather than expanding platform scope.                                                          |

No reviewed schema/model gap is asserted: the frozen input has no human semantic
decisions proving one. This does not prove gaps are absent. No additional roadmap
contract seam is justified solely by these labels; existing qualified-value and
structured product contracts remain missing-safe.

## Pressure metrics and limitations

All replay inputs are physical TEMP copies of the same 20 jobs and batch. The
original 21 envelopes remain read-only. There is no refetch, approval,
finalization, promotion, component write or verification. F replay remains exact.

| Metric                      | Frozen baseline | Unsafe milestone | Corrected v2 | Current v3 |
| --------------------------- | --------------: | ---------------: | -----------: | ---------: |
| Proposals                   |             195 |              197 |          197 |        197 |
| Mapped                      |              26 |               55 |           28 |         14 |
| Unsupported                 |              88 |               76 |           76 |         55 |
| Unresolved                  |              80 |               65 |           92 |        114 |
| Evidence-only               |               1 |                1 |            1 |         14 |
| Automatically retained      |               0 |                0 |            0 |         13 |
| Non-mapped                  |             169 |              142 |          169 |        183 |
| Required human dispositions |             169 |              142 |          169 |        170 |

The current reduction of repetitive identity/commercial work is 13 proposals.
It is offset by withholding legacy scalar mappings with untyped context: the
frozen facts cannot inherit new producer tags from wording. Increased remaining
work is reported explicitly. Newly produced typed provenance demonstrates safe
generic projection in tests; no empirical recovery from unavailable raw bytes is
claimed. Five empty review-ready packages and three acquisition failures remain.
The report separates mapped assertions, retained evidence, value/unit,
context/applicability, conflicts, genuine human semantic work and stage limits.
Every non-mapped group, human row, retained row, mapped rule and product appears
in the report with exact source/rule/context identities. Historical reports are
preserved. Counts confer no authority, completeness or product safety finding.

No new transport/parser/retry/time/resource limits are introduced. Verification
remains a separate explicit trusted-local human action over exact durable content;
operator labels remain unauthenticated and missing engineering data stays unknown.
