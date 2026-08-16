import { Boxes, Home, ListChecks, RefreshCw } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { DevSessionSwitcher } from '@/components/dev/DevSessionSwitcher';
import { IconChip } from '@/components/factoryvision/IconChip';
import { SyncDot, type SyncState } from '@/components/layout/SyncDot';
import { useTerm, type TermKey } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * Field shell (UI Spec §2, §6.5) — operators, production, QC.
 *
 * Phones and tablets, gloves, dim or glaring warehouses. Four fixed bottom-nav
 * items, one task per flow, and never a layout that needs two hands.
 * Designed from 360px up.
 */

const NAV: { to: string; term: TermKey; icon: typeof Home; end?: boolean }[] = [
  { to: '/f', term: 'nav_home', icon: Home, end: true },
  { to: '/f/stock', term: 'nav_stock', icon: Boxes },
  { to: '/f/tasks', term: 'nav_tasks', icon: ListChecks },
  { to: '/f/sync', term: 'nav_sync', icon: RefreshCw },
];

export function FieldShell({ syncState = 'synced' }: { syncState?: SyncState }) {
  const t = useTerm();

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <DevSessionSwitcher />

      <main className="flex-1 pb-[calc(theme(height.bottomnav)+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>

      <nav
        aria-label={t('nav_home')}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex max-w-form">
          {NAV.map(({ to, term: key, icon: Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex h-bottomnav min-h-touch flex-col items-center justify-center gap-1 text-caption font-medium',
                    isActive ? 'text-primary' : 'text-text-secondary',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* A solid circle either way — the active one is the brand
                        fill, the rest are the muted fill. On a phone held at
                        arm's length in a warehouse a hue shift alone is not a
                        location, so the difference is fill AND weight. */}
                    <span className="relative">
                      <IconChip
                        icon={Icon}
                        tone={isActive ? 'brand' : 'soft'}
                        size="md"
                        className={cn(isActive && 'shadow-brand')}
                      />
                      {key === 'nav_sync' && (
                        <SyncDot state={syncState} className="absolute -right-0.5 top-0" />
                      )}
                    </span>
                    <span className={cn(isActive && 'font-semibold')}>{t(key)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
