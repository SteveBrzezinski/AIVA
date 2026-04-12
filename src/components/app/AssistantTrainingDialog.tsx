import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import type { CalibrationStep } from '../../lib/app/appModel';

type AssistantTrainingDialogProps = {
  step: CalibrationStep | null;
  isRecording: boolean;
  liveTranscript: string;
  capturedTranscript: string;
  status: string;
  error: string;
  onClose: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onRetry: () => void;
  onConfirm: () => void;
};

export function AssistantTrainingDialog(
  props: AssistantTrainingDialogProps,
): JSX.Element | null {
  const { t } = useTranslation();
  const {
    step,
    isRecording,
    liveTranscript,
    capturedTranscript,
    status,
    error,
    onClose,
    onStartRecording,
    onStopRecording,
    onRetry,
    onConfirm,
  } = props;

  if (!step) {
    return null;
  }

  return (
    <Dialog open={step !== null} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className="max-w-2xl border border-[color:var(--panel-border)] bg-transparent text-[var(--text-primary)] shadow-none"
        style={{
          background: 'var(--panel-bg)',
          boxShadow: 'var(--panel-shadow)',
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)]">
            {t('dialogs.trainingTitle')}
          </DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {step.progress}) {step.headline}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-6 text-center">
            <strong className="text-lg text-[var(--text-primary)]">{step.prompt}</strong>
          </div>

          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            <Trans
              i18nKey="dialogs.trainingNote"
              values={{ language: step.recognitionLanguage }}
              components={{ code: <code /> }}
            />
          </p>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              className="border-white/15 bg-white/12 text-[var(--text-primary)] hover:bg-white/18"
              disabled={isRecording}
              onClick={onStartRecording}
            >
              {t('dialogs.start')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-white/15 bg-white/5 text-[var(--text-primary)] hover:bg-white/10"
              disabled={!isRecording}
              onClick={onStopRecording}
            >
              {t('dialogs.stop')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-white/15 bg-white/5 text-[var(--text-primary)] hover:bg-white/10"
              disabled={!capturedTranscript.trim()}
              onClick={onRetry}
            >
              {t('dialogs.retry')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-white/15 bg-white/5 text-[var(--text-primary)] hover:bg-white/10"
              disabled={!capturedTranscript.trim()}
              onClick={onConfirm}
            >
              {t('dialogs.confirm')}
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {t('dialogs.liveCapture')}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                {liveTranscript || t('dialogs.noTranscriptYet')}
              </p>
            </section>
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {t('dialogs.capturedSample')}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                {capturedTranscript || t('dialogs.reviewAfterStop')}
              </p>
            </section>
          </div>

          {status ? <p className="text-sm text-[var(--text-secondary)]">{status}</p> : null}
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
