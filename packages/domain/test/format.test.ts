import { describe, expect, it } from 'vitest';
import { formatAge, formatDate, formatQuantity, formatWithUnit } from '../src/format.js';

describe('display formatting (DS §6)', () => {
  it('uses Indonesian grouping', () => {
    expect(formatQuantity('1500.5')).toBe('1.500,5');
    expect(formatQuantity('91.5')).toBe('91,5');
  });

  it('never leaks float artefacts into the UI', () => {
    expect(formatQuantity('91.5000000001')).toBe('91,5');
  });

  it('spaces the unit, except % and °', () => {
    expect(formatWithUnit('1500.5', 'kg')).toBe('1.500,5 kg');
    expect(formatWithUnit('87.4', '%', 1)).toBe('87,4%');
  });

  it('formats issue age the way the floor reads it', () => {
    expect(formatAge(18)).toBe('18h');
    expect(formatAge(24)).toBe('1d');
    expect(formatAge(50)).toBe('2d 2h');
  });

  it('formats a date', () => {
    expect(formatDate('2026-08-16')).toBe('16 Aug 2026');
  });
});
