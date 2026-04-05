import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { DESIGN_THEME_OPTIONS, getDesignThemeLabel, normalizeDesignThemeId } from './designThemes';
import type { AppSettings, LanguageOption } from './lib/voiceOverlay';
import {
  ASSISTANT_CUE_COOLDOWN_MS_MAX,
  ASSISTANT_MATCH_THRESHOLD_MAX,
  ASSISTANT_MATCH_THRESHOLD_MIN,
} from './lib/liveStt';

type SettingsSectionId = 'general' | 'assistant' | 'startup' | 'api' | 'design';

type SettingsViewProps = {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  languageOptions: LanguageOption[];
  assistantNameError: string | null;
  assistantCalibrationRequired: boolean;
  assistantCalibrationComplete: boolean;
  assistantTrainingReadyName: string | null;
  isSavingSettings: boolean;
  isWorking: boolean;
  hasUnsavedChanges: boolean;
  canSaveSettings: boolean;
  onSave: () => Promise<unknown>;
  onReset: () => void;
  onBack: () => void;
  onOpenTraining: () => Promise<void>;
  normalizeLanguageCode: (language: string) => string;
};

type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  description: string;
  summary: string;
};

function parseBoundedInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export default function SettingsView({
  settings,
  setSettings,
  languageOptions,
  assistantNameError,
  assistantCalibrationRequired,
  assistantCalibrationComplete,
  assistantTrainingReadyName,
  isSavingSettings,
  isWorking,
  hasUnsavedChanges,
  canSaveSettings,
  onSave,
  onReset,
  onBack,
  onOpenTraining,
  normalizeLanguageCode,
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId | null>(null);

  const translationTargetLabel = useMemo(
    () =>
      languageOptions.find((option) => option.code === settings.translationTargetLanguage)?.label ??
      settings.translationTargetLanguage.toUpperCase(),
    [languageOptions, settings.translationTargetLanguage],
  );
  const selectedThemeLabel = useMemo(
    () => getDesignThemeLabel(settings.designThemeId),
    [settings.designThemeId],
  );

  const settingsSections = useMemo<SettingsSection[]>(() => {
    const assistantLabel = settings.assistantName.trim() || 'Ava';
    const assistantLanguage = settings.sttLanguage.trim().toUpperCase() || 'DE';
    const assistantSummary =
      assistantCalibrationComplete && assistantTrainingReadyName === settings.assistantName
        ? `${assistantLabel} / ${assistantLanguage} / training ready`
        : assistantCalibrationRequired
          ? `${assistantLabel} / ${assistantLanguage} / training recommended`
          : `${assistantLabel} / ${assistantLanguage}`;

    return [
      {
        id: 'general',
        label: 'General',
        description: 'Target language, UI language, and playback speed from dev.',
        summary: `${translationTargetLabel} / UI ${settings.uiLanguage.toUpperCase()} / ${settings.playbackSpeed.toFixed(1)}x`,
      },
      {
        id: 'assistant',
        label: 'Assistant',
        description: 'Wake name, STT language, and assistant matching settings from dev.',
        summary: assistantSummary,
      },
      {
        id: 'startup',
        label: 'Startup',
        description: 'Launch and background behavior from dev.',
        summary: settings.launchAtLogin
          ? settings.startHiddenOnLaunch
            ? 'Auto-start hidden'
            : 'Auto-start visible'
          : 'Manual start',
      },
      {
        id: 'api',
        label: 'API',
        description: 'Only the OpenAI key field from dev.',
        summary: settings.openaiApiKey ? 'Custom API key' : 'Using .env key',
      },
      {
        id: 'design',
        label: 'Design',
        description: 'Your theme system for dashboard, settings, action bar, and orb.',
        summary: selectedThemeLabel,
      },
    ];
  }, [
    assistantCalibrationComplete,
    assistantCalibrationRequired,
    assistantTrainingReadyName,
    selectedThemeLabel,
    settings.assistantName,
    settings.launchAtLogin,
    settings.openaiApiKey,
    settings.playbackSpeed,
    settings.startHiddenOnLaunch,
    settings.sttLanguage,
    settings.translationTargetLanguage,
    settings.uiLanguage,
    translationTargetLabel,
  ]);

  const saveDisabled = !hasUnsavedChanges || isSavingSettings || isWorking || !canSaveSettings;
  const settingsStatusTone = assistantNameError ? 'error' : hasUnsavedChanges ? 'pending' : 'saved';
  const settingsStatusText = assistantNameError
    ? assistantNameError
    : hasUnsavedChanges
      ? 'Unsaved changes are ready to save.'
      : 'All settings are saved.';

  const renderDetail = () => {
    if (!activeSection) {
      return (
        <div className="settings-panel-empty">
          <span className="settings-panel-eyebrow">Settings overview</span>
          <h2>Select a category</h2>
          <p className="settings-helper">
            On the left you only see the main categories. Click one of them and the matching dev settings appear on the right.
          </p>
          <div className="settings-panel-meta">
            <span className={`settings-state-pill settings-state-pill--${settingsStatusTone}`}>{settingsStatusText}</span>
            <p className="field-note">Save applies changes to future hotkey runs and stores them in the local config file.</p>
          </div>
        </div>
      );
    }

    if (activeSection === 'general') {
      return (
        <div className="settings-detail-stack">
          <div className="settings-panel-header">
            <div>
              <span className="settings-panel-eyebrow">General</span>
              <h2>General</h2>
              <p className="settings-helper">These are the language and playback settings that belong to dev.</p>
            </div>
            <button type="button" className="settings-link-button" onClick={() => setActiveSection(null)}>
              Show categories
            </button>
          </div>
          <div className="settings-grid">
            <label className="settings-field">
              <span className="info-label">Translation target language</span>
              <select
                value={settings.translationTargetLanguage}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    translationTargetLanguage: event.target.value,
                  })
                }
              >
                {languageOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field settings-field--wide">
              <span className="info-label">Speech playback speed</span>
              <div className="slider-row">
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={settings.playbackSpeed}
                  onChange={(event) =>
                    setSettings({ ...settings, playbackSpeed: Number(event.target.value) })
                  }
                />
                <output>{settings.playbackSpeed.toFixed(1)}x</output>
              </div>
              <span className="field-note">0.5x is slower, 1.0x is default, 2.0x is faster.</span>
            </label>

            <label className="settings-field">
              <span className="info-label">UI language</span>
              <select
                value={settings.uiLanguage}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    uiLanguage: event.target.value,
                  })
                }
              >
                <option value="en">English</option>
                <option value="de">Deutsch</option>
              </select>
              <span className="field-note">This changes the app language, not the speech language.</span>
            </label>
          </div>
        </div>
      );
    }

    if (activeSection === 'assistant') {
      return (
        <div className="settings-detail-stack">
          <div className="settings-panel-header">
            <div>
              <span className="settings-panel-eyebrow">Assistant</span>
              <h2>Assistant</h2>
              <p className="settings-helper">Only the assistant naming, training, and listening settings from dev.</p>
            </div>
            <button type="button" className="settings-link-button" onClick={() => setActiveSection(null)}>
              Show categories
            </button>
          </div>
          <div className="settings-grid">
            <label className="settings-field settings-field--wide">
              <span className="info-label">Assistant name</span>
              <div className="inline-field-row">
                <input
                  type="text"
                  placeholder="Ava"
                  value={settings.assistantName}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    setSettings({
                      ...settings,
                      assistantName: nextName,
                      assistantWakeSamples: [],
                      assistantNameSamples: [],
                      assistantSampleLanguage: normalizeLanguageCode(settings.sttLanguage),
                    });
                  }}
                />
                <button
                  type="button"
                  className="secondary-button secondary-button--icon"
                  disabled={Boolean(assistantNameError) || isSavingSettings}
                  onClick={() => void onOpenTraining()}
                >
                  Train wake phrase
                </button>
              </div>
              {assistantNameError ? <span className="field-note field-note--error">{assistantNameError}</span> : null}
              {!assistantNameError && assistantCalibrationRequired && !assistantCalibrationComplete ? (
                <span className="field-note field-note--warning">
                  Wake-word training is required again after changing the name or language.
                </span>
              ) : null}
              {!assistantNameError &&
              assistantCalibrationComplete &&
              assistantTrainingReadyName === settings.assistantName ? (
                <span className="field-note field-note--success">
                  Wake-word calibration is ready for this name and language.
                </span>
              ) : null}
              <span className="field-note">
                Use 3-8 characters, one single word. The wake phrase stays <code>Hey {settings.assistantName || 'Ava'}</code>.
              </span>
            </label>

            <label className="settings-field">
              <span className="info-label">Active transcription language</span>
              <input
                type="text"
                placeholder="de"
                value={settings.sttLanguage}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    sttLanguage: event.target.value,
                    assistantWakeSamples: [],
                    assistantNameSamples: [],
                    assistantSampleLanguage: normalizeLanguageCode(event.target.value),
                  })
                }
              />
              <span className="field-note">If you change it, record the training samples again, for example <code>de</code> or <code>en</code>.</span>
            </label>

            <label className="settings-field">
              <span className="info-label">Wake match threshold</span>
              <div className="slider-row">
                <input
                  type="range"
                  min={ASSISTANT_MATCH_THRESHOLD_MIN}
                  max={ASSISTANT_MATCH_THRESHOLD_MAX}
                  step="1"
                  value={settings.assistantWakeThreshold}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      assistantWakeThreshold: parseBoundedInteger(
                        event.target.value,
                        settings.assistantWakeThreshold,
                        ASSISTANT_MATCH_THRESHOLD_MIN,
                        ASSISTANT_MATCH_THRESHOLD_MAX,
                      ),
                    })
                  }
                />
                <output>{settings.assistantWakeThreshold}</output>
              </div>
              <span className="field-note">Higher values make wake detection stricter.</span>
            </label>

            <label className="settings-field">
              <span className="info-label">Cue cooldown</span>
              <input
                type="number"
                min="0"
                max={ASSISTANT_CUE_COOLDOWN_MS_MAX}
                step="100"
                value={settings.assistantCueCooldownMs}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    assistantCueCooldownMs: parseBoundedInteger(
                      event.target.value,
                      settings.assistantCueCooldownMs,
                      0,
                      ASSISTANT_CUE_COOLDOWN_MS_MAX,
                    ),
                  })
                }
              />
              <span className="field-note">Milliseconds to ignore repeated wake hits right after activation.</span>
            </label>
          </div>
        </div>
      );
    }

    if (activeSection === 'startup') {
      return (
        <div className="settings-detail-stack">
          <div className="settings-panel-header">
            <div>
              <span className="settings-panel-eyebrow">Startup</span>
              <h2>Startup</h2>
              <p className="settings-helper">These are the startup and background options kept from dev.</p>
            </div>
            <button type="button" className="settings-link-button" onClick={() => setActiveSection(null)}>
              Show categories
            </button>
          </div>
          <div className="settings-grid">
            <label className="settings-field settings-field--wide">
              <span className="info-label">Background startup</span>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.launchAtLogin}
                  onChange={(event) =>
                    setSettings({ ...settings, launchAtLogin: event.target.checked })
                  }
                />
                <span>Launch the app automatically when I sign in to Windows</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.startHiddenOnLaunch}
                  disabled={!settings.launchAtLogin}
                  onChange={(event) =>
                    setSettings({ ...settings, startHiddenOnLaunch: event.target.checked })
                  }
                />
                <span>When started automatically, keep the window hidden and run in the background</span>
              </label>
              <span className="field-note">Saving this writes or removes the Windows Startup launcher for the current executable.</span>
            </label>
          </div>
        </div>
      );
    }

    if (activeSection === 'api') {
      return (
        <div className="settings-detail-stack">
          <div className="settings-panel-header">
            <div>
              <span className="settings-panel-eyebrow">API</span>
              <h2>API</h2>
              <p className="settings-helper">Only the OpenAI API key field remains here, exactly like in dev.</p>
            </div>
            <button type="button" className="settings-link-button" onClick={() => setActiveSection(null)}>
              Show categories
            </button>
          </div>
          <div className="settings-grid">
            <label className="settings-field settings-field--wide">
              <span className="info-label">OpenAI API key</span>
              <input
                type="password"
                autoComplete="off"
                placeholder="sk-..."
                value={settings.openaiApiKey}
                onChange={(event) =>
                  setSettings({ ...settings, openaiApiKey: event.target.value })
                }
              />
              <span className="field-note">When set here, it overrides <code>OPENAI_API_KEY</code> from <code>.env</code>.</span>
            </label>
          </div>
        </div>
      );
    }

    const selectedThemeId = normalizeDesignThemeId(settings.designThemeId);

    return (
      <div className="settings-detail-stack">
        <div className="settings-panel-header">
          <div>
            <span className="settings-panel-eyebrow">Design</span>
            <h2>Design</h2>
            <p className="settings-helper">These are the theme options from your design branches and nothing else.</p>
          </div>
          <button type="button" className="settings-link-button" onClick={() => setActiveSection(null)}>
            Show categories
          </button>
        </div>
        <div className="design-grid">
          {DESIGN_THEME_OPTIONS.map((theme) => {
            const isActive = selectedThemeId === theme.id;
            return (
              <button
                type="button"
                key={theme.id}
                data-preview-theme={theme.id}
                className={`design-card ${isActive ? 'design-card--active' : ''}`}
                onClick={() => setSettings({ ...settings, designThemeId: theme.id })}
              >
                <div className="design-card__preview" aria-hidden="true">
                  <span className="design-card__preview-window" />
                  <span className="design-card__preview-rail" />
                  <span className="design-card__preview-panel" />
                  <span className="design-card__preview-orb">
                    <span className="design-card__preview-ring design-card__preview-ring--outer" />
                    <span className="design-card__preview-ring design-card__preview-ring--middle" />
                    <span className="design-card__preview-core" />
                  </span>
                </div>
                <span className="design-card__eyebrow">{theme.accent}</span>
                <strong className="design-card__title">{theme.label}</strong>
                <p className="design-card__description">{theme.description}</p>
                <span className="design-card__meta">{isActive ? 'Selected for preview' : theme.contrast}</span>
              </button>
            );
          })}
        </div>
        <p className="field-note">The main window previews your selection immediately. Save the settings to push the design to the action bar, the orb overlay, and future launches.</p>
      </div>
    );
  };

  return (
    <>
      <section className="hero-card settings-page-hero">
        <div className="settings-page-toolbar">
          <button type="button" className="toolbar-button toolbar-button--ghost" onClick={onBack}>
            <span className="toolbar-button__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </span>
            <span className="toolbar-button__label">Dashboard</span>
          </button>
          <div className="settings-actions">
            <button type="button" className="secondary-button" disabled={saveDisabled} onClick={() => void onSave()}>
              {isSavingSettings ? 'Saving...' : 'Save settings'}
            </button>
            <button type="button" className="danger-button" disabled={isSavingSettings || isWorking} onClick={onReset}>
              Reset to defaults
            </button>
          </div>
        </div>
        <h1>Settings</h1>
        <p className="hero-copy">This page now keeps only the dev settings plus the theme selection from your design work.</p>
        <div className="settings-panel-meta">
          <span className={`settings-state-pill settings-state-pill--${settingsStatusTone}`}>{settingsStatusText}</span>
          <p className="field-note">Save applies changes to future hotkey runs and stores them in the local config file.</p>
        </div>
      </section>

      <section className="settings-layout">
        <aside className="settings-sidebar">
          <span className="info-label">Categories</span>
          <div className="settings-nav">
            {settingsSections.map((section) => (
              <button
                type="button"
                key={section.id}
                className={`settings-nav-button ${activeSection === section.id ? 'settings-nav-button--active' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                <span className="settings-nav-copy">
                  <span className="settings-nav-title">{section.label}</span>
                  <span className="settings-nav-description">{section.description}</span>
                </span>
                <span className="settings-nav-summary">{section.summary}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className={`settings-detail-panel ${activeSection ? '' : 'settings-detail-panel--empty'}`}>
          {renderDetail()}
        </section>
      </section>
    </>
  );
}
