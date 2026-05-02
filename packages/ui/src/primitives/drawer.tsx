'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

// Right-side drawer built on Radix Dialog. Used for ProvenanceDrawer,
// RightPanel (Linear-style detail views), etc.

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'right' | 'left';
    widthClass?: string;
  }
>(function DrawerContent(
  { className, children, side = 'right', widthClass = 'w-[min(460px,90vw)]', ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-40 bg-text-primary/30 backdrop-blur-md',
          'data-[state=open]:animate-fade-in',
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed top-0 z-50 h-full',
          widthClass,
          side === 'right' ? 'right-0' : 'left-0',
          // Glossy gradient panel + accent-edge hairline on the inner
          // edge so the drawer feels deliberately attached to the
          // canvas, not slapped on top.
          'kku-popup flex flex-col rounded-l-3xl',
          'data-[state=open]:animate-slide-in-right',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-text-tertiary ring-1 ring-inset ring-transparent transition-[background-color,color,box-shadow,ring-color] duration-fast hover:bg-accent-subtle hover:text-accent-default hover:ring-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40"
        >
          <X className="h-4 w-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col gap-1.5 border-b border-border-subtle px-6 py-5 pr-12',
      className,
    )}
    {...props}
  />
);

export const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DrawerTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-base font-semibold tracking-tight text-text-primary', className)}
      {...props}
    />
  );
});

export const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DrawerDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm leading-relaxed text-text-secondary', className)}
      {...props}
    />
  );
});

export const DrawerBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex-1 overflow-y-auto px-6 py-5', className)} {...props} />
);
