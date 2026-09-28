# Real product semantic mapping audit

Audit completed before implementation, on `feat/production-corpus-ingestion`.
Protected local corpus files were not read or used. HTTP, extraction,
qualification, reconciliation, and canonical contracts remain outside this slice.

## Existing boundary

The registry resolves exact whitespace/case-normalized labels, never manufacturer
identity or values alone. Scalar mappings cover nominal voltage, explicit current
and power ratings, battery capacity/energy, weight, and individual dimensions.
Structured mappings cover supported nominal voltages, battery chemistry and
series/parallel counts. Evidence mappings cover PV maximum voltage, narrow mounting
vocabularies, and categorized face clearances; these are not candidate fields.
No existing alias matches the supplied Ekrano labels. None is merely a new spelling
of an existing scalar measurement.

The component schema and engineering library already define
`electrical.input_voltage_range_v` as `{min,max}` and `dimensions_mm` as
`{x,y,z}` in mm, with x=width, y=depth, z=height. Dimensions describe the local body,
not installed extents or service clearance. These two structured targets can accept
explicit unqualified values through new narrow generic normalizers. Existing scalar
unit parsing cannot parse ranges or ordered triples. No schema/core changes are
needed. Operating temperature endpoints and ingress ratings have no declared target.
Permissive JSON additional properties do not establish a canonical semantic.
Load-state energy exists in engineering but is not a component mapping target.
Generic interfaces/endpoints/connectors exist, but require explicit structured
integration rather than count/boolean aliases. Compliance has no matching evidence
registry target. Mounting alternatives do not match the narrow mounting vocabulary.

## Evidence and complete label classification

The committed whole-table qualification tests use Device ZX, not Ekrano. No retained
30-fact Ekrano artifact was available in the inspected workspace diagnostics. The
following is therefore a classification of the supplied label set, not a claim to
replay the historical 30 facts. The official [technical specifications](https://www.victronenergy.com/media/pg/Ekrano_GX/en/technical-specifications.html)
were checked on 2026-09-28 for value shapes. The deterministic fixture is a synthetic
equivalent using the current committed table qualification rule. It stores no page
copy and does not certify manufacturer facts. Historical artifact membership remains
unverified. Structural separators are tested separately and never counted as facts.

| Source label | Classification for published shape | Missing concept / reason |
| --- | --- | --- |
| Supply voltage | unresolved | Range target exists; DC context cannot be retained there; never nominal |
| Power draw display on (100% brightness) | unsupported | State and voltage-dependent consumption, not output rating |
| Power draw display off | unsupported | Separate state and voltage-dependent consumption |
| Relay | unsupported | Contact topology and domain-specific switching limits need integration |
| Communication ports | structural separator | No fact when full-span |
| VE.Direct ports (always isolated) | unsupported | Endpoint counts, isolation and device limits need integration |
| VE.Bus (always isolated) | unsupported | Bus versus parallel physical sockets and isolation |
| VE.Can 1 | unsupported | Endpoint and isolation semantics need integration |
| VE.Can 2 | unsupported | Endpoint and isolation semantics need integration |
| Ethernet | unsupported | Interface declaration needs structured projection |
| WiFi | unsupported | Interface declaration needs structured projection |
| Wifi Frequencies and Power | unsupported | Radio band/range/power, not electrical output |
| Bluetooth Smart | unsupported | Interface declaration with reference context |
| Bluetooth Frequencies and Power | unsupported | Radio band/range/power |
| USB Host ports | unsupported | Host connectors and combined power limit |
| MicroSD Card Slot | unsupported | Storage support and capacity limit |
| IO | structural separator | No fact when full-span |
| Resistive tank level inputs | unsupported | Sensor endpoints, not generic count |
| Temperature sense inputs | unsupported | Sensor endpoints, not operating temperature |
| Digital inputs | unsupported | Endpoint integration required |
| Display | structural separator | No fact when full-span |
| Display resolution | unsupported | Pixel grid is not physical body dimensions |
| Display max. backlight brightness | unsupported | Luminance semantic absent |
| Backlight dimming | unsupported | Control modes and timer context |
| Touch toggle on/off button | unsupported | Physical control/access semantics absent |
| Outer dimensions (h x w x d) | unresolved | Target exists; dual units and excluded accessories require context |
| Operating temperature range | unsupported | Generic environmental range absent |
| Mounting | unsupported | Alternative installation methods cannot become wall-mount evidence |
| Buzzer | unsupported | Explicit signalling capability absent |
| Protection category | unsupported | Conditional front/back IP ratings, not overcurrent protection |
| Safety | unsupported | Structured compliance evidence absent |
| EMC | unsupported | Structured compliance evidence absent |
| Automotive | unsupported | Structured compliance evidence absent |

No labels are evidence-only: inventing evidence aliases would hide these gaps.
The synthetic first table has 30 fact rows, 28 unsupported and two unresolved;
the supplied three category labels plus Dimensions, Other, Standards are separators.

## Permitted implementation and acceptance

Add only `Supply voltage` -> `electrical.input_voltage_range_v` for explicit
nonnegative ordered ranges with plain V/mV/kV units, and
`Outer dimensions (h x w x d)` -> `dimensions_mm` for positive ordered triples
with one explicit length unit. Shared trailing units or explicit source units are
allowed; conflicting units, missing units, lists, qualifiers, alternate triples,
and nonfinite values fail closed. AC/DC context remains unresolved. A dimensions
exclusion cannot be stripped to make a candidate. Raw values and units remain intact.

For safe generic examples, 8–70 V becomes `{min:8,max:70}` and 12 x 18 x 3 cm
becomes `{x:180,y:30,z:120}` mm. Both singleton proposals retain
`F group single_observation` provenance, model-only source claims, provisional facts,
pending review, and review-required promotion. Intake MPN alone never verifies identity.
The real-shape synthetic acceptance projects zero proposals and produces no candidate;
candidate identity/review/promotion statuses are consequently not applicable.
Non-projection reasons are `disposition: unsupported` (28) and
`disposition: unresolved` (2); no normalized values are asserted for those rows.

The next demonstrated gap is B: context-bearing generic canonical semantics
(domain-aware input supply and dimension scope, environmental ranges, state-dependent
consumption, conditional ingress and compliance). Their future owner is the component
library/schema with downstream engineering consumers. C also remains for endpoint,
connector and topology projection. Neither is expanded here. The current mapped
unqualified subset has no remaining blocker (G); no candidate or identity defect
is demonstrated, and acquisition success is not needed for this acceptance.

## Validation and handoff

Sequential validation passed: mapping/acceptance (73), normalization (108), semantic
bridge (12), candidate bridge (14), reconciliation (104), qualification (70), and
production workflow (12): 393 tests total. Ingestion TypeScript build, repository
lint, format check, and diff whitespace checks passed. The initial sandbox test
startup was blocked by esbuild filesystem access; the approved rerun passed.
One correction pass applied focused formatting and closed/tested a source-unit
AC/DC qualifier bypass. Final build, lint, formatting and mapping tests passed.
No live ingestion preparation was attempted, so no timeout result is asserted.

Five task files changed: this audit, `field-mapping.ts`, `normalize-fact.ts`,
`production-semantic-bridge.ts`, and `tests/field-mapping.test.ts`. The semantic rule
version is now v3 so proposal provenance identifies the new mapping behavior.
No temporary diagnostics were created. Protected untracked paths remain untouched.
Nothing was staged, committed, pushed, or switched. This bounded slice is ready for
review and a user-authorized commit; real Ekrano candidate preparation remains
blocked by the demonstrated semantic gaps.
