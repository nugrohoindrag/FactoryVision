import { Ban, MoreVertical, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { EmptyState } from '@/components/layout/Screen';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from '@/components/ui/table';

/**
 * Shared frame for the master-data screens (K03–K05, K13).
 *
 * They differ in their columns and nothing else, so the search box, the
 * heading, the create button, and the three list states live here once. A
 * copy per screen is how four tables end up with four slightly different
 * empty states.
 *
 * Compact density: these are desktop screens read with a mouse (UI Spec D2).
 */
export function MasterLayout({
  title,
  description,
  query,
  onQueryChange,
  onCreate,
  createLabel,
  count,
  emptyTitle,
  emptyBody,
  children,
  loading,
}: {
  title: string;
  description: string;
  query: string;
  onQueryChange: (value: string) => void;
  onCreate?: () => void;
  createLabel: string;
  count: number | undefined;
  emptyTitle: string;
  emptyBody: string;
  children: ReactNode;
  loading: boolean;
}) {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-semibold text-text-primary">{title}</h1>
          <p className="pt-1 text-body-sm text-text-secondary">{description}</p>
        </div>
        {onCreate && (
          <Button onClick={onCreate}>
            <Plus aria-hidden />
            {createLabel}
          </Button>
        )}
      </header>

      <div className="relative max-w-md">
        <Search
          size={20}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by name or code"
          className="pl-12"
          aria-label={`Search ${title}`}
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-row w-full" />
          ))}
        </div>
      ) : count === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card shadow-1">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Table primitives for the master-data screens.
 *
 * These are now thin aliases over `components/ui/table`, not a second table
 * implementation. They used to be their own `<table>` with their own paddings,
 * which is how the products list and the variance report drifted apart despite
 * being the same object to the person reading them. The names are kept because
 * four screens call them and the call sites read better this way.
 */
export function MasterTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <Table minWidth="40rem">
      <TableHeader>
        <tr>{head}</tr>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return <TableHead>{children}</TableHead>;
}

/**
 * Create/edit dialog shared by the master-data screens.
 *
 * ## Deactivate, never delete
 *
 * Master data is referenced by an append-only movement log. Deleting a rack
 * that once held stock leaves every historical movement pointing at a place
 * that no longer exists — the stock card renders a blank where a location
 * should be, and nobody can tell whether that is a bug or a real gap.
 *
 * So the destructive action is `Deactivate`: the row stops being offered
 * anywhere new, and every past movement still resolves. PRD §9.3 already
 * required this for production locations; it applies to all master data for
 * the same reason.
 */
export function MasterFormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSave,
  saveDisabled,
  saving,
  /** Present only when editing something that already exists. */
  onToggleActive,
  active,
  deactivateHint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  onSave: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
  onToggleActive?: () => void;
  active?: boolean;
  deactivateHint?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {description && <p className="text-body-sm text-text-secondary">{description}</p>}

        <div className="space-y-4 py-2">{children}</div>

        <DialogFooter className="flex-col gap-3 sm:flex-row sm:justify-between">
          {onToggleActive ? (
            <div className="flex flex-col gap-1">
              <Button type="button" variant="outline" onClick={onToggleActive}>
                {active ? 'Deactivate' : 'Reactivate'}
              </Button>
              {active && deactivateHint && (
                <span className="text-caption text-text-secondary">{deactivateHint}</span>
              )}
            </div>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" loading={saving} disabled={saveDisabled} onClick={onSave}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Row action menu — the kebab at the end of every master-data row.
 *
 * UI Spec §5.1 already named `dropdown-menu` as the component for this and it
 * was skipped: the whole row was made clickable instead, which hides the
 * destructive action inside the edit dialog and gives no clue that a row is
 * interactive at all.
 *
 * ## Deactivate, not delete — and the menu says so
 *
 * Master data is referenced by an append-only movement log. Deleting a rack
 * that once held stock leaves every historical movement pointing at nothing,
 * and the stock card renders a blank where a place should be. So the
 * destructive item deactivates, the confirmation explains what that means, and
 * nothing in this product offers a hard delete for a referenced record.
 *
 * The confirmation exists because a destructive action sitting one click deep
 * in a menu is an action that gets hit by accident.
 */
export function RowActions({
  label,
  active,
  onEdit,
  onToggleActive,
  deactivateNote,
}: {
  /** Name of the thing being acted on — used in the menu label and the confirm. */
  label: string;
  active: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  deactivateNote?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${label}`}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden className="mr-2 size-4" />
            Edit
          </DropdownMenuItem>
          {active ? (
            <DropdownMenuItem
              // Danger foreground, no red fill: it is one item in a short menu,
              // not something that must be read across a room (§6.4).
              className="text-st-danger focus:text-st-danger"
              onSelect={() => setConfirming(true)}
            >
              <Ban aria-hidden className="mr-2 size-4" />
              Deactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onToggleActive}>
              <RotateCcw aria-hidden className="mr-2 size-4" />
              Reactivate
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops being offered anywhere new. Nothing is deleted — every past movement still
              resolves, which is why this product has no hard delete for a record history points
              at.
              {deactivateNote && ` ${deactivateNote}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onToggleActive();
                setConfirming(false);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** One labelled field. Keeps the four master forms visually identical. */
export function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-2 block">
        {label}
        {required && <span className="text-st-danger"> *</span>}
      </Label>
      {children}
      {hint && <p className="pt-1.5 text-body-sm text-text-secondary">{hint}</p>}
    </div>
  );
}

export function Td({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <TableCell className={muted ? 'text-text-secondary' : undefined}>{children}</TableCell>;
}
