# WheelHeat 0.4.2 autostart candidate — staging branch ONLY

This is the separate `wheelheat-autostart-0.4.2-qa` branch for the
future WheelHeat startup update. Do **not** select this branch in the car's
MGU Store source list until WheelHeat 0.4.1 on `main` has been tested.

## How it will work after approval

The Store's repository build entry `tools/build_store_app.py` uses the
existing BMW SDK builder and then writes
`"mguAppStartType": "autostart"` into the finished installable .tgz and
.mgu package metadata. The `mgu-deploy` manager uses this to launch the app
process when the MGU starts; no separate root boot patch is required.

The app ID remains `g21_wheelheat`, but the version is **0.4.2**.
Production `main` currently contains **0.4.1** with
`mguAppStartType: manually`. When its testing is successful, version 0.4.2
can be promoted to `main` as a proper update; it must not be published
there until then.

App process autostart does not turn on heating by itself. Comfort automation
and experimental ECU writes are disabled by default. Car-side writes are not
yet verified and must only be tested after confirming safe ECU behavior.

## Verify staged packaging

```sh
node --test tests/ambient_ui.test.js tests/controls.test.js tests/wheelheat_ui.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/build_store_app.py g21_wheelheat
```

Inspect `dist/g21_wheelheat@0.4.2.tgz` →
`package/package.json` → `mguAppStartType: autostart`.
