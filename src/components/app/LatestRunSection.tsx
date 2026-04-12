import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import {
  AppSurfaceCard,
  AppSurfaceContent,
  AppSurfaceHeader,
} from '@/components/ui/app-surface';
import { formatTimestamp } from '../../lib/app/appModel';

type LatestRunSectionProps = {
  uiState: 'idle' | 'working' | 'success' | 'error';
  message: string;
  capturedPreview: string;
  translatedPreview: string;
  lastTtsMode: string;
  lastRequestedTtsMode: string;
  lastSessionStrategy: string;
  lastSessionId: string;
  lastSessionFallbackReason: string;
  lastSttProvider: string;
  lastSttActiveTranscript: string;
  lastSttDebugLogPath: string;
  startLatencyMs: number | null;
  hotkeyToFirstAudioMs: number | null;
  hotkeyToFirstPlaybackMs: number | null;
  captureDurationMs: number | null;
  captureToTtsStartMs: number | null;
  ttsToFirstAudioMs: number | null;
  firstAudioToPlaybackMs: number | null;
  hotkeyStartedAtMs: number | null;
  captureStartedAtMs: number | null;
  captureFinishedAtMs: number | null;
  ttsStartedAtMs: number | null;
  firstAudioReceivedAtMs: number | null;
  firstAudioPlaybackStartedAtMs: number | null;
  lastAudioPath: string;
  lastAudioOutputDirectory: string;
  lastAudioChunkCount: number;
};

function ResultBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </p>
      <div className="mt-2 space-y-1.5 text-sm leading-6 text-[var(--text-secondary)]">
        {children}
      </div>
    </div>
  );
}

