import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  AppSurfaceCard,
  AppSurfaceContent,
  AppSurfaceHeader,
} from '@/components/ui/app-surface';

type DashboardSummaryCardProps = {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  badges?: ReactNode;
  children?: ReactNode;
};

export function DashboardSummaryCard({
  eyebrow,
  title,
  description,
  badges,
  children,
}: DashboardSummaryCardProps): JSX.Element {
  return (
    <AppSurfaceCard className="h-full">
      <AppSurfaceHeader
        title={title}
        description={
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
              {eyebrow}
            </p>
            <p className="text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
          </div>
        }
      />
      {(badges || children) ? (
        <AppSurfaceContent className="space-y-4">
          {badges ? <div className="flex flex-wrap gap-2">{badges}</div> : null}
          {children}
        </AppSurfaceContent>
      ) : null}
    </AppSurfaceCard>
  );
}

export function DashboardStatusBadge({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Badge
      variant="outline"
      className="border-white/15 bg-white/8 text-[var(--text-primary)]"
    >
      {children}
    </Badge>
  );
}
