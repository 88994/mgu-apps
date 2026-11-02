# MGU Apps — BMW iDrive 7

Three source-installable MGU Store apps for an ID7 G21. Source: `NamelsMissing/mgu-apps`, channel **main**.

| App | Version | Function |
| --- | --- | --- |
| `dpf_monitor` | 0.2.4 | Read-only DDE DPF live readings and filter load; no invented regeneration history |
| `g21_ambient` | 0.3.6 | RGB/brightness picker, gated temporary LIN diagnostic, slot 11 FDL preparation (not automatic coding) |
| `g21_wheelheat` | 0.4.5 | Outdoor-temperature heating automation with MGU app autostart and explicit heater opt-in |

The Store reads `mgu-repo.json` on **main**, detects each `apps/*/app.json`, builds the app on the head unit from its own SDK donor, and checks version changes. No BMW SDK or binary diagnostic PRGs are published here.

## WheelHeat autostart

The WheelHeat manifest declares `"mguAppStartType": "autostart"`. The repository builder `tools/build_store_app.py` runs the SDK build and then inserts that property into both package formats. This is a package property, **not** a GitHub branch or separate root-service patch. The Store source on `main` is sufficient; the older `wheelheat-autostart-0.4.2-qa` branch is only a historical test.

Launching the app does not automatically authorize heating: enable **Automatic heating on cold startup** once in WheelHeat settings after upgrading. On upgrade to 0.4.5 the switch is reset to Off once, to avoid silently enabling physical heating when removing the old second permission.

The current live-control implementation requires a fresh successful BDC read and confirmed vehicle standstill before each control request. Commands encode at most 255 seconds, and extensions while driving are not implemented. Thus a 10-minute configured timer is *not* proof of 10 minutes of physical heating while driving. The diagnostics tab displays decoded status only once verified against the actual BDC status job; successful UDS replies alone do not prove a heater is on.

## Diagnostics and limitations

- **DPF:** candidate D83BX7C0 DIDs were checked offline against a local PRG. Real regeneration-active state is not yet decoded; only two tabs are shown (Live, Regeneration).
- **Ambient:** ECU rejection `NRC 0x31` / out of range still requires validation against the car's RAM01 PRG and actual ECU responses. An FDL slot-11 plan does not alter CAFD/NCD by itself.
- **WheelHeat:** check `g21_wheelheat.log` for `[WHEELHEAT TEMP]` and `[HEATER STATUS SNAPSHOT]` when troubleshooting temperature conversion and ECU state. A vehicle-specific BDC status mapping is still required for actual ON/OFF.

Do not commit EDIABAS PRGs, BMW SDK files, private keys, VINs or diagnostic logs. For installation and versions, see [STORE_INSTALLATION.md](STORE_INSTALLATION.md).
