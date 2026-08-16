import { buildAlerts, formatMoney, lastMovementByProduct, todayLocal, type Alert } from '@fv/domain';
import { BellOff } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, ListState, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Card, CardContent } from '@/components/ui/card';
import { useBatches, useEventLog, useIssues, useProducts, useStock } from '@/db/hooks';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L26 · Alerts (UI Spec §18, PRD F11).
 *
 * **The priority order is locked** — overdue material issues, then stock take
 * variance, then below minimum, then expiring, then quarantine, then dead
 * stock. It is not sortable and not filterable by default, because the whole
 * point is that the most consequential thing is at the top whether or not
 * anyone wants to look at it.
 *
 * Only an overdue material issue renders red (level 2 accent). If six kinds of
 * alert all competed for red, none of them would mean anything within a week.
 */
export function Alerts() {
  const t = useTerm();
  const navigate = useNavigate();
  const config = useTenantConfig();

  const stock = useStock();
  const products = useProducts();
  const batches = useBatches();
  const issues = useIssues();
  const events = useEventLog();

  const alerts = useMemo(() => {
    if (!stock || !products || !batches || !issues || !events) return undefined;
    return buildAlerts({
      now: new Date(),
      today: todayLocal(),
      stock,
      products,
      batches,
      issues: [...issues.values()],
      config: config.defaults,
      lastMovement: lastMovementByProduct(events),
    });
  }, [stock, products, batches, issues, events, config.defaults]);

  return (
    <>
      <ScreenHeader title={t('screen_alerts')} back={false} />
      <OfflineNotice />

      <ScreenBody className="space-y-3">
        <ListState
          data={alerts}
          empty={
            <EmptyState
              icon={BellOff}
              title="Nothing needs your attention"
              body="Alerts appear here when an issue goes past its threshold, stock drops below minimum, or something is close to expiring."
            />
          }
        >
          {(items) =>
            items.map((alert: Alert) => (
              <button
                key={alert.id}
                type="button"
                onClick={() => alert.href && navigate(alert.href)}
                className="w-full text-left"
              >
                <Card
                  // Only the overdue-issue kind is allowed to carry red.
                  level={alert.severity === 'danger' ? 'accented' : 'neutral'}
                  status={alert.severity === 'danger' ? 'danger' : 'none'}
                  className="hover:bg-accent"
                >
                  <CardContent className="flex items-start justify-between gap-4 p-card">
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-semibold text-text-primary">{alert.title}</p>
                      <p className="pt-0.5 text-body-sm text-text-secondary">{alert.detail}</p>
                    </div>
                    {alert.value && (
                      <p className="shrink-0 text-body font-semibold tabular-nums text-text-primary">
                        {formatMoney(alert.value)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </button>
            ))
          }
        </ListState>
      </ScreenBody>
    </>
  );
}
