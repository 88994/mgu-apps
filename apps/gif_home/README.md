# GIF Home (BMW MGU / iDrive 7)

Offline animated GIF widget for the **large** home-screen tile, using the stock
`startWidget` interface of the [idrive7-apps kit](https://github.com/cauliflowermossgrape/idrive7-apps).
The BMW navigation app and its map data are **not** modified or patched.

## How it works

- Select **GIF Home** as the large home-screen widget instead of the navigation map.
- The original navigation remains accessible and can be selected again at any time.
- An animated BMW-style roundel GIF is bundled as the standard animation.
- Open **GIF Home > Phone upload**: the MGU generates a QR code. Scan it with
  the iPhone camera, open the displayed local web page, choose a GIF, and upload.
  The upload is immediately active and survives a restart of the app/head unit.
- **Next IP** cycles the MGU's available IPv4 interfaces when more than one
  is present. If the first address does not connect, try the next one.
- Set **Animation** to **Custom if available** (default) or **Custom GIF only**.
- **Picture fit**: Fill/crop edges or show the whole picture with letterboxing.
- **Animation speed**, pause, and widget refresh (1–6 fps) are adjustable.
- A small widget shows a text label instead of an animated image because BMW's
  Drive Recorder template was observed not to display its image in small widgets.

### Phone connection

The app starts a short-lived HTTP upload session on port `18883` only after you
press **Phone upload**. The QR code contains a random, 128-bit one-time token;
it is valid for at most 10 minutes and becomes invalid after a successful GIF
upload. Upload size and decoded dimensions/frame count are bounded. There is no
cloud service and the GIF stays on the head unit.

The iPhone must be able to reach the **MGU's displayed IPv4 address** on that
port. CarPlay Wi-Fi Direct alone does **not** guarantee that Safari can access
the head unit's local HTTP server: this depends on the firmware and Wi-Fi
interface/firewall. The QR and local server have been tested in the PC emulator,
but **iPhone-to-MGU connectivity still needs to be tested on the car**.

For troubleshooting or fallback, you can still copy a GIF manually over SSH/SFTP
to the persistent app data directory under the name `custom.gif`, then restart
the app. Manual transfer is not required if phone upload works.

### GIF limits

- GIF87a/GIF89a, including palette, transparent pixels, disposal methods 2/3,
  and interlacing; file at most **6 MB**, resolution at most **640 × 360**.
- At most **90 frames**, and no more than **32 MiB** of fully decoded frames.
- GIF frame delays shorter than 80 ms are clamped for predictable CPU usage.
- The widget refresh is deliberately capped at 6 fps. Some frames of a fast GIF
  can be skipped, but playback follows wall-clock time and loops continuously.

For best results, supply a short **384 × 256** GIF at **4–6 fps** with large,
high-contrast details. Preview rendering and widget rendering are separate;
the widget uses ordinary HMI PNG image updates, not the GPU overlay.

## Build

This app lives at `apps/gif_home/` in
[`NamelsMissing/mgu-apps`](https://github.com/NamelsMissing/mgu-apps) on `main`.
MGU Store can discover it through the repository's `mgu-repo.json` and invoke
`python3 tools/build_store_app.py gif_home` on the head unit using its local SDK.

For local development, the app also supports the upstream `idrive7-apps` kit:

```bash
# Without the BMW SDK: validate and preview, but this is not installable
python3 kit/tools/build.py --preview-only gif_home
node kit/tools/preview.js dist/gif_home preview-gif-home render

# After adding the BMW SDK extracted from your own MGU at oap-sdk/
python3 kit/tools/build.py gif_home
```

The installable package is `dist/gif_home@0.2.0.mgu` only when the SDK is
available. The SDK and built packages are deliberately not committed to GitHub.

### Data path

The runtime uses `ctx.dataDir` from the kit; the installed `custom.gif` file
must be placed **there**, not in `rhmiData` or `oap-sdk`.
The app logs its exact resolved path on startup (`GIF Home ready; custom GIF:`).
It never modifies existing BMW navigation files or sends vehicle-control signals.

The included `qr_vendor.js` is Kazuhiko Arase's QR Code Generator (MIT license,
copyright 2009; see `LICENSE`). The bundled BMW-style roundel is an unofficial
personal-use depiction, not an official BMW application or product.

### Firmware compatibility

The widget uses `LT_Table_OnlineApps_DriveRecorderWidget` with image cell
`BackgroundImage1`, as demonstrated by the kit's `edrive` widget. This is
reported to work on some BMW MGU firmwares, **not yet verified on a G21 06/2021**.
If `GIF Home` is missing from the home-screen widget chooser, or the image
doesn't appear in the large slot, inspect HMI/widget logs before changing
the widget layout. Do not patch or overwrite the original navigation widget.

**Safety:** Animated content can distract the driver. Use while parked and
respect applicable display restrictions while driving.
