import * as React from 'react';
import { cookies } from 'next/headers';
import { AppShell, LeftNav, TopBar, NAV_PREFERENCE_COOKIE, navVariantFromCookie } from '@kku/ui';
import { can, type SessionUser } from '@kku/shared';
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
import { brandingForRequest } from '@/lib/branding';
import { OrgLogo } from '@/components/brand/org-logo';
import { SetupBanner } from '@/components/brand/setup-banner';

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
  const [entities, cookieStore, chrome, branding] = await Promise.all([
    fetchScopeEntities(),
    cookies(),
    // Avatar URL + rank-prefixed Thai/English name. `chrome.name` is
    // null for admin-only accounts not on the HR roster — TopBarRight
    // falls back to the bare `user.name` from SSO claims.
    // `chrome.avatarUrl` is null when no photo uploaded — initials
    // render instead.
    resolveUserChrome(user.userId).catch(() => ({ name: null, avatarUrl: null })),
    brandingForRequest(),
  ]);
  const impersonation = tryDecodeImpersonation(cookieStore.get(IMPERSONATION_COOKIE)?.value);
  // Sidebar collapse state, resolved here rather than after hydration so
  // the column renders at its real width in the first byte of HTML.
  const navVariant = navVariantFromCookie(cookieStore.get(NAV_PREFERENCE_COOKIE)?.value);

  const brand = (
    <>
      {/* Organisation logo (theme-aware pair) or the product mark until
          one is uploaded. Fixed 30x50 box so nothing escapes. */}
      <div
        className="relative flex h-[50px] w-[30px] shrink-0 items-center justify-center overflow-hidden"
        title={branding?.tagline ?? 'Program Landscape'}
      >
        <OrgLogo branding={branding} width={30} height={50} className="h-[50px] w-[30px]" />
      </div>
      {/* `kku-nav-collapsible` — the wordmark is what the icon rail
          drops; the logo tile above stays. See tokens.css. */}
      <div className="kku-nav-collapsible flex min-w-0 flex-col leading-none">
        <span className="truncate text-base font-semibold tracking-tight text-text-primary">
          Program Landscape
        </span>
        <span className="mt-1.5 truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent-default">
          {branding ? `${branding.shortNameEn} Curriculum Intelligence` : 'Curriculum Intelligence'}
        </span>
      </div>
    </>
  );

  return (
    <AppShell
      initialVariant={navVariant}
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
      {!branding && <SetupBanner canConfigure={can(user, 'settings:configure')} />}
      {children}
    </AppShell>
  );
}
