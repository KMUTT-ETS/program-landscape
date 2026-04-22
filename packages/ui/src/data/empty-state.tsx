import * as React from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  illustration?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

// Calm, useful empty states — suggest the next action, don't just say
// "nothing here". Illustration is a slot so modules can bring their own
// (simple Lucide icon is a fine default).
export function EmptyState({
  title,
  description,
  illustration,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-default bg-surface-1 px-6 py-10 text-center',
        className,
      )}
    >
      {illustration && (
        <div className="text-text-tertiary" aria-hidden>
          {illustration}
        </div>
      )}
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm text-text-tertiary">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
