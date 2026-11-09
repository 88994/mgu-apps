# MGU Apps — BMW iDrive 7

Eleven source-installable MGU Store apps for an ID7 G21. Source: `NamelsMissing/mgu-apps`, channel **main**.

| App | Version | Function |
| --- | --- | --- |
| `dpf_monitor` | 0.2.8 | Overview, DPF details, real regeneration odometer history and diagnostics; no simulated data |
| `g21_ambient` | 0.3.12 | RGB picker and clear RAM01 E311 rejection diagnostics, no guessed alternate writes |
| `g21_wheelheat` | 0.4.15 | Background autostart, configurable heating repeat cooldown, persistent settings and offline full-diagnostic QR export |
| `mgu_gamestation` | 0.2.0 (experimental) | NES, SNES, Game Boy/Color, Pong; iDrive singleplayer, phone singleplayer, two-phone multiplayer or hybrid; local ROM upload. Games blocked without a fresh 0 km/h vehicle speed. Sound/real MGU compatibility unverified. |
| `mgu_gamesnacks` | 0.1.1 (preview) | Offline HTML5 game catalog and touch diagnostic preview; original game distribution and browser compatibility still under review. |
| `mgu_video_hub` | 0.1.1 (experimental) | Local video library from app storage/USB, QR phone import, YouTube links, 15 fps I420 GPU video playback using external ffmpeg, optional yt-dlp and experimental ALSA audio. Parked only. |
| `gif_home` | 0.2.0 (experimental) | Animated home-screen widget with built-in BMW-style roundel; local GIF upload from iPhone using a temporary QR code. Large-tile support and phone connectivity require on-car verification. |
| `custom_cluster` | 0.5.1 (experimental) | G80/G21/6WB previews, parked-only panels, new small shader probe, renderer diagnostics and QR log export; Waze/BMW map coexistence unverified. |
| `mgu_phone_terminal` | 0.1.3 (experimental) | On-car QR pairing for a temporary phone-browser root command console. Requires the `mgu-phone-bridge` system tool (0.1.2); fixes root-owned key permissions and adds UID diagnostics; real MGU command/network operation not yet verified. |
| `equalizer` | 0.2.0 (experimental) | Seven real parametric PCM DSP bands, gain/frequency/Q/preamp, profiles and native BMW tone controls. Video Hub PCM is connected; stock CarPlay/radio routing is not implemented. Vehicle audio output remains unverified. |
| `light_show` | 0.1.0 (experimental) | Native strobe menu: six patterns, four front light pairs, tempo, automatic stop and separate screen preview. Requires stationary vehicle in P and identified BDC_G05. Physical lamp operation untested. |

The Store reads `mgu-repo.json` on **main**, detects each `apps/*/app.json`, builds the app on the head unit from its own SDK donor, and checks version changes. No BMW SDK or binary diagnostic PRGs are published here.

## Equalizer DSP (experimental)

`equalizer` 0.2.0 adds seven parametric biquad filters that process actual S16LE
PCM samples. The `mgu-equalizer-dsp` 0.2.0 tool is installed as its Store
dependency. Each band supports 20–20,000 Hz, ±12 dB and Q 0.3–6; there are
preamp, conservative automatic headroom, bypass and saved profiles. Video Hub
0.1.1 connects decoder audio through the shared DSP before `aplay` and offers
an **Audio EQ** sheet while playback stays on its existing guarded screen.
The service does not intercept stock CarPlay, radio or Bluetooth; those paths
require separate MGU audio-route evidence. Digital sample filtering is tested;
physical output and performance on the G21 remain unverified.
[Setup and limitations](apps/equalizer/README.md) ·
[DSP protocol and read-only audio-path probe](native/equalizer-dsp/README.md).

## Custom Cluster (experimental)

`custom_cluster` uses the installed `cluster-render` service shared with Waze on Cluster; the Store dependency is `cluster-render` 0.4.0. Waze on Cluster remains optional. BMW stock is the default. The G80-inspired 1920 × 720 panel runs only in a manually armed 12-second test in P with live speed/RPM signals. It has not been tested on the real KOMBI and must not be used for driving. The combined Waze panel/map, HUD conflict and warning visibility still need tests on KOMBSP18. [Setup, tests and limitations](apps/custom_cluster/README.md).

## GameStation (experimental)

Install `mgu_gamestation` from MGU Store, connect up to two phones to the BMW
hotspot, and open **Connect phones** in GameStation to scan the individual QR
codes. Both phones act as offline controller pages; each can also import
legally obtained ROMs. Pong requires no ROM. The NES/SNES/GB/GBC emulation takes
place inside the MGU process, not on the phones. Headunit CPU performance,
vehicle audio and network reachability require in-car testing before the app
can be called production ready. [Setup, limitations and licenses](apps/mgu_gamestation/README.md).

