# MGU GameStation 0.2.0 - experimental

An offline retro console for BMW iDrive 7 (MGU, Node 8 OAP runtime), distributed
as a fourth independent MGU Store app in `NamelsMissing/mgu-apps`.

## What's included

- **NES**: `nes-js` MIT engine, headless, software pixel rendering.
- **SNES**: `jssnes` MIT engine, headless, full JavaScript CPU and video; heavier
  console games may exceed the headunit's CPU budget and stop automatically.
- **Game Boy / Game Boy Color**: `serverboy.js` GPL-2.0 engine, native colour
  palette support; only player one controls GB cartridges.
- **Arcade**: original two-player Pong. No ROM required.
- **Two phone controllers**: phone browsers open a local, token-authenticated
  controller on the BMW Wi-Fi hotspot (player 1 and player 2 have different QR codes).
- **iDrive as a controller**: one physical iDrive rotary controller can play solo
  or control player 1 while a phone controls player 2. When solo, Pong has a
  deliberately beatable CPU opponent.
- **Phone ROM import**: from the controller page upload `.nes`, `.gb`, `.gbc`,
  `.sfc` or `.smc`. Saved in the app-private `data/roms/<console>` folder.
- **On-screen game library**: select console, select a game, play or go back.

The phone provides controls and ROM transfer only. Emulation and display frames
run directly on the MGU; a mobile emulator, Internet service or external PC is
not needed. No commercial ROMs or BIOS images are included.

## Safety and operation

Game execution is **always blocked unless a real valid Vehicle2 speed signal**
was received within the last 5 seconds and indicates 0.5 km/h or less. If the
signal stops arriving, the game freezes. A game never changes vehicle ECU data.
For use only while the vehicle is parked. Do not interact with the display as
the driver while the car is moving.

1. Install `mgu_gamestation` from MGU Store using this source repository.
2. Ensure the MGU is running, stationary, and `mgu-renderd` and `mgu-inputgate`
   are installed. Open **MGU GameStation**.
3. Enable the BMW Wi-Fi hotspot, connect both phones, then press **Connect phones**.
4. Scan the separate Player 1 and Player 2 QR codes with each phone. Both phone
   controller pages show a status indicator. No Internet needed.
5. Import legally obtained ROMs on either controller page. Return to the
   library to see the new games. Arcade Pong works with zero imports.
6. Select a console/game on the BMW screen. Use both phones as controllers.

### Controller modes (Settings → Controller setup)

| Setting | Player 1 | Player 2 |
| --- | --- | --- |
| iDrive singleplayer | iDrive controller | CPU in Pong / unused in console games |
| Phone singleplayer | Phone with Player 1 QR | CPU in Pong / unused |
| Two phones (default) | Phone with Player 1 QR | Phone with Player 2 QR |
| iDrive P1 + Phone P2 | iDrive controller | Phone with Player 2 QR |

**iDrive gameplay** (only while the game is visible, focused and parked):

- Tilt knob in four directions: D-pad up / down / left / right (held while tilted).
- Press and hold central knob button: A.
- Rotate clockwise: a momentary B (configurable in settings).
- Rotate counterclockwise: a momentary X (configurable in settings).
- Double press knob within 350ms: a brief START input.
- Hold knob down for at least 650ms: SELECT while held instead of A.
- Pong: rotating clockwise/counterclockwise moves the left paddle down/up;
  tilting up/down also works. Phone modes keep their own touch controls.
- The car's hardware BACK/MENU navigation stays available. When switching away
  from the game, losing display focus or moving, the app releases its exclusive
  claim on the iDrive knob.

The controller's centre button does not physically provide separate held A/B
buttons. Many games work, but simultaneous A+B and full SNES button combos are
limited. Phone controllers remain the better option for action games.

Local connection defaults to port `18878`, binding `0.0.0.0`, with one random
pairing token generated at each app start. The IP address in the pairing URL is
obtained from available private Wi-Fi interfaces; on sandboxes where interface
enumeration is blocked, `172.16.222.97` is used as a fallback. This must be
checked on the actual BMW hotspot. No remote upload without the random token.

## Limitations / verification status

- The NES, Game Boy/Color and SNES engines each passed headless frame-level
  tests in Node.js on a PC; Pong and ROM upload/authentication also passed.
- **Headunit compatibility, game compatibility, FPS, audio output, and BMW Wi-Fi
  HTTP/WebSocket reachability are not yet verified on the real MGU**.
- Sound output is not yet connected to the vehicle audio system (silent games).
- iDrive FrontCCU event reception and the native renderer's input capture have
  only been tested offline; test the real hardware before considering them verified.
- Some games may require special mapper, cartridge RTC, save-RAM or other
  functionality not yet provided. Game Boy controller two is not used by ROMs.
- A core will be stopped after multiple 200ms+ rendering frames to help limit
  headunit CPU load. There is no ROM execution while driving.
- The MGU Store must run its SDK-dependent build on the unit; the SDK is not
  committed to GitHub. This source package does not contain an installable TGZ.

## Local tests

```
node tests/gamestation.test.js
python3 -c "import json,sys;sys.path.insert(0,'kit/tools');from build import build_ui;build_ui(json.load(open('apps/mgu_gamestation/app.json')))"
```

## Core source and licenses

All vendored engines are in readable `*_vendor.js` bundles and included in the
repository along with their full license texts:

- NES: MIT, https://github.com/takahirox/nes-js
- SNES: MIT, https://github.com/deepneko/jssnes
- GB/GBC: GPL-2.0, https://github.com/danShumway/serverboy.js
- QR: MIT, https://github.com/kazuhikoarase/qrcode-generator

The GameStation app itself is GPL-2.0 (see `LICENSE`); the other three BMW apps
are separate packages. The source bundler is `tools/vendor_retro_cores.py`.
