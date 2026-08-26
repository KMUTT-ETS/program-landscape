'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle, Info as InfoIcon, X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

// Page-level banner. For transient confirmations use toasts (sonner).
// Banners are persistent: "freshness policy changed", "KKU SSO outage",
// "data source X is down".

const bannerVariants = cva(
  'flex items-start gap-3 rounded-md border px-4 py-3 text-sm',
  {
    variants: {
      tone: {
        info: 'border-info/30 bg-info-subtle text-info',
        success: 'border-success/30 bg-success-subtle text-success',
        warning: 'border-warning/30 bg-warning-subtle text-warning',
        danger: 'border-danger/30 bg-danger-subtle text-danger',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

const icons = {
  info: InfoIcon,
  success: CheckCircle,
  warning: AlertTriangle,
  danger: AlertTriangle,
} as const;

export interface BannerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>,
    VariantProps<typeof bannerVariants> {
  title: string;
  description?: string;
  onDismiss?: () => void;
}

export function Banner({
  className,
  tone = 'info',
  title,
  description,
  onDismiss,
  ...props
}: BannerProps) {
  const Icon = icons[tone ?? 'info'];
  return (
    <div role="status" className={cn(bannerVariants({ tone }), className)} {...props}>
      <Icon className="mt-0.5 size-icon-md flex-none" aria-hidden />
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        {description && <div className="mt-0.5 text-text-secondary">{description}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="rounded-sm text-current/70 hover:text-current"
        >
          <X className="size-icon-md" aria-hidden />
        </button>
      )}
    </div>
  );
}
