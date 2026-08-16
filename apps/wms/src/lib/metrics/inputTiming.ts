import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';

/**
 * Input timing (T-025).
 *
 * PRD Risk #4 makes "time to enter one item" a first-class product metric,
 * not a nice-to-have: if L06 is slower than a notebook, operators go back to
 * the notebook and the product dies. A target nobody measures is a target
 * nobody meets, so the clock is wired in from the first prototype.
 *
 * Measured: screen open → primary save pressed. Not keystrokes, not focus
 * time — the whole job, the way the operator experiences it.
 *
 * `performance.now()` is used rather than `Date.now()` because it is monotonic;
 * a clock adjustment mid-shift would otherwise produce negative durations.
 */

export interface TimingSample {
  screen: string;
  ms: number;
  at: number;
}

interface TimingState {
  samples: TimingSample[];
  record: (sample: TimingSample) => void;
  clear: () => void;
}

const MAX_SAMPLES = 200;

export const useTimingStore = create<TimingState>((set) => ({
  samples: [],
  record: (sample) =>
    set((state) => ({ samples: [sample, ...state.samples].slice(0, MAX_SAMPLES) })),
  clear: () => set({ samples: [] }),
}));

/**
 * Starts a stopwatch when the screen mounts. Call `stop()` on the primary
 * action, and `restart()` when the form resets for the next item — in L06 the
 * clock restarts on `Save & add next`, because that is where the next item's
 * 20 seconds begin.
 */
export function useInputTiming(screen: string) {
  const started = useRef(performance.now());
  const record = useTimingStore((s) => s.record);

  useEffect(() => {
    started.current = performance.now();
  }, [screen]);

  const stop = useCallback(() => {
    const ms = performance.now() - started.current;
    record({ screen, ms, at: Date.now() });
    return ms;
  }, [record, screen]);

  const restart = useCallback(() => {
    started.current = performance.now();
  }, []);

  return { stop, restart };
}

/** Median, not mean — one interrupted entry should not move the number. */
export function medianMs(samples: TimingSample[], screen?: string): number | null {
  const values = samples
    .filter((s) => !screen || s.screen === screen)
    .map((s) => s.ms)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? ((values[mid - 1]! + values[mid]!) / 2) : values[mid]!;
}

/** Acceptance targets, UI Spec §23. */
export const TIMING_TARGETS: Record<string, number> = {
  L06: 20_000,
  L13: 30_000,
};
