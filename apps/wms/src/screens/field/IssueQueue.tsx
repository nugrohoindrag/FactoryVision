import { issueAgeHours } from '@fv/domain';
import { ClipboardList } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MaterialIssueCard } from '@/components/factoryvision/MaterialIssueCard';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ListState, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { useIssues } from '@/db/hooks';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L14 · Issue queue (UI Spec §11).
 *
 * What the warehouse has been asked to prepare. Oldest request first — a
 * production line waiting on material is a line that stops.
 *
 * A request nobody has touched carries a `NEW` badge, so a queue that is
 * being worked looks different at a glance from one that is not.
 */
export function IssueQueue() {
  const t = useTerm();
  const navigate = useNavigate();
  const issues = useIssues();
  const config = useTenantConfig();

  const queue = useMemo(() => {
    if (!issues) return undefined;
    const now = new Date();
    return [...issues.values()]
      .filter((issue) => !issue.prepared && issue.status === 'OPEN')
      .map((issue) => ({
        issue,
        ageHours: issue.requestedAt ? issueAgeHours(issue.requestedAt, now) : 0,
      }))
      .sort((a, b) => b.ageHours - a.ageHours);
  }, [issues]);

  return (
    <>
      <ScreenHeader title={t('screen_issue_queue')} back={false} />
      <OfflineNotice />

      <ScreenBody className="space-y-3">
        <ListState
          data={queue}
          empty={
            <EmptyState
              icon={ClipboardList}
              title="Nothing to prepare"
              body="Requests from the production floor appear here the moment they are sent."
            />
          }
        >
          {(items) =>
            items.map(({ issue, ageHours }) => (
              <div key={issue.issueId} className="relative">
                {ageHours < 1 && (
                  <Badge variant="info" className="absolute right-3 top-3 z-10">
                    New
                  </Badge>
                )}
                <MaterialIssueCard
                  workOrderNo={issue.workOrderNo ?? issue.issueId.slice(0, 8)}
                  status={issue.status}
                  ageHours={ageHours}
                  materialCount={issue.lines.length}
                  overdueHours={config.defaults.issueOverdueHours}
                  onClick={() => navigate(`/f/issues/${issue.issueId}/prepare`)}
                />
              </div>
            ))
          }
        </ListState>
      </ScreenBody>
    </>
  );
}
