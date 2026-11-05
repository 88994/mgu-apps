# MGU GameSnacks - separate offline-game project (0.1.1 preview)

This is a **standalone fifth BMW iDrive 7 MGU app**. It is independent from
`mgu_gamestation`. The target is a catalog of **real original GameSnacks games
installed locally**, not a website iframe or a phone-streaming solution.

**This preview does not contain or play any Google/Famobi/ZeptoLab games.**
It provides a native MGU game-review list, individual rights/compatibility
status pages, and a vehicle-speed fail-closed interlock foundation. It does
not modify ECUs. It is not an official Google application.

## Touch input

The native catalog is touch-operated through `cv.target(...)`, and the app has
a **Touch test** page that reports down/move/up, drag positions and normalized
coordinates. It calls the MGU runtime's `ctx.onTouch(...)` callback. This
requires the real `mgu-renderd` touch input path (and input gate) and must be
confirmed on the car. The iDrive button controls remain available.

Google's requirements say original GameSnacks games must work with touch and
mouse input, but forwarding these events to a real HTML5 game is contingent on
an approved offline bundle and a working MGU browser renderer. The current
preview **does not claim in-game touch playback is already implemented**.

## Why no original content is packaged yet

The games visible on `gamesnacks.com` are not automatically licensed for
copying into third-party applications or a public GitHub repository. Google's
`allowOfflineUse` developer property controls offline availability *inside*
GameSnacks partner distribution; it is **not** a grant to extract files from
the website. The partner API exposes hosted games, not freely redistributable
source archives. Only add game data after the holder grants the necessary
offline installation, adaptation and distribution rights.

Google's official game bundle format uses `game.json`, an HTML entrypoint and
relative code/data assets. Games use browser Canvas or WebGL. This BMW app
runs in the Node 8/OAP process and draws via `mgu-renderd`, not an HTML5
browser. The runtime needs to be validated on the real MGU first.

## First candidate review

See `REVIEW.md` for named publishers, sources and remaining checks. Best
starting points: Famobi's Smarty Bubbles and Train 2048, since Famobi
specifically offers licensing of HTML5 packages that may be hosted locally.
The specific license terms and pricing are **not yet obtained**. Do not fetch
game assets from the public gamesnacks.com web pages into this repository.

## Next technical test

With the car parked, access the head unit through the existing root SSH method
and run the **read-only** tool `tools/probe_mgu_web_runtime.sh` (copy it to the
head unit first). It only reports whether candidate browser or WebKit binaries
and libraries are present. A negative result is inconclusive; a positive
result does not by itself prove that HTML5 games can share the HMI framebuffer.

Once an authorized game bundle and a working local HTML renderer are available,
we can implement and verify its game-specific input adapter, audio, persistence,
FPS, full offline operation and park interlock. The preview refuses to claim
any game is playable until all of these gates are satisfied.

## Offline validation without BMW hardware

```sh
node tests/gamesnacks.test.js
python3 -c "import json,sys;sys.path.insert(0,'kit/tools');from build import build_ui;build_ui(json.load(open('apps/mgu_gamesnacks/app.json')))"
```
