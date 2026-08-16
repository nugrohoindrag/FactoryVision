import type { Batch } from '@fv/contracts';
import { add, gt, lte, min, sub, type Qty, ZERO } from './qty.js';
import type { StockLevel } from './stock.js';

/**
 * FEFO — First Expired, First Out (UI Spec L15, L21).
 *
 * The suggestion is a suggestion: L15 lets the operator override it, but only
 * with a reason. Expired stock is different — it is blocked outright, not
 * warned about.
 */

export interface FefoCandidate {
  level: StockLevel;
  batch?: Batch;
  /** `undefined` when the batch has no expiry — those sort last, never first. */
  expiryDate?: string;
  expired: boolean;
}

export interface FefoAllocation {
  level: StockLevel;
  quantity: Qty;
}

export interface FefoSuggestion {
  allocations: FefoAllocation[];
  /** Requested minus allocated. Non-zero means the pick cannot be completed. */
  shortfall: Qty;
  /** Expired batches found and deliberately skipped — L15 shows these. */
  skippedExpired: FefoCandidate[];
}

const DATE_MAX = '9999-12-31';

/** Ascending by expiry; no-expiry batches last; ties broken by batch number. */
export function sortFefo(candidates: readonly FefoCandidate[]): FefoCandidate[] {
  return [...candidates].sort((a, b) => {
    const ea = a.expiryDate ?? DATE_MAX;
    const eb = b.expiryDate ?? DATE_MAX;
    if (ea !== eb) return ea < eb ? -1 : 1;
    return (a.batch?.batchNo ?? '').localeCompare(b.batch?.batchNo ?? '');
  });
}

export function toCandidates(
  levels: readonly StockLevel[],
  batches: readonly Batch[],
  today: string,
): FefoCandidate[] {
  const byId = new Map(batches.map((b) => [b.id, b]));
  return levels.map((level) => {
    const batch = level.batchId ? byId.get(level.batchId) : undefined;
    const expiryDate = batch?.expiryDate;
    return {
      level,
      batch,
      expiryDate,
      // Expiring today is still usable; expired means strictly before today.
      expired: Boolean(expiryDate && expiryDate < today),
    };
  });
}

/**
 * Allocates `requested` across the earliest-expiring batches first.
 *
 * Expired batches are never allocated — UI Spec L15 blocks them, and a
 * "warning" here would be silently overridden on a busy morning.
 */
export function suggestFefo(
  candidates: readonly FefoCandidate[],
  requested: Qty,
): FefoSuggestion {
  const allocations: FefoAllocation[] = [];
  const skippedExpired: FefoCandidate[] = [];
  let remaining = requested;

  for (const candidate of sortFefo(candidates)) {
    if (candidate.expired) {
      skippedExpired.push(candidate);
      continue;
    }
    if (lte(remaining, ZERO)) break;
    if (!gt(candidate.level.quantity, ZERO)) continue;

    const take = min(remaining, candidate.level.quantity);
    allocations.push({ level: candidate.level, quantity: take });
    remaining = sub(remaining, take);
  }

  return { allocations, shortfall: remaining, skippedExpired };
}

/** Total actually allocated by a suggestion. */
export function allocatedTotal(suggestion: FefoSuggestion): Qty {
  return suggestion.allocations.reduce((acc, a) => add(acc, a.quantity), ZERO);
}

/**
 * Is this pick a departure from the FEFO suggestion? If yes, L15 demands a
 * reason before it will accept the pick.
 */
export function isFefoOverride(
  suggestion: FefoSuggestion,
  chosen: readonly FefoAllocation[],
): boolean {
  const suggested = new Map(suggestion.allocations.map((a) => [a.level.key, a.quantity]));
  if (chosen.length !== suggested.size) return true;
  return chosen.some((c) => suggested.get(c.level.key) !== c.quantity);
}

/** Days until expiry; negative when already expired. `undefined` if no expiry. */
export function daysToExpiry(expiryDate: string | undefined, today: string): number | undefined {
  if (!expiryDate) return undefined;
  const ms = Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
