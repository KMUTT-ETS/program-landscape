import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

// Button — used everywhere. Keep variants small and opinionated; the
// styleguide is the contract.
//
// 2026-05-02 redesign:
//   - Default shape is `pill` (rounded-full). Opt out with `shape="square"`
//     when the pill curves clip glyphs at the ends (e.g. wide hero CTAs
//     inside a Card with rounded corners that already curve).
//   - Primary buttons gain a coral glow on hover via shadow-glow-accent
//     so the accent feels lit-up against the pastel surfaces.
//   - Padding bumped slightly so pill silhouettes don't pinch the label.
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-medium text-sm',
    'transition-[background-color,color,border-color,box-shadow,transform] duration-fast ease-standard',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active active:text-text-inverse hover:shadow-glow-accent',
        default:
          'bg-surface-1 text-text-primary border border-border-default hover:bg-surface-2',
        outline:
          'bg-transparent text-text-primary border border-border-default hover:bg-surface-1 hover:border-accent',
        ghost: 'bg-transparent text-text-primary hover:bg-surface-1',
        subtle: 'bg-accent-subtle text-text-primary hover:bg-surface-3',
        danger:
          'bg-danger text-text-inverse hover:opacity-90 focus-visible:ring-danger',
        link: 'bg-transparent text-accent-default underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-7 px-3 text-xs',
        sm: 'h-9 px-4 text-sm',
        md: 'h-10 px-5 text-sm',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9 p-0',
      },
      shape: {
        pill: 'rounded-full',
        square: 'rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'md', shape: 'pill' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant, size, shape, asChild, type = 'button', ...props },
    ref,
  ) {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size, shape }), className)}
        {...props}
      />
    );
  },
);

export { buttonVariants };
