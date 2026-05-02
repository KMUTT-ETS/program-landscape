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
import { Activity, Bell, BrainCircuit, Building2, ClipboardCheck, Compass, Database, FileText, Gauge, GitBranch, LogOut, Monitor, Moon, Network, Palette, Sun, Upload, User } from 'lucide-react';
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
          <DropdownMenuItem asChild>
            <a href="/styleguide" className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-text-tertiary" aria-hidden />
              Styleguide
            </a>
          </DropdownMenuItem>
          {(user.role === 'ADMIN' ||
            user.role === 'ANALYST' ||
            user.role === 'DEAN' ||
            user.role === 'DEPT_HEAD') && (
            <DropdownMenuItem asChild>
              <a href="/upload" className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-text-tertiary" aria-hidden />
                Upload PDFs
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a href="/cockpit" className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-text-tertiary" aria-hidden />
              Portfolio cockpit
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/trends" className="flex items-center gap-2">
              <Compass className="h-4 w-4 text-text-tertiary" aria-hidden />
              Trends radar
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/skills" className="flex items-center gap-2">
              <Network className="h-4 w-4 text-text-tertiary" aria-hidden />
              Skill explorer
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/inbox" className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-text-tertiary" aria-hidden />
              Inbox
            </a>
          </DropdownMenuItem>
          {(user.role === 'ADMIN' ||
            user.role === 'ANALYST' ||
            user.role === 'EXECUTIVE' ||
            user.role === 'COUNCIL') && (
            <DropdownMenuItem asChild>
              <a href="/admin/system-status" className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-text-tertiary" aria-hidden />
                System status
              </a>
            </DropdownMenuItem>
          )}
          {(user.role === 'ADMIN' || user.role === 'ANALYST') && (
            <>
              <DropdownMenuItem asChild>
                <a href="/admin/programs" className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-text-tertiary" aria-hidden />
                  Programs
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/admin/programs/pipeline" className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-text-tertiary" aria-hidden />
                  Curriculum pipeline
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/admin/data-quality" className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-text-tertiary" aria-hidden />
                  Data quality
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/admin/data-sources" className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-text-tertiary" aria-hidden />
                  Data sources
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/admin/pdf-review" className="flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-text-tertiary" aria-hidden />
                  PDF review queue
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/admin/extraction-review" className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-text-tertiary" aria-hidden />
                  AI extraction review
                </a>
              </DropdownMenuItem>
            </>
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
