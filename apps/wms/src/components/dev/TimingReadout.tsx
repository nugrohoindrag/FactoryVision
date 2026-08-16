import { isInternalBuild } from '@/lib/buildMode';
import { medianMs, TIMING_TARGETS, useTimingStore } from '@/lib/metrics/inputTiming';
import { cn } from '@/lib/utils';

/**
 * Timing readout for internal builds (T-025).
 *
 * Shown on the risky screens so the target is visible while the screen is
 * being used in a real warehouse — the measurement has to happen there, not
 * in an office (PRD Risk #4). That is why it keys off `isInternalBuild` and
 * not `DEV`: the field test runs an installed production build.
 *
 * Absent from customer builds: this is an instrument, not a feature.
 */
export function TimingReadout({ screen, last }: { screen: string; last?: number | null }) {
  const samples = useTimingStore((s) => s.samples);
  if (!isInternalBuild) return null;

  const median = medianMs(samples, screen);
  const target = TIMING_TARGETS[screen];
  const count = samples.filter((s) => s.screen === screen).length;
  const overTarget = target !== undefined && median !== null && median > target;

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-secondary px-4 py-2 text-caption text-text-secondary">
      <span className="font-semibold uppercase tracking-wide">{screen} timing</span>
      {last != null && <span>last {seconds(last)}</span>}
      <span className={cn(overTarget && 'font-semibold text-st-danger')}>
        median {median === null ? '—' : seconds(median)}
        {target !== undefined && ` / target ${seconds(target)}`}
      </span>
      <span>n={count}</span>
    </div>
  );
}
