import { describe, expect, it } from 'vitest';
import { addDays, startOfLocalDay, toLocalDate } from '../src/dates.js';

/**
 * The night-shift bug, locked shut.
 *
 * Found by running the app at 03:18 WIB: the L13 quick-issue stamp read
 * `2026-08-15-S3` on the 16th, because `toISOString()` had already rolled back
 * to the previous UTC day while the operator's calendar — and their shift —
 * said the 16th.
 */
describe('local calendar dates', () => {
  it('uses the local calendar, not UTC — the whole point', () => {
    // 03:18 local on 16 August. In UTC+7 that is still 15 August, 20:18 UTC.
    const nightShift = new Date(2026, 7, 16, 3, 18);
    expect(toLocalDate(nightShift)).toBe('2026-08-16');
    // What the old code did, shown for contrast where the machine is UTC+7:
    if (nightShift.getTimezoneOffset() === -420) {
      expect(nightShift.toISOString().slice(0, 10)).toBe('2026-08-15');
    }
  });

  it('is stable across the whole day, including both edges', () => {
    expect(toLocalDate(new Date(2026, 7, 16, 0, 0, 0))).toBe('2026-08-16');
    expect(toLocalDate(new Date(2026, 7, 16, 12, 0, 0))).toBe('2026-08-16');
    expect(toLocalDate(new Date(2026, 7, 16, 23, 59, 59))).toBe('2026-08-16');
  });

  it('pads single-digit months and days', () => {
    expect(toLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('adds and subtracts days across month and year boundaries', () => {
    expect(addDays('2026-08-16', 7)).toBe('2026-08-23');
    expect(addDays('2026-08-16', -30)).toBe('2026-07-17');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    // Leap year, because expiry dates land on it eventually.
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('gives a local midnight that round-trips', () => {
    expect(toLocalDate(startOfLocalDay('2026-08-16'))).toBe('2026-08-16');
  });
});