From 0.2.0 the **Controller setup** setting also offers iDrive only, phone only,
or hybrid (iDrive player 1 + phone player 2). The rotary controller uses tilt
for directions, centre press for A, configurable clockwise / counterclockwise
rotation as short button pulses, double press for START and long press for
SELECT. In Pong the knob instead moves the paddle and the other player can be
an offline CPU opponent. A complex SNES game's simultaneous button combinations
may still require a smartphone controller. The iDrive input path needs the
renderer and inputgate on the real MGU and is not verified on-car yet.


## GIF Home (experimental)

`gif_home` registers an animated **large home-screen widget** that can be selected instead of the map tile without modifying BMW navigation or map data. A bundled 24-frame BMW-style animation runs offline. **Phone upload** opens a short-lived, token-protected local web page on port 18883; scan the QR code on your phone and import your own GIF. Phone-to-MGU local-network access and this widget's image refresh behavior still need verification on the car. [Instructions and limitations](apps/gif_home/README.md).

## Video Hub (experimental)

`mgu_video_hub` is a separate app for local videos and YouTube links. The
MGU rendering interface supports video frames, but it does not include a web
browser or a video decoder: actual playback requires a compatible `ffmpeg`
on the head unit; YouTube also needs an Internet route and `yt-dlp`. No
decoder or videos are bundled. Audio is disabled by default and BMW audio
routing is unverified. The phone import uses port 18879 with a random QR
token; BMW CarPlay Wi-Fi Direct is not confirmed to allow access to it.
See [Video Hub setup and limitations](apps/mgu_video_hub/README.md).

## WheelHeat autostart

The WheelHeat manifest declares `"mguAppStartType": "autostart"`. The repository builder `tools/build_store_app.py` runs the SDK build and then inserts that property into both package formats. This is a package property, **not** a GitHub branch or separate root-service patch. The Store source on `main` is sufficient; the older `wheelheat-autostart-0.4.2-qa` branch is only a historical test.

Launching the app does not automatically authorize heating: enable **Automatic heating on cold startup** once in WheelHeat settings. The app starts in the background on every supported MGU boot, and attempts to retain ON/OFF, temperature and duration settings in the app's data folder. The storage path now matches the original MGU kit: the MainApp-provisioned app `data` directory (or the app's working directory if `data` does not exist). There are no early write probes, alternate sibling directories, or `mkdir` calls. A setting change writes directly to `settings.json` and verifies the file immediately by reading it back; the Log tab reports the path and any genuine write/read error. After installation, change a setting once and check persistence across a full head-unit restart. There is no version-based setting reset.

The automatic live-control implementation requires an explicit saved enable switch, fresh vehicle-speed signal, and a fresh successful BDC read before each request. Automatic heating can start or extend while driving; manual diagnostic writes retain the standstill guard. Commands encode at most 255 seconds and ECU acceptance while driving must be verified on the car. Settings use a direct `settings.json` write and immediate read-back; legacy backup files can still be loaded, but no new backup or temporary file is created. The Log tab shows the selected storage path, loaded file and on-disk values; persistence still needs on-car verification. A 10-minute configured timer is not proof of 10 minutes of physical heating. The diagnostics tab decodes BDC readbacks using the supplied PRG schema; the byte mapping still needs on-car validation.


### Full diagnostic QR export (Heating Comfort 0.4.13)

The original **Log** tab remains unchanged. A separate **QR Log** tab takes a read-only snapshot of the current heating state, saved settings, anti-repeat cycle marker, BDC raw replies, all retained heating events, and the existing app log file plus its rotated predecessor. The snapshot is split into numbered, UTF-8 **plain-text** QR codes so nothing in the retained source files is cut off to fit a single code. Select **QR Log** to refresh; **ACTION** advances to the next code (wraps around). Scan and keep every numbered code with the same report ID to reconstruct the entire snapshot. The report is generated locally: no external web service, network transfer, additional ECU command, or forced heating action. The runtime itself rotates its logs at 256 KiB, and older logs already rotated out cannot be recovered.

