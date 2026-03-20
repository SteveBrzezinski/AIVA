import { useEffect, useMemo, useState } from 'react';
import {
  captureAndSpeak,
  getAppStatus,
  getHotkeyStatus,
  onHotkeyStatus,
  type HotkeyStatus,
} from './lib/voiceOverlay';

type UiState = 'idle' | 'working' | 'success' | 'error';

const fallbackHotkeyStatus: HotkeyStatus = {
  registered: false,
  accelerator: 'Ctrl+Shift+Space',
  platform: 'unsupported',
  state: 'registering',
  message: 'Prüfe globalen Hotkey-Status …',
};

export default function App() {
  const [appStatus, setAppStatus] = useState('Lade Status …');
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus>(fallbackHotkeyStatus);
  const [uiState, setUiState] = useState<UiState>('idle');
  const [message, setMessage] = useState(
    'Bereit. Längere Texte werden satzweise gechunked; die Wiedergabe startet mit dem ersten fertigen Audio-Chunk.',
  );
  const [capturedPreview, setCapturedPreview] = useState('');
  const [lastAudioPath, setLastAudioPath] = useState('');
  const [lastAudioOutputDirectory, setLastAudioOutputDirectory] = useState('');
  const [lastAudioChunkCount, setLastAudioChunkCount] = useState(0);

  useEffect(() => {
    void getAppStatus()
      .then((status) => setAppStatus(status))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        setAppStatus(`Status konnte nicht geladen werden: ${text}`);
      });

    void getHotkeyStatus()
      .then((status) => {
        setHotkeyStatus(status);
        setMessage(status.message);
        setCapturedPreview(status.lastCapturedText ?? '');
        setLastAudioPath(status.lastAudioPath ?? '');
        setLastAudioOutputDirectory(status.lastAudioOutputDirectory ?? '');
        setLastAudioChunkCount(status.lastAudioChunkCount ?? 0);
      })
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        setHotkeyStatus({
          ...fallbackHotkeyStatus,
          state: 'error',
          message: `Hotkey-Status konnte nicht geladen werden: ${text}`,
        });
      });

    let unlisten: UnlistenCleanup | undefined;
    void onHotkeyStatus((status) => {
      setHotkeyStatus(status);
      setMessage(status.message);
      setCapturedPreview(status.lastCapturedText ?? '');
      setLastAudioPath(status.lastAudioPath ?? '');
      setLastAudioOutputDirectory(status.lastAudioOutputDirectory ?? '');
      setLastAudioChunkCount(status.lastAudioChunkCount ?? 0);

      if (status.state === 'working') {
        setUiState('working');
      } else if (status.state === 'success') {
        setUiState('success');
      } else if (status.state === 'error') {
        setUiState('error');
      } else {
        setUiState('idle');
      }
    })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch(() => undefined);

    return () => {
      void unlisten?.();
    };
  }, []);

  const readinessItems = useMemo(
    () => [
      { label: 'Desktop shell', value: 'Tauri + React + Vite bereit' },
      { label: 'Global hotkey', value: `${hotkeyStatus.accelerator} · ${hotkeyStatus.registered ? 'aktiv' : 'nicht aktiv'}` },
      { label: 'Selection capture', value: 'Windows Clipboard MVP aktiv' },
      { label: 'Speech output', value: 'OpenAI TTS + satzweises Chunking + direkte Wiedergabe' },
      { label: 'Current status', value: appStatus },
    ],
    [appStatus, hotkeyStatus.accelerator, hotkeyStatus.registered],
  );

  const primaryInstructions = useMemo(() => {
    if (hotkeyStatus.platform !== 'windows') {
      return [
        'Die globale Hotkey-Version ist für die Windows-Tauri-App gedacht.',
        'Im aktuellen Umfeld ist nur der lokale Button-Test sinnvoll.',
        'Für den echten MVP-Flow die App als Windows-Desktop-App starten.',
      ];
    }

    return [
      'Voice Overlay Assistant im Hintergrund geöffnet lassen.',
      'Text in einer beliebigen Windows-App markieren.',
      `Direkt dort ${hotkeyStatus.accelerator} drücken – Fokus bleibt in der anderen App.`,
      'Die App sendet Ctrl+C im Hintergrund, teilt längere Texte satzweise auf und startet die Wiedergabe, sobald der erste Chunk bereit ist.',
    ];
  }, [hotkeyStatus.accelerator, hotkeyStatus.platform]);

  const runReadSelectedText = async (): Promise<void> => {
    setUiState('working');
    setMessage('Lokaler Testlauf: versuche markierten Text zu lesen und als Audio wiederzugeben …');

    try {
      const result = await captureAndSpeak(
        {
          copyDelayMs: 140,
          restoreClipboard: true,
        },
        {
          autoplay: true,
          format: 'mp3',
          maxParallelRequests: 3,
          voice: 'alloy',
        },
      );

      setUiState('success');
      setCapturedPreview(result.capturedText);
      setLastAudioPath(result.speech.filePath);
      setLastAudioOutputDirectory(result.speech.outputDirectory);
      setLastAudioChunkCount(result.speech.chunkCount);
      setMessage(buildSuccessMessage(result.capturedText.length, result.speech.chunkCount, result.note));
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(text);
    }
  };

  const heroBadge = hotkeyStatus.registered
    ? `Global hotkey aktiv: ${hotkeyStatus.accelerator}`
    : `Global hotkey: ${hotkeyStatus.accelerator}`;

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="status-row">
          <span className="status-dot" aria-hidden="true" />
          <span className="status-text">{heroBadge}</span>
        </div>

        <h1>Voice Overlay Assistant</h1>
        <p className="hero-copy">
          Windows-first MVP: Text in einer anderen App markieren, <strong>{hotkeyStatus.accelerator}</strong>{' '}
          drücken und den bestehenden Capture-and-Speak-Flow ohne Fokuswechsel auslösen. Lange Texte
          werden dabei satzweise gechunked und ab dem ersten fertigen Chunk abgespielt.
        </p>

        <div className="actions">
          <button
            type="button"
            className="primary-button"
            disabled={uiState === 'working'}
            onClick={() => void runReadSelectedText()}
          >
            {uiState === 'working' ? 'Working …' : 'Optional: local button test'}
          </button>
          <span className="button-note">
            Windows-only MVP · nutzt deine vorhandene .env · Hotkey ist der primäre Flow
          </span>
        </div>
      </section>

      <section className="panel-grid" aria-label="Project status">
        {readinessItems.map((item) => (
          <article className="info-card" key={item.label}>
            <span className="info-label">{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      <section className={`result-card result-card--${uiState}`}>
        <div>
          <span className="info-label">Letzter Lauf / Hotkey-Status</span>
          <strong>{message}</strong>
        </div>

        {capturedPreview ? (
          <div className="result-block">
            <span className="info-label">Erfasster Text</span>
            <p>{capturedPreview}</p>
          </div>
        ) : null}

        {getAudioOutputValue(lastAudioPath, lastAudioOutputDirectory, lastAudioChunkCount) ? (
          <div className="result-block">
            <span className="info-label">{getAudioOutputLabel(lastAudioChunkCount)}</span>
            <code>{getAudioOutputValue(lastAudioPath, lastAudioOutputDirectory, lastAudioChunkCount)}</code>
          </div>
        ) : null}
      </section>

      <section className="instructions-card">
        <span className="info-label">So nutzt du den Hotkey-MVP</span>
        <ol>
          {primaryInstructions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}

type UnlistenCleanup = () => void;

function buildSuccessMessage(characterCount: number, chunkCount: number, note?: string | null): string {
  const chunkLabel = chunkCount === 1 ? '1 Audio-Chunk' : `${chunkCount} Audio-Chunks`;
  const summary = `Lokaler Test erfolgreich. ${characterCount} Zeichen wurden übernommen, in ${chunkLabel} aufgeteilt und ab dem ersten fertigen Chunk abgespielt.`;
  return note ? `${summary} ${note}` : summary;
}

function getAudioOutputLabel(chunkCount: number): string {
  return chunkCount > 1 ? 'Audio-Ausgabe (Chunk-Ordner)' : 'Audio-Datei';
}

function getAudioOutputValue(filePath: string, outputDirectory: string, chunkCount: number): string {
  return chunkCount > 1 ? outputDirectory || filePath : filePath;
}
