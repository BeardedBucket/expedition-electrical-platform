# Blue Sea Systems m-Series 6006 — Checkpoint G Evidence Package

Status: **pending human review**. This document is an evidence and candidate
review package only. It is not canonical approval and does not authorize
promotion or a canonical write.

## Exact identity

- Manufacturer: Blue Sea Systems
- Product family: m-Series
- Product: m-Series Mini On-Off Battery Switch with Knob - Red
- MPN: 6006
- Candidate: `bluesea.mseries.6006`

The historical `data/components/blue-sea-systems.m-series-6006.yaml` draft was
not used as evidence, inspected, modified, promoted, or used to construct the
candidate.

## Official sources

| ID                                             | Type                               | Applicability                                                                           | Retrieval / hash                                                                                       |
| ---------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `bluesea.mseries.6006.product-page`          | Official product page              | Direct identity: 6006                                                                   | Retrieved 2026-09-08; Cloudflare challenge capture retained as limitation, no content hash claimed |
| `bluesea.mseries.6006.instructions`          | Official instructions PDF          | Explicitly covers 6006 and 6006200                                                      | `sha256:1618923f816efde20d21492fc4b756e113831098cbcb18abea7329b3e71b1f83`                              |
| `bluesea.mseries.6006.dimensioned-drawing` | Official dimensioned drawing PDF | Family drawing explicitly lists 6006                                                  | `sha256:7cc74f7fbfefeb04505edb6118d069b5733d724e912a46875f926bb305f3f980`                              |
| `bluesea.mseries.operation-diagrams`       | Official operation-diagram PDF   | Single Circuit ON-OFF behavior applied after exact 6006 page identifies its switch type | `sha256:172387ee3a412c4d445da353972b08c48720c2ef227b6f9f2c8daab00ae7a641`                              |
| `bluesea.mseries.6006.ul-certificate`        | Official UL certificate            | Certificate lists catalog number 6006                                                 | `sha256:38df2a287a69f10e6e141eeab3abde852f44c135d240f4c59a9b4c5cc4273f13`                              |
| `bluesea.mseries.6006.990520240`             | Official instructions PDF          | Explicitly covers 6006 and 6006200                                                      | `sha256:0d61fee8fde4b90f438a4e83cc72ee702f3bcc22445b33fda871bbc6640782f1`                              |

The persisted artifact is
`data/ingestion/blue-sea-systems-m-series-6006.json`. Secondary sources were
not used.

## Direct manufacturer facts

- Exact 6006 product title and red knob variant.
- Product family: m-Series.
- Switch type: Single Circuit ON-OFF.
- Two switch positions.
- Battery combine: No.
- Alternator field disconnect: No.
- Two main switch terminals.
- Terminal labels: Terminal 1 and Terminal 2; studs are 3/8-16 (M10), tin-plated copper.
- Battery cable terminal torque: 120 in-lb (13.56 N m), under nut and lock washer.
- Maximum voltage rating: 48 V DC.
- Continuous rating: 300 A DC.
- Intermittent rating: 500 A DC for 5 minutes.
- Cranking ratings: 1,500 A DC for 10 seconds and 775 A DC for 1 minute.
- Cable size to meet ratings: one 4/0 AWG (120 mm2) cable per terminal; reducing
  cable size reduces the stated current ratings.
- Cable clearance for 4/0 AWG cables: 1.12 in (28.45 mm).
- Mounting options: surface, front panel, or rear panel.
- Manufacturer drawing values include 3.320 in / 84.34 mm, 2.950 in /
  74.93 mm, and 2.175 in / 55.25 mm views.
- Weight: 0.65 lb / 0.29 kg.
- Product page snapshot carries ignition-protection and IP66 claims; the capture was Cloudflare-blocked, so those claims remain source-scoped and unpromoted.
- A product-page 25 A switching-rating claim has an unresolved semantic relationship to the 300 A continuous contact rating. The claim is preserved as unresolved informational evidence and is not normalized into the canonical constraint set.
- UL certificate lists 6006 among marine battery switch samples investigated
  under UL 1107.

## Switching-rating source audit

