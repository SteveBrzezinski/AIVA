# Voice Overlay Assistant

Voice Overlay Assistant ist eine Windows-basierte Desktop-Anwendung auf Basis von Tauri, React und Rust. Das Tool kombiniert globale Hotkeys, lokale Live-Transkription, OpenAI-TTS sowie eine direkte OpenClaw-Anbindung, damit ausgewählte Texte oder gesprochene Eingaben schnell verarbeitet und vorgelesen werden können.

## Funktionen

- globale Hotkeys für Vorlesen sowie Übersetzen und Vorlesen
- laufende Live-Transkription über WebView2
- Aktivierung des Sprachassistenten über den Assistentennamen
- Weiterleitung gesprochener Eingaben an einen lokalen OpenClaw-Agenten
- Ausgabe der Antworten über die integrierte TTS-Pipeline
- lokale, persistente Einstellungen über die App-Oberfläche

## Voraussetzungen

Für die lokale Nutzung werden benötigt:

- Windows
- Node.js inklusive `npm`
- Rust inklusive `cargo`
- die Tauri-Voraussetzungen für Windows
- ein OpenAI API-Key
- optional eine lokale OpenClaw-Installation für den Voice-Agent-Flow

## Installation

### 1. Repository klonen

```powershell
git clone https://github.com/SteveBrzezinski/ai_ovlay_assistant.git
cd ai_ovlay_assistant
```

### 2. Abhängigkeiten installieren

```powershell
npm install
```

### 3. `.env` anlegen

Lege im Projektverzeichnis eine `.env`-Datei an:

```env
OPENAI_API_KEY=your_key_here
```

Alternativ kann der OpenAI API-Key direkt in der App unter den Einstellungen gespeichert werden. Wenn dort ein Key hinterlegt ist, hat er Vorrang vor der `.env`.

### 4. Anwendung im Entwicklungsmodus starten

```powershell
npm run tauri:dev
```

## Produktions-Build

```powershell
npm run tauri:build
```

## Nutzung

- App starten und geöffnet lassen
- für die Textfunktionen in einer anderen Windows-Anwendung Text markieren
- `Ctrl+Shift+Space` liest markierten Text vor
- `Ctrl+Shift+T` übersetzt markierten Text und liest ihn vor
- der Sprachassistent lauscht nach dem eingestellten Assistentennamen als Aktivierungswort
- nach der Aktivierung wird die gesprochene Eingabe transkribiert, an OpenClaw gesendet und die Antwort vorgelesen

## Lokale Konfiguration

Die App legt beim ersten Start eine lokale Konfigurationsdatei unter `.voice-overlay-assistant.config.json` im Projektverzeichnis an. Diese Datei ist für lokale Einstellungen gedacht und bleibt aus dem Repository heraus.

## Lizenz

Dieses Repository ist **nicht Open Source**. Die Nutzung ist ausschließlich nach den Bedingungen in [LICENSE.md](./LICENSE.md) erlaubt.

Kurzfassung:

- Download und private, nicht-kommerzielle Nutzung sind erlaubt
- kommerzielle Nutzung ist nicht erlaubt
- Weiterverkauf, Weiterlizenzierung und der Einsatz als Basis für kommerzielle Produkte oder Services sind nicht erlaubt
