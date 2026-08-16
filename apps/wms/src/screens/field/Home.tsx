import type { Role } from '@fv/contracts';
import { issueAgeHours } from '@fv/domain';
import {
  ArrowRight,
  ClipboardCheck,
  ClipboardList,
  ListChecks,
  PackagePlus,
  PackageSearch,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Truck,
  Warehouse,
} from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/app/session';
import { IconChip } from '@/components/factoryvision/IconChip';
import { OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Card, CardContent } from '@/components/ui/card';
import { useIssues, useStock } from '@/db/hooks';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm, type TermKey } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * L02 · Home (UI Spec §7).
 *
 * Gets someone to today's work in one tap. At most five full-width cards,
 * chosen by role — a warehouse operator and a production worker share nothing
 * on this screen, and showing them each other's tasks is how a home screen
 * becomes a menu nobody reads.
 *
 * Badges carry **numbers, not dots**: "3 waiting" is actionable, a dot is not.
 * A card with work older than 24 hours takes a red left bar (level 2) — the
 * same signal as an overdue material issue, for the same reason.
 */

interface ActionCard {
  key: string;
  titleKey: TermKey;
  description: string;
  icon: typeof PackagePlus;
  to: string;
  count?: number;
  overdue?: boolean;
}

const ROLE_CARDS: Record<Role, string[]> = {
  OPERATOR: ['receive', 'prepare', 'putaway', 'ship', 'stocktake'],
  PRODUCTION: ['request', 'mine', 'return', 'output'],
  QC: ['inspect'],
  WAREHOUSE_HEAD: ['receive', 'prepare', 'putaway', 'inspect', 'adjust'],
  OWNER: ['mine', 'adjust'],
};

export function Home() {
  const t = useTerm();
  const navigate = useNavigate();
  const role = useSession((s) => s.user.role);
  const user = useSession((s) => s.user);
  const config = useTenantConfig();

  const stock = useStock();
  const issues = useIssues();

  const counts = useMemo(() => {
    const now = new Date();
    const awaitingInspection =
      stock?.filter((l) => l.status === 'AWAITING INSPECTION').length ?? 0;
    const awaitingPutaway =
      stock?.filter(
        (l) => l.status === 'AVAILABLE' && l.locationId === config.receivingLocationId,
      ).length ?? 0;

    const all = [...(issues?.values() ?? [])];
    const toPrepare = all.filter((i) => !i.prepared && i.status === 'OPEN').length;
    const mine = all.filter(
      (i) => i.status !== 'CLOSED' && i.handedOverAt && i.requestedBy === user.id,
    );
    const mineOverdue = mine.some(
      (i) => issueAgeHours(i.handedOverAt!, now) >= config.defaults.issueOverdueHours,
    );

    return {
      awaitingInspection,
      awaitingPutaway,
      toPrepare,
      mine: mine.length,
      mineOverdue,
    };
  }, [stock, issues, user.id, config]);

  const ALL_CARDS: Record<string, ActionCard> = {
    receive: {
      key: 'receive',
      titleKey: 'goods_receipt',
      description: 'A delivery has arrived',
      icon: PackagePlus,
      to: '/f/receipts/new',
    },
    inspect: {
      key: 'inspect',
      titleKey: 'inspection',
      description: 'Pass, hold, or reject what arrived',
      icon: ClipboardCheck,
      to: '/f/inspection',
      count: counts.awaitingInspection,
    },
    putaway: {
      key: 'putaway',
      titleKey: 'putaway',
      description: 'Give goods a rack',
      icon: Warehouse,
      to: '/f/putaway',
      count: counts.awaitingPutaway,
    },
    prepare: {
      key: 'prepare',
      titleKey: 'screen_issue_queue',
      description: 'Production is waiting on material',
      icon: ClipboardList,
      to: '/f/tasks',
      count: counts.toPrepare,
    },
    request: {
      key: 'request',
      titleKey: 'material_issue',
      description: 'Ask the warehouse for material',
      icon: Send,
      to: '/f/issues/request',
    },
    mine: {
      key: 'mine',
      titleKey: 'screen_my_open_issues',
      description: 'Close what you have taken',
      icon: ListChecks,
      to: '/f/issues/mine',
      count: counts.mine,
      overdue: counts.mineOverdue,
    },
    return: {
      key: 'return',
      titleKey: 'material_return',
      description: 'Send leftovers back to the rack',
      icon: RotateCcw,
      to: '/f/issues/mine',
    },
    output: {
      key: 'output',
      titleKey: 'production_receipt',
      description: 'Hand finished goods to the warehouse',
      icon: PackageSearch,
      to: '/f/production/output',
    },
    ship: {
      key: 'ship',
      titleKey: 'pick_list',
      description: 'Pick and load an order',
      icon: Truck,
      to: '/f/shipments/current/pick',
    },
    stocktake: {
      key: 'stocktake',
      titleKey: 'stock_take',
      description: 'Count what is on the racks',
      icon: ListChecks,
      to: '/f/stock-take/current/count',
    },
    adjust: {
      key: 'adjust',
      titleKey: 'stock_adjustment',
      description: 'Correct a figure, with a reason',
      icon: SlidersHorizontal,
      to: '/f/adjustments/new',
    },
  };

  const cards = ROLE_CARDS[role].map((key) => ALL_CARDS[key]!).filter(Boolean);
  const nothingWaiting = cards.every((card) => !card.count);

  return (
    <>
      <ScreenHeader title={t('screen_home')} subtitle={user.name} back={false} />
      <OfflineNotice />

      <ScreenBody className="space-y-3">
        {nothingWaiting && (
          <p className="pb-2 text-body-sm text-text-secondary">
            Nothing waiting. Tap {t('goods_receipt')} when a delivery arrives.
          </p>
        )}

        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => navigate(card.to)}
            className="group w-full text-left"
          >
            <Card
              level={card.overdue ? 'accented' : 'neutral'}
              status={card.overdue ? 'danger' : 'none'}
              className="transition-colors group-hover:border-brand-300 group-active:bg-accent"
            >
              <CardContent className="flex items-center gap-4 p-card">
                {/* The icon sits in a solid circle rather than floating naked
                    beside the text — it gives the row a fixed optical anchor
                    so a column of cards scans down cleanly, and a solid fill
                    survives glare in a way a pale tint does not. */}
                <IconChip
                  icon={card.icon}
                  size="lg"
                  tone={card.overdue ? 'danger' : 'gradient'}
                  className="group-hover:scale-105"
                />

                <div className="min-w-0 flex-1">
                  <p className="text-title font-semibold text-text-primary">{t(card.titleKey)}</p>
                  <p className="truncate pt-0.5 text-body-sm text-text-secondary">
                    {card.description}
                  </p>
                </div>

                {/* A number, never a dot — the operator needs to know how many. */}
                {card.count !== undefined && card.count > 0 && (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-1 text-body-sm font-semibold tabular-nums',
                      card.overdue
                        ? 'bg-st-danger text-st-danger-on'
                        : 'bg-primary text-primary-foreground',
                    )}
                  >
                    {card.count}
                  </span>
                )}

                <IconChip
                  icon={ArrowRight}
                  tone="brand"
                  size="sm"
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </CardContent>
            </Card>
          </button>
        ))}
      </ScreenBody>
    </>
  );
}
