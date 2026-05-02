'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '../lib/cn';

// 2026-05-02e redesign: pill-shaped search trigger with the redesign
// chrome. Glassy surface, accent ring on hover/focus, larger keyboard
// hint pill. Matches the top-bar button family.

export interface CommandPaletteTriggerProps {
  placeholder?: string;
  className?: string;
}

export function CommandPaletteTrigger({
  placeholder = 'Search programs, scenarios, decisions…',
  className,
}: CommandPaletteTriggerProps) {
  const open = React.useCallback(() => {
    document.dispatchEvent(new CustomEvent('kku:command-palette-open'));
  }, []);

  // Stable label during SSR; swap to platform-correct one after mount.
  const [modKey, setModKey] = React.useState('Ctrl');
  React.useEffect(() => {
    if (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)) {
      setModKey('⌘');
    }
  }, []);

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open command palette"
      className={cn(
        'group flex h-11 w-full max-w-xl items-center gap-3 rounded-full',
        'bg-surface-1/70 backdrop-blur-sm pl-4 pr-2 text-left text-sm text-text-tertiary',
        'ring-1 ring-inset ring-border-subtle',
        'transition-[background-color,box-shadow,color,ring-color] duration-fast',
        'hover:bg-accent-subtle hover:text-text-primary hover:ring-accent/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40',
        className,
      )}
    >
      <Search
        className="h-[18px] w-[18px] shrink-0 text-text-tertiary group-hover:text-accent-default transition-colors"
        aria-hidden
        strokeWidth={1.8}
      />
      <span className="flex-1 truncate">{placeholder}</span>
      <kbd
        aria-hidden
        className={cn(
          'hidden shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1',
          'font-mono text-[11px] font-semibold text-text-secondary',
          'ring-1 ring-inset ring-border-subtle',
          'group-hover:bg-surface-1 group-hover:text-accent-default group-hover:ring-accent/30',
          'sm:inline-flex',
        )}
      >
        <span>{modKey}</span>
        <span>K</span>
      </kbd>
    </button>
  );
}
