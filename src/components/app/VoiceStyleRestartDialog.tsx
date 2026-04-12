import { useTranslation } from 'react-i18next';

type VoiceStyleRestartDialogProps = {
  open: boolean;
  changeSummary: {
    genderChanged: boolean;
    modelChanged: boolean;
    voiceChanged: boolean;
    providerChanged: boolean;
  };
  isBusy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function VoiceStyleRestartDialog(
  props: VoiceStyleRestartDialogProps,
): JSX.Element | null {
  const { t } = useTranslation();
  const { open, changeSummary, isBusy, onClose, onConfirm } = props;

  if (!open) {
    return null;
  }

  const { genderChanged, modelChanged, voiceChanged, providerChanged } = changeSummary;
  const keyStem =
    genderChanged && !modelChanged && !voiceChanged && !providerChanged
      ? 'voiceStyleRestart'
      : modelChanged && !voiceChanged && !providerChanged && !genderChanged
        ? 'voiceModelRestart'
        : voiceChanged && !modelChanged && !providerChanged && !genderChanged
          ? 'voiceSelectionRestart'
          : providerChanged && !modelChanged && !voiceChanged && !genderChanged
            ? 'voiceProviderRestart'
            : 'voiceSessionConfigRestart';
  const titleKey =
    `dialogs.${keyStem}Title`;
  const bodyKey = `dialogs.${keyStem}Body`;
  const detailKey = `dialogs.${keyStem}Detail`;
  const confirmKey = `dialogs.${keyStem}Confirm`;
  const confirmingKey = `dialogs.${keyStem}Confirming`;

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
        <h2 id="voice-style-restart-title">{t(titleKey)}</h2>
        <p>{t(bodyKey)}</p>
        <p>{t(detailKey)}</p>
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
            {isBusy ? t(confirmingKey) : t(confirmKey)}
          </button>
        </div>
      </section>
    </div>
  );
}
