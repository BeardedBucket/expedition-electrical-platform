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

## Supported conversions

The explicit registry supports the existing engineering units plus these
region-neutral length and mass units:

- Length: `mm`, `cm`, `m`, `in`, `ft`
- Mass: `g`, `kg`, `oz`, `lb`

Conversions use exact defined relationships: `1 in = 25.4 mm`,
`1 ft = 304.8 mm`, `1 lb = 0.45359237 kg`, and `1 oz = 1/16 lb`.
Incompatible or unknown units are rejected; unit strings are never guessed.

Temperature is intentionally deferred. The current registry is linear and
`°C`/`°F` requires affine conversion. Adding it without a general affine
abstraction would distort the conversion contract.

## Display modes and precision

`presentMeasurement` accepts an explicit `source`, `metric`, or `imperial`
preference. It always returns the source and normalized measurements
independently of the selected primary presentation. If the source is already
in the preferred system, no redundant identical companion is created.

Regional preferences apply only to length and mass. Electrical and other
non-regional dimensions remain source-only in all three modes; the
presentation API does not invent regional alternatives for volts, amps, watts,
volt-amperes, watt-hours, ampere-hours, resistance, or frequency.

Engineering values retain full deterministic conversion precision. Derived
display values are rounded to three significant digits on a copy only. This
avoids false precision without changing the source value or normalized value.

For example:

```text
Manufacturer:          29 lb
Engineering normalized: 13.15417873 kg
Presentation:           29 lb (13.2 kg)
```

```text
Manufacturer:          506 mm
Engineering normalized: 506 mm
Imperial companion:     19.9 in
```

The converted values in these examples are not manufacturer-published facts.
The design is region-neutral: a vehicle payload may be published in pounds or
kilograms, drawings may use inches or millimeters, and engineering can still
use one deterministic internal unit.
