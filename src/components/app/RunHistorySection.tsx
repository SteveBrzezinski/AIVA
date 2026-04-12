import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  AppSurfaceCard,
  AppSurfaceContent,
  AppSurfaceHeader,
} from '@/components/ui/app-surface';
import { Separator } from '@/components/ui/separator';
import type { RunHistoryEntry } from '../../lib/app/appModel';

type RunHistorySectionProps = {
  entries: RunHistoryEntry[];
  onClear: () => void;
};

export function RunHistorySection(props: RunHistorySectionProps): JSX.Element | null {
  const { t } = useTranslation();
  const { entries, onClear } = props;

  if (!entries.length) {
    return null;
  }

  return (
    <AppSurfaceCard>
      <AppSurfaceHeader
        title={t('runHistory.title')}
        action={
          <Button
            type="button"
            variant="outline"
            className="border-white/15 bg-white/5 text-[var(--text-primary)] hover:bg-white/10"
            onClick={onClear}
          >
            {t('runHistory.clear')}
          </Button>
        }
      />
      <AppSurfaceContent className="space-y-4">
        {entries.map((entry, index) => (
          <div key={entry.id} className="space-y-3">
            {index > 0 ? <Separator className="bg-white/10" /> : null}
            <div className="space-y-1.5 pt-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                <strong>{entry.mode || t('runHistory.unknownMode')}</strong>
                {entry.requestedMode
                  ? ` - ${t('runHistory.requestedMode', { mode: entry.requestedMode })}`
                  : ''}
                {entry.sessionStrategy ? ` - ${entry.sessionStrategy}` : ''}
              </p>
              <p className="text-sm text-[var(--text-secondary)]">
                {new Date(entry.recordedAtMs).toLocaleTimeString()} - {entry.message}
              </p>
              <p className="text-xs leading-5 text-[var(--text-muted)]">
                {t('runHistory.metrics', {
                  hotkeyToAudio: entry.hotkeyToFirstPlaybackMs ?? '-',
                  capture: entry.captureDurationMs ?? '-',
                  captureToTts: entry.captureToTtsStartMs ?? '-',
                  ttsToAudio: entry.ttsToFirstAudioMs ?? '-',
                  audioToPlayback: entry.firstAudioToPlaybackMs ?? '-',
                })}
              </p>
            </div>
          </div>
        ))}
      </AppSurfaceContent>
    </AppSurfaceCard>
  );
}
