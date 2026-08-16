import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Tabs — shadcn base, themed to the design system.
 *
 * This file was stock shadcn and had never been re-themed, which produced two
 * separate failures on the tenant-configuration screen:
 *
 * 1. **The selected tab was invisible.** Stock marks it with
 *    `data-[state=active]:bg-background` sitting on a `bg-muted` list. In this
 *    palette that is ink-100 on ink-200 — 2.6% apart in lightness, plus a
 *    hairline shadow. On the screen where a tenant renames every term in the
 *    product, nobody could tell which of six tabs they were on. The selected
 *    tab is now a solid brand pill with white text: 6.44:1 against its own
 *    label and unmistakable against its neighbours.
 *
 * 2. **A stray vertical scrollbar.** The list was locked to `h-10` (40px)
 *    while the triggers carry `min-h-touch`, which is 48px at touch density.
 *    The taller children overflowed the shorter parent, and because the call
 *    site set `overflow-x-auto`, the y axis became `auto` as well and the
 *    browser drew a scrollbar down the side of a single row of tabs. The list
 *    now takes its height from its children.
 *
 * Horizontal scrolling lives here rather than at the call sites: six tabs
 * that wrap become a three-row block that pushes the actual settings below
 * the fold (UI Spec §22.3 — a wide strip scrolls inside itself, the page
 * never scrolls sideways).
 */

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'fv-scroll flex w-full items-center justify-start gap-1 rounded-btn bg-secondary p-1',
      // `overflow-y-hidden` is load-bearing: with only `overflow-x-auto` the
      // y axis computes to `auto` too, and any child a pixel taller than the
      // row draws a scrollbar.
      'overflow-x-auto overflow-y-hidden overscroll-x-contain',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex min-h-touch shrink-0 items-center justify-center whitespace-nowrap rounded-btn px-4 text-body-sm font-medium',
      'text-text-secondary transition-colors duration-fast ease-DEFAULT',
      'hover:bg-accent hover:text-accent-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      // Selected: a solid brand pill. Not a tint, not a shadow — the two
      // things that vanish on a laptop panel tilted back on a desk.
      'data-[state=active]:bg-primary data-[state=active]:font-semibold data-[state=active]:text-primary-foreground data-[state=active]:shadow-brand',
      'data-[state=active]:hover:bg-primary-hover data-[state=active]:hover:text-primary-foreground',
      // Disabled is a flat token, never `opacity-50` — alpha changes with
      // whatever sits behind it and disappears in glare (UI Spec §6.4).
      'disabled:pointer-events-none disabled:text-text-disabled',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
