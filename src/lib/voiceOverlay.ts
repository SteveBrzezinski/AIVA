import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type CaptureOptions = {
  copyDelayMs?: number;
  restoreClipboard?: boolean;
};

export type SpeakOptions = {
  autoplay?: boolean;
  format?: 'wav' | 'mp3';
  model?: string;
  voice?: string;
};

export type CaptureAndSpeakResult = {
  capturedText: string;
  restoredClipboard: boolean;
  note?: string | null;
  speech: {
    autoplay: boolean;
    bytesWritten: number;
    filePath: string;
    format: string;
    model: string;
    voice: string;
  };
};

export type HotkeyStatus = {
  registered: boolean;
  accelerator: string;
  platform: 'windows' | 'unsupported';
  state: 'idle' | 'registering' | 'working' | 'success' | 'error' | 'unsupported';
  message: string;
  lastCapturedText?: string | null;
  lastAudioPath?: string | null;
};

const HOTKEY_STATUS_EVENT = 'hotkey-status';

export async function getAppStatus(): Promise<string> {
  return invoke<string>('app_status');
}

export async function getHotkeyStatus(): Promise<HotkeyStatus> {
  return invoke<HotkeyStatus>('get_hotkey_status');
}

export async function onHotkeyStatus(
  callback: (status: HotkeyStatus) => void,
): Promise<UnlistenFn> {
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
      format: speakOptions.format ?? 'mp3',
      model: speakOptions.model,
      voice: speakOptions.voice ?? 'alloy',
    },
  });
}
