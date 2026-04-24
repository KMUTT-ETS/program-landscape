import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ModuleKey } from '@kku/design';
import { cn } from '../lib/cn';

// 2026-04-24 redesign — the Card is the workhorse container.
//   - Softer border (border-subtle by default; border-default reserved
//     for primary-emphasis blocks).
//   - Crisper 12px radius (was 8px), reads as more deliberate on large
//     compositions like the cockpit.
//   - Optional `accent` stripe (left-edge, 3px) in module colour —
//     used to group a card with the active module without drenching
//     the container.

const cardVariants = cva(
  [
    'relative rounded-xl border border-border-subtle bg-surface-1',
    'transition-[box-shadow,border-color] duration-fast',
  ].join(' '),
  {
    variants: {
      elevation: {
        flat: '',
        sm: 'shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        md: 'shadow-[0_2px_6px_rgba(16,24,40,0.06)]',
        lg: 'shadow-[0_8px_24px_rgba(16,24,40,0.08)]',
      },
      padding: {
        none: '',
        sm: 'p-3',
        md: 'p-5',
        lg: 'p-6',
      },
      tone: {
        default: '',
        raised: 'bg-surface-2',
        quiet: 'bg-surface-0',
      },
      interactive: {
        true: 'hover:border-border-default hover:shadow-[0_4px_12px_rgba(16,24,40,0.08)]',
        false: '',
      },
    },
    defaultVariants: {
      elevation: 'sm',
      padding: 'md',
      tone: 'default',
      interactive: false,
    },
  },
);

// Module accent stripe — literal class names so Tailwind JIT picks
// them up. Rendered as an absolutely-positioned element in Card.
const ACCENT_CLASSES: Record<ModuleKey, string> = {
  cockpit: 'bg-module-cockpit',
  programs: 'bg-module-programs',
  trends: 'bg-module-trends',
  gap: 'bg-module-gap',
  scenarios: 'bg-module-scenarios',
  benchmarking: 'bg-module-benchmarking',
  analyst: 'bg-module-analyst',
  decisions: 'bg-module-decisions',
  neutral: 'bg-border-strong',
};

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  /** Render a 3px accent stripe down the left edge in module colour. */
  accent?: ModuleKey;
}

export function Card({
  className,
  elevation,
  padding,
  tone,
  interactive,
  accent,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        cardVariants({ elevation, padding, tone, interactive }),
        accent && 'overflow-hidden',
        className,
      )}
      {...props}
    >
      {accent && (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-3 left-0 w-[3px] rounded-r-full',
            ACCENT_CLASSES[accent],
          )}
        />
      )}
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mb-4 flex items-start justify-between gap-3', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'text-[13px] font-semibold uppercase tracking-[0.04em] text-text-secondary',
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-text-tertiary', className)} {...props} />;
}
