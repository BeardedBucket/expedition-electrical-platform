# Unit provenance and presentation

The ingestion model deliberately separates three meanings of a measurement:

- **Source** is the value and unit published by the source. `ProductFact.raw_value`
  and `ProductFact.raw_unit` remain authoritative evidence.
- **Normalized** is the deterministic engineering representation used by
  canonical fields and calculations. Existing fields such as `weight_kg` and
  `dimensions_mm` retain their names and semantics.
- **Derived display** is a presentation-only conversion for human convenience.
  It is marked `basis: "derived_display"` and is never evidence.

`SourceAwareMeasurement` is computed from a `ProductFact` and normalized input;
it is not persisted and does not replace `ProductFact`. Display preferences do
not mutate facts, canonical components, source references, amendment history,
or canonical snapshots.

## Supported conversion families

The unit registry supports explicit conversion families with unambiguous canonical
identifiers, deterministic relationships, and dimensional integrity:

### Linear scale conversions

- **Length** (canonical: `mm`):
  - Metric: `mm` (1), `cm` (10), `m` (1000)
  - Imperial: `in` (25.4 mm), `ft` (304.8 mm)
- **Mass** (canonical: `kg`):
  - Metric: `kg` (1), `g` (0.001)
  - Imperial: `lb` (0.45359237 kg), `oz` / `oz_mass` (0.45359237 / 16 kg)
- **Volume** (canonical: `L`):
  - Metric: `L` (1), `mL` (0.001)
  - US Liquid Customary: `gal_us` / `US gal` (3.785411784 L = 231 in³), `qt_us` / `US qt` (1/4 gal), `pt_us` / `US pt` (1/8 gal), `cup_us` / `US cup` (1/16 gal), `fl_oz_us` / `US fl oz` (1/128 gal). Bare ambiguous terms (such as `gal`, `gallon`, `pint`, `quart`, `cup`, `fluid ounce`) are strictly rejected without explicit US qualification.
- **Pressure** (canonical: `kPa`):
  - Metric / SI: `kPa` (1), `Pa` (0.001), `bar` (100 kPa)
  - Imperial: `psi` (6.894757293168361 kPa)
- **Torque** (canonical: `N·m`):
  - Metric / SI: `N·m` (1)
  - Imperial: `lb·ft` (1.3558179483314004 N·m), `lb·in` (1.3558179483314004 / 12 N·m)
- **Flow** (canonical: `L/min`):
  - Metric: `L/min` (1), `L/h` (1/60 L/min)
  - US Customary: `gal_us_per_min` / `US gal/min` / `US gpm` (3.785411784 L/min), `gal_us_per_h` / `US gal/h` / `US gph` (3.785411784 / 60 L/min). Bare ambiguous flow terms (such as `gal/min`, `gpm`, `gal/h`, `gph`) are strictly rejected without explicit US qualification.
- **Electrical SI** (canonical: SI base):
  - `voltage`: `V`, `mV`, `kV`
  - `current`: `A`, `mA`, `kA`
  - `power`: `W`, `mW`, `kW`
  - `apparent_power`: `VA`, `kVA`
  - `energy`: `Wh`, `kWh`
  - `capacity`: `Ah`, `mAh`
  - `resistance`: `ohm` (`Ω`), `mohm`, `kohm`
  - `frequency`: `Hz`, `kHz`

### Affine conversions

- **Temperature** (canonical: `°C`):
  - Celsius: `°C` ($T_C = T_C$)
  - Fahrenheit: `°F` ($T_C = (T_F - 32) \times \frac{5}{9}$, $T_F = T_C \times \frac{9}{5} + 32$)
  - Kelvin: `K` ($T_C = T_K - 273.15$, $T_K = T_C + 273.15$)
  - Temperature uses explicit pure affine transformations (`toCanonical` / `fromCanonical`) rather than linear scale multipliers.

### Discrete conductor sizing systems (AWG)

- **Conductor size** (canonical: `mm²` cross-sectional area):
  - `mm²`: Standard metric cross-sectional area.
  - `AWG`: American Wire Gauge discrete conductor designations (`4/0`, `3/0`, `2/0`, `1/0`, `1` through `40`).
  - Standard ASTM B258 geometric progression:
    $$d_n = 0.127 \times 92^{\frac{36 - n}{39}}\text{ mm}, \quad A_n = \frac{\pi}{4} d_n^2\text{ mm}^2$$
    where $n = -3$ for 4/0, $-2$ for 3/0, $-1$ for 2/0, $0$ for 1/0, and $1..40$ for standard integer gauges.

