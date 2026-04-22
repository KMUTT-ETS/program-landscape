'use client';

import * as React from 'react';
import {
  CommandPalette,
  KeyboardShortcuts,
  ScopeSelector,
  type ScopeAccess,
  type ScopeSelectorEntities,
} from '@kku/ui';

// Client-only pieces that the TopBar composes. Split out so server
// components can keep the app shell server-rendered.

export function AppShellClientChrome({
  entities,
  access,
}: {
  entities: ScopeSelectorEntities;
  access: ScopeAccess;
}) {
  return (
    <>
      <ScopeSelector entities={entities} access={access} />
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
