import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Window, getCurrentWindow } from '@tauri-apps/api/window';
import { DEBUG_NAV_ENABLED, DEFAULT_HOSTED_BACKEND_URL } from './appEnv';
import coralCompanionLogo from './assets/coral_companion_logo.png';
import { applyDesignTheme } from './designThemes';
import SettingsView from './SettingsView';
import {
  getHostedAccountStatus,
  loginHostedAccount,
  logoutHostedAccount,
  resetSettings,
  updateSettings,
  type AppSettings,
  type HotkeyStatus,
  type HostedAccountStatus,
} from './lib/voiceOverlay';
import {
  buildRunHistoryEntry,
  createReadinessItems,
  fallbackSettings,
  getAssistantNameError,
  isAssistantCalibrationComplete,
  mergeHostedSettings,
  normalizeLanguageCode,
  type RunHistoryEntry,
  type UiState,
} from './lib/app/appModel';
import {
  mergeSettingsSection,
  type SettingsSectionId,
} from './lib/app/settingsSections';
import { useAppBootstrap } from './hooks/useAppBootstrap';
import { useAssistantTraining } from './hooks/useAssistantTraining';
import { useVoiceAssistantRuntime } from './hooks/useVoiceAssistantRuntime';
import i18n, { normalizeUiLanguage } from './i18n';
import { AssistantStatusSection } from './components/app/AssistantStatusSection';
import { AssistantTrainingDialog } from './components/app/AssistantTrainingDialog';
import { HeroSection } from './components/app/HeroSection';
import { LatestRunSection } from './components/app/LatestRunSection';
import { ReadinessGrid } from './components/app/ReadinessGrid';
import { RunHistorySection } from './components/app/RunHistorySection';
import { TimerSection } from './components/app/TimerSection';
import { VoiceFeedsSection } from './components/app/VoiceFeedsSection';
import { VoiceStyleRestartDialog } from './components/app/VoiceStyleRestartDialog';
import { TimerEditorDialog } from './components/timers/TimerEditorDialog';
import {
  ACTION_BAR_WINDOW_LABEL,
  OVERLAY_ACTION_EVENT,
  OVERLAY_COMPOSER_WINDOW_LABEL,
  OVERLAY_STATE_EVENT,
  VOICE_OVERLAY_WINDOW_LABEL,
  type OverlayAction,
  type OverlayState,
} from './lib/overlayBridge';
import { useVoiceTimers } from './hooks/useVoiceTimers';
import type { VoiceTimer } from './lib/voiceOverlay';

type AppView = 'dashboard' | 'settings' | 'debug';

type VoiceSessionChangeSummary = {
  genderChanged: boolean;
  modelChanged: boolean;
  voiceChanged: boolean;
  providerChanged: boolean;
};

type PendingVoiceSessionChange = {
  settings: AppSettings;
  summary: VoiceSessionChangeSummary;
  successMessage?: string;
};

type PendingBackgroundVoiceSessionAction = {
  reason: string;
  action: 'restart' | 'disconnect';
};

function buildVoiceSessionChangeSummary(
  next: AppSettings,
  current: AppSettings,
): VoiceSessionChangeSummary {
  return {
    genderChanged: next.voiceAgentGender !== current.voiceAgentGender,
    modelChanged: next.voiceAgentModel !== current.voiceAgentModel,
    voiceChanged: next.voiceAgentVoice !== current.voiceAgentVoice,
    providerChanged: next.aiProviderMode !== current.aiProviderMode,
  };
}

function hasVoiceSessionChange(summary: VoiceSessionChangeSummary): boolean {
  return (
    summary.genderChanged ||
    summary.modelChanged ||
    summary.voiceChanged ||
    summary.providerChanged
  );
}

function getVoiceSessionChangeReason(summary: VoiceSessionChangeSummary): string {
  const segments = [
    summary.providerChanged ? 'provider' : null,
    summary.modelChanged ? 'model' : null,
    summary.voiceChanged ? 'voice' : null,
    summary.genderChanged ? 'gender' : null,
  ].filter(Boolean);

  return `settings-${segments.join('-')}-change`;
}

function getVoiceSessionChangeAction(
  summary: VoiceSessionChangeSummary,
): 'restart' | 'disconnect' {
  return (
    summary.genderChanged &&
    !summary.modelChanged &&
    !summary.voiceChanged &&
    !summary.providerChanged
  )
    ? 'restart'
    : 'disconnect';
}

