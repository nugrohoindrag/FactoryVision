import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Input — shadcn base, themed to Design System §5.1.
 *
 * Height comes from the density token (56px on touch), radius is 14px, and
 * the invalid state is a flat danger border rather than a translucent one.
 * Text stays at 16px on small screens: anything smaller makes iOS/Android
 * zoom on focus, and a warehouse screen that jumps while you type is worse
 * than a slightly larger field.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-input w-full rounded-input border border-border bg-card px-4 text-body text-text-primary',
          'placeholder:text-text-disabled',
          'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:bg-secondary disabled:text-text-disabled',
          'aria-[invalid=true]:border-st-danger',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
