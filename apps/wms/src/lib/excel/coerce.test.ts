import { describe, expect, it } from 'vitest';
import { toDate, toQuantity, toText } from './coerce';

/**
 * These cases are drawn from the failure modes PRD F1 names explicitly:
 * numbers stored as text, mixed date formats, merged cells, stray units.
 *
 * The regression suite over 30 real warehouse files is T-030 and still
 * blocked on P-01. Until those files arrive this suite stands in for them,
 * one documented tolerance at a time.
 */

describe('toQuantity — numbers as text', () => {
  it('reads plain numbers', () => {
    expect(toQuantity(1500)).toBe('1500');
    expect(toQuantity('42')).toBe('42');
  });

  it('reads Indonesian formatting (dot thousands, comma decimal)', () => {
    expect(toQuantity('1.500,5')).toBe('1500.5');
    expect(toQuantity('12,5')).toBe('12.5');
    expect(toQuantity('1.000.000')).toBe('1000000');
  });

  it('reads English formatting (comma thousands, dot decimal)', () => {
    expect(toQuantity('1,500.5')).toBe('1500.5');
    expect(toQuantity('1,500')).toBe('1500');
  });

  it('strips a trailing unit the operator typed into the cell', () => {
    expect(toQuantity('25 kg')).toBe('25');
    expect(toQuantity('12.5kg')).toBe('12.5');
  });

  it("survives Excel's force-to-text apostrophe and stray spaces", () => {
    expect(toQuantity("'250")).toBe('250');
    expect(toQuantity(' 1 500 ')).toBe('1500');
  });

  it('reads parenthesised negatives', () => {
    expect(toQuantity('(12,5)')).toBe('-12.5');
  });

  it('refuses rather than guessing when it is not a number', () => {
    expect(toQuantity('n/a')).toBeNull();
    expect(toQuantity('')).toBeNull();
    expect(toQuantity('-')).toBeNull();
    expect(toQuantity(null)).toBeNull();
  });
});

describe('toDate — mixed formats in one column', () => {
  it('reads ISO', () => {
    expect(toDate('2026-08-16')).toBe('2026-08-16');
  });

  it('reads day-first, the convention these files are written in', () => {
    expect(toDate('16/08/2026')).toBe('2026-08-16');
    expect(toDate('16-08-2026')).toBe('2026-08-16');
    expect(toDate('1.9.2026')).toBe('2026-09-01');
  });

  it('detects the other order when the day cannot be a month', () => {
    expect(toDate('08/16/2026')).toBe('2026-08-16');
  });

  it('reads month names in Indonesian and English', () => {
    expect(toDate('16 Agu 2026')).toBe('2026-08-16');
    expect(toDate('16 Aug 2026')).toBe('2026-08-16');
    expect(toDate('1 Des 2026')).toBe('2026-12-01');
  });

  it('expands two-digit years', () => {
    expect(toDate('16/08/26')).toBe('2026-08-16');
    expect(toDate('16/08/98')).toBe('1998-08-16');
  });

  it('reads Excel serial numbers', () => {
    // 46250 = 16 Aug 2026 in Excel's 1900 system.
    expect(toDate(46250)).toBe('2026-08-16');
  });

  it('reads a real Date cell', () => {
    expect(toDate(new Date(2026, 7, 16))).toBe('2026-08-16');
  });

  it('refuses nonsense instead of inventing a date', () => {
    expect(toDate('sometime next month')).toBeNull();
    expect(toDate('32/13/2026')).toBeNull();
    expect(toDate('')).toBeNull();
  });
});

describe('toText', () => {
  it('trims and nulls out blanks', () => {
    expect(toText('  RM-01 ')).toBe('RM-01');
    expect(toText('   ')).toBeNull();
    expect(toText(null)).toBeNull();
  });
});
