# SmartSolar constraint and topology amendment review

**Status: D-R and D-R2 applied; final validation handoff.**

The D-R topology and 75 V amendment is applied. The six approved D-R2
semantic operations are also applied through the canonical amendment
pipeline.

## Architecture decision

Electrical limits are modeled as optional, port-local `constraints` objects.
Each constraint has a stable component-local ID, explicit semantic kind,
quantity, unit, and either a fixed value, a range, or a referenced-port
relationship. This keeps absolute maximum voltage distinct from operating
ranges, startup thresholds, current limits, power limits, and relational
headroom. Missing constraints remain unknown.

The representation is not PV-specific. The same structure can apply to DC,
AC, shore, alternator, converter, inverter, and other logical interfaces.
System-level calculations such as cold-corrected string Voc remain outside
product facts.

## SmartSolar evidence audit

The persisted exact-SKU source is:

- Source ID: `victron.smartsolar-mppt-75-15.product-page`
- URI: `https://www.victronenergy.com/solar-charge-controllers/smartsolar-mppt-75-10-75-15-100-15-100-20`
- Content hash: `sha256:c4bbc6836d5139861ad30d73c448e831e86f9338feade96989c66e2e13242ed2`
- Applicability: direct identity, SKU `SCC075015060R`
- Locator: `__NEXT_DATA__`, `$.props.pageProps`, `$.products[0]`

The exact selected row supports:

- `maximum PV open-circuit voltage = 75V`;
- supported battery voltage values `12V` and `24V`;
- rated charge current `15A`;
- title `SmartSolar MPPT 75/15 Retail`.

The discovered family manual and datasheet links were not captured: the
recorded datasheet URI returned 404, and no additional captured primary
evidence is available in the persisted source artifact.

## Constraint proposal

Proposed future stable constraint ID:

```text
smartsolar.pv-input.max-pv-voc
```

Proposed target:

```text
port:smartsolar.pv-input
```

Proposed constraint:

```json
{
  "id": "smartsolar.pv-input.max-pv-voc",
  "kind": "absolute_maximum",
  "quantity": "voltage",
  "unit": "V",
  "value": 75
}
```

Evidence fact: `extracted.fact.f6fee013b4ada60d`.

This proposal is not applied because the current captured evidence establishes
the 75 V product limit but does not independently establish the logical PV
port, battery output port, or directional power path required to attach the
constraint to canonical topology.

## Topology proposal

No topology amendment is currently proposed for application. The product title
and category are not treated as sufficient proof of canonical port identities
or a conversion path.

If later primary evidence establishes the interfaces, the bounded amendment
can add stable logical IDs such as:

- `smartsolar.pv-input`
- `smartsolar.battery-output`
- `smartsolar.pv-to-battery-charge`

The amendment must use the existing `CanonicalTopologyAddOperation` path and
the original fact/source lineage.

## Unknown or unsupported semantics

- MPPT operating voltage range: unknown.
- Startup/minimum PV voltage: unknown.
- Battery-relative/headroom requirement: unknown; no `+5 V` heuristic is used.
- Maximum PV input current: unknown.
- Maximum PV short-circuit current: unknown.
- PV power limits: unknown.
- Conditional 12 V/24 V PV power limits: unknown.
- Temperature coefficients and array configuration: future system-design data,
  not product facts in this checkpoint.

## Human review decisions

|   # | Review area            | Proposed decision                                                                             | Evidence                                                                                                                                    | Caveat                                                                            | Recommended disposition     |
| --: | ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------- |
|   1 | Constraint target      | Attach `75 V` to `smartsolar.pv-input.max-pv-voc` as an `absolute_maximum` voltage constraint | `extracted.fact.f6fee013b4ada60d`, raw `75V`                                                                                                | Requires approval of the new canonical constraint destination and PV input target | NEEDS HUMAN DECISION        |
|   2 | PV logical port        | Add `smartsolar.pv-input` as a logical DC input                                               | Exact SKU product row identifies the SmartSolar controller but does not state the canonical port identity in the captured structured record | Do not infer solely from category                                                 | NEEDS MORE PRIMARY EVIDENCE |
|   3 | Battery logical port   | Add `smartsolar.battery-output` as a logical DC output                                        | Battery voltage support is present, but an explicit interface statement is not captured                                                     | Voltage support is not itself topology evidence                                   | NEEDS MORE PRIMARY EVIDENCE |
|   4 | Directional power path | Add `smartsolar.pv-to-battery-charge` from PV input to battery output                         | Product title/classification suggests charging function, but captured evidence does not establish the canonical path                        | Do not infer a path from category alone                                           | NEEDS MORE PRIMARY EVIDENCE |
|   5 | Operating range        | Add MPPT operating range                                                                      | No exact-SKU range captured                                                                                                                 | Must not be substituted with 75 V maximum                                         | NEEDS MORE EVIDENCE         |
|   6 | Startup/headroom       | Add fixed or relational minimum                                                               | No manufacturer-published relationship captured                                                                                             | No hidden `+5 V` rule                                                             | NEEDS MORE EVIDENCE         |

