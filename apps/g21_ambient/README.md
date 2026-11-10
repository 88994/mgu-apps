# G21 Ambient Lighting 0.4.0

An iDrive 7 MGU application with a synchronized RGB picker, brightness control,
saved looks, zone controls, and read-only driving-mode detection.

## Pages

- **Color:** exact RGB and brightness sliders; `RAM` is the original RAM01
  experimental route, `BDC zones` is a new temporary per-module route, and
  `Menu 11` creates an **offline plan only** (no FDL write).
- **Zones:** `SCAN BDC` asks the vehicle for its two interior-light LIN buses.
  Only actual returned module records are selectable. Each module can follow
  the main color, keep a distinct RGB captured from the picker, or return to
  the BMW-controlled original. `APPLY / confirm` requires two taps within 8
  seconds and verified vehicle standstill; `RETURN TO BMW / confirm` releases
  modules using the same confirmation. Discovery expires after 2 minutes.
- **Favorites:** six persistently saved RGB/brightness and zone-policy looks.
  Loading one edits the current look; it does not send ECU commands.
- **Drive modes:** save a look for Sport, Comfort, Eco or Adaptive. The optional
  vehicle signal can follow the selected mode in the **editor only**; automatic
  vehicle writes are deliberately disabled until physical results are verified.
- **Diagnostics:** RAM identity, TASU/standstill readings, BDC bus discovery and
  ECU acknowledgement status.

## Important limits

- Developed from public BDC_G05 LIN descriptions; actual compatibility with a
  2021 G21 and aftermarket ambient LED modules is **not confirmed**. First test
  only `SCAN BDC`, verify the discovered module list, then test one manual
  temporary color with the vehicle safely stationary.
- A positive `6E` diagnostic reply acknowledges the command, **not** a visible
  LED change. No simulated module records or broadcast LIN addresses are used.
- The per-zone route is temporary and normally times out back to BMW colors;
  persistent palette modification / menu position 11 is not implemented.
- Never depend on the app to control essential vehicle lighting.
