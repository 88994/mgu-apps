# MGU Apps — BMW iDrive 7

Three source-installable MGU Store apps for an ID7 G21. Source: `NamelsMissing/mgu-apps`, channel **main**.

| App | Version | Function |
| --- | --- | --- |
| `dpf_monitor` | 0.2.8 | Overview, DPF details, real regeneration odometer history and diagnostics; no simulated data |
| `g21_ambient` | 0.3.10 | RGB picker and clear RAM01 E311 rejection diagnostics, no guessed alternate writes |
| `g21_wheelheat` | 0.4.13 | Background autostart, persistent settings, original Log and offline full-diagnostic QR export |

The Store reads `mgu-repo.json` on **main**, detects each `apps/*/app.json`, builds the app on the head unit from its own SDK donor, and checks version changes. No BMW SDK or binary diagnostic PRGs are published here.

## WheelHeat autostart

The WheelHeat manifest declares `"mguAppStartType": "autostart"`. The repository builder `tools/build_store_app.py` runs the SDK build and then inserts that property into both package formats. This is a package property, **not** a GitHub branch or separate root-service patch. The Store source on `main` is sufficient; the older `wheelheat-autostart-0.4.2-qa` branch is only a historical test.

Launching the app does not automatically authorize heating: enable **Automatic heating on cold startup** once in WheelHeat settings. The app starts in the background on every supported MGU boot, and attempts to retain ON/OFF, temperature and duration settings in the app's data folder. The storage path now matches the original MGU kit: the MainApp-provisioned app `data` directory (or the app's working directory if `data` does not exist). There are no early write probes, alternate sibling directories, or `mkdir` calls. A setting change writes directly to `settings.json` and verifies the file immediately by reading it back; the Log tab reports the path and any genuine write/read error. After installation, change a setting once and check persistence across a full head-unit restart. There is no version-based setting reset.

The automatic live-control implementation requires an explicit saved enable switch, fresh vehicle-speed signal, and a fresh successful BDC read before each request. Automatic heating can start or extend while driving; manual diagnostic writes retain the standstill guard. Commands encode at most 255 seconds and ECU acceptance while driving must be verified on the car. Settings use a direct `settings.json` write and immediate read-back; legacy backup files can still be loaded, but no new backup or temporary file is created. The Log tab shows the selected storage path, loaded file and on-disk values; persistence still needs on-car verification. A 10-minute configured timer is not proof of 10 minutes of physical heating. The diagnostics tab decodes BDC readbacks using the supplied PRG schema; the byte mapping still needs on-car validation.


### Full diagnostic QR export (Heating Comfort 0.4.13)

The original **Log** tab remains unchanged. A separate **QR Log** tab takes a read-only snapshot of the current heating state, saved settings, anti-repeat cycle marker, BDC raw replies, all retained heating events, and the existing app log file plus its rotated predecessor. The snapshot is split into numbered, UTF-8 **plain-text** QR codes so nothing in the retained source files is cut off to fit a single code. Select **QR Log** to refresh; **ACTION** advances to the next code (wraps around). Scan and keep every numbered code with the same report ID to reconstruct the entire snapshot. The report is generated locally: no external web service, network transfer, additional ECU command, or forced heating action. The runtime itself rotates its logs at 256 KiB, and older logs already rotated out cannot be recovered.

**CYCLE ALREADY RUN** is an anti-repeat state, **not an ECU readback**. A fresh app process restores `auto.fired` if its saved `_autoCycleAt` (written only after a positive BDC ON acknowledgement) is less than 30 minutes old. Within one process, the planner also sets `auto.fired` after 15 seconds of sufficiently low temperature **before** the ECU command is confirmed; a rejected request can therefore still suppress another cycle until the process restarts. The Log and QR report identify which case applied and include the timestamp and acknowledgement details. A positive BDC reply never proves actual heater warmth.

## Diagnostics and limitations

- **DPF:** candidate D83BX7C0 DIDs were checked offline against a local PRG. The app never simulates vehicle values, and uses a single read-only functional `01 0C` engine-RPM scan if no values respond to candidate address 0x12. Silence with the engine off is possible; confirm with ignition on and an awake DDE. Real regeneration-active state is not yet decoded. Four tabs separate Overview, Details, History (actual last-five DDE regen odometers plus recorded sensor snapshots) and Regeneration. The in-car regen start action stays disabled until an OEM-supported UDS routine and preconditions are verified.
- **Ambient:** the car rejected both 22 E311 and 22 E310 with `NRC 0x31` / out of range. Read-only 22 F150 returns a numeric SGBD index (not an ASCII name). The owner's observed `62 F1 50 0F 25 90` readback at `0x37` identifies RAM01. Only that exact ECU index may unlock one temporary `2E E311` write after a fresh read, confirmed standstill and two deliberate presses. **Vehicle color change remains unverified**: the ECU may still reject the DID or the LIN command. Other ECU index values cannot authorize writes. An FDL slot-11 plan does not alter CAFD/NCD by itself.
- **WheelHeat:** actual ON/OFF and seat heating level are decoded from the BDC_G05 PRG status fields of `0x22 D074`, `0x22 E432` and `0x22 E430`. Check `g21_wheelheat.log` for `[WHEELHEAT TEMP]` and `[HEATER STATUS SNAPSHOT]` when troubleshooting. Raw ECU readbacks, unstable status indications and the app's own separate command/plan history are shown on the Log tab. A decoded OFF can differ from a manually switched-on heater; the cause needs raw on-car comparison.
- **Ambient Lighting:** `LED module target` is the physical LIN-bus position (0 = all LED modules, 1 = first module). It does not refer to the iDrive color menu slot. The vehicle must be stationary and APPLY requires two presses. The standard identity read does not prove the LIN command will be accepted; a `0x6E` acknowledgement also does not confirm visible color change. Actual effect must be checked on the car.

Do not commit EDIABAS PRGs, BMW SDK files, private keys, VINs or diagnostic logs. For installation and versions, see [STORE_INSTALLATION.md](STORE_INSTALLATION.md).

PRG metadata assessment: [docs/ecu-prg-review-2026-11-03.md](docs/ecu-prg-review-2026-11-03.md).
