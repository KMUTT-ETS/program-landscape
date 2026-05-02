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
      {/* Notification bell — neutral-on-surface. Reads as muted chrome
          in default state; pops on hover. */}
      <a
        href="/inbox"
        aria-label="Notifications inbox"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-text-secondary ring-1 ring-inset ring-transparent transition-[background-color,color,box-shadow] duration-fast hover:bg-accent-subtle hover:text-accent-default hover:ring-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40"
      >
        <Bell className="h-[17px] w-[17px]" aria-hidden />
      </a>

      <ThemeButton />

      <div className="mx-1.5 h-5 w-px bg-gradient-to-b from-transparent via-border-default to-transparent" aria-hidden />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex h-9 items-center gap-2 rounded-full pl-1 pr-3 py-1 ring-1 ring-inset ring-border-subtle bg-surface-1/60 transition-[background-color,box-shadow,ring-color] duration-fast hover:bg-accent-subtle hover:ring-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40"
          >
            {/* Avatar — accent-tinted initials on subtle surface. */}
            <div
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-full bg-accent-subtle text-[11px] font-bold uppercase text-accent-default ring-1 ring-accent-default/15"
            >
              {initials || (user.name ?? user.email).slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden flex-col items-start leading-tight md:flex">
              <span className="text-[12.5px] font-semibold text-text-primary">
                {user.name ?? user.email.split('@')[0]}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
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
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-text-secondary ring-1 ring-inset ring-transparent transition-[background-color,color,box-shadow] duration-fast hover:bg-accent-subtle hover:text-accent-default hover:ring-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40"
    >
      <Icon className="h-[17px] w-[17px]" aria-hidden />
    </button>
  );
}
