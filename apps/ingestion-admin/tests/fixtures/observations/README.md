# Portable human-adjudication observation contracts

Normal CI uses the three small `v1/*.json` files beside this document, resolved from `import.meta.url`. They are independently project-authored, invented observations (CC BY-SA 4.0 per the repository data policy), not excerpts, manufacturer evidence, extractor output or an answer oracle. Their fictional identities are Review Monitor R1, SC-11/SC-12 and Review Inverter IC-21. The page number is a synthetic locator in a controlled test envelope; no real PDF layout is asserted. The exact byte SHA-256 values are pinned in `../observation-fixtures.ts`. Preserve bytes on every platform; JSON has LF line endings and no generation step. A deliberate content change requires review of the fixture version and pin together.

The mandatory observation cases exercise the same seven contracts as the earlier genuine cases: qualified supply range; backend eligibility/candidate reconstruction/durable restart; refusal to turn measurement accuracy into current magnitude; three refusals of invented quotes; and refusal to infer a model column from shared flattened text. An additional mandatory case preserves explicitly stated duration/temperature on time-limited current. Existing broader adjudication tests still cover applicability, source-context qualification, stale requests, append-only replay and authority separation. All are executed normally; none of the seven lost CI cases is silently skipped. The small loader tests verify exact project bytes, tamper refusal and missing explicit genuine prerequisites. The demo's self-contained tests verify byte-identity refusal and filename confinement without private artifacts.

## Explicit genuine-source integration gate

The original observation files exist in the private development benchmark and matched these identities at the portability repair. They contain complete third-party extracted page text/layout data. No compatible redistribution grant is recorded. Under `docs/LICENSE_POLICY.md`, public download/access is insufficient permission to vendor them. The originals were neither edited nor relocated, and no PDF, page render, original capture, preparation or oracle was copied into Git. Source metadata below identifies them without distributing their contents.

| Required relative file                                  | Observation SHA-256                                                | Source / PDF SHA-256                                                                                                                                                                                  | Retrieved at               |
| ------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `outputs/pdfplumber-text/victron-bmv-712.json`          | `b09ef2001d990e09edea6d2f4655c09870b2c6f98be9cdcb951f88a7339adcde` | [Victron Energy BMV-712 Smart datasheet](https://www.victronenergy.com/upload/documents/Datasheet-BMV-712-Smart-EN.pdf), `571accecb558bf454f11981ba6fc2e5cc138b9dbebe1c0e121f1a0d3b942de98`           | `2026-10-05T22:55:39.079Z` |
| `outputs/pdfplumber-text/morningstar-sunsaver-10l.json` | `0a4060d282abcba7bc988b5bb438215d8164916ef4f3117692f7d57b535b7b70` | [Morningstar SunSaver datasheet](https://www.morningstarcorp.com/wp-content/uploads/datasheet-sunsaver-en.pdf), `23b826c9274b1b7d737de7bbbe3f0cbe92997f2bfedc131ebdfc25917ed243e1`                    | `2026-10-05T22:55:05.334Z` |
| `outputs/pdfplumber-text/samlex-evo-2212.json`          | `c438b4815d3dcc982cee83ea09de98ad161a5c40e4d835b1fd5fd4844a55fda3` | [Samlex America EVO specifications](https://samlexamerica.com/wp-content/uploads/2021/11/Samlex-EVO-Features-Spec-Sheet-1121.pdf), `71e314a57ad30e32cecb8a0926b9c5893837587ec1f1cb7ce1ef3dee2d87f02b` | `2026-10-05T22:54:54.802Z` |

All three are pdfplumber `0.11.10`, page 2. The whole observation checksum preserves original model/part associations and unresolved relationships; no column ownership is added. PDF hashes identify the original source but are metadata here: the integration gate does not reopen or hash PDFs. Embedded absolute PDF/capture/baseline paths are never followed.

Acquire the **exact authorized original bytes**, rather than rerunning extraction or regenerating observations from expected answers. Put them in a private directory named `expedition-document-extraction-benchmark` with the relative structure above. Also supply `artifact-manifest.json`, the original identity inventory containing entries with the relative suffixes above and the matching `sha256` values; its other path metadata is never followed. The root may live anywhere authorized; there is no operating-system TEMP fallback. Build packages normally first. Then explicitly run:

```powershell
$env:EXPEDITION_GENUINE_OBSERVATIONS_DIRECTORY = '<authorized absolute artifact root>'
npm.cmd run test:genuine-observations
```

```sh
EXPEDITION_GENUINE_OBSERVATIONS_DIRECTORY=/authorized/artifact-root/expedition-document-extraction-benchmark npm run test:genuine-observations
```

The dedicated Vitest configuration requires the directory variable, enables `EXPEDITION_RUN_GENUINE_OBSERVATIONS=1`, and selects only the genuine suites: seven real-backend observation contracts plus the two authentic demo loader checks. Missing files, wrong hashes, bad metadata or escapes fail the gate. No empty or silently skipped genuine gate is permitted. The regular tests do not opt in just because private files happen to exist. Vitest may report other collected tests as unselected; they are not counted as genuine passes.

Restoring these nine genuine checks to routine CI requires a lawful, reproducible artifact distribution mechanism (documented compatible redistribution permission or an appropriately access-controlled authorized input). That mechanism is not implemented by this repair. Until then, CI establishes the shared contracts on labeled invented data; the explicit genuine gate establishes those contracts against the retained observations, not original PDF extraction accuracy, publisher authentication, canonical approval or beta/V1 corpus completeness.
