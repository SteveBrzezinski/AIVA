import { useTranslation } from 'react-i18next';

import {
  AppSurfaceCard,
  AppSurfaceContent,
  AppSurfaceHeader,
} from '@/components/ui/app-surface';

type ReadinessItem = {
  label: string;
  value: string;
};

type ReadinessGridProps = {
  items: ReadinessItem[];
};

export function ReadinessGrid({ items }: ReadinessGridProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <section
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      aria-label={t('readiness.ariaLabel')}
    >
      {items.map((item) => (
        <AppSurfaceCard key={item.label} size="sm">
          <AppSurfaceHeader title={item.value} description={item.label} className="gap-2" />
          <AppSurfaceContent className="pt-0" />
        </AppSurfaceCard>
      ))}
    </section>
  );
}
