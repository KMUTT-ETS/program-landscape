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
// 2026-05-02b: nav surface is now a light cream tint, so active-tile
// uses the dedicated `-subtle` variant (which is light-tinted in light
// mode + dark-tinted in dark mode — same key handles both). Inactive
// chip lifted from /15 to /20 so the icon chip reads on cream too.
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
    chipBg: 'bg-module-cockpit/20',
    chipActiveBg: 'bg-module-cockpit',
    chipIcon: 'text-module-cockpit',
    activeTileBg: 'bg-module-cockpit-subtle',
    activeRail: 'bg-module-cockpit',
    labelActive: 'text-module-cockpit',
  },
  programs: {
    chipBg: 'bg-module-programs/20',
    chipActiveBg: 'bg-module-programs',
    chipIcon: 'text-module-programs',
    activeTileBg: 'bg-module-programs-subtle',
    activeRail: 'bg-module-programs',
    labelActive: 'text-module-programs',
  },
  trends: {
    chipBg: 'bg-module-trends/20',
    chipActiveBg: 'bg-module-trends',
    chipIcon: 'text-module-trends',
    activeTileBg: 'bg-module-trends-subtle',
    activeRail: 'bg-module-trends',
    labelActive: 'text-module-trends',
  },
  gap: {
    chipBg: 'bg-module-gap/20',
    chipActiveBg: 'bg-module-gap',
    chipIcon: 'text-module-gap',
    activeTileBg: 'bg-module-gap-subtle',
    activeRail: 'bg-module-gap',
    labelActive: 'text-module-gap',
  },
  scenarios: {
    chipBg: 'bg-module-scenarios/20',
    chipActiveBg: 'bg-module-scenarios',
    chipIcon: 'text-module-scenarios',
    activeTileBg: 'bg-module-scenarios-subtle',
    activeRail: 'bg-module-scenarios',
    labelActive: 'text-module-scenarios',
  },
  benchmarking: {
    chipBg: 'bg-module-benchmarking/20',
    chipActiveBg: 'bg-module-benchmarking',
    chipIcon: 'text-module-benchmarking',
    activeTileBg: 'bg-module-benchmarking-subtle',
    activeRail: 'bg-module-benchmarking',
    labelActive: 'text-module-benchmarking',
  },
  analyst: {
    chipBg: 'bg-module-analyst/20',
    chipActiveBg: 'bg-module-analyst',
    chipIcon: 'text-module-analyst',
    activeTileBg: 'bg-module-analyst-subtle',
    activeRail: 'bg-module-analyst',
    labelActive: 'text-module-analyst',
  },
  decisions: {
    chipBg: 'bg-module-decisions/22',
    chipActiveBg: 'bg-module-decisions',
    chipIcon: 'text-module-decisions',
    activeTileBg: 'bg-module-decisions-subtle',
    activeRail: 'bg-module-decisions',
    labelActive: 'text-module-decisions',
  },
  neutral: {
    chipBg: 'bg-accent-subtle',
    chipActiveBg: 'bg-accent',
    chipIcon: 'text-accent-default',
    activeTileBg: 'bg-accent-subtle',
    activeRail: 'bg-accent-default',
    labelActive: 'text-accent-default',
  },
};

export function LeftNav({ sections, brand, footer, className }: LeftNavProps) {
  const pathname = usePathname();
  return (
    <nav
      className={cn(
        // 2026-05-02b: glossy backdrop on the nav surface — peach-cream
        // gradient at the top fading to flat surface, so the whole
        // column reads as one panel with the canvas. Right-edge hairline
        // uses the accent-edge palette to echo the EdgeGlow vocabulary.
        'kku-leftnav relative flex h-full flex-col bg-nav-surface text-nav-fg',
        className,
      )}
    >
      {brand ? (
        <div className="kku-leftnav-brand relative flex items-center gap-4 px-6 py-6">
          {brand}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-4 py-5">
        {sections.map((section, si) => (
          <div key={si} className={cn('flex flex-col gap-1.5', si > 0 && 'mt-7')}>
            {section.label && (
              <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-accent-default">
                <span className="h-[2px] w-3 rounded-full bg-gradient-to-r from-accent-default to-accent-hover" aria-hidden />
                <span>{section.label}</span>
                <span className="h-px flex-1 bg-gradient-to-r from-border-default/60 to-transparent" aria-hidden />
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
        <div className="border-t border-border-subtle p-3">{footer}</div>
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
  // 2026-05-02c — bigger pill tiles with dramatic active state.
  // Larger hit-area, more breathing, glow that's visible not subtle.
  // gap-4 (16px) between icon and label — gap-3.5 felt cramped.
  const base = cn(
    'group relative flex items-center gap-4 rounded-full px-3.5 py-3',
    'transition-[background-color,color,box-shadow,transform] duration-fast',
    active
      ? cn(
          classes.activeTileBg,
          classes.labelActive,
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_8px_20px_-6px_rgb(255_140_70/0.35),0_0_0_1px_rgb(255_140_70/0.12)]',
        )
      : 'text-text-secondary hover:bg-accent-subtle/40 hover:text-text-primary hover:translate-x-[1px]',
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
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            '[&>svg]:h-[20px] [&>svg]:w-[20px] [&>svg]:shrink-0 [&>svg]:stroke-[2]',
            active
              ? cn(classes.chipActiveBg, 'text-white shadow-[0_2px_8px_-2px_rgb(0_0_0/0.15)]')
              : cn(classes.chipBg, classes.chipIcon),
          )}
        >
          {item.icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium leading-tight">
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
