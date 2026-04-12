import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type AppSurfaceCardProps = React.ComponentProps<typeof Card>;

export function AppSurfaceCard({
  className,
  style,
  ...props
}: AppSurfaceCardProps): JSX.Element {
  return (
    <Card
      className={cn(
        'border border-[color:var(--panel-border)] bg-transparent text-[var(--text-primary)] shadow-none backdrop-blur-xl',
        className,
      )}
      style={{
        background: 'var(--panel-bg)',
        boxShadow: 'var(--panel-shadow)',
        ...style,
      }}
      {...props}
    />
  );
}

type AppSurfaceHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function AppSurfaceHeader({
  title,
  description,
  action,
  className,
}: AppSurfaceHeaderProps): JSX.Element {
  return (
    <CardHeader
      className={cn(
        'border-b border-[color:var(--panel-border)]/70 pb-4 text-[var(--text-primary)]',
        className,
      )}
    >
      <CardTitle className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
        {title}
      </CardTitle>
      {description ? (
        <CardDescription className="text-sm text-[var(--text-secondary)]">
          {description}
        </CardDescription>
      ) : null}
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
  );
}

export function AppSurfaceContent({
  className,
  ...props
}: React.ComponentProps<typeof CardContent>): JSX.Element {
  return <CardContent className={cn('text-[var(--text-primary)]', className)} {...props} />;
}

type AppPageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function AppPageHeader({
  title,
  description,
  action,
  className,
}: AppPageHeaderProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between',
        className,
      )}
    >
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] lg:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-3">{action}</div> : null}
    </div>
  );
}