export function LatestRunSection(props: LatestRunSectionProps): JSX.Element {
  const { t } = useTranslation();
  const {
    uiState,
    message,
    capturedPreview,
    translatedPreview,
    lastTtsMode,
    lastRequestedTtsMode,
    lastSessionStrategy,
    lastSessionId,
    lastSessionFallbackReason,
    lastSttProvider,
    lastSttActiveTranscript,
    lastSttDebugLogPath,
    startLatencyMs,
    hotkeyToFirstAudioMs,
    hotkeyToFirstPlaybackMs,
    captureDurationMs,
    captureToTtsStartMs,
    ttsToFirstAudioMs,
    firstAudioToPlaybackMs,
    hotkeyStartedAtMs,
    captureStartedAtMs,
    captureFinishedAtMs,
    ttsStartedAtMs,
    firstAudioReceivedAtMs,
    firstAudioPlaybackStartedAtMs,
    lastAudioPath,
    lastAudioOutputDirectory,
    lastAudioChunkCount,
  } = props;

  return (
    <AppSurfaceCard>
      <AppSurfaceHeader
        title={t('latestRun.title')}
        description={message}
        action={
          <Badge
            variant="outline"
            className="border-white/15 bg-white/8 text-[var(--text-primary)]"
          >
            {uiState}
          </Badge>
        }
      />
      <AppSurfaceContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {capturedPreview ? (
          <ResultBlock label={t('latestRun.capturedText')}>
            <p>{capturedPreview}</p>
          </ResultBlock>
        ) : null}
        {translatedPreview ? (
          <ResultBlock label={t('latestRun.translation')}>
            <p>{translatedPreview}</p>
          </ResultBlock>
        ) : null}
        {lastTtsMode ? (
          <ResultBlock label={t('latestRun.resolvedTtsMode')}>
            <strong className="text-[var(--text-primary)]">{lastTtsMode}</strong>
          </ResultBlock>
        ) : null}
        {lastRequestedTtsMode ? (
          <ResultBlock label={t('latestRun.requestedTtsMode')}>
            <strong className="text-[var(--text-primary)]">{lastRequestedTtsMode}</strong>
          </ResultBlock>
        ) : null}
        {lastSessionStrategy ? (
          <ResultBlock label={t('latestRun.sessionStrategy')}>
            <p>{lastSessionStrategy}</p>
            <code className="block break-all rounded-md bg-black/20 px-2 py-1 text-xs">
              {lastSessionId}
            </code>
          </ResultBlock>
        ) : null}
        {lastSessionFallbackReason ? (
          <ResultBlock label={t('latestRun.sessionFallback')}>
            <p>{lastSessionFallbackReason}</p>
          </ResultBlock>
        ) : null}
        {lastSttProvider ? (
          <ResultBlock label={t('latestRun.lastSttProvider')}>
            <strong className="text-[var(--text-primary)]">{lastSttProvider}</strong>
          </ResultBlock>
        ) : null}
        {lastSttActiveTranscript ? (
          <ResultBlock label={t('latestRun.lastSttTranscript')}>
            <p>{lastSttActiveTranscript}</p>
          </ResultBlock>
        ) : null}
        {lastSttDebugLogPath ? (
          <ResultBlock label={t('latestRun.sttDebugLog')}>
            <code className="block break-all rounded-md bg-black/20 px-2 py-1 text-xs">
              {lastSttDebugLogPath}
            </code>
          </ResultBlock>
        ) : null}
        {startLatencyMs !== null ? (
          <ResultBlock label={t('latestRun.visibleStartLatency')}>
            <strong className="text-[var(--text-primary)]">{startLatencyMs} ms</strong>
          </ResultBlock>
        ) : null}
        {hotkeyToFirstPlaybackMs !== null || hotkeyToFirstAudioMs !== null ? (
          <ResultBlock label={t('latestRun.endToEndLatency')}>
            {hotkeyToFirstAudioMs !== null ? (
              <p>{t('latestRun.hotkeyToFirstAudio', { value: hotkeyToFirstAudioMs })}</p>
            ) : null}
            {hotkeyToFirstPlaybackMs !== null ? (
              <p>{t('latestRun.hotkeyToFirstPlayback', { value: hotkeyToFirstPlaybackMs })}</p>
            ) : null}
          </ResultBlock>
        ) : null}
        {captureDurationMs !== null ||
        captureToTtsStartMs !== null ||
        ttsToFirstAudioMs !== null ||
        firstAudioToPlaybackMs !== null ? (
          <ResultBlock label={t('latestRun.latencyBreakdown')}>
            {captureDurationMs !== null ? (
              <p>{t('latestRun.captureDuration', { value: captureDurationMs })}</p>
            ) : null}
            {captureToTtsStartMs !== null ? (
              <p>{t('latestRun.captureToTtsStart', { value: captureToTtsStartMs })}</p>
            ) : null}
            {ttsToFirstAudioMs !== null ? (
              <p>{t('latestRun.ttsToFirstAudio', { value: ttsToFirstAudioMs })}</p>
            ) : null}
            {firstAudioToPlaybackMs !== null ? (
              <p>{t('latestRun.firstAudioToPlayback', { value: firstAudioToPlaybackMs })}</p>
            ) : null}
          </ResultBlock>
        ) : null}
        {hotkeyStartedAtMs ||
        captureStartedAtMs ||
        captureFinishedAtMs ||
        ttsStartedAtMs ||
        firstAudioReceivedAtMs ||
        firstAudioPlaybackStartedAtMs ? (
          <ResultBlock label={t('latestRun.audioStartTimeline')}>
            {hotkeyStartedAtMs ? (
              <p>{t('latestRun.hotkeyReceived', { value: formatTimestamp(hotkeyStartedAtMs) })}</p>
            ) : null}
            {captureStartedAtMs ? (
              <p>{t('latestRun.captureStarted', { value: formatTimestamp(captureStartedAtMs) })}</p>
            ) : null}
            {captureFinishedAtMs ? (
              <p>{t('latestRun.captureFinished', { value: formatTimestamp(captureFinishedAtMs) })}</p>
            ) : null}
            {ttsStartedAtMs ? (
              <p>{t('latestRun.ttsStarted', { value: formatTimestamp(ttsStartedAtMs) })}</p>
            ) : null}
            {firstAudioReceivedAtMs ? (
              <p>{t('latestRun.firstAudioReceived', { value: formatTimestamp(firstAudioReceivedAtMs) })}</p>
            ) : null}
            {firstAudioPlaybackStartedAtMs ? (
              <p>
                {t('latestRun.firstAudiblePlayback', {
                  value: formatTimestamp(firstAudioPlaybackStartedAtMs),
                })}
              </p>
            ) : null}
          </ResultBlock>
        ) : null}
        {lastAudioPath ? (
          <ResultBlock label={t('latestRun.audioOutput')}>
            <code className="block break-all rounded-md bg-black/20 px-2 py-1 text-xs">
              {lastAudioChunkCount > 1 ? lastAudioOutputDirectory : lastAudioPath}
            </code>
          </ResultBlock>
        ) : null}
      </AppSurfaceContent>
    </AppSurfaceCard>
  );
}
