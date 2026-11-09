# Light Show 0.2.2

Experimentelle Stroboskop-App für BMW MGU iDrive 7, angelehnt an
[das Reel von bmwneva](https://www.instagram.com/reel/DfR0l0HxKNS/).
Eigenständige Implementierung, kein Originalcode aus dem Reel.

## 0.2.2: Jede Außenleuchte einzeln testen

Unter **Diagnostics → Individual light tests / 32 outputs** gibt es vier
Untergruppen für Front, Seite, Heck/Bremslicht und die hinteren Zusatzleuchten.
Die 32 einzeln auswählbaren BDC-Ausgänge stammen aus der Tabelle
`TAB_LICHT_AUSGANG_DIGITAL_ARG` in der vom Nutzer bereitgestellten
`BDC_G05.prg` (Revision 36.001). Dazu gehören:

- Fernlicht und Abblendlicht jeweils links/rechts;
- Tagfahrlicht, Positionslicht und Nebelscheinwerfer links/rechts;
- Blinker vorn, seitlich und hinten jeweils links/rechts;
- Schlusslichtkreise links/rechts, Bremslicht links/rechts sowie **die dritte
  Bremsleuchte `BL_M` (ID `0x23`)**;
- Bremskraftanzeige-Ausgänge `BFD_L` und `BFD_R`, Rückfahrlicht,
  Nebelschlusslicht und Kennzeichenbeleuchtung.

Jeder Test fordert genau **einen** diskreten BDC-Ausgang für **750 ms** an.
Danach werden explizit der Einzel-Ausgang OFF, die allgemeine IO-Rückgabe und
die Standardsitzung versucht. Es erfolgt keine Stellmotor-Ansteuerung durch die
App, allerdings lässt sich nicht ausschließen, dass die Steuergeräte auf
einen Lichtauftrag mit eigenen Stellbewegungen reagieren.

**Wichtig:** Das ist derselbe alte `E3B5`-Ausgangsweg, bei dem am getesteten G21
in Version 0.1.1 kein sichtbares Fernlicht beobachtet wurde. Die zusätzlichen
Ausgangskennungen sind aus der PRG-Tabelle belegt; ihre einzelnen Steuertelegramme
und physische Wirkung wurden noch nicht gegen das Fahrzeug verifiziert. Manche
Ausgänge können im G21 fehlen oder vom jeweiligen Steuergerät anders zugeordnet
werden. Es werden **keine** unbekannten FLM-LED-Kanäle oder Stellmotoren angesteuert.

Nach jeder Prüfung kann das Ergebnis direkt erfasst werden:
"visible, no unusual noise", "visible and unusual noise", "no visible effect,
no noise" oder "unusual noise without visible light". Diese Beobachtungen
werden lokal gespeichert und mit **Diagnostics → Save diagnostic log**
exportiert. Die App bewertet bestätigte ECU-Antworten weiterhin nicht als
Sichtnachweis. Nach einer abgelehnten Rückgabe wird der nächste Test gesperrt;
die normale Fahrzeugbeleuchtung muss geprüft werden, bevor die gespeicherte
Sperre manuell zurückgesetzt werden darf.

## 0.2.1: Scheinwerfermodule auslesen

Der Nutzer bestätigt jetzt sichtbares Fernlicht über den neuen Weg, berichtet aber
bei jedem Einschalten Stellgeräusche, die bei normaler Lichthupe nicht auftreten.
Die Ursache des Geräusches und eine Beteiligung der Höhenregelung sind noch nicht
messtechnisch bestätigt. Die App sendet keine ausdrücklichen Stellmotorbefehle.

Unter **Diagnostics → Read headlamp modules / LED mapping** liest 0.2.1 die
Identität der beiden Scheinwerfermodule und bei passender FLM02-L/R-Identität
die Zuordnung der Fernlicht-LED-Ausgänge. Unbekannte Varianten werden nur
identifiziert. Diese Prüfung sendet ausschließlich Leseanfragen, keine
Sitzungswechsel, Licht- oder Stellmotorbefehle. Die Ergebnisse erscheinen in
Diagnostics und im Export. Kanalwerte werden roh angezeigt und noch nicht zur
Ansteuerung verwendet. Diese Version behebt die Stellgeräusche noch nicht.

## Tatsächlicher Teststand

Im gemeldeten G21-Test von **0.1.1** entstand **kein sichtbarer Lichteffekt**,
weder mit laufendem noch mit abgestelltem Motor. Der BDC bestätigte zwar die
Ausgangsbefehle und meldete nach dem ersten Einschalten für Fernlicht links den
Statuswechsel `0` → `1`. Das ist kein Nachweis, dass eine LED leuchtet.
Die allgemeine IO-Rückgabe wurde mit `NRC 22` abgelehnt. Nur das manuelle
Bestätigen in Diagnostics löschte die gespeicherte Startsperre; dadurch wurde
die Lichtansteuerung nicht repariert.

**0.2.0 ergänzte einen anderen Ansteuerungsweg, dessen Lichtwirkung inzwischen mit Stellgeräuschen gemeldet wurde:**
die zeitbegrenzte BMW-Leuchtenfunktion `D542`. Sie fordert beide Leuchten gemeinsam
an und verwendet Zeit `0` als eigenen Stop-Auftrag. Dieser Weg benutzt keine
allgemeine `E3B5`-IO-Rückgabe. Das abwechselnde Links-/Rechts-Blinken bleibt im
alten Diagnoseweg verfügbar, ist am gemeldeten G21 aber weiterhin ohne Wirkung.

## Update und erster Test

1. Im MGU Store die Quelle `NamelsMissing/mgu-apps`, Kanal **main**, aktualisieren
   und **Light Show 0.2.2** installieren.
2. Zündung einschalten und im Stand **P** wählen. Ein laufender Motor ist keine
   Startbedingung der App.
3. Falls noch eine Startsperre aus 0.1.1 besteht: normale Beleuchtung mit den
   Fahrzeugschaltern prüfen und in **Diagnostics → Normal lights checked – reset
   saved stop lock** bestätigen. Das entfernt nur die gespeicherte Sperre.
4. **Light pair: High beam** wählen und **2-second test: both selected lights**
   drücken. Dieser Knopf fordert einmal zwei Sekunden Fernlicht über die neue
   Leuchtenfunktion an, unabhängig von der eingestellten Show-Dauer.
5. Die tatsächlichen Scheinwerfer beobachten. Erst wenn beide sichtbar reagieren,
   die Muster mit **Light control: Both lights – timed function (new test)** und
   **Start vehicle lights** testen.
6. Für den Vergleich mit normaler Lichthupe unter **Diagnostics → Individual light tests**
   zuerst **High beam left / FL_L** und **High beam right / FL_R** einzeln probieren,
   die jeweilige Lichtwirkung und Geräusche bewerten. Nur im Stillstand, auf
   Privatgrund, ohne Personen im Lichtkegel. Nicht während der Fahrt ausprobieren.
7. Bei ausbleibender Reaktion oder Fehler **Diagnostics** öffnen und das neue
   Protokoll mit **Save diagnostic log** speichern.

**Preview on screen** ist ausschließlich eine Bildschirmvorschau. Eine bestehende
Show wird vor dem Öffnen beendet. Die App installiert keinen Hintergrunddienst
und startet beim Booten keine Show.

## Funktionen und Grenzen

- Zeitbegrenzte gemeinsame Leuchtenfunktion: beide zusammen, Doppel- und Dreifachblitz.
- Getrennter alter Ausgangsweg mit sechs Links-/Rechts-Mustern für Diagnosezwecke
  sowie 32 einzelne Außenlicht-Ausgänge mit kurzer Prüfzeit und Beobachtungsprotokoll.
- Auswahl Fernlicht, Tagfahrlicht, Standlicht oder Nebelscheinwerfer vorn.
  Die neue Standlichtfunktion kann auch hintere Leuchten einschließen;
  Nebelscheinwerfer müssen vorhanden sein.
- Musterschritt 100 / 150 / 200 / 300 / 500 ms; Show-Dauer 5 / 15 / 30 / 60 Sekunden.
  Jeder normale Einschaltauftrag im neuen Weg enthält höchstens 500 ms
  Aktivierungszeit, der einzelne Funktionstest höchstens zwei Sekunden.
- Stop bei Bewegung, Verlust von P, veralteter Geschwindigkeit, Verbindungsverlust,
  Verlassen der App oder Änderung der Einstellungen.
- Native Touch-/Controller-Bedienung, separate Vorschau und Diagnoseexport
  `light-show-diagnostics.json` im App-Datenordner.

Jeder Diagnosebefehl wird abgewartet. Langsame Antworten verlangsamen das Muster;
es werden keine verspäteten Impulse nachgeholt. Die App zeigt bestätigte Befehle
und BDC-Statuswerte an. Sie misst nicht die physische Helligkeit. Auch ein
bestätigter Stop-Auftrag ist zunächst eine Protokollbestätigung.

## Protokoll und Offline-Prüfung

Nur BDC_G05, Adresse `0x40`, SGBD-Index `0F2680`, wird zugelassen.
Die Identität wird vor der Ansteuerung gelesen; andere Varianten werden abgewiesen.
Eine G21-Modellbezeichnung ersetzt diese Prüfung nicht.

Die Telegramme wurden aus der eigenen `Ecu.zip / Ecu/BDC_G05.prg`, Revision
36.001, ermittelt und durch Ausführung der originalen Job-Bytecodes gegen eine
aufzeichnende Schnittstelle gegengeprüft. Dabei bestand keine Fahrzeugverbindung.
`protocol-evidence.json` enthält die PRG-Prüfsumme, 17 Referenzen für den alten
Ausgangsweg und 28 für die neue zeitbegrenzte Funktion. Die für die neue Prüfung
nötige Korrektur der 32-Bit-Vorzeichenbehandlung im lokalen Forschungsinterpreter
ist dort dokumentiert. Dieser Interpreter ist keine App-Abhängigkeit.

| Aktion | UDS-Nutzdaten |
| --- | --- |
| BDC identifizieren | `22 F1 50` |
| Temporäre Diagnosesitzung | `10 03` |
| Neue Fernlichtfunktion, zwei Sekunden | `2E D5 42 00 05 00 C8` |
| Stop-Auftrag derselben Funktion | `2E D5 42 00 05 00 00` |
| Leuchtenfunktionsstatus lesen | `22 D5 42` |
| Alter Ausgang Fernlicht links ein | `2F E3 B5 03 07 01 C0` |
| Diagnose-Bremslicht Mitte ein (aus der Ausgangstabelle abgeleitet) | `2F E3 B5 03 23 01 C0` |
| Diagnose-Bremslicht Mitte aus (aus der Ausgangstabelle abgeleitet) | `2F E3 B5 03 23 00 C0` |
| Alte allgemeine IO-Rückgabe, im Fahrzeug abgelehnt | `2F E3 B5 00 FF` |
| Standardsitzung anfordern | `10 01` |

Für `D542` sind Funktion und Zeit jeweils zwei Bytes mit höchstwertigem Byte
zuerst; die Zeit ist in Hundertstelsekunden codiert. Es erfolgt kein automatischer
Wechsel zwischen den beiden Ansteuerungswegen nach einem Fehler.

## Stop und gespeicherte Startsperre

Stop setzt sofort das Abbruchsignal. Ein laufender Diagnosebefehl wird abgewartet,
dann folgt der zum gespeicherten Ansteuerungsweg passende Stop-Auftrag und
anschließend die Standardsitzung. Danach werden keine Einschaltbefehle nachgereicht.

Vor jedem Sitzungswechsel wird eine Wiederherstellungsmarkierung im App-Datenordner
gespeichert. Sie enthält jetzt auch Ansteuerungsweg und Leuchtenfunktion.
Schlägt das Speichern fehl, wird nicht angesteuert. Erst nach beiden positiven
Antworten für Stop und Standardsitzung wird die Markierung automatisch gelöscht.
Nach einem Neustart wird bei vorhandener Verbindung nur die passende Rückgabe
versucht. Eine alte Markierung aus 0.1.1 wird weiterhin mit der alten IO-Rückgabe
behandelt; sie wird beim Update nicht stillschweigend gelöscht.

Bei **Timed stop pending** oder **OEM release pending** bleiben neue Starts gesperrt.
Die manuelle Bestätigung in Diagnostics verlangt Stand/P, eine passende BDC-Identität,
eine positive Standardsitzungsantwort und die vorherige Lichtprüfung durch den
Nutzer. Sie bestätigt keine erfolgreiche physische Rückgabe.

Bei hartem Stromverlust kann die App keine Antwort mehr abwarten. Die neue Funktion
enthält zwar eine endliche Aktivierungszeit; die tatsächliche Rückfallreaktion und
der Stop-Auftrag müssen am Fahrzeug noch bestätigt werden.

## Quellcode und Build

[Repository](https://github.com/NamelsMissing/mgu-apps/tree/main/apps/light_show).
Der Diagnose-Transport liegt app-lokal in `tasu.js`; andere Apps werden nicht verändert.

```sh
node kit/tools/extract_sdk.js /pfad/zur/eigenen/javascript/app.js oap-sdk
python3 tools/build_store_app.py light_show
node kit/tools/test_light_show.js
```

Für einen optionalen USB-Katalog nach Build und Tests:

```sh
python3 kit/tools/package_light_show.py
```

Der erzeugte Katalog unter `dist/light-show-usb/mgu-repo` kann auf die oberste Ebene
eines USB-Sticks kopiert werden. Der Store muss USB-Kataloge unterstützen.
BMW-SDK-Dateien und vollständige PRGs werden nicht mitgeliefert. Der private Build
benutzt das eigene x_call-SDK; bei Installation aus dieser GitHub-Quelle ergänzt
der MGU Store das SDK aus der eigenen Firmware.

Die Vorschau kann ohne Fahrzeug geprüft werden:

```sh
node kit/tools/preview.js dist/light_show qa/light_show BTN_PREVIEW render
```

Das native Hauptmenü zeichnet die BMW-HMI. Der Emulator stellt native Menüs nur
eingeschränkt dar; ein erfolgreicher Vorschau-Test belegt keine Fahrzeugfunktion.

## Herkunft

MGU App Kit und TASU-Transport: cauliflowermossgrape/idrive7-apps (MIT), geprüfter
Basisstand `180537a0bdf39163046a6855e7928eb35bb47c7b`.
Store und USB-Format: robertnisipeanu/mgu-store.
Referenzanalyse: EdiabasX von emdzej, nicht Bestandteil der installierten App.
