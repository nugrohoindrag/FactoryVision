import type { ItemClass } from '@fv/contracts';
import { add, addDays, buildAlerts, daysToExpiry, formatMoney, inventoryValue, issueAgeHours, lastMovementByProduct, movementSummary, mul, toLocalDate, totalQuantity, ZERO } from '@fv/domain';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Hourglass,
  PackageSearch,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconChip } from '@/components/factoryvision/IconChip';
import { StatCard } from '@/components/factoryvision/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { useBatches, useEventLog, useIssues, useProducts, useStock } from '@/db/hooks';
import { useOnline } from '@/hooks/useOnline';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { ITEM_CLASS_TONE, useItemClassLabel } from '@/lib/terms/itemClass';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/** Tailwind needs whole class names, so the accent map is spelled out once. */
const CLASS_BAR: Record<(typeof ITEM_CLASS_TONE)[ItemClass], string> = {
  teal: 'bg-data-teal',
  violet: 'bg-data-violet',
  amber: 'bg-data-amber',
  rose: 'bg-data-rose',
  cyan: 'bg-data-cyan',
  lime: 'bg-data-lime',
};

/**
 * K01 · Owner dashboard (UI Spec §18, PRD F12).
 *
 * Six cards, and **the order is fixed**. Card 1 is `Open material issues`,
 * always — it is the metric the whole product is judged on, and the spec is
 * blunt about why it may never be moved down for aesthetic reasons: hiding it
 * kills the core feature quietly.
 *
 * Card 1 is also the **only card on this screen allowed to be filled** (v5.0:
 * a gradient fill rather than a flat one, which is decoration — the hue and
 * the words are identical either way). It fills only while something is
 * actually overdue. The other five stay level 1. If everything were filled,
 * nothing would stand out.
 *
 * The colour on the remaining tiles is DATA accent, not status: five tiles in
 * five hues so the eye can find one, none of them claiming anything is wrong.
 * Red on this screen means overdue material issues and nothing else (D4).
 *
 * This screen must work on a phone (PRD: "one mobile screen, ≤5 min/day"),
 * which is why it is a single column that widens rather than a desktop grid
 * that shrinks.
 */