**CYCLE ALREADY RUN** is an anti-repeat state, **not an ECU readback**. From 0.4.14 the **Repeat automatic cycle after** setting offers 30, 45, 60, 90, 120 or 180 minutes (default 30). A new process restores `auto.fired` only when its saved `_autoCycleAt` (written after a positive BDC ON acknowledgement) falls within the selected cooldown. Within a process the planner also marks the first cycle as fired after 15 seconds of low temperature **before** ECU confirmation. The repeat clock starts at planning and is updated when an ON is positively acknowledged; a failed attempt may therefore re-arm after the chosen cooldown, without being mistaken for a physical heating success. The app re-arms only **after the configured cooldown**, **when no heating session is active**, and only with a fresh speed signal confirming **vehicle movement above 0.5 km/h**. It then requires a new 15-second cold dwell and all normal BDC command guards. It never sends an ECU command merely because a cooldown expires. The Log and QR export record the reason and selected duration. Positive BDC replies do not prove physical warmth.

**One-shot startup test (0.4.15):** In the native **Settings** tab, turn on **Test on next app start (skip cooldown once)** and then restart the **MGU/headunit or the Heating Comfort app**. On the next actual process launch, the app verifies it has persistently reset the switch to OFF before ignoring the saved cycle lockout one time. If this reset cannot be verified, the cooldown remains enforced. The setting itself sends no BDC commands. The normal **Automatic heating on cold startup** toggle must still be ON; real fresh outdoor-temperature and speed signals, a functioning BDC connection, the usual 15-second cold dwell and all existing write checks remain mandatory. The test is consumed even if these conditions cannot be met. A reboot of the BDC ECU alone does not restart the app. The regular **Log** and offline **QR Log** show `TEST` / `TEST BLOCKED` and the startup state. QR codes embed diagnostic text and need **no internet, Wi-Fi or mobile data**.

**Ambient Lighting - last existing iDrive menu position (0.3.12):** The user means the **last iDrive color menu position (number 11, Lilac)**, **not** BDC 360A palette index 09. The owner's BDC NCD defines 11 existing two-byte color menu positions in 360D; the final position is currently `05 00`. No twelfth menu option is requested. The RGB palette 05 is also referenced by a different existing menu position; palette index 09 contains existing black entries possibly used by other lighting functions. The app therefore **does not modify palette index 09**, **does not overwrite shared palette 05**, and **does not propose 09 09**. The RGB picker records an offline customization request for menu position 11, but clearly reports independent color mapping as unverified. No executable FDL patch or ECU write is produced. Restore references the original menu profile `05 00`. Physical RGB control needs independent validation on the vehicle. Temporary RAM LIN E311 writes remain unverified.

## Diagnostics and limitations

- **DPF:** candidate D83BX7C0 DIDs were checked offline against a local PRG. The app never simulates vehicle values, and uses a single read-only functional `01 0C` engine-RPM scan if no values respond to candidate address 0x12. Silence with the engine off is possible; confirm with ignition on and an awake DDE. Real regeneration-active state is not yet decoded. Four tabs separate Overview, Details, History (actual last-five DDE regen odometers plus recorded sensor snapshots) and Regeneration. The in-car regen start action stays disabled until an OEM-supported UDS routine and preconditions are verified.
- **Ambient:** the car rejected both 22 E311 and 22 E310 with `NRC 0x31` / out of range. Read-only 22 F150 returns a numeric SGBD index (not an ASCII name). The owner's observed `62 F1 50 0F 25 90` readback at `0x37` identifies RAM01. Only that exact ECU index may unlock one temporary `2E E311` write after a fresh read, confirmed standstill and two deliberate presses. **Vehicle color change remains unverified**: the ECU may still reject the DID or the LIN command. Other ECU index values cannot authorize writes. An FDL slot-11 plan does not alter CAFD/NCD by itself.
- **WheelHeat:** actual ON/OFF and seat heating level are decoded from the BDC_G05 PRG status fields of `0x22 D074`, `0x22 E432` and `0x22 E430`. Check `g21_wheelheat.log` for `[WHEELHEAT TEMP]` and `[HEATER STATUS SNAPSHOT]` when troubleshooting. Raw ECU readbacks, unstable status indications and the app's own separate command/plan history are shown on the Log tab. A decoded OFF can differ from a manually switched-on heater; the cause needs raw on-car comparison.
- **Ambient Lighting:** `LED module target` is the physical LIN-bus position (0 = all LED modules, 1 = first module). It does not refer to the iDrive color menu slot. The vehicle must be stationary and APPLY requires two presses. The standard identity read does not prove the LIN command will be accepted; a `0x6E` acknowledgement also does not confirm visible color change. Actual effect must be checked on the car.

Do not commit EDIABAS PRGs, BMW SDK files, private keys, VINs or diagnostic logs. For installation and versions, see [STORE_INSTALLATION.md](STORE_INSTALLATION.md).

PRG metadata assessment: [docs/ecu-prg-review-2026-11-03.md](docs/ecu-prg-review-2026-11-03.md).
