import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '../lib/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        // h-[2.25rem], not h-9. This project REPLACES Tailwind's spacing
        // scale (packages/design/src/tokens/spacing.ts) and that scale has
        // no `9` key, so `h-9` emitted no CSS at all — the height every
        // Input has ever had came from px-3/py-2 plus content, landing at
        // 33px by accident. 2.25rem is what stock-Tailwind h-9 meant and
        // what `.kku-select` already uses, so inputs and selects now line
        // up in a filter row instead of missing each other by 3px.
        //
        // An arbitrary value rather than a new scale key on purpose: adding
        // `9` would switch on every h-9/w-9 in the codebase at once —
        // FilterChip, Button's sm/icon sizes — which that file's header
        // warns against without measuring each. See also `3.5`, omitted
        // there for the same reason.
        'flex h-[2.25rem] w-full rounded-md border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary',
        'placeholder:text-text-tertiary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(function Label({ className, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn('text-xs font-medium text-text-secondary', className)}
      {...props}
    />
  );
});
