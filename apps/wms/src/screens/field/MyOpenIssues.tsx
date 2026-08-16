import { issueAgeHours } from '@fv/domain';
import { CheckCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/app/session';
import { MaterialIssueCard } from '@/components/factoryvision/MaterialIssueCard';
import { EmptyState, ListState, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { useIssues } from '@/db/hooks';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L17 · My open issues (UI Spec §12).
 *
 * Purpose, stated plainly in the spec: **make production FEEL the issues they
 * have not closed.** Sorted by age descending, so the oldest debt is the
 * first thing seen, and anything past 24 hours carries a red left bar.
 *
 * That bar is level 2, never a filled card. Twenty solid red cards would be
 * unreadable and the worst one would vanish among them (UI Spec §6.4).
 *
 * The empty state is written to feel like an achievement rather than an
 * absence — it is the state the whole product is trying to produce.
 */
export function MyOpenIssues() {
  const t = useTerm();
  const navigate = useNavigate();
  const issues = useIssues();
  const config = useTenantConfig();
  const user = useSession((s) => s.user);

  const mine = useMemo(() => {
    if (!issues) return undefined;
    const now = new Date();
    return [...issues.values()]
      .filter((issue) => issue.status !== 'CLOSED' && issue.handedOverAt)
      .filter((issue) => issue.requestedBy === user.id || user.role === 'WAREHOUSE_HEAD')
      .map((issue) => ({
        issue,
        ageHours: issueAgeHours(issue.handedOverAt!, now),
      }))
      .sort((a, b) => b.ageHours - a.ageHours);
  }, [issues, user]);

  return (
    <>
      <ScreenHeader title={t('screen_my_open_issues')} back={false} />
      <OfflineNotice />

      <ScreenBody className="space-y-3">
        <ListState
          data={mine}
          empty={
            <EmptyState
              icon={CheckCircle2}
              title="All issues closed"
              body="Nothing outstanding. Every material you took has been accounted for."
            />
          }
        >
          {(items) =>
            items.map(({ issue, ageHours }) => (
              <MaterialIssueCard
                key={issue.issueId}
                workOrderNo={issue.workOrderNo ?? issue.issueId.slice(0, 8)}
                status={issue.status}
                ageHours={ageHours}
                materialCount={issue.lines.length}
                overdueHours={config.defaults.issueOverdueHours}
                onClick={() => navigate(`/f/issues/${issue.issueId}/close`)}
              />
            ))
          }
        </ListState>
      </ScreenBody>
    </>
  );
}