export function OwnerDashboard() {
  const t = useTerm();
  const navigate = useNavigate();
  const online = useOnline();
  const config = useTenantConfig();
  const classLabel = useItemClassLabel();

  const stock = useStock();
  const products = useProducts();
  const batches = useBatches();
  const issues = useIssues();
  const events = useEventLog();

  const data = useMemo(() => {
    if (!stock || !products || !batches || !issues || !events) return undefined;
    const now = new Date();
    const today = toLocalDate(now);
    const allIssues = [...issues.values()];

    /* 1 · Open material issues — count and value. */
    const open = allIssues.filter((i) => i.status !== 'CLOSED' && i.handedOverAt);
    const overdue = open.filter(
      (i) => issueAgeHours(i.handedOverAt!, now) >= config.defaults.issueOverdueHours,
    );
    const openValue = open.reduce((acc, issue) => {
      const lineValue = issue.lines.reduce((sum, line) => {
        const cost = products.find((p) => p.id === line.productId)?.averageCost;
        return cost ? add(sum, mul(line.issued, cost)) : sum;
      }, ZERO);
      return add(acc, lineValue);
    }, ZERO);

    /* 2 · Inventory value by class. */
    const value = inventoryValue(stock, products);

    /* 3 · Below minimum. */
    const tracked = products.filter((p) => p.minimumStock);
    const belowMinimum = tracked.filter((p) => {
      const onHand = totalQuantity(stock, { productId: p.id, status: 'AVAILABLE' });
      return Number(onHand) < Number(p.minimumStock);
    }).length;

    /* 4 · Expiring soon, by value. */
    const expiringValue = stock.reduce((acc, level) => {
      if (level.status !== 'AVAILABLE' || !level.batchId) return acc;
      const batch = batches.find((b) => b.id === level.batchId);
      const days = daysToExpiry(batch?.expiryDate, today);
      if (days === undefined || days < 0 || days > 30) return acc;
      const cost = products.find((p) => p.id === level.productId)?.averageCost;
      return cost ? add(acc, mul(level.quantity, cost)) : acc;
    }, ZERO);

    /* 5 · Movement over the last seven days. */
    const weekAgo = addDays(today, -7);
    const movement = movementSummary(events, products, weekAgo, today);
    const movedIn = movement.reduce((acc, row) => add(acc, row.quantityIn), ZERO);
    const movedOut = movement.reduce((acc, row) => add(acc, row.quantityOut), ZERO);

    /* 6 · Dead stock, highest value first. */
    const lastMovement = lastMovementByProduct(events);
    const deadStock = buildAlerts({
      now,
      today,
      stock,
      products,
      batches,
      issues: allIssues,
      config: config.defaults,
      lastMovement,
    })
      .filter((a) => a.kind === 'DEAD_STOCK')
      .slice(0, 5);

    return {
      openCount: open.length,
      openValue,
      overdueCount: overdue.length,
      value,
      belowMinimum,
      trackedCount: tracked.length,
      expiringValue,
      movedIn,
      movedOut,
      deadStock,
    };
  }, [stock, products, batches, issues, events, config.defaults]);

  if (!data) return null;

  const hasOverdue = data.overdueCount > 0;

  /* Proportions for the tile meters. These are glance aids, never precision —
     the digits above them are the number that matters. */
  const overdueShare = data.openCount > 0 ? data.overdueCount / data.openCount : 0;
  const belowMinimumShare =
    data.trackedCount > 0 ? data.belowMinimum / data.trackedCount : 0;
  const expiringShare =
    Number(data.value.total) > 0
      ? Number(data.expiringValue) / Number(data.value.total)
      : 0;

  const movedIn = Number(data.movedIn);
  const movedOut = Number(data.movedOut);
  const movedTotal = movedIn + movedOut;

  // Classes worth nothing are noise in a breakdown — a row of zeros reads as
  // a list of things that failed rather than a list of things you do not have.
  const classBreakdown = Object.entries(data.value.byClass).filter(
    ([, value]) => Number(value) > 0,
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-caption font-semibold uppercase tracking-wider text-text-secondary">
            {t('nav_dashboard')}
          </p>
          <h1 className="pt-1 text-h2 font-semibold tracking-tight text-text-primary">
            {t('screen_owner_dashboard')}
          </h1>
        </div>
        {!online && (
          // Never present stale numbers as if they were current (UI Spec §18).
          // Grey, not amber: working offline is the normal state in a
          // warehouse, and a warning colour here would stop people working.
          <p className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-body-sm text-text-secondary">
            <span className="h-2 w-2 rounded-full bg-st-neutral" aria-hidden />
            Offline — showing the last figures from this device
          </p>
        )}
      </header>

      {/* CARD 1 — never moves, and the only filled card on the screen.
          It is a BAND, not a tile: the headline metric on the left, the
          overdue verdict on the right. The previous version put the number in
          a narrow left column and the icon hard right, which left a third of
          the widest card on the screen empty. */}
      <button
        type="button"
        onClick={() => navigate('/o/open-issues')}
        className="group block w-full text-left"
      >
        <Card
          level={hasOverdue ? 'gradient' : 'neutral'}
          status={hasOverdue ? 'danger' : 'none'}
          interactive
          className={cn('fv-stagger overflow-hidden', hasOverdue && 'fv-hero-glow')}
        >
          <CardContent className="relative z-[1] flex flex-col gap-6 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <IconChip icon={Hourglass} size="lg" tone={hasOverdue ? 'onFill' : 'gradient'} />

              {/* Label and number are ONE block. Split apart — label up by the
                  icon, figure floating below — the number reads as unlabelled,
                  which on the metric the whole product is judged by is the one
                  thing it must never be.

                  When the card is filled it sets its own foreground from the
                  palette's `-on` token, so nothing here re-states a text
                  colour: that is how a filled card ends up with white text on
                  a fill white cannot sit on. */}
              <div className="min-w-0">
                <p className={cn('text-body-sm font-medium', !hasOverdue && 'text-text-secondary')}>
                  Open material issues
                </p>
                <p
                  className={cn(
                    'pt-1 text-display font-semibold leading-none tracking-tight tabular-nums',
                    !hasOverdue && 'text-text-primary',
                  )}
                >
                  {data.openCount}
                </p>
                <p
                  className={cn('pt-3 text-body', !hasOverdue && 'text-text-secondary')}
                >
                  {formatMoney(data.openValue)} of material on the production floor
                </p>
              </div>
            </div>

            {/* The verdict panel. On a wide screen it sits beside the number
                and fills the band; on a phone it stacks underneath. */}
            <div
              className={cn(
                'shrink-0 rounded-card p-card lg:w-[22rem]',
                hasOverdue ? 'bg-white/15' : 'bg-secondary',
              )}
            >
              {hasOverdue ? (
                <>
                  <p className="flex items-center gap-2.5 text-body-sm font-medium">
                    <span className="relative flex h-2.5 w-2.5" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-white" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                    </span>
                    Past {config.defaults.issueOverdueHours} hours
                  </p>
                  <p className="pt-2 text-h2 font-semibold leading-none tabular-nums">
                    {data.overdueCount}
                  </p>
                  <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/25" aria-hidden>
                    <div
                      className="h-full origin-left animate-grow-x rounded-full bg-white"
                      style={{ width: `${Math.round(overdueShare * 100)}%` }}
                    />
                  </div>
                  <span className="mt-4 flex items-center gap-1.5 text-body-sm font-semibold">
                    Review now
                    <ArrowRight
                      size={16}
                      strokeWidth={2.6}
                      aria-hidden
                      className="transition-transform duration-DEFAULT ease-spring group-hover:translate-x-1"
                    />
                  </span>
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2.5 text-body-sm font-medium text-text-primary">
                    <IconChip icon={CheckCircle2} tone="success" size="sm" />
                    Nothing overdue
                  </p>
                  <p className="pt-2 text-body-sm text-text-secondary">
                    Nothing has been open past {config.defaults.issueOverdueHours} hours.
                  </p>
                  <span className="mt-4 flex items-center gap-1.5 text-body-sm font-semibold text-primary">
                    Open the monitor
                    <ArrowRight
                      size={16}
                      strokeWidth={2.6}
                      aria-hidden
                      className="transition-transform duration-DEFAULT ease-spring group-hover:translate-x-1"
                    />
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </button>

      {/* Five tiles across three columns leaves a hole at the end of the
          second row, so the dead-stock list — the one tile that is a list and
          wants the width — spans two. Six slots, two clean rows at `xl`,
          three at `md`. */}
      {/* No `auto-rows-fr`: grid items already stretch to their own row, and
          forcing every row to the tallest one's height left the second row
          half empty. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* 2 · Total inventory value */}
        <StatCard
          index={1}
          tone="teal"
          icon={Wallet}
          label="Total inventory value"
          value={formatMoney(data.value.total)}
        >
          {classBreakdown.length === 0 && (
            <p className="pt-2 text-body-sm text-text-secondary">
              No costed stock yet. Values appear once items have an average cost and a receipt
              behind them.
            </p>
          )}
          {/* Each class keeps the hue it has everywhere else — the same colour
              as its badge on the products list. A breakdown that recolours the
              categories teaches the reader nothing they can reuse. */}
          <dl className="space-y-2 pt-4">
            {classBreakdown.map(([itemClass, classValue], i) => {
              const share =
                Number(data.value.total) > 0
                  ? Number(classValue) / Number(data.value.total)
                  : 0;
              return (
                <div key={itemClass} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-body-sm">
                    <dt className="flex min-w-0 items-center gap-2 text-text-secondary">
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          CLASS_BAR[ITEM_CLASS_TONE[itemClass as ItemClass]],
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{classLabel(itemClass as ItemClass)}</span>
                    </dt>
                    <dd className="shrink-0 font-medium tabular-nums text-text-primary">
                      {formatMoney(classValue)}
                    </dd>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
                    <div
                      className={cn(
                        'h-full origin-left animate-grow-x rounded-full',
                        CLASS_BAR[ITEM_CLASS_TONE[itemClass as ItemClass]],
                      )}
                      style={{
                        width: `${Math.round(share * 100)}%`,
                        animationDelay: `${i * 70}ms`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </dl>
        </StatCard>

        {/* 3 · Below minimum */}
        <StatCard
          index={2}
          tone={data.belowMinimum > 0 ? 'amber' : 'success'}
          icon={PackageSearch}
          label="Items below minimum"
          value={data.belowMinimum}
          hint="Production stops when one of these runs out."
          meter={belowMinimumShare}
        />

        {/* 4 · Expiring soon */}
        <StatCard
          index={3}
          tone="violet"
          icon={CalendarClock}
          label="Expiring within 30 days"
          value={formatMoney(data.expiringValue)}
          hint="Value that becomes a write-off if it is not used first."
          meter={expiringShare}
        />

        {/* 5 · Movement, 7 days */}
        <StatCard
          index={4}
          tone="cyan"
          icon={ArrowUpRight}
          label="Movement, last 7 days"
          value={
            <span className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <span className="flex items-baseline gap-1.5">
                <ArrowUpRight
                  size={20}
                  strokeWidth={2.6}
                  aria-hidden
                  className="translate-y-0.5 text-st-success"
                />
                <span className="text-st-success-fg">{data.movedIn}</span>
                <span className="text-body-sm font-normal text-text-secondary">in</span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <ArrowDownRight
                  size={20}
                  strokeWidth={2.6}
                  aria-hidden
                  className="translate-y-0.5 text-data-cyan"
                />
                <span>{data.movedOut}</span>
                <span className="text-body-sm font-normal text-text-secondary">out</span>
              </span>
            </span>
          }
        >
          {/* A single split bar, not two charts: what matters at a glance is
              whether the warehouse is filling up or draining. */}
          <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
            <div
              className="h-full origin-left animate-grow-x bg-st-success"
              style={{ width: `${movedTotal > 0 ? Math.round((movedIn / movedTotal) * 100) : 0}%` }}
            />
            <div
              className="h-full origin-left animate-grow-x bg-data-cyan"
              style={{
                width: `${movedTotal > 0 ? Math.round((movedOut / movedTotal) * 100) : 0}%`,
                animationDelay: '90ms',
              }}
            />
          </div>
        </StatCard>

        {/* 6 · Dead stock */}
        <StatCard
          index={5}
          tone="rose"
          icon={TrendingDown}
          label="Top dead stock"
          value={data.deadStock.length}
          className="md:col-span-2 xl:col-span-2"
        >
          {data.deadStock.length === 0 ? (
            <p className="pt-2 text-body-sm text-text-secondary">
              Nothing has been sitting still for more than {config.defaults.deadStockDays} days.
            </p>
          ) : (
            <ul className="divide-y divide-border pt-3">
              {data.deadStock.map((alert, i) => (
                <li
                  key={alert.id}
                  className="fv-stagger flex items-center justify-between gap-3 py-2 text-body-sm"
                  style={{ '--fv-i': i + 6 } as React.CSSProperties}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-data-rose text-caption font-semibold tabular-nums text-data-rose-on"
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 truncate text-text-primary">{alert.title}</span>
                  </span>
                  {alert.value && (
                    <span className="shrink-0 font-medium tabular-nums text-text-secondary">
                      {formatMoney(alert.value)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </StatCard>
      </div>
    </div>
  );
}
