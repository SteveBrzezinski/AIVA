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
        <AlertDialogFooter className="border-[color:var(--panel-border)]/70 bg-white/5">
          <AlertDialogCancel
            onClick={onClose}
            disabled={isBusy}
            className="border-white/15 bg-white/5 text-[var(--text-primary)] hover:bg-white/10"
          >
            {cancelLabel ?? t('dialogs.resetNo')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isBusy}
            variant={tone === 'danger' ? 'destructive' : 'default'}
            className={
              tone === 'danger'
                ? 'border-rose-200/15 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20'
                : 'border-white/15 bg-white/12 text-[var(--text-primary)] hover:bg-white/18'
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
