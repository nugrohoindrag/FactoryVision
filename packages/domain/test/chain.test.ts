import type { PurchaseOrder } from '@fv/contracts';
import { describe, expect, it } from 'vitest';
import { projectIssues } from '../src/issue.js';
import { projectPurchaseOrder } from '../src/po.js';
import { availableStock, negativeLines, projectStock, totalQuantity } from '../src/stock.js';
import { projectTasks } from '../src/tasks.js';
import { ev, ids } from './helpers.js';

/**
 * Gate S2 evidence — REWRITTEN for PRD v1.3 (task T-120).
 *
 * The previous version tested `receipt → inspection → putaway → …`. PRD v1.3
 * removed inspection from the default path: the operator marks defect while
 * unloading and good stock lands in AVAILABLE immediately. That made the old
 * test verify a flow no factory walks — still green in CI, which was the
 * dangerous part.
 *
 * So there are two chains now, and both must close:
 *
 *   A. Default   — receipt (with defect) → putaway → request → prepare →
 *                  handover to a LANE → return → close → output
 *   B. Deep      — the old chain, still valid for item classes that switch
 *      inspection    deep inspection on
 *
 * Every event is one an offline device appends locally, in order, with no
 * server involved. The arithmetic is the PRD's own worked example: 100 kg
 * issued, 8 returned, 0.5 shrinkage, 91.5 consumed.
 */

const rackRef = {
  productId: ids.flour,
  batchId: ids.batchA,
  locationId: ids.rackA1,
  status: 'AVAILABLE' as const,
};

const purchaseOrder: PurchaseOrder = {
  id: ids.po,
  tenantId: 'tenant-1' as PurchaseOrder['tenantId'],
  poNo: 'PO-1042',
  supplierId: ids.supplier,
  orderDate: '2026-08-10',
  eta: '2026-08-16',
  cancelled: false,
  lines: [
    { id: ids.poLine1, productId: ids.flour, quantityOrdered: '500', unit: 'kg' },
    { id: ids.poLine2, productId: ids.sugar, quantityOrdered: '200', unit: 'kg' },
  ],
};

/* ========================================================================
   A · Default chain — defect at the door, no inspection gate
   ===================================================================== */

