import { Trans, useTranslation } from 'react-i18next';

type HeroSectionProps = {
  hotkeyRegistered: boolean;
  speakHotkey: string;
  translateHotkey: string;
  isBusy: boolean;
  isSavingSettings: boolean;
  assistantActive: boolean;
  voiceAgentState: string;
  onReadSelectedText: () => void;
  onTranslateSelectedText: () => void;
  onActivateAssistant: () => void;
  onDeactivateAssistant: () => void;
  onOpenSettings?: () => void;
};

export function HeroSection(props: HeroSectionProps): JSX.Element {
  const { t } = useTranslation();
  const {
    hotkeyRegistered,
    speakHotkey,
    translateHotkey,
    isBusy,
    isSavingSettings,
    assistantActive,
    voiceAgentState,
    onReadSelectedText,
    onTranslateSelectedText,
    onActivateAssistant,
    onDeactivateAssistant,
    onOpenSettings,
  } = props;

  return (
    <section className="hero-card">
      <div className="hero-toolbar">
        <div className="status-row">
          <span className="status-dot" aria-hidden="true" />
          <span className="status-text">
            {hotkeyRegistered ? t('hero.statusActive') : t('hero.statusChecking')}
          </span>
        </div>
        {onOpenSettings ? (
          <button type="button" className="toolbar-button" onClick={onOpenSettings}>
            <span className="toolbar-button__icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.82-.34 1.7 1.7 0 0 0-1 1.52V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.52 1.7 1.7 0 0 0-1.82.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.82 1.7 1.7 0 0 0-1.52-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.52-1 1.7 1.7 0 0 0-.34-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.82.34h.01a1.7 1.7 0 0 0 .99-1.52V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 .99 1.52h.01a1.7 1.7 0 0 0 1.82-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.82v.01a1.7 1.7 0 0 0 1.52.99H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.52.99z" />
              </svg>
            </span>
            <span className="toolbar-button__label">{t('settings.title')}</span>
          </button>
        ) : null}
      </div>
      <h1>{t('hero.title')}</h1>
      <p className="hero-copy">
        <Trans
          i18nKey="hero.copy"
          values={{ speakHotkey, translateHotkey }}
          components={{ speak: <strong />, translate: <strong /> }}
        />
      </p>
      <div className="actions">
        <button
          type="button"
          className="primary-button"
          disabled={isBusy || isSavingSettings}
          onClick={onReadSelectedText}
        >
          {isBusy ? t('hero.actions.working') : t('hero.actions.localSpeechTest')}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={isBusy || isSavingSettings}
          onClick={onTranslateSelectedText}
        >
          {t('hero.actions.localTranslationTest')}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={isSavingSettings || assistantActive || voiceAgentState === 'connecting'}
          onClick={onActivateAssistant}
        >
          {t('hero.actions.activateAssistant')}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={isSavingSettings || !assistantActive}
          onClick={onDeactivateAssistant}
        >
          {t('hero.actions.deactivateAssistant')}
        </button>
      </div>
    </section>
  );
}
