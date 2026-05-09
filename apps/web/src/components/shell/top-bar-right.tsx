'use client';

import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kku/ui';
import { Bell, LogOut, Monitor, Moon, Sun, User, UserCircle, UserCog } from 'lucide-react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import type { SessionUser } from '@kku/shared';
import { setThemePreferenceAction } from '@/lib/actions/theme';
import { RoleSwitcherDialog } from './role-switcher';

// Mirrors @kku/shared/auth/impersonation.canImpersonate. Inlined to keep
// this file client-safe — see the same pattern in app-nav.tsx.
function canImpersonate(role: string): boolean {
  return role === 'SUPER_ADMIN';
}

// Top-bar right cluster — bell · theme · user dropdown.
//
// 2026-05-09: consolidated. Previously user info was duplicated
// between this top-bar trigger and a footer chip in the left nav.
// The user dropdown is now the single home for account info,
// profile link, role switching, and sign-out. Theme stays as its
// own cycling icon button (Sun / Moon / Monitor) — quicker UX
// than burying it in a dropdown.

export function TopBarRight({
  user,
  displayName = null,
  avatarUrl = null,
  impersonating = false,
}: {
  user: SessionUser;
  /** Rank-prefixed Thai/English name (e.g. "ผศ. ดร. เด่นพงษ์ สุดภักดี").
   *  Resolved server-side via FacultyMember + DS2003. Null when the
   *  user isn't on the HR roster — falls back to bare `user.name`. */
  displayName?: { th: string; en: string } | null;
  /** URL to the user's uploaded profile photo. Null = render
   *  initials over the coral gradient. */
  avatarUrl?: string | null;
  impersonating?: boolean;
}) {
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const canSwitch = canImpersonate(user.role) || impersonating;

  // Use the rank-prefixed Thai name when available; otherwise fall
  // back to the bare SSO display name.
  const headerName = displayName?.th ?? user.name ?? user.email.split('@')[0];
  // For initials, strip Thai + English honorifics first so the avatar
  // shows the person's actual initials, not "ผศ" or "AP".
  const initialsSource =
    displayName?.en ?? displayName?.th ?? user.name ?? user.email;
  const initials = initialsSource
    .replace(/^(ผศ\.|รศ\.|ศ\.|ดร\.|อ\.|Asst\.|Assoc\.|Prof\.|Dr\.|Lect\.)\s*/gi, '')
    .replace(/^(ผศ\.|รศ\.|ศ\.|ดร\.|อ\.|Asst\.|Assoc\.|Prof\.|Dr\.|Lect\.)\s*/gi, '')
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  return (
    <>
      {/* Notification bell — generous icon button. */}
      <a
        href="/inbox"
        aria-label="Notifications inbox"
        className="relative flex h-12 w-12 items-center justify-center rounded-full text-text-secondary ring-1 ring-inset ring-border-subtle bg-surface-1/70 backdrop-blur-sm transition-[background-color,color,box-shadow,transform] duration-fast hover:bg-accent-subtle hover:text-accent-default hover:ring-accent/40 hover:shadow-glow-accent hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40"
      >
        <Bell className="h-[22px] w-[22px]" aria-hidden strokeWidth={1.8} />
      </a>

      <ThemeButton />

      <div className="mx-2 h-7 w-px bg-gradient-to-b from-transparent via-border-default to-transparent" aria-hidden />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex h-14 items-center gap-4 rounded-full px-1 transition-opacity duration-fast hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
          >
            {/* Avatar — uploaded photo when present; otherwise solid
                coral disk with initials. Same image source as the
                profile-page hero (served via /api/profile/avatar). */}
            <div
              aria-hidden
              className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-accent-default shadow-[0_2px_10px_-2px_rgb(255_140_70/0.55)]"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="block h-12 w-12 object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center text-[14px] font-bold uppercase tracking-wider text-accent-fg">
                  {initials || (user.name ?? user.email).slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className="hidden flex-col items-start leading-none md:flex relative top-[-0.5px]">
              <span className="text-[15px] font-semibold tracking-tight text-text-primary">
                {headerName}
              </span>
              <span className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-accent-default">
                {user.role.replaceAll('_', ' ')}
              </span>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[260px]">
          <DropdownMenuLabel>Account</DropdownMenuLabel>
          <DropdownMenuItem disabled>
            <User className="h-4 w-4 text-text-tertiary" aria-hidden />
            <span className="truncate text-xs text-text-tertiary">
              {user.email}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/profile">
              <UserCircle className="h-4 w-4 text-text-tertiary" aria-hidden />
              View profile
            </Link>
          </DropdownMenuItem>

          {canSwitch && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Role &amp; scope</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setSwitcherOpen(true);
                }}
              >
                <UserCog className="h-4 w-4 text-text-tertiary" aria-hidden />
                {impersonating ? 'Switch to a different role…' : 'Switch role…'}
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: '/signin' })}>
            <LogOut className="h-4 w-4 text-text-tertiary" aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {canSwitch && (
        <RoleSwitcherDialog
          open={switcherOpen}
          onOpenChange={setSwitcherOpen}
          currentRole={user.role}
        />
      )}
    </>
  );
}

// ─── Theme toggle ──────────────────────────────────────────────────────────

// Single-click cycle: light → dark → system → light. Icon reflects the
// current preference (Sun / Moon / Monitor) so the user always knows
// what's set; title/aria-label announces what the next click will do.

const THEME_CYCLE = ['light', 'dark', 'system'] as const;
type ThemePref = (typeof THEME_CYCLE)[number];

const THEME_ICON: Record<ThemePref, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const THEME_LABEL: Record<ThemePref, string> = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'System theme (follows OS)',
};

function ThemeButton() {
  const { theme, setTheme } = useTheme();

  // next-themes only knows the theme on the client (it reads
  // localStorage / system preference after mount). Rendering the
  // theme-specific icon during SSR + initial hydration triggers a
  // mismatch when the client value differs from the SSR default.
  // Mount-guard: render a neutral placeholder until the hook is
  // hydrated, then swap to the real icon.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const buttonClass =
    'relative flex h-12 w-12 items-center justify-center rounded-full text-text-secondary ring-1 ring-inset ring-border-subtle bg-surface-1/70 backdrop-blur-sm transition-[background-color,color,box-shadow,transform] duration-fast hover:bg-accent-subtle hover:text-accent-default hover:ring-accent/40 hover:shadow-glow-accent hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40';

  if (!mounted) {
    // Placeholder — same dimensions, neutral icon. No theme-dependent
    // strings, so SSR + first client render produce identical HTML.
    return (
      <button type="button" aria-label="Change theme" className={buttonClass} suppressHydrationWarning>
        <Sun className="h-[22px] w-[22px] opacity-0" aria-hidden strokeWidth={1.8} />
      </button>
    );
  }

  const current = (THEME_CYCLE.includes(theme as ThemePref) ? theme : 'system') as ThemePref;
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length]!;
  const Icon = THEME_ICON[current];

  const cycle = () => {
    setTheme(next);
    void setThemePreferenceAction(
      next === 'light' ? 'LIGHT' : next === 'dark' ? 'DARK' : 'SYSTEM',
    );
  };

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${THEME_LABEL[current]} · click for ${THEME_LABEL[next].toLowerCase()}`}
      aria-label={`${THEME_LABEL[current]}. Click to switch to ${THEME_LABEL[next].toLowerCase()}.`}
      className={buttonClass}
    >
      <Icon className="h-[22px] w-[22px]" aria-hidden strokeWidth={1.8} />
    </button>
  );
}
