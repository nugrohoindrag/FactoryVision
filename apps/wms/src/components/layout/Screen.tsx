import { ArrowLeft, CloudOff, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { IconChip } from '@/components/factoryvision/IconChip';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOnline } from '@/hooks/useOnline';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * Screen scaffolding — the four mandatory states of UI Spec §6.2 in one place.
 *
 * Points 5 and 6 of the Definition of Done (offline state, empty state) are
 * the ones most often skipped, and a screen designed only "full of data and
 * online" fails in every customer's first two days. Putting them here makes
 * them the default rather than an act of discipline.
 */

/* ------------------------------------------------------------------ header */

export function ScreenHeader({
  title,
  subtitle,
  back = true,
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  back?: boolean;
  action?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const t = useTerm();

  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-2 py-2.5">
      {back && (
        <button
          type="button"
          className="flex h-touch w-touch shrink-0 items-center justify-center rounded-full transition-transform duration-DEFAULT ease-spring active:scale-95"
          onClick={() => navigate(-1)}
          aria-label={t('action_back')}
        >
          <IconChip icon={ArrowLeft} tone="brand" size="md" />
        </button>
      )}
      <div className={cn('min-w-0 flex-1', !back && 'pl-2')}>
        <h1 className="truncate text-title font-semibold text-text-primary">{title}</h1>
        {subtitle && (
          <p className="truncate pt-0.5 text-body-sm text-text-secondary">{subtitle}</p>
        )}
      </div>
      {action}
    </header>
  );
}

/* -------------------------------------------------------------------- body */

/** Template C (DS §12.2): single column, ~640px reading width, sticky actions. */
export function ScreenBody({
  children,
  className,
  width = 'form',
}: {
  children: React.ReactNode;
  className?: string;
  width?: 'form' | 'full';
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full p-4',
        width === 'form' ? 'max-w-form' : 'max-w-grid',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Sticky bottom action bar. One primary action per screen (DS §11); secondary
 * actions sit beside it, never competing for the same weight.
 */
export function ActionBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 mx-auto flex w-full max-w-form gap-3 border-t border-border bg-card p-4',
        'pb-[calc(1rem+env(safe-area-inset-bottom))]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ states */

/**
 * Empty state — an invitation, not an apology (DS §13).
 * Every new factory sees every screen empty on day one.
 */
export function EmptyState({
  title,
  body,
  action,
  icon: Icon,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ size?: string | number; className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {/* The icon sits in a solid circle. A floating glyph on an empty screen
          reads as an error; a contained mark reads as a state. The circle is
          brand-toned rather than grey — an empty screen on day one is normal,
          and a grey disc makes it look broken. */}
      {Icon && <IconChip icon={Icon as LucideIcon} tone="gradient" size="xl" className="mb-4" />}
      <h2 className="text-title font-semibold text-text-primary">{title}</h2>
      <p className="max-w-[34ch] pt-2 text-body-sm leading-relaxed text-text-secondary">{body}</p>
      {action && <div className="pt-6">{action}</div>}
    </div>
  );
}

/** Loading — skeletons, never spinners, and the layout size must not shift. */
export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border" aria-busy aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-row items-center gap-3 px-4 py-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Error — what happened, and how to recover. Never a raw exception (DS §13). */
export function ErrorState({
  title,
  body,
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  const t = useTerm();
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <h2 className="text-title font-semibold text-text-primary">
        {title ?? t('error_generic_title')}
      </h2>
      <p className="max-w-form pt-2 text-body-sm text-text-secondary">
        {body ?? t('error_generic_body')}
      </p>
      {onRetry && (
        <Button className="mt-6" onClick={onRetry}>
          {t('action_retry')}
        </Button>
      )}
    </div>
  );
}

/**
 * Offline notice.
 *
 * Tone is the whole point (D3): working offline is the NORMAL state in a
 * warehouse, so this is a calm grey statement of fact, not a warning. A red
 * banner here would make operators stop working while the system is fine.
 */
export function OfflineNotice({ message }: { message?: string }) {
  const online = useOnline();
  const t = useTerm();
  if (online) return null;

  return (
    <div className="flex items-center gap-2.5 bg-secondary px-4 py-2 text-body-sm text-text-secondary">
      <IconChip icon={CloudOff} tone="soft" size="sm" />
      <span>{message ?? t('offline_working')}</span>
    </div>
  );
}

/**
 * Chooses between loading / empty / content for a Dexie-backed list.
 * `undefined` means still loading; `[]` means genuinely empty.
 */
export function ListState<T>({
  data,
  empty,
  children,
  skeletonRows,
}: {
  data: T[] | undefined;
  empty: React.ReactNode;
  children: (items: T[]) => React.ReactNode;
  skeletonRows?: number;
}) {
  if (data === undefined) return <LoadingRows rows={skeletonRows} />;
  if (data.length === 0) return <>{empty}</>;
  return <>{children(data)}</>;
}
