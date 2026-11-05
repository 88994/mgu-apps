# MGU Video Hub 0.1.0 (experimental)

An independent BMW iDrive 7 / MGU video app in `NamelsMissing/mgu-apps`.
UI language: English. It never writes to vehicle control units.

## Features

- **Library** scans the app's own `data/videos` and readable USB media under
  `/media`, `/run/media`, `/mnt/usb` and `/mnt/media_rw` (read-only, up to 300 files).
  MP4, MOV, M4V, MKV, WebM and AVI are listed; actual codec support depends on ffmpeg.
- **Phone import**: temporary random QR token, port 18879, private-local-network
  clients only; uploads are streamed into `data/videos`. Files must be 256 MiB
  or less; the imported library is limited to 768 MiB. Existing files are not
  overwritten. Videos on USB are not copied.
- **YouTube**: send a public video URL using the phone page, keep saved IDs in
  `data/youtube.json`. Optional `yt-dlp` resolves one online stream per URL;
  optional `ffmpeg` decodes it live. It is not a YouTube download service.
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
provide a working Internet uplink. YouTube URLs and streams can change, so
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
4. Whether BMW Wi-Fi Direct/CarPlay makes port 18879 reachable from a phone.
   This is **not guaranteed** without a BMW hotspot. ENET or an uplink network
   may be needed for import.
5. Audio device routing, playback performance, and exact synchronization.

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

## Host tests

```sh
node tests/video_hub.test.js
python3 -c "import json,sys;sys.path.insert(0,'kit/tools');from build import build_ui;build_ui(json.load(open('apps/mgu_video_hub/app.json')))"
```
