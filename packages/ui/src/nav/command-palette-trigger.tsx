'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '../lib/cn';

// Visible "search bar" that opens the command palette. The palette
// itself lives in command-palette.tsx and owns its open state — this
// trigger just dispatches a custom event the palette listens for.
//
// Visually it mimics a full-width search input so users see it as a
// primary action (Linear/Vercel/Notion pattern) rather than having to
// discover the ⌘K shortcut.

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

  // Detect Mac for the correct modifier label. We render a stable
  // placeholder ("Ctrl") at first mount then swap to the detected one
  // after hydration so SSR output doesn't diverge between server/client.
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
        // 2026-04-24 — neutral on neutral. Now lives in the slim top
        // bar; uses subtle surface-1 with text-tertiary so the search
        // field recedes when not in use and pops on hover.
        'group flex h-9 w-full max-w-xl items-center gap-2.5 rounded-md bg-surface-1',
        'px-3 text-left text-[13px] text-text-tertiary ring-1 ring-inset ring-border-subtle',
        'transition-[background-color,box-shadow,color] duration-fast',
        'hover:bg-surface-2 hover:text-text-secondary hover:ring-border-default',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40',
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0 text-text-tertiary group-hover:text-text-secondary" aria-hidden />
      <span className="flex-1 truncate">{placeholder}</span>
      <kbd
        aria-hidden
        className={cn(
          'hidden shrink-0 items-center gap-0.5 rounded border border-border-subtle bg-surface-0 px-1.5 py-0.5',
          'font-mono text-[10px] font-semibold text-text-tertiary sm:inline-flex',
        )}
      >
        <span>{modKey}</span>
        <span>K</span>
      </kbd>
    </button>
  );
}
