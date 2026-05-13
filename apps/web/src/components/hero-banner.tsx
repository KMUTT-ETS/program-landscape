import * as React from 'react';
import { Card, Stat, cn } from '@kku/ui';

// Hero banner — the canonical greeting / page-introduction surface used
// by the home page and the admin console. Was previously inlined on
// /admin/page.tsx; lifted here so both surfaces share the same glow,
// dot grid, icon badge, stat strip, and breakpoint behaviour.
//
// Use it at the very top of a page. Pair with a 4-tile stat strip
// (already grid-friendly) or pass an arbitrary right slot if a page
// needs a custom companion (status chip, "live" indicator, etc).

export interface HeroBannerStat {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
}

export interface HeroBannerProps {
  /** Small uppercase eyebrow text above the title. Defaults to none. */
  eyebrow?: React.ReactNode;
  /** The big greeting or page title. Required. */
  title: React.ReactNode;
  /** One-line supporting copy below the title. */
  subtitle?: React.ReactNode;
  /** Icon rendered inside the 48px rounded badge on the left. */
  icon?: React.ReactNode;
  /** Companion element rendered at the top-right (e.g. role chip). */
  right?: React.ReactNode;
  /** When provided, renders below the heading as a 4-up stat grid. */
  stats?: HeroBannerStat[];
  /** Visual accent tone. Defaults to "accent" (warm-neutral). */
  tone?: 'accent' | 'cardinal';
  className?: string;
}

export function HeroBanner({
  eyebrow,
  title,
  subtitle,
  icon,
  right,
  stats,
  tone = 'accent',
  className,
}: HeroBannerProps) {
  const accentVar =
    tone === 'cardinal'
      ? '--color-brand-cardinal'
      : '--color-accent-default';
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border-subtle bg-surface-1',
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-90"
        style={{
          background: `linear-gradient(135deg, oklch(var(--color-surface-1)) 0%, oklch(var(--color-surface-1)) 55%, oklch(var(${accentVar}) / 0.08) 100%)`,
        }}
      />
      <div
        aria-hidden
        className="absolute -top-32 -right-24 h-[420px] w-[420px] rounded-full opacity-25 blur-[120px]"
        style={{ background: `oklch(var(${accentVar}))` }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-24 h-[360px] w-[360px] rounded-full opacity-15 blur-[120px]"
        style={{ background: 'oklch(var(--color-brand-cardinal))' }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, oklch(var(--color-text-primary)) 1.2px, transparent 1.2px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative z-10 px-7 py-8 sm:px-9 sm:py-10">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            {icon && (
              <div className="relative flex-shrink-0">
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-2xl opacity-50 blur-md"
                  style={{ background: `oklch(var(${accentVar}))` }}
                />
                <div
                  className={cn(
                    'relative flex h-12 w-12 items-center justify-center rounded-2xl border',
                    tone === 'cardinal'
                      ? 'border-brand-cardinal/30 bg-brand-cardinal/10 text-brand-cardinal'
                      : 'border-accent-default/30 bg-accent-default/10 text-accent-default',
                  )}
                >
                  {icon}
                </div>
              </div>
            )}
            <div className="min-w-0">
              {eyebrow && (
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
                  {eyebrow}
                </div>
              )}
              <h1 className="mt-1 text-[26px] font-medium tracking-tight text-text-primary sm:text-[30px]">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-text-secondary">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {right && <div className="flex-shrink-0">{right}</div>}
        </div>

        {stats && stats.length > 0 && (
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <Card
                key={String(s.label)}
                padding="sm"
                elevation="sm"
                className="bg-surface-0/70 backdrop-blur-sm"
              >
                <Stat
                  label={s.label}
                  value={s.value}
                  hint={s.hint}
                  icon={s.icon}
                />
              </Card>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
