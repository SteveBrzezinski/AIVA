import type { AppSettings } from '../voiceOverlay';

export type SettingsSectionId =
  | 'general'
  | 'assistant'
  | 'startup'
  | 'api'
  | 'design'
  | 'actionbar';

const SETTINGS_SECTION_FIELDS: Record<SettingsSectionId, Array<keyof AppSettings>> = {
  general: [
    'translationTargetLanguage',
    'playbackSpeed',
    'uiLanguage',
    'timerNotificationMode',
    'timerSignalTone',
  ],
  assistant: [
    'assistantName',
    'voiceAgentModel',
    'voiceAgentVoice',
    'voiceAgentGender',
    'sttLanguage',
    'assistantWakeThreshold',
    'assistantCueCooldownMs',
    'assistantWakeSamples',
    'assistantNameSamples',
    'assistantSampleLanguage',
  ],
  startup: ['launchAtLogin', 'startHiddenOnLaunch'],
  api: ['aiProviderMode', 'openaiApiKey', 'hostedWorkspaceSlug'],
  design: ['designThemeId'],
  actionbar: ['actionBarDisplayMode', 'actionBarActiveGlowColor'],
};

export const SETTINGS_SECTION_ORDER: SettingsSectionId[] = [
  'general',
  'assistant',
  'startup',
  'api',
  'design',
  'actionbar',
];

export function mergeSettingsSection(
  target: AppSettings,
  source: AppSettings,
  sectionId: SettingsSectionId,
): AppSettings {
  const next = { ...target } as AppSettings;

  for (const field of SETTINGS_SECTION_FIELDS[sectionId]) {
    Object.assign(next, { [field]: source[field] });
  }

  return next;
}

export function areSettingsSectionsEqual(
  left: AppSettings,
  right: AppSettings,
  sectionId: SettingsSectionId,
): boolean {
  return SETTINGS_SECTION_FIELDS[sectionId].every(
    (field) => JSON.stringify(left[field]) === JSON.stringify(right[field]),
  );
}
