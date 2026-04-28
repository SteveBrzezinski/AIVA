import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { AppPageHeader, AppSurfaceCard } from '@/components/ui/app-surface';
import { cn } from '@/lib/utils';
import { SettingsConfirmDialog } from './components/app/SettingsConfirmDialog';
import {
  DESIGN_THEME_OPTIONS,
  DEFAULT_DESIGN_THEME_ID,
  getDesignThemeOption,
  normalizeDesignThemeId,
} from './designThemes';
import {
  ASSISTANT_CUE_COOLDOWN_MS_MAX,
  ASSISTANT_MATCH_THRESHOLD_MAX,
  ASSISTANT_MATCH_THRESHOLD_MIN,
} from './lib/liveStt';
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
};

type SelectOption = {
  value: string;
  label: ReactNode;
};

const FIELD_GRID_CLASS = 'grid gap-6 md:grid-cols-2';
const CONTROL_CLASS =
  'h-11 w-full border-[color:var(--input-border)] bg-[var(--input-bg)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] shadow-sm focus-visible:border-[color:var(--input-border-focus)] focus-visible:ring-[rgba(240,101,37,0.12)] hover:border-[color:var(--button-secondary-border-hover)]';
const SELECT_TRIGGER_CLASS =
  'h-11 w-full border-[color:var(--input-border)] bg-[var(--input-bg)] text-[var(--text-primary)] data-placeholder:text-[var(--text-muted)] shadow-sm focus-visible:border-[color:var(--input-border-focus)] focus-visible:ring-[rgba(240,101,37,0.12)] hover:border-[color:var(--button-secondary-border-hover)]';
const SECTION_NAV_BUTTON_CLASS =
  'settings-nav-button flex min-h-11 items-center rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors';
const RESET_WORKSPACE_CURRENT = '__current_workspace__';

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

