# mgu-apps
BMW MGU ID7 Apps

Eigene Apps für BMW MGU / iDrive 7, installierbar über den [MGU Store](https://github.com/robertnisipeanu/mgu-store).

## Verzeichnisstruktur

```text
mgu-apps/
  mgu-repo.json
  apps/
    <app-id>/
      app.json
      main.js
      icon.png       # optional
  kit/              # Runtime und Build-Werkzeuge aus idrive7-apps
```

`mgu-repo.json` erkennt automatisch jeden direkten Unterordner von `apps/` mit `app.json`. Jede App braucht eine eindeutige ID und eine `version` im Format `x.y.z`. Für Updates die Version erhöhen und den Commit auf `main` veröffentlichen.

## Noch einzurichten

- Den aktuellen `dpf_monitor`-Quellcode mit allen Hilfsdateien und Assets unter `apps/` hinzufügen.
- Die benötigten `kit/`-Dateien aus [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) unter Beachtung ihrer Lizenzen übernehmen.
- Den Build im Emulator und auf der Headunit prüfen.

Keine privaten SSH-Schlüssel, VIN-Dateien, Fahrzeug-Backups oder das aus der BMW-Headunit extrahierte `oap-sdk/` hochladen.

## Im Store hinzufügen

Unter **Settings → Add source** `NamelsMissing/mgu-apps` eingeben und Branch `main` wählen. Das Repository ist derzeit privat und erfordert im Store einen GitHub-Zugang mit Lesezugriff.
