import * as React from 'react';
import { cookies } from 'next/headers';
import { AppShell, LeftNav, TopBar } from '@kku/ui';
import type { SessionUser } from '@kku/shared';
import { appNavSectionsFor } from '@/lib/app-nav';
import { fetchScopeEntities } from '@/lib/app-entities';
import { UsageRecorder } from '@/components/usage-recorder';
import { AppShellClientChrome } from './client-chrome';
import { TopBarRight } from './top-bar-right';
import { NavCredits } from './nav-user-footer';
import { TopBarBreadcrumb } from './top-bar-breadcrumb';
import { ImpersonationBanner } from './impersonation-banner';
import { IMPERSONATION_COOKIE, tryDecodeImpersonation } from '@/lib/auth/impersonation';
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
  const [entities, cookieStore, chrome] = await Promise.all([
    fetchScopeEntities(),
    cookies(),
    // Avatar URL + rank-prefixed Thai/English name. `chrome.name` is
    // null for admin-only accounts not on the HR roster — TopBarRight
    // falls back to the bare `user.name` from SSO claims.
    // `chrome.avatarUrl` is null when no photo uploaded — initials
    // render instead.
    resolveUserChrome(user.userId).catch(() => ({ name: null, avatarUrl: null })),
  ]);
  const impersonation = tryDecodeImpersonation(cookieStore.get(IMPERSONATION_COOKIE)?.value);

  const brand = (
    <>
      {/* KKU logo — theme-aware. Both variants are rendered; CSS
          shows the right one based on `data-theme="dark"` on <html>.
          Source: /home/denpong/KKULogo (Cabinet-mandated official
          logo set). Hard-locked to fit the 50×30 placeholder:
          explicit h/w on both placeholder AND image, plus
          object-contain + overflow-hidden so nothing escapes. */}
      <div
        className="relative flex h-[50px] w-[30px] shrink-0 items-center justify-center overflow-hidden"
        title="KKU Curriculum Intelligence Platform · Program Landscape"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/kku-logo-light.png"
          alt="KKU"
          width={30}
          height={50}
          className="block h-[50px] w-[30px] object-contain dark:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/kku-logo-dark.png"
          alt="KKU"
          width={30}
          height={50}
          className="hidden h-[50px] w-[30px] object-contain dark:block"
        />
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
          center={<AppShellClientChrome entities={entities} />}
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
      leftNav={<LeftNav sections={appNavSectionsFor(user)} brand={brand} footer={<NavCredits />} />}
    >
      <React.Suspense fallback={null}>
        <UsageRecorder />
      </React.Suspense>
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