function SettingSelect({
  value,
  onValueChange,
  options,
  placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}): JSX.Element {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={SELECT_TRIGGER_CLASS}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="border-[color:var(--panel-border)] bg-[var(--panel-bg-deep)] text-[var(--text-primary)]">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
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
      { id: 'general', label: t('settingsPage.sections.general.label') },
      { id: 'assistant', label: t('settingsPage.sections.assistant.label') },
      { id: 'startup', label: t('settingsPage.sections.startup.label') },
      { id: 'api', label: t('settingsPage.sections.authorization.label') },
      { id: 'design', label: t('settingsPage.sections.design.label') },
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

  const updateSettings = (patch: Partial<AppSettings>): void => {
    setSettings((current) => ({ ...current, ...patch }));
  };

  const renderGeneralSection = (): JSX.Element => (
    <div className={FIELD_GRID_CLASS}>
      <FormField label={t('settings.translationTargetLanguage')}>
        <SettingSelect
          value={settings.translationTargetLanguage}
          onValueChange={(value) => updateSettings({ translationTargetLanguage: value })}
          options={languageOptions.map((option) => ({
            value: option.code,
            label: option.label,
          }))}
        />
      </FormField>

      <FormField
        label={t('settings.speechPlaybackSpeed')}
        hint={t('settings.speechPlaybackSpeedNote')}
        className="md:col-span-2"
      >
        <div className="flex items-center gap-4 rounded-xl border border-[color:var(--panel-border)] bg-[var(--panel-bg-deep)] px-4 py-4">
          <Slider
            value={[settings.playbackSpeed]}
            min={0.5}
            max={2}
            step={0.1}
            onValueChange={([value]) =>
              updateSettings({ playbackSpeed: value ?? settings.playbackSpeed })
            }
            className="w-full"
          />
          <span className="min-w-12 text-right text-sm font-medium text-[var(--text-primary)]">
            {settings.playbackSpeed.toFixed(1)}x
          </span>
        </div>
      </FormField>

      <FormField label={t('settings.uiLanguage')} hint={t('settings.uiLanguageNote')}>
        <SettingSelect
          value={settings.uiLanguage}
          onValueChange={(value) => updateSettings({ uiLanguage: value })}
          options={[
            { value: 'en', label: t('settings.uiLanguageOptionEn') },
            { value: 'de', label: t('settings.uiLanguageOptionDe') },
          ]}
        />
      </FormField>

      <FormField
        label={t('settings.timerNotificationMode')}
        hint={t('settings.timerNotificationModeNote')}
      >
        <SettingSelect
          value={settings.timerNotificationMode}
          onValueChange={(value) =>
            updateSettings({
              timerNotificationMode: value as AppSettings['timerNotificationMode'],
            })
          }
          options={[
            { value: 'signal', label: t('settings.timerNotificationModeSignal') },
            { value: 'voice', label: t('settings.timerNotificationModeVoice') },
          ]}
        />
      </FormField>

      <FormField label={t('settings.timerSignalTone')} hint={t('settings.timerSignalToneNote')}>
        <SettingSelect
          value={settings.timerSignalTone}
          onValueChange={(value) =>
            updateSettings({ timerSignalTone: value as AppSettings['timerSignalTone'] })
          }
          options={[
            { value: 'soft-bell', label: t('settings.timerSignalToneOptionSoftBell') },
            { value: 'digital-pulse', label: t('settings.timerSignalToneOptionDigitalPulse') },
            { value: 'glass-rise', label: t('settings.timerSignalToneOptionGlassRise') },
          ]}
        />
      </FormField>

      <FormField
        label={t('settings.dictationStatusNotifications')}
        hint={t('settings.dictationStatusNotificationsNote')}
      >
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[color:var(--panel-border)] bg-[var(--panel-bg-deep)] px-4 py-3 text-sm text-[var(--text-primary)]">
          <Checkbox
            checked={settings.dictationStatusNotifications}
            onCheckedChange={(checked) =>
              updateSettings({ dictationStatusNotifications: checked === true })
            }
          />
          <span>{t('settings.dictationStatusNotificationsToggle')}</span>
        </label>
      </FormField>
    </div>
  );

  const renderAssistantSection = (): JSX.Element => (
    <div className={FIELD_GRID_CLASS}>
      <FormField
        label={t('settings.assistantName')}
        error={assistantNameError}
        warning={
          !assistantNameError && assistantCalibrationRequired && !assistantCalibrationComplete
            ? t('settings.assistantCalibrationWarning')
            : undefined
        }
        success={
          !assistantNameError &&
          assistantCalibrationComplete &&
          assistantTrainingReadyName === settings.assistantName
            ? t('settings.assistantCalibrationReady')
            : undefined
        }
        hint={
          <Trans
            i18nKey="settings.assistantNameNote"
            values={{ assistantName: settings.assistantName || 'Ava' }}
            components={{ wake: <code /> }}
          />
        }
        className="md:col-span-2"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="text"
            placeholder="Ava"
            value={settings.assistantName}
            className={cn(CONTROL_CLASS, 'sm:flex-1')}
            onChange={(event) => {
              const nextName = event.target.value;
              updateSettings({
                assistantName: nextName,
                assistantWakeSamples: [],
                assistantNameSamples: [],
                assistantSampleLanguage: normalizeLanguageCode(settings.sttLanguage),
              });
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 border-[color:var(--button-primary-border)] bg-[var(--button-primary-bg)] !text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)] hover:bg-[var(--button-primary-bg-hover)]"
            disabled={Boolean(assistantNameError) || isSavingSettings}
            onClick={() => void onOpenTraining()}
          >
            {t('settings.trainWakePhrase')}
          </Button>
        </div>
      </FormField>

      <FormField
        label={t('settings.voiceAssistantModel')}
        hint={t('settings.voiceAssistantModelNote')}
      >
        <SettingSelect
          value={settings.voiceAgentModel}
          onValueChange={(value) =>
            updateSettings({
              voiceAgentModel: value,
              voiceAgentVoice: sanitizeVoiceAgentVoiceForModel(settings.voiceAgentVoice, value),
            })
          }
          options={VOICE_AGENT_MODEL_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
        />
      </FormField>

      <FormField
        label={t('settings.voiceAssistantVoice')}
        hint={t('settings.voiceAssistantVoiceNote')}
      >
        <SettingSelect
          value={sanitizeVoiceAgentVoiceForModel(settings.voiceAgentVoice, settings.voiceAgentModel)}
          onValueChange={(value) => updateSettings({ voiceAgentVoice: value })}
          options={availableVoiceOptions.map((voice) => ({
            value: voice,
            label: formatRealtimeVoiceLabel(voice),
          }))}
        />
      </FormField>

      <FormField
        label={t('settings.voiceAssistantGender')}
        hint={t('settings.voiceAssistantGenderNote')}
      >
        <SettingSelect
          value={settings.voiceAgentGender}
          onValueChange={(value) =>
            updateSettings({
              voiceAgentGender: value as AppSettings['voiceAgentGender'],
            })
          }
          options={VOICE_AGENT_GENDER_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
        />
      </FormField>

      <FormField
        label={t('settings.activeTranscriptionLanguage')}
        hint={
          <Trans
            i18nKey="settings.activeTranscriptionLanguageNote"
            components={{ code: <code /> }}
          />
        }
      >
        <Input
          type="text"
          placeholder="de"
          value={settings.sttLanguage}
          className={CONTROL_CLASS}
          onChange={(event) =>
            updateSettings({
              sttLanguage: event.target.value,
              assistantWakeSamples: [],
              assistantNameSamples: [],
              assistantSampleLanguage: normalizeLanguageCode(event.target.value),
            })
          }
        />
      </FormField>

      <FormField
        label={t('settings.wakeMatchThreshold')}
        hint={t('settings.wakeMatchThresholdNote')}
      >
        <div className="flex items-center gap-4 rounded-xl border border-[color:var(--panel-border)] bg-[var(--panel-bg-deep)] px-4 py-4">
          <Slider
            value={[settings.assistantWakeThreshold]}
            min={ASSISTANT_MATCH_THRESHOLD_MIN}
            max={ASSISTANT_MATCH_THRESHOLD_MAX}
            step={1}
            onValueChange={([value]) =>
              updateSettings({
                assistantWakeThreshold: parseBoundedInteger(
                  String(value ?? settings.assistantWakeThreshold),
                  settings.assistantWakeThreshold,
                  ASSISTANT_MATCH_THRESHOLD_MIN,
                  ASSISTANT_MATCH_THRESHOLD_MAX,
                ),
              })
            }
            className="w-full"
          />
          <span className="min-w-10 text-right text-sm font-medium text-[var(--text-primary)]">
            {settings.assistantWakeThreshold}
          </span>
        </div>
      </FormField>

      <FormField label={t('settings.cueCooldown')} hint={t('settings.cueCooldownNote')}>
        <Input
          type="number"
          min="0"
          max={ASSISTANT_CUE_COOLDOWN_MS_MAX}
          step="100"
          value={settings.assistantCueCooldownMs}
          className={CONTROL_CLASS}
          onChange={(event) =>
            updateSettings({
              assistantCueCooldownMs: parseBoundedInteger(
                event.target.value,
                settings.assistantCueCooldownMs,
                0,
                ASSISTANT_CUE_COOLDOWN_MS_MAX,
              ),
            })
          }
        />
      </FormField>
    </div>
  );

  const renderStartupSection = (): JSX.Element => (
    <div className={FIELD_GRID_CLASS}>
      <FormField
        label={t('settings.backgroundStartup')}
        hint={t('settings.backgroundStartupNote')}
        className="md:col-span-2"
      >
        <div className="space-y-3 rounded-xl border border-[color:var(--panel-border)] bg-[var(--panel-bg-deep)] p-4">
          <label className="flex items-center gap-3 text-sm text-[var(--text-primary)]">
            <Checkbox
              checked={settings.launchAtLogin}
              onCheckedChange={(checked) =>
                updateSettings({ launchAtLogin: checked === true })
              }
            />
            <span>{t('settings.launchAtLogin')}</span>
          </label>
          <label className="flex items-center gap-3 text-sm text-[var(--text-primary)]">
            <Checkbox
              checked={settings.startHiddenOnLaunch}
              disabled={!settings.launchAtLogin}
              onCheckedChange={(checked) =>
                updateSettings({ startHiddenOnLaunch: checked === true })
              }
            />
            <span>{t('settings.startHiddenOnLaunch')}</span>
          </label>
        </div>
      </FormField>
    </div>
  );

  const renderApiSection = (): JSX.Element => (
    <div className={FIELD_GRID_CLASS}>
      <FormField
        label={t('settings.aiProviderMode')}
        hint={!hostedSignedIn ? t('settings.hostedLoginPageNote') : t('settings.aiProviderModeNote')}
        warning={
          isHostedMode && hostedSignedIn ? t('settings.hostedModeScopeNote') : undefined
        }
        className="md:col-span-2"
      >
        <SettingSelect
          value={hostedSignedIn ? settings.aiProviderMode : 'byo'}
          onValueChange={(value) =>
            updateSettings({ aiProviderMode: value as AppSettings['aiProviderMode'] })
          }
          options={[
            { value: 'byo', label: t('settings.aiProviderModeByo') },
            ...(hostedSignedIn
              ? [{ value: 'hosted', label: t('settings.aiProviderModeHosted') }]
              : []),
          ]}
        />
      </FormField>

      {isHostedMode && hostedSignedIn ? (
        <>
          <FormField label={t('settings.hostedAccount')} className="md:col-span-2">
            <div className="space-y-3 rounded-xl border border-[color:var(--panel-border)] bg-[var(--panel-bg-deep)] p-4">
              <div className="space-y-1 text-sm text-[var(--text-secondary)]">
                <strong className="block text-[var(--text-primary)]">
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
                <p>
                  {hostedRealtimeEnabled
                    ? t('settings.hostedRealtimeReady')
                    : t('settings.hostedRealtimeUnavailable')}
                </p>
              </div>
            </div>
          </FormField>

          <FormField label={t('settings.hostedWorkspace')} hint={t('settings.hostedWorkspaceNote')}>
            {hostedAccount?.teams.length ? (
              <SettingSelect
                value={settings.hostedWorkspaceSlug || RESET_WORKSPACE_CURRENT}
                onValueChange={(value) =>
                  updateSettings({
                    hostedWorkspaceSlug: value === RESET_WORKSPACE_CURRENT ? '' : value,
                  })
                }
                options={[
                  {
                    value: RESET_WORKSPACE_CURRENT,
                    label: t('settings.hostedWorkspaceUseCurrent', {
                      workspace:
                        hostedAccount.currentTeam?.name ??
                        hostedAccount.currentTeam?.slug ??
                        t('settings.hostedWorkspaceCurrentDefault'),
                    }),
                  },
                  ...hostedAccount.teams.map((team) => ({
                    value: team.slug,
                    label: team.name,
                  })),
                ]}
              />
            ) : (
              <Input
                type="text"
                autoComplete="off"
                placeholder="my-workspace"
                value={settings.hostedWorkspaceSlug}
                className={CONTROL_CLASS}
                onChange={(event) =>
                  updateSettings({ hostedWorkspaceSlug: event.target.value })
                }
              />
            )}
          </FormField>
        </>
      ) : (
        <FormField
          label={t('settings.openaiApiKey')}
          hint={
            <Trans
              i18nKey="settings.openaiApiKeyNote"
              components={{ env: <code />, envFile: <code /> }}
            />
          }
          className="md:col-span-2"
        >
          <Input
            type="password"
            autoComplete="off"
            placeholder="sk-..."
            value={settings.openaiApiKey}
            className={CONTROL_CLASS}
            onChange={(event) => updateSettings({ openaiApiKey: event.target.value })}
          />
        </FormField>
      )}
    </div>
  );

  const renderActionbarControls = (): JSX.Element => (
    <div className={FIELD_GRID_CLASS}>
      <FormField
        label={t('settingsPage.sections.actionbar.fieldsetLegend')}
        hint={t('settings.actionBarDisplayNote')}
        className="md:col-span-2"
      >
        <RadioGroup
          value={settings.actionBarDisplayMode}
          onValueChange={(value) =>
            updateSettings({
              actionBarDisplayMode: value as AppSettings['actionBarDisplayMode'],
            })
          }
          className="gap-3"
        >
          {[
            { value: 'icons-only', label: t('settings.actionBarDisplayIconsOnly') },
            { value: 'text-only', label: t('settings.actionBarDisplayTextOnly') },
            { value: 'icons-and-text', label: t('settings.actionBarDisplayIconsAndText') },
          ].map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-3 rounded-xl border border-[color:var(--panel-border)] bg-[var(--panel-bg-deep)] px-4 py-3 text-sm text-[var(--text-primary)]"
            >
              <RadioGroupItem value={option.value} />
              <span>{option.label}</span>
            </label>
          ))}
        </RadioGroup>
      </FormField>

      <FormField
        label={t('settings.actionBarGlowColor')}
        hint={t('settings.actionBarGlowColorNote')}
        className="md:col-span-2"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="color"
            value={settings.actionBarActiveGlowColor}
            className="h-11 w-full min-w-[5rem] border-[color:var(--input-border)] bg-[var(--input-bg)] p-1 sm:w-24"
            onChange={(event) =>
              updateSettings({ actionBarActiveGlowColor: event.target.value })
            }
          />
          <Input
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            className={cn(CONTROL_CLASS, 'sm:flex-1')}
            placeholder="#f06525"
            value={settings.actionBarActiveGlowColor}
            onChange={(event) =>
              updateSettings({ actionBarActiveGlowColor: event.target.value })
            }
          />
        </div>
      </FormField>
    </div>
  );

  const renderDesignSection = (): JSX.Element => {
    const selectedThemeId = normalizeDesignThemeId(settings.designThemeId);
    const selectedTheme = getDesignThemeOption(selectedThemeId);
    const formatThemeLabel = (theme: (typeof DESIGN_THEME_OPTIONS)[number]): string =>
      theme.id === DEFAULT_DESIGN_THEME_ID
        ? `${theme.label} (${t('settingsPage.designThemeDefaultSuffix')})`
        : theme.label;

    return (
      <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
        <section className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
              {t('settingsPage.designSections.themes')}
            </h3>
            <p className="text-sm leading-6 text-[var(--text-secondary)]">
              {t('settingsPage.designApplyNote')}
            </p>
          </div>
          <FormField label={t('settingsPage.designThemeSelectLabel')} className="max-w-sm">
            <SettingSelect
              value={selectedThemeId}
              onValueChange={(value) =>
                updateSettings({ designThemeId: normalizeDesignThemeId(value) })
              }
              options={DESIGN_THEME_OPTIONS.map((theme) => ({
                value: theme.id,
                label: formatThemeLabel(theme),
              }))}
            />
          </FormField>
          <div
            className="space-y-4 rounded-2xl border border-[color:var(--panel-border)] bg-[var(--panel-bg-deep)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
          >
            <div className="space-y-2">
              <strong className="block text-base text-[var(--text-primary)]">
                {formatThemeLabel(selectedTheme)}
              </strong>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">
                {t(`settingsPage.themeCards.${selectedTheme.id}.description`, {
                  defaultValue: selectedTheme.description,
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-[color:var(--panel-border)] bg-[var(--button-secondary-bg)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                {t(`settingsPage.themeCards.${selectedTheme.id}.accent`, {
                  defaultValue: selectedTheme.accent,
                })}
              </span>
              <span className="rounded-full border border-[color:var(--panel-border)] bg-[var(--button-secondary-bg)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                {t(`settingsPage.themeCards.${selectedTheme.id}.contrast`, {
                  defaultValue: selectedTheme.contrast,
                })}
              </span>
              <span className="rounded-full border border-[color:var(--panel-border)] bg-[var(--button-secondary-bg)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                {selectedTheme.id}
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
              {t('settingsPage.designSections.actionbar')}
            </h3>
          </div>
          {renderActionbarControls()}
        </section>
      </div>
    );
  };

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
      <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
        <AppPageHeader
          title={t('settings.title')}
          action={
            <Button
              type="button"
              variant="destructive"
              className="h-11 border-[color:var(--danger-border)] bg-[var(--danger-bg)] text-[color:#8f2d3a] hover:bg-[rgba(186,49,64,0.18)]"
              disabled={isSavingSettings || isWorking}
              onClick={() => setResetTarget({ type: 'all' })}
            >
              {t('settingsPage.resetAll')}
            </Button>
          }
        />

        <div className="grid min-h-0 flex-1 gap-6 overflow-hidden xl:gap-8 lg:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[290px_minmax(0,1fr)]">
          <aside className="min-h-0 lg:pt-2">
            <nav
              className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-hidden"
              aria-label={t('settingsPage.categories')}
            >
              {settingsSections.map((section) => (
                <button
                  type="button"
                  key={section.id}
                  className={cn(
                    SECTION_NAV_BUTTON_CLASS,
                    activeSection === section.id ? 'settings-nav-button--active' : '',
                  )}
                  onClick={() => handleSectionSelect(section.id)}
                >
                  {section.label}
                </button>
              ))}
            </nav>
          </aside>

          <AppSurfaceCard
            className="flex h-full min-h-0 flex-col overflow-hidden"
            style={{ boxShadow: 'none' }}
          >
            <div
              className="sticky top-0 z-10 flex flex-col gap-4 border-b border-[color:var(--panel-border)]/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between 2xl:px-7 2xl:py-5"
              style={{ background: 'var(--panel-bg)' }}
            >
              <h2 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
                {currentSection.label}
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saveDisabled}
                  className="h-11 border-[color:var(--button-primary-border)] bg-[var(--button-primary-bg)] !text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)] hover:bg-[var(--button-primary-bg-hover)]"
                  onClick={() => void onSaveSection(activeSection)}
                >
                  {isSavingSettings ? t('settings.saving') : t('settings.save')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={resetDisabled}
                  className="h-11 border-[color:var(--danger-border)] bg-[var(--danger-bg)] text-[color:#8f2d3a] hover:bg-[rgba(186,49,64,0.18)]"
                  onClick={() => setResetTarget({ type: 'section', sectionId: activeSection })}
                >
                  {t('settings.reset')}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 2xl:px-7 2xl:py-6">
              {renderActiveSection()}
            </div>
          </AppSurfaceCard>
        </div>
      </div>

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