The exact 25 A meaning was checked against the first-party 6006 product page,
the 6006 instructions, the m-Series operation-diagram reference, the UL
certificate, and Blue Sea's first-party electrical-conductivity article and
related switch documentation available in the review package. The product page
labels the value only as "Switching Rating: 25 A"; none of those sources
defines whether it is a load-current switching/breaking rating, a fault-current
interrupting/AIC rating, or another test condition. The operation diagrams
describe switch configurations and continuous ratings but do not define the
25 A label. Therefore the value remains an unresolved informational fact; it
is not projected into either interruption semantic.

## Derived and unresolved values

- No canonical x/y/z dimension assignment is made. The drawing contains
  views and dimensions but does not establish a repository component-local
  orientation.
- No duration is inferred beyond the manufacturer's explicit 5-minute
  intermittent and 1-minute/10-second cranking labels.
- No current duty-cycle, thermal derating, cable ampacity, or installed
  voltage compatibility is derived.
- The source set does not establish make-before-break or break-before-make
  behavior.
- Official 990520240 text directly establishes a removable knob for security and service lockout. It does not define a new electrical switching configuration.
- No installed role such as house-battery disconnect is asserted.

## Proposed topology interpretation

The product is modeled as passive switching hardware:

- Connection points:
  - `bluesea.6006.terminal-1`
  - `bluesea.6006.terminal-2`
- Conductive relationship:
  - `bluesea.6006.main-contact`
  - participants are the two product-local connection points
- Switching configurations:
  - `bluesea.6006.off`: no active main-contact relationship
  - `bluesea.6006.on`: main-contact relationship active

The candidate contains no `power_paths`, converter capability, or intrinsic
directionality. The ON/OFF relationship describes the product's internal
contact state; it does not assign external batteries, buses, chargers,
inverters, or loads.

## Canonical projection and reviewed generic constraints

The candidate proposes only identity, disconnect role/category, connection
points, conductive relationship, and switching configuration for future
reviewed promotion.

The following are represented in the candidate evidence. The exact 48 V and
300 A claims are proposed on the passive conductive relationship using the
generic bounded constraint contract. Other claims remain provisional
informational facts pending human review:

- 300 A continuous;
- 500 A for 5 minutes intermittent;
- 775 A for 1 minute and 1,500 A for 10 seconds cranking;
- 48 V DC maximum;
- cable size and cable clearance;
- stud size, stud material, and torque;
- manufacturer dimensions;
- mounting options;
- weight;
- ignition-protection, IP66, and certification claims;
- battery-combine and alternator-field-disconnect negatives;
- unresolved switching transition behavior;
- removable knob/service lockout semantics are represented as a reviewed fact, not as a switching state;
- any installed-system role or relationship.

The generic component schema shares the electrical-constraint contract between
logical ports and passive `conductive_relationships`. The candidate uses the
contact relationship for the canonical 48 V DC maximum and 300 A DC
continuous rating. Short-duration ratings remain informational facts, and the
candidate creates no converter or installed-system power path.

## Candidate validation

The candidate is built with the complete `ProductCandidate` contract:

- source IDs and identity source IDs;
- atomic facts;
- candidate fact IDs;
- normalized component projection;
- complete field evidence;
- topology evidence for both terminals, the conductive relationship, and both
  switching configurations.

Validation is expected to be `ok: true` with unresolved review issues because
the facts are provisional and require human review. Invalid evidence
references are absent.

## Review questions

1. Does the official family/operation material establish the proposed ON and
   OFF contact semantics for exact 6006?
2. Is the two-terminal contact relationship the correct generic representation?
3. Are the exact 48 V maximum and 300 A continuous constraints correctly scoped
   to the passive contact relationship?
4. Are the duration-qualified ratings appropriately retained as informational
   evidence without canonical duration semantics?
5. Are the IP66, ignition-protection, and UL 1107 claims sufficiently scoped
   for canonical storage without broader safety interpretation?
6. Should any additional state semantics be added, or should unknown
   transition/lockout behavior remain unmodeled?

## Semantic promotion snapshot

The actual snapshot is produced by
`promotionCandidateSnapshot()` after candidate construction and validation. It
is distinct from the raw JSON artifact hash and is intentionally not bound to
a human review artifact yet.

- Raw candidate artifact SHA-256:
  `sha256:03aa8978b42b22fac5ab43e8029fc226bd5c8138a13198be5323c2764a6de7f7`
- Semantic promotion snapshot:
  `sha256:f0da14b13e4da421512e979b4e135ff3f8dc395675b6ab95f552f1ad4fe615c3`
