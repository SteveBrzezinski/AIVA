# Voice Overlay Assistant – MVP+

Windows-first Tauri app for two selection-based flows:
- **Ctrl+Shift+Space** → capture marked text and speak it
- **Ctrl+Shift+T** → capture marked text and translate it

## Was jetzt drin ist

- globaler Speak-Hotkey: `Ctrl+Shift+Space`
- globaler Translate-Hotkey: `Ctrl+Shift+T`
- Selection Capture per Hintergrund-`Ctrl+C`
- Clipboard-Restore nach Möglichkeit
- OpenAI TTS mit satzweisem Chunking
- Standard-Audioformat jetzt **WAV**
- konfigurierbarer **Startpuffer nur für den ersten Chunk** (Default: `180 ms`), damit der Audio-Start weniger abgeschnitten wirkt
- Translation-MVP mit UI-Output und konfigurierbarer Zielsprache
- Settings in der UI für:
  - Audioformat (`WAV` / `MP3`)
  - erster Chunk Startpuffer
  - Zielsprache für Übersetzung

## Bedienung

1. App starten und im Hintergrund offen lassen.
2. In einer anderen Windows-App Text markieren.
3. Einen Hotkey drücken:
   - `Ctrl+Shift+Space` → Vorlesen
   - `Ctrl+Shift+T` → Übersetzen
4. Translation-Ergebnisse erscheinen aktuell in der UI. Das ist absichtlich die MVP-Basis für späteres Vorlesen, Einfügen oder Copy-Back.

## Audio / WAV-Änderung

Der Default wurde auf **WAV** umgestellt, weil das besser zum aktuellen Windows-Playback-Pfad passt:
- WAV kann direkt über `System.Media.SoundPlayer` abgespielt werden
- für den ersten Chunk wird bei WAV optional kurze Anfangsstille eingefügt
- MP3 bleibt als Fallback/Option in den Settings erhalten

Praktische Einschätzung:
- Für den aktuellen OS-Playback-MVP ist WAV hier sinnvoller als MP3.
- Falls später weiter an Latenz und nahtlosen Übergängen gearbeitet wird, ist ein **eingebetteter eigener Player** wahrscheinlich langfristig robuster als Datei-für-Datei-Playback über OS-Skripte.

## Translation-MVP

Aktuell bewusst schlicht:
- markierten Text capturen
- an OpenAI zur Übersetzung schicken
- Ergebnis in der App anzeigen

Das ist architektonisch schon so angelegt, dass später leicht erweitert werden kann auf:
- Übersetzung direkt vorlesen
- Übersetzung automatisch einfügen
- Copy-to-clipboard / paste-back Flow

## Realtime / Streaming-Einschätzung

**OpenAI streaming / realtime** kann später ein sinnvoller Beschleunigungspfad sein, vor allem wenn:
- kleinere Zwischenresultate früher in der UI erscheinen sollen
- TTS noch schneller starten soll
- Übersetzung + Vorlesen stärker dialogartig werden

Für dieses MVP war die kleinere und robustere Änderung sinnvoller: bestehende request/response-Pipeline behalten, aber Startverhalten und Hotkeys verbessern.

## Entwicklung

```bash
npm install
npm run tauri:dev
```

## Checks

```bash
npm run build
npm run tsc -- --noEmit
```

> Rust/Tauri-Windows-Teile lassen sich am sinnvollsten auf einem echten Windows-Setup validieren.
