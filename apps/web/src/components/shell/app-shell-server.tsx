import * as React from 'react';
import { cookies } from 'next/headers';
import { AppShell, LeftNav, TopBar } from '@kku/ui';
import type { SessionUser } from '@kku/shared';
import { appNavSectionsFor } from '@/lib/app-nav';
import { fetchScopeEntities } from '@/lib/app-entities';
import { apiFetch } from '@/lib/api-client';
import type { MeResponse } from '@kku/shared';
import { AppShellClientChrome } from './client-chrome';
import { TopBarRight } from './top-bar-right';
import { NavCredits } from './nav-user-footer';
import { TopBarBreadcrumb } from './top-bar-breadcrumb';
import { ImpersonationBanner } from './impersonation-banner';
import {
  IMPERSONATION_COOKIE,
  tryDecodeImpersonation,
} from '@/lib/auth/impersonation';
import { resolveUserChrome } from '@/lib/display-name';

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
  const [entities, me, cookieStore, chrome] = await Promise.all([
    fetchScopeEntities(),
    apiFetch<MeResponse>('/me').catch(() => null),
    cookies(),
    // Avatar URL + rank-prefixed Thai/English name. `chrome.name` is
    // null for admin-only accounts not on the HR roster — TopBarRight
    // falls back to the bare `user.name` from SSO claims.
    // `chrome.avatarUrl` is null when no photo uploaded — initials
    // render instead.
    resolveUserChrome(user.userId).catch(() => ({ name: null, avatarUrl: null })),
  ]);
  const impersonation = tryDecodeImpersonation(
    cookieStore.get(IMPERSONATION_COOKIE)?.value,
  );
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
      {/* KKU monogram — bold coral with layered glow. 2026-05-02c:
          larger tile, gradient fill, multi-layer shadow so it reads
          as a hero spot, not a badge. */}
      <div
        aria-hidden
        className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-default to-accent-hover text-lg font-bold text-accent-fg shadow-[0_4px_16px_-4px_rgb(255_140_70/0.55),inset_0_1px_0_0_rgba(255,255,255,0.25)] ring-1 ring-accent-default/20"
        title="KKU Curriculum Intelligence Platform · Program Landscape"
      >
        K
      </div>
      <div className="flex min-w-0 flex-col leading-none">
        <span className="truncate text-base font-semibold tracking-tight text-text-primary">
          Program Landscape
        </span>
        <span className="mt-1.5 truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent-default">
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
          right={
            <TopBarRight
              user={user}
              displayName={chrome.name}
              avatarUrl={chrome.avatarUrl}
              impersonating={Boolean(impersonation)}
            />
          }
        />
      }
      leftNav={
        <LeftNav
          sections={appNavSectionsFor(user)}
          brand={brand}
          footer={<NavCredits />}
        />
      }
    >
      {impersonation && (
        <ImpersonationBanner
          role={impersonation.role}
          facultyId={impersonation.facultyId ?? null}
          programId={impersonation.programId ?? null}
          entities={entities}
        />
      )}
      {children}
    </AppShell>
  );
}
