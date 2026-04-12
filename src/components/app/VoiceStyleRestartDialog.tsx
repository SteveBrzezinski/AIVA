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

export function VoiceStyleRestartDialog(props: VoiceStyleRestartDialogProps): JSX.Element {
  const { t } = useTranslation();
  const { open, changeSummary, isBusy, onClose, onConfirm } = props;

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
  const titleKey = `dialogs.${keyStem}Title`;
  const bodyKey = `dialogs.${keyStem}Body`;
  const detailKey = `dialogs.${keyStem}Detail`;
  const confirmKey = `dialogs.${keyStem}Confirm`;
  const confirmingKey = `dialogs.${keyStem}Confirming`;

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
          <AlertDialogTitle className="text-[var(--text-primary)]">
            {t(titleKey)}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-[var(--text-secondary)]">
            <span className="block">{t(bodyKey)}</span>
            <span className="block">{t(detailKey)}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="border-[color:var(--panel-border)]/70 bg-white/5">
          <AlertDialogCancel
            onClick={onClose}
            disabled={isBusy}
            className="border-white/15 bg-white/5 text-[var(--text-primary)] hover:bg-white/10"
          >
            {t('dialogs.voiceStyleRestartNo')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isBusy}
            className="border-white/15 bg-white/12 text-[var(--text-primary)] hover:bg-white/18"
          >
            {isBusy ? t(confirmingKey) : t(confirmKey)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
