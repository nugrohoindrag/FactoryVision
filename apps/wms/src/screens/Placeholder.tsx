import { useTerm, type TermKey } from '@/lib/terms/useTerm';

/**
 * A route that exists but is not built yet.
 *
 * Sprint 0 ships both shells navigable and empty (Gate S0). Each screen is
 * replaced by its real implementation in the sprint named here — the task id
 * is on screen so an internal build never leaves you guessing which task owns
 * a given route.
 */
export function Placeholder({
  titleKey,
  screenId,
  taskId,
  sprint,
  note,
}: {
  titleKey: TermKey;
  screenId: string;
  taskId: string;
  sprint: number;
  note?: string;
}) {
  const t = useTerm();

  return (
    <section className="mx-auto max-w-form p-4 lg:p-6">
      <div className="rounded-card border border-border bg-card p-card">
        <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
          {screenId}
        </p>
        <h1 className="pt-1 text-h3 font-semibold text-text-primary">{t(titleKey)}</h1>
        <p className="pt-3 text-body-sm text-text-secondary">
          Not built yet. Scheduled for sprint {sprint}, task {taskId}.
        </p>
        {note && <p className="pt-2 text-body-sm text-text-secondary">{note}</p>}
      </div>
    </section>
  );
}
