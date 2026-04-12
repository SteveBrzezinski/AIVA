import { useTranslation } from 'react-i18next';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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

export function SettingsConfirmDialog(props: SettingsConfirmDialogProps): JSX.Element {
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

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isBusy) {
          onClose();
        }
      }}
    >
      <AlertDialogContent
        className="border border-[color:var(--panel-border)] bg-transparent text-[var(--text-primary)] shadow-none"
        style={{
          background: 'var(--panel-bg)',
          boxShadow: 'var(--panel-shadow)',
        }}
      >
        <AlertDialogHeader className="items-start text-left">
          <AlertDialogTitle className="text-[var(--text-primary)]">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[var(--text-secondary)]">
            {body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="border-[color:var(--panel-border)]/70 bg-[var(--panel-bg-muted)]">
          <AlertDialogCancel
            onClick={onClose}
            disabled={isBusy}
            className="border-[color:var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--text-primary)] hover:bg-[var(--button-secondary-bg-hover)]"
          >
            {cancelLabel ?? t('dialogs.resetNo')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isBusy}
            variant={tone === 'danger' ? 'destructive' : 'default'}
            className={
              tone === 'danger'
                ? 'border-[color:var(--danger-border)] bg-[var(--danger-bg)] text-[color:#8f2d3a] hover:bg-[rgba(186,49,64,0.18)]'
                : 'border-[color:var(--button-primary-border)] bg-[var(--button-primary-bg)] !text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)] hover:bg-[var(--button-primary-bg-hover)]'
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
