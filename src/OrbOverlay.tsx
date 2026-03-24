/**
 * OrbOverlay – rendered exclusively in the transparent, always-on-top
 * "overlay" Tauri window that covers the full primary monitor.
 *
 * The window is click-through by default (Rust toggles ignore_cursor_events).
 * It becomes interactive when the mouse enters the Orb zone (bottom-right)
 * or the action bar zone. WS_EX_NOACTIVATE ensures the underlying app
 * (where the user's text is selected) is never defocused when buttons are clicked.
 *
 * Text is PRE-CAPTURED in Rust via Win32 SendInput+clipboard before the action
 * bar is shown. Button clicks therefore do not need a second Ctrl+C and work
 * even if the overlay window somehow affects focus.
 */

import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { OrbWidget, type OrbState } from './components/OrbWidget';
import {
  getSettings,
  onHotkeyStatus,
  speakText,
  translateText,
} from './lib/voiceOverlay';

type UiState = 'idle' | 'working' | 'success' | 'error';

type ActionBarPos = {
  physX: number;
  physY: number;
  screenW: number;
  screenH: number;
};

// ── Global Action Bar ─────────────────────────────────────────────────────────

type GlobalActionBarProps = {
  pos: ActionBarPos;
  isMuted: boolean;
  isWorking: boolean;
  hasContext: boolean;
  onRead: () => void;
  onTranslate: () => void;
  onAddContext: () => void;
  onClearContext: () => void;
  onAskQuestion: () => void;
  onDismiss: () => void;
};

function GlobalActionBar({
  pos,
  isMuted,
  isWorking,
  hasContext,
  onRead,
  onTranslate,
  onAddContext,
  onClearContext,
  onAskQuestion,
  onDismiss,
}: GlobalActionBarProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Convert physical coords → logical CSS pixels using screen dimensions from Rust
  const logX = Math.round((pos.physX / pos.screenW) * window.innerWidth);
  const logY = Math.round((pos.physY / pos.screenH) * window.innerHeight);
  const dpr = window.devicePixelRatio || 1;

  // After mount: tell Rust the physical hitbox so it can turn off click-through
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const phX = Math.round(rect.left * dpr);
    const phY = Math.round(rect.top * dpr);
    const phW = Math.round(rect.width * dpr);
    const phH = Math.round(rect.height * dpr);
    void invoke('set_action_bar_rect', { x: phX, y: phY, w: phW, h: phH });
    return () => { void invoke('clear_action_bar_rect'); };
  }, [pos, dpr]);

  const act = (fn: () => void) => () => { onDismiss(); fn(); };

  return (
    <div
      ref={ref}
      className="action-bar"
      style={{ left: `${logX}px`, top: `${logY}px` }}
      role="toolbar"
      aria-label="Text Aktionen"
    >
      <button type="button" className="action-bar-btn action-bar-btn--primary"
        onClick={act(onRead)} disabled={isWorking} title="Markierten Text vorlesen">
        <svg className="action-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        Vorlesen
      </button>

      <div className="action-bar-sep" />

      <button type="button" className="action-bar-btn"
        onClick={act(onTranslate)} disabled={isWorking} title="Markierten Text übersetzen">
        <svg className="action-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        Übersetzen
      </button>

      <div className="action-bar-sep" />

      <button type="button" className="action-bar-btn"
        onClick={onAddContext} title="Zu Kontext hinzufügen">
        <svg className="action-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Kontext
      </button>

      {hasContext && (
        <>
          <div className="action-bar-sep" />
          <button type="button" className="action-bar-btn action-bar-btn--danger"
            onClick={act(onClearContext)} title="Kontext leeren">
            <svg className="action-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Leeren
          </button>
        </>
      )}

      <div className="action-bar-sep" />

      <button type="button" className="action-bar-btn"
        onClick={act(onAskQuestion)} title="Frage stellen">
        <svg className="action-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Fragen
      </button>

      {!isMuted && (
        <>
          <div className="action-bar-sep" />
          <button type="button" className="action-bar-btn"
            onClick={act(onAskQuestion)} title="Frage sprechen">
            <svg className="action-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            Sprechen
          </button>
        </>
      )}
    </div>
  );
}

// ── OrbOverlay root ───────────────────────────────────────────────────────────

