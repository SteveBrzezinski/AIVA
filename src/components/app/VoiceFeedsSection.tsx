import { useTranslation } from 'react-i18next';

import {
  AppSurfaceCard,
  AppSurfaceContent,
  AppSurfaceHeader,
} from '@/components/ui/app-surface';
import type { VoiceConnectionState, VoiceFeedItem } from '../../lib/realtimeVoiceAgent';

type VoiceFeedsSectionProps = {
  voiceAgentState: VoiceConnectionState;
  voiceEventFeed: VoiceFeedItem[];
  voiceTaskFeed: VoiceFeedItem[];
};

function FeedColumn(props: {
  title: string;
  counter: string | number;
  emptyState: string;
  items: VoiceFeedItem[];
}): JSX.Element {
  const { title, counter, emptyState, items } = props;

  return (
    <AppSurfaceCard className="min-h-0">
      <AppSurfaceHeader title={title} action={<span className="text-sm text-[var(--text-muted)]">{counter}</span>} />
      <AppSurfaceContent className="max-h-[28rem] space-y-3 overflow-y-auto">
        {items.length ? (
          items.map((item) => (
            <article
              className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm"
              key={item.id}
            >
              <strong className="block text-[var(--text-primary)]">{item.title}</strong>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[var(--text-secondary)]">
                {item.body}
              </pre>
              <small className="mt-3 block text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {new Date(item.timestampMs).toLocaleTimeString()}
              </small>
            </article>
          ))
        ) : (
          <p className="text-sm text-[var(--text-muted)]">{emptyState}</p>
        )}
      </AppSurfaceContent>
    </AppSurfaceCard>
  );
}

export function VoiceFeedsSection(props: VoiceFeedsSectionProps): JSX.Element {
  const { t } = useTranslation();
  const { voiceAgentState, voiceEventFeed, voiceTaskFeed } = props;

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <FeedColumn
        title={t('feeds.realtimeEventFeed')}
        counter={voiceAgentState}
        emptyState={t('feeds.noRealtimeEvents')}
        items={voiceEventFeed}
      />
      <FeedColumn
        title={t('feeds.toolTaskFeed')}
        counter={voiceTaskFeed.length}
        emptyState={t('feeds.noToolCalls')}
        items={voiceTaskFeed}
      />
    </section>
  );
}
