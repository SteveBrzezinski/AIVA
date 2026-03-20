import { invoke } from '@tauri-apps/api/core';

export type CaptureOptions = {
  copyDelayMs?: number;
  restoreClipboard?: boolean;
};

export type CaptureResult = {
  text: string;
  restoredClipboard: boolean;
  note?: string | null;
};

/**
 * Call from a global-hotkey handler or overlay trigger.
 * Windows-first MVP: synthesizes Ctrl+C, reads clipboard, optionally restores prior text clipboard.
 */
export async function captureSelectedText(
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  return invoke<CaptureResult>('capture_selected_text_command', {
    options: {
      copyDelayMs: options.copyDelayMs,
      restoreClipboard: options.restoreClipboard,
    },
  });
}
