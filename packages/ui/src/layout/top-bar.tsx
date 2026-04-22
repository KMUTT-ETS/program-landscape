import * as React from 'react';
import { cn } from '../lib/cn';

// Container only. Children own their layout — scope selector, search
// trigger, user menu slot in from apps/web. The grid distributes:
//   [brand | scopeSelector          | right-cluster]

export interface TopBarProps {
  brand: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

export function TopBar({ brand, center, right, className }: TopBarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border-default bg-surface-1 px-6',
        'backdrop-blur supports-[backdrop-filter]:bg-surface-1/85',
        className,
      )}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-3">{brand}</div>
      <div className="flex min-w-0 flex-1 items-center gap-3">{center}</div>
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </header>
  );
}
