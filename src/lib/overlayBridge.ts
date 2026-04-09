export const OVERLAY_ACTION_EVENT = 'overlay-action';
export const OVERLAY_STATE_EVENT = 'overlay-state';
export const ACTION_BAR_WINDOW_LABEL = 'action-bar';
export const VOICE_OVERLAY_WINDOW_LABEL = 'voice-overlay';
export const OVERLAY_COMPOSER_WINDOW_LABEL = 'overlay-composer';

export type OverlayAction =
  | { type: 'request-state' }
  | { type: 'toggle-live' }
  | { type: 'toggle-listener' }
  | { type: 'activate' }
  | { type: 'deactivate' }
  | { type: 'toggle-composer' }
  | { type: 'close-composer' }
  | { type: 'open-settings' }
  | { type: 'pin-voice-orb' }
  | { type: 'unpin-voice-orb' };

export type OverlayState = {
  assistantActive: boolean;
  isLiveTranscribing: boolean;
  voiceOrbPinned: boolean;
  composerVisible: boolean;
  settingsVisible: boolean;
  assistantStateDetail: string;
  liveTranscriptionStatus: string;
  assistantWakePhrase: string;
  assistantClosePhrase: string;
  statusMessage: string;
  uiState: 'idle' | 'working' | 'success' | 'error';
};
