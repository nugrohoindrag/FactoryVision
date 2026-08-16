import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Card — shadcn base, themed to Design System §5.2 with the colouring levels
 * from UI Spec §6.4 (as amended in v5.0).
 *
 * The levels are not a style choice. A solid fill takes attention, so if every
 * card is solid nothing stands out — and the one card that matters disappears
 * among the rest.
 *
 *   1 · neutral   white + hairline border          the default
 *   2 · accented  white + 3px status bar on left   status inside a list
 *   3 · solid     full status fill, white text     max ONE per screen
 *   4 · gradient  named gradient fill, white text  max ONE per screen, hero only
 *
 * Level 4 is new in v5.0 and is deliberately NOT a fifth status level: it
 * takes the same `status` prop and resolves to the same hue family, so the
 * meaning is identical to level 3 and the gradient is pure decoration. The
 * rule that a gradient never *carries* meaning is intact — remove the gradient
 * and the card still says the same thing in the same colour.
 *
 * Inside a list, always level 2. Twenty red-filled cards are unreadable.
 */
const cardVariants = cva(
  'relative rounded-card bg-card text-card-foreground shadow-1 transition-[box-shadow,transform,border-color] duration-DEFAULT ease-DEFAULT',
  {
    variants: {
      level: {
        neutral: 'border border-border',
        accented: 'border border-border border-l-[3px]',
        // The foreground comes from the status compound below, never from a
        // hard-coded `text-white`: the v5.0 fills are vivid, and white on
        // `st-warning` is 2.55:1.
        solid: 'border-transparent',
        gradient: 'overflow-hidden border-transparent shadow-2',
      },
      status: {
        none: '',
        success: '',
        warning: '',
        danger: '',
        info: '',
        neutral: '',
      },
      /**
       * `interactive` is opt-in because a card that lifts under the cursor is
       * promising a click. On a card that does nothing, that is a lie the
       * user only discovers by trying.
       */
      interactive: {
        true: 'cursor-pointer hover:-translate-y-0.5 hover:shadow-hover',
        false: '',
      },
    },
    compoundVariants: [
      // Level 2 — the status shows only as the left bar.
      { level: 'accented', status: 'success', class: 'border-l-st-success' },
      { level: 'accented', status: 'warning', class: 'border-l-st-warning' },
      { level: 'accented', status: 'danger', class: 'border-l-st-danger' },
      { level: 'accented', status: 'info', class: 'border-l-st-info' },
      { level: 'accented', status: 'neutral', class: 'border-l-st-neutral' },
      // Level 3 — the whole card carries the status, fill and foreground
      // together. Which one is white and which one is ink is a property of
      // the hue, decided once in the palette.
      { level: 'solid', status: 'none', class: 'bg-primary text-primary-foreground' },
      { level: 'solid', status: 'success', class: 'bg-st-success text-st-success-on' },
      { level: 'solid', status: 'warning', class: 'bg-st-warning text-st-warning-on' },
      { level: 'solid', status: 'danger', class: 'bg-st-danger text-st-danger-on' },
      { level: 'solid', status: 'info', class: 'bg-st-info text-st-info-on' },
      { level: 'solid', status: 'neutral', class: 'bg-st-neutral text-st-neutral-on' },
      // Level 4 — same hue family, rendered as a named gradient token. The
      // fallback `bg-st-*` underneath keeps the contrast guarantee if the
      // gradient fails to paint, and each gradient's endpoints were chosen so
      // this one foreground stays legible across the whole sweep.
      {
        level: 'gradient',
        status: 'none',
        class: 'bg-primary bg-gradient-brand text-primary-foreground',
      },
      {
        level: 'gradient',
        status: 'success',
        class: 'bg-st-success bg-gradient-success text-st-success-on',
      },
      {
        level: 'gradient',
        status: 'warning',
        class: 'bg-st-warning bg-gradient-warning text-st-warning-on',
      },
      {
        level: 'gradient',
        status: 'danger',
        class: 'bg-st-danger bg-gradient-danger text-st-danger-on',
      },
      { level: 'gradient', status: 'info', class: 'bg-st-info bg-gradient-info text-st-info-on' },
      { level: 'gradient', status: 'neutral', class: 'bg-st-neutral text-st-neutral-on' },
      // A lifted card needs a border that keeps up, or the hover reads as a
      // rendering glitch rather than a response.
      { level: 'neutral', interactive: true, class: 'hover:border-brand-300' },
    ],
    defaultVariants: { level: 'neutral', status: 'none', interactive: false },
  },
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, level, status, interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ level, status, interactive }), className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-start justify-between gap-3 p-card pb-3', className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-title font-semibold', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-body-sm text-text-secondary', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

/**
 * Stock shadcn hard-codes `pt-0` here because it assumes a CardHeader is
 * always above. Most cards in this product have no header, and those were
 * rendering with their content jammed against the top edge. The top padding
 * is now dropped only when something actually precedes it.
 */
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('relative p-card [&:not(:first-child)]:pt-0', className)}
      {...props}
    />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-3 p-card pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants };
