import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  Database,
  LayoutDashboard,
  Menu,
  Package,
  Search,
  Settings,
  User,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { DevSessionSwitcher } from '@/components/dev/DevSessionSwitcher';
import { IconChip, type IconChipProps } from '@/components/factoryvision/IconChip';
import { useTerm, type TermKey } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * Office shell (UI Spec §2, §6.5) — warehouse head and owner.
 *
 * PC and laptop with a mouse, `compact` density, information density over
 * input speed. Designed from 1440px down — but it must still work on the
 * tablet a warehouse head carries around the racks.
 */

interface NavGroup {
  term: TermKey;
  icon: typeof LayoutDashboard;
  /** A data accent, so the six sections are told apart by colour, not only
      by reading the label. Category, never status. */
  tone: IconChipProps['tone'];
  items: { to: string; term: TermKey; end?: boolean }[];
}

const GROUPS: NavGroup[] = [
  {
    term: 'nav_dashboard',
    icon: LayoutDashboard,
    tone: 'brand',
    items: [
      { to: '/o', term: 'screen_owner_dashboard', end: true },
      { to: '/o/open-issues', term: 'screen_open_issues_monitor' },
    ],
  },
  {
    term: 'nav_inventory',
    icon: Package,
    tone: 'teal',
    items: [
      { to: '/o/purchase-orders', term: 'screen_purchase_orders' },
      { to: '/o/task-board', term: 'screen_task_board' },
      { to: '/o/stock-take', term: 'screen_stock_take' },
      { to: '/o/variance', term: 'screen_variance_report' },
      { to: '/o/approvals', term: 'screen_approval_queue' },
    ],
  },
  {
    term: 'nav_operations',
    icon: ArrowLeftRight,
    tone: 'cyan',
    items: [{ to: '/o/shipments', term: 'screen_shipments' }],
  },
  {
    term: 'nav_reports',
    icon: BarChart3,
    tone: 'violet',
    items: [{ to: '/o/reports', term: 'screen_report_centre' }],
  },
  {
    term: 'nav_master_data',
    icon: Database,
    tone: 'amber',
    items: [
      { to: '/o/products', term: 'screen_products' },
      { to: '/o/bom', term: 'screen_bom' },
      { to: '/o/locations', term: 'screen_locations' },
      { to: '/o/partners', term: 'screen_partners' },
      { to: '/o/import', term: 'screen_import' },
    ],
  },
  {
    term: 'nav_settings',
    icon: Settings,
    tone: 'rose',
    items: [
      { to: '/o/users', term: 'screen_users_roles' },
      { to: '/o/configuration', term: 'screen_tenant_config' },
    ],
  },
];

