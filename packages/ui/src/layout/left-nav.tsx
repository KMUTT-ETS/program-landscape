'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ModuleKey } from '@kku/design';
import { cn } from '../lib/cn';
import { Badge } from '../primitives/badge';

// 2026-04-24 redesign — the LeftNav is now the brand-home of the app.
// It renders on the dark nav-surface (near-black warm neutral) so the
// module signature colours pop. The bar at the top holds the KKU
// monogram + wordmark; the body holds module tiles; the footer holds
// the user chip (rendered by the consumer via `footer` slot).

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
  // Signature colour for the module. Uses the design-system module
  // token names (cockpit / programs / trends / gap / scenarios /
  // benchmarking / analyst / decisions) or 'neutral' for utility
  // routes. Tailwind classes are selected via a static map rather
  // than dynamic concatenation so JIT picks them up.
  moduleKey?: ModuleKey;
}

export interface LeftNavProps {
  sections: NavSection[];
  brand?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

// Static Tailwind class maps — keyed by ModuleKey. Defining them as
// strings here (rather than building them at render time) ensures the
// Tailwind JIT scanner sees the class names literally.
//
// For each module: icon chip bg + icon colour + active-tile bg +
// active left-rail bg.
const MODULE_CLASSES: Record<
  ModuleKey,
  {
    chipBg: string; // icon tile background when inactive
    chipActiveBg: string; // icon tile background when active
    chipIcon: string; // icon colour inside the chip
    activeTileBg: string; // tile bg when active
    activeRail: string; // left-edge rail when active
    labelActive: string; // active label colour
  }
> = {
  cockpit: {
    chipBg: 'bg-module-cockpit/15',
    chipActiveBg: 'bg-module-cockpit',
    chipIcon: 'text-module-cockpit',
    activeTileBg: 'bg-module-cockpit/12',
    activeRail: 'bg-module-cockpit',
    labelActive: 'text-module-cockpit',
  },
  programs: {
    chipBg: 'bg-module-programs/15',
    chipActiveBg: 'bg-module-programs',
    chipIcon: 'text-module-programs',
    activeTileBg: 'bg-module-programs/12',
    activeRail: 'bg-module-programs',
    labelActive: 'text-module-programs',
  },
  trends: {
    chipBg: 'bg-module-trends/15',
    chipActiveBg: 'bg-module-trends',
    chipIcon: 'text-module-trends',
    activeTileBg: 'bg-module-trends/12',
    activeRail: 'bg-module-trends',
    labelActive: 'text-module-trends',
  },
  gap: {
    chipBg: 'bg-module-gap/15',
    chipActiveBg: 'bg-module-gap',
    chipIcon: 'text-module-gap',
    activeTileBg: 'bg-module-gap/12',
    activeRail: 'bg-module-gap',
    labelActive: 'text-module-gap',
  },
  scenarios: {
    chipBg: 'bg-module-scenarios/15',
    chipActiveBg: 'bg-module-scenarios',
    chipIcon: 'text-module-scenarios',
    activeTileBg: 'bg-module-scenarios/12',
    activeRail: 'bg-module-scenarios',
    labelActive: 'text-module-scenarios',
  },
  benchmarking: {
    chipBg: 'bg-module-benchmarking/15',
    chipActiveBg: 'bg-module-benchmarking',
    chipIcon: 'text-module-benchmarking',
    activeTileBg: 'bg-module-benchmarking/12',
    activeRail: 'bg-module-benchmarking',
    labelActive: 'text-module-benchmarking',
  },
  analyst: {
    chipBg: 'bg-module-analyst/15',
    chipActiveBg: 'bg-module-analyst',
    chipIcon: 'text-module-analyst',
    activeTileBg: 'bg-module-analyst/12',
    activeRail: 'bg-module-analyst',
    labelActive: 'text-module-analyst',
  },
  decisions: {
    chipBg: 'bg-module-decisions/18',
    chipActiveBg: 'bg-module-decisions',
    chipIcon: 'text-module-decisions',
    activeTileBg: 'bg-module-decisions/14',
    activeRail: 'bg-module-decisions',
    labelActive: 'text-module-decisions',
  },
  neutral: {
    chipBg: 'bg-nav-fg/10',
    chipActiveBg: 'bg-nav-fg/20',
    chipIcon: 'text-nav-fg',
    activeTileBg: 'bg-nav-fg/8',
    activeRail: 'bg-nav-fg',
    labelActive: 'text-nav-fg',
  },
};

export function LeftNav({ sections, brand, footer, className }: LeftNavProps) {
  const pathname = usePathname();
  return (
    <nav
      className={cn(
        'flex h-full flex-col bg-nav-surface text-nav-fg',
        className,
      )}
    >
      {brand ? (
        <div className="flex items-center gap-3 border-b border-white/5 px-5 py-5">
          {brand}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, si) => (
          <div key={si} className={cn('flex flex-col gap-1', si > 0 && 'mt-6')}>
            {section.label && (
              <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-nav-fg-muted">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href));
              const moduleKey = item.moduleKey ?? 'neutral';
              const classes = MODULE_CLASSES[moduleKey] ?? MODULE_CLASSES.neutral;
              return (
                <NavTile
                  key={item.href + item.label}
                  item={item}
                  active={active}
                  classes={classes}
                />
              );
            })}
          </div>
        ))}
      </div>

      {footer ? (
        <div className="border-t border-white/5 p-3">{footer}</div>
      ) : null}
    </nav>
  );
}

function NavTile({
  item,
  active,
  classes,
}: {
  item: NavItem;
  active: boolean;
  classes: (typeof MODULE_CLASSES)[ModuleKey];
}) {
  // 2026-05-02 redesign — pill-shaped tiles, soft accent ring on active.
  // Active = module-tinted bg + module-coloured icon chip + coloured
  // label + left rail + subtle inset highlight. Inactive = neutral-on-
  // nav with coloured chip foreground.
  const base = cn(
    'group relative flex items-center gap-3 rounded-full px-3 py-2.5',
    'transition-[background-color,color,box-shadow] duration-fast',
    active
      ? cn(
          classes.activeTileBg,
          classes.labelActive,
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]',
        )
      : 'text-nav-fg/80 hover:bg-nav-surface-hover hover:text-nav-fg',
    item.disabled && 'pointer-events-none opacity-40',
  );

  const content = (
    <>
      {active && !item.disabled && (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-2 left-0 w-[3px] rounded-r-full',
            classes.activeRail,
          )}
        />
      )}
      {item.icon && (
        <span
          aria-hidden
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            '[&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:shrink-0 [&>svg]:stroke-[2]',
            active ? cn(classes.chipActiveBg, 'text-white') : cn(classes.chipBg, classes.chipIcon),
          )}
        >
          {item.icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-tight">
        {item.label}
      </span>
      {item.badge && (
        <Badge tone={active ? 'accent' : 'neutral'} size="sm" className="shrink-0">
          {item.badge}
        </Badge>
      )}
      {item.hint && !item.badge && (
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.1em] text-nav-fg-muted">
          {item.hint}
        </span>
      )}
    </>
  );

  if (item.disabled) {
    return (
      <div className={base} aria-disabled="true" title={item.hint}>
        {content}
      </div>
    );
  }
  return (
    <Link href={item.href} className={base}>
      {content}
    </Link>
  );
}
