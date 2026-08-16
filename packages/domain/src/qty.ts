import Big from 'big.js';

/**
 * Quantity arithmetic. The ONLY place `big.js` is touched.
 *
 * Tech Stack §2.4: quantities are decimal strings in, decimal strings out.
 * `number` appears exactly once — in `toNumber()`, for display formatting.
 * A float leaking into this chain produces `0.0000000001 kg` of shrinkage,
 * which means a Material Issue never closes clean (UI Spec §12 L19).
 */

// 10 decimal places is far past any warehouse scale, and keeps division
// (unit conversion) from carrying big.js's 20-place default into the UI.
Big.DP = 10;
Big.RM = Big.roundHalfUp;

export type Qty = string;

export const ZERO: Qty = '0';

/** Normalises "1.500" → "1.5", " 12 " → "12". Throws on non-numeric input. */
export function qty(value: Qty | number): Qty {
  return new Big(typeof value === 'number' ? String(value) : value.trim()).toString();
}

export function add(...values: Qty[]): Qty {
  return values.reduce((acc, v) => acc.plus(new Big(v)), new Big(0)).toString();
}

export function sub(a: Qty, ...rest: Qty[]): Qty {
  return rest.reduce((acc, v) => acc.minus(new Big(v)), new Big(a)).toString();
}

export function mul(a: Qty, b: Qty): Qty {
  return new Big(a).times(new Big(b)).toString();
}

export function div(a: Qty, b: Qty): Qty {
  const divisor = new Big(b);
  if (divisor.eq(0)) throw new RangeError('division by zero');
  return new Big(a).div(divisor).toString();
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function cmp(a: Qty, b: Qty): -1 | 0 | 1 {
  return new Big(a).cmp(new Big(b)) as -1 | 0 | 1;
}

export const eq = (a: Qty, b: Qty): boolean => cmp(a, b) === 0;
export const gt = (a: Qty, b: Qty): boolean => cmp(a, b) > 0;
export const gte = (a: Qty, b: Qty): boolean => cmp(a, b) >= 0;
export const lt = (a: Qty, b: Qty): boolean => cmp(a, b) < 0;
export const lte = (a: Qty, b: Qty): boolean => cmp(a, b) <= 0;
export const isZero = (a: Qty): boolean => new Big(a).eq(0);
export const isNegative = (a: Qty): boolean => new Big(a).lt(0);

export function abs(a: Qty): Qty {
  return new Big(a).abs().toString();
}

export function neg(a: Qty): Qty {
  return new Big(a).times(-1).toString();
}

export function min(...values: Qty[]): Qty {
  return values.reduce((acc, v) => (lt(v, acc) ? v : acc));
}

export function max(...values: Qty[]): Qty {
  return values.reduce((acc, v) => (gt(v, acc) ? v : acc));
}

/** Fixed decimal places, e.g. `round('91.4999', 2)` → `'91.5'`. */
export function round(a: Qty, dp = 4): Qty {
  return new Big(a).round(dp, Big.roundHalfUp).toString();
}

/** Only for display. Never feed the result back into a calculation. */
export function toNumber(a: Qty): number {
  return Number(a);
}

export function isValidQty(value: unknown): value is Qty {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new Big(value.trim());
    return true;
  } catch {
    return false;
  }
}
