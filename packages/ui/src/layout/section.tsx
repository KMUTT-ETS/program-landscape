import * as React from 'react';
import { cn } from '../lib/cn';

export interface SectionProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-3', className)} {...props}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {/* Bespoke section eyebrow — short coral accent bar
                replaces the old plain h2. Reads as "this is a
                deliberate group" without being heavy. */}
            {title && (
              <>
                <span
                  aria-hidden
                  className="h-3.5 w-[3px] rounded-full bg-gradient-to-b from-accent-default to-accent-hover"
                />
                <div className="flex flex-col leading-tight">
                  <h2 className="text-base font-semibold tracking-tight text-text-primary">
                    {title}
                  </h2>
                  {description && (
                    <p className="text-xs text-text-tertiary">{description}</p>
                  )}
                </div>
              </>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
