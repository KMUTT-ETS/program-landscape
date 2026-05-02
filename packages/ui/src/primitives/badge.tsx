import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  [
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
    'text-xs font-medium',
    'border border-transparent',
  ].join(' '),
  {
    variants: {
      tone: {
        neutral: 'bg-surface-2 text-text-secondary border-border-subtle',
        accent: 'bg-accent-subtle text-accent-default border-transparent',
        success: 'bg-success-subtle text-success border-transparent',
        warning: 'bg-warning-subtle text-warning border-transparent',
        danger: 'bg-danger-subtle text-danger border-transparent',
        info: 'bg-info-subtle text-info border-transparent',
        outline: 'bg-transparent text-text-secondary border-border-default',
      },
      // pb nudge for Sarabun's tall ascender — see note in Button.
      size: {
        sm: 'h-5 px-1.5 pb-[1px] text-[10px]',
        md: 'h-6 px-2 pb-[1px] text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
