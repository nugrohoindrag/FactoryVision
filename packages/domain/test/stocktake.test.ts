import { describe, expect, it } from 'vitest';
import { buildAlerts, sortAlerts, type Alert } from '../src/alerts.js';
import { computeVariance, projectCounts, type CountedLine } from '../src/stocktake.js';
import type { StockLevel } from '../src/stock.js';
import { ev, ids } from './helpers.js';

const level = (productId: string, quantity: string, batchId: string | null = null): StockLevel => ({
  key: `${productId}|${batchId ?? '-'}|${ids.rackA1}|AVAILABLE`,
  productId,
  batchId,
  locationId: ids.rackA1,
  status: 'AVAILABLE',
  quantity,
});

const counted = (productId: string, quantity: string, round = 1): CountedLine => ({
  key: `${productId}|-|${ids.rackA1}|AVAILABLE`,
  ref: { productId, batchId: null, locationId: ids.rackA1, status: 'AVAILABLE' },
  countedQuantity: quantity,
  countedBy: 'user-1',
  round,
});

describe('stock take variance', () => {
  const stock = [level(ids.flour, '100'), level(ids.sugar, '50')];
  // Flour is cheap, sugar is not — the ordering must follow the money.
  const costs = { [ids.flour]: '9500', [ids.sugar]: '140000' };

  it('ranks by rupiah, not by quantity', () => {
    const summary = computeVariance(
      [counted(ids.flour, '90'), counted(ids.sugar, '48')],
      stock,
      costs,
      5,
    );
    // Flour is off by 10, sugar only by 2 — but sugar is worth far more.
    expect(summary.lines[0]?.ref.productId).toBe(ids.sugar);
    expect(summary.lines[0]?.valueImpact).toBe('280000');
    expect(summary.lines[1]?.valueImpact).toBe('95000');
  });

  it('computes the signed variance and the total value at stake', () => {
    const summary = computeVariance([counted(ids.flour, '90')], stock, costs, 5);
    expect(summary.lines[0]?.variance).toBe('-10');
    expect(summary.totalValueImpact).toBe('95000');
    expect(summary.itemsWithVariance).toBe(1);
  });

  it('triggers a recount above the threshold, not below it', () => {
    // 4% variance with a 5% threshold — no recount.
    const under = computeVariance([counted(ids.flour, '96')], stock, costs, 5);
    expect(under.lines[0]?.needsRecount).toBe(false);

    // 10% variance — recount.
    const over = computeVariance([counted(ids.flour, '90')], stock, costs, 5);
    expect(over.lines[0]?.needsRecount).toBe(true);
  });

  it('never asks for a recount of a recount', () => {
    const second = computeVariance([counted(ids.flour, '50', 2)], stock, costs, 5);
    expect(second.lines[0]?.needsRecount).toBe(false);
  });

  it('reports accuracy as the share of lines that matched', () => {
    const summary = computeVariance(
      [counted(ids.flour, '100'), counted(ids.sugar, '48')],
      stock,
      costs,
      5,
    );
    expect(summary.accuracyPercent).toBe(50);
  });

  it('lets a recount supersede the first count', () => {
    const counts = projectCounts(
      [
        ev('stock_take.counted', {
          sessionId: 'session-1',
          ref: { productId: ids.flour, batchId: null, locationId: ids.rackA1, status: 'AVAILABLE' },
          countedQuantity: '90',
          countedBy: 'user-1',
          round: 1,
        }),
        ev('stock_take.counted', {
          sessionId: 'session-1',
          ref: { productId: ids.flour, batchId: null, locationId: ids.rackA1, status: 'AVAILABLE' },
          countedQuantity: '100',
          countedBy: 'user-2',
          round: 2,
        }),
      ],
      'session-1',
    );

    expect(counts).toHaveLength(1);
    expect(counts[0]?.countedQuantity).toBe('100');
    expect(counts[0]?.round).toBe(2);
  });

  it('keeps sessions apart', () => {
    const counts = projectCounts(
      [
        ev('stock_take.counted', {
          sessionId: 'session-A',
          ref: { productId: ids.flour, batchId: null, locationId: ids.rackA1, status: 'AVAILABLE' },
          countedQuantity: '10',
          countedBy: 'user-1',
          round: 1,
        }),
      ],
      'session-B',
    );
    expect(counts).toHaveLength(0);
  });
});

describe('alert ordering', () => {
  const alert = (kind: Alert['kind'], value?: string): Alert => ({
    id: `${kind}-${value ?? 'x'}`,
    kind,
    title: kind,
    detail: '',
    severity: 'info',
    value,
  });

  it('puts an overdue material issue above everything, whatever the value', () => {
    const sorted = sortAlerts([
      alert('DEAD_STOCK', '900000000'),
      alert('EXPIRING_SOON', '50000000'),
      alert('ISSUE_OVERDUE', '1'),
    ]);
    expect(sorted[0]?.kind).toBe('ISSUE_OVERDUE');
  });

  it('orders by rupiah within the same kind', () => {
    const sorted = sortAlerts([alert('BELOW_MINIMUM', '100'), alert('BELOW_MINIMUM', '5000')]);
    expect(sorted[0]?.value).toBe('5000');
  });

  it('only ever marks an overdue issue as danger', () => {
    const alerts = buildAlerts({
      now: new Date('2026-08-18T08:00:00.000Z'),
      today: '2026-08-18',
      stock: [level(ids.flour, '5')],
      products: [
        {
          id: ids.flour,
          tenantId: 'tenant-1' as never,
          sku: 'RM-01',
          name: 'Flour',
          itemClass: 'RAW_MATERIAL',
          baseUnit: 'kg',
          conversions: [],
          minimumStock: '500',
          averageCost: '9500',
          active: true,
        },
      ],
      batches: [],
      issues: [],
      config: {
        issueOverdueHours: 24,
        expiryWarningDays: [30],
        deadStockDays: 90,
        quarantineWarningDays: 7,
      },
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe('BELOW_MINIMUM');
    // Below minimum is real, but it is not the one condition allowed to be red.
    expect(alerts[0]?.severity).toBe('warning');
  });
});
