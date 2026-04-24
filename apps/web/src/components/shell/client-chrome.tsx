'use client';

import * as React from 'react';
import {
  CommandPalette,
  CommandPaletteTrigger,
  KeyboardShortcuts,
  ScopeSelector,
  type ScopeAccess,
  type ScopeSelectorEntities,
} from '@kku/ui';

// Client-only pieces that the TopBar composes. Split out so server
// components can keep the app shell server-rendered.
//
// Layout inside the TopBar's center slot:
//   [ ScopeSelector ]  [ Search trigger fills the rest ]
//
// The palette + keyboard-shortcuts sheet live alongside (they're
// portaled dialogs, not laid out in the header).

export function AppShellClientChrome({
  entities,
  access,
}: {
  entities: ScopeSelectorEntities;
  access: ScopeAccess;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <ScopeSelector entities={entities} access={access} />
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
