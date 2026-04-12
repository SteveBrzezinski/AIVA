import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { DESIGN_THEME_OPTIONS, normalizeDesignThemeId } from './designThemes';
import {
  formatRealtimeVoiceLabel,
  realtimeVoiceOptionsForModel,
  sanitizeVoiceAgentVoiceForModel,
} from './lib/app/realtimeVoiceCatalog';
import {
  areSettingsSectionsEqual,
  mergeSettingsSection,
  type SettingsSectionId,
} from './lib/app/settingsSections';
import type {
  AppSettings,
  HostedAccountStatus,
  LanguageOption,
} from './lib/voiceOverlay';
import {
  ASSISTANT_CUE_COOLDOWN_MS_MAX,
  ASSISTANT_MATCH_THRESHOLD_MAX,
  ASSISTANT_MATCH_THRESHOLD_MIN,
} from './lib/liveStt';
import { SettingsConfirmDialog } from './components/app/SettingsConfirmDialog';

type SettingsViewProps = {
  settings: AppSettings;
  savedSettings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  languageOptions: LanguageOption[];
  assistantNameError: string | null;
  assistantCalibrationRequired: boolean;
  assistantCalibrationComplete: boolean;
  assistantTrainingReadyName: string | null;
  isSavingSettings: boolean;
  isWorking: boolean;
  canSaveSettings: boolean;
  onSaveSection: (sectionId: SettingsSectionId) => Promise<unknown>;
  onResetSection: (sectionId: SettingsSectionId) => Promise<unknown>;
  onResetAll: () => Promise<unknown>;
  onOpenTraining: () => Promise<void>;
  hostedAccount: HostedAccountStatus | null;
  hostedAccountError: string | null;
  normalizeLanguageCode: (language: string) => string;
  hostedSignedIn: boolean;
};

type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  helper: string;
};

const VOICE_AGENT_GENDER_OPTIONS: Array<{
  value: AppSettings['voiceAgentGender'];
  labelKey:
    | 'settings.voiceAssistantGenderOptionFeminine'
    | 'settings.voiceAssistantGenderOptionMasculine'
    | 'settings.voiceAssistantGenderOptionNeutral';
}> = [
  { value: 'feminine', labelKey: 'settings.voiceAssistantGenderOptionFeminine' },
  { value: 'masculine', labelKey: 'settings.voiceAssistantGenderOptionMasculine' },
  { value: 'neutral', labelKey: 'settings.voiceAssistantGenderOptionNeutral' },
];

const VOICE_AGENT_MODEL_OPTIONS = [
  { value: 'gpt-realtime', labelKey: 'settings.voiceAssistantModelOptionRealtime' },
  { value: 'gpt-realtime-mini', labelKey: 'settings.voiceAssistantModelOptionRealtimeMini' },
] as const;

function parseBoundedInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export default function SettingsView({
  settings,
  savedSettings,
  setSettings,
  languageOptions,
  assistantNameError,
  assistantCalibrationRequired,
  assistantCalibrationComplete,
  assistantTrainingReadyName,
  isSavingSettings,
  isWorking,
  canSaveSettings,
  onSaveSection,
  onResetSection,
  onResetAll,
  onOpenTraining,
  hostedAccount,
  hostedAccountError,
  normalizeLanguageCode,
  hostedSignedIn,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
  const [pendingSectionSwitch, setPendingSectionSwitch] = useState<SettingsSectionId | null>(null);
  const [resetTarget, setResetTarget] = useState<
    { type: 'section'; sectionId: SettingsSectionId } | { type: 'all' } | null
  >(null);

  const isHostedMode = settings.aiProviderMode === 'hosted';
  const hostedRealtimeEnabled = Boolean(
    hostedAccount?.entitlements.some((item) => item.feature === 'hosted_realtime' && item.enabled),
  );
  const availableVoiceOptions = useMemo(
    () => realtimeVoiceOptionsForModel(settings.voiceAgentModel),
    [settings.voiceAgentModel],
  );

  const settingsSections = useMemo<SettingsSection[]>(
    () => [
      { id: 'general', label: t('settingsPage.sections.general.label'), helper: t('settingsPage.sections.general.helper') },
      { id: 'assistant', label: t('settingsPage.sections.assistant.label'), helper: t('settingsPage.sections.assistant.helper') },
      { id: 'startup', label: t('settingsPage.sections.startup.label'), helper: t('settingsPage.sections.startup.helper') },
      { id: 'api', label: t('settingsPage.sections.api.label'), helper: t('settingsPage.sections.api.helper') },
      { id: 'design', label: t('settingsPage.sections.design.label'), helper: t('settingsPage.sections.design.helper') },
      { id: 'actionbar', label: t('settingsPage.sections.actionbar.label'), helper: t('settingsPage.sections.actionbar.helper') },
    ],
    [t],
  );

  const sectionLookup = useMemo(
    () =>
      settingsSections.reduce<Record<SettingsSectionId, SettingsSection>>((result, section) => {
        result[section.id] = section;
        return result;
      }, {} as Record<SettingsSectionId, SettingsSection>),
    [settingsSections],
  );

  const currentSection = sectionLookup[activeSection];
  const currentSectionDirty = !areSettingsSectionsEqual(settings, savedSettings, activeSection);
  const canSaveCurrentSection = activeSection === 'assistant' ? canSaveSettings : true;
  const saveDisabled =
    !currentSectionDirty || isSavingSettings || isWorking || !canSaveCurrentSection;
  const resetDisabled = isSavingSettings || isWorking;
  const discardPendingSectionChanges = (): void => {
    setSettings((current) => mergeSettingsSection(current, savedSettings, activeSection));
  };

  const handleSectionSelect = (sectionId: SettingsSectionId): void => {
    if (sectionId === activeSection) {
      return;
    }

    if (currentSectionDirty) {
      setPendingSectionSwitch(sectionId);
      return;
    }

    setActiveSection(sectionId);
  };

  const handleConfirmSectionSwitch = (): void => {
    if (!pendingSectionSwitch) {
      return;
    }

    discardPendingSectionChanges();
    setActiveSection(pendingSectionSwitch);
    setPendingSectionSwitch(null);
  };

  const renderSectionHeader = (sectionId: SettingsSectionId): JSX.Element => (
    <div className="settings-panel-header">
      <div>
        <h2>{sectionLookup[sectionId].label}</h2>
      </div>
      <div className="settings-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={saveDisabled}
          onClick={() => void onSaveSection(sectionId)}
        >
          {isSavingSettings ? t('settings.saving') : t('settings.save')}
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={resetDisabled}
          onClick={() => setResetTarget({ type: 'section', sectionId })}
        >
          {t('settings.reset')}
        </button>
      </div>
    </div>
  );

  const renderGeneralSection = (): JSX.Element => (
    <div className="settings-detail-stack">
      {renderSectionHeader('general')}
      <div className="settings-grid">
        <label className="settings-field">
          <span className="info-label">{t('settings.translationTargetLanguage')}</span>
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
          <span className="info-label">{t('settings.speechPlaybackSpeed')}</span>
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
          <span className="field-note">{t('settings.speechPlaybackSpeedNote')}</span>
        </label>

        <label className="settings-field">
          <span className="info-label">{t('settings.uiLanguage')}</span>
          <select
            value={settings.uiLanguage}
            onChange={(event) =>
              setSettings({
                ...settings,
                uiLanguage: event.target.value,
              })
            }
          >
            <option value="en">{t('settings.uiLanguageOptionEn')}</option>
            <option value="de">{t('settings.uiLanguageOptionDe')}</option>
          </select>
          <span className="field-note">{t('settings.uiLanguageNote')}</span>
        </label>

        <label className="settings-field">
          <span className="info-label">{t('settings.timerNotificationMode')}</span>
          <select
            value={settings.timerNotificationMode}
            onChange={(event) =>
              setSettings({
                ...settings,
                timerNotificationMode: event.target.value as AppSettings['timerNotificationMode'],
              })
            }
          >
            <option value="signal">{t('settings.timerNotificationModeSignal')}</option>
            <option value="voice">{t('settings.timerNotificationModeVoice')}</option>
          </select>
          <span className="field-note">{t('settings.timerNotificationModeNote')}</span>
        </label>

        <label className="settings-field">
          <span className="info-label">{t('settings.timerSignalTone')}</span>
          <select
            value={settings.timerSignalTone}
            disabled={settings.timerNotificationMode !== 'signal'}
            onChange={(event) =>
              setSettings({
                ...settings,
                timerSignalTone: event.target.value as AppSettings['timerSignalTone'],
              })
            }
          >
            <option value="soft-bell">{t('settings.timerSignalToneOptionSoftBell')}</option>
            <option value="digital-pulse">{t('settings.timerSignalToneOptionDigitalPulse')}</option>
            <option value="glass-rise">{t('settings.timerSignalToneOptionGlassRise')}</option>
          </select>
          <span className="field-note">{t('settings.timerSignalToneNote')}</span>
        </label>
      </div>
    </div>
  );

  const renderAssistantSection = (): JSX.Element => (
    <div className="settings-detail-stack">
      {renderSectionHeader('assistant')}
      <div className="settings-grid">
        <label className="settings-field settings-field--wide">
          <span className="info-label">{t('settings.assistantName')}</span>
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
              {t('settings.trainWakePhrase')}
            </button>
          </div>
          {assistantNameError ? (
            <span className="field-note field-note--error">{assistantNameError}</span>
          ) : null}
          {!assistantNameError &&
          assistantCalibrationRequired &&
          !assistantCalibrationComplete ? (
            <span className="field-note field-note--warning">
              {t('settings.assistantCalibrationWarning')}
            </span>
          ) : null}
          {!assistantNameError &&
          assistantCalibrationComplete &&
          assistantTrainingReadyName === settings.assistantName ? (
            <span className="field-note field-note--success">
              {t('settings.assistantCalibrationReady')}
            </span>
          ) : null}
          <span className="field-note">
            <Trans
              i18nKey="settings.assistantNameNote"
              values={{ assistantName: settings.assistantName || 'Ava' }}
              components={{ wake: <code /> }}
            />
          </span>
        </label>

        <label className="settings-field">
          <span className="info-label">{t('settings.voiceAssistantModel')}</span>
          <select
            value={settings.voiceAgentModel}
            onChange={(event) => {
              const nextModel = event.target.value;
              setSettings({
                ...settings,
                voiceAgentModel: nextModel,
                voiceAgentVoice: sanitizeVoiceAgentVoiceForModel(
                  settings.voiceAgentVoice,
                  nextModel,
                ),
              });
            }}
          >
            {VOICE_AGENT_MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
          <span className="field-note">{t('settings.voiceAssistantModelNote')}</span>
        </label>

        <label className="settings-field">
          <span className="info-label">{t('settings.voiceAssistantVoice')}</span>
          <select
            value={sanitizeVoiceAgentVoiceForModel(
              settings.voiceAgentVoice,
              settings.voiceAgentModel,
            )}
            onChange={(event) =>
              setSettings({
                ...settings,
                voiceAgentVoice: event.target.value,
              })
            }
          >
            {availableVoiceOptions.map((voice) => (
              <option key={voice} value={voice}>
                {formatRealtimeVoiceLabel(voice)}
              </option>
            ))}
          </select>
          <span className="field-note">{t('settings.voiceAssistantVoiceNote')}</span>
        </label>

        <label className="settings-field">
          <span className="info-label">{t('settings.voiceAssistantGender')}</span>
          <select
            value={settings.voiceAgentGender}
            onChange={(event) =>
              setSettings({
                ...settings,
                voiceAgentGender: event.target.value as AppSettings['voiceAgentGender'],
              })
            }
          >
            {VOICE_AGENT_GENDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
          <span className="field-note">{t('settings.voiceAssistantGenderNote')}</span>
        </label>

        <label className="settings-field">
          <span className="info-label">{t('settings.activeTranscriptionLanguage')}</span>
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
          <span className="field-note">
            <Trans
              i18nKey="settings.activeTranscriptionLanguageNote"
              components={{ code: <code /> }}
            />
          </span>
        </label>

        <label className="settings-field">
          <span className="info-label">{t('settings.wakeMatchThreshold')}</span>
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
          <span className="field-note">{t('settings.wakeMatchThresholdNote')}</span>
        </label>

        <label className="settings-field">
          <span className="info-label">{t('settings.cueCooldown')}</span>
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
          <span className="field-note">{t('settings.cueCooldownNote')}</span>
        </label>
      </div>
    </div>
  );

  const renderStartupSection = (): JSX.Element => (
    <div className="settings-detail-stack">
      {renderSectionHeader('startup')}
      <div className="settings-grid">
        <label className="settings-field settings-field--wide">
          <span className="info-label">{t('settings.backgroundStartup')}</span>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.launchAtLogin}
              onChange={(event) =>
                setSettings({ ...settings, launchAtLogin: event.target.checked })
              }
            />
            <span>{t('settings.launchAtLogin')}</span>
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
            <span>{t('settings.startHiddenOnLaunch')}</span>
          </label>
          <span className="field-note">{t('settings.backgroundStartupNote')}</span>
        </label>
      </div>
    </div>
  );

  const renderApiSection = (): JSX.Element => (
    <div className="settings-detail-stack">
      {renderSectionHeader('api')}
      <div className="settings-grid">
        <label className="settings-field settings-field--wide">
          <span className="info-label">{t('settings.aiProviderMode')}</span>
          <select
            value={hostedSignedIn ? settings.aiProviderMode : 'byo'}
            onChange={(event) =>
              setSettings({
                ...settings,
                aiProviderMode: event.target.value as AppSettings['aiProviderMode'],
              })
            }
          >
            <option value="byo">{t('settings.aiProviderModeByo')}</option>
            {hostedSignedIn ? (
              <option value="hosted">{t('settings.aiProviderModeHosted')}</option>
            ) : null}
          </select>
          <span className="field-note">{t('settings.aiProviderModeNote')}</span>
          {!hostedSignedIn ? (
            <span className="field-note">{t('settings.hostedLoginPageNote')}</span>
          ) : null}
          {isHostedMode && hostedSignedIn ? (
            <span className="field-note field-note--warning">
              {t('settings.hostedModeScopeNote')}
            </span>
          ) : null}
        </label>

        {isHostedMode && hostedSignedIn ? (
          <>
            <div className="settings-field settings-field--wide">
              <span className="info-label">{t('settings.hostedAccount')}</span>
              <div className="settings-auth-panel">
                <div className="settings-auth-summary">
                  <strong>
                    {hostedSignedIn
                      ? t('settings.hostedAccountConnected')
                      : t('settings.hostedAccountDisconnected')}
                  </strong>
                  <p>
                    {hostedAccountError
                      ? hostedAccountError
                      : hostedSignedIn
                        ? t('settings.hostedAccountSummary', {
                            email:
                              hostedAccount?.user?.email ??
                              settings.hostedAccountEmail.trim() ??
                              '',
                            workspace:
                              hostedAccount?.currentTeam?.name ??
                              hostedAccount?.currentTeam?.slug ??
                              t('settings.hostedWorkspaceCurrentDefault'),
                          })
                        : t('settings.hostedAccountSummaryDisconnected')}
                  </p>
                  {hostedAccount?.subscription ? (
                    <p>
                      {t('settings.hostedSubscriptionSummary', {
                        plan: hostedAccount.subscription.planKey,
                        seats: hostedAccount.subscription.seats,
                        status: hostedAccount.subscription.status,
                      })}
                    </p>
                  ) : null}
                  {hostedSignedIn ? (
                    <p>
                      {hostedRealtimeEnabled
                        ? t('settings.hostedRealtimeReady')
                        : t('settings.hostedRealtimeUnavailable')}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="settings-field settings-field--wide">
              <span className="info-label">{t('settings.hostedWorkspace')}</span>
              {hostedAccount?.teams.length ? (
                <select
                  value={settings.hostedWorkspaceSlug}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      hostedWorkspaceSlug: event.target.value,
                    })
                  }
                >
                  <option value="">
                    {t('settings.hostedWorkspaceUseCurrent', {
                      workspace:
                        hostedAccount.currentTeam?.name ??
                        hostedAccount.currentTeam?.slug ??
                        t('settings.hostedWorkspaceCurrentDefault'),
                    })}
                  </option>
                  {hostedAccount.teams.map((team) => (
                    <option key={team.slug} value={team.slug}>
                      {team.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="my-workspace"
                  value={settings.hostedWorkspaceSlug}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      hostedWorkspaceSlug: event.target.value,
                    })
                  }
                />
              )}
              <span className="field-note">{t('settings.hostedWorkspaceNote')}</span>
            </div>
          </>
        ) : (
          <label className="settings-field settings-field--wide">
            <span className="info-label">{t('settings.openaiApiKey')}</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-..."
              value={settings.openaiApiKey}
              onChange={(event) =>
                setSettings({ ...settings, openaiApiKey: event.target.value })
              }
            />
            <span className="field-note">
              <Trans
                i18nKey="settings.openaiApiKeyNote"
                components={{ env: <code />, envFile: <code /> }}
              />
            </span>
          </label>
        )}
      </div>
    </div>
  );
  const renderDesignSection = (): JSX.Element => {
    const selectedThemeId = normalizeDesignThemeId(settings.designThemeId);

    return (
      <div className="settings-detail-stack">
        {renderSectionHeader('design')}
        <div className="design-grid">
          {DESIGN_THEME_OPTIONS.map((theme) => {
            const isActive = selectedThemeId === theme.id;
            const themeAccent = t(`settingsPage.themeCards.${theme.id}.accent`, {
              defaultValue: theme.accent,
            });
            const themeDescription = t(`settingsPage.themeCards.${theme.id}.description`, {
              defaultValue: theme.description,
            });
            const themeContrast = t(`settingsPage.themeCards.${theme.id}.contrast`, {
              defaultValue: theme.contrast,
            });
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
                <span className="design-card__eyebrow">{themeAccent}</span>
                <strong className="design-card__title">{theme.label}</strong>
                <p className="design-card__description">{themeDescription}</p>
                <span className="design-card__meta">
                  {isActive ? t('settingsPage.designSelectedForPreview') : themeContrast}
                </span>
              </button>
            );
          })}
        </div>
        <p className="field-note">{t('settingsPage.designApplyNote')}</p>
      </div>
    );
  };

  const renderActionbarSection = (): JSX.Element => (
    <div className="settings-detail-stack">
      {renderSectionHeader('actionbar')}
      <div className="settings-actionbar-content">
        <fieldset className="settings-actionbar-fieldset">
          <legend className="info-label">
            {t('settingsPage.sections.actionbar.fieldsetLegend')}
          </legend>
          <div className="radio-group">
            <label className="radio-label">
              <input
                type="radio"
                name="actionBarDisplayMode"
                value="icons-only"
                checked={settings.actionBarDisplayMode === 'icons-only'}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    actionBarDisplayMode: event.target.value as AppSettings['actionBarDisplayMode'],
                  })
                }
              />
              <span className="radio-label-text">{t('settings.actionBarDisplayIconsOnly')}</span>
            </label>
            <label className="radio-label">
              <input
                type="radio"
                name="actionBarDisplayMode"
                value="text-only"
                checked={settings.actionBarDisplayMode === 'text-only'}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    actionBarDisplayMode: event.target.value as AppSettings['actionBarDisplayMode'],
                  })
                }
              />
              <span className="radio-label-text">{t('settings.actionBarDisplayTextOnly')}</span>
            </label>
            <label className="radio-label">
              <input
                type="radio"
                name="actionBarDisplayMode"
                value="icons-and-text"
                checked={settings.actionBarDisplayMode === 'icons-and-text'}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    actionBarDisplayMode: event.target.value as AppSettings['actionBarDisplayMode'],
                  })
                }
              />
              <span className="radio-label-text">
                {t('settings.actionBarDisplayIconsAndText')}
              </span>
            </label>
          </div>
          <span className="field-note">{t('settings.actionBarDisplayNote')}</span>
        </fieldset>
        <label className="settings-field settings-field--wide">
          <span className="info-label">{t('settings.actionBarGlowColor')}</span>
          <div className="settings-color-row">
            <input
              type="color"
              className="settings-color-picker"
              value={settings.actionBarActiveGlowColor}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  actionBarActiveGlowColor: event.target.value,
                })
              }
            />
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              className="settings-color-value"
              placeholder="#b63131"
              value={settings.actionBarActiveGlowColor}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  actionBarActiveGlowColor: event.target.value,
                })
              }
            />
          </div>
          <span className="field-note">{t('settings.actionBarGlowColorNote')}</span>
        </label>
      </div>
    </div>
  );

  const renderActiveSection = (): JSX.Element => {
    switch (activeSection) {
      case 'assistant':
        return renderAssistantSection();
      case 'startup':
        return renderStartupSection();
      case 'api':
        return renderApiSection();
      case 'design':
        return renderDesignSection();
      case 'actionbar':
        return renderActionbarSection();
      case 'general':
      default:
        return renderGeneralSection();
    }
  };

  const resetDialogTitle =
    resetTarget?.type === 'all'
      ? t('dialogs.resetAllSettingsTitle')
      : t('dialogs.resetCategoryTitle');
  const resetDialogBody =
    resetTarget?.type === 'all'
      ? t('dialogs.resetAllSettingsBody')
      : t('dialogs.resetCategoryBody', {
          category: resetTarget ? sectionLookup[resetTarget.sectionId].label : currentSection.label,
        });
  const resetDialogConfirm =
    resetTarget?.type === 'all'
      ? t('dialogs.resetAllSettingsConfirm')
      : t('dialogs.resetCategoryConfirm');

  return (
    <>
      <section className="settings-page-header">
        <div>
          <h1>{t('settings.title')}</h1>
        </div>
        <div className="settings-page-header__actions">
          <button
            type="button"
            className="danger-button"
            disabled={isSavingSettings || isWorking}
            onClick={() => setResetTarget({ type: 'all' })}
          >
            {t('settingsPage.resetAll')}
          </button>
        </div>
      </section>

      <section className="settings-layout">
        <aside className="settings-sidebar">
          <nav className="settings-nav" aria-label={t('settingsPage.categories')}>
            {settingsSections.map((section) => (
              <button
                type="button"
                key={section.id}
                className={`settings-nav-button ${activeSection === section.id ? 'settings-nav-button--active' : ''}`}
                onClick={() => handleSectionSelect(section.id)}
              >
                <span className="settings-nav-title">{section.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="settings-detail-panel">{renderActiveSection()}</section>
      </section>

      <SettingsConfirmDialog
        open={pendingSectionSwitch !== null}
        title={t('dialogs.unsavedSectionChangesTitle')}
        body={t('dialogs.unsavedSectionChangesBody', { category: currentSection.label })}
        confirmLabel={t('dialogs.unsavedSectionChangesConfirm')}
        cancelLabel={t('dialogs.unsavedSectionChangesCancel')}
        tone="danger"
        onClose={() => setPendingSectionSwitch(null)}
        onConfirm={handleConfirmSectionSwitch}
      />

      <SettingsConfirmDialog
        open={resetTarget !== null}
        title={resetDialogTitle}
        body={resetDialogBody}
        confirmLabel={resetDialogConfirm}
        cancelLabel={t('dialogs.resetNo')}
        tone="danger"
        isBusy={isSavingSettings}
        onClose={() => setResetTarget(null)}
        onConfirm={() => {
          if (!resetTarget) {
            return;
          }

          if (resetTarget.type === 'all') {
            void onResetAll().finally(() => setResetTarget(null));
            return;
          }

          void onResetSection(resetTarget.sectionId).finally(() => setResetTarget(null));
        }}
      />
    </>
  );
}
