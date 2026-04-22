'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/cn';
import { Badge } from '../primitives/badge';

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string;
  disabled?: boolean;
  hint?: string;
}

export interface LeftNavProps {
  sections: NavSection[];
  className?: string;
}

export function LeftNav({ sections, className }: LeftNavProps) {
  const pathname = usePathname();
  return (
    <nav className={cn('flex h-full flex-col gap-5 p-3 text-sm', className)}>
      {sections.map((section, i) => (
        <div key={i} className="flex flex-col gap-1">
          {section.label && (
            <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-text-tertiary">
              {section.label}
            </div>
          )}
          {section.items.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));
            const base =
              'group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-fast';
            const state = item.disabled
              ? 'text-text-disabled cursor-not-allowed'
              : active
                ? 'bg-surface-3 text-text-primary'
                : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary';
            const content = (
              <>
                {item.icon && (
                  <span
                    aria-hidden
                    className={cn(
                      'h-4 w-4 text-text-tertiary',
                      active && 'text-text-primary',
                      'group-hover:text-text-primary',
                    )}
                  >
                    {item.icon}
                  </span>
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && (
                  <Badge tone="outline" size="sm" className="shrink-0">
                    {item.badge}
                  </Badge>
                )}
                {item.hint && !item.badge && (
                  <span className="shrink-0 text-[10px] text-text-tertiary">
                    {item.hint}
                  </span>
                )}
              </>
            );
            return item.disabled ? (
              <div
                key={item.href + item.label}
                className={cn(base, state)}
                aria-disabled="true"
                title={item.hint}
              >
                {content}
              </div>
            ) : (
              <Link key={item.href + item.label} href={item.href} className={cn(base, state)}>
                {content}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
