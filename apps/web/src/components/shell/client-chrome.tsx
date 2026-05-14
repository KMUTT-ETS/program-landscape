'use client';

import * as React from 'react';
import {
  CommandPalette,
  CommandPaletteTrigger,
  KeyboardShortcuts,
  type ScopeSelectorEntities,
} from '@kku/ui';

// Client-only pieces that the TopBar composes. Split out so server
// components can keep the app shell server-rendered.
//
// Layout inside the TopBar's center slot:
//   [ Search trigger fills the row ]
//
// The ScopeSelector was removed 2026-05-14 — scope is fully role-
// driven now (resolveHighestRole + resolveEffectiveScope on the API),
// so the dropdown wasn't influencing any module's data fetch. It only
// added confusion.
//
// The palette + keyboard-shortcuts sheet live alongside (they're
// portaled dialogs, not laid out in the header).

export function AppShellClientChrome({
  entities,
}: {
  entities: ScopeSelectorEntities;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <CommandPaletteTrigger />
        </div>
      </div>
      <CommandPalette entities={entities} />
      <KeyboardShortcuts
        shortcuts={[
          { keys: ['⌘', 'K'], description: 'Open command palette', group: 'Navigation' },
          { keys: ['?'], description: 'Show this sheet', group: 'Navigation' },
          { keys: ['Esc'], description: 'Close dialog / drawer', group: 'Navigation' },
        ]}
      />
    </>
  );
}
