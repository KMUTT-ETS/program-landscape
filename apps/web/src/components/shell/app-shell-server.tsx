import * as React from 'react';
import { AppShell, LeftNav, TopBar } from '@kku/ui';
import type { SessionUser } from '@kku/shared';
import { appNavSections } from '@/lib/app-nav';
import { fetchScopeEntities } from '@/lib/app-entities';
import { apiFetch } from '@/lib/api-client';
import type { MeResponse } from '@kku/shared';
import { AppShellClientChrome } from './client-chrome';
import { TopBarRight } from './top-bar-right';

// Server component. Composes server-fetched data with the client-only
// chrome pieces (scope selector + command palette + user menu). Modules
// render `children` inside the shell's main area.

export async function AuthedAppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const [entities, me] = await Promise.all([
    fetchScopeEntities(),
    apiFetch<MeResponse>('/me').catch(() => null),
  ]);
  const access = me
    ? me.scopeAccess
    : {
        universityRead: true,
        allFacultiesRead: true,
        ownFacultyId: null,
        ownDepartmentId: null,
      };

  const brand = (
    <>
      <div aria-hidden className="h-6 w-6 rounded-md bg-accent" title="KKU Cardinal" />
      <span className="text-sm font-semibold tracking-tight text-text-primary">
        Curriculum Landscape
      </span>
    </>
  );

  return (
    <AppShell
      topBar={
        <TopBar
          brand={brand}
          center={<AppShellClientChrome entities={entities} access={access} />}
          right={<TopBarRight user={user} />}
        />
      }
      leftNav={<LeftNav sections={appNavSections} />}
    >
      {children}
    </AppShell>
  );
}
