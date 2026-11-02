# mgu-apps
BMW MGU ID7 Apps

Eigene Apps für BMW MGU / iDrive 7, installierbar über den [MGU Store](https://github.com/robertnisipeanu/mgu-store).

## Apps

- **DPF Monitor 0.2.1** (`apps/dpf_monitor/`) – drei Seiten für Live-Werte, Regeneration und Historie. Experimentelle, standardmäßig deaktivierte UDS-Leseabfragen mit DPF-Kennungen aus der D83BX7C0-PRG; noch keine am Fahrzeug verifizierten Werte. Mit eigenem Icon (`icon.png`, 140 × 140) und SVG-Vorlage.

- **G21 Ambient 0.3.3** (`apps/g21_ambient/`) – ambient lighting colour picker with synchronized RGB/HSV and brightness; safe preview of custom iDrive colour slot 11, no automatic FDL coding.
- **G21 Heating Comfort 0.4.1** (`apps/g21_wheelheat/`) – steering-wheel/seat heating control preview, adjustable temperature threshold and duration, explicit manual startup for the first MGU Store test. ECU writes remain opt-in and are unverified on-car.

Die geprüfte DID-Tabelle und den Prüfplan findest du unter [DPF-Monitor-DDE-Diagnose](apps/dpf_monitor/DDE_D83BX7C0.md). Der DDE-Lesetest muss in den App-Einstellungen ausdrücklich aktiviert werden; die Regenerationsanzeige bleibt bis zur Validierung unbekannt.

## Aufbau

```text
mgu-apps/
  mgu-repo.json
  apps/
    dpf_monitor/
      app.json
      main.js
      dpf-dids.js
      DDE_D83BX7C0.md
      README.md
      icon.png
      icon.svg
    g21_ambient/
      app.json, main.js, logic.js, safe_diag.js, icon.png
    g21_wheelheat/
      app.json, main.js, logic.js, safe_diag.js, comfort_auto.js, icon.png
    <weitere-app-id>/
      app.json
      main.js
      icon.png
  kit/                 # Build-Werkzeuge, Runtime, Schriftsätze und Icons
  THIRD_PARTY_NOTICES.md
```

Die Datei `mgu-repo.json` erkennt automatisch jeden direkten Unterordner von `apps/` mit einer `app.json`. Neue Apps brauchen eine eindeutige `id` und `version` im Format `x.y.z`. Für Updates die Version erhöhen und auf `main` veröffentlichen.

## Build und Veröffentlichung

Der MGU Store folgt dem Branch `main`, stellt beim Headunit-Build das `oap-sdk` aus einer vorhandenen BMW-App bereit und führt `tools/build_store_app.py` aus. Dieses ruft den regulären SDK-Builder auf und übernimmt bei WheelHeat den in `app.json` ausgewählten Starttyp (`manually` auf `main`); die beiden anderen Apps werden unverändert gebaut. Das Repository enthält die für englische App-Pakete benötigten Build-/Runtime-Dateien aus [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps), aber keine großen Tests oder zusätzlichen chinesischen Schrift-/Lokalisierungspakete. Ein echter Build auf der MGU wurde noch nicht durchgeführt. Renderer und Controller-Gate sind als Abhängigkeiten auf das mitgelieferte `idrive7-apps`-Repository des Stores eingetragen.

Das BMW-SDK (`oap-sdk/`), private SSH-Schlüssel, VIN-Dateien und Fahrzeug-Backups **nicht** hochladen.

## Store-Quelle

In **Settings → Add source** `NamelsMissing/mgu-apps` eingeben und `main` wählen. Das Repository ist derzeit privat; daher braucht der Store einen GitHub-Zugang mit Lesezugriff.

Offline DPF decoder test: `node tests/dpf-monitor-dids.test.js` (no car connection or BMW SDK required). The DPF app UI is English-only in 0.2.1.

## WheelHeat-Autostart und Sicherheit

**Erst die manuell gestartete Version testen:** `main` enthält WheelHeat **0.4.1** mit `mguAppStartType: manually`. Sie wird nicht automatisch beim MGU-Start gestartet. Die vorbereitete **0.4.2** mit `autostart` bleibt ausschließlich im Branch [`wheelheat-autostart-0.4.2-qa`](../../tree/wheelheat-autostart-0.4.2-qa), bis der Test bestätigt wurde. Anschließend wird die 0.4.2 nach `main` übernommen; der Store erkennt sie als Update. Es werden weder ein Root-Dienst noch Fahrzeugcodierungen installiert. **Das automatische Einschalten der Heizungen ist standardmäßig deaktiviert** (`Comfort automation PREVIEW = off`, `Experimental ECU writes = off`). Die Autofunktion und reale Schreibwerte wurden nur offline geprüft, nicht im Fahrzeug validiert.

Installationsablauf, Rückbau und Tests: [STORE_INSTALLATION.md](STORE_INSTALLATION.md).
