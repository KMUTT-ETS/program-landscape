'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../lib/cn';

// Segmented control = Radix Tabs styled as a pill-group. Used for
// density selection, chart-type toggles, view-mode switches.

export const Segmented = TabsPrimitive.Root;

export const SegmentedList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function SegmentedList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex h-8 items-center rounded-md border border-border-default bg-surface-1 p-0.5',
        className,
      )}
      {...props}
    />
  );
});

export const SegmentedTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function SegmentedTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex h-7 items-center justify-center rounded-sm px-3 text-xs font-medium text-text-secondary',
        'transition-colors duration-fast',
        'data-[state=active]:bg-surface-3 data-[state=active]:text-text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
      {...props}
    />
  );
});

// Content panel — exported so consumers can pair it with Segmented without
// taking a direct dep on @radix-ui/react-tabs.
export const SegmentedContent = TabsPrimitive.Content;
