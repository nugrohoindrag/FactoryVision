import type { AnyEvent } from '@fv/contracts';
import { describe, expect, it } from 'vitest';
import { projectIssues } from '../src/issue.js';
import { projectStock } from '../src/stock.js';

/**
 * A material issue does not arrive in one order.
 *
 * Production writes the request on their phone at the machine. The warehouse
 * writes `prepared` and `handed_over` on theirs. Whichever device reaches a
 * signal first is the order the log ends up in — and the warehouse device is
 * the one standing near the office wifi, so "warehouse first" is the common
 * case, not the exotic one.
 *
 * Every figure below must come out the same whatever that order was. If it
 * does not, two people looking at the same issue see different numbers and
 * neither can say why.
 */

const ISSUE = '11111111-1111-4111-8111-111111111111';
const LINE = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '33333333-3333-4333-8333-333333333333';
const BATCH = '44444444-4444-4444-8444-444444444444';
const RACK = '55555555-5555-4555-8555-555555555555';
const LANE = '66666666-6666-4666-8666-666666666666';
const USER = '77777777-7777-4777-8777-777777777777';

let seq = 0;
const event = (type: string, payload: unknown): AnyEvent =>
  ({
    id: `0000000${(seq += 1).toString(16).padStart(1, '0')}-0000-7000-8000-000000000000`,
    tenantId: '88888888-8888-4888-8888-888888888888',
    type,
    occurredAt: '2026-08-16T01:00:00.000Z',
    actorId: USER,
    actorRole: 'OPERATOR',
    deviceId: 'device',
    prevHash: null,
    hash: 'x',
    payload,
  }) as unknown as AnyEvent;

const requested = () =>
  event('material_issue.requested', {
    issueId: ISSUE,
    workOrderNo: 'WO-1',
    requestedBy: USER,
    quick: false,
    destinationId: LANE,
    productId: PRODUCT,
    plannedQuantity: '100',
    bomStandard: [{ lineId: LINE, standardQuantity: '90' }],
    lines: [{ lineId: LINE, productId: PRODUCT, quantity: '90', unit: 'kg' }],
  });

const prepared = () =>
  event('material_issue.prepared', {
    issueId: ISSUE,
    picks: [
      {
        lineId: LINE,
        ref: { productId: PRODUCT, batchId: BATCH, locationId: RACK, status: 'AVAILABLE' },
        quantity: '90',
      },
    ],
  });

const handedOver = () =>
  event('material_issue.handed_over', {
    issueId: ISSUE,
    handedOverBy: USER,
    receivedBy: USER,
    toLocationId: LANE,
  });

const returned = () =>
  event('material_issue.returned', {
    issueId: ISSUE,
    returns: [
      {
        lineId: LINE,
        ref: { productId: PRODUCT, batchId: BATCH, locationId: LANE, status: 'IN PRODUCTION' },
        quantity: '8',
        toLocationId: RACK,
      },
    ],
  });

const closed = () =>
  event('material_issue.closed', {
    issueId: ISSUE,
    shrinkage: [{ lineId: LINE, quantity: '0.5', reason: 'SPILLAGE', photoIds: [] }],
    resultingStatus: 'CLOSED',
  });

const receipt = () =>
  event('goods_receipt.item_added', {
    receiptId: '99999999-9999-4999-8999-999999999999',
    lineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    productId: PRODUCT,
    batchId: BATCH,
    batchNo: 'LOT-1',
    quantity: '100',
    unit: 'kg',
    locationId: RACK,
    landsIn: 'AVAILABLE',
    defectQuantity: '0',
    defectPhotoIds: [],
  });

describe('material issue projection is order-independent', () => {
  it('gives the same consumed figure whichever device syncs first', () => {
    // Production first — the order the fixtures were written in.
    const productionFirst = [receipt(), requested(), prepared(), handedOver(), returned(), closed()];
    // Warehouse first — the order a real factory produces more often.
    const warehouseFirst = [receipt(), prepared(), handedOver(), requested(), returned(), closed()];

    const a = projectIssues(productionFirst).get(ISSUE);
    const b = projectIssues(warehouseFirst).get(ISSUE);

    // 90 issued − 8 returned − 0.5 spilled = 81.5 consumed (PRD M2).
    expect(a?.lines[0]?.consumed).toBe('81.5');
    expect(b?.lines[0]?.consumed).toBe('81.5');
    expect(b?.lines[0]?.issued).toBe('90');
    expect(a?.status).toBe('CLOSED');
    expect(b?.status).toBe('CLOSED');
  });

  it('never reports negative consumption', () => {
    // The shape this bug took: `requested` replaced the line and zeroed the 90
    // that had already been issued, leaving `0 − 8 − 0.5 = −8.5`.
    const warehouseFirst = [receipt(), prepared(), handedOver(), requested(), returned(), closed()];
    const balance = projectIssues(warehouseFirst).get(ISSUE);
    expect(balance?.lines[0]?.consumed.startsWith('-')).toBe(false);
  });

  it('leaves no negative stock line in either order', () => {
    for (const log of [
      [receipt(), requested(), prepared(), handedOver(), returned(), closed()],
      [receipt(), prepared(), handedOver(), requested(), returned(), closed()],
    ]) {
      const negative = projectStock(log).filter((line) => line.quantity.startsWith('-'));
      expect(negative).toEqual([]);
    }
  });
});
