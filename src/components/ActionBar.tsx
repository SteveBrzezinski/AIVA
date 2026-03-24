import { useEffect, useRef, useState } from 'react';

type ActionBarProps = {
  isMuted: boolean;
  isWorking: boolean;
  hasContext: boolean;
  onRead: () => void;
  onTranslate: () => void;
  onAddContext: () => void;
  onClearContext: () => void;
  onAskQuestion: () => void;
  onVoiceQuestion: () => void;
};

type Position = { x: number; y: number };

export function ActionBar({
  isMuted,
  isWorking,
  hasContext,
  onRead,
  onTranslate,
  onAddContext,
  onClearContext,
  onAskQuestion,
  onVoiceQuestion,
}: ActionBarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;

      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
          return;
        }

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        const barWidth = 380;
        const x = Math.min(
          Math.max(rect.left + rect.width / 2, barWidth / 2 + 8),
          window.innerWidth - barWidth / 2 - 8,
        );
        const y = rect.top + window.scrollY;

        setPosition({ x, y });
        setVisible(true);
      }, 10);
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;
      setVisible(false);
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  if (!visible) return null;

  const dismiss = (fn: () => void) => () => {
    setVisible(false);
    fn();
  };

  return (
    <div
      ref={barRef}
      className="action-bar"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      role="toolbar"
      aria-label="Text Aktionen"
    >
      <button
        type="button"
        className="action-bar-btn action-bar-btn--primary"
        onClick={dismiss(onRead)}
        disabled={isWorking}
        title="Markierten Text vorlesen"
      >
        <svg className="action-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        Vorlesen
      </button>

      <div className="action-bar-sep" />

      <button
        type="button"
        className="action-bar-btn"
        onClick={dismiss(onTranslate)}
        disabled={isWorking}
        title="Markierten Text übersetzen"
      >
        <svg className="action-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        Übersetzen
      </button>

      <div className="action-bar-sep" />

      <button
        type="button"
        className="action-bar-btn"
        onClick={onAddContext}
        title="Zu Kontext hinzufügen"
      >
        <svg className="action-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Kontext
      </button>

      {hasContext && (
        <>
          <div className="action-bar-sep" />
          <button
            type="button"
            className="action-bar-btn action-bar-btn--danger"
            onClick={dismiss(onClearContext)}
            title="Kontext leeren"
          >
            <svg className="action-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Leeren
          </button>
        </>
      )}

      <div className="action-bar-sep" />

      <button
        type="button"
        className="action-bar-btn"
        onClick={dismiss(onAskQuestion)}
        title="Frage zu markiertem Text stellen"
      >
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
          <button
            type="button"
            className="action-bar-btn"
            onClick={dismiss(onVoiceQuestion)}
            title="Frage sprechen"
          >
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
