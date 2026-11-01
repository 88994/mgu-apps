# DPF Monitor 0.1.0

This app is a read-only, three-page visual foundation for a BMW B47 DPF monitor using
the `cauliflowermossgrape/idrive7-apps` kit. Its Live, Regeneration and History
screens follow the supplied design reference. It does not send DDE diagnostic requests.

**Real data:** no DPF measurements are currently connected. The CBS particle-filter
service notification is subscribed for later integration but does not represent soot,
regeneration state or a recorded regeneration.

**Unavailable in live mode:** soot mass, differential pressure, exhaust temperature,
distance since last regeneration, requested/active regeneration and regeneration
history. Numeric values appear as `--`; the status reads `Unbekannt`; history
shows no verified events until DDE identifiers, reply formats and scaling are verified.

**Demo:** Settings > Simulated DPF data > On. The sample values and history entries
are invented for layout testing and the screen always shows `DEMO` in this mode.
Demo is Off by default. No regeneration can be initiated from this app.

## Add to the kit and test on a Windows PC

Copy this `dpf_monitor` folder under `idrive7-apps-main\apps\`. Keep the
previously extracted `oap-sdk\` folder at the root of that kit. Copy your
`someip-interfaces.json` to `idrive7-apps-main\reference\someip-interfaces.json`.

From PowerShell at the kit root:

```powershell
py .\kit\tools\check_signals.py
py .\kit\tools\build.py dpf_monitor
node .\kit\tools\emu.js dpf_monitor
```

Open `http://localhost:8077/` on the same PC. In the app's settings turn
`Simulated DPF data` On. Check Live, Regeneration and History with the
`Next page` button. Turn the setting Off to check that unverified DPF
metrics return to `--` and History reports no verified entries.
The emulator has no live car data.

On Windows, if `emu.js` fails with `listen EACCES` on a `.sock` path,
change its `const SOCK` definition to a Windows named pipe, e.g.
`process.platform === 'win32' ? '\\\\.\\pipe\\mgu-emu-' + process.pid :
path.join(os.tmpdir(), 'mgu-emu-' + process.pid + '.sock')`.

To produce static PNG frames instead of the interactive emulator:

```powershell
node .\kit\tools\preview.js .\dist\dpf_monitor .\preview\dpf_monitor --set demo=on render BTN_PAGE render
```

The build output under `dist\` includes BMW's SDK. Keep it local; do not
publish it. This app source folder alone has no SDK or private key.
