import type { Qty } from './qty.js';
import { toNumber } from './qty.js';

/**
 * Display formatting (DS §6). The one place a quantity becomes a `number` —
 * and it never travels back into a calculation from here.
 *
 * Indonesian grouping: `1.000,5` — dot thousands, comma decimal.
 */

const NUMBER_LOCALE = 'id-ID';

export function formatQuantity(value: Qty, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(toNumber(value));
}

/** `formatWithUnit('1500.5', 'kg')` → `'1.500,5 kg'`. Space before every unit but % and °. */
export function formatWithUnit(value: Qty, unit: string, maximumFractionDigits = 2): string {
  const separator = unit === '%' || unit.startsWith('°') ? '' : ' ';
  return `${formatQuantity(value, maximumFractionDigits)}${separator}${unit}`;
}

/** Rupiah, no decimals — factory owners never think in sen. */
export function formatMoney(value: Qty): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(toNumber(value));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** DS §6 — `DD MMM YYYY · HH:mm`, 24-hour. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * Issue age as the floor reads it: `18h`, `3d 2h`. Used by MaterialIssueCard,
 * where the age is the loudest thing on the card.
 */
export function formatAge(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}
