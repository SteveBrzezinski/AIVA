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
import { DESIGN_THEME_OPTIONS, normalizeDesignThemeId } from './designThemes';
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
  'h-11 w-full border-white/15 bg-black/20 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:border-white/25 focus-visible:ring-white/10';
const SELECT_TRIGGER_CLASS =
  'h-11 w-full border-white/15 bg-black/20 text-[var(--text-primary)] data-placeholder:text-[var(--text-muted)] focus-visible:border-white/25 focus-visible:ring-white/10';
const SECTION_NAV_BUTTON_CLASS =
  'flex min-h-11 items-center rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors';
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
      <SelectContent className="border-white/10 bg-[var(--panel-bg-deep)] text-[var(--text-primary)]">
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
      { id: 'api', label: t('settingsPage.sections.api.label') },
      { id: 'design', label: t('settingsPage.sections.design.label') },
      { id: 'actionbar', label: t('settingsPage.sections.actionbar.label') },
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
        <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-4">
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
            className="h-11 border-white/15 bg-white/8 text-[var(--text-primary)] hover:bg-white/12"
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
        <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-4">
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
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
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
            <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
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

  const renderDesignSection = (): JSX.Element => {
    const selectedThemeId = normalizeDesignThemeId(settings.designThemeId);

    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                className={cn(
                  'flex h-full flex-col gap-4 rounded-2xl border p-4 text-left transition-all',
                  isActive
                    ? 'border-white/30 bg-white/10 shadow-[0_0_24px_rgba(255,255,255,0.08)]'
                    : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8',
                )}
                onClick={() => updateSettings({ designThemeId: theme.id })}
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
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    {themeAccent}
                  </p>
                  <strong className="block text-base text-[var(--text-primary)]">
                    {theme.label}
                  </strong>
                  <p className="text-sm leading-6 text-[var(--text-secondary)]">
                    {themeDescription}
                  </p>
                </div>
                <span className="mt-auto text-xs text-[var(--text-muted)]">
                  {isActive ? t('settingsPage.designSelectedForPreview') : themeContrast}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs leading-5 text-[var(--text-muted)]">
          {t('settingsPage.designApplyNote')}
        </p>
      </div>
    );
  };

  const renderActionbarSection = (): JSX.Element => (
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
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[var(--text-primary)]"
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
            className="h-11 w-full min-w-[5rem] border-white/15 bg-black/20 p-1 sm:w-24"
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
            placeholder="#b63131"
            value={settings.actionBarActiveGlowColor}
            onChange={(event) =>
              updateSettings({ actionBarActiveGlowColor: event.target.value })
            }
          />
        </div>
      </FormField>
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
      <div className="space-y-6">
        <AppPageHeader
          title={t('settings.title')}
          action={
            <Button
              type="button"
              variant="destructive"
              className="h-11 border-rose-200/15 bg-rose-500/12 text-rose-100 hover:bg-rose-500/18"
              disabled={isSavingSettings || isWorking}
              onClick={() => setResetTarget({ type: 'all' })}
            >
              {t('settingsPage.resetAll')}
            </Button>
          }
        />

        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="lg:pt-2">
            <nav
              className="flex gap-2 overflow-x-auto pb-1 lg:flex-col"
              aria-label={t('settingsPage.categories')}
            >
              {settingsSections.map((section) => (
                <button
                  type="button"
                  key={section.id}
                  className={cn(
                    SECTION_NAV_BUTTON_CLASS,
                    activeSection === section.id
                      ? 'border-white/20 bg-white/10 text-[var(--text-primary)]'
                      : 'border-transparent bg-transparent text-[var(--text-secondary)] hover:border-white/10 hover:bg-white/5 hover:text-[var(--text-primary)]',
                  )}
                  onClick={() => handleSectionSelect(section.id)}
                >
                  {section.label}
                </button>
              ))}
            </nav>
          </aside>

          <AppSurfaceCard className="min-h-[38rem] overflow-hidden">
            <div
              className="sticky top-0 z-10 flex flex-col gap-4 border-b border-[color:var(--panel-border)]/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
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
                  className="h-11 border-white/15 bg-white/10 text-[var(--text-primary)] hover:bg-white/15"
                  onClick={() => void onSaveSection(activeSection)}
                >
                  {isSavingSettings ? t('settings.saving') : t('settings.save')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={resetDisabled}
                  className="h-11 border-rose-200/15 bg-rose-500/10 text-rose-100 hover:bg-rose-500/18"
                  onClick={() => setResetTarget({ type: 'section', sectionId: activeSection })}
                >
                  {t('settings.reset')}
                </Button>
              </div>
            </div>

            <div className="max-h-[calc(100dvh-16rem)] overflow-y-auto px-5 py-5">
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