#### Why AWG is not a simple metric/imperial toggle

- AWG is a discrete standardized sizing designation, not a continuous linear length or diameter unit.
- Conductor sizing normalizes to cross-sectional area in `mm²`, preserving the source AWG designation.
- In presentation, source AWG is never replaced by `mm²`; instead, derived `mm²` is shown as an optional companion.
- Ampacity is **never** inferred from AWG alone — ampacity remains installation-, insulation-, and standard-dependent.

## Ambiguous unit handling

Internal canonical identifiers avoid collisions between different physical dimensions and ambiguous regional systems:

- Mass ounce (`oz_mass` / `oz`) has dimension `mass`.
- Fluid ounce (`fl_oz_us` / `US fl oz`) has dimension `volume`. Bare ambiguous `fl oz` or `fluid ounce` without `US` qualification is rejected.
- Gallon and liquid volume: bare `gal`, `gallon`, `cup`, `pint`, `quart` are rejected to prevent assuming US customary over Imperial/metric volume without explicit evidence (`US gal`, `US cup`, `US pint`, `US quart`, `gal_us`).
- Gallon-based flow: bare `gal/min`, `gpm`, `gal/h`, `gph` are rejected without explicit US identification (`US gal/min`, `US gpm`, `US gal/h`, `US gph`, `gal_us_per_min`).
- Wire size: bare `gauge` or `10 gauge` is rejected; explicit `AWG` or `American Wire Gauge` is required.
- Generic `mm² -> AWG` continuous conversion via `convertUnit` is disallowed; discrete nearest AWG derivation uses the explicit `areaMm2ToNearestAwg()` API.
- Cross-dimensional conversions (e.g. `US fl oz` to `oz` or `kg`) are strictly rejected with dimension mismatch errors.
- Pound force torque (`lb·ft`, `lb·in`) and pressure (`psi`) are strictly separate from mass pounds (`lb`).

## Display modes and precision

`presentMeasurement` accepts an explicit `source`, `metric`, or `imperial` preference:

- **Source mode**: Shows source measurement as primary; provides a derived companion in the alternate regional system if applicable.
- **Metric / Imperial modes**: Primary shows the preferred regional unit; secondary shows the source measurement.
- **Conductor size (AWG)**: Primary preserves the source AWG designation, while derived `mm²` appears as a companion.
- **Electrical SI dimensions**: Remain source-only across all modes (no artificial regional conversions).

Engineering values retain full deterministic double-precision calculation accuracy.
Derived display values are rounded to significant digits (`roundSignificant`, defaulting to 3 significant figures) on presentation copies only.
Source values and normalized canonical facts are never mutated or rounded.

## Unit extraction, contradiction checks, and alias equivalence

`parseExactUnitValue` enforces strict validation when parsing raw values and units:

- **Matching units**: When `raw_value` contains an embedded unit string (e.g. `"29 lb"`) and `raw_unit` is also provided (e.g. `"lb"`), both must resolve to the identical `UnitDefinition` identity.
- **Contradiction rejection**: If the embedded unit and `raw_unit` resolve to different unit identities (e.g. `"29 lb"` with `raw_unit: "kg"`, `"5 US gal"` with `raw_unit: "L"`, `"32 °F"` with `raw_unit: "°C"`, or `"10 AWG"` with `raw_unit: "kg"`), the value is rejected as unresolved (`undefined`).
- **Alias equivalence**: Different textual aliases that resolve to the same canonical unit identity (e.g. `"5 US gal"` with `raw_unit: "gal_us"`, or `"10 AWG"` with `raw_unit: "American Wire Gauge"`) are recognized as equivalent and accepted.
- **Ambiguous embedded terms**: An un-prefixed ambiguous token (e.g. `"5 gal"`) is accepted only when `raw_unit` explicitly supplies the fully-qualified unit (`"US gal"`), safely disambiguating the numeric value; if paired with an incompatible unit (e.g. `"kg"`), it is rejected.
