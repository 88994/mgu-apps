# mgu-apps
BMW MGU ID7 Apps

Eigene Apps für BMW MGU / iDrive 7, installierbar über den [MGU Store](https://github.com/robertnisipeanu/mgu-store).

## Apps

- **DPF Monitor 0.1.0** (`apps/dpf_monitor/`) – drei Seiten für Live-Werte, Regeneration und Historie. Aktuell noch Demo-/Platzhalterwerte; keine verifizierten DDE-DPF-Daten. Eigenes `icon.png` (140 × 140) und editierbare SVG-Vorlage sind enthalten.

## Verzeichnisstruktur

```text
mgu-apps/
  mgu-repo.json
  apps/
    dpf_monitor/
      app.json
      main.js
      README.md
      icon.png
      icon.svg
    <weitere-app-id>/
      app.json
      main.js
      icon.png
  kit/              # Noch einzubinden: Runtime/Build-Werkzeuge aus idrive7-apps
```

`mgu-repo.json` erkennt automatisch jeden direkten Unterordner von `apps/` mit `app.json`. Jede App benötigt eine eindeutige `id` und `version` in `x.y.z`. Für Updates `version` erhöhen und auf `main` veröffentlichen.

## Fehlender Schritt vor Store-Installation

Die App-Quellen sind hochgeladen. **Der Build aus diesem Repository ist noch nicht ausführbar**, weil `kit/` fehlt. Die benötigten Runtime- und Build-Dateien müssen aus [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) unter Beachtung der Lizenzen ergänzt und der Build getestet werden.

Keine privaten SSH-Schlüssel, VIN-Dateien, Fahrzeug-Backups oder das aus der BMW-Headunit extrahierte `oap-sdk/` hochladen.

## Als Quelle hinzufügen

Im MGU Store **Settings → Add source**: `NamelsMissing/mgu-apps`, Branch `main`. Das Repository ist privat und erfordert GitHub-Zugriff im Store.
