import { useTranslation } from 'react-i18next';

type VoiceStyleRestartDialogProps = {
  open: boolean;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function VoiceStyleRestartDialog(
  props: VoiceStyleRestartDialogProps,
): JSX.Element | null {
  const { t } = useTranslation();
  const { open, isBusy, onClose, onConfirm } = props;

  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={isBusy ? undefined : onClose}
    >
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-style-restart-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          aria-label={t('dialogs.closeVoiceStyleRestart')}
          onClick={onClose}
          disabled={isBusy}
        >
          x
        </button>
        <h2 id="voice-style-restart-title">{t('dialogs.voiceStyleRestartTitle')}</h2>
        <p>{t('dialogs.voiceStyleRestartBody')}</p>
        <p>{t('dialogs.voiceStyleRestartDetail')}</p>
        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={isBusy}
          >
            {t('dialogs.voiceStyleRestartNo')}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onConfirm}
            disabled={isBusy}
          >
            {isBusy
              ? t('dialogs.voiceStyleRestartConfirming')
              : t('dialogs.voiceStyleRestartConfirm')}
          </button>
        </div>
      </section>
    </div>
  );
}
