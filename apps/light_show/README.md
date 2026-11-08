# Light Show 0.1.0

Stroboskop-App für BMW MGU iDrive 7, angelehnt an das Reel von bmwneva:
https://www.instagram.com/reel/DfR0l0HxKNS/

Eigenständiger Nachbau der Funktion, kein Originalcode aus dem Reel.

## Installation

Direkt aus GitHub: Im MGU Store die Quelle `NamelsMissing/mgu-apps`, Kanal **main**, aktualisieren und **Light Show** installieren.

Voraussetzung ist ein bereits eingerichteter MGU Store auf der MGU ID7.

1. `LightShow_ID7_v0.1.0.zip` entpacken.
2. Den enthaltenen Ordner `mgu-repo` auf die oberste Ebene eines USB-Sticks kopieren.
3. Stick im Auto einstecken, im **MGU Store > USB > Light Show** installieren.
4. App öffnen, Zündung einschalten, **P** wählen und **Check BDC connection** drücken.
5. Zuerst **Preview on screen** ansehen. **Start vehicle lights** steuert die Fahrzeugleuchten an.
6. **STOP / return lights to vehicle** beendet die Show und fordert die Rückgabe an das Fahrzeug an.

Der USB-Katalog enthält bereits das fertige Paket und dessen Prüfsumme. Es ist kein
Build und kein Internetzugang im Auto erforderlich. Das Paket verwendet das SDK der
Headunit. Der vorhandene Store muss Pakete aus einem USB-Katalog unterstützen.

Die App installiert keinen Hintergrunddienst und startet keine Show beim Booten.
Das native Menü funktioniert ohne GPU-Renderer; die Vorschau hat einen Software-Fallback.

## Funktionen

- Natives iDrive-Menü mit Touch- und Controller-Bedienung.
- Links/rechts abwechselnd, Doppelblitz, Dreifachblitz, beide zusammen,
  Kreuzimpuls und links/beide/rechts.
- Lichtpaar: Fernlicht, Tagfahrlicht, Positionslicht oder Nebelscheinwerfer vorn.
- Mindestzeit pro Musterschritt: 100 / 150 / 200 / 300 / 500 ms.
- Automatisches Ende nach 5 / 15 / 30 / 60 Sekunden.
- Separate, klar beschriftete Bildschirmvorschau ohne Lichtbefehle.
- Stop bei Verlust von P, Bewegung, fehlender aktueller Geschwindigkeit,
  Verbindungsverlust, Verlassen der App oder Änderung der Einstellungen.
- Diagnoseansicht und Export von `light-show-diagnostics.json` im App-Datenordner.

Die Diagnoseantworten bestimmen das tatsächlich erreichbare Tempo. Die App wartet
auf jede Antwort, überspringt keine Fehler und holt verspätete Schritte nicht mit
einem Befehlsstoß nach. Links und rechts werden nacheinander gesetzt, deshalb sind
gleichzeitige Blitze nicht taktgenau synchron. Die Diagnose zeigt die gemessene Schrittzeit.

## Kompatibilität und tatsächlicher Teststand

**Experimentell: Es fand noch kein Test der physischen Leuchten im Fahrzeug statt.**

Implementiert für BDC_G05, Diagnoseadresse `0x40`, SGBD-Index `0F2680`.
Andere Varianten werden nach dem Auslesen ihrer Identität abgewiesen. Dass das
Fahrzeug ein G21 ist, ersetzt diese Prüfung nicht. Nebelscheinwerfer müssen verbaut sein.
Die tatsächliche Reaktion und das maximale Tempo hängen außerdem von BDC- und
Scheinwerfer-Software ab.

Die Telegramme wurden aus der bereitgestellten `Ecu.zip / Ecu/BDC_G05.prg`,
Revision 36.001, abgeleitet und durch Ausführung des originalen `STEUERN_IO`-Jobs
gegen eine ausschließlich aufzeichnende Schnittstelle gegengeprüft. Keine Verbindung
zu einem Fahrzeug wurde dabei hergestellt. `protocol-evidence.json` enthält
Prüfsumme und die 17 aufgezeichneten Referenztelegramme.

Beispiele der tatsächlich verwendeten UDS-Nutzdaten:

