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
import { Bell, LogOut, Monitor, Moon, Sun, User } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import type { SessionUser } from '@kku/shared';
import { setThemePreferenceAction } from '@/lib/actions/theme';

// Top-bar right cluster — bell · theme · user.
//
// 2026-05-02 cleanup: theme picker promoted out of the user dropdown
// into its own icon button (the standard Linear/Vercel pattern).
// The user dropdown is now strictly account info + sign out.

export function TopBarRight({ user }: { user: SessionUser }) {
  const initials = (user.name ?? user.email)
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
            className="group flex h-12 items-center gap-3.5 rounded-full pl-1.5 pr-5 ring-1 ring-inset ring-border-subtle bg-surface-1/70 backdrop-blur-sm transition-[background-color,box-shadow,ring-color] duration-fast hover:bg-accent-subtle hover:ring-accent/40 hover:shadow-glow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40"
          >
            {/* Avatar — solid coral disk with bold initials. Simplified
                from the previous gradient + ring + shadow stack which
                read as "distorted" at small sizes. */}
            <div
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-full bg-accent-default text-[13px] font-bold uppercase tracking-wider text-accent-fg shadow-[0_2px_10px_-2px_rgb(255_140_70/0.55)]"
            >
              {initials || (user.name ?? user.email).slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden flex-col items-start leading-none md:flex">
              <span className="text-[15px] font-semibold tracking-tight text-text-primary">
                {user.name ?? user.email.split('@')[0]}
              </span>
              <span className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-accent-default">
                {user.role.replaceAll('_', ' ')}
              </span>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Account</DropdownMenuLabel>
          <DropdownMenuItem disabled>
            <User className="h-4 w-4 text-text-tertiary" aria-hidden />
            <span className="truncate">{user.email}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: '/signin' })}>
            <LogOut className="h-4 w-4 text-text-tertiary" aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