## Amendment status

- Amendment ID: `amendment.smartsolar.scc075015060r.constraint-topology`
- Existing canonical component: `victron-energy.scc075015060r`
- Status: not applied; pending evidence and human review.

## Checkpoint D-R primary-evidence completion

Checkpoint D-R captured the current official Victron sources linked from the
exact SmartSolar family product page. The D-R candidate and all newly captured
facts remain pending human review.

### 1. Branch / HEAD / Git status baseline

- Branch: `feat/product-corpus-sufficiency`
- HEAD: `d17abb48a151698e20258e248484bb62784db6d8`
- Existing PR: `BeardedBucket/expedition-electrical-platform#56`
- No staged, committed, pushed, or applied amendment changes.

### 2. Primary sources

| Source ID                                                 | Official URI                                                                                                                                                     | Type / version                                                        | Hash                                                                      | Applicability                                                                                | Capture method                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `victron.smartsolar-mppt-75-15.product-page`              | [Victron SmartSolar family page](https://www.victronenergy.com/solar-charge-controllers/smartsolar-mppt-75-10-75-15-100-15-100-20)                               | Manufacturer product page; embedded application state                 | `sha256:c4bbc6836d5139861ad30d73c448e831e86f9338feade96989c66e2e13242ed2` | Direct identity; `$.products[0]` is `SCC075015060R`                                          | Official HTML page; `__NEXT_DATA__` structured record         |
| `victron.smartsolar-mppt-75-15.manual-rev10`              | [MPPT solar charger manual](https://www.victronenergy.com/upload/documents/Manual_SmartSolar_MPPT_75-10_up_to_100-20/29694-MPPT_solar_charger_manual-pdf-en.pdf) | Manufacturer manual; Rev 10 - 02/2026                                 | `sha256:6fe199cd061441c30225f8ec9eff6dcb372cf5cb3215d9c7bab949b16f0125f9` | Explicitly reviewed; model tables include MPPT 75/15 and dimensions identify `SCC075015060R` | Official current product-page PDF link; downloaded and hashed |
| `victron.smartsolar-charge-controller-overview-datasheet` | [Charge controller overview datasheet](https://www.victronenergy.com/upload/documents/Datasheet-BlueSolar-and-SmartSolar-charge-controller-overview-EN.pdf)      | Manufacturer datasheet; revision/date not stated in captured PDF text | `sha256:d66b88e24c88c86b42fa0f2854b0afe2edb0b0364892e8cef7fbd3323f60b9c1` | Explicitly reviewed; SmartSolar 75/15 row is present and no sibling values are imported      | Official current product-page PDF link; downloaded and hashed |

### 3. Stale / 404 document resolution

The previously discovered manual URI
`/upload/documents/SmartSolar-MPPT-75-10-up-to-100-20-Manual.pdf` is stale
and returns 404. The previously discovered datasheet URI
`/upload/documents/SmartSolar-MPPT-75-10-up-to-100-20-Datasheet.pdf` is also
stale and returns 404.

The current official product page now links to the Rev 10 manual under the
`/upload/documents/Manual_SmartSolar_MPPT_75-10_up_to_100-20/` path and to the
current BlueSolar/SmartSolar overview datasheet. The stale records remain in
the ingestion artifact with `capture_status: stale_404` and `superseded_by`
links; they were not silently removed.

### 4. Source applicability proof

The Rev 10 manual explicitly lists the exact family table row:

```text
MPPT 75/15 | 75V | 15A | 12 and 24V
```

Its dimensions section explicitly identifies:

```text
SCC075015060R SmartSolar MPPT 75/15 Retail
```

The overview datasheet contains a SmartSolar 75/15 row with `15A` and
`12/24V`. Sibling rows for 75/10, 100/15, and 100/20 were not used to create
facts for `SCC075015060R`.

### 5. Source conflict check

No conflict was found. The product page and Rev 10 manual agree on:

- supported battery voltage: `12V` and `24V`;
- maximum battery/charge current: `15A`;
- maximum PV voltage / open-circuit voltage: `75V`.

The manual adds new, explicitly model-applicable facts. No source date or
version conflict requires guessing or supersession beyond the stale URL
correction documented above.

### 6. Newly extracted product facts

All facts below are provisional and require new D-R human review unless they
are explicitly identified as corroboration of a previously approved C2 fact.

|   # | Semantic meaning                              | Raw manufacturer wording/value                                                                                                        |                          Normalized value | Unit | Source ID                                    | Exact locator                                                        | Applicability                                                         | Semantic type                                   | Recommended disposition                             |
| --: | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------: | ---- | -------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
|   1 | PV input interface                            | “The DC (PV) input is not isolated from the battery circuit.”                                                                         |                      DC PV input evidence | —    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 11, §4 Installation, paragraph 1                                  | SmartSolar 75/15 family manual; exact MPN identified in manual        | Topology evidence                               | NEEDS HUMAN DECISION                                |
|   2 | Battery interface                             | “The battery and PV connections must be guarded against inadvertent contact.”                                                         |               Battery connection evidence | —    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 11, §4 Installation, paragraph 3                                  | SmartSolar 75/15 family manual                                        | Topology evidence                               | NEEDS HUMAN DECISION                                |
|   3 | Directional PV-to-battery function            | “The solar charger can charge a lower nominal-voltage battery from a higher nominal voltage PV array.”                                | PV array to battery charging relationship | —    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 4, §2.1, paragraph 1                                              | Explicit functional statement in family manual                        | Topology evidence                               | NEEDS HUMAN DECISION                                |
|   4 | Charge-flow direction                         | “The controller will automatically adjust to the battery voltage and will charge the battery with a current up to its rated current.” |          Controller output toward battery | —    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 4, §2.1, paragraph 1                                              | Explicit functional statement in family manual                        | Topology evidence                               | NEEDS HUMAN DECISION                                |
|   5 | Nominal PV-to-battery voltage relationship    | “The nominal PV voltage should be at least 5V higher than the battery voltage.”                                                       |                                         5 | V    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 11, §4.3 PV array, paragraph 2                                    | Explicit manufacturer statement; applies to the manual’s 75/15 family | Conditional operating/design relationship       | NEEDS HUMAN DECISION; not a startup threshold       |
|   6 | PV overvoltage recovery hysteresis            | “Charging resumes only when the PV voltage drops 5V below the rated maximum voltage.”                                                 |                                         5 | V    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 48, §8.5.6 PV voltage too high, paragraph 2                       | Explicit manufacturer statement; rated maximum is 75V for 75/15       | Recovery hysteresis                             | NEEDS HUMAN DECISION; not headroom or startup       |
|   7 | Nominal PV power at 12V                       | `Nominal PV power, 12V: 220W`                                                                                                         |                                       220 | W    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 62, §9.1, Technical specifications table, exact MPPT 75/15 column | Exact 75/15 column                                                    | Conditional nominal value                       | NEEDS HUMAN DECISION                                |
|   8 | Nominal PV power at 24V                       | `Nominal PV power, 24V: 440W`                                                                                                         |                                       440 | W    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 62, §9.1, Technical specifications table, exact MPPT 75/15 column | Exact 75/15 column                                                    | Conditional nominal value                       | NEEDS HUMAN DECISION                                |
|   9 | Maximum PV short-circuit current              | `Max. PV short circuit current: 15A`                                                                                                  |                                        15 | A    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 62, §9.1, Technical specifications table, exact MPPT 75/15 column | Exact 75/15 column                                                    | Absolute maximum / manufacturer-labeled maximum | NEEDS HUMAN DECISION                                |
|  10 | Battery voltage corroboration                 | `Battery voltage (auto select): 12V or 24V`                                                                                           |                                `[12, 24]` | V    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 62, §9.1, exact MPPT 75/15 column                                 | Exact 75/15 column                                                    | Existing approved supported-voltage fact        | CORROBORATES C2; no new canonical field             |
|  11 | Maximum PV open-circuit voltage corroboration | `Maximum PV open circuit voltage: 75V`                                                                                                |                                        75 | V    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 62, §9.1, exact MPPT 75/15 column                                 | Exact 75/15 column                                                    | Existing approved absolute maximum semantic     | CORROBORATES C2; new target still requires approval |
|  12 | Battery current corroboration                 | `Maximum battery current: 15A`                                                                                                        |                                        15 | A    | `victron.smartsolar-mppt-75-15.manual-rev10` | p. 62, §9.1, exact MPPT 75/15 column                                 | Exact 75/15 column                                                    | Existing approved charge-current fact           | CORROBORATES C2; no new PV-current field            |

### 7. PV voltage, startup, and headroom findings

| Meaning                       | Finding                                                                                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Absolute maximum PV Voc       | `75 V`, exact MPPT 75/15 table value; approved semantic interpretation remains `absolute_maximum`, voltage, `75 V`                                                                                                         |
| MPPT operating range          | UNKNOWN; not stated in the captured sources                                                                                                                                                                                |
| Startup threshold             | UNKNOWN; not stated in the captured sources                                                                                                                                                                                |
| Shutdown threshold            | UNKNOWN as a normal operating threshold; overvoltage recovery hysteresis is separately stated                                                                                                                              |
| Minimum PV voltage            | UNKNOWN as a generic minimum; the manual states a nominal PV voltage relationship but does not establish a startup or continued-operation minimum                                                                          |
| Battery-relative relationship | The manual explicitly states nominal PV voltage should be at least `5 V` higher than battery voltage. This is manufacturer evidence, not a generic heuristic, and must not be relabeled as startup/headroom without review |
| Overvoltage recovery          | Charging resumes when PV voltage drops `5 V` below the rated maximum after overvoltage; this is recovery hysteresis, not startup or MPPT range                                                                             |

### 8. PV current findings

The exact 75/15 table states `Max. PV short circuit current: 15A`. This is
distinct from the existing approved `15A` battery charge-current fact. No
separate maximum PV operating current was captured. Maximum PV input current
and maximum PV short-circuit current must remain separate semantics.

### 9. PV power findings

The exact 75/15 table states conditional nominal PV power:

- `220 W` at `12 V`;
- `440 W` at `24 V`.

These values remain conditional and nominal. They must not be flattened into
one unconditional maximum, and they must not be used as a replacement for a
maximum PV power or array-sizing evaluator.

### 10. Battery-side findings

The manual states supported battery voltage `12V or 24V`, a maximum battery
charge current of `15A`, battery connections, and charging from a higher
nominal PV array toward a lower nominal-voltage battery. These facts support a
proposed battery-side logical interface and directional charging relationship,
but the canonical objects remain pending this D-R review.

### 11. Topology evidence and proposed stable IDs

|   # | Stable ID                         | Exact supporting evidence                                                                              | Source locator                       | Applicability                                    | Proposed canonical meaning                                 | Recommended disposition |
| --: | --------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------- | ----------------------- |
|   1 | `smartsolar.pv-input`             | “The DC (PV) input is not isolated from the battery circuit.”                                          | Rev 10 manual, p. 11, §4             | Exact family manual includes 75/15 and exact MPN | Logical DC PV-side input                                   | APPROVE TOPOLOGY TARGET |
|   2 | `smartsolar.battery-output`       | “The battery and PV connections…” plus explicit battery charging behavior                              | Rev 10 manual, p. 11, §4; p. 4, §2.1 | Exact family manual includes 75/15 and exact MPN | Logical DC battery-side charging interface                 | APPROVE TOPOLOGY TARGET |
|   3 | `smartsolar.pv-to-battery-charge` | “The solar charger can charge a lower nominal-voltage battery from a higher nominal voltage PV array.” | Rev 10 manual, p. 4, §2.1            | Explicit functional relationship                 | Directional PV input to battery charging output power path | APPROVE TOPOLOGY TARGET |

No physical connector instances or pin-level models are proposed.

### 12. Constraint target review table

|   # | Constraint ID                                  | Port target           | Kind                                       | Quantity  | Unit | Value/range/reference                                                                                      | Evidence fact IDs                                                    | Source locators                                                                       | Recommended disposition                         |
| --: | ---------------------------------------------- | --------------------- | ------------------------------------------ | --------- | ---- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
|   1 | `smartsolar.pv-input.max-pv-voc`               | `smartsolar.pv-input` | `absolute_maximum`                         | `voltage` | `V`  | `75`                                                                                                       | `extracted.fact.f6fee013b4ada60d`, `extracted.fact.e60800807e1b1b5f` | Product page `__NEXT_DATA__` `$.products[0].max_pv_voltage`; Rev 10 manual p. 62 §9.1 | APPROVE CANONICAL TARGET                        |
|   2 | `smartsolar.pv-input.nominal-battery-headroom` | `smartsolar.pv-input` | `operating_range` or relational constraint | `voltage` | `V`  | Manufacturer states nominal PV voltage `>=` battery voltage `+5 V`; exact canonical form requires decision | `extracted.fact.46e26422cb2ad502`                                    | Rev 10 manual p. 11 §4.3                                                              | NEW REVIEW REQUIRED; do not apply automatically |
|   3 | `smartsolar.pv-input.overvoltage-recovery`     | `smartsolar.pv-input` | `shutdown_threshold` / recovery semantics  | `voltage` | `V`  | Resume at rated maximum minus `5 V`; exact generic kind requires decision                                  | `extracted.fact.89fdce21d19d1776`                                    | Rev 10 manual p. 48 §8.5.6                                                            | NEW REVIEW REQUIRED; do not apply automatically |

The existing `smartsolar.pv-input.max-pv-voc` target is the only constraint
that is fully semantically settled by Checkpoint D plus this evidence. The two
new 5 V facts are deliberately not converted into canonical constraints in
this handoff.

### 13. Pending canonical amendment

- **ID:** `amendment.smartsolar.scc075015060r.constraint-topology`
- **Target:** `victron-energy.scc075015060r`
- **Snapshot:** Checkpoint C2 reviewed candidate snapshot
  `sha256:0e3570593fbe4e2390a10069a1aba1d878eb2f89568eb1ec65730035f9d2eee1`
- **Operations:** add logical PV input `smartsolar.pv-input`; add logical battery
  output `smartsolar.battery-output`; add directional power path
  `smartsolar.pv-to-battery-charge`; attach reviewed `75 V`
  `absolute_maximum` voltage constraint
  `smartsolar.pv-input.max-pv-voc`.
- **Status:** Prepared but unapplied. The two newly captured 5 V facts and
  conditional power/current facts are not included in the amendment until
  separately approved.

### 14. New D-R human review decisions

#### Product facts

1. Approve the primary manual statement as evidence of a DC PV input for
   `SCC075015060R`.
2. Approve the primary manual statement as evidence of a battery-side
   connection/interface for `SCC075015060R`.
3. Approve the explicit manual statement describing charging a lower nominal
   battery from a higher nominal PV array as directional PV-to-battery
   functional evidence.
4. Approve the explicit charge-flow statement as evidence that charging energy
   is delivered toward the battery.
5. Approve the manufacturer-stated nominal PV voltage relationship of battery
   voltage plus `5 V` as a conditional operating/design fact, not as a
   startup threshold or generic heuristic.
6. Approve the manufacturer-stated `5 V` overvoltage recovery hysteresis as a
   distinct recovery fact, not as startup, shutdown, or headroom.
7. Approve `220 W` as nominal PV power conditional on `12 V` battery operation.
8. Approve `440 W` as nominal PV power conditional on `24 V` battery operation.
9. Approve `15 A` as maximum PV short-circuit current, distinct from battery
   charge current.
10. Confirm the manual `12V or 24V` table value as corroboration of the C2
    approved battery-voltage fact.
11. Confirm the manual `75V` table value as corroboration of the C2 approved
    maximum-PV-Voc fact.
12. Confirm the manual `15A` maximum-battery-current value as corroboration of
    the C2 approved continuous charge-current fact.

#### Topology

13. Approve `smartsolar.pv-input` as a logical DC PV input.
14. Approve `smartsolar.battery-output` as a logical DC battery-side charging
    interface.
15. Approve `smartsolar.pv-to-battery-charge` as a directional PV-to-battery
    charging power path.
16. Approve the use of the manual interface facts as topology evidence while
    keeping physical terminals and pin-level details out of the canonical
    model.

#### Constraint targets

17. Approve attaching the existing reviewed `75 V` fact to
    `smartsolar.pv-input.max-pv-voc` on `smartsolar.pv-input`.
18. Approve the `battery + 5 V` nominal PV relationship as a future reviewed
    relational constraint only if its exact generic representation is chosen.
19. Approve the `5 V` overvoltage recovery hysteresis as a future reviewed
    recovery constraint only if its exact generic representation is chosen.
20. Approve the conditional nominal PV power facts as future reviewed
    conditional product facts, preserving `12 V` and `24 V` applicability.
21. Approve the maximum PV short-circuit current as a future reviewed current
    constraint, distinct from charge current.
22. Keep MPPT operating range, startup threshold, normal shutdown threshold,
    and minimum PV voltage UNKNOWN.

### 15. Future PV sizing data sufficiency

Now available from the controller-side evidence:

- exact 75/15 maximum PV open-circuit voltage: `75 V`;
- nominal PV power at `12 V`: `220 W`;
- nominal PV power at `24 V`: `440 W`;
- maximum PV short-circuit current: `15 A`;
- nominal battery voltage support: `12 V` and `24 V`;
- nominal PV voltage relationship: battery voltage plus `5 V`;
- overvoltage recovery hysteresis: `5 V` below rated maximum;
- explicit temperature-coefficient warning and cold-climate Voc caveat.

Still unknown or not suitable for evaluator execution:

- module Voc;
- module Vmp;
- module temperature coefficient value;
- minimum design temperature;
- series count;
- parallel count;
- array wiring loss;
- controller startup threshold;
- MPPT operating range;
- normal shutdown threshold;
- complete operating-current envelope;
- installation-specific assumptions.

No PV sizing evaluator is implemented by D-R.

### 16. Protected architecture check

This completion introduces no SmartSolar-specific engineering logic. It
introduces no hidden `+5 V` heuristic: the nominal/design relationship is
stored as `nominal_design`, and recovery is stored as event-conditioned
`recovery_hysteresis`. It introduces no sibling-model leakage,
category-derived topology, fake review, verification inflation,
missing-as-zero behavior, voltage default, frontend, builder/commercial logic,
temperature assumption, or PV sizing engine.

## Checkpoint D-R2 — Generic PV semantic completion

### 1. Generic semantic audit

The existing port-local constraint object already separates quantity, units,
fixed values, ranges, port references, conditions, and absolute/operating,
startup, shutdown, recommended, and relational meanings. It did not
faithfully represent four reviewed meanings:

| Reviewed concept | Existing representation | Gap | Correct generic owner |
| --- | --- | --- | --- |
| Nominal/design PV voltage relationship | `relational_headroom` plus a port reference | It can imply a hard headroom rule and does not preserve nominal/design wording | `kind: nominal_design` with the existing relational reference |
| Overvoltage recovery hysteresis | `shutdown_threshold` or a fixed value | Neither preserves event-conditioned recovery or the relationship to the rated maximum | `kind: recovery_hysteresis` with a bounded recovery reference |
| Conditional nominal PV power | `power` plus conditions | Existing kinds have no nominal semantic; `absolute_maximum` would incorrectly create a hard limit | `kind: nominal` plus conditions |
| PV short-circuit current | Current quantity and `absolute_maximum` | Quantity and limit alone lose the short-circuit measurement basis | Existing limit kind plus `basis: short_circuit` |

### 2. Orthogonality decision

The model now keeps these dimensions separate:

- `kind`: limit or product semantic;
- `quantity` and `unit`: voltage, current, or power;
- `basis`: optional electrical measurement basis (`open_circuit`,
  `short_circuit`, or `operating`);
- `conditions`: applicability such as battery voltage;
- `reference`: relational value against another port;
- `recovery`: bounded event-conditioned offset from an existing constraint.

The recovery object is intentionally limited to an existing constraint, an
`overvoltage` event, a comparison relation, and an offset. It is not a general
state-machine or workflow language.

### 3. Generic architecture changes

`data/schemas/component.schema.json` now supports:

- `kind: nominal_design`;
- `kind: nominal`;
- `kind: recovery_hysteresis`;
- optional `basis: open_circuit | short_circuit | operating`;
- optional `recovery.constraint_id`;
- optional `recovery.event`;
- optional `recovery.relation`;
- optional `recovery.offset`.

Existing D-R canonical topology was not changed. The existing 75 V constraint
was enriched in place with `basis: open_circuit`; it was not duplicated.

### 4. Test-first evidence

The new focused tests were first run against the schema before the recovery
form was admitted. The recovery and amendment semantic cases failed because
`recovery` was not yet one of the permitted value forms. After adding the
bounded `recovery` form, the focused semantic suite passed:

```text
packages/ingestion/tests/electrical-constraints.test.ts
packages/ingestion/tests/canonical-amendment.test.ts
60 tests passed
```

The tests cover nominal/design relations, recovery offsets, conditional
nominal power, short-circuit current basis, unknown dimensions, and
deterministic amendment preservation.

### 5. Applied canonical representations

#### Nominal/design relationship

```json
{
  "id": "smartsolar.pv-input.nominal-pv-battery-voltage",
  "kind": "nominal_design",
  "quantity": "voltage",
  "unit": "V",
  "reference": {
    "port_id": "smartsolar.battery-output",
    "relation": "greater_than_or_equal",
    "offset": 5
  }
}
```

This preserves the manufacturer's nominal/design relationship and does not
mean startup voltage, minimum operating voltage, shutdown voltage, or a
universal MPPT rule.

#### Recovery hysteresis

```json
{
  "id": "smartsolar.pv-input.overvoltage-recovery",
  "kind": "recovery_hysteresis",
  "quantity": "voltage",
  "unit": "V",
  "recovery": {
    "constraint_id": "smartsolar.pv-input.max-pv-voc",
    "event": "overvoltage",
    "relation": "less_than_or_equal",
    "offset": -5
  }
}
```

This stores the source relationship rated maximum minus 5 V. It does not
publish 70 V as an independent limit and does not mean normal shutdown,
startup, or MPPT operating maximum.

#### Conditional nominal power

```json
{
  "id": "smartsolar.pv-input.nominal-pv-power-12v",
  "kind": "nominal",
  "quantity": "power",
  "unit": "W",
  "value": 220,
  "conditions": [
    { "path": "electrical.nominal_voltage_v", "equals": 12 }
  ]
}
```

```json
{
  "id": "smartsolar.pv-input.nominal-pv-power-24v",
  "kind": "nominal",
  "quantity": "power",
  "unit": "W",
  "value": 440,
  "conditions": [
    { "path": "electrical.nominal_voltage_v", "equals": 24 }
  ]
}
```

These remain distinct conditional nominal values and are not unconditional
maximum PV-power limits.

#### Maximum PV short-circuit current

```json
{
  "id": "smartsolar.pv-input.max-pv-isc",
  "kind": "absolute_maximum",
  "quantity": "current",
  "unit": "A",
  "basis": "short_circuit",
  "value": 15
}
```

The basis distinguishes PV short-circuit current from battery charge current,
continuous operating current, conductor ampacity, and fuse rating.

### 6. Stable IDs and provenance targeting

Proposed stable IDs:

```text
smartsolar.pv-input.nominal-pv-battery-voltage
smartsolar.pv-input.overvoltage-recovery
smartsolar.pv-input.nominal-pv-power-12v
smartsolar.pv-input.nominal-pv-power-24v
smartsolar.pv-input.max-pv-isc
```

Each object is targeted by its complete stable constraint ID under
`port:smartsolar.pv-input`. Source facts and locators are:

| ID | Source fact | Source locator |
| --- | --- | --- |
| `smartsolar.pv-input.nominal-pv-battery-voltage` | `extracted.fact.46e26422cb2ad502` | Rev 10 manual, p. 11, §4.3 PV array, paragraph 2 |
| `smartsolar.pv-input.overvoltage-recovery` | `extracted.fact.89fdce21d19d1776` | Rev 10 manual, p. 48, §8.5.6 PV voltage too high, paragraph 2 |
| `smartsolar.pv-input.nominal-pv-power-12v` | `extracted.fact.867bebba68349009` | Rev 10 manual, p. 62, §9.1, exact MPPT 75/15 column |
| `smartsolar.pv-input.nominal-pv-power-24v` | `extracted.fact.cb138b497cf13404` | Rev 10 manual, p. 62, §9.1, exact MPPT 75/15 column |
| `smartsolar.pv-input.max-pv-isc` | `extracted.fact.f2dc7ad1a395ead2` | Rev 10 manual, p. 62, §9.1, exact MPPT 75/15 column |

### 7. HUMAN REVIEW TABLE — NEW CANONICAL MAPPINGS (APPLIED)

The manufacturer facts in this table were already approved. These are new
canonical semantic mappings only.

| # | Reviewed source fact | Proposed canonical target | Proposed generic representation | Preserved wording | Explicitly does not mean | Recommended disposition |
|---:|---|---|---|---|---|---|
| 1 | `extracted.fact.46e26422cb2ad502` | `smartsolar.pv-input.nominal-pv-battery-voltage` | `kind: nominal_design`, reference to `smartsolar.battery-output`, `>=`, offset `5 V` | Nominal PV voltage should be at least battery voltage plus 5 V | Not startup, MPPT minimum, shutdown, universal heuristic, or hard absolute minimum | REVIEW NEW CANONICAL MAPPING |
| 2 | `extracted.fact.89fdce21d19d1776` | `smartsolar.pv-input.overvoltage-recovery` | `kind: recovery_hysteresis`, reference to `smartsolar.pv-input.max-pv-voc`, event `overvoltage`, offset `-5 V` | Charging resumes 5 V below the rated maximum after overvoltage | Not a separately published 70 V limit, operating maximum, startup threshold, or normal shutdown threshold | REVIEW NEW CANONICAL MAPPING |
| 3 | `extracted.fact.867bebba68349009` | `smartsolar.pv-input.nominal-pv-power-12v` | `kind: nominal`, power `220 W`, condition battery voltage `12 V` | Nominal PV power at 12 V battery operation | Not unconditional, not an absolute maximum, and not a sizing result | REVIEW NEW CANONICAL MAPPING |
| 4 | `extracted.fact.cb138b497cf13404` | `smartsolar.pv-input.nominal-pv-power-24v` | `kind: nominal`, power `440 W`, condition battery voltage `24 V` | Nominal PV power at 24 V battery operation | Not unconditional, not an absolute maximum, and not a sizing result | REVIEW NEW CANONICAL MAPPING |
| 5 | `extracted.fact.f2dc7ad1a395ead2` | `smartsolar.pv-input.max-pv-isc` | `kind: absolute_maximum`, current `15 A`, `basis: short_circuit` | Maximum PV short-circuit current | Not battery charge current, operating current, ampacity, or fuse rating | REVIEW NEW CANONICAL MAPPING |
| 6 | `extracted.fact.f6fee013b4ada60d` and `extracted.fact.e60800807e1b1b5f` | `smartsolar.pv-input.max-pv-voc` | Existing `absolute_maximum` voltage `75 V`, proposed enrichment `basis: open_circuit` | Maximum PV open-circuit voltage | Not MPPT range, startup threshold, or normal operating maximum | REVIEW BASIS ENRICHMENT |

### 8. Applied D-R2 amendment

Target:

```text
victron-energy.scc075015060r
```

Snapshot:

```text
sha256:da5ee9308657cdc7848fa1b6801827b4ba82d6baa10e99200fe9d20d9db35559
```

Operations proposed after mapping approval:

- add `smartsolar.pv-input.nominal-pv-battery-voltage`;
- add `smartsolar.pv-input.overvoltage-recovery`;
- add `smartsolar.pv-input.nominal-pv-power-12v`;
- add `smartsolar.pv-input.nominal-pv-power-24v`;
- add `smartsolar.pv-input.max-pv-isc`;
- enrich `smartsolar.pv-input.max-pv-voc` with `basis: open_circuit`.

Status:

```text
written
```

The accepted D-R topology remains applied. The D-R2 amendment added the five
new semantic constraints and enriched the existing 75 V constraint in place.
The resulting canonical snapshot is:

```text
sha256:1ad06a27dadc90157bec0e9b685486187d4539c34401deb55927c4b99905550
```

### 9. Future PV evaluator data contract

The future whole-system evaluator may consume, when available:

- controller absolute maximum PV Voc and open-circuit basis;
- nominal/design PV-to-battery voltage relationship;
- MPPT operating range;
- startup and recovery behavior;
- maximum PV short-circuit current;
- conditional nominal, recommended, and maximum PV power;
- supported battery voltage;
- module/array Voc, Vmp, Isc, Imp, temperature coefficients, series/parallel
  configuration, and explicit design temperatures.

No PV sizing evaluator, cold-Voc correction, hot-Vmp calculation,
series/parallel solver, controller selector, weather model, or design-margin
logic is implemented here.