describe('default chain: receipt+defect → putaway → issue → return → close → output', () => {
  const events = [
    // --- F2 goods receipt against a PO ------------------------------------
    ev('goods_receipt.created', {
      receiptId: 'receipt-1',
      supplierId: ids.supplier,
      deliveryNoteNo: 'DN-88',
      receivedAt: '2026-08-16T07:00:00.000Z',
      photoIds: ['photo-1'],
      purchaseOrderId: ids.po,
    }),
    // 500 came off the truck, 3 of them wet. 497 enter stock, 3 go to reject.
    ev('goods_receipt.item_added', {
      receiptId: 'receipt-1',
      lineId: 'rl-1',
      productId: ids.flour,
      batchId: ids.batchA,
      batchNo: 'TPG-2608A',
      quantity: '500',
      unit: 'kg',
      expiryDate: '2026-11-28',
      locationId: ids.receiving,
      // No inspection gate: good stock is immediately usable.
      landsIn: 'AVAILABLE',
      purchaseOrderId: ids.po,
      purchaseOrderLineId: ids.poLine1,
      defectQuantity: '3',
      defectReason: 'WET_CONTAMINATED',
      defectPhotoIds: ['photo-defect-1'],
      defectLocationId: ids.reject,
    }),

    // --- F4 putaway --------------------------------------------------------
    ev('putaway.completed', {
      ref: {
        productId: ids.flour,
        batchId: ids.batchA,
        locationId: ids.receiving,
        status: 'AVAILABLE',
      },
      quantity: '497',
      toLocationId: ids.rackA1,
    }),

    // --- F5 material request, now carrying a BOM snapshot and a lane -------
    ev('material_issue.requested', {
      issueId: ids.issue,
      workOrderNo: 'WO-2608-14',
      requestedBy: 'user-2',
      quick: false,
      destinationId: ids.lane2,
      productId: ids.sugar,
      plannedQuantity: '450',
      bomStandard: [{ lineId: ids.line1, standardQuantity: '90' }],
      lines: [{ lineId: ids.line1, productId: ids.flour, quantity: '100', unit: 'kg' }],
    }),
    ev('material_issue.prepared', {
      issueId: ids.issue,
      picks: [{ lineId: ids.line1, ref: rackRef, quantity: '100' }],
    }),
    // Handover targets the LANE, not one shared virtual location.
    ev('material_issue.handed_over', {
      issueId: ids.issue,
      handedOverBy: 'user-1',
      receivedBy: 'user-2',
      toLocationId: ids.lane2,
    }),

    // --- F6 closing ---------------------------------------------------------
    ev('material_issue.returned', {
      issueId: ids.issue,
      returns: [
        {
          lineId: ids.line1,
          ref: { ...rackRef, locationId: ids.lane2, status: 'IN PRODUCTION' },
          quantity: '8',
          toLocationId: ids.rackA1,
        },
      ],
    }),
    ev('material_issue.closed', {
      issueId: ids.issue,
      shrinkage: [{ lineId: ids.line1, quantity: '0.5', reason: 'SPILLAGE', photoIds: [] }],
      resultingStatus: 'CLOSED',
    }),

    // --- F7 production output ----------------------------------------------
    ev('production.output_submitted', {
      productId: ids.sugar,
      batchId: ids.batchB,
      batchNo: '20260816-S1-L2',
      quantity: '450',
      unit: 'pcs',
      productionDate: '2026-08-16',
      expiryDate: '2027-05-13',
      rejectQuantity: '12',
      rejectLocationId: ids.reject,
      linkedIssueId: ids.issue,
      locationId: ids.rackA1,
      landsIn: 'AVAILABLE',
    }),
  ];

  const stock = projectStock(events);
  const issue = projectIssues(events).get(ids.issue)!;
  const po = projectPurchaseOrder(purchaseOrder, events);

  it('closes the issue with the exact PRD arithmetic', () => {
    expect(issue.totals.issued).toBe('100');
    expect(issue.totals.returned).toBe('8');
    expect(issue.totals.shrinkage).toBe('0.5');
    expect(issue.totals.consumed).toBe('91.5');
    expect(issue.status).toBe('CLOSED');
    expect(issue.unaccountedLineIds).toEqual([]);
  });

  it('leaves no fake decimal remainder', () => {
    expect(issue.totals.consumed).not.toMatch(/0{6,}[1-9]/);
    expect(issue.totals.consumed).toBe('91.5');
  });

  it('never sends good stock through an inspection gate', () => {
    // The whole point of correction #2: nothing waits.
    expect(totalQuantity(stock, { status: 'AWAITING INSPECTION' })).toBe('0');
  });

  it('keeps defect out of AVAILABLE and puts it in reject', () => {
    // 500 off the truck − 3 defect = 497 good; 3 sit in reject.
    expect(totalQuantity(stock, { productId: ids.flour, locationId: ids.reject })).toBe('3');
    expect(
      availableStock(stock, ids.flour).some((l) => l.locationId === ids.reject),
    ).toBe(false);
  });

  it('holds IN PRODUCTION against the lane, never a nameless total', () => {
    const inProduction = projectStock(events.slice(0, 6)).filter(
      (l) => l.status === 'IN PRODUCTION',
    );
    expect(inProduction).toHaveLength(1);
    expect(inProduction[0]!.locationId).toBe(ids.lane2);
    expect(inProduction[0]!.quantity).toBe('100');
  });

  it('leaves nothing stranded in production once closed', () => {
    expect(totalQuantity(stock, { status: 'IN PRODUCTION' })).toBe('0');
    expect(totalQuantity(stock, { status: 'ALLOCATED' })).toBe('0');
  });

  it('returns the leftover to a real rack, not into thin air', () => {
    // 497 good − 100 issued + 8 returned = 405 kg of flour on rack A1.
    expect(totalQuantity(stock, { productId: ids.flour, status: 'AVAILABLE' })).toBe('405');
  });

  it('marks the PO partially received because of the defect', () => {
    // 497 of 500 received. The missing 3 stay owed by the supplier — which is
    // exactly what "PO becomes PARTIALLY RECEIVED" is for.
    expect(po.status).toBe('PARTIALLY RECEIVED');
    expect(po.lines[0]!.received).toBe('497');
    expect(po.lines[0]!.defect).toBe('3');
    expect(po.lines[0]!.outstanding).toBe('3');
    // Line 2 never arrived at all.
    expect(po.lines[1]!.outstanding).toBe('200');
    expect(po.totalOutstanding).toBe('203');
  });

  it('keeps production reject out of sellable stock', () => {
    expect(totalQuantity(stock, { productId: ids.sugar, status: 'AVAILABLE' })).toBe('450');
    expect(availableStock(stock).some((l) => l.locationId === ids.reject)).toBe(false);
  });

  it('never produces a negative stock line anywhere in the chain', () => {
    // Kept from the original test and NOT relaxed: this per-location check is
    // the only thing that caught the handover/close location bug, and splitting
    // IN PRODUCTION per lane widens the room for that same class of error.
    expect(negativeLines(stock)).toEqual([]);
  });
});

/* ========================================================================
   B · Deep-inspection branch — still valid where a factory switches it on
   ===================================================================== */