export function OrbOverlay() {
  const [uiState, setUiState] = useState<UiState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [contextCount, setContextCount] = useState(0);
  const [actionBarPos, setActionBarPos] = useState<ActionBarPos | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable ref so effects never close over stale state
  const showAtPosRef = useRef(
    (physX: number, physY: number, screenW: number, screenH: number) => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      setActionBarPos({ physX, physY, screenW, screenH });
      dismissTimerRef.current = setTimeout(() => setActionBarPos(null), 6000);
    },
  );

  const showError = (msg: string) => {
    setErrorToast(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorToast(null), 5000);
  };

  // Make the window background transparent
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const root = document.getElementById('root');
    if (root) root.style.background = 'transparent';
  }, []);

  // Listen for hotkey status changes (orb state)
  useEffect(() => {
    let unlisten: (() => void | Promise<void>) | undefined;
    void onHotkeyStatus((status) => {
      setUiState(
        status.state === 'working' ? 'working'
        : status.state === 'error' ? 'error'
        : status.state === 'success' ? 'success'
        : 'idle',
      );
    }).then((cleanup) => { unlisten = cleanup; });
    return () => { void unlisten?.(); };
  }, []);

  // Listen for text-selection events from Rust (primary path)
  useEffect(() => {
    const unlisten = listen<{ x: number; y: number; screen_w: number; screen_h: number }>(
      'text-selected',
      (event) => {
        const { x, y, screen_w, screen_h } = event.payload;
        showAtPosRef.current(x, y, screen_w, screen_h);
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  // Polling fallback every 200 ms in case the event is missed
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const result = await invoke<[number, number, number, number] | null>('poll_selection');
        if (result) {
          const [x, y, sw, sh] = result;
          showAtPosRef.current(x, y, sw, sh);
        }
      } catch { /* command may not be ready yet */ }
    }, 200);
    return () => clearInterval(id);
  }, []);

  const dismissActionBar = () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setActionBarPos(null);
  };

  // ── Actions – use the pre-captured text so no second Ctrl+C is needed ──────

  const runRead = async () => {
    setUiState('working');
    try {
      const text = await invoke<string | null>('get_captured_text');
      if (!text) {
        showError('Text nicht mehr verfügbar – bitte neu markieren.');
        setUiState('error');
        void emit('overlay-action', { action: 'speak', state: 'error', message: 'Text nicht mehr verfügbar – bitte neu markieren.' });
        return;
      }
      const s = await getSettings();
      const result = await speakText(text, {
        autoplay: true,
        format: s.ttsFormat,
        mode: s.ttsMode,
        maxParallelRequests: 3,
        voice: 'alloy',
        firstChunkLeadingSilenceMs: s.firstChunkLeadingSilenceMs,
      });
      setUiState('success');
      void emit('overlay-action', {
        action: 'speak',
        state: 'success',
        message: `Vorlesen im ${result.mode}-Modus${result.startLatencyMs ? ` · ${result.startLatencyMs} ms` : ''}`,
        capturedText: text,
        startLatencyMs: result.startLatencyMs ?? null,
        ttsMode: result.mode,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showError(msg);
      setUiState('error');
      void emit('overlay-action', { action: 'speak', state: 'error', message: msg });
    }
  };

  const runTranslate = async () => {
    setUiState('working');
    try {
      const text = await invoke<string | null>('get_captured_text');
      if (!text) {
        showError('Text nicht mehr verfügbar – bitte neu markieren.');
        setUiState('error');
        void emit('overlay-action', { action: 'translate', state: 'error', message: 'Text nicht mehr verfügbar – bitte neu markieren.' });
        return;
      }
      const s = await getSettings();
      const translated = await translateText(text, { targetLanguage: s.translationTargetLanguage });
      const result = await speakText(translated.text, {
        autoplay: true,
        format: s.ttsFormat,
        mode: s.ttsMode,
        maxParallelRequests: 3,
        firstChunkLeadingSilenceMs: s.firstChunkLeadingSilenceMs,
      });
      setUiState('success');
      void emit('overlay-action', {
        action: 'translate',
        state: 'success',
        message: `Übersetzt nach ${translated.targetLanguage}${result.startLatencyMs ? ` · ${result.startLatencyMs} ms` : ''}`,
        capturedText: text,
        translatedText: translated.text,
        startLatencyMs: result.startLatencyMs ?? null,
        ttsMode: result.mode,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showError(msg);
      setUiState('error');
      void emit('overlay-action', { action: 'translate', state: 'error', message: msg });
    }
  };

  const orbState: OrbState =
    uiState === 'working' ? 'working'
    : uiState === 'error' ? 'error'
    : uiState === 'success' ? 'success'
    : 'idle';

  return (
    <div className="overlay-root">
      {actionBarPos && (
        <GlobalActionBar
          pos={actionBarPos}
          isMuted={isMuted}
          isWorking={uiState === 'working'}
          hasContext={contextCount > 0}
          onRead={() => void runRead()}
          onTranslate={() => void runTranslate()}
          onAddContext={() => setContextCount((n) => n + 1)}
          onClearContext={() => setContextCount(0)}
          onAskQuestion={() => { /* Chat – V2 folgt */ }}
          onDismiss={dismissActionBar}
        />
      )}

      {errorToast && (
        <div className="overlay-error-toast" role="alert">
          {errorToast}
        </div>
      )}

      <OrbWidget
        isMuted={isMuted}
        orbState={orbState}
        settingsOpen={false}
        onMuteToggle={() => setIsMuted((m) => !m)}
        onChatOpen={() => { /* Chat – V2 folgt */ }}
        onVoiceActivate={() => { /* Voice – V2 folgt */ }}
        onSettingsToggle={() => void invoke('show_main_window')}
      />
    </div>
  );
}
