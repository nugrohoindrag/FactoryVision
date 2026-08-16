import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Table — shadcn base, themed to Design System §5.5 and the density tokens.
 *
 * This file used to be stock shadcn and was imported by nothing: it carried
 * `text-sm`, `h-12` and `p-4`, none of which are tokens, so it could not pass
 * the design audit and every screen quietly hand-rolled its own `<table>`
 * instead. Nine tables, nine slightly different sets of paddings — the header
 * of the variance report and the header of the products list are the same
 * object in the user's head and were not the same object in the code.
 *
 * The re-theme keeps the shadcn API so the migration is mechanical:
 *
 *   - Row height follows `--size-row`, so a tablet gets 60px and a mouse 40px
 *     (DS §3). This is the whole reason the stock `h-12` had to go.
 *   - A wide table scrolls INSIDE its own container; the page never scrolls
 *     sideways (UI Spec §22.3). `min-w` belongs on the table, not the wrapper.
 *   - `sticky` on the header is opt-in, and only does anything when the
 *     table's own wrapper is what scrolls vertically. On a page-scrolled
 *     table it is inert — the wrapper is the nearest scroll container, so
 *     there is nothing for the header to stick to.
 */

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { minWidth?: string }
>(({ className, minWidth, style, ...props }, ref) => (
  // `overflow-x-auto overflow-y-hidden`, never `overflow-auto`.
  //
  // The same trap `TabsList` already documents: with the y axis left to
  // compute, the wrapper becomes a vertical scroll container too. Paired with
  // the `overscroll-behavior: contain` that used to sit in `.fv-scroll`, that
  // swallowed every wheel event the moment the pointer crossed a table — the
  // page simply stopped scrolling, on screens that are mostly table.
  //
  // `overscroll-x-contain` is kept deliberately: it stops a sideways trackpad
  // flick inside a wide table from triggering browser back-navigation, which
  // loses whatever the person was half-way through entering.
  <div className="fv-scroll relative w-full overflow-x-auto overflow-y-hidden overscroll-x-contain">
    <table
      ref={ref}
      className={cn('w-full border-collapse text-body-sm', className)}
      style={{ minWidth, ...style }}
      {...props}
    />
  </div>
));
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }
>(({ className, sticky = false, ...props }, ref) => (
  // Brand blue, not a neutral tint. A header band the same value as the rows
  // makes a long table read as one undifferentiated block; the reader loses
  // which column they are in halfway down a 300-row variance report. White on
  // `--primary` is 8.80:1, so the column names stay the most legible text on
  // the screen rather than the least.
  <thead
    ref={ref}
    className={cn(
      'bg-primary text-left text-primary-foreground',
      sticky && 'sticky top-0 z-[1]',
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
  // Deliberately NOT stock shadcn's `[&_tr:last-child]:border-0`. That rule
  // assumes every row is a TableRow drawing a bottom border; several screens
  // still pass their own `<tr>` with `border-t`, and the descendant selector
  // would strip the last one's separator instead. TableRow handles its own
  // last-row case below, where it knows which edge it drew.
>(({ className, ...props }, ref) => <tbody ref={ref} className={className} {...props} />);
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t border-border bg-secondary font-semibold', className)}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border transition-colors duration-fast last:border-b-0 hover:bg-accent data-[state=selected]:bg-accent',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    // No colour of its own — it inherits the header band's foreground, so the
    // two can never drift apart.
    className={cn('h-row whitespace-nowrap px-4 text-left align-middle font-semibold', className)}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('px-4 py-3 align-middle text-text-primary', className)} {...props} />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-body-sm text-text-secondary', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
