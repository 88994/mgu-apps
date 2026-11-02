# MGU Store: staged WheelHeat startup rollout

## Production source (first vehicle test)

In MGU Store, add `NamelsMissing/mgu-apps` and follow the **main** branch.
The private repository needs GitHub authentication and a compatible
`mgu-deploy` installation. Main currently advertises:

- DPF Monitor **0.2.1** (unchanged)
- G21 Ambient **0.3.3** (unchanged)
- G21 Heating Comfort / WheelHeat **0.4.1 (manually)**

Install WheelHeat 0.4.1 and verify its UI, settings and offline diagnostics on
the MGU. **It does not start automatically after an MGU restart.** The Store
runs `tools/build_store_app.py`, which uses the BMW SDK builder and then adds
`"mguAppStartType": "manually"` to the actual .tgz and .mgu package metadata.

## Autostart candidate (NOT released to the Store's main branch)

The separate GitHub branch `wheelheat-autostart-0.4.2-qa` holds WheelHeat
**0.4.2**. Its actual install archives are built with
`"mguAppStartType": "autostart"`. Do not add that branch as a Store source
until the manual-install test has succeeded.

After confirmation, promote 0.4.2 to `main`. Because the app keeps its stable
ID `g21_wheelheat` and has a higher version, MGU Store can recognize it as
an **update** of the installed 0.4.1, rather than a competing duplicate.
No additional boot script or separate root patch is needed when the installed
`mgu-deploy` supports this native start mode.

Both variants keep `Comfort automation PREVIEW` and
`Experimental ECU writes` OFF by default. App process autostart does not
mean the car's heaters turn on automatically. Actual ECU write commands are
not validated on this vehicle; test safely while stationary.

## Offline tests and inspection

```sh
node --test tests/ambient_ui.test.js tests/controls.test.js tests/wheelheat_ui.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/build_store_app.py g21_wheelheat
```

Verify `dist/g21_wheelheat@0.4.1.tgz` contains
`package/package.json` with `mguAppStartType: manually`.
A real MGU SDK build and head-unit boot check are still required.
