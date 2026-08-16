import { describe, expect, it } from 'vitest';
import { allocatedTotal, daysToExpiry, isFefoOverride, sortFefo, suggestFefo } from '../src/fefo.js';
import type { FefoCandidate } from '../src/fefo.js';
import type { StockLevel } from '../src/stock.js';

const level = (id: string, quantity: string): StockLevel => ({
  key: id,
  productId: 'prod-flour',
  batchId: id,
  locationId: 'loc-rack-a1',
  status: 'AVAILABLE',
  quantity,
});

const candidate = (id: string, quantity: string, expiryDate?: string, expired = false): FefoCandidate => ({
  level: level(id, quantity),
  expiryDate,
  expired,
});

describe('FEFO', () => {
  it('sorts earliest expiry first, no-expiry last', () => {
    const sorted = sortFefo([
      candidate('c', '10'),
      candidate('a', '10', '2026-09-01'),
      candidate('b', '10', '2026-08-20'),
    ]);
    expect(sorted.map((c) => c.level.key)).toEqual(['b', 'a', 'c']);
  });

  it('allocates across batches until the request is met', () => {
    const suggestion = suggestFefo(
      [candidate('a', '30', '2026-08-20'), candidate('b', '100', '2026-09-01')],
      '50',
    );
    expect(suggestion.allocations).toEqual([
      { level: expect.objectContaining({ key: 'a' }), quantity: '30' },
      { level: expect.objectContaining({ key: 'b' }), quantity: '20' },
    ]);
    expect(suggestion.shortfall).toBe('0');
    expect(allocatedTotal(suggestion)).toBe('50');
  });

  it('never allocates expired stock, and reports what it skipped', () => {
    const suggestion = suggestFefo(
      [candidate('old', '100', '2026-08-01', true), candidate('good', '100', '2026-09-01')],
      '40',
    );
    expect(suggestion.allocations.map((a) => a.level.key)).toEqual(['good']);
    expect(suggestion.skippedExpired.map((c) => c.level.key)).toEqual(['old']);
  });

  it('reports a shortfall rather than over-allocating', () => {
    const suggestion = suggestFefo([candidate('a', '12.5', '2026-08-20')], '20');
    expect(allocatedTotal(suggestion)).toBe('12.5');
    expect(suggestion.shortfall).toBe('7.5');
  });

  it('detects a departure from the suggestion — L15 then demands a reason', () => {
    const suggestion = suggestFefo(
      [candidate('a', '30', '2026-08-20'), candidate('b', '100', '2026-09-01')],
      '20',
    );
    expect(isFefoOverride(suggestion, suggestion.allocations)).toBe(false);
    expect(isFefoOverride(suggestion, [{ level: level('b', '100'), quantity: '20' }])).toBe(true);
  });

  it('counts days to expiry, negative once past', () => {
    expect(daysToExpiry('2026-08-20', '2026-08-16')).toBe(4);
    expect(daysToExpiry('2026-08-14', '2026-08-16')).toBe(-2);
    expect(daysToExpiry(undefined, '2026-08-16')).toBeUndefined();
  });
});
