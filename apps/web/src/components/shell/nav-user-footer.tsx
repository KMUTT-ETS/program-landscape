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
import { ChevronUp, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import type { SessionUser } from '@kku/shared';
import { setThemePreferenceAction } from '@/lib/actions/theme';

// User chip rendered in the LeftNav footer slot. The sidebar is on the
// nav-surface (near-black) so the chip uses alpha layers on top of
// nav-fg to stay legible without competing with the brand at top.

export function NavUserFooter({ user }: { user: SessionUser }) {
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-fast hover:bg-nav-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-fg/20"
        >
          <div
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-nav-fg/10 text-[11px] font-bold uppercase text-nav-fg ring-1 ring-nav-fg/20"
          >
            {initials || (user.name ?? user.email).slice(0, 1).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold text-nav-fg">
              {user.name ?? user.email.split('@')[0]}
            </span>
            <span className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-nav-fg-muted">
              {user.role.replaceAll('_', ' ')}
            </span>
          </div>
          <ChevronUp className="h-4 w-4 shrink-0 text-nav-fg-muted transition-transform duration-fast group-data-[state=open]:rotate-180" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[220px]">
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuItem disabled>
          <span className="truncate text-xs text-text-tertiary">{user.email}</span>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
