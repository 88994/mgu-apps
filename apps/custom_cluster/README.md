# Custom Cluster 0.2.0 — BMW G21 / MGU iDrive 7

**Experimental. Not validated on a real car. No authorization for driving with a replaced speedometer.**

G80-inspired complete instrument **panel** (1920 × 720), three optional centre-map overlays, stock mode, and switchable Waze map. Developed for a 2021 BMW G21 318d with iDrive 7 MGU and KOMBSP18; the G80 appearance is an original interpretation, not a copy of BMW's instrument resources. The 318d engine scale remains 0–5000 rpm (not the M3's redline).

## Modes

| Layout | KOMBI output | Waze |
| --- | --- | --- |
| **BMW stock** (default) | No custom gauge layer | Normal Waze on Cluster, or the Waze preference selected here |
| **G80 full cluster** | Entire `panel` slot, **only when manually armed at standstill with the selector at P**, max. 12 seconds | Centre region has a transparent window when Waze map is on/auto; panel+map combination needs a real-car test |
| M Sport / Classic / Minimal | Overlay in `map` slot, beneath original BMW dials | Can be composited with Waze's map |

G80 mode **does not immediately replace the OEM cluster upon selection**. It always opens with the original BMW display. The iDrive main screen shows a G80 design preview; it is not cluster output. To test the real `panel`, select G80, have genuine SOME/IP speed and engine rpm data, be in **P** with speed under 0.5 km/h, and press **Parked panel test**. Press the button again to stop. The layer is also dropped on departure from P, speed movement, missing data, layout change, app exit or after 12 seconds. Demo values cannot activate a panel. No persistent armed flag, no autostart of the full panel.

The panel is layered **above the BMW gauge graphics and below the BMW telltales** according to `cluster-render`'s upstream mapping. **This layering does not establish functional safety**: warning visibility, render order, startup/shutdown, faults, renderer loss, map coexistence and speedometer readability need car-specific validation. Do not use the experimental G80 full panel while driving. The system may additionally hold the panel scene for up to 3 seconds after a drop (`panel_linger_ms`).

## Shared renderer and Waze

Custom Cluster talks to the *installed* `cluster-render` service from `robertnisipeanu/idrive-apps`. It **does not install another renderer**, modify `/usr/bin/carplay`, activate Waze patches, or flash/FDL-code KOMBSP18. Waze on Cluster remains a separate app; it can be turned off in its UI while retaining the shared service (if the Store dependency manager leaves it installed). Avoid uninstalling the service on which Custom Cluster depends.

The **Waze map in cluster** setting has three choices:

* **Auto (default):** leave Waze on Cluster's current map selection alone. The G80 design reserves its central opening for a possible live Waze stream.
* **Show:** send `{"cmd":"cluster","on":"1"}` to the existing Waze render socket and `{"cmd":"cluster","on":1}` to its patch daemon socket.
* **Hide:** send the corresponding `0` settings; HUD settings remain unchanged.

Both sockets must be accessible. The app reports the **request**, not confirmation, and a different Waze app instance may later change the same preference. No Waze feed is created unless the original tool's streaming and patch prerequisites already work. `Auto` after `Hide` does **not** roll back Hide; change the setting in Waze on Cluster or choose Show.

The Waze render socket is `/dev/shm/waze-on-cluster/ctl.sock`; the patch daemon socket is `/dev/shm/waze-on-cluster/patch.sock`. Those are upstream internal protocols and should be retested when updating the Waze app. The panel and HUD **reuse scene ID `0x01000400` and cannot both be requested at once**. If Waze is sending a HUD feed, disable it in the original Waze app before a parked G80 panel test; Custom Cluster does **not** change the HUD feed by itself. Rendering `panel` and `map` simultaneously is marked **CAR-ONLY / not verified** in upstream `cluster-render` documentation. The opening in the G80 shader is a transparency window, not proof that Waze will appear there.

## iPhone status badge

Optional Shortcuts bridge from v0.1.0 remains. It accepts authenticated, locally scoped `opened`/`closed` events from iPhone Shortcuts and shows a small neutral dot while a recent `opened` event exists. **It cannot verify that Blitzer.de remains active in the background**, and it sends no radar-warning data. Configure the Shortcuts app-open and app-close events using the generated bridge URLs on the iDrive screen. A CarPlay Wi-Fi link does not guarantee that the phone can reach the head unit's HTTP server. Background presence / speed-camera warnings are **not integrated**. Warning functions are restricted for drivers in Germany under § 23(1c) StVO.

## Build and deployment

1. Ensure your existing `cluster-render` native service is installed from the Waze on Cluster ecosystem, and check the target configuration and status before any parked test.
2. Add `apps/custom_cluster` to the `idrive7-apps` kit repository; the compatible SDK from your MGU is required to build.
3. Build: `python3 kit/tools/build.py custom_cluster`.
4. Install `dist/custom_cluster@0.2.0.mgu` by your trusted MGU installer or publish the source through your own MGU Store repository. The app has **not** been uploaded to GitHub by this process.
5. Start in **BMW stock**. Only use the G80 **iDrive preview** until you can safely validate the renderer with the stationary car and reliable diagnostics.

No `cluster-render` dependency is automatically installed by the app. Your Store manifest should explicitly keep the dependency; otherwise installation of the standalone MGU package alone will only show the iDrive preview.

## Technical design

* `g80_panel_shader.js`: 1920 × 720 GLSL ES 1.00, full background, live speed/rpm, gear P and optional transparent centre opening; neutral dot.
* `cluster_layers.js`: one renderer client; own refs for `map`, `panel`, phone badge; strictly guarded panel test; no demo data on KOMBI.
* `waze_control.js`: optional one-shot requests to original Waze sockets; no root commands, patch install/revert, or HUD edits.
* `g80_preview.js`: iDrive-only canvas design, synthetic graphic centre map as a **mockup** (not a live Waze map).
* `phone_bridge.js`: Shortcuts event bridge, expiring status.
* `cluster_render_client.js`: upstream `cluster-render` client (MPL-2.0) by Robert Nisipeanu, see `NOTICE` / `LICENSE`.

Validation: built against extracted OAP SDK 24.10.2 (`x_call@4.25.3` donor), JS syntax and mocked unit tests passed, HMI preview rendered on PC. **Unvalidated**: GLSL compilation and output on the real cluster GPU, concurrent panel/Waze/HUD behaviour, warnings, phone-to-MGU Wi-Fi, socket authorization and actual MGU Store install. Test with a full diagnostic log. A cluster that looks normal during a short stationary test is not sufficient to approve driving.
