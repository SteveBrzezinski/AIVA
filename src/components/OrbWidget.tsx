import { useState } from 'react';

export type OrbState = 'idle' | 'working' | 'listening' | 'speaking' | 'success' | 'error';

type OrbWidgetProps = {
  isMuted: boolean;
  orbState: OrbState;
  settingsOpen: boolean;
  onMuteToggle: () => void;
  onChatOpen: () => void;
  onVoiceActivate: () => void;
  onSettingsToggle: () => void;
};

export function OrbWidget({
  isMuted,
  orbState,
  settingsOpen,
  onMuteToggle,
  onChatOpen,
  onVoiceActivate,
  onSettingsToggle,
}: OrbWidgetProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="orb-wrapper"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <nav
        className={`orb-nav${isHovered ? ' orb-nav--open' : ''}`}
        aria-label="AI Assistent Navigation"
      >
        <button
          type="button"
          className={`orb-nav-btn${settingsOpen ? ' orb-nav-btn--active' : ''}`}
          onClick={onSettingsToggle}
          title="Einstellungen"
          aria-label="Einstellungen öffnen"
          aria-pressed={settingsOpen}
        >
          <svg className="orb-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="orb-nav-label">Settings</span>
        </button>

        {!isMuted && (
          <button
            type="button"
            className="orb-nav-btn"
            onClick={onVoiceActivate}
            title="Sprechen"
            aria-label="Spracheingabe aktivieren"
          >
            <svg className="orb-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span className="orb-nav-label">Sprechen</span>
          </button>
        )}

        <button
          type="button"
          className="orb-nav-btn"
          onClick={onChatOpen}
          title="Chat öffnen"
          aria-label="Chat öffnen"
        >
          <svg className="orb-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="orb-nav-label">Chat</span>
        </button>

        <button
          type="button"
          className="orb-nav-btn"
          onClick={onMuteToggle}
          title={isMuted ? 'Ton aktivieren' : 'Stumm schalten'}
          aria-label={isMuted ? 'Ton aktivieren' : 'Stumm schalten'}
          aria-pressed={isMuted}
        >
          {isMuted ? (
            <svg className="orb-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg className="orb-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
          <span className="orb-nav-label">{isMuted ? 'Ton an' : 'Stumm'}</span>
        </button>
      </nav>

      <div
        className={`orb orb--${orbState}`}
        aria-label="AI Assistent Status"
        role="img"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="orb-inner" />
      </div>
    </div>
  );
}
