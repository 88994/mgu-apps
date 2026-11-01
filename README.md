# mgu-apps
BMW MGU ID7 Apps

Eigene Apps für BMW MGU / iDrive 7, installierbar über den [MGU Store](https://github.com/robertnisipeanu/mgu-store).

## Apps

- **DPF Monitor 0.2.0** (`apps/dpf_monitor/`) – drei Seiten für Live-Werte, Regeneration und Historie. Experimentelle, standardmäßig deaktivierte UDS-Leseabfragen mit DPF-Kennungen aus der D83BX7C0-PRG; noch keine am Fahrzeug verifizierten Werte. Mit eigenem Icon (`icon.png`, 140 × 140) und SVG-Vorlage.

Die DID-Tabelle und den Prüfplan findest du unter [DPF-Monitor-DDE-Diagnose](apps/dpf_monitor/DDE_D83BX7C0.md). Der DDE-Lesetest muss in den App-Einstellungen ausdrücklich aktiviert werden; die Regenerationsanzeige bleibt bis zur Validierung unbekannt.

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
    <weitere-app-id>/
      app.json
      main.js
      icon.png
  kit/                 # Build-Werkzeuge, Runtime, Schriftsätze und Icons
  THIRD_PARTY_NOTICES.md
```

Die Datei `mgu-repo.json` erkennt automatisch jeden direkten Unterordner von `apps/` mit einer `app.json`. Neue Apps brauchen eine eindeutige `id` und `version` im Format `x.y.z`. Für Updates die Version erhöhen und auf `main` veröffentlichen.

## Build und Veröffentlichung

Der MGU Store folgt dem Branch `main`, stellt beim Headunit-Build das `oap-sdk` aus einer vorhandenen BMW-App bereit und führt `kit/tools/build.py` aus. Das Repository enthält die für englische App-Pakete benötigten Build-/Runtime-Dateien aus [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps), aber keine großen Tests oder zusätzlichen chinesischen Schrift-/Lokalisierungspakete. Ein echter Build auf der MGU wurde noch nicht durchgeführt. Renderer und Controller-Gate sind als Abhängigkeiten auf das mitgelieferte `idrive7-apps`-Repository des Stores eingetragen.

Das BMW-SDK (`oap-sdk/`), private SSH-Schlüssel, VIN-Dateien und Fahrzeug-Backups **nicht** hochladen.

## Store-Quelle

In **Settings → Add source** `NamelsMissing/mgu-apps` eingeben und `main` wählen. Das Repository ist derzeit privat; daher braucht der Store einen GitHub-Zugang mit Lesezugriff.
