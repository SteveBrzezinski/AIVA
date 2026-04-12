import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

type FormFieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  success?: ReactNode;
  warning?: ReactNode;
  children: ReactNode;
  className?: string;
};

function Note({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'error' | 'warning' | 'success';
}): JSX.Element {
  return (
    <p
      className={cn(
        'text-xs leading-5',
        tone === 'default' && 'text-[var(--text-muted)]',
        tone === 'error' && 'text-rose-300',
        tone === 'warning' && 'text-amber-300',
        tone === 'success' && 'text-emerald-300',
      )}
    >
      {children}
    </p>
  );
}

export function FormField({
  label,
  hint,
  error,
  success,
  warning,
  children,
  className,
}: FormFieldProps): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <Label className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </Label>
      {children}
      {error ? <Note tone="error">{error}</Note> : null}
      {!error && warning ? <Note tone="warning">{warning}</Note> : null}
      {!error && !warning && success ? <Note tone="success">{success}</Note> : null}
      {!error && !warning && !success && hint ? <Note>{hint}</Note> : null}
    </div>
  );
}
