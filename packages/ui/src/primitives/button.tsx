import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

// Button — used everywhere. Keep variants small and opinionated; the
// styleguide is the contract. KKU Cardinal (accent) is used only for
// the single primary CTA per view; use `outline` or `ghost` for the rest.
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md',
    'font-medium text-sm',
    'transition-[background-color,color,border-color,box-shadow] duration-fast ease-standard',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active',
        default:
          'bg-surface-1 text-text-primary border border-border-default hover:bg-surface-2',
        outline:
          'bg-transparent text-text-primary border border-border-default hover:bg-surface-1',
        ghost: 'bg-transparent text-text-primary hover:bg-surface-1',
        subtle: 'bg-surface-2 text-text-primary hover:bg-surface-3',
        danger:
          'bg-danger text-accent-fg hover:opacity-90 focus-visible:ring-danger',
        link: 'bg-transparent text-accent-default underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 px-2 text-xs',
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-base',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant, size, asChild, type = 'button', ...props },
    ref,
  ) {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);

export { buttonVariants };