| Aktion | Telegramm |
| --- | --- |
| BDC identifizieren | `22 F1 50` |
| Temporäre Diagnosesitzung | `10 03` |
| Fernlicht links ein | `2F E3 B5 03 07 01 C0` |
| Fernlicht rechts aus | `2F E3 B5 03 08 00 C0` |
| Steuerung zurückgeben | `2F E3 B5 00 FF` |
| Standardsitzung wiederherstellen | `10 01` |

`C0` und `FF` gehören zu den UDS-Nutzdaten. Sie sind keine Prüfsummen.
Es erfolgt keine Codierung, kein Flashen und keine dauerhafte Änderung von Lichtparametern.
Eine positive BDC-Antwort ist eine Bestätigung des Diagnosebefehls; sie ist keine
Messung, ob die Lampe tatsächlich leuchtet.

## Stop und Wiederherstellung

Stop markiert den Ablauf sofort als abgebrochen. Ein bereits gesendeter Befehl wird
noch abgewartet, dann wird `returnControlToECU` gesendet und die Standardsitzung
angefordert. Ein späterer Einschaltbefehl wird nicht mehr in die Warteschlange gestellt.

Vor dem ersten Sitzungswechsel wird eine Wiederherstellungsmarkierung im persistenten
App-Datenordner geschrieben. Schlägt das Schreiben fehl, wird nicht angesteuert.
Erst nach bestätigter Rückgabe und Standardsitzung wird sie gelöscht. Nach einem
Neustart versucht die App bei vorhandener Markierung die Rückgabe erneut, sobald
die Diagnoseverbindung verfügbar ist. Sie startet dabei keine Show.

Bei hartem Stromverlust oder einem sofortigen Prozessabbruch lässt sich die Rückgabe
nicht mehr zuverlässig abwarten. Während der Show wird eine temporäre UDS-Sitzung
mit TesterPresent gehalten. Die konkrete Rückfallzeit des BDC nach Kommunikationsverlust
ist im Fahrzeug noch zu messen. Die Software behauptet hierfür keine garantierte Zeit.

Bei **OEM release pending** bleibt die Markierung bestehen und ein neuer Start wird
blockiert. **STOP** versucht die Rückgabe erneut. Bei weiterhin bestehendem Fehler
die Diagnose exportieren und die Reaktion der Beleuchtung prüfen.

## Quellcode und Build

Das ZIP enthält unter `source/` die neuen App-Dateien sowie Paketierung und Tests.
Die App ist unter https://github.com/NamelsMissing/mgu-apps/tree/main/apps/light_show integriert.
Der Diagnose-Transport ist app-lokal als `tasu.js` enthalten, damit die vorhandenen Apps unverändert bleiben.
Geprüfter Basisstand: `180537a0bdf39163046a6855e7928eb35bb47c7b`.

```sh
node kit/tools/extract_sdk.js /pfad/zur/eigenen/javascript/app.js oap-sdk
python3 kit/tools/build.py light_show
node kit/tools/test_light_show.js
python3 kit/tools/package_light_show.py
```

Die Paketierung erzeugt einen USB-Katalog mit einem SDK-freien OAP-Paket und ein ZIP.
Die vollständige Ecu.zip, PRG-Dateien und BMW-SDK-Dateien werden nicht mitgeliefert.
Der private lokale Build benutzt das vom Nutzer bereitgestellte x_call-Archiv;
der MGU Store erzeugt das SDK für die Installation aus der eigenen Firmware.

Für die Vorschau ohne Fahrzeug:

```sh
node kit/tools/emu.js light_show
```

Das native Hauptmenü zeichnet die BMW-HMI. Der Emulator dieses Basisprojekts
bildet native Menüs nur eingeschränkt ab; die Vorschau kann mit
`node kit/tools/preview.js dist/light_show preview BTN_PREVIEW render` geprüft werden.

## Herkunft

MGU App Kit und Diagnose-Transport: cauliflowermossgrape/idrive7-apps (MIT).
Store und USB-Katalogformat: robertnisipeanu/mgu-store.
Referenzprüfung der eigenen PRG-Datei: EdiabasX von emdzej; nicht Bestandteil der
App und keine Laufzeitabhängigkeit. Siehe `SOURCE-NOTES.txt` im ZIP.
