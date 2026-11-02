# BMW DDE D83BX7C0 — DPF diagnostic mapping (unverified on-car)

Source: owner-supplied `D83BX7C0.prg`, identified in ISTA on a 2021 BMW G21 318d B47. The compiled EDIABAS object was decoded offline (XOR 0xF7, payload starting at 0xA0). The `SG_FUNKTIONEN` table contains 4,871 data and function rows with named IDs, result types and scaling.

**Offline verification (2026-11-02):** All eight entries in `dpf-dids.js` were matched programmatically against the uploaded binary's `SG_FUNKTIONEN` table: DID, service 0x22, datatype/byte count, MUL, DIV, ADD and units (including meters-to-kilometers conversion). The PRG's `L/H` column is `High` for all eight. Unit tests use synthetic big-endian UDS replies; the headunit/vehicle replies remain unverified.

**Scope:** The rows below are confirmed as contents of the provided file, **not yet verified as supported live values on the actual DDE**. The PRG itself is proprietary and is **not** included in this repository.

| Signal | PRG argument | DID | Data type | PRG scaling | Unit |
| --- | --- | --- | --- | --- | --- |
| Soot mass | `IMRUP` | `44BE` | unsigned int (2 B) | raw × 0.01525902 | g |
| Oil ash mass | `IMASOEL` | `44BD` | unsigned int (2 B) | raw × 0.01525902 | g |
| Simulated soot mass | `IMPAS` | `44C1` | unsigned int (2 B) | raw × 0.01 | g |
| Measured soot mass (alternate) | `PFlt_mSotMeasNoCompl_mp` | `44AC` | unsigned int (2 B) | raw × 0.1 | g |
| DPF differential pressure | `Exh_pPFltDiff` | `44ED` | unsigned int (2 B) | raw × 0.04577707 − 1000 | hPa = mbar |
| Filtered differential pressure | `Exh_pFltPPFltDiff` | `44FA` | unsigned int (2 B) | raw × 0.04577707 − 1000 | hPa = mbar |
| DPF upstream temperature | `Exh_tSensTPFltUs` | `4502` | unsigned int (2 B) | raw × 0.03128099 − 50 | °C |
| Corrected DPF upstream temperature | `ITAVP1` | `44EF` | unsigned int (2 B) | raw × 0.03128099 − 50 | °C |
| Distance since last successful regeneration | `IDSLRE` | `44BF` | unsigned long (4 B) | raw / 1000 | km (PRG: m) |
| Time since last successful regeneration | `PFltRgn_tiSnceRgn` | `44B7` | unsigned long (4 B) | raw | s |
| Number of successful regenerations | `PFltRgn_ctRgnSucEEP_mp` | `44B8` | unsigned int (2 B) | raw | count |
| Average regeneration interval | `IKMZWREG` | `44C7` | unsigned int (2 B) | raw | km |
| Regeneration request raw value | `PFltRgn_numRgn` | `44BB` | unsigned char (1 B) | raw | unknown semantics |
| Regeneration inhibition raw value | `ISRBF` | `44C2` | unsigned char (1 B) | raw | unknown semantics |
| Operating mode/status word | `CoEOM_stOpModeAct` | `467E` | unsigned long (4 B) | raw hex | bit mapping pending |

All listed DID rows state `SERVICE: 22;2C` in the PRG. The app only uses service **0x22**, not 0x2C.

## Active-regeneration diagnosis

The separate PRG job `STATUS_REGENERATION_CSF` is explicitly described as "Auslesen der Regenerationsbedingungen für Diesel-CSF". Its output metadata says:

- `STAT_REGENERATION_ANGEFORDERT_WERT`: 0 not requested, 1 requested.
- `STAT_REGENERATION_LAEUFT_WERT`: 0 not currently regenerating, 1 currently regenerating.
- `STAT_REGENERATION_GESPERRT_WERT`: 0 not inhibited, 1 inhibited.

This job uses UDS service `0x2C` (DynamicallyDefineDataIdentifier) before reading the defined block, rather than exposing the three Booleans as proven standalone DIDs. **Do not infer "regeneration active" from DID 44BB.** On-car raw messages and/or validated decoding of `CoEOM_stOpModeAct` are needed first.

## Next validation session (car stationary)

1. Open Tool32 with exactly `D83BX7C0.prg`, with ignition on and stable supply.
2. Try read-only `STATUS_LESEN` with argument `ARG;IMRUP`. Compare to ISTA soot mass. Repeat for `ARG;IMASOEL`, `ARG;Exh_pPFltDiff`, `ARG;Exh_tSensTPFltUs`, `ARG;IDSLRE`.
3. Capture the displayed output and any raw `_REQUEST`/`_RESPONSE` bytes. As a UDS example, `22 44 BE` requests soot mass; an accepted reply should start with `62 44 BE`, followed by the value bytes.
4. Optionally run the **read-status** Tool32 job `STATUS_REGENERATION_CSF` and record its `_REQUEST_1`/`_RESPONSE_1` etc. It temporarily defines a diagnostic block; do not run jobs with `STEUERN`, `ABGLEICH`, `RESET` or `PROGRAMMIEREN`.
5. With the vehicle stationary, enable the app's experimental setting. Compare each returned reading to ISTA / Tool32 and inspect the app's on-headunit log. If responses fail, turn it Off.
6. Only after successful comparisons: mark individual fields validated, determine the active-regeneration bit(s), and implement real event history (no invented events).

No modifications to DDE settings or programming data are part of the DPF app.
