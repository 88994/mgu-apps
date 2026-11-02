# MGU Store installation — main branch

1. In MGU Store add the GitHub source `NamelsMissing/mgu-apps` (authenticate if the repository is private).
2. Select **Branch → main**. Do not choose the historical `wheelheat-autostart-0.4.2-qa` branch.
3. Refresh the source and update `dpf_monitor` 0.2.4, `g21_ambient` 0.3.6 and `g21_wheelheat` 0.4.5.
4. WheelHeat's installed package already includes `mguAppStartType: autostart`; there is no separate USB patch or second source branch required.
5. Restart the MGU to test *process* autostart. Separately enable **Automatic heating on cold startup** in the app; the option resets to Off once on this upgrade.

Autostart may depend on the MGU's app platform and installed deploy version. Check the MGU Store installation log and WheelHeat app log to verify process startup after a real head-unit restart.

**Important:** Physical heating duration while driving is not guaranteed by process autostart. The current one-byte BDC command allows up to 255 seconds, and extending it still requires confirmed standstill. Only on-car validation can establish which alternate strategy is supported.

Offline checks (no BMW SDK):

```sh
node tests/g21_car_ui_smoke.test.js
node tests/wheelheat_live_gate.test.js
node tests/ambient_temporary_apply.test.js
node --test tests/ambient_ui.test.js tests/wheelheat_ui.test.js tests/controls.test.js
```
