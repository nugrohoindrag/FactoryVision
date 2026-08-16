/**
 * Calendar dates, in the factory's own timezone.
 *
 * `new Date().toISOString().slice(0, 10)` looks like "today" and is not. It is
 * today in UTC, and Indonesia runs UTC+7 — so from midnight until 07:00 local
 * it returns YESTERDAY.
 *
 * That window is the night shift. The consequences are not cosmetic:
 *
 * - a production batch numbered `YYYYMMDD-S3-L2` gets the previous day's date,
 *   so the night shift's output is filed under the wrong day and traceability
 *   (PRD M3) points at the wrong batch
 * - `expiryDate < today` is how expired batches are hard-blocked from being
 *   issued (PRD F5). A day-behind `today` lets a batch that expired today be
 *   issued all night
 * - every date field defaults to yesterday for the shift least likely to
 *   notice and most likely to be working alone
 *
 * So dates are computed from the LOCAL calendar. Timestamps stay UTC — an
 * instant is an instant — but a calendar date is a wall-clock fact.
 */

/** `2026-08-16` from the local calendar, not from UTC. */
export function toLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today, in the factory's timezone. */
export function todayLocal(): string {
  return toLocalDate();
}

/** `todayLocal()` shifted by whole days — expiry defaults, report ranges. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year!, month! - 1, day! + days);
  return toLocalDate(date);
}

/** Local midnight for an ISO date — safe to compare or subtract. */
export function startOfLocalDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}
