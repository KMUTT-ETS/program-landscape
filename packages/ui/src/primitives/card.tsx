import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const cardVariants = cva(
  ['rounded-lg border border-border-default bg-surface-1', 'transition-shadow'].join(' '),
  {
    variants: {
      elevation: {
        flat: 'shadow-elevation-0',
        sm: 'shadow-card',
        md: 'shadow-elevation-2',
        lg: 'shadow-elevation-3',
      },
      padding: {
        none: '',
        sm: 'p-3',
        md: 'p-5',
        lg: 'p-6',
      },
    },
    defaultVariants: { elevation: 'sm', padding: 'md' },
  },
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, elevation, padding, ...props }: CardProps) {
  return (
    <div className={cn(cardVariants({ elevation, padding }), className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-3 flex items-start justify-between gap-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-text-primary', className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-text-tertiary', className)} {...props} />;
}
