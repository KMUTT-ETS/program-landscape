'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

// Tooltip uses the shared `.kku-popup` glossy-edge surface so it reads
// as part of the same chrome family as Dropdown / Popover / Dialog.
// Edge-1 tinted border + soft top highlight + backdrop blur. Used for
// every humanized value tooltip across the app (DataTable numeric
// cells, Heatmap cells, chart hover detail).
export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'kku-popup z-50 max-w-xs rounded-lg px-2.5 py-1.5',
          'text-xs font-medium text-text-primary',
          'animate-fade-in',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

// Convenience wrapper — the most common shape: trigger + content with
// 200ms delay + provider on top. Use this when you don't already have
// a TooltipProvider above in the tree (the AppShell mounts one at the
// root, so most callers can use raw <Tooltip> + <TooltipContent>).
export interface HoverTooltipProps {
  /** Tooltip body — string or rich content. */
  content: React.ReactNode;
  /** The element that triggers the tooltip on hover/focus. */
  children: React.ReactNode;
  /** Optional Tailwind classes for the content panel. */
  className?: string;
  /** Side of the trigger to anchor to. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Open delay in ms. Defaults to 200ms — fast enough to feel
   *  responsive on table hovers, slow enough to avoid flicker. */
  delayMs?: number;
}

export function HoverTooltip({
  content,
  children,
  className,
  side = 'top',
  delayMs = 200,
}: HoverTooltipProps) {
  return (
    <Tooltip delayDuration={delayMs}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
