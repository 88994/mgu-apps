# DPF Monitor 0.2.1 — BMW G21 B47 / D83BX7C0

Read-only iDrive 7 DPF monitor built with the `cauliflowermossgrape/idrive7-apps` kit and installable through MGU Store.

## Verification and localization in 0.2.1

The eight configured DIDs were rechecked against the uploaded original `D83BX7C0.prg`: IDs, result types, raw byte counts, scaling and UDS `0x22` availability all match the `SG_FUNKTIONEN` table. UI text, statuses, demo labels and number formatting are now in English (decimal point).

Offline regression test (no car, no SDK):

```powershell
node tests/dpf-monitor-dids.test.js
```

**Remaining uncertainty:** The `L/H` column of these PRG rows reads `High`, and the kit assumes network-order response bytes. Actual responses, routing and regeneration-state bits still require a vehicle test.

## What changed in 0.2.0

The owner-supplied `D83BX7C0.prg` (BMW DDE / B47) was inspected offline. Its `SG_FUNKTIONEN` table gives UDS service `0x22` DIDs, result types and scaling for soot mass, ash mass, exhaust differential pressure, DPF temperature, distance since last successful regeneration, successful regeneration count and average regeneration interval.

The app contains those exact DID configurations in `dpf-dids.js` and attempts read-only reads through `kit/diag.js` + `kit/dids.js` **only when explicitly enabled**.

**Important:** No response has yet been verified against this particular vehicle. The app is experimental. All DPF live readings are `--` by default.

## Settings and behavior

- **DDE live diagnostics (experimental): Off** is the safe default. Switch to On for a supervised stationary-car read test after making a backup of existing diagnostic logs.
- While On, the app sends only UDS `0x22` `ReadDataByIdentifier` requests to candidate engine ECU address `0x12`. Reads are sequential; the polling sequence runs only while the main app screen is visible. No diagnostic requests are issued in demo mode.
- **Simulated DPF data: On** enables artificial example readings and an artificial history, visibly marked `DEMO`. This is unrelated to real sensor readings.
- **Live page**: soot, differential pressure, exhaust temperature, distance since last completed regeneration. **Regeneration page**: temperature and distance plus an **unverified raw regeneration-request value**. **History page**: current ash mass, successful regeneration count and average interval; a true timestamped event history is not yet implemented.
- When the experimental toggle is Off, real readings and raw status values are hidden. Stale readings older than 45 seconds are also hidden.

## What is not yet implemented

- **Regeneration active = yes/no** is intentionally **unknown**. `0x44BB` is labeled `Regenerationsanforderung` in the PRG, but its raw value is not enough to prove the filter is actively regenerating.
- The PRG contains a diagnostic job `STATUS_REGENERATION_CSF` whose result `STAT_REGENERATION_LAEUFT_WERT` is 0 for inactive and 1 for active. However, it uses UDS `0x2C` to define a temporary data identifier. The exact extraction from the related status word must be verified before any active-regeneration indication is shipped.
- Data validation, asynchronous error handling in the car and diagnostic routing for this MGU firmware are not confirmed.
- No automatic regeneration start, service reset, coding, flash or ECU write is included.

See [DDE_D83BX7C0.md](DDE_D83BX7C0.md) for DID definitions and validation steps.

## Install / test on Windows

Put `dpf_monitor` in `idrive7-apps-main\apps\`. Keep the BMW `oap-sdk\` only on the build machine or let MGU Store's headunit builder provide it.

```powershell
py .\kit\tools\check_signals.py
py .\kit\tools\build.py dpf_monitor
node .\kit\tools\emu.js dpf_monitor
```

Open `http://localhost:8077/`. Set **Simulated DPF data** to On to inspect all three pages. The emulator does not have a DDE transport and cannot verify real DIDs.

For in-car verification, leave the experimental DDE toggle Off until the vehicle is stationary and you are ready to compare against ISTA / Tool32. Avoid running this alongside ECU programming.

Do not commit the binary PRG file, BMW SDK, private keys, VIN or vehicle-specific logs.
