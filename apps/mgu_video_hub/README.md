# MGU Video Hub 0.1.3 (experimental)

An independent BMW iDrive 7 / MGU video app in `NamelsMissing/mgu-apps`.
UI language: English. It never writes to vehicle control units.

## Features

- **Library** scans the app's own `data/videos` and readable USB media under
  `/media`, `/run/media`, `/mnt/usb` and `/mnt/media_rw` (read-only, up to 300 files).
  MP4, MOV, M4V, MKV, WebM and AVI are listed; actual codec support depends on ffmpeg.
- **Phone import**: temporary random QR token, port 18879, private-local-network
  clients only; uploads are streamed into `data/videos`. Files must be 256 MiB
  or less; the imported library is limited to 768 MiB. Existing files are not
  overwritten. Videos on USB are not copied. The `mgu-video-net` root helper
  opens TCP 18879 only on BMW's `wlan_bridge` while the application HTTP server
  answers its local health probe, and removes its own rule when the app stops.
- **YouTube**: send a public video URL using the phone page, keep saved IDs in
  `data/youtube.json`. Optional `yt-dlp` resolves one online stream per URL;
  optional `ffmpeg` decodes it live. It is not a YouTube download service.
- **MGU Store tethering**: the installed app package requests `mguInternet: true`
  so `mgu-uplink` can route the OAP app UID. Its Connection screen distinguishes
  an offline Store uplink from a Store that is online but has not routed the app.
  A private HTTPS CONNECT proxy resolves through the per-app Store lease DNS;
  yt-dlp uses an authenticated proxy, and FFmpeg uses a separate loopback-only
  CDN proxy restricted to `*.googlevideo.com:443` because FFmpeg does not send
  HTTP proxy authentication headers in the tested version. Neither proxy
  exposes a listening port on the car's Wi-Fi interfaces.
- **Player**: video over mgu-render's protocol v4 (I420 frames in a 3-slot
  `/dev/shm/mgu-video-*` ring); pause/resume, 15-second seek, stop. Touch
  targets and iDrive navigation are provided by the shared MGU kit.
- **Safety**: start is blocked without a fresh valid speed signal at or below
  0.5 km/h. Playback stops if the signal goes stale, speed rises, or the app
  leaves the main page. Parked use only.

## Important requirements / what has not been verified

The OAP Node 8 application runtime itself **cannot decode video**. The app
needs a compatible **`ffmpeg` executable on the head unit**, accessible to the
app's unprivileged user; it does not install, download or modify system codecs.
The renderer must report native `video` capability (`mgu-renderd` / mgu-render
protocol v4). Without these, the app still opens its library and connection
page, but actual video playback is explicitly disabled.

For YouTube, also install/configure `yt-dlp` in the MGU's app environment and
provide a working Internet uplink. **MGU Store Internet access alone does not
install `yt-dlp`, `ffmpeg` or the JavaScript engine required by recent yt-dlp
releases.** YouTube URLs and streams can change, so
playback is best-effort and may be unavailable. An official YouTube iframe
cannot run inside this OAP renderer because it is **not a web browser**.
Use the service according to YouTube's terms and rights applicable to the video.

Sound is **off by default**. The Settings option "ALSA" tries to pipe audio
from ffmpeg into `aplay`; this is an experiment, not verified BMW audio routing.
Do not assume sound works until tested on the real MGU. Decoder resolution
defaults to 640×360 at 15 fps to reduce CPU demand.

The following must be checked on the actual vehicle:

1. Whether `ffmpeg`, `yt-dlp`, and optionally `aplay` exist and execute as the
   OAP application user. Do not use an untrusted executable.
2. Whether the video renderer capability is present on the installed version.
3. Whether USB mounts are readable from the OAP app sandbox, and where they
   appear. If hidden, transfer to the app-private `data/videos` folder.
4. Video Hub must show **READY - Wi-Fi port 18879 open** before its private QR
   is displayed. The companion's `listen()` alone does not open BMW's INPUT
   firewall. `mgu-video-net` manages a *separate*, tagged `nftables` rule in
   `ip filter input`; it never removes Phone Terminal's rule for port 18890.
   The phone must still be connected over reachable BMW CarPlay Wi-Fi Direct.
5. Audio device routing, playback performance, and exact synchronization.

### MGU Store Internet / tethering (0.1.3)

