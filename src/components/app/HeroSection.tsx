import { useTranslation } from 'react-i18next';

import { AppPageHeader } from '@/components/ui/app-surface';

export function HeroSection(): JSX.Element {
  const { t } = useTranslation();

  return <AppPageHeader title={t('hero.title')} />;
}
