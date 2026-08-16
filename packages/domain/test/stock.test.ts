import { describe, expect, it } from 'vitest';
import { availableStock, projectStock, stockKey, totalQuantity } from '../src/stock.js';
import { ev, ids } from './helpers.js';

const receiveFlour = (quantity: string, batchId = ids.batchA) =>
  ev('goods_receipt.item_added', {
    receiptId: 'receipt-1',
    lineId: 'rl-1',
    productId: ids.flour,
    batchId,
    batchNo: 'B-001',
    quantity,
    unit: 'kg',
    locationId: ids.receiving,
    landsIn: 'AWAITING INSPECTION',
  });

const refAwaiting = {
  productId: ids.flour,
  batchId: ids.batchA,
  locationId: ids.receiving,
  status: 'AWAITING INSPECTION' as const,
};

describe('stock projection', () => {
  it('lands a goods receipt in the status the tenant config dictates', () => {
    const levels = projectStock([receiveFlour('100')]);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toMatchObject({ status: 'AWAITING INSPECTION', quantity: '100' });
  });

  it('moves inspected goods to AVAILABLE and leaves nothing behind', () => {
    const levels = projectStock([
      receiveFlour('100'),
      ev('inspection.decided', {
        receiptLineId: 'rl-1',
        ref: refAwaiting,
        decision: 'PASS',
        quantity: '100',
        photoIds: [],
      }),
    ]);
    // The awaiting line hits zero and is dropped, not shown as "0 kg".
    expect(levels).toHaveLength(1);
    expect(levels[0]).toMatchObject({ status: 'AVAILABLE', quantity: '100' });
  });

  it('splits a partial rejection across two statuses', () => {
    const levels = projectStock([
      receiveFlour('100'),
      ev('inspection.decided', {
        receiptLineId: 'rl-1',
        ref: refAwaiting,
        decision: 'PASS',
        quantity: '90',
        photoIds: [],
      }),
      ev('inspection.decided', {
        receiptLineId: 'rl-1',
        ref: refAwaiting,
        decision: 'REJECT',
        quantity: '10',
        reasonCode: 'WET',
        photoIds: [],
      }),
    ]);
    expect(totalQuantity(levels, { status: 'AVAILABLE' })).toBe('90');
    expect(totalQuantity(levels, { status: 'REJECTED' })).toBe('10');
  });

  it('putaway changes location but not status or total', () => {
    const levels = projectStock([
      receiveFlour('100'),
      ev('inspection.decided', {
        receiptLineId: 'rl-1',
        ref: refAwaiting,
        decision: 'PASS',
        quantity: '100',
        photoIds: [],
      }),
      ev('putaway.completed', {
        ref: { ...refAwaiting, status: 'AVAILABLE' },
        quantity: '100',
        toLocationId: ids.rackA1,
      }),
    ]);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toMatchObject({ locationId: ids.rackA1, quantity: '100' });
  });

  it('walks a full issue: prepared → handed over → returned → closed', () => {
    const availableRef = { ...refAwaiting, status: 'AVAILABLE' as const, locationId: ids.rackA1 };
    const events = [
      receiveFlour('100'),
      ev('inspection.decided', {
        receiptLineId: 'rl-1',
        ref: refAwaiting,
        decision: 'PASS',
        quantity: '100',
        photoIds: [],
      }),
      ev('putaway.completed', {
        ref: { ...refAwaiting, status: 'AVAILABLE' },
        quantity: '100',
        toLocationId: ids.rackA1,
      }),
      ev('material_issue.requested', {
        issueId: ids.issue,
        workOrderNo: 'WO-77',
        requestedBy: 'user-2',
        quick: false,
        lines: [{ lineId: ids.line1, productId: ids.flour, quantity: '60', unit: 'kg' }],
      }),
      ev('material_issue.prepared', {
        issueId: ids.issue,
        picks: [{ lineId: ids.line1, ref: availableRef, quantity: '60' }],
      }),
    ];

    const allocated = projectStock(events);
    expect(totalQuantity(allocated, { status: 'ALLOCATED' })).toBe('60');
    expect(totalQuantity(allocated, { status: 'AVAILABLE' })).toBe('40');

    events.push(
      ev('material_issue.handed_over', {
        issueId: ids.issue,
        handedOverBy: 'user-1',
        receivedBy: 'user-2',
        toLocationId: ids.production,
      }),
    );
    const onFloor = projectStock(events);
    expect(totalQuantity(onFloor, { status: 'IN PRODUCTION' })).toBe('60');
    expect(totalQuantity(onFloor, { status: 'ALLOCATED' })).toBe('0');

    events.push(
      ev('material_issue.returned', {
        issueId: ids.issue,
        returns: [
          {
            lineId: ids.line1,
            ref: { ...availableRef, status: 'IN PRODUCTION', locationId: ids.production },
            quantity: '8',
            toLocationId: ids.rackA1,
          },
        ],
      }),
    );
    const returned = projectStock(events);
    expect(totalQuantity(returned, { status: 'AVAILABLE' })).toBe('48');
    expect(totalQuantity(returned, { status: 'IN PRODUCTION' })).toBe('52');

    events.push(
      ev('material_issue.closed', {
        issueId: ids.issue,
        shrinkage: [{ lineId: ids.line1, quantity: '0.5', reason: 'SPILLAGE', photoIds: [] }],
        resultingStatus: 'CLOSED',
      }),
    );
    const closed = projectStock(events);
    // Consumed + shrinkage both leave stock: nothing stays IN PRODUCTION.
    expect(totalQuantity(closed, { status: 'IN PRODUCTION' })).toBe('0');
    expect(totalQuantity(closed, { status: 'AVAILABLE' })).toBe('48');
  });

  it('keeps production reject out of sellable stock', () => {
    const levels = projectStock([
      ev('production.output_submitted', {
        productId: ids.sugar,
        batchId: ids.batchB,
        batchNo: '20260816-S1-L2',
        quantity: '480',
        unit: 'pcs',
        productionDate: '2026-08-16',
        rejectQuantity: '20',
        rejectLocationId: ids.reject,
        locationId: ids.rackA1,
        landsIn: 'AVAILABLE',
      }),
    ]);
    expect(totalQuantity(levels, { status: 'AVAILABLE' })).toBe('480');
    expect(totalQuantity(levels, { locationId: ids.reject })).toBe('20');
    expect(availableStock(levels).every((l) => l.locationId !== ids.reject)).toBe(true);
  });

  it('applies signed adjustments', () => {
    const levels = projectStock([
      receiveFlour('100'),
      ev('stock.adjusted', { ref: refAwaiting, delta: '-2.5', reasonCode: 'DAMAGED' }),
    ]);
    expect(levels[0]?.quantity).toBe('97.5');
  });

  it('builds a stable key per product/batch/location/status', () => {
    expect(stockKey(refAwaiting)).toBe(
      `${ids.flour}|${ids.batchA}|${ids.receiving}|AWAITING INSPECTION`,
    );
    expect(stockKey({ ...refAwaiting, batchId: null })).toContain('|-|');
  });
});