export function OfficeShell() {
  const t = useTerm();
  // At `md` the sidebar collapses to a drawer — a warehouse head on a tablet
  // needs the content, not the chrome (DS §12.1).
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="flex">
        {/*
         * Two things about this element are load-bearing rather than stylistic.
         *
         * 1. It is a COLUMN. It used to be a plain block: the brand bar and the
         *    nav simply stacked, and once the nav grew past the viewport its
         *    last group ran off the bottom of a `fixed` element with nothing to
         *    scroll — Settings was unreachable on a 13" laptop. `flex flex-col`
         *    plus `min-h-0` on the scroller is the fix, and `min-h-0` is the
         *    half that is easy to lose: without it a flex child refuses to
         *    shrink below its content height, `overflow-y-auto` never engages,
         *    and the bug survives the obvious-looking patch.
         *
         * 2. It stays `fixed` at every width rather than switching to
         *    `sticky` on desktop. A sticky, `h-dvh` sidebar is only exactly
         *    the viewport when nothing sits above the shell — put a banner
         *    there (the internal build's role picker does) and the last 32px,
         *    footer included, hangs below the fold. Fixed positioning makes
         *    the sidebar's height independent of everything around it, and
         *    the content column reserves the space with `lg:pl-sidebar`.
         */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 flex h-dvh w-sidebar flex-col border-r border-border bg-card',
            'transition-transform duration-slow ease-DEFAULT',
            drawerOpen ? 'translate-x-0 shadow-3' : '-translate-x-full lg:translate-x-0',
          )}
        >
          <div className="flex h-topnav shrink-0 items-center gap-3 px-5">
            <IconChip icon={Boxes} tone="gradient" />
            <span className="text-title font-semibold tracking-tight text-text-primary">
              FactoryVision
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label={t('action_back')}
              className="ml-auto flex h-touch min-w-touch items-center justify-center rounded-btn text-text-secondary transition-colors hover:bg-secondary lg:hidden"
            >
              <X size={20} strokeWidth={2} aria-hidden />
            </button>
          </div>

          <nav
            className="fv-scroll fv-scroll-contain min-h-0 flex-1 overflow-y-auto px-3 pb-6"
            aria-label={t('nav_dashboard')}
          >
            {GROUPS.map((group) => (
              <div key={group.term} className="mb-5">
                <p className="flex items-center gap-2.5 px-3 pb-2 text-caption font-semibold uppercase tracking-wider text-text-secondary">
                  <IconChip icon={group.icon} tone={group.tone} size="sm" />
                  {t(group.term)}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={() => setDrawerOpen(false)}
                        className={({ isActive }) =>
                          cn(
                            'group relative flex min-h-touch items-center rounded-btn px-3 text-body-sm transition-colors duration-fast',
                            isActive
                              ? 'bg-accent font-semibold text-accent-foreground'
                              : 'text-text-primary hover:bg-secondary',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {/* The active marker is a shape, not only a tint —
                                a colour shift alone disappears on the washed-out
                                panel of a laptop tilted back on a desk. */}
                            <span
                              className={cn(
                                'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-gradient-brand transition-transform duration-DEFAULT ease-spring',
                                isActive ? 'scale-y-100' : 'scale-y-0',
                              )}
                              aria-hidden
                            />
                            {t(item.term)}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          {/* Pinned below the scroller, so it stays put however long the nav
              grows — the same flex column that fixed the overflow. */}
          <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-3">
            <IconChip icon={User} tone="brand" size="sm" />
            <p className="min-w-0 truncate text-caption text-text-secondary">FactoryVision · WMS</p>
          </div>
        </aside>

        {drawerOpen && (
          <button
            type="button"
            aria-label={t('action_back')}
            className="fixed inset-0 z-20 animate-fade bg-ink-950/40 backdrop-blur-[2px] lg:hidden"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        {/*
         * A spacer, not padding on the content.
         *
         * The sidebar is `fixed`, so it takes no space in flow and something
         * has to reserve its width. Doing that with a padding utility means
         * the entire desktop layout hangs on one class existing — and when it
         * does not, the failure is silent and total: the sidebar simply lies
         * on top of the page with the first 280px of every screen underneath
         * it. `w-sidebar` is the same token the sidebar itself is sized from,
         * so the two cannot disagree.
         */}
        <div className="hidden w-sidebar shrink-0 lg:block" aria-hidden />

        {/* The dev banner lives INSIDE the content column, not above the whole
            shell — a full-width strip above a fixed sidebar would be hidden
            behind it. */}
        <div className="min-w-0 flex-1">
          <DevSessionSwitcher />

          <header className="sticky top-0 z-10 flex h-topnav items-center gap-2 border-b border-border bg-card/85 px-4 backdrop-blur-md lg:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen((open) => !open)}
              aria-label={t('nav_dashboard')}
              className="flex h-touch min-w-touch items-center justify-center rounded-full lg:hidden"
            >
              <IconChip icon={Menu} tone="brand" size="md" />
            </button>

            <div className="flex-1" />

            {/* Every framed icon in the product is a solid circle — these are
                the same chip the sidebar and the dashboard use, so the top bar
                cannot drift into its own idea of what an icon button is. */}
            <button
              type="button"
              aria-label="Search"
              className="flex h-touch min-w-touch items-center justify-center rounded-full transition-transform duration-DEFAULT ease-spring hover:scale-105"
            >
              <IconChip icon={Search} tone="cyan" size="md" />
            </button>
            <button
              type="button"
              aria-label={t('screen_alerts')}
              className="flex h-touch min-w-touch items-center justify-center rounded-full transition-transform duration-DEFAULT ease-spring hover:scale-105"
            >
              <IconChip icon={Bell} tone="amber" size="md" />
            </button>
            <button
              type="button"
              aria-label={t('dev_role')}
              className="flex h-touch min-w-touch items-center justify-center rounded-full transition-transform duration-DEFAULT ease-spring hover:scale-105"
            >
              <IconChip icon={User} tone="violet" size="md" />
            </button>
          </header>

          <main className="mx-auto max-w-grid p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