describe('deep inspection chain: receipt → inspection → putaway → issue', () => {
  const events = [
    ev('goods_receipt.created', {
      receiptId: 'receipt-2',
      supplierId: ids.supplier,
      receivedAt: '2026-08-16T07:00:00.000Z',
      photoIds: [],
    }),
    ev('goods_receipt.item_added', {
      receiptId: 'receipt-2',
      lineId: 'rl-2',
      productId: ids.flour,
      batchId: ids.batchA,
      batchNo: 'TPG-2608B',
      quantity: '500',
      unit: 'kg',
      locationId: ids.receiving,
      // Deep inspection ON for this item class → the gate reappears.
      landsIn: 'AWAITING INSPECTION',
      defectQuantity: '0',
      defectPhotoIds: [],
    }),
    ev('inspection.decided', {
      receiptLineId: 'rl-2',
      ref: {
        productId: ids.flour,
        batchId: ids.batchA,
        locationId: ids.receiving,
        status: 'AWAITING INSPECTION',
      },
      decision: 'PASS',
      quantity: '400',
      photoIds: [],
    }),
    // Partial pass: the remaining 100 stay in quarantine, not lost.
    ev('inspection.decided', {
      receiptLineId: 'rl-2',
      ref: {
        productId: ids.flour,
        batchId: ids.batchA,
        locationId: ids.receiving,
        status: 'AWAITING INSPECTION',
      },
      decision: 'HOLD',
      quantity: '100',
      reasonCode: 'BELOW_SPEC',
      photoIds: [],
    }),
    ev('putaway.completed', {
      ref: {
        productId: ids.flour,
        batchId: ids.batchA,
        locationId: ids.receiving,
        status: 'AVAILABLE',
      },
      quantity: '400',
      toLocationId: ids.rackA1,
    }),
  ];

  const stock = projectStock(events);

  it('still gates goods behind inspection when the class asks for it', () => {
    expect(totalQuantity(stock, { status: 'AWAITING INSPECTION' })).toBe('0');
    expect(totalQuantity(stock, { status: 'AVAILABLE' })).toBe('400');
  });

  it('keeps the held remainder in quarantine rather than losing it', () => {
    expect(totalQuantity(stock, { status: 'QUARANTINE' })).toBe('100');
  });

  it('never produces a negative stock line', () => {
    expect(negativeLines(stock)).toEqual([]);
  });
});

/* ========================================================================
   C · Tasks — the layer that tells an operator work exists
   ===================================================================== */

describe('task projection', () => {
  const poProgress = projectPurchaseOrder(purchaseOrder, []);

  it('creates an arrival task from the PO ETA before the truck shows up', () => {
    const tasks = projectTasks([], { today: '2026-08-15', purchaseOrders: [poProgress] });
    const arrival = tasks.find((t) => t.type === 'RECEIVE_DELIVERY');
    expect(arrival).toBeDefined();
    expect(arrival!.label).toBe('PO-1042');
    expect(arrival!.status).toBe('UNASSIGNED');
    expect(arrival!.overdue).toBe(false);
  });

  it('does not surface an arrival task that is still days away', () => {
    const tasks = projectTasks([], { today: '2026-08-10', purchaseOrders: [poProgress] });
    expect(tasks.find((t) => t.type === 'RECEIVE_DELIVERY')).toBeUndefined();
  });

  it('locks a task to whoever claimed it first', () => {
    const taskIdValue = `RECEIVE_DELIVERY:${ids.po}`;
    const tasks = projectTasks(
      [
        ev('task.claimed', {
          taskId: taskIdValue,
          taskType: 'RECEIVE_DELIVERY',
          refId: ids.po,
          claimedBy: 'user-budi',
        }),
      ],
      { today: '2026-08-16', purchaseOrders: [poProgress] },
    );
    const arrival = tasks.find((t) => t.id === taskIdValue)!;
    expect(arrival.ownerId).toBe('user-budi');
    expect(arrival.status).toBe('CLAIMED');
  });

  it('returns a released task to the open queue, with the release recorded', () => {
    const taskIdValue = `RECEIVE_DELIVERY:${ids.po}`;
    const tasks = projectTasks(
      [
        ev('task.claimed', {
          taskId: taskIdValue,
          taskType: 'RECEIVE_DELIVERY',
          refId: ids.po,
          claimedBy: 'user-budi',
        }),
        ev('task.released', {
          taskId: taskIdValue,
          releasedBy: 'user-budi',
          reasonCode: 'SHIFT_ENDED',
        }),
      ],
      { today: '2026-08-16', purchaseOrders: [poProgress] },
    );
    expect(tasks.find((t) => t.id === taskIdValue)!.ownerId).toBeNull();
  });

  it('closes a task from its transaction, with no manual checkbox', () => {
    // One receipt line, one putaway → the putaway task ceases to exist.
    const base = [
      ev('goods_receipt.item_added', {
        receiptId: 'receipt-3',
        lineId: 'rl-3',
        productId: ids.flour,
        batchId: ids.batchA,
        batchNo: 'X',
        quantity: '10',
        unit: 'kg',
        locationId: ids.receiving,
        landsIn: 'AVAILABLE',
        defectQuantity: '0',
        defectPhotoIds: [],
      }),
    ];
    expect(
      projectTasks(base, { today: '2026-08-16' }).some((t) => t.type === 'PUTAWAY'),
    ).toBe(true);

    const done = [
      ...base,
      ev('putaway.completed', {
        ref: {
          productId: ids.flour,
          batchId: ids.batchA,
          locationId: ids.receiving,
          status: 'AVAILABLE',
        },
        quantity: '10',
        toLocationId: ids.rackA1,
      }),
    ];
    expect(
      projectTasks(done, { today: '2026-08-16' }).some((t) => t.type === 'PUTAWAY'),
    ).toBe(false);
  });
});
