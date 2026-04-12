import { useTranslation } from 'react-i18next';

type SettingsConfirmDialogProps = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  isBusy?: boolean;
  tone?: 'primary' | 'danger';
  onClose: () => void;
  onConfirm: () => void;
};

export function SettingsConfirmDialog(
  props: SettingsConfirmDialogProps,
): JSX.Element | null {
  const { t } = useTranslation();
  const {
    open,
    title,
    body,
    confirmLabel,
    cancelLabel,
    isBusy = false,
    tone = 'primary',
    onClose,
    onConfirm,
  } = props;

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={isBusy ? undefined : onClose}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          aria-label={t('dialogs.closeReset')}
          onClick={onClose}
          disabled={isBusy}
        >
          x
        </button>
        <h2 id="settings-confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={isBusy}
          >
            {cancelLabel ?? t('dialogs.resetNo')}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'danger-button' : 'primary-button'}
            onClick={onConfirm}
            disabled={isBusy}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
