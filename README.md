# MGU Apps — BMW iDrive 7

Three source-installable MGU Store apps for an ID7 G21. Source: `NamelsMissing/mgu-apps`, channel **main**.

| App | Version | Function |
| --- | --- | --- |
| `dpf_monitor` | 0.2.5 | Read-only DDE DPF live readings with startup-poll recovery and visible ECU read errors |
| `g21_ambient` | 0.3.7 | RGB picker, temporary LIN color with E310 read-only preflight and two-tap confirmation; slot 11 FDL preparation only |
| `g21_wheelheat` | 0.4.6 | Temperature heating automation and BDC_G05 PRG-derived heating status decoding |

The Store reads `mgu-repo.json` on **main**, detects each `apps/*/app.json`, builds the app on the head unit from its own SDK donor, and checks version changes. No BMW SDK or binary diagnostic PRGs are published here.

## WheelHeat autostart

The WheelHeat manifest declares `"mguAppStartType": "autostart"`. The repository builder `tools/build_store_app.py` runs the SDK build and then inserts that property into both package formats. This is a package property, **not** a GitHub branch or separate root-service patch. The Store source on `main` is sufficient; the older `wheelheat-autostart-0.4.2-qa` branch is only a historical test.

Launching the app does not automatically authorize heating: enable **Automatic heating on cold startup** once in WheelHeat settings after upgrading. On upgrade to 0.4.5 the switch is reset to Off once, to avoid silently enabling physical heating when removing the old second permission.

The current live-control implementation requires a fresh successful BDC read and confirmed vehicle standstill before each control request. Commands encode at most 255 seconds, and extensions while driving are not implemented. Thus a 10-minute configured timer is *not* proof of 10 minutes of physical heating while driving. The diagnostics tab now decodes BDC readbacks using the supplied PRG schema; the byte mapping still requires a real-car comparison against physical heating state.

## Diagnostics and limitations

- **DPF:** candidate D83BX7C0 DIDs were checked offline against a local PRG. Real regeneration-active state is not yet decoded; only two tabs are shown (Live, Regeneration).
- **Ambient:** ECU rejection `NRC 0x31` / out of range still requires validation against the car's RAM01 PRG and actual ECU responses. An FDL slot-11 plan does not alter CAFD/NCD by itself.
- **WheelHeat:** actual ON/OFF and seat heating level are decoded from the BDC_G05 PRG status fields of `0x22 D074`, `0x22 E432` and `0x22 E430`. Check `g21_wheelheat.log` for `[WHEELHEAT TEMP]` and `[HEATER STATUS SNAPSHOT]` when troubleshooting. Only valid ECU readbacks are shown; the app's own command history is never used as a status reading.
- **Ambient Lighting:** `LED module target` is the physical LIN-bus position (0 = all LED modules, 1 = first module). It does not refer to the iDrive color menu slot. The car previously rejected `0x22 E311` with NRC 31; the app now reads separately documented `0x22 E310` before attempting the `0x2E E311` color control. The vehicle must be stationary and APPLY requires two presses. A `0x6E` acknowledgement does not confirm visible color change. Actual effect must be checked on the car.

Do not commit EDIABAS PRGs, BMW SDK files, private keys, VINs or diagnostic logs. For installation and versions, see [STORE_INSTALLATION.md](STORE_INSTALLATION.md).
