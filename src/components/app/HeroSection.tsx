import { useTranslation } from 'react-i18next';

export function HeroSection(): JSX.Element {
  const { t } = useTranslation();

  return (
    <section className="hero-card">
      <h1>{t('hero.title')}</h1>
    </section>
  );
}
