# Equalizer DSP 0.2.1 — MGU / iDrive 7

Sieben echte parametrische Software-DSP-Bänder ergänzen die bisherige BMW-Klangsteuerung. Die Filter bearbeiten PCM-Audiosamples; sie sind unabhängig davon, ob das Fahrzeug ab Werk einen Siebenband-Equalizer anbietet.

**Aktuell wirkt der DSP auf explizit angeschlossene PCM-Apps. Video Hub 0.1.1 ist angebunden. Stock-CarPlay und Radio sind noch nicht angebunden.** Die hörbare Ausgabe auf deinem G21 ist weiterhin ungetestet.

## Installation über MGU Store

Quelle **NamelsMissing/mgu-apps**, Kanal **main** aktualisieren und **Equalizer DSP** installieren. Der Store installiert dabei den Hintergrunddienst `mgu-equalizer-dsp` 0.2.0 und die Renderer-Abhängigkeiten. Für die konkrete Audioanbindung auch **MGU Video Hub** auf **0.1.1** aktualisieren.

Der Store baut das App-Paket auf der MGU mit deren eigenem SDK. Das Repository enthält keine BMW-SDK-Dateien oder Diagnose-PRGs.

## DSP bedienen

**Fix in 0.2.1:** Die DSP-Bänder, Bypass und DSP-Profile lassen sich auch bei noch offener BMW-Regler-Messung bedienen; eine fehlgeschlagene BMW-Klangeinrichtung blockiert den unabhängigen PCM-DSP nicht mehr. Textuelle Audio-Manager-Erfolgscodes (`E_OK`) werden korrekt als Erfolg behandelt. Die CarPlay-Audioanbindung bleibt weiterhin ausstehend.


Im Tab **DSP** sind alle sieben eigenen Filter ohne BMW-Regler-Zuordnung einstellbar:

| Parameter | Bereich |
| --- | --- |
| Gain | −12 bis +12 dB, App-Schritt 0,5 dB |
| Mittenfrequenz | 20 bis 20.000 Hz |
| Q / Bandbreite | 0,3 bis 6 |
| Vorverstärkung | −24 bis 0 dB |

1. Ein Band auswählen.
2. Über **DSP-Parameter** oder den Parameterknopf zwischen Gain, Frequenz, Q und Vorverstärkung wechseln. Mit **− / +** einstellen; die Gain-Schiene lässt sich auch antippen.
3. **Bypass / DSP einschalten** wählen und **DSP übernehmen** drücken.
4. Der Dienst speichert die Filterkonfiguration, und die App liest sie wieder zurück.

Orange Werte sind vorbereitete Änderungen. Headroom lässt sich über die zugehörige Zeile umschalten. Im Auto-Headroom wird die Summe positiver Band-Anhebungen als Pegelreserve abgezogen; das kann die Wiedergabe deutlich leiser machen. Es wird keine Lautstärke am BMW-Verstärker nachgeregelt.

**DSP LIVE** erscheint nur bei eingeschaltetem DSP und kürzlich empfangenen PCM-Frames einer angebundenen Quelle. **DSP BEREIT** bedeutet, dass die Konfiguration aktiv ist, aber gerade keine laufende PCM-Quelle nachgewiesen wird. **BYPASS** gibt angeschlossene PCM-Daten unverändert weiter. Der Quellenhinweis nennt die fehlende Stock-CarPlay-/Radio-Anbindung.

## Hörbare Quelle / Video Hub

In Video Hub **Audio output → ALSA** aktivieren, sofern `ffmpeg`, `aplay` und eine funktionierende BMW-Audioausgabe vorhanden sind. Die App verbindet den Decoder-Audiostream jetzt mit dem DSP, bevor er an `aplay` geht. Ohne DSP-Verbindung fällt dieser Stream auf unveränderte PCM-Ausgabe zurück.

Mit **Audio EQ** im Video Hub kann der laufende Klang geändert werden, ohne die App zu verlassen. Die vorhandenen Regeln für Stillstand, Fokusverlust und Beenden bleiben wirksam. Die separate Equalizer-App eignet sich außerdem zum Vorbereiten von Profilen vor dem Wiedergabestart.

Die Signalverarbeitung ist in Software mit echten PCM-Samples gemessen. Eine funktionsfähige ALSA-/AVB-Ausgabe auf deinem Fahrzeug wird dadurch nicht behauptet.

## Profile und bisherige BMW-Regler

Drei DSP-Vorlagen (Neutral, Bass, Stimme) und drei eigene Speicherplätze stehen bereit. **Vorschau laden** ändert zunächst nur den Entwurf; **Übernehmen** aktiviert ihn. „Neutral“ stellt die DSP-Gains auf 0 dB und verwendet die Standardfrequenzen/Q-Werte. Das ist keine akustische Einmessung des Fahrzeugs.

Die vorhandenen BMW-Regler für Bass, Höhen, Balance und Fader bleiben im Tab **BMW-Klang**. Ihre einmalige Zuordnung im Tab **Einrichten** funktioniert wie in 0.1.0: denselben nativen BMW-Regler auf Mitte, Minimum, Maximum und wieder Mitte stellen und jede Stellung in der App erfassen. Nur eine eindeutige Kennung wird freigegeben. Dieser Vorgang ist ausschließlich lesend und wird für die eigenen DSP-Bänder nicht benötigt.

Gespeicherte Zuordnungen und alte BMW-Profile werden beim Update erhalten. Neue eigene Profilplätze speichern DSP-Konfigurationen. Ein bisheriges BMW-Profil ohne neuen DSP-Speicher kann weiterhin geladen werden. DSP-Konfigurationen verändern keine nativen BMW-Klangwerte.

## Diagnose / weitere Quellen

**Diagnose exportieren** schreibt `equalizer-diagnostics.json` in den App-Datenordner. Der Export enthält die DSP-Konfiguration, Revision, echte PCM-Framezähler, Quellen und Fehler; keine VIN oder Schlüssel.

Für die weitere Stock-CarPlay-/Radio-Anbindung auf der MGU während der Wiedergabe der betreffenden Quelle ausführen:

```sh
node /var/opt/mgu-equalizer-dsp/current/probe.js
```

Die Ausgabe liefert eine lesende Bestandsaufnahme des tatsächlichen Audiopfads. Ohne dessen Prüfung lässt sich keine systemweite Filterung versprechen. Details zu Formaten, Socket-Protokoll und Verarbeitung stehen unter [native/equalizer-dsp](../../native/equalizer-dsp/README.md).

## Entwicklung / Tests

```sh
node kit/tools/test_equalizer.js
node tests/equalizer_dsp.test.js
node tests/equalizer_video_pipe.test.js
python3 tests/equalizer_store.test.py
python3 tools/build_store_app.py equalizer
node kit/tools/test_equalizer_ui.js
```

Das lokale SDK wird aus der bereitgestellten `x_call@4.25.3.tgz` extrahiert. Nur die Tests verwenden einen simulierten BMW-Audioanbieter; der DSP verarbeitet echte Samples. Der UI-Test verwendet den echten Konfigurationsdienst mit direktem Transport; die eigene DSP-Suite prüft das Unix-Socket-Protokoll separat in GitHub CI. Die Produktion enthält keinen Fahrzeug-Simulationsschalter.

Grundlagen: [MGU App Kit](https://github.com/cauliflowermossgrape/idrive7-apps), [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/) und die in 0.1.0 überprüften `CommandControl`-/`CarSpecificEqualizingData`-Signaturen aus dem öffentlichen MGU-Schnittstellenkatalog. Die DSP-Anbindung nutzt keine geratenen UDS-Befehle und keine Codieränderung.
