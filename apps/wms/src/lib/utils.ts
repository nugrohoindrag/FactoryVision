import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * shadcn's class merger (DS §16.2) — taught this product's scales.
 *
 * ── Why this file is not a two-line re-export ───────────────────────────
 *
 * `twMerge` resolves a class to a conflict group by pattern. Out of the box it
 * only recognises Tailwind's own scales, so `text-<something-it-does-not-know>`
 * falls through to the TEXT-COLOUR group. Every role-named size in this design
 * system is exactly that:
 *
 *   cn('text-h2 font-semibold', 'text-text-primary')  →  'font-semibold text-text-primary'
 *
 * The size is not overridden by anything — it is silently DELETED, because
 * twMerge believes it just saw two competing colours and kept the later one.
 * That had flattened the whole product to one type size: the owner dashboard's
 * headline figure, the number the entire system is judged on, was rendering at
 * body size next to its own label. Nothing failed, nothing warned; the design
 * simply had no hierarchy left.
 *
 * Registering the scales below is what makes `cn()` safe to use with the
 * tokens. `font-size` is the one that was actively causing damage; the rest are
 * declared so a future `rounded-card` + `rounded-pill` or `p-card` + `p-6`
 * resolves by intent rather than by which one happens to sit later in the
 * generated stylesheet.
 *
 * Anything added to `tailwind-preset.js` under these keys belongs here too.
 * `cn.test.ts` fails if the two drift apart.
 */

/** DS §2.4 — role-named type scale. */
export const FONT_SIZES = [
  'display',
  'h1',
  'h2',
  'h3',
  'title',
  'body-lg',
  'body',
  'body-sm',
  'caption',
] as const;

/** DS §2.6 */
const RADII = ['sm', 'btn', 'input', 'card', 'modal', 'pill'] as const;

/** DS §3 — density-driven sizing. */
const CONTROL_SIZES = ['control', 'control-sm', 'control-lg', 'input', 'row', 'touch'] as const;
const SHELL_HEIGHTS = ['topnav', 'bottomnav'] as const;
const SHELL_WIDTHS = ['sidebar', 'sidebar-collapsed'] as const;

/** DS §2.8, §2.10 */
const SHADOWS = ['1', '2', '3', 'hover', 'brand', 'focus'] as const;
const DURATIONS = ['fast', 'slow', 'slower'] as const;

/**
 * Named gradients. These are background-IMAGES and must be declared as such,
 * or twMerge reads `bg-gradient-brand` as a background-colour and deletes the
 * `bg-primary` sitting next to it — which is exactly the pairing every filled
 * chip and hero card uses to guarantee a solid fallback under the gradient.
 * The result was a chip with no background at all.
 */
const GRADIENTS = [
  'gradient-brand',
  'gradient-danger',
  'gradient-success',
  'gradient-warning',
  'gradient-info',
  'gradient-surface',
  'gradient-sheen',
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
      'bg-image': [{ bg: [...GRADIENTS] }],
      rounded: [{ rounded: [...RADII] }],
      h: [{ h: [...CONTROL_SIZES, ...SHELL_HEIGHTS] }],
      'min-h': [{ 'min-h': ['touch', 'control'] }],
      w: [{ w: [...SHELL_WIDTHS, 'control', 'touch'] }],
      'min-w': [{ 'min-w': ['touch', 'btn'] }],
      'max-w': [{ 'max-w': ['grid', 'form'] }],
      p: [{ p: ['card'] }],
      px: [{ px: ['card'] }],
      py: [{ py: ['card'] }],
      pt: [{ pt: ['card'] }],
      pr: [{ pr: ['card'] }],
      pb: [{ pb: ['card'] }],
      pl: [{ pl: ['card', 'sidebar'] }],
      shadow: [{ shadow: [...SHADOWS] }],
      duration: [{ duration: [...DURATIONS] }],
      ease: [{ ease: ['spring'] }],
      animate: [
        { animate: ['rise', 'fade', 'pop', 'sheen', 'grow-x', 'grow-y', 'ping-soft', 'drift'] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