export default function App() {
  const [uiState, setUiState] = useState<UiState>('idle');
  const [message, setMessage] = useState(i18n.t('app.ready'));
  const [capturedPreview, setCapturedPreview] = useState('');
  const [translatedPreview, setTranslatedPreview] = useState('');
  const [lastAudioPath, setLastAudioPath] = useState('');
  const [lastAudioOutputDirectory, setLastAudioOutputDirectory] = useState('');
  const [lastAudioChunkCount, setLastAudioChunkCount] = useState(0);
  const [lastTtsMode, setLastTtsMode] = useState('');
  const [lastRequestedTtsMode, setLastRequestedTtsMode] = useState('');
  const [lastSessionStrategy, setLastSessionStrategy] = useState('');
  const [lastSessionId, setLastSessionId] = useState('');
  const [lastSessionFallbackReason, setLastSessionFallbackReason] = useState('');
  const [hotkeyStartedAtMs, setHotkeyStartedAtMs] = useState<number | null>(null);
  const [captureStartedAtMs, setCaptureStartedAtMs] = useState<number | null>(null);
  const [captureFinishedAtMs, setCaptureFinishedAtMs] = useState<number | null>(null);
  const [ttsStartedAtMs, setTtsStartedAtMs] = useState<number | null>(null);
  const [firstAudioReceivedAtMs, setFirstAudioReceivedAtMs] = useState<number | null>(null);
  const [firstAudioPlaybackStartedAtMs, setFirstAudioPlaybackStartedAtMs] = useState<number | null>(
    null,
  );
  const [startLatencyMs, setStartLatencyMs] = useState<number | null>(null);
  const [hotkeyToFirstAudioMs, setHotkeyToFirstAudioMs] = useState<number | null>(null);
  const [hotkeyToFirstPlaybackMs, setHotkeyToFirstPlaybackMs] = useState<number | null>(null);
  const [captureDurationMs, setCaptureDurationMs] = useState<number | null>(null);
  const [captureToTtsStartMs, setCaptureToTtsStartMs] = useState<number | null>(null);
  const [ttsToFirstAudioMs, setTtsToFirstAudioMs] = useState<number | null>(null);
  const [firstAudioToPlaybackMs, setFirstAudioToPlaybackMs] = useState<number | null>(null);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [composerVisible, setComposerVisible] = useState(false);
  const [voiceOrbPinned, setVoiceOrbPinned] = useState(false);
  const [isMainWindowMaximized, setIsMainWindowMaximized] = useState(false);
  const [hostedAccount, setHostedAccount] = useState<HostedAccountStatus | null>(null);
  const [hostedAccountError, setHostedAccountError] = useState<string | null>(null);
  const [isHostedAccountBusy, setIsHostedAccountBusy] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginProviderMode, setLoginProviderMode] = useState<AppSettings['aiProviderMode']>(
    'hosted',
  );
  const [pendingVoiceSessionAction, setPendingVoiceSessionAction] =
    useState<PendingBackgroundVoiceSessionAction | null>(null);
  const [pendingVoiceSessionChange, setPendingVoiceSessionChange] =
    useState<PendingVoiceSessionChange | null>(null);
  const [timerEditorMode, setTimerEditorMode] = useState<'create' | 'edit' | null>(null);
  const [timerEditorTimer, setTimerEditorTimer] = useState<VoiceTimer | null>(null);
  const [isTimerEditorBusy, setIsTimerEditorBusy] = useState(false);
  const appWindowRef = useRef(getCurrentWindow());
  const composerVisibleRef = useRef(false);
  const composerTransitionRef = useRef<Promise<void> | null>(null);
  const listenerDesiredRunningRef = useRef(false);
  const listenerTransitionRef = useRef<Promise<void> | null>(null);
  const liveTranscribingRef = useRef(false);
  const overlayBridgeStateRef = useRef<OverlayState | null>(null);
  const applyHotkeyStatus = useCallback((status: HotkeyStatus, appendHistory = false): void => {
    setMessage(status.message);
    setCapturedPreview(status.lastCapturedText ?? '');
    setTranslatedPreview(status.lastTranslationText ?? '');
    setLastAudioPath(status.lastAudioPath ?? '');
    setLastAudioOutputDirectory(status.lastAudioOutputDirectory ?? '');
    setLastAudioChunkCount(status.lastAudioChunkCount ?? 0);
    setLastTtsMode(status.activeTtsMode ?? '');
    setLastRequestedTtsMode(status.requestedTtsMode ?? '');
    setLastSessionStrategy(status.sessionStrategy ?? '');
    setLastSessionId(status.sessionId ?? '');
    setLastSessionFallbackReason(status.sessionFallbackReason ?? '');
    setHotkeyStartedAtMs(status.hotkeyStartedAtMs ?? null);
    setCaptureStartedAtMs(status.captureStartedAtMs ?? null);
    setCaptureFinishedAtMs(status.captureFinishedAtMs ?? null);
    setTtsStartedAtMs(status.ttsStartedAtMs ?? null);
    setFirstAudioReceivedAtMs(status.firstAudioReceivedAtMs ?? null);
    setFirstAudioPlaybackStartedAtMs(status.firstAudioPlaybackStartedAtMs ?? null);
    setStartLatencyMs(status.startLatencyMs ?? null);
    setHotkeyToFirstAudioMs(status.hotkeyToFirstAudioMs ?? null);
    setHotkeyToFirstPlaybackMs(status.hotkeyToFirstPlaybackMs ?? null);
    setCaptureDurationMs(status.captureDurationMs ?? null);
    setCaptureToTtsStartMs(status.captureToTtsStartMs ?? null);
    setTtsToFirstAudioMs(status.ttsToFirstAudioMs ?? null);
    setFirstAudioToPlaybackMs(status.firstAudioToPlaybackMs ?? null);
    setUiState(
      status.state === 'working'
        ? 'working'
        : status.state === 'error'
          ? 'error'
          : status.state === 'success'
            ? 'success'
            : 'idle',
    );

    if (!appendHistory) {
      return;
    }

    const historyEntry = buildRunHistoryEntry(status);
    if (!historyEntry) {
      return;
    }

    setRunHistory((current) => {
      if (current.some((entry) => entry.id === historyEntry.id)) {
        return current;
      }
      return [historyEntry, ...current].slice(0, 8);
    });
  }, []);
  const {
    appStatus, hotkeyStatus, settings, savedSettings, languageOptions, initialStateLoaded, setSettings, setSavedSettings,
  } = useAppBootstrap({
    onHotkeyStatusUpdate: applyHotkeyStatus,
  });

  const assistantNameError = getAssistantNameError(settings.assistantName);
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [savedSettings, settings],
  );
  const assistantCalibrationRequired =
    settings.assistantName !== savedSettings.assistantName ||
    normalizeLanguageCode(settings.sttLanguage) !==
      normalizeLanguageCode(savedSettings.assistantSampleLanguage);
  const assistantCalibrationComplete = isAssistantCalibrationComplete(settings);
  const canSaveSettings =
    !assistantNameError && (!assistantCalibrationRequired || assistantCalibrationComplete);
  const resolvedHostedBaseUrl =
    settings.hostedApiBaseUrl.trim() ||
    savedSettings.hostedApiBaseUrl.trim() ||
    DEFAULT_HOSTED_BACKEND_URL;
  const hostedSignedIn =
    hostedAccount?.connected ?? Boolean(savedSettings.hostedAccessToken.trim());
  const hostedStatusMeta = hostedSignedIn
    ? hostedAccount?.user?.email?.trim() || savedSettings.hostedAccountEmail.trim()
    : '';

  const syncHostedSettings = useCallback((nextHostedSettings: AppSettings): void => {
    setSettings((current) => ({
      ...mergeHostedSettings(current, nextHostedSettings),
      aiProviderMode: nextHostedSettings.aiProviderMode as AppSettings['aiProviderMode'],
      hostedWorkspaceSlug: nextHostedSettings.hostedWorkspaceSlug,
    }));
    setSavedSettings((current) => ({
      ...mergeHostedSettings(current, nextHostedSettings),
      aiProviderMode: nextHostedSettings.aiProviderMode as AppSettings['aiProviderMode'],
      hostedWorkspaceSlug: nextHostedSettings.hostedWorkspaceSlug,
    }));
  }, [setSavedSettings, setSettings]);

  useEffect(() => {
    const nextLanguage = normalizeUiLanguage(settings.uiLanguage);
    if (i18n.resolvedLanguage !== nextLanguage) {
      void i18n.changeLanguage(nextLanguage);
    }
    document.documentElement.lang = nextLanguage;
  }, [settings.uiLanguage]);

  useEffect(() => {
    void applyDesignTheme(settings.designThemeId, appWindowRef.current);
  }, [settings.designThemeId]);

  const syncMainWindowMaximized = useCallback(async (): Promise<void> => {
    try {
      setIsMainWindowMaximized(await appWindowRef.current.isMaximized());
    } catch {
      // Window chrome state is best-effort for the custom titlebar.
    }
  }, []);

  useEffect(() => {
    let unlistenResize: (() => void | Promise<void>) | undefined;

    void syncMainWindowMaximized();
    void appWindowRef.current.onResized(() => {
      void syncMainWindowMaximized();
    }).then((cleanup) => {
      unlistenResize = cleanup;
    });

    return () => {
      void unlistenResize?.();
    };
  }, [syncMainWindowMaximized]);

  const persistSettings = async (
    next: AppSettings,
    successMessage = i18n.t('app.settingsSavedFuture'),
    options?: { restartReason?: string; sessionAction?: 'restart' | 'disconnect' },
  ): Promise<AppSettings> => {
    const validationError = getAssistantNameError(next.assistantName);
    if (validationError) {
      setUiState('error');
      setMessage(validationError);
      throw new Error(validationError);
    }

    const recalibrationRequired =
      next.assistantName !== savedSettings.assistantName ||
      normalizeLanguageCode(next.sttLanguage) !==
        normalizeLanguageCode(savedSettings.assistantSampleLanguage);
    if (recalibrationRequired && !isAssistantCalibrationComplete(next)) {
      const calibrationError = i18n.t('validation.assistantCalibrationRequired');
      setUiState('error');
      setMessage(calibrationError);
      throw new Error(calibrationError);
    }

    setIsSavingSettings(true);
    try {
      const saved = await updateSettings(next);
      setSettings(saved);
      setSavedSettings(saved);
      let restartFailed = false;
      try {
        if (options?.sessionAction === 'disconnect') {
          await voiceRuntime.closeVoiceAgentSession(options.restartReason ?? 'settings-update');
        } else {
          await voiceRuntime.restartVoiceAgentSession(
            options?.restartReason ?? 'settings-update',
            voiceRuntime.assistantActive,
          );
        }
      } catch (voiceError: unknown) {
        const detail = voiceError instanceof Error ? voiceError.message : String(voiceError);
        restartFailed = true;
        setUiState('error');
        setMessage(i18n.t('app.settingsSavedRestartFailed', { detail }));
      }
      if (!restartFailed) {
        setMessage(successMessage);
      }
      return saved;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(i18n.t('app.failedToSaveSettings', { detail }));
      throw error;
    } finally {
      setIsSavingSettings(false);
    }
  };

  const ensureSavedSettings = async (): Promise<AppSettings> => {
    if (hasUnsavedChanges) {
      return persistSettings(settings, i18n.t('app.settingsSavedRun'));
    }

    return savedSettings;
  };

  useEffect(() => {
    if (!initialStateLoaded) {
      setHostedAccount(null);
      setHostedAccountError(null);
      return;
    }

    if (!savedSettings.hostedApiBaseUrl.trim() || !savedSettings.hostedAccessToken.trim()) {
      setHostedAccount(null);
      setHostedAccountError(null);
      return;
    }

    let active = true;
    setIsHostedAccountBusy(true);
    setHostedAccountError(null);

    void getHostedAccountStatus()
      .then((account) => {
        if (!active) {
          return;
        }
        setHostedAccount(account);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        const detail = error instanceof Error ? error.message : String(error);
        setHostedAccount(null);
        setHostedAccountError(detail);
      })
      .finally(() => {
        if (active) {
          setIsHostedAccountBusy(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    initialStateLoaded,
    savedSettings.hostedAccessToken,
    savedSettings.hostedApiBaseUrl,
  ]);

  const handleHostedLogin = async (credentials: {
    baseUrl: string;
    email: string;
    password: string;
  }): Promise<void> => {
    setIsHostedAccountBusy(true);
    try {
      const result = await loginHostedAccount(
        credentials.baseUrl,
        credentials.email,
        credentials.password,
        loginProviderMode,
      );
      syncHostedSettings(result.settings);
      if (result.settings.aiProviderMode === 'hosted') {
        setPendingVoiceSessionAction({
          reason: 'hosted-login',
          action: 'restart',
        });
      }
      setShowAccountModal(false);
      setLoginEmail('');
      setLoginPassword('');
      setLoginProviderMode('hosted');
      setHostedAccount(result.account);
      setHostedAccountError(null);
      setUiState('success');
      setMessage(
        i18n.t('app.hostedLoginSuccess', {
          workspace:
            result.account.currentTeam?.name ??
            result.account.currentTeam?.slug ??
            i18n.t('settings.hostedWorkspaceCurrentDefault'),
        }),
      );
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setHostedAccountError(detail);
      setUiState('error');
      setMessage(i18n.t('app.hostedLoginFailed', { detail }));
    } finally {
      setIsHostedAccountBusy(false);
    }
  };

  const handleHostedLogout = async (): Promise<void> => {
    setIsHostedAccountBusy(true);
    try {
      const nextSettings = await logoutHostedAccount();
      syncHostedSettings(nextSettings);
      if (savedSettings.aiProviderMode === 'hosted') {
        setPendingVoiceSessionAction({
          reason: 'hosted-logout',
          action: 'disconnect',
        });
      }
      setShowAccountModal(false);
      setLoginProviderMode('hosted');
      setLoginPassword('');
      setHostedAccount(null);
      setHostedAccountError(null);
      setUiState('success');
      setMessage(i18n.t('app.hostedLogoutSuccess'));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(i18n.t('app.hostedLogoutFailed', { detail }));
    } finally {
      setIsHostedAccountBusy(false);
    }
  };

  const voiceRuntime = useVoiceAssistantRuntime({
    settings,
    savedSettings,
    initialStateLoaded,
    ensureSavedSettings,
  });
  const voiceTimers = useVoiceTimers();
  const restartVoiceAgentSession = voiceRuntime.restartVoiceAgentSession;
  const closeVoiceAgentSession = voiceRuntime.closeVoiceAgentSession;
  const assistantVoiceActive = voiceRuntime.assistantActive;

  useEffect(() => {
    if (!pendingVoiceSessionAction) {
      return;
    }

    let active = true;
    const nextAction = pendingVoiceSessionAction;
    setPendingVoiceSessionAction(null);

    const runAction =
      nextAction.action === 'disconnect'
        ? closeVoiceAgentSession(nextAction.reason)
        : restartVoiceAgentSession(nextAction.reason, assistantVoiceActive);

    void runAction.catch((error: unknown) => {
      if (!active) {
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(i18n.t('app.settingsSavedRestartFailed', { detail }));
    });

    return () => {
      active = false;
    };
  }, [
    pendingVoiceSessionAction,
    assistantVoiceActive,
    closeVoiceAgentSession,
    restartVoiceAgentSession,
  ]);

  const requestSettingsPersist = useCallback(
    async (
      nextSettings: AppSettings,
      successMessage = i18n.t('app.settingsSavedFuture'),
    ): Promise<AppSettings | undefined> => {
      const summary = buildVoiceSessionChangeSummary(nextSettings, savedSettings);

      if (hasVoiceSessionChange(summary)) {
        setPendingVoiceSessionChange({
          settings: nextSettings,
          summary,
          successMessage,
        });
        return undefined;
      }

      return persistSettings(nextSettings, successMessage);
    },
    [persistSettings, savedSettings],
  );

  const handleSaveSettingsSection = useCallback(
    async (sectionId: SettingsSectionId): Promise<AppSettings | undefined> => {
      const nextSettings = mergeSettingsSection(savedSettings, settings, sectionId);
      return requestSettingsPersist(nextSettings);
    },
    [requestSettingsPersist, savedSettings, settings],
  );

  const handleResetSettingsSection = useCallback(
    async (sectionId: SettingsSectionId): Promise<AppSettings | undefined> => {
      const nextSettings = mergeSettingsSection(settings, fallbackSettings, sectionId);
      return requestSettingsPersist(nextSettings, i18n.t('app.resetSuccess'));
    },
    [requestSettingsPersist, settings],
  );

  const handleConfirmVoiceStyleRestart = useCallback(async (): Promise<void> => {
    const pendingChange = pendingVoiceSessionChange;
    if (!pendingChange) {
      return;
    }

    try {
      await persistSettings(
        pendingChange.settings,
        pendingChange.successMessage ?? i18n.t('app.settingsSavedFuture'),
        {
          restartReason: getVoiceSessionChangeReason(pendingChange.summary),
          sessionAction: getVoiceSessionChangeAction(pendingChange.summary),
        },
      );
    } finally {
      setPendingVoiceSessionChange(null);
    }
  }, [pendingVoiceSessionChange, persistSettings]);

  const {
    assistantTrainingReadyName,
    currentAssistantTrainingStep,
    showAssistantTrainingDialog,
    assistantTrainingTranscript,
    assistantTrainingCapturedTranscript,
    assistantTrainingStatus,
    assistantTrainingError,
    isAssistantTrainingRecording,
    openAssistantTrainingDialog,
    closeAssistantTrainingDialog,
    startAssistantTrainingRecording,
    stopAssistantTrainingRecording,
    confirmAssistantTrainingStep,
    retryAssistantTrainingStep,
  } = useAssistantTraining({
    settings,
    assistantNameError,
    isLiveTranscribing: voiceRuntime.isLiveTranscribing,
    stopLiveTranscription: voiceRuntime.stopLiveTranscription,
    resumeLiveTranscription: () => {
      void voiceRuntime.startLiveTranscription();
    },
    onSettingsChange: setSettings,
    onMessage: setMessage,
    onValidationError: (errorMessage) => {
      setUiState('error');
      setMessage(errorMessage);
    },
  });

  const handlePauseTimer = useCallback(async (timer: VoiceTimer): Promise<void> => {
    try {
      await voiceTimers.pauseTimer(timer.id);
      setUiState('success');
      setMessage(i18n.t('timers.messages.paused', { title: timer.title }));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(detail);
    }
  }, [voiceTimers]);

  const handleResumeTimer = useCallback(async (timer: VoiceTimer): Promise<void> => {
    try {
      await voiceTimers.resumeTimer(timer.id);
      setUiState('success');
      setMessage(i18n.t('timers.messages.resumed', { title: timer.title }));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(detail);
    }
  }, [voiceTimers]);

  const handleDeleteTimer = useCallback(async (timer: VoiceTimer): Promise<void> => {
    try {
      await voiceTimers.deleteTimer(timer.id);
      setUiState('success');
      setMessage(i18n.t('timers.messages.deleted', { title: timer.title }));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(detail);
    }
  }, [voiceTimers]);

  const handleSubmitTimerEditor = useCallback(async (payload: {
    title: string;
    durationMinutes: number;
    durationSeconds: number;
  }): Promise<void> => {
    setIsTimerEditorBusy(true);
    try {
      if (timerEditorMode === 'edit' && timerEditorTimer) {
        await voiceTimers.updateTimer({
          timerId: timerEditorTimer.id,
          title: payload.title || undefined,
          durationMinutes: payload.durationMinutes,
          durationSeconds: payload.durationSeconds,
        });
        setMessage(i18n.t('timers.messages.updated', {
          title: payload.title || timerEditorTimer.title,
        }));
      } else {
        const created = await voiceTimers.createTimer({
          title: payload.title || undefined,
          durationMinutes: payload.durationMinutes,
          durationSeconds: payload.durationSeconds,
        });
        setMessage(i18n.t('timers.messages.created', { title: created.title }));
      }
      setUiState('success');
      setTimerEditorMode(null);
      setTimerEditorTimer(null);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(detail);
    } finally {
      setIsTimerEditorBusy(false);
    }
  }, [timerEditorMode, timerEditorTimer, voiceTimers]);

  const readinessItems = useMemo(
    () =>
      createReadinessItems({
        appStatus,
        assistantActive: voiceRuntime.assistantActive,
        hotkeyStatus,
        isLiveTranscribing: voiceRuntime.isLiveTranscribing,
        settings,
        voiceAgentState: voiceRuntime.voiceAgentState,
      }),
    [
      appStatus,
      hotkeyStatus,
      settings,
      voiceRuntime.assistantActive,
      voiceRuntime.isLiveTranscribing,
      voiceRuntime.voiceAgentState,
    ],
  );

  const assistantClosePhrase = useMemo(
    () => `Bye ${settings.assistantName || 'Ava'}`,
    [settings.assistantName],
  );

  const overlayBridgeState = useMemo<OverlayState>(
    () => ({
      assistantActive: voiceRuntime.assistantActive,
      isLiveTranscribing: voiceRuntime.isLiveTranscribing,
      voiceOrbPinned,
      composerVisible,
      settingsVisible: activeView === 'settings',
      assistantStateDetail: voiceRuntime.assistantStateDetail,
      liveTranscriptionStatus: voiceRuntime.liveTranscriptionStatus,
      assistantWakePhrase: voiceRuntime.assistantWakePhrase,
      assistantClosePhrase,
      statusMessage: message,
      uiState,
    }),
    [
      activeView,
      assistantClosePhrase,
      composerVisible,
      message,
      uiState,
      voiceOrbPinned,
      voiceRuntime.assistantActive,
      voiceRuntime.assistantStateDetail,
      voiceRuntime.assistantWakePhrase,
      voiceRuntime.isLiveTranscribing,
      voiceRuntime.liveTranscriptionStatus,
    ],
  );

  const broadcastOverlayState = useCallback((state: OverlayState): void => {
    [ACTION_BAR_WINDOW_LABEL, VOICE_OVERLAY_WINDOW_LABEL, OVERLAY_COMPOSER_WINDOW_LABEL].forEach(
      (label) => {
        void appWindowRef.current
          .emitTo<OverlayState>(label, OVERLAY_STATE_EVENT, state)
          .catch(() => undefined);
      },
    );
  }, []);

  useEffect(() => {
    overlayBridgeStateRef.current = overlayBridgeState;
    broadcastOverlayState(overlayBridgeState);
  }, [broadcastOverlayState, overlayBridgeState]);

  useEffect(() => {
    composerVisibleRef.current = composerVisible;
  }, [composerVisible]);

  useEffect(() => {
    liveTranscribingRef.current = voiceRuntime.isLiveTranscribing;
    if (!listenerTransitionRef.current) {
      listenerDesiredRunningRef.current = voiceRuntime.isLiveTranscribing;
    }
  }, [voiceRuntime.isLiveTranscribing]);

  const handleOverlayActionError = useCallback((error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error);
    setMessage(detail);
  }, []);

  const processComposerWindowTransition = useCallback(async (): Promise<void> => {
    if (composerTransitionRef.current) {
      await composerTransitionRef.current;
      return;
    }

    composerTransitionRef.current = (async () => {
      try {
        while (true) {
          const targetVisible = composerVisibleRef.current;
          const composerWindow = await Window.getByLabel(OVERLAY_COMPOSER_WINDOW_LABEL);

          setComposerVisible(targetVisible);

          if (composerWindow) {
            const isVisible = await composerWindow.isVisible();
            if (isVisible !== targetVisible) {
              if (targetVisible) {
                await composerWindow.show();
                await composerWindow.setFocus();
              } else {
                await composerWindow.hide();
              }
            }
          }

          if (targetVisible === composerVisibleRef.current) {
            break;
          }
        }
      } finally {
        composerTransitionRef.current = null;
      }
    })();

    await composerTransitionRef.current;
  }, []);

  const closeComposerWindow = useCallback(async (): Promise<void> => {
    composerVisibleRef.current = false;
    await processComposerWindowTransition();
  }, [processComposerWindowTransition]);

  const toggleComposerWindow = useCallback(async (): Promise<void> => {
    composerVisibleRef.current = !composerVisibleRef.current;
    await processComposerWindowTransition();
  }, [processComposerWindowTransition]);

  const processListenerTransition = useCallback(async (): Promise<void> => {
    if (listenerTransitionRef.current) {
      await listenerTransitionRef.current;
      return;
    }

    listenerTransitionRef.current = (async () => {
      try {
        while (true) {
          const shouldRun = listenerDesiredRunningRef.current;
          const isRunning = liveTranscribingRef.current;

          if (shouldRun !== isRunning) {
            if (shouldRun) {
              await voiceRuntime.startLiveTranscription();
            } else {
              await voiceRuntime.stopLiveTranscription();
            }
          }

          if (
            shouldRun === listenerDesiredRunningRef.current &&
            liveTranscribingRef.current === shouldRun
          ) {
            break;
          }
        }
      } finally {
        listenerTransitionRef.current = null;
        if (listenerDesiredRunningRef.current !== liveTranscribingRef.current) {
          void processListenerTransition();
        }
      }
    })();

    await listenerTransitionRef.current;
  }, [voiceRuntime.startLiveTranscription, voiceRuntime.stopLiveTranscription]);

  const toggleListenerRunning = useCallback(async (): Promise<void> => {
    listenerDesiredRunningRef.current = !listenerDesiredRunningRef.current;
    await processListenerTransition();
  }, [processListenerTransition]);

  const openSettingsWindow = useCallback(async (): Promise<void> => {
    setActiveView('settings');

    try {
      await appWindowRef.current.unminimize();
    } catch {
      // Some platforms may not expose a minimized state.
    }

    try {
      await appWindowRef.current.show();
      await appWindowRef.current.setFocus();
    } catch {
      // Focusing the main window is best-effort when called from overlay windows.
    }
  }, []);

  useEffect(() => {
    void Window.getByLabel(ACTION_BAR_WINDOW_LABEL)
      .then((window) => window?.show())
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void Window.getByLabel(VOICE_OVERLAY_WINDOW_LABEL)
      .then(async (window) => {
        if (!window) {
          return;
        }

        if (voiceRuntime.assistantActive || voiceOrbPinned) {
          await window.show();
        } else {
          await window.hide();
        }
      })
      .catch(() => undefined);
  }, [voiceOrbPinned, voiceRuntime.assistantActive]);

  useEffect(() => {
    let unlistenOverlayAction: (() => void | Promise<void>) | undefined;

    void appWindowRef.current
      .listen<OverlayAction>(OVERLAY_ACTION_EVENT, (event) => {
        switch (event.payload.type) {
          case 'request-state': {
            const currentState = overlayBridgeStateRef.current;
            if (currentState) {
              broadcastOverlayState(currentState);
            }
            break;
          }
          case 'toggle-live':
          case 'toggle-listener':
            void toggleListenerRunning().catch(handleOverlayActionError);
            break;
          case 'activate':
            void voiceRuntime.activateAssistantVoice('manual').catch(handleOverlayActionError);
            break;
          case 'deactivate':
            void voiceRuntime.deactivateAssistantVoice('manual').catch(handleOverlayActionError);
            break;
          case 'toggle-composer':
            void toggleComposerWindow().catch(handleOverlayActionError);
            break;
          case 'close-composer':
            void closeComposerWindow().catch(handleOverlayActionError);
            break;
          case 'open-settings':
            void openSettingsWindow().catch(handleOverlayActionError);
            break;
          case 'pin-voice-orb':
            setVoiceOrbPinned(true);
            break;
          case 'unpin-voice-orb':
            setVoiceOrbPinned(false);
            break;
        }
      })
      .then((cleanup) => {
        unlistenOverlayAction = cleanup;
      });

    return () => {
      void unlistenOverlayAction?.();
    };
  }, [
    broadcastOverlayState,
    closeComposerWindow,
    handleOverlayActionError,
    openSettingsWindow,
    toggleComposerWindow,
    toggleListenerRunning,
    voiceRuntime.activateAssistantVoice,
    voiceRuntime.deactivateAssistantVoice,
  ]);

  const handleWindowMinimize = async (): Promise<void> => {
    await appWindowRef.current.minimize();
  };

  const handleWindowMaximizeToggle = async (): Promise<void> => {
    await appWindowRef.current.toggleMaximize();
    await syncMainWindowMaximized();
  };

  const handleWindowClose = async (): Promise<void> => {
    try {
      await appWindowRef.current.close();
    } catch {
      await appWindowRef.current.hide();
    }
  };

  const openAccountLoginModal = useCallback((): void => {
    setHostedAccountError(null);
    setLoginProviderMode('hosted');
    setLoginEmail(savedSettings.hostedAccountEmail);
    setLoginPassword('');
    setShowAccountModal(true);
  }, [savedSettings.hostedAccountEmail]);

  const loginEmailValue = loginEmail || savedSettings.hostedAccountEmail;

  const renderDashboardView = (): JSX.Element => (
    <>
      <HeroSection />

      <section className="dashboard-summary-grid" aria-label={i18n.t('dashboardHome.summaryAria')}>
        <article className="dashboard-summary-card">
          <span className="dashboard-summary-card__eyebrow">
            {i18n.t('dashboardHome.assistantEyebrow')}
          </span>
          <h2>{settings.assistantName || 'Ava'}</h2>
          <p className="dashboard-summary-card__copy">
            {voiceRuntime.assistantStateDetail || voiceRuntime.liveTranscriptionStatus}
          </p>
          <div className="dashboard-summary-card__meta">
            <span className="status-chip">
              {voiceRuntime.assistantActive
                ? i18n.t('assistantStatus.assistantActive')
                : voiceRuntime.isLiveTranscribing
                  ? i18n.t('dashboardHome.assistantListening')
                  : i18n.t('dashboardHome.assistantMuted')}
            </span>
            <span className="status-chip">{settings.voiceAgentModel}</span>
          </div>
        </article>

        <article className="dashboard-summary-card">
          <span className="dashboard-summary-card__eyebrow">
            {i18n.t('dashboardHome.accountEyebrow')}
          </span>
          <h2>
            {hostedSignedIn
              ? i18n.t('settings.hostedAccountConnected')
              : i18n.t('settings.hostedAccountDisconnected')}
          </h2>
          <p className="dashboard-summary-card__copy">
            {hostedSignedIn
              ? i18n.t('dashboardHome.accountConnectedCopy', {
                  email: hostedAccount?.user?.email ?? savedSettings.hostedAccountEmail,
                })
              : i18n.t('dashboardHome.accountDisconnectedCopy')}
          </p>
          {hostedSignedIn ? (
            <div className="dashboard-summary-list">
              <div>
                <span>{i18n.t('dashboardHome.accountWorkspaceLabel')}</span>
                <strong>
                  {hostedAccount?.currentTeam?.name ??
                    hostedAccount?.currentTeam?.slug ??
                    i18n.t('settings.hostedWorkspaceCurrentDefault')}
                </strong>
              </div>
            </div>
          ) : null}
          {!hostedSignedIn ? (
            <div className="dashboard-summary-card__actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => openAccountLoginModal()}
              >
                {i18n.t('shell.authLogin')}
              </button>
            </div>
          ) : null}
        </article>

        <article className="dashboard-summary-card">
          <span className="dashboard-summary-card__eyebrow">
            {i18n.t('dashboardHome.modeEyebrow')}
          </span>
          <h2>
            {settings.aiProviderMode === 'hosted'
              ? i18n.t('settings.aiProviderModeHosted')
              : i18n.t('settings.aiProviderModeByo')}
          </h2>
          <p className="dashboard-summary-card__copy">{message}</p>
          <div className="dashboard-summary-list">
            <div>
              <span>{i18n.t('dashboardHome.modeModelLabel')}</span>
              <strong>{settings.voiceAgentModel}</strong>
            </div>
            <div>
              <span>{i18n.t('dashboardHome.modeLanguageLabel')}</span>
              <strong>{settings.sttLanguage.toUpperCase()}</strong>
            </div>
            <div>
              <span>{i18n.t('dashboardHome.modeSessionLabel')}</span>
              <strong>{voiceRuntime.voiceAgentState}</strong>
            </div>
          </div>
        </article>
      </section>

      <TimerSection
        timers={voiceTimers.timers}
        nowMs={voiceTimers.nowMs}
        isLoaded={voiceTimers.isLoaded}
        error={voiceTimers.error}
        onAdd={() => {
          setTimerEditorMode('create');
          setTimerEditorTimer(null);
        }}
        onEdit={(timer) => {
          setTimerEditorMode('edit');
          setTimerEditorTimer(timer);
        }}
        onPause={(timer) => void handlePauseTimer(timer)}
        onResume={(timer) => void handleResumeTimer(timer)}
        onDelete={(timer) => void handleDeleteTimer(timer)}
      />
    </>
  );

  const renderDebugView = (): JSX.Element => (
    <>
      <section className="hero-card app-page-hero">
        <h1>{i18n.t('debugPage.title')}</h1>
        <p className="hero-copy">{i18n.t('debugPage.copy')}</p>
      </section>

      <ReadinessGrid items={readinessItems} />

      <AssistantStatusSection
        voiceAgentState={voiceRuntime.voiceAgentState}
        assistantActive={voiceRuntime.assistantActive}
        isLiveTranscribing={voiceRuntime.isLiveTranscribing}
        liveTranscriptionStatus={voiceRuntime.liveTranscriptionStatus}
        assistantStateDetail={voiceRuntime.assistantStateDetail}
        voiceAgentDetail={voiceRuntime.voiceAgentDetail}
        voiceAgentSession={voiceRuntime.voiceAgentSession}
        assistantWakePhrase={voiceRuntime.assistantWakePhrase}
        wakeThreshold={settings.assistantWakeThreshold}
        cueCooldownMs={settings.assistantCueCooldownMs}
        liveTranscript={voiceRuntime.liveTranscript}
        sttProviderSnapshots={voiceRuntime.providerSnapshots}
        lastSttDebugLogPath={voiceRuntime.lastSttDebugLogPath}
      />

      <VoiceFeedsSection
        voiceAgentState={voiceRuntime.voiceAgentState}
        voiceEventFeed={voiceRuntime.voiceEventFeed}
        voiceTaskFeed={voiceRuntime.voiceTaskFeed}
      />

      <LatestRunSection
        uiState={uiState}
        message={message}
        capturedPreview={capturedPreview}
        translatedPreview={translatedPreview}
        lastTtsMode={lastTtsMode}
        lastRequestedTtsMode={lastRequestedTtsMode}
        lastSessionStrategy={lastSessionStrategy}
        lastSessionId={lastSessionId}
        lastSessionFallbackReason={lastSessionFallbackReason}
        lastSttProvider={voiceRuntime.lastSttProvider}
        lastSttActiveTranscript={voiceRuntime.lastSttActiveTranscript}
        lastSttDebugLogPath={voiceRuntime.lastSttDebugLogPath}
        startLatencyMs={startLatencyMs}
        hotkeyToFirstAudioMs={hotkeyToFirstAudioMs}
        hotkeyToFirstPlaybackMs={hotkeyToFirstPlaybackMs}
        captureDurationMs={captureDurationMs}
        captureToTtsStartMs={captureToTtsStartMs}
        ttsToFirstAudioMs={ttsToFirstAudioMs}
        firstAudioToPlaybackMs={firstAudioToPlaybackMs}
        hotkeyStartedAtMs={hotkeyStartedAtMs}
        captureStartedAtMs={captureStartedAtMs}
        captureFinishedAtMs={captureFinishedAtMs}
        ttsStartedAtMs={ttsStartedAtMs}
        firstAudioReceivedAtMs={firstAudioReceivedAtMs}
        firstAudioPlaybackStartedAtMs={firstAudioPlaybackStartedAtMs}
        lastAudioPath={lastAudioPath}
        lastAudioOutputDirectory={lastAudioOutputDirectory}
        lastAudioChunkCount={lastAudioChunkCount}
      />

      <RunHistorySection entries={runHistory} onClear={() => setRunHistory([])} />
    </>
  );

  const renderTopNavigation = (): JSX.Element => (
    <>
      <button
        type="button"
        className={`window-titlebar__nav-button ${activeView === 'dashboard' ? 'window-titlebar__nav-button--active' : ''}`}
        onClick={() => {
          setActiveView('dashboard');
          setMobileNavOpen(false);
        }}
      >
        {i18n.t('shell.navDashboard')}
      </button>
      <button
        type="button"
        className={`window-titlebar__nav-button ${activeView === 'settings' ? 'window-titlebar__nav-button--active' : ''}`}
        onClick={() => {
          setActiveView('settings');
          setMobileNavOpen(false);
        }}
      >
        {i18n.t('shell.navSettings')}
      </button>
      {DEBUG_NAV_ENABLED ? (
        <button
          type="button"
          className={`window-titlebar__nav-button ${activeView === 'debug' ? 'window-titlebar__nav-button--active' : ''}`}
          onClick={() => {
            setActiveView('debug');
            setMobileNavOpen(false);
          }}
        >
          {i18n.t('shell.navDebug')}
        </button>
      ) : null}
    </>
  );

  const renderActiveView = (): JSX.Element => {
    switch (activeView) {
      case 'settings':
        return (
          <SettingsView
            settings={settings}
            savedSettings={savedSettings}
            setSettings={setSettings}
            languageOptions={languageOptions}
            assistantNameError={assistantNameError}
            assistantCalibrationRequired={assistantCalibrationRequired}
            assistantCalibrationComplete={assistantCalibrationComplete}
            assistantTrainingReadyName={assistantTrainingReadyName}
            isSavingSettings={isSavingSettings}
            isWorking={uiState === 'working'}
            canSaveSettings={canSaveSettings}
            onSaveSection={handleSaveSettingsSection}
            onResetSection={handleResetSettingsSection}
            onResetAll={resetAllSettings}
            onOpenTraining={openAssistantTrainingDialog}
            hostedAccount={hostedAccount}
            hostedAccountError={hostedAccountError}
            normalizeLanguageCode={normalizeLanguageCode}
            hostedSignedIn={hostedSignedIn}
          />
        );
      case 'debug':
        return DEBUG_NAV_ENABLED ? renderDebugView() : renderDashboardView();
      case 'dashboard':
      default:
        return renderDashboardView();
    }
  };

  return (
    <>
      <div className={`app-frame ${isMainWindowMaximized ? 'app-frame--maximized' : ''}`}>
        <header className="window-titlebar">
          <div
            className="window-titlebar__drag"
            data-tauri-drag-region
            onDoubleClick={() => void handleWindowMaximizeToggle()}
          >
            <img
              className="window-titlebar__logo"
              src={coralCompanionLogo}
              alt=""
              aria-hidden="true"
            />
            <span className="window-titlebar__title">CoralCompanion</span>
          </div>
          <nav className="window-titlebar__nav" aria-label={i18n.t('shell.navigationLabel')}>
            {renderTopNavigation()}
          </nav>
          <div className="window-titlebar__side">
            <button
              type="button"
              className="window-titlebar__menu-button"
              aria-label={i18n.t('shell.navigationLabel')}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((current) => !current)}
            >
              <span />
              <span />
              <span />
            </button>
            {hostedStatusMeta ? (
              <div className="window-titlebar__account" aria-live="polite">
                <span className="window-titlebar__account-copy">{hostedStatusMeta}</span>
              </div>
            ) : null}
            <button
              type="button"
              className={`window-titlebar__auth-button ${
                hostedSignedIn
                  ? 'window-titlebar__auth-button--logout'
                  : 'window-titlebar__auth-button--login'
              }`}
              onClick={() => {
                if (hostedSignedIn) {
                  void handleHostedLogout();
                  return;
                }

                openAccountLoginModal();
              }}
            >
              {hostedSignedIn ? i18n.t('shell.authLogout') : i18n.t('shell.authLogin')}
            </button>
            <div className="window-titlebar__controls" aria-label="Window controls">
            <button
              type="button"
              className="window-titlebar__control"
              aria-label="Minimize window"
              onClick={() => void handleWindowMinimize()}
            >
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              >
                <path d="M2 9.2h8" />
              </svg>
            </button>
            <button
              type="button"
              className="window-titlebar__control"
              aria-label={isMainWindowMaximized ? 'Restore window' : 'Maximize window'}
              onClick={() => void handleWindowMaximizeToggle()}
            >
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              >
                {isMainWindowMaximized ? (
                  <>
                    <path d="M3 4.2h5.2V9.4H3z" />
                    <path d="M4.8 2.6H10v5.2" />
                  </>
                ) : (
                  <path d="M2.6 2.6h6.8v6.8H2.6z" />
                )}
              </svg>
            </button>
            <button
              type="button"
              className="window-titlebar__control window-titlebar__control--close"
              aria-label="Hide window"
              onClick={() => void handleWindowClose()}
            >
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              >
                <path d="M2.5 2.5l7 7" />
                <path d="M9.5 2.5l-7 7" />
              </svg>
            </button>
            </div>
          </div>
        </header>

        {mobileNavOpen ? (
          <div
            className="window-titlebar__mobile-drawer-backdrop"
            role="presentation"
            onClick={() => setMobileNavOpen(false)}
          >
            <aside
              className="window-titlebar__mobile-drawer"
              role="navigation"
              aria-label={i18n.t('shell.navigationLabel')}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="window-titlebar__mobile-drawer-nav">{renderTopNavigation()}</div>
              <div className="window-titlebar__mobile-account">
                {hostedStatusMeta ? (
                  <div className="window-titlebar__mobile-account-copy" aria-live="polite">
                    {hostedStatusMeta}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={`window-titlebar__auth-button window-titlebar__mobile-auth-button ${
                    hostedSignedIn
                      ? 'window-titlebar__auth-button--logout'
                      : 'window-titlebar__auth-button--login'
                  }`}
                  onClick={() => {
                    setMobileNavOpen(false);
                    if (hostedSignedIn) {
                      void handleHostedLogout();
                      return;
                    }

                    openAccountLoginModal();
                  }}
                >
                  {hostedSignedIn ? i18n.t('shell.authLogout') : i18n.t('shell.authLogin')}
                </button>
              </div>
            </aside>
          </div>
        ) : null}

        <main className="app-shell">{renderActiveView()}</main>
      </div>

      {showAccountModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={isHostedAccountBusy ? undefined : () => setShowAccountModal(false)}
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              aria-label={i18n.t('dialogs.closeAccountLogin')}
              onClick={() => setShowAccountModal(false)}
              disabled={isHostedAccountBusy}
            >
              x
            </button>
            <span className="settings-panel-eyebrow">{i18n.t('shell.authLogin')}</span>
            <h2 id="account-modal-title">{i18n.t('loginPage.formTitle')}</h2>
            <p>{i18n.t('loginPage.copy')}</p>
            <div className="login-card__grid account-modal__grid">
              <label className="settings-field settings-field--wide">
                <span className="info-label">{i18n.t('settings.aiProviderMode')}</span>
                <select
                  value={loginProviderMode}
                  onChange={(event) =>
                    setLoginProviderMode(event.target.value as AppSettings['aiProviderMode'])
                  }
                >
                  <option value="hosted">{i18n.t('settings.aiProviderModeHosted')}</option>
                  <option value="byo">{i18n.t('settings.aiProviderModeByo')}</option>
                </select>
              </label>
              <label className="settings-field">
                <span className="info-label">{i18n.t('loginPage.usernameLabel')}</span>
                <input
                  type="email"
                  autoComplete="username"
                  placeholder="name@example.com"
                  value={loginEmailValue}
                  onChange={(event) => setLoginEmail(event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span className="info-label">{i18n.t('loginPage.passwordLabel')}</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder={i18n.t('settings.hostedPasswordPlaceholder')}
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                />
              </label>
            </div>
            {hostedAccountError ? (
              <p className="field-note field-note--error">{hostedAccountError}</p>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowAccountModal(false)}
                disabled={isHostedAccountBusy}
              >
                {i18n.t('dialogs.voiceStyleRestartNo')}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={isHostedAccountBusy || !loginEmailValue.trim() || !loginPassword.trim()}
                onClick={() =>
                  void handleHostedLogin({
                    baseUrl: resolvedHostedBaseUrl,
                    email: loginEmailValue,
                    password: loginPassword,
                  })
                }
              >
                {isHostedAccountBusy
                  ? i18n.t('settings.hostedSigningIn')
                  : i18n.t('settings.hostedSignIn')}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showAssistantTrainingDialog ? (
        <AssistantTrainingDialog
          step={currentAssistantTrainingStep}
          isRecording={isAssistantTrainingRecording}
          liveTranscript={assistantTrainingTranscript}
          capturedTranscript={assistantTrainingCapturedTranscript}
          status={assistantTrainingStatus}
          error={assistantTrainingError}
          onClose={closeAssistantTrainingDialog}
          onStartRecording={startAssistantTrainingRecording}
          onStopRecording={stopAssistantTrainingRecording}
          onRetry={retryAssistantTrainingStep}
          onConfirm={confirmAssistantTrainingStep}
        />
      ) : null}

      <VoiceStyleRestartDialog
        open={pendingVoiceSessionChange !== null}
        changeSummary={
          pendingVoiceSessionChange?.summary ?? {
            genderChanged: true,
            modelChanged: false,
            voiceChanged: false,
            providerChanged: false,
          }
        }
        isBusy={isSavingSettings}
        onClose={() => setPendingVoiceSessionChange(null)}
        onConfirm={() => void handleConfirmVoiceStyleRestart()}
      />

      <TimerEditorDialog
        open={timerEditorMode !== null}
        timer={timerEditorMode === 'edit' ? timerEditorTimer : null}
        isBusy={isTimerEditorBusy}
        onClose={() => {
          setTimerEditorMode(null);
          setTimerEditorTimer(null);
        }}
        onSubmit={(payload) => void handleSubmitTimerEditor(payload)}
      />
    </>
  );

  async function resetAllSettings(): Promise<void> {
    setIsSavingSettings(true);
    try {
      const previousSettings = savedSettings;
      const defaults = await resetSettings();
      setSettings(defaults);
      setSavedSettings(defaults);
      const summary = buildVoiceSessionChangeSummary(defaults, previousSettings);

      if (hasVoiceSessionChange(summary)) {
        const sessionAction = getVoiceSessionChangeAction(summary);
        if (sessionAction === 'disconnect') {
          await voiceRuntime.closeVoiceAgentSession(getVoiceSessionChangeReason(summary));
        } else {
          await voiceRuntime.restartVoiceAgentSession(
            getVoiceSessionChangeReason(summary),
            voiceRuntime.assistantActive,
          );
        }
      }

      setMessage(i18n.t('app.resetSuccess'));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setUiState('error');
      setMessage(i18n.t('app.failedToResetSettings', { detail }));
    } finally {
      setIsSavingSettings(false);
    }
  }
}
