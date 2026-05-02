'use client';

import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kku/ui';
import { Bell, LogOut, Monitor, Moon, Sun, User } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import type { SessionUser } from '@kku/shared';
import { setThemePreferenceAction } from '@/lib/actions/theme';

export function TopBarRight({ user }: { user: SessionUser }) {
  const { theme, setTheme } = useTheme();

  const onTheme = (value: string) => {
    setTheme(value);
    void setThemePreferenceAction(
      value === 'light' ? 'LIGHT' : value === 'dark' ? 'DARK' : 'SYSTEM',
    );
  };

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
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors duration-fast hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40"
      >
        <Bell className="h-[17px] w-[17px]" aria-hidden />
      </a>

      <div className="mx-1 h-6 w-px bg-border-subtle" aria-hidden />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex h-9 items-center gap-2 rounded-md pl-1 pr-2 py-1 ring-1 ring-inset ring-transparent transition-colors duration-fast hover:bg-surface-2 hover:ring-border-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40"
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
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={onTheme}>
            <DropdownMenuRadioItem value="light">
              <Sun className="h-4 w-4 text-text-tertiary" aria-hidden /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon className="h-4 w-4 text-text-tertiary" aria-hidden /> Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor className="h-4 w-4 text-text-tertiary" aria-hidden /> System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: '/signin' })}>
            <LogOut className="h-4 w-4 text-text-tertiary" aria-hidden />
            Sign out
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Personal action — notifications. Module nav lives in the
              sidebar; admin pages live in the sidebar's admin sections;
              uploading PDFs is reached through Setup hub or any
              category card so the user has context before uploading.
              Anything else here would re-introduce the duplicate-path
              problem this dropdown had before 2026-05-02. */}
          <DropdownMenuItem asChild>
            <a href="/inbox" className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-text-tertiary" aria-hidden />
              Inbox
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
