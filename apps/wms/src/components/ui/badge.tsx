import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Badge — shadcn base, themed to Design System §5.3 + changelog v2.3, v5.0.
 *
 * **Badges are always solid**: full-strength status colour, no light-background
 * pairing, no matter how many are on screen. They are small enough not to
 * dominate, and a pale badge loses its at-a-glance reading on a phone in a dim
 * warehouse, which is the whole point of it (DS Principle 4).
 *
 * The light pairing is for large surfaces only. Do not invert this.
 *
 * v5.0 removed the blanket `text-white`. It was the reason every fill had to
 * be dragged down to a muddy ~30% lightness, and the one time it slipped, the
 * badge on every newly received item shipped at 1.92:1. Each variant now pairs
 * its fill with the palette's own `-on` foreground: white on red, blue and
 * violet; ink on green, amber and yellow.
 *
 * Badges are pill-shaped so they never read as a button.
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-semibold uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        success: 'bg-st-success text-st-success-on',
        warning: 'bg-st-warning text-st-warning-on',
        danger: 'bg-st-danger text-st-danger-on',
        destructive: 'bg-st-danger text-st-danger-on',
        info: 'bg-st-info text-st-info-on',
        maintenance: 'bg-st-maintenance text-st-maintenance-on',
        waiting: 'bg-st-waiting text-st-waiting-on',
        neutral: 'bg-st-neutral text-st-neutral-on',
        secondary: 'bg-st-neutral text-st-neutral-on',
        outline: 'border border-border bg-card text-text-primary',

        // Data accents — CATEGORY, never status. A product's item class is not
        // good or bad news, and colouring six categories with one grey badge
        // is the same as not colouring them at all.
        teal: 'bg-data-teal text-data-teal-on',
        violet: 'bg-data-violet text-data-violet-on',
        amber: 'bg-data-amber text-data-amber-on',
        rose: 'bg-data-rose text-data-rose-on',
        cyan: 'bg-data-cyan text-data-cyan-on',
        lime: 'bg-data-lime text-data-lime-on',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
