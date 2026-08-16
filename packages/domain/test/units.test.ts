import { describe, expect, it } from 'vitest';
import { availableUnits, fromBase, toBase, UnknownUnitError } from '../src/units.js';

const flour = {
  sku: 'RM-FLOUR-01',
  baseUnit: 'kg',
  conversions: [{ from: 'sak', to: 'kg', factor: '25' }],
};

const film = {
  sku: 'PKG-FILM-01',
  baseUnit: 'm',
  // Stored the other way round — still usable.
  conversions: [{ from: 'm', to: 'roll', factor: '0.002' }],
};

describe('unit conversion', () => {
  it('converts an operator entry to the base unit', () => {
    expect(toBase(flour, '3', 'sak')).toBe('75');
    expect(toBase(flour, '12.5', 'kg')).toBe('12.5');
  });

  it('converts back for display', () => {
    expect(fromBase(flour, '75', 'sak')).toBe('3');
  });

  it('handles an inverted conversion definition', () => {
    expect(toBase(film, '1', 'roll')).toBe('500');
  });

  it('does not drift on repeated round trips', () => {
    const base = toBase(flour, '0.1', 'sak');
    expect(base).toBe('2.5');
    expect(fromBase(flour, base, 'sak')).toBe('0.1');
  });

  it('refuses an unknown unit instead of guessing', () => {
    expect(() => toBase(flour, '1', 'box')).toThrow(UnknownUnitError);
  });

  it('lists what the operator may choose, base unit first', () => {
    expect(availableUnits(flour)).toEqual(['kg', 'sak']);
  });
});
