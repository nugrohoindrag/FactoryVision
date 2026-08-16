import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Button — shadcn base, themed to Design System §5.1 and §5.6.
 *
 * Three deliberate departures from stock shadcn:
 *
 * 1. **Height comes from the density token**, not a fixed `h-10`. A 40px
 *    button is unusable with gloves; `touch` density makes it 52px (DS §3).
 * 2. **Disabled is never `opacity-50`.** Alpha changes appearance depending on
 *    what is behind it, and in a glaring warehouse the difference disappears
 *    entirely — so disabled uses flat tokens instead (UI Spec §6.4).
 * 3. **Loading keeps the button's width**, replacing the label with a spinner,
 *    so the layout never jumps mid-tap (DS §11).
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-btn text-body-sm font-medium transition-colors duration-DEFAULT ease-DEFAULT focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:bg-secondary disabled:text-text-disabled disabled:border-transparent [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Flat fill, never a gradient (UI Spec §6.4)
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-st-danger-fg',
        outline: 'border border-border bg-card text-text-primary hover:bg-secondary',
        secondary: 'bg-secondary text-text-primary hover:bg-ink-300',
        ghost: 'text-primary hover:bg-accent',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-control min-w-btn px-6 [&_svg]:size-5',
        sm: 'h-control-sm px-4 [&_svg]:size-4',
        lg: 'h-control-lg min-w-btn px-8 text-body [&_svg]:size-5',
        icon: 'h-control w-control min-w-touch [&_svg]:size-5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {/* Label stays in the flow but invisible, so the width never changes. */}
            <span className="invisible contents">{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
