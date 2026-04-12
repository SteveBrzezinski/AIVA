import { Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AppSurfaceCard,
  AppSurfaceContent,
  AppSurfaceHeader,
} from '@/components/ui/app-surface';
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

  return (
    <AppSurfaceCard>
      <AppSurfaceHeader
        title={title}
        description={subtitle}
        action={
          <Button
            type="button"
            className="border-[color:var(--button-primary-border)] bg-[var(--button-primary-bg)] text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)] hover:bg-[var(--button-primary-bg-hover)]"
            variant="outline"
            onClick={onAdd}
          >
            <Plus className="size-4" />
            {t('timers.addTimer')}
          </Button>
        }
      />
      <AppSurfaceContent className="space-y-4">
        {error ? <p className="text-sm text-[color:#8f2d3a]">{error}</p> : null}

        {!isLoaded ? (
          <p className="text-sm text-[var(--text-muted)]">{t('timers.loading')}</p>
        ) : timers.length ? (
          <div className="space-y-3">
            {timers.map((timer) => (
              <article
                key={timer.id}
                className="flex flex-col gap-4 rounded-xl border border-[color:var(--panel-border)] bg-[var(--panel-bg-deep)] p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <strong className="text-base text-[var(--text-primary)]">{timer.title}</strong>
                    <Badge
                      variant="default"
                    >
                      {timer.status === 'running'
                        ? t('timers.running')
                        : timer.status === 'paused'
                          ? t('timers.paused')
                          : t('timers.completed')}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)]">
                    <span>{formatVoiceTimerRemaining(timer, nowMs)}</span>
                    <span>
                      {t('timers.totalDuration', {
                        duration: formatVoiceTimerDuration(timer.durationMs),
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {timer.status === 'running' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="border-[color:var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--text-primary)] hover:bg-[var(--button-secondary-bg-hover)]"
                      onClick={() => onPause(timer)}
                      aria-label={t('timers.pauseTimer')}
                      title={t('timers.pauseTimer')}
                    >
                      <Pause className="size-4" />
                    </Button>
                  ) : timer.status === 'paused' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="border-[color:var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--text-primary)] hover:bg-[var(--button-secondary-bg-hover)]"
                      onClick={() => onResume(timer)}
                      aria-label={t('timers.resumeTimer')}
                      title={t('timers.resumeTimer')}
                    >
                      <Play className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="border-[color:var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--text-primary)] hover:bg-[var(--button-secondary-bg-hover)]"
                    onClick={() => onEdit(timer)}
                    aria-label={t('timers.editTimer')}
                    title={t('timers.editTimer')}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="border-[color:var(--danger-border)] bg-[var(--danger-bg)] text-[color:#8f2d3a] hover:bg-[rgba(186,49,64,0.18)]"
                    onClick={() => onDelete(timer)}
                    aria-label={t('timers.deleteTimer')}
                    title={t('timers.deleteTimer')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">{t('timers.empty')}</p>
        )}
      </AppSurfaceContent>
    </AppSurfaceCard>
  );
}
