import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type CaptureOptions = {
  copyDelayMs?: number;
  restoreClipboard?: boolean;
};

export type SpeakOptions = {
  autoplay?: boolean;
  format?: 'wav' | 'mp3';
  mode?: 'classic' | 'live' | 'realtime';
  maxChunkChars?: number;
  maxParallelRequests?: number;
  model?: string;
  voice?: string;
  firstChunkLeadingSilenceMs?: number;
};

export type TranslateOptions = {
  model?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
};

export type AppSettings = {
  ttsMode: 'classic' | 'live' | 'realtime';
  realtimeAllowLiveFallback: boolean;
  ttsFormat: 'wav' | 'mp3';
  firstChunkLeadingSilenceMs: number;
  translationTargetLanguage: string;
  playbackSpeed: number;
  openaiApiKey: string;
};

export type LanguageOption = {
  code: string;
  label: string;
};

export type CaptureAndSpeakResult = {
  capturedText: string;
  restoredClipboard: boolean;
  note?: string | null;
  speech: {
    autoplay: boolean;
    bytesWritten: number;
    chunkCount: number;
    filePath: string;
    format: string;
    model: string;
    mode: string;
    requestedMode: string;
    sessionId: string;
    sessionStrategy: string;
    fallbackReason?: string | null;
    supportsPersistentSession: boolean;
    outputDirectory: string;
    transportFormat: string;
    voice: string;
    firstAudioReceivedAtMs?: number | null;
    firstAudioPlaybackStartedAtMs?: number | null;
    startLatencyMs?: number | null;
  };
};

export type CaptureAndTranslateResult = {
  capturedText: string;
  restoredClipboard: boolean;
  note?: string | null;
  translation: {
    text: string;
    targetLanguage: string;
    sourceLanguage?: string | null;
    model: string;
  };
  speech: {
    autoplay: boolean;
    bytesWritten: number;
    chunkCount: number;
    filePath: string;
    format: string;
    model: string;
    mode: string;
    requestedMode: string;
    sessionId: string;
    sessionStrategy: string;
    fallbackReason?: string | null;
    supportsPersistentSession: boolean;
    outputDirectory: string;
    transportFormat: string;
    voice: string;
    firstAudioReceivedAtMs?: number | null;
    firstAudioPlaybackStartedAtMs?: number | null;
    startLatencyMs?: number | null;
  };
};

export type HotkeyStatus = {
  registered: boolean;
  accelerator: string;
  translateAccelerator: string;
  pauseResumeAccelerator: string;
  cancelAccelerator: string;
  platform: 'windows' | 'unsupported';
  state: 'idle' | 'registering' | 'working' | 'success' | 'error' | 'unsupported';
  message: string;
  lastAction?: string | null;
  lastCapturedText?: string | null;
  lastAudioPath?: string | null;
  lastAudioOutputDirectory?: string | null;
  lastAudioChunkCount?: number | null;
  activeTtsMode?: string | null;
  requestedTtsMode?: string | null;
  sessionStrategy?: string | null;
  sessionId?: string | null;
  sessionFallbackReason?: string | null;
  hotkeyStartedAtMs?: number | null;
  captureStartedAtMs?: number | null;
  captureFinishedAtMs?: number | null;
  ttsStartedAtMs?: number | null;
  firstAudioReceivedAtMs?: number | null;
  firstAudioPlaybackStartedAtMs?: number | null;
  startLatencyMs?: number | null;
  hotkeyToFirstAudioMs?: number | null;
  hotkeyToFirstPlaybackMs?: number | null;
  captureDurationMs?: number | null;
  captureToTtsStartMs?: number | null;
  ttsToFirstAudioMs?: number | null;
  firstAudioToPlaybackMs?: number | null;
  lastTranslationText?: string | null;
  lastTranslationTargetLanguage?: string | null;
};

const HOTKEY_STATUS_EVENT = 'hotkey-status';

export async function getAppStatus(): Promise<string> {
  return invoke<string>('app_status');
}

export async function getHotkeyStatus(): Promise<HotkeyStatus> {
  return invoke<HotkeyStatus>('get_hotkey_status');
}

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_settings');
}

export async function updateSettings(next: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>('update_settings', { next });
}

export async function resetSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('reset_settings');
}

export async function getLanguageOptions(): Promise<LanguageOption[]> {
  return invoke<LanguageOption[]>('get_language_options');
}

export async function onHotkeyStatus(callback: (status: HotkeyStatus) => void): Promise<UnlistenFn> {
  return listen<HotkeyStatus>(HOTKEY_STATUS_EVENT, (event) => callback(event.payload));
}

export async function captureAndSpeak(
  captureOptions: CaptureOptions = {},
  speakOptions: SpeakOptions = {},
): Promise<CaptureAndSpeakResult> {
  return invoke<CaptureAndSpeakResult>('capture_and_speak_command', {
    captureOptions: {
      copyDelayMs: captureOptions.copyDelayMs,
      restoreClipboard: captureOptions.restoreClipboard,
    },
    speakOptions: {
      autoplay: speakOptions.autoplay ?? true,
      format: speakOptions.format,
      mode: speakOptions.mode,
      maxChunkChars: speakOptions.maxChunkChars,
      maxParallelRequests: speakOptions.maxParallelRequests,
      model: speakOptions.model,
      voice: speakOptions.voice ?? 'alloy',
      firstChunkLeadingSilenceMs: speakOptions.firstChunkLeadingSilenceMs,
    },
  });
}

export async function captureAndTranslate(
  captureOptions: CaptureOptions = {},
  translateOptions: TranslateOptions = {},
): Promise<CaptureAndTranslateResult> {
  return invoke<CaptureAndTranslateResult>('capture_and_translate_command', {
    captureOptions: {
      copyDelayMs: captureOptions.copyDelayMs,
      restoreClipboard: captureOptions.restoreClipboard,
    },
    translateOptions: {
      model: translateOptions.model,
      sourceLanguage: translateOptions.sourceLanguage,
      targetLanguage: translateOptions.targetLanguage,
    },
  });
}

export type SpeakTextResult = CaptureAndSpeakResult['speech'];
export type TranslateTextResult = CaptureAndTranslateResult['translation'];

/** Speak pre-provided text directly (no Ctrl+C capture). */
export async function speakText(
  text: string,
  options: SpeakOptions = {},
): Promise<SpeakTextResult> {
  return invoke<SpeakTextResult>('speak_text_command', {
    options: {
      text,
      autoplay: options.autoplay ?? true,
      format: options.format,
      mode: options.mode,
      maxChunkChars: options.maxChunkChars,
      maxParallelRequests: options.maxParallelRequests,
      model: options.model,
      voice: options.voice ?? 'alloy',
      firstChunkLeadingSilenceMs: options.firstChunkLeadingSilenceMs,
    },
  });
}

/** Translate pre-provided text directly (no Ctrl+C capture). */
export async function translateText(
  text: string,
  options: TranslateOptions = {},
): Promise<TranslateTextResult> {
  return invoke<TranslateTextResult>('translate_text_command', {
    options: {
      text,
      model: options.model,
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
    },
  });
}

export async function pauseResumeCurrentRun(): Promise<string> {
  return invoke<string>('pause_resume_current_run');
}

export async function cancelCurrentRun(): Promise<string> {
  return invoke<string>('cancel_current_run');
}
