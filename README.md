# Voice Overlay Assistant – V1 MVP

Windows-first MVP desktop app based on:
- Tauri 2
- React
- Vite
- TypeScript

## Was V1 jetzt kann

- du markierst Text in einer beliebigen Windows-App
- **du bleibst dort im Fokus**
- du drückst den globalen Hotkey **Ctrl+Shift+Space**
- die Tauri-App löst den bestehenden Rust-Capture-and-Speak-Flow aus
- der markierte Text wird per `Ctrl+C` übernommen
- der vorherige Text-Clipboard wird nach Möglichkeit wiederhergestellt
- der Text geht an eine chunked OpenAI-TTS-Pipeline
- längere Texte werden satzweise in mehrere Chunks aufgeteilt
- bis zu 3 TTS-Requests werden parallel vorbereitet
- die Wiedergabe bleibt in Reihenfolge und startet, sobald der erste Chunk fertig ist
- das Audio wird lokal temporär als Chunk-Dateien gespeichert und direkt abgespielt

Der alte Button bleibt nur als **lokaler Test-Trigger** in der App, falls du den Flow aus dem Fenster selbst prüfen willst.

## Hotkey

**Default hotkey:** `Ctrl+Shift+Space`

Warum dieser Shortcut:
- auf Windows leicht merkbar
- nicht so kollisionsfreudig wie einfache Einzelkombinationen
- für den MVP gut genug, ohne gleich ein Einstellungs-UI zu bauen

Wenn der Hotkey nicht registriert werden kann, zeigt die UI das an. Dann nutzt wahrscheinlich schon eine andere App genau diese Kombination.

## Voraussetzungen

- Windows
- Node.js / npm
- Rust toolchain
- Tauri 2 prerequisites
- `OPENAI_API_KEY` in `.env`

Beispiel:

```env
OPENAI_API_KEY=your_key_here
```

## Entwicklung

```bash
npm install
npm run tauri:dev
```

## Build

```bash
npm run tauri:build
```

## Bedienung

1. App starten und im Hintergrund offen lassen.
2. In einer anderen Windows-App Text markieren.
3. **Ctrl+Shift+Space** drücken.
4. Die App kopiert den markierten Text, teilt längere Passagen satzweise auf, erzeugt die Audio-Chunks per OpenAI und startet die Wiedergabe ab dem ersten fertigen Chunk.
5. Optional: Im App-Fenster auf **Optional: local button test** klicken, wenn du lokal testen willst.

## Wichtige MVP-Grenzen

- Windows-first: der globale Hotkey ist nur für die Windows-Tauri-App implementiert
- die Auswahlübernahme hängt davon ab, dass die Ziel-App `Ctrl+C` normal akzeptiert
- Audioausgabe nutzt weiterhin OpenAI TTS und deine lokale `.env`; Translation und Offline-/Local-TTS sind noch nicht eingebaut
- längere Texte landen aktuell in mehreren temporären Audio-Dateien innerhalb eines Chunk-Ordners
- zwischen einzelnen Chunks kann es durch das aktuelle Datei-für-Datei-Playback noch kleine Übergangslücken geben
- der Hotkey ist fest eingebaut; es gibt noch keine UI zum Umbelegen
- während ein Lauf aktiv ist, werden zusätzliche Hotkey-Presses ignoriert

## Validierung, die sinnvoll ist

- `npm run build` für Frontend/TypeScript
- Rust/Tauri Compile-Check auf einem Windows-Setup

In WSL oder auf Nicht-Windows-Systemen lässt sich die echte globale Hotkey-Funktion nicht vollständig praxisnah ausprobieren.
