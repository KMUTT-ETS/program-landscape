'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

// Tooltip uses a tighter pill aesthetic — small, dark surface so it
// stands out against the cream canvas. Doesn't use .kku-popup (which
// is glossy/light); tooltips are a different visual register —
// "transient hint", not "panel".
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
          'z-50 max-w-xs rounded-lg bg-text-primary px-2.5 py-1.5',
          'text-xs font-medium text-text-inverse',
          'shadow-[0_4px_16px_-4px_rgb(0_0_0/0.25)]',
          'animate-fade-in',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
