# MGU Store installation and WheelHeat startup

This repository is designed for the **iDrive 7 MGU Store** source-repository
workflow. The Store must have access to the repository and a compatible
`mgu-deploy` installer. A private GitHub repository is not anonymously
downloadable by the head unit.

## Add the source

1. Open the MGU Store and add the source `NamelsMissing/mgu-apps`, branch `main`.
2. Refresh the catalog. The source advertises the manifests in `apps/*/app.json`:
   - DPF Monitor 0.2.1
   - G21 Ambient 0.3.3
   - G21 Heating Comfort (WheelHeat) 0.4.0
3. Install each app from the Store. A *source-repository* installation builds
   the package on the head unit using `mgu-repo.json` and the available BMW
   SDK donor (`oap-sdk`). The Store must be able to obtain those dependencies.

## How WheelHeat autostart is installed

`mgu-repo.json` uses `tools/build_store_app.py` for each app. The dispatcher
invokes the SDK's `kit/tools/build.py` unchanged. **Only for** `g21_wheelheat`,
`tools/build_wheelheat_autostart.py` additionally updates the generated
`dist/g21_wheelheat/source/package.json` and rebuilds both install archives.
Their package metadata then contains:

```json
"mguAppStartType": "autostart"
```

The `mgu-deploy` app manager supports this value and starts the installed app
with the platform, including after reboots. **No separate root startup script,
systemd service, CAFD patch or manual SSH action is involved.** A normal
`app.json` field by itself would not work because the stock SDK builder does
not propagate this field to `package.json`.

Autostart starts the **application process**; it does **not** switch on heating
automatically. The app ships with `Comfort automation PREVIEW` disabled and
`Experimental ECU writes` disabled. Real vehicle ECU writes are unverified;
test only with the vehicle stationary, after checking the requested commands
against the target ECU and explicitly enabling the relevant settings.

## Development checks

```sh
node --test tests/ambient_ui.test.js tests/controls.test.js tests/wheelheat_ui.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
```

The unit tests verify app logic and the autostart *package metadata*, not an
actual installation or the behavior of a running vehicle. For a local build
with your own SDK, use:

```sh
python3 tools/build_store_app.py g21_wheelheat
```

Check `dist/g21_wheelheat@0.4.0.tgz` for
`package/package.json → mguAppStartType: autostart` before transferring it.

To undo automatic app startup, uninstall WheelHeat in the Store or rebuild
and reinstall the app with `--start-type manually` using the optional offline
helper. Switching off the app's comfort automation is a separate setting.
