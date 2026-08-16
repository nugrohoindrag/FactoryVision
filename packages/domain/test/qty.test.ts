import { describe, expect, it } from 'vitest';
import { add, cmp, div, isValidQty, max, min, mul, neg, qty, round, sub } from '../src/qty.js';

describe('quantity arithmetic', () => {
  it('adds without float drift — the reason big.js exists here', () => {
    // 0.1 + 0.2 !== 0.3 in floats. In this product that means an issue that
    // never closes clean (Tech Stack §2.4).
    expect(add('0.1', '0.2')).toBe('0.3');
    expect(add('0.1', '0.2', '0.3', '0.4')).toBe('1');
  });

  it('subtracts a chain in one call — the L19 panel', () => {
    // Issued − Returned − Shrinkage = Consumed
    expect(sub('100.00', '8.00', '0.50')).toBe('91.5');
  });

  it('leaves no residue when the chain balances exactly', () => {
    const consumed = sub('100', '33.33', '33.33', '33.34');
    expect(consumed).toBe('0');
  });

  it('multiplies unit conversions exactly', () => {
    expect(mul('3', '25.5')).toBe('76.5');
    expect(mul('0.07', '100')).toBe('7');
  });

  it('divides with bounded precision and rejects zero', () => {
    expect(div('75', '25')).toBe('3');
    expect(div('1', '3')).toBe('0.3333333333'); // Big.DP = 10
    expect(() => div('1', '0')).toThrow(RangeError);
  });

  it('normalises input', () => {
    expect(qty(' 1.500 ')).toBe('1.5');
    expect(qty('0012')).toBe('12');
    expect(qty(2.5)).toBe('2.5');
  });

  it('compares numerically, not lexically', () => {
    expect(cmp('9', '10')).toBe(-1); // '9' > '10' as strings
    expect(cmp('1.0', '1')).toBe(0);
    expect(min('9', '10', '2.5')).toBe('2.5');
    expect(max('9', '10', '2.5')).toBe('10');
  });

  it('rounds half up at a fixed scale', () => {
    expect(round('91.4999', 2)).toBe('91.5');
    expect(round('0.125', 2)).toBe('0.13');
  });

  it('negates and validates', () => {
    expect(neg('5.5')).toBe('-5.5');
    expect(isValidQty('12.5')).toBe(true);
    expect(isValidQty('')).toBe(false);
    expect(isValidQty('12,5')).toBe(false); // comma decimal is display-only
    expect(isValidQty(12.5)).toBe(false);
  });
});
