# BMW G21 PRG review — 2026-11-03

Sources: user-supplied EDIABAS compiled PRGs in Ecu.zip. The source metadata
was extracted read-only for comparison with in-car ECU replies. No coding
or actuation was performed.

## RAM01.prg / Ambient Lighting

- `LIN_RGB_MODULE`: DID `0xE311`, listed UDS services `2E;22`.
- The declared write arguments in order are `ID`, `EIN_AUS`,
  `HELLIGKEIT`, `ROTWERT`, `GRUENWERT`, `BLAUWERT`, `ZEIT`.
- PRG ranges: module ID 0..254 (0 means all modules), on/off 0..1,
  brightness 0..100, RGB channels 0..254, duration 0..254 seconds.
- The app's encoding matches those argument definitions.
- On car, ECU address `0x37` responds to `22 F150` with `62 F1 50 0F 25 90`,
  identified by previous comparison as RAM01 variant index.
- On car, attempting the LIN RGB write returns `7F 2E 31`: request out of
  range. Read of `E310` / `E311` has also been refused in previous tests.
  This suggests the installed ECU configuration / LIN topology / supported
  diagnostics do not accept the operation; a PRG listing is not proof that
  the function is enabled in a particular RAM hardware/software variant.
- **Do not** suppress the error, force a diagnostic session or try guessed
  alternate identifiers. To change the retrofit lighting, capture its actual
  BDC/LIN topology and BDC NCD/CAFD mapping; verify on a parked car before
  any write. No factory slot-11 profile has been written.

## BDC_G05.prg / Heating Comfort

- `LENKRADHEIZUNG`: DID `0xD074`, services `22;2E`, read fields:
  heater active (0/1), indicator LED (0/1), current in 0.1 A,
  actuator state and installed/coded flag.
- The in-car user reports an actual manually heated steering wheel while
  occasional BDC readings display 0 or switch between 0 and 1.
  A single decoded 0 is **not** strong evidence of physical OFF.
- `LENKRADHEIZUNG_LED` at `0xD071` is *write-only* (`2E`) in this PRG,
  so it must NOT be queried as an alternate read status.
- Heating Comfort logs actual raw `62 D0 74 ...` replies and both the
  automation plan and actual positive/negative ECU acknowledgements.
  It labels unstable series instead of claiming a reliable state.
- The app's settings persist in the OAP app data directory. Storage status
  and the source of loaded preferences are now observable in Log; if the
  platform deletes its data after a corrupt-app startup, the app cannot
  guarantee persistence across that deletion.

## D83BX7C0.prg / DPF

Validated labels/scales from `SG_FUNKTIONEN` (UDS `22`):

| DID | Measurement | Decode |
| --- | --- | --- |
| 44BE | Calculated soot | unsigned 16-bit × 0.01525902 g |
| 44BD | Oil-ash mass | unsigned 16-bit × 0.01525902 g |
| 44AC | Measured soot | unsigned 16-bit × 0.1 g |
| 44C1 | Model soot | unsigned 16-bit × 0.01 g |
| 44ED | Differential pressure | unsigned 16-bit × 0.04577707 − 1000 hPa |
| 44FA | Filtered differential pressure | same as 44ED |
| 4502 | Temperature upstream of DPF | unsigned 16-bit × 0.03128099 − 50 °C |
| 44BF | Distance since successful regen | unsigned 32-bit metres, ÷1000 km |
| 44B7 | Time since successful regen | unsigned 32-bit seconds, ÷3600 h |
| 44B8 | Successful regen count | unsigned 16-bit |
| 44C7 | Average regen interval | unsigned 16-bit km |
| 44D1..44D5 | Odometer at last five successful regens | unsigned 32-bit metres, ÷1000 km |
| 44BB | Regeneration request status | unsigned 8-bit code; enum not verified |
| 44C2 | Regeneration inhibit status | unsigned 8-bit code; enum not verified |

The PRG includes `STATUS_REGENERATION_CSF`, a **read-only** `0x2C`
dynamic-data job that describes whether regeneration is requested,
running or inhibited. It is not a command to start regeneration, and
the exact dynamic DID definition has not been decoded/verified on this car.
The job list contains no explicitly documented forced-regeneration start
job. Thus the app must not send a guessed `0x31` routine. A request UI
is shown as disabled pending an OEM-validated procedure and ECU conditions.

Not every DID responds on this individual DDE; missing values are `--`,
not simulated. The app staggers secondary reads to reduce TASU traffic.
