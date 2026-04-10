import { useTranslation } from 'react-i18next';

import {
  formatVoiceTimerDuration,
  formatVoiceTimerRemaining,
} from '../../hooks/useVoiceTimers';
import type { VoiceTimer } from '../../lib/voiceOverlay';

type TimerListPanelProps = {
  title: string;
  subtitle?: string;
  variant: 'dashboard' | 'dock';
  timers: VoiceTimer[];
  nowMs: number;
  isLoaded: boolean;
  error?: string | null;
  onAdd: () => void;
  onEdit: (timer: VoiceTimer) => void;
  onPause: (timer: VoiceTimer) => void;
  onResume: (timer: VoiceTimer) => void;
  onDelete: (timer: VoiceTimer) => void;
};

export function TimerListPanel(props: TimerListPanelProps): JSX.Element {
  const { t } = useTranslation();
  const {
    title,
    subtitle,
    variant,
    timers,
    nowMs,
    isLoaded,
    error,
    onAdd,
    onDelete,
    onEdit,
    onPause,
    onResume,
  } = props;

  const containerClassName =
    variant === 'dock' ? 'timer-panel timer-panel--dock' : 'timer-panel timer-panel--dashboard';

  return (
    <section className={containerClassName}>
      <div className="timer-panel__header">
        <div>
          <span className="info-label">{title}</span>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <button type="button" className="secondary-button timer-panel__add" onClick={onAdd}>
          {t('timers.addTimer')}
        </button>
      </div>

      {error ? <p className="field-note field-note--error">{error}</p> : null}

      <div className="timer-panel__list">
        {!isLoaded ? (
          <p className="timer-panel__empty">{t('timers.loading')}</p>
        ) : timers.length ? (
          timers.map((timer) => (
            <article
              key={timer.id}
              className={`timer-card timer-card--${timer.status}`}
            >
              <div className="timer-card__copy">
                <div className="timer-card__headline">
                  <strong>{timer.title}</strong>
                  <span className={`timer-status timer-status--${timer.status}`}>
                    {timer.status === 'running'
                      ? t('timers.running')
                      : timer.status === 'paused'
                        ? t('timers.paused')
                        : t('timers.completed')}
                  </span>
                </div>
                <div className="timer-card__meta">
                  <span>{formatVoiceTimerRemaining(timer, nowMs)}</span>
                  <span>{t('timers.totalDuration', { duration: formatVoiceTimerDuration(timer.durationMs) })}</span>
                </div>
              </div>
              <div className="timer-card__actions">
                {timer.status === 'running' ? (
                  <button
                    type="button"
                    className="secondary-button secondary-button--icon"
                    onClick={() => onPause(timer)}
                    aria-label={t('timers.pauseTimer')}
                    title={t('timers.pauseTimer')}
                  >
                    ||
                  </button>
                ) : timer.status === 'paused' ? (
                  <button
                    type="button"
                    className="secondary-button secondary-button--icon"
                    onClick={() => onResume(timer)}
                    aria-label={t('timers.resumeTimer')}
                    title={t('timers.resumeTimer')}
                  >
                    {'>'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary-button secondary-button--icon"
                  onClick={() => onEdit(timer)}
                  aria-label={t('timers.editTimer')}
                  title={t('timers.editTimer')}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="danger-button secondary-button--icon"
                  onClick={() => onDelete(timer)}
                  aria-label={t('timers.deleteTimer')}
                  title={t('timers.deleteTimer')}
                >
                  x
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="timer-panel__empty">{t('timers.empty')}</p>
        )}
      </div>
    </section>
  );
}
