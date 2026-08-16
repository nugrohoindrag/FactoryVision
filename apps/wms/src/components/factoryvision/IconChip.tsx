import type { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * IconChip — every framed icon in the product (DS §5.4).
 *
 * Before this existed, each screen framed its own icons: a rounded square
 * here, a tinted disc there, a bare glyph somewhere else, in whatever size
 * the author happened to type. That inconsistency is most of what made the
 * interface read as unfinished.
 *
 * The frame is a **solid circle**, always. Two reasons it is not a tinted
 * one:
 *
 *   1. A pale tint on a pale card has almost no edge, so at a glance the icon
 *      floats rather than sits — and in warehouse glare the tint disappears
 *      completely.
 *   2. Solid means the foreground is a decided colour, not whatever the icon
 *      inherited. Every tone below pairs its fill with the palette's own
 *      `-on` token, so contrast is guaranteed by construction rather than by
 *      whoever wrote the className.
 *
 * `tone` is a DATA accent unless it is one of the four status tones. Reaching
 * for `danger` because red looks good is how the one red thing that matters
 * stops being noticed (UI Spec D4).
 */

const chipVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-full transition-transform duration-DEFAULT ease-spring',
  {
    variants: {
      tone: {
        brand: 'bg-primary text-primary-foreground',
        success: 'bg-st-success text-st-success-on',
        warning: 'bg-st-warning text-st-warning-on',
        danger: 'bg-st-danger text-st-danger-on',
        info: 'bg-st-info text-st-info-on',
        waiting: 'bg-st-waiting text-st-waiting-on',
        /**
         * The quiet chip: a light SOLID brand fill, not a grey one.
         *
         * Something has to recede — an inactive tab, a "not permitted" cell, a
         * back arrow — but reaching for slate to do it puts grey back into an
         * interface that was deliberately built without any. This is still a
         * filled circle, still on the brand hue, just low-contrast against the
         * page. 11.66:1 between fill and glyph.
         */
        soft: 'bg-accent text-accent-foreground',
        /** True absence of status. Prefer `soft` for anything merely quiet. */
        neutral: 'bg-st-neutral text-st-neutral-on',
        teal: 'bg-data-teal text-data-teal-on',
        violet: 'bg-data-violet text-data-violet-on',
        amber: 'bg-data-amber text-data-amber-on',
        rose: 'bg-data-rose text-data-rose-on',
        cyan: 'bg-data-cyan text-data-cyan-on',
        lime: 'bg-data-lime text-data-lime-on',
        /** Decorative only — the brand gradient, never carrying meaning. */
        gradient: 'bg-primary bg-gradient-brand text-primary-foreground shadow-brand',
        /** For a chip sitting ON a filled surface, where a fill would clash. */
        onFill: 'bg-white/20 text-white',
      },
      size: {
        sm: 'h-7 w-7',
        md: 'h-9 w-9',
        lg: 'h-11 w-11',
        xl: 'h-14 w-14',
      },
    },
    defaultVariants: { tone: 'brand', size: 'md' },
  },
);

const GLYPH: Record<NonNullable<VariantProps<typeof chipVariants>['size']>, number> = {
  sm: 14,
  md: 18,
  lg: 22,
  xl: 26,
};

export interface IconChipProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof chipVariants> {
  icon: LucideIcon;
}

export function IconChip({ icon: Icon, tone, size = 'md', className, ...props }: IconChipProps) {
  return (
    <span className={cn(chipVariants({ tone, size }), className)} aria-hidden {...props}>
      <Icon size={GLYPH[size ?? 'md']} strokeWidth={2.2} />
    </span>
  );
}

export { chipVariants };
