import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  captureAndSpeak,
  captureAndTranslate,
  getAppStatus,
  getHotkeyStatus,
  getLanguageOptions,
  getSettings,
  onHotkeyStatus,
  resetSettings,
  updateSettings,
  type AppSettings,
  type HotkeyStatus,
  type LanguageOption,
} from './lib/voiceOverlay';

type RunHistoryEntry = {
  id: string;
  recordedAtMs: number;
  state: string;
  message: string;
  mode: string;
  requestedMode: string;
  sessionStrategy: string;
  captureDurationMs: number | null;
  captureToTtsStartMs: number | null;
  ttsToFirstAudioMs: number | null;
  firstAudioToPlaybackMs: number | null;
  hotkeyToFirstAudioMs: number | null;
  hotkeyToFirstPlaybackMs: number | null;
};

type UiState = 'idle' | 'working' | 'success' | 'error';
type ActiveView = 'dashboard' | 'settings';

const fallbackHotkeyStatus: HotkeyStatus = {
  registered: false,
  accelerator: 'Ctrl+Shift+Space',
  translateAccelerator: 'Ctrl+Shift+T',
  pauseResumeAccelerator: 'Ctrl+Shift+P',
  cancelAccelerator: 'Ctrl+Shift+X',
  platform: 'unsupported',
  state: 'registering',
  message: 'Checking global hotkeys...',
};

const fallbackSettings: AppSettings = {
  ttsMode: 'classic',
  realtimeAllowLiveFallback: false,
  ttsFormat: 'wav',
  firstChunkLeadingSilenceMs: 180,
  translationTargetLanguage: 'en',
  playbackSpeed: 1,
  openaiApiKey: '',
};

function buildRunHistoryEntry(status: HotkeyStatus): RunHistoryEntry | null {
  if (!['success', 'error', 'idle'].includes(status.state)) return null;
  if (!status.lastAction || status.lastAction !== 'speak') return null;
  if (
    !status.hotkeyToFirstPlaybackMs &&
    !status.hotkeyToFirstAudioMs &&
    !status.captureDurationMs &&
    !status.ttsToFirstAudioMs &&
    !status.message
  )
    return null;

  return {
    id: `${status.sessionId ?? 'no-session'}-${status.message}`,
    recordedAtMs: Date.now(),
    state: status.state,
    message: status.message,
    mode: status.activeTtsMode ?? '',
    requestedMode: status.requestedTtsMode ?? '',
    sessionStrategy: status.sessionStrategy ?? '',
    captureDurationMs: status.captureDurationMs ?? null,
    captureToTtsStartMs: status.captureToTtsStartMs ?? null,
    ttsToFirstAudioMs: status.ttsToFirstAudioMs ?? null,
    firstAudioToPlaybackMs: status.firstAudioToPlaybackMs ?? null,
    hotkeyToFirstAudioMs: status.hotkeyToFirstAudioMs ?? null,
    hotkeyToFirstPlaybackMs: status.hotkeyToFirstPlaybackMs ?? null,
  };
}

export default function App() {
  // ── Core state ────────────────────────────────────────────────────────────
  const [appStatus, setAppStatus] = useState('Loading status...');
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus>(fallbackHotkeyStatus);
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [savedSettings, setSavedSettings] = useState<AppSettings>(fallbackSettings);
  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);
  const [uiState, setUiState] = useState<UiState>('idle');
  const [message, setMessage] = useState('Ready.');
  const [capturedPreview, setCapturedPreview] = useState('');
  const [translatedPreview, setTranslatedPreview] = useState('');
  const [startLatencyMs, setStartLatencyMs] = useState<number | null>(null);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  // ── V2 UI state ───────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [contextItems, setContextItems] = useState<string[]>([]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    void Promise.all([getAppStatus(), getHotkeyStatus(), getSettings(), getLanguageOptions()])
      .then(([status, hotkey, appSettings, languages]) => {
        setAppStatus(status);
        setHotkeyStatus(hotkey);
        setSettings(appSettings);
        setSavedSettings(appSettings);
        setLanguageOptions(languages);
        setMessage(hotkey.message);
        setCapturedPreview(hotkey.lastCapturedText ?? '');
        setTranslatedPreview(hotkey.lastTranslationText ?? '');
        setStartLatencyMs(hotkey.startLatencyMs ?? null);
      })
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        setAppStatus(`Failed to load status: ${text}`);
      });

    let unlisten: (() => void | Promise<void>) | undefined;
    void onHotkeyStatus((status) => {
      setHotkeyStatus(status);
      setMessage(status.message);
      setCapturedPreview(status.lastCapturedText ?? '');
      setTranslatedPreview(status.lastTranslationText ?? '');
      setStartLatencyMs(status.startLatencyMs ?? null);
      setUiState(
        status.state === 'working'
          ? 'working'
          : status.state === 'error'
            ? 'error'
            : status.state === 'success'
              ? 'success'
              : 'idle',
      );

      const historyEntry = buildRunHistoryEntry(status);
      if (historyEntry) {
        setRunHistory((current) => {
          if (current.some((e) => e.id === historyEntry.id)) return current;
          return [historyEntry, ...current].slice(0, 8);
        });
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => { void unlisten?.(); };
  }, []);

  // Listen for overlay action results (Vorlesen/Übersetzen from global action bar)
  useEffect(() => {
    type OverlayActionPayload = {
      action: 'speak' | 'translate';
      state: 'success' | 'error';
      message: string;
      capturedText?: string;
      translatedText?: string;
      startLatencyMs?: number | null;
      ttsMode?: string;
    };
    const unlisten = listen<OverlayActionPayload>('overlay-action', (event) => {
      const p = event.payload;
      setUiState(p.state === 'success' ? 'success' : 'error');
      setMessage(p.message);
      if (p.capturedText) setCapturedPreview(p.capturedText);
      if (p.translatedText) setTranslatedPreview(p.translatedText);
      else if (p.action === 'speak') setTranslatedPreview('');
      if (p.startLatencyMs != null) setStartLatencyMs(p.startLatencyMs);
      if (p.state === 'success') {
        const entry = {
          id: `overlay-${p.action}-${Date.now()}`,
          recordedAtMs: Date.now(),
          state: p.state,
          message: p.message,
          mode: p.ttsMode ?? '',
          requestedMode: p.ttsMode ?? '',
          sessionStrategy: 'overlay',
          captureDurationMs: null,
          captureToTtsStartMs: null,
          ttsToFirstAudioMs: null,
          firstAudioToPlaybackMs: null,
          hotkeyToFirstAudioMs: null,
          hotkeyToFirstPlaybackMs: p.startLatencyMs ?? null,
        };
        setRunHistory((current) => [entry, ...current].slice(0, 8));
      }
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [savedSettings, settings],
  );
  const showLiveSpeedWarning =
    ['live', 'realtime'].includes(settings.ttsMode) && Math.abs(settings.playbackSpeed - 1) >= 0.01;

  // ── Actions ───────────────────────────────────────────────────────────────
  const persistSettings = async (
    next: AppSettings,
    successMessage = 'Settings saved.',
  ): Promise<AppSettings> => {
    setIsSavingSettings(true);
    try {
      const saved = await updateSettings(next);
      setSettings(saved);
      setSavedSettings(saved);
      setMessage(successMessage);
      return saved;
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(`Failed to save settings: ${text}`);
      throw error;
    } finally {
      setIsSavingSettings(false);
    }
  };

  const ensureSavedSettings = async (): Promise<AppSettings> => {
    if (hasUnsavedChanges) {
      return persistSettings(settings, 'Settings saved. Running with the updated values.');
    }
    return savedSettings;
  };

  const runReadSelectedText = async (): Promise<void> => {
    let activeSettings = savedSettings;
    try {
      activeSettings = await ensureSavedSettings();
    } catch {
      return;
    }
    setUiState('working');
    setMessage('Reading selected text...');
    try {
      const result = await captureAndSpeak(
        { copyDelayMs: 100, restoreClipboard: true },
        {
          autoplay: true,
          format: activeSettings.ttsFormat,
          mode: activeSettings.ttsMode,
          maxParallelRequests: 3,
          voice: 'alloy',
          firstChunkLeadingSilenceMs: activeSettings.firstChunkLeadingSilenceMs,
        },
      );
      setUiState('success');
      setCapturedPreview(result.capturedText);
      setTranslatedPreview('');
      setStartLatencyMs(result.speech.startLatencyMs ?? null);
      setMessage(
        `Playing in ${result.speech.mode} mode${result.speech.startLatencyMs ? ` · first audio after ${result.speech.startLatencyMs} ms` : ''}.`,
      );
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(text);
    }
  };

  const runTranslateSelectedText = async (): Promise<void> => {
    let activeSettings = savedSettings;
    try {
      activeSettings = await ensureSavedSettings();
    } catch {
      return;
    }
    setUiState('working');
    setMessage(`Translating to ${activeSettings.translationTargetLanguage}...`);
    try {
      const result = await captureAndTranslate(
        { copyDelayMs: 100, restoreClipboard: true },
        { targetLanguage: activeSettings.translationTargetLanguage },
      );
      setUiState('success');
      setCapturedPreview(result.capturedText);
      setTranslatedPreview(result.translation.text);
      setStartLatencyMs(result.speech.startLatencyMs ?? null);
      setMessage(
        `Translated to ${result.translation.targetLanguage}${result.speech.startLatencyMs ? ` · first audio after ${result.speech.startLatencyMs} ms` : ''}.`,
      );
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(text);
    }
  };

  const resetAllSettings = async (): Promise<void> => {
    setShowResetDialog(false);
    setIsSavingSettings(true);
    try {
      const defaults = await resetSettings();
      setSettings(defaults);
      setSavedSettings(defaults);
      setMessage('Settings reset to defaults.');
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(`Failed to reset settings: ${text}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="app-v2">
        {/* ── Top bar ──────────────────────────────────────────────────── */}
        <header className="v2-topbar">
          <div className="v2-topbar-brand">
            <span className={`v2-status-dot v2-status-dot--${uiState}`} />
            <span className="v2-topbar-name">Voice Overlay</span>
          </div>
          <div className="v2-topbar-hotkeys">
            <kbd>{hotkeyStatus.accelerator}</kbd>
            <span>Vorlesen</span>
            <kbd>{hotkeyStatus.translateAccelerator}</kbd>
            <span>Übersetzen</span>
          </div>
          <div className="v2-topbar-nav">
            <button
              type="button"
              className={`v2-tab-btn${activeView === 'dashboard' ? ' v2-tab-btn--active' : ''}`}
              onClick={() => setActiveView('dashboard')}
            >
              Status
            </button>
            <button
              type="button"
              className={`v2-tab-btn${activeView === 'settings' ? ' v2-tab-btn--active' : ''}`}
              onClick={() => setActiveView('settings')}
            >
              Einstellungen
            </button>
          </div>
        </header>

        {/* ── Dashboard ────────────────────────────────────────────────── */}
        {activeView === 'dashboard' && (
          <main className="v2-dashboard">
            {/* Status card */}
            <div className={`v2-card v2-status-card v2-status-card--${uiState}`}>
              <div className="v2-status-row">
                <span className={`v2-status-dot v2-status-dot--${uiState} v2-status-dot--lg`} />
                <span className="v2-status-message">{message}</span>
                {startLatencyMs !== null && (
                  <span className="v2-latency-badge">{startLatencyMs} ms</span>
                )}
              </div>

              {capturedPreview && (
                <div className="v2-preview-block">
                  <span className="v2-label">Erfasster Text</span>
                  <p className="v2-preview-text">{capturedPreview}</p>
                </div>
              )}

              {translatedPreview && (
                <div className="v2-preview-block">
                  <span className="v2-label">Übersetzung</span>
                  <p className="v2-preview-text v2-preview-text--translated">{translatedPreview}</p>
                </div>
              )}

              {contextItems.length > 0 && (
                <div className="v2-preview-block">
                  <div className="v2-context-header">
                    <span className="v2-label">Kontext ({contextItems.length})</span>
                    <button
                      type="button"
                      className="v2-ghost-btn"
                      onClick={() => setContextItems([])}
                    >
                      Leeren
                    </button>
                  </div>
                  {contextItems.map((item, i) => (
                    <p key={i} className="v2-preview-text v2-preview-text--context">
                      {item}
                    </p>
                  ))}
                </div>
              )}

              <div className="v2-quick-actions">
                <button
                  type="button"
                  className="v2-action-btn v2-action-btn--primary"
                  disabled={uiState === 'working' || isSavingSettings}
                  onClick={() => void runReadSelectedText()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {uiState === 'working' ? 'Läuft...' : 'Markierung vorlesen'}
                </button>
                <button
                  type="button"
                  className="v2-action-btn"
                  disabled={uiState === 'working' || isSavingSettings}
                  onClick={() => void runTranslateSelectedText()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  Markierung übersetzen
                </button>
              </div>
            </div>

            {/* Info grid */}
            <div className="v2-info-grid">
              <div className="v2-card v2-info-tile">
                <span className="v2-label">Hotkeys</span>
                <strong className={hotkeyStatus.registered ? 'v2-value--green' : 'v2-value--amber'}>
                  {hotkeyStatus.registered ? 'Aktiv' : 'Inaktiv'}
                </strong>
              </div>
              <div className="v2-card v2-info-tile">
                <span className="v2-label">Speech-Modus</span>
                <strong>{settings.ttsMode}</strong>
              </div>
              <div className="v2-card v2-info-tile">
                <span className="v2-label">Zielsprache</span>
                <strong>{settings.translationTargetLanguage.toUpperCase()}</strong>
              </div>
              <div className="v2-card v2-info-tile">
                <span className="v2-label">Geschwindigkeit</span>
                <strong>{settings.playbackSpeed.toFixed(1)}x</strong>
              </div>
            </div>

            {/* Run history */}
            {runHistory.length > 0 && (
              <div className="v2-card v2-history-card">
                <div className="v2-history-header">
                  <span className="v2-label">Letzte Runs</span>
                  <button type="button" className="v2-ghost-btn" onClick={() => setRunHistory([])}>
                    Verlauf leeren
                  </button>
                </div>
                <div className="v2-history-list">
                  {runHistory.map((entry) => (
                    <div key={entry.id} className={`v2-history-entry v2-history-entry--${entry.state}`}>
                      <div className="v2-history-entry-top">
                        <span className="v2-history-mode">{entry.mode || 'unknown'}</span>
                        <span className="v2-history-time">
                          {new Date(entry.recordedAtMs).toLocaleTimeString()}
                        </span>
                        {entry.hotkeyToFirstPlaybackMs !== null && (
                          <span className="v2-latency-badge">
                            {entry.hotkeyToFirstPlaybackMs} ms
                          </span>
                        )}
                      </div>
                      <p className="v2-history-msg">{entry.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Usage hint */}
            <div className="v2-card v2-hint-card">
              <span className="v2-label">Verwendung</span>
              <p className="v2-hint-text">
                Text in einer beliebigen App markieren, dann{' '}
                <kbd>{hotkeyStatus.accelerator}</kbd> zum Vorlesen oder{' '}
                <kbd>{hotkeyStatus.translateAccelerator}</kbd> zum Übersetzen drücken.
                Alternativ erscheint eine Action Bar direkt über der Markierung.
              </p>
            </div>
          </main>
        )}

        {/* ── Settings ─────────────────────────────────────────────────── */}
        {activeView === 'settings' && (
          <main className="v2-settings-main">
            <div className="v2-card v2-settings-card">
              <div className="v2-settings-header">
                <div>
                  <h2 className="v2-settings-title">Einstellungen</h2>
                  <p className="v2-label">
                    Änderungen werden in der lokalen Konfiguration gespeichert.
                  </p>
                </div>
                <div className="v2-settings-actions">
                  <button
                    type="button"
                    className="v2-action-btn v2-action-btn--primary"
                    disabled={!hasUnsavedChanges || isSavingSettings || uiState === 'working'}
                    onClick={() => void persistSettings(settings)}
                  >
                    {isSavingSettings ? 'Speichert...' : 'Speichern'}
                  </button>
                  <button
                    type="button"
                    className="v2-action-btn v2-action-btn--danger"
                    disabled={isSavingSettings || uiState === 'working'}
                    onClick={() => setShowResetDialog(true)}
                  >
                    Zurücksetzen
                  </button>
                </div>
              </div>

              <div className="v2-settings-grid">
                <label className="v2-field">
                  <span className="v2-label">Speech-Modus</span>
                  <select
                    value={settings.ttsMode}
                    onChange={(e) =>
                      setSettings({ ...settings, ttsMode: e.target.value as AppSettings['ttsMode'] })
                    }
                  >
                    <option value="classic">Classic – stabil, dateibasiert</option>
                    <option value="live">Live – Low-Latency Streaming</option>
                    <option value="realtime">Realtime – experimentell (WebSocket)</option>
                  </select>
                  <span className="v2-field-note">
                    Classic ist der robusteste Modus. Live streamt direkt als PCM. Realtime nutzt den
                    OpenAI Realtime WebSocket.
                  </span>
                </label>

                <label className="v2-field v2-field--wide">
                  <span className="v2-label">Realtime Debug-Fallback</span>
                  <label className="v2-checkbox-row">
                    <input
                      type="checkbox"
                      checked={settings.realtimeAllowLiveFallback}
                      onChange={(e) =>
                        setSettings({ ...settings, realtimeAllowLiveFallback: e.target.checked })
                      }
                    />
                    <span>Bei Realtime-Fehler auf Live-Modus zurückfallen</span>
                  </label>
                  <span className="v2-field-note">
                    Standard: aus. Damit bleiben echte Realtime-Fehler sichtbar. Nur für Debugging einschalten.
                  </span>
                </label>

                <label className="v2-field">
                  <span className="v2-label">Audioformat</span>
                  <select
                    value={settings.ttsFormat}
                    onChange={(e) =>
                      setSettings({ ...settings, ttsFormat: e.target.value as AppSettings['ttsFormat'] })
                    }
                  >
                    <option value="wav">WAV (Standard)</option>
                    <option value="mp3">MP3</option>
                  </select>
                  <span className="v2-field-note">
                    Gilt nur für Classic. Live und Realtime speichern intern als WAV.
                  </span>
                </label>

                <label className="v2-field">
                  <span className="v2-label">Erster-Chunk-Puffer</span>
                  <select
                    value={String(settings.firstChunkLeadingSilenceMs)}
                    onChange={(e) =>
                      setSettings({ ...settings, firstChunkLeadingSilenceMs: Number(e.target.value) })
                    }
                  >
                    {[0, 120, 180, 250, 320].map((v) => (
                      <option key={v} value={v}>
                        {v} ms
                      </option>
                    ))}
                  </select>
                </label>

                <label className="v2-field">
                  <span className="v2-label">Zielsprache (Übersetzung)</span>
                  <select
                    value={settings.translationTargetLanguage}
                    onChange={(e) =>
                      setSettings({ ...settings, translationTargetLanguage: e.target.value })
                    }
                  >
                    {languageOptions.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="v2-field v2-field--wide">
                  <span className="v2-label">Wiedergabegeschwindigkeit</span>
                  <div className="v2-slider-row">
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={settings.playbackSpeed}
                      onChange={(e) =>
                        setSettings({ ...settings, playbackSpeed: Number(e.target.value) })
                      }
                    />
                    <output>{settings.playbackSpeed.toFixed(1)}x</output>
                  </div>
                  <span className="v2-field-note">
                    0.5x = langsamer · 1.0x = Standard · 2.0x = schneller
                  </span>
                </label>

                {showLiveSpeedWarning && (
                  <div className="v2-warning v2-field--wide">
                    <strong>Streaming + Geschwindigkeitsanpassung</strong>
                    <p>
                      Nicht-Standard-Geschwindigkeit im Live/Realtime-Modus erfordert zusätzliches Buffering
                      und erhöht die Startlatenz.
                    </p>
                  </div>
                )}

                {settings.ttsMode === 'realtime' && (
                  <div className="v2-warning v2-field--wide">
                    <strong>Realtime-Modus ist experimentell</strong>
                    <p>
                      Die App verbindet sich per WebSocket mit der OpenAI Realtime API. Fehler bei
                      connect/session/response bleiben sichtbar sofern kein Fallback aktiviert ist.
                    </p>
                  </div>
                )}

                <label className="v2-field v2-field--wide">
                  <span className="v2-label">OpenAI API Key</span>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="sk-..."
                    value={settings.openaiApiKey}
                    onChange={(e) => setSettings({ ...settings, openaiApiKey: e.target.value })}
                  />
                  <span className="v2-field-note">
                    Überschreibt <code>OPENAI_API_KEY</code> aus <code>.env</code>. Leer lassen um{' '}
                    <code>.env</code> zu verwenden.
                  </span>
                </label>
              </div>
            </div>

            {/* App info */}
            <div className="v2-card v2-info-tile v2-app-info">
              <span className="v2-label">App-Status</span>
              <p className="v2-hint-text">{appStatus}</p>
            </div>
          </main>
        )}
      </div>

      {/* ── Reset dialog ─────────────────────────────────────────────────── */}
      {showResetDialog && (
        <div
          className="v2-modal-backdrop"
          role="presentation"
          onClick={() => setShowResetDialog(false)}
        >
          <section
            className="v2-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="v2-modal-close"
              aria-label="Dialog schließen"
              onClick={() => setShowResetDialog(false)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <h2 id="reset-dialog-title">Alle Einstellungen zurücksetzen?</h2>
            <p>
              Setzt alle Einstellungen auf die Standardwerte zurück – inklusive Geschwindigkeit,
              Zielsprache und gespeichertem API Key.
            </p>
            <div className="v2-modal-actions">
              <button
                type="button"
                className="v2-action-btn"
                onClick={() => setShowResetDialog(false)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="v2-action-btn v2-action-btn--danger"
                onClick={() => void resetAllSettings()}
              >
                Ja, zurücksetzen
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
