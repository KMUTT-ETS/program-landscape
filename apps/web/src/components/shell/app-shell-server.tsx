import * as React from 'react';
import { AppShell, LeftNav, TopBar } from '@kku/ui';
import type { SessionUser } from '@kku/shared';
import { appNavSectionsFor } from '@/lib/app-nav';
import { fetchScopeEntities } from '@/lib/app-entities';
import { apiFetch } from '@/lib/api-client';
import type { MeResponse } from '@kku/shared';
import { AppShellClientChrome } from './client-chrome';
import { TopBarRight } from './top-bar-right';
import { NavUserFooter } from './nav-user-footer';
import { TopBarBreadcrumb } from './top-bar-breadcrumb';

// Server component. 2026-04-24 redesign — the sidebar is now the
// brand-home: KKU monogram + wordmark at the top, module tiles in the
// middle, user chip at the bottom. The top bar is a slim 56px strip
// holding breadcrumb + scope + search + utility cluster.

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
      {/* KKU monogram — coral block on the near-black nav. 2026-05-02:
          tile is now circular to match the pill aesthetic and gains the
          accent glow shadow. */}
      <div
        aria-hidden
        className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-default text-[16px] font-bold text-accent-fg shadow-glow-accent"
        title="KKU Curriculum Intelligence Platform · Program Landscape"
      >
        K
      </div>
      <div className="flex min-w-0 flex-col leading-none">
        <span className="truncate text-[15px] font-semibold tracking-tight text-nav-fg">
          Program Landscape
        </span>
        <span className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.14em] text-nav-fg-muted">
          KKU Curriculum Intelligence
        </span>
      </div>
    </>
  );

  return (
    <AppShell
      topBar={
        <TopBar
          breadcrumb={<TopBarBreadcrumb />}
          center={<AppShellClientChrome entities={entities} access={access} />}
          right={<TopBarRight user={user} />}
        />
      }
      leftNav={
        <LeftNav
          sections={appNavSectionsFor(user)}
          brand={brand}
          footer={<NavUserFooter user={user} />}
        />
      }
    >
      {children}
    </AppShell>
  );
}
