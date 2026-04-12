import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import {
  AppSurfaceCard,
  AppSurfaceContent,
  AppSurfaceHeader,
} from '@/components/ui/app-surface';
import type { ProviderSnapshot } from '../../lib/liveStt';
import type { VoiceConnectionState } from '../../lib/realtimeVoiceAgent';
import type { CreateVoiceAgentSessionResult } from '../../lib/voiceOverlay';

type AssistantStatusSectionProps = {
  voiceAgentState: VoiceConnectionState;
  assistantActive: boolean;
  isLiveTranscribing: boolean;
  liveTranscriptionStatus: string;
  assistantStateDetail: string;
  voiceAgentDetail: string;
  voiceAgentSession: CreateVoiceAgentSessionResult | null;
  assistantWakePhrase: string;
  wakeThreshold: number;
  cueCooldownMs: number;
  liveTranscript: string;
  sttProviderSnapshots: ProviderSnapshot[];
  lastSttDebugLogPath: string;
};

function StatusBlock({
  label,
  body,
  note,
}: {
  label: string;
  body: ReactNode;
  note?: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </p>
      <div className="mt-2 space-y-2">
        <div className="text-sm leading-6 text-[var(--text-primary)]">{body}</div>
        {note ? <p className="text-xs leading-5 text-[var(--text-muted)]">{note}</p> : null}
      </div>
    </div>
  );
}

export function AssistantStatusSection(props: AssistantStatusSectionProps): JSX.Element {
  const { t } = useTranslation();
  const {
    voiceAgentState,
    assistantActive,
    isLiveTranscribing,
    liveTranscriptionStatus,
    assistantStateDetail,
    voiceAgentDetail,
    voiceAgentSession,
    assistantWakePhrase,
    wakeThreshold,
    cueCooldownMs,
    liveTranscript,
    sttProviderSnapshots,
    lastSttDebugLogPath,
  } = props;

  const assistantStateCopy = assistantActive
    ? t('assistantStatus.assistantActive')
    : isLiveTranscribing
      ? t('assistantStatus.assistantInactiveListening')
      : t('assistantStatus.assistantInactiveMuted');

  return (
    <AppSurfaceCard>
      <AppSurfaceHeader
        title={t('assistantStatus.title')}
        description={liveTranscriptionStatus}
        action={
          <Badge variant="default">{voiceAgentState}</Badge>
        }
      />
      <AppSurfaceContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatusBlock
            label={t('assistantStatus.assistantState')}
            body={<p>{assistantStateCopy}</p>}
            note={assistantStateDetail}
          />
          <StatusBlock
            label={t('assistantStatus.realtimeVoiceSession')}
            body={
              <div className="space-y-2">
                <p>{voiceAgentDetail}</p>
                {voiceAgentSession ? (
                  <code className="block rounded-md bg-black/20 px-2 py-1 text-xs text-[var(--text-secondary)]">
                    {voiceAgentSession.profile.model} - {voiceAgentSession.profile.voice} -{' '}
                    {voiceAgentSession.assistantState.sourceAssistantName}
                  </code>
                ) : null}
              </div>
            }
          />
          <StatusBlock
            label={t('assistantStatus.wakePhrase')}
            body={<strong>{assistantWakePhrase}</strong>}
            note={t('assistantStatus.wakePhraseNote')}
          />
          <StatusBlock
            label={t('assistantStatus.cueMatching')}
            body={
              <p>
                {t('assistantStatus.cueMatchingSummary', {
                  threshold: wakeThreshold,
                  cooldownMs: cueCooldownMs,
                })}
              </p>
            }
            note={t('assistantStatus.cueMatchingNote')}
          />
          <StatusBlock
            label={t('assistantStatus.activeTranscript')}
            body={
              <p>
                {liveTranscript ||
                  (assistantActive
                    ? t('assistantStatus.activeTranscriptEmpty')
                    : isLiveTranscribing
                      ? t('assistantStatus.activeTranscriptWaiting')
                      : t('assistantStatus.activeTranscriptUnavailable'))}
              </p>
            }
          />
          {lastSttDebugLogPath ? (
            <StatusBlock
              label={t('assistantStatus.liveSttDebugLog')}
              body={
                <code className="block break-all rounded-md bg-black/20 px-2 py-1 text-xs text-[var(--text-secondary)]">
                  {lastSttDebugLogPath}
                </code>
              }
            />
          ) : null}
        </div>

        {sttProviderSnapshots.length ? (
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              {t('assistantStatus.recognitionStatus')}
            </p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sttProviderSnapshots.map((snapshot) => (
                <div
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                  key={snapshot.provider}
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm text-[var(--text-primary)]">
                      {snapshot.provider}
                    </strong>
                    <Badge variant="default">
                      {snapshot.ok
                        ? t('assistantStatus.providerOk', {
                            latencyMs: snapshot.latencyMs,
                          })
                        : t('assistantStatus.providerError')}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                    {snapshot.transcript || t('assistantStatus.noTranscriptPayload')}
                  </p>
                  {snapshot.detail ? (
                    <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                      {snapshot.detail}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </AppSurfaceContent>
    </AppSurfaceCard>
  );
}
