import { useState } from 'react';

type EdgeNavProps = {
  onSettingsOpen: () => void;
  onChatOpen: () => void;
};

export function EdgeNav({ onSettingsOpen, onChatOpen }: EdgeNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className={`edge-nav${isOpen ? ' edge-nav--open' : ''}`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      {/* Trigger strip – always visible, 10px wide AI-themed gradient bar */}
      <div className="edge-nav-trigger" aria-hidden="true">
        <div className="edge-nav-trigger-indicator" />
      </div>

      {/* Buttons slide out left-to-right */}
      <nav className="edge-nav-panel" aria-label="AI Assistent Navigation">
        <button
          type="button"
          className="edge-nav-btn"
          onClick={onSettingsOpen}
          title="Einstellungen"
          aria-label="Einstellungen öffnen"
        >
          <svg className="edge-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="edge-nav-label">Einstellungen</span>
        </button>

        <button
          type="button"
          className="edge-nav-btn"
          onClick={onChatOpen}
          title="Chat öffnen"
          aria-label="Chat öffnen"
        >
          <svg className="edge-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="edge-nav-label">Chat</span>
        </button>
      </nav>
    </div>
  );
}
