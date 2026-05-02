'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../lib/cn';

// Segmented control = Radix Tabs styled as a pill-group. 2026-05-02b:
// the whole control is a pill; the active trigger gets a coral accent
// + soft glow. Matches Button family.

export const Segmented = TabsPrimitive.Root;

export const SegmentedList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function SegmentedList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex h-9 items-center rounded-full border border-border-subtle bg-surface-1/80 p-1 backdrop-blur-sm',
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
        'inline-flex h-7 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-medium text-text-secondary',
        'transition-[background-color,color,box-shadow] duration-fast',
        'hover:text-text-primary',
        'data-[state=active]:bg-accent data-[state=active]:text-accent-fg data-[state=active]:shadow-[0_2px_8px_-2px_rgb(255_140_70/0.45)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40',
        className,
      )}
      {...props}
    />
  );
});

// Content panel — exported so consumers can pair it with Segmented without
// taking a direct dep on @radix-ui/react-tabs.
export const SegmentedContent = TabsPrimitive.Content;
