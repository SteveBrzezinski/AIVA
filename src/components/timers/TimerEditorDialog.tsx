import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VoiceTimer } from '../../lib/voiceOverlay';
import {
  formatVoiceTimerDuration,
  getVoiceTimerRemainingMs,
} from '../../hooks/useVoiceTimers';

type TimerEditorDialogProps = {
  open: boolean;
  timer?: VoiceTimer | null;
  variant?: 'modal' | 'dock';
  isBusy: boolean;
  onClose: () => void;
  onSubmit: (payload: { title: string; durationMinutes: number; durationSeconds: number }) => void;
};

function splitDuration(durationMs: number): { minutes: number; seconds: number } {
  const totalSeconds = Math.max(1, Math.floor(durationMs / 1000));
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  };
}

function TimerEditorDialogContent({
  timer,
  variant = 'modal',
  isBusy,
  onClose,
  onSubmit,
}: Omit<TimerEditorDialogProps, 'open'>): JSX.Element {
  const { t } = useTranslation();
  const defaults = useMemo(
    () => splitDuration(timer ? getVoiceTimerRemainingMs(timer) : 15 * 60 * 1000),
    [timer],
  );
  const [title, setTitle] = useState(() => timer?.title ?? '');
  const [minutes, setMinutes] = useState(() => String(defaults.minutes));
  const [seconds, setSeconds] = useState(() => String(defaults.seconds));

  const durationMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
  const durationSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const durationPreview = formatVoiceTimerDuration(
    Math.max(1, durationMinutes * 60 + durationSeconds) * 1000,
  );
  const saveDisabled = isBusy || (durationMinutes === 0 && durationSeconds === 0);
  const isModal = variant === 'modal';

  return (
    <div
      className={isModal ? 'modal-backdrop timer-editor-backdrop' : 'timer-editor-popover'}
      role="presentation"
      onClick={isModal && !isBusy ? onClose : undefined}
    >
      <section
        className={`modal-card timer-editor-card ${
          isModal ? 'timer-editor-card--modal' : 'timer-editor-card--dock'
        }`}
        role="dialog"
        aria-modal={isModal ? true : undefined}
        aria-labelledby="timer-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          aria-label={t('dialogs.closeTimerEditor')}
          onClick={onClose}
          disabled={isBusy}
        >
          x
        </button>
        <span className="info-label timer-editor-eyebrow">
          {timer ? t('timers.editTimer') : t('timers.addTimer')}
        </span>
        <h2 id="timer-editor-title">
          {timer ? t('dialogs.timerEditorTitleEdit') : t('dialogs.timerEditorTitleCreate')}
        </h2>
        <p>{t('dialogs.timerEditorBody')}</p>

        <div className="timer-editor-grid">
          <label className="settings-field settings-field--wide">
            <span className="info-label">{t('timers.timerName')}</span>
            <input
              type="text"
              autoComplete="off"
              placeholder={t('dialogs.timerEditorNamePlaceholder')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={isBusy}
            />
            <span className="field-note">{t('dialogs.timerEditorNameNote')}</span>
          </label>

          <label className="settings-field">
            <span className="info-label">{t('dialogs.timerEditorMinutes')}</span>
            <input
              type="number"
              min="0"
              max="1440"
              step="1"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              disabled={isBusy}
            />
          </label>

          <label className="settings-field">
            <span className="info-label">{t('dialogs.timerEditorSeconds')}</span>
            <input
              type="number"
              min="0"
              max="59"
              step="1"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              disabled={isBusy}
            />
          </label>
        </div>

        <div className="timer-editor-preview">
          <strong>{t('dialogs.timerEditorPreviewLabel')}</strong>
          <span>{durationPreview}</span>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={isBusy}
          >
            {t('dialogs.timerEditorCancel')}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onSubmit({ title: title.trim(), durationMinutes, durationSeconds })}
            disabled={saveDisabled}
          >
            {isBusy
              ? t('dialogs.timerEditorSaving')
              : timer
                ? t('dialogs.timerEditorSave')
                : t('dialogs.timerEditorCreate')}
          </button>
        </div>
      </section>
    </div>
  );
}

export function TimerEditorDialog(
  props: TimerEditorDialogProps,
): JSX.Element | null {
  const { open, timer, variant, isBusy, onClose, onSubmit } = props;

  if (!open) {
    return null;
  }

  return (
    <TimerEditorDialogContent
      key={timer?.id ?? 'create'}
      timer={timer}
      variant={variant}
      isBusy={isBusy}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}