1. Ensure the Store's **mgu-uplink** is installed. For Wi-Fi tethering, open
   **MGU Store → Settings → Wi-Fi** and connect to the phone's personal hotspot;
   alternatively connect an unlocked iPhone via USB with Personal Hotspot on
   (accept the phone's Trust dialog), or use a supported USB tether/network
   adapter. The Store should show **Online**.
2. Update **MGU Video Hub to 0.1.3** *after* the MGU Store uplink is installed.
   mgu-deploy then registers `mgu_video_hub` in the uplink's `apps.d` list.
   Reinstallation matters: simply changing `app.json` without rebuilding and
   installing the package does not grant Internet access.
3. Check Video Hub → **Connection** → **MGU Store Internet**. `ROUTED - DNS
   proxy ready` means this app's own uplink lease and local DNS proxy exist.
   It does **not** guarantee YouTube is reachable or that the missing video
   binaries are installed. `Store online - app not routed` means the Store has
   a link but this app has no per-app lease; check its registration/reinstall.

The MGU shell's `curl https://www.youtube.com` may still fail even when the
app is routed because the head unit's global resolver is `127.0.0.1` and
root is not automatically an uplink-approved app UID. **Do not change** the
stock global route or `/etc/resolv.conf` for this feature.

Read-only diagnostics from Phone Terminal:

```sh
ls -l /run/mgu-uplink/lease.json /var/opt/mgu-uplink/apps.d/mgu_video_hub
find /var/opt/public/oap -type f -name uplink.json 2>/dev/null
```

The app's package must contain `"mguInternet": true` at the top level of its
installed `package.json`, which the build script copies from `app.json`.

This is a functional app codebase with an unverified HU-dependent decoder and
audio path. No BMW proprietary SDK, copyrighted videos or ffmpeg binary are
included. The MGU Store must build it with the locally extracted `oap-sdk`.

## Build

Install the standard `oap-sdk` into the checkout root on your own PC, or let
MGU Store build against its local SDK on the head unit. From the repository:

```sh
python3 tools/build_store_app.py mgu_video_hub
```

The generated source package is a normal separate Store app, not part of
GameStation. `mgu-repo.json` contains its own version, dependency and build
entry; updates to this app need a version bump.

### Wi-Fi phone-import setup (0.1.2)

Install/update **Video Hub** and its required **Video Hub Network Bridge**
(`mgu-video-net` 0.1.0) from the `main` branch of this repo in MGU Store.
This is a systemd root helper installed separately from the unprivileged OAP
app; no standalone manual `nft` commands or global BMW firewall changes are
necessary. It probes `127.0.0.1:18879/.mgu-video-health` (loopback only),
restores the fixed `wlan_bridge` TCP 18879 accept rule after BMW firewall
reloads, and removes it when Video Hub's HTTP server is no longer listening.
The helper exposes only non-sensitive readiness information on
`127.0.0.1:18979/status`, which the app polls to decide whether to show its QR.
The random QR token is still required by every phone upload/YouTube endpoint.
The bridge's readiness indicates firewall setup succeeded, **not** that a
specific phone has completed an end-to-end connection test.

To diagnose on the MGU via SSH:

```sh
systemctl status mgu-video-net.service
curl -s http://127.0.0.1:18979/status
curl -i http://127.0.0.1:18879/
```

An unauthenticated `/` request returning `403 Invalid pairing token` proves
the local Video Hub HTTP service is listening. Do not publish your QR token.

## Host tests

```sh
node tests/video_hub.test.js
node tests/video_hub_network.test.js
node tests/video_hub_uplink.test.js
python3 -c "import json,sys;sys.path.insert(0,'kit/tools');from build import build_ui;build_ui(json.load(open('apps/mgu_video_hub/app.json')))"
```

## Audio EQ (0.1.1)

ALSA audio now goes through the shared `mgu-equalizer-dsp` 0.2.0 PCM service
before `aplay`. Install the updated Store dependency. The **Audio EQ** menu
opens an in-app sheet for band gain and DSP/bypass changes during playback.
It retains the existing stop-on-leave, focus and vehicle-movement rules.
When the service is missing or stops responding, the stream falls back to
unchanged PCM; it does not claim active filtering. ALSA output into the car
still needs a compatible real MGU route. Stock CarPlay/radio are not connected
to this DSP. See [Equalizer DSP](../equalizer/README.md).
