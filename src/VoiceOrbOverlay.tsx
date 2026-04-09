import { useEffect, useRef, useState } from 'react';
import { LogicalPosition, LogicalSize, currentMonitor, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import { DEFAULT_DESIGN_THEME_ID, normalizeDesignThemeId, type DesignThemeId } from './designThemes';
import { OVERLAY_ACTION_EVENT, OVERLAY_STATE_EVENT, type OverlayAction, type OverlayState } from './lib/overlayBridge';
import ThemedOrb from './ThemedOrb';
import { getSettings, onSettingsUpdated } from './lib/voiceOverlay';

const SCREEN_EDGE_INSET = 12;
const ORB_WINDOW_PADDING = 18;
const DEFAULT_ORB_VISUAL_LAYOUT = { width: 188, height: 188 };
const THEME_ORB_VISUAL_LAYOUTS: Partial<Record<DesignThemeId, typeof DEFAULT_ORB_VISUAL_LAYOUT>> = {
  'anime-companion': { width: 252, height: 304 },
};

function getOrbLayout(themeId: DesignThemeId) {
  const visualLayout = THEME_ORB_VISUAL_LAYOUTS[themeId] ?? DEFAULT_ORB_VISUAL_LAYOUT;

  return {
    width: visualLayout.width + (ORB_WINDOW_PADDING * 2),
    height: visualLayout.height + (ORB_WINDOW_PADDING * 2),
  };
}

const fallbackOverlayState: OverlayState = {
  assistantActive: false,
  isLiveTranscribing: false,
  voiceOrbPinned: false,
  composerVisible: false,
  settingsVisible: false,
  assistantStateDetail: 'Listening is stopped.',
  liveTranscriptionStatus: 'Live transcription is stopped.',
  assistantWakePhrase: 'Hey Ava',
  assistantClosePhrase: 'Bye Ava',
  statusMessage: 'Overlay ready.',
  uiState: 'idle',
};

async function syncVoiceOrbLayout(themeId: DesignThemeId): Promise<void> {
  const overlayWindow = getCurrentWindow();
  const monitor = await currentMonitor() ?? await primaryMonitor();
  if (!monitor) {
    return;
  }

  const orbLayout = getOrbLayout(themeId);
  const workAreaPosition = monitor.workArea.position.toLogical(monitor.scaleFactor);
  const workAreaSize = monitor.workArea.size.toLogical(monitor.scaleFactor);

  await overlayWindow.setSize(new LogicalSize(orbLayout.width, orbLayout.height));
  await overlayWindow.setPosition(
    new LogicalPosition(
      workAreaPosition.x + workAreaSize.width - orbLayout.width - SCREEN_EDGE_INSET + ORB_WINDOW_PADDING,
      workAreaPosition.y + workAreaSize.height - orbLayout.height - SCREEN_EDGE_INSET + ORB_WINDOW_PADDING,
    ),
  );
}

export default function VoiceOrbOverlay() {
  const overlayWindowRef = useRef(getCurrentWindow());
  const themeIdRef = useRef<DesignThemeId>(DEFAULT_DESIGN_THEME_ID);
  const [overlayState, setOverlayState] = useState<OverlayState>(fallbackOverlayState);
  const [themeId, setThemeId] = useState<DesignThemeId>(DEFAULT_DESIGN_THEME_ID);
  const [statusNote, setStatusNote] = useState('Voice overlay ready.');

  useEffect(() => {
    document.documentElement.classList.add('overlay-html');
    document.body.classList.add('overlay-body');

    return () => {
      document.documentElement.classList.remove('overlay-html');
      document.body.classList.remove('overlay-body');
    };
  }, []);

  useEffect(() => {
    let unlistenOverlayState: (() => void | Promise<void>) | undefined;
    let unlistenSettings: (() => void | Promise<void>) | undefined;
    let unlistenScale: (() => void | Promise<void>) | undefined;

    void getSettings()
      .then((settings) => {
        const nextThemeId = normalizeDesignThemeId(settings.designThemeId);
        themeIdRef.current = nextThemeId;
        setThemeId(nextThemeId);
        void syncVoiceOrbLayout(nextThemeId);
      })
      .catch(() => {
        themeIdRef.current = DEFAULT_DESIGN_THEME_ID;
        setThemeId(DEFAULT_DESIGN_THEME_ID);
      });

    void onSettingsUpdated((settings) => {
      const nextThemeId = normalizeDesignThemeId(settings.designThemeId);
      themeIdRef.current = nextThemeId;
      setThemeId(nextThemeId);
      void syncVoiceOrbLayout(nextThemeId);
    }).then((cleanup) => {
      unlistenSettings = cleanup;
    });

    void overlayWindowRef.current.listen<OverlayState>(OVERLAY_STATE_EVENT, (event) => {
      setOverlayState(event.payload);
      setStatusNote(event.payload.statusMessage);
    }).then((cleanup) => {
      unlistenOverlayState = cleanup;
    });

    void overlayWindowRef.current.onScaleChanged(() => {
      void syncVoiceOrbLayout(themeIdRef.current);
    }).then((cleanup) => {
      unlistenScale = cleanup;
    });

    void overlayWindowRef.current.emitTo<OverlayAction>('main', OVERLAY_ACTION_EVENT, { type: 'request-state' });
    void syncVoiceOrbLayout(themeIdRef.current);

    return () => {
      void unlistenOverlayState?.();
      void unlistenSettings?.();
      void unlistenScale?.();
    };
  }, []);

  const shouldShowOrb = overlayState.assistantActive || overlayState.voiceOrbPinned;

  useEffect(() => {
    const syncVisibility = async (): Promise<void> => {
      await syncVoiceOrbLayout(themeId);
      if (shouldShowOrb) {
        await overlayWindowRef.current.show();
      } else {
        await overlayWindowRef.current.hide();
      }
    };

    void syncVisibility().catch(() => undefined);
  }, [shouldShowOrb, themeId]);

  const toggleAssistant = async (): Promise<void> => {
    const nextAction: OverlayAction = !overlayState.isLiveTranscribing
      ? { type: 'toggle-live' }
      : overlayState.assistantActive
        ? { type: 'deactivate' }
        : { type: 'activate' };

    try {
      await overlayWindowRef.current.emitTo<OverlayAction>('main', OVERLAY_ACTION_EVENT, nextAction);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      setStatusNote(`Voice overlay action failed: ${text}`);
    }
  };

  return (
    <div className="overlay-root overlay-root--orb">
      <ThemedOrb
        themeId={themeId}
        isVisible={shouldShowOrb}
        isListening={overlayState.assistantActive}
        isThinking={overlayState.uiState === 'working'}
        isSpeaking={overlayState.uiState === 'success' && overlayState.assistantActive}
        onClick={() => void toggleAssistant()}
        title={statusNote}
      />
    </div>
  );
}
