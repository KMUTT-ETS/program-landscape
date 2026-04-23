'use client';

import * as React from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kku/ui';
import { Database, FileText, LogOut, Monitor, Moon, Palette, Sun, User } from 'lucide-react';
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

  return (
    <>
      <kbd className="hidden rounded border border-border-default bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary md:inline">
        ⌘K
      </kbd>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <div className="grid h-6 w-6 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold text-text-secondary">
              {(user.name ?? user.email).slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden flex-col items-start leading-tight md:flex">
              <span className="text-xs font-medium text-text-primary">
                {user.name ?? user.email}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
                {user.role.replaceAll('_', ' ')}
              </span>
            </div>
          </Button>
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
          <DropdownMenuItem asChild>
            <a href="/styleguide" className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-text-tertiary" aria-hidden />
              Styleguide
            </a>
          </DropdownMenuItem>
          {(user.role === 'ADMIN' || user.role === 'ANALYST') && (
            <DropdownMenuItem asChild>
              <a href="/admin/data-sources" className="flex items-center gap-2">
                <Database className="h-4 w-4 text-text-tertiary" aria-hidden />
                Data sources
              </a>
            </DropdownMenuItem>
          )}
          {user.role === 'ADMIN' && (
            <DropdownMenuItem asChild>
              <a href="/admin/pdf-generation" className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-text-tertiary" aria-hidden />
                PDF generation
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
