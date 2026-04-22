import * as React from 'react';
import { cn } from '../lib/cn';

// Skeletons, never spinners (see CLAUDE.md → SaaS UX principles).
// Shimmer animation defined in the Tailwind preset.
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-md bg-surface-2',
        'animate-shimmer',
        className,
      )}
      {...props}
    />
  );
}
