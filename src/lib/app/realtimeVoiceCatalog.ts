import type { AppSettings } from '../voiceOverlay.js';

const OPENAI_REALTIME_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'marin',
  'sage',
  'shimmer',
  'verse',
] as const;

const OPENAI_REALTIME_VOICES_BY_MODEL: Record<string, readonly string[]> = {
  'gpt-realtime': OPENAI_REALTIME_VOICES,
  'gpt-realtime-mini': OPENAI_REALTIME_VOICES,
};

export function normalizeRealtimeVoiceModel(model: string): string {
  const normalized = model.trim().toLowerCase();

  if (normalized === 'gpt-realtime-mini' || normalized === 'realtime-mini') {
    return 'gpt-realtime-mini';
  }

  return 'gpt-realtime';
}

export function realtimeVoiceOptionsForModel(
  model: string,
): AppSettings['voiceAgentVoice'][] {
  return [...(OPENAI_REALTIME_VOICES_BY_MODEL[normalizeRealtimeVoiceModel(model)] ??
    OPENAI_REALTIME_VOICES_BY_MODEL['gpt-realtime'])] as AppSettings['voiceAgentVoice'][];
}

export function defaultVoiceAgentVoiceForModel(
  model: string,
): AppSettings['voiceAgentVoice'] {
  const options = realtimeVoiceOptionsForModel(model);

  return (options.includes('marin') ? 'marin' : options[0] ?? 'marin') as AppSettings['voiceAgentVoice'];
}

export function sanitizeVoiceAgentVoiceForModel(
  voice: string,
  model: string,
): AppSettings['voiceAgentVoice'] {
  const normalized = voice.trim().toLowerCase();
  const options = realtimeVoiceOptionsForModel(model);

  return (options.includes(normalized as AppSettings['voiceAgentVoice'])
    ? normalized
    : defaultVoiceAgentVoiceForModel(model)) as AppSettings['voiceAgentVoice'];
}

export function formatRealtimeVoiceLabel(voice: string): string {
  return voice.charAt(0).toUpperCase() + voice.slice(1);
}
