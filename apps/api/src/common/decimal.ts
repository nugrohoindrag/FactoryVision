import { Prisma } from '@prisma/client';
import Big from 'big.js';

/**
 * B-008 — quantities cross this boundary as strings, and only as strings.
 *
 * The consequence of getting this wrong is concrete and already documented in
 * Tech Stack §2.4: `Issued − Returned − Shrinkage` leaves `0.0000000001 kg`,
 * the material issue never closes cleanly, and the variance report — the one
 * report a factory owner actually asks for — stops being believed.
 *
 * Prisma hands back `Prisma.Decimal`. JSON hands back strings. big.js computes.
 * `number` appears in exactly one place in this codebase: display formatting,
 * which lives in the client. Not here.
 */

export type QuantityString = string;

const ZERO = new Big(0);

export function toDecimal(value: Prisma.Decimal | string | null | undefined): QuantityString {
  if (value === null || value === undefined) return '0';
  return new Big(value.toString()).toFixed();
}

/** For writing to a `@db.Decimal(24,6)` column. */
export function toPrismaDecimal(value: QuantityString | Big): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

export function big(value: QuantityString | Prisma.Decimal | null | undefined): Big {
  if (value === null || value === undefined) return ZERO;
  return new Big(value.toString());
}

export function sum(values: Iterable<QuantityString>): QuantityString {
  let total = ZERO;
  for (const value of values) total = total.plus(new Big(value));
  return total.toFixed();
}

export function isZero(value: QuantityString): boolean {
  return new Big(value).eq(0);
}

export function isNegative(value: QuantityString): boolean {
  return new Big(value).lt(0);
}

/**
 * Rounds only where a human will read it. Never used before storing — six
 * decimals of storage exist so that a chain of conversions (sack → kg → g)
 * does not lose the last gram on the way through.
 */
export function roundForDisplay(value: QuantityString, places = 3): QuantityString {
  return new Big(value).round(places, Big.roundHalfUp).toFixed();
}
