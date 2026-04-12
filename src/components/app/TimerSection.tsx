import { useTranslation } from 'react-i18next';

import { TimerListPanel } from '../timers/TimerListPanel';
import type { VoiceTimer } from '../../lib/voiceOverlay';

type TimerSectionProps = {
  timers: VoiceTimer[];
  nowMs: number;
  isLoaded: boolean;
  error: string | null;
  onAdd: () => void;
  onEdit: (timer: VoiceTimer) => void;
  onPause: (timer: VoiceTimer) => void;
  onResume: (timer: VoiceTimer) => void;
  onDelete: (timer: VoiceTimer) => void;
};

export function TimerSection(props: TimerSectionProps): JSX.Element {
  const { t } = useTranslation();
  const { error, isLoaded, nowMs, onAdd, onDelete, onEdit, onPause, onResume, timers } = props;

  return (
    <TimerListPanel
      title={t('timers.sectionTitle')}
      subtitle={t('timers.sectionBody')}
      variant="dashboard"
      timers={timers}
      nowMs={nowMs}
      isLoaded={isLoaded}
      error={error}
      onAdd={onAdd}
      onEdit={onEdit}
      onPause={onPause}
      onResume={onResume}
      onDelete={onDelete}
    />
  );
}
