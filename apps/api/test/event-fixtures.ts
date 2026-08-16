import { hashEvent, uuidv7, type AnyEvent, type EventType, type Role } from '@fv/contracts';

/**
 * A realistic factory day, written the way a device writes it.
 *
 * Built with the SAME hash function the client uses (`@fv/contracts`), so these
 * events are indistinguishable from ones a phone produced — which is the point.
 * A fixture that skips the chain would let ingest pass a test it would fail in
 * the warehouse.
 *
 * The chain is per device, so `chainFor` tracks a head per device id. Two
 * devices writing at once is the normal case in a factory with thirty users,
 * not an edge case worth a separate test.
 */

export interface Builder {
  deviceId: string;
  actorId: string;
  actorRole: Role;
  tenantId: string;
}

const heads = new Map<string, string | null>();

export function resetChains(): void {
  heads.clear();
}

export async function makeEvent<T extends EventType>(
  builder: Builder,
  type: T,
  payload: unknown,
  occurredAt = new Date().toISOString(),
): Promise<AnyEvent> {
  const prevHash = heads.get(builder.deviceId) ?? null;
  const draft = {
    id: uuidv7(),
    tenantId: builder.tenantId,
    type,
    occurredAt,
    actorId: builder.actorId,
    deviceId: builder.deviceId,
    prevHash,
    payload,
  };
  const hash = await hashEvent(draft);
  heads.set(builder.deviceId, hash);
  return { ...draft, actorRole: builder.actorRole, hash } as unknown as AnyEvent;
}

export interface FactoryIds {
  productId: string;
  batchId: string;
  rackId: string;
  laneId: string;
  supplierId: string;
  issueId: string;
  lineId: string;
  poId: string;
  poLineId: string;
  receiptId: string;
}

export function ids(): FactoryIds {
  return {
    productId: crypto.randomUUID(),
    batchId: crypto.randomUUID(),
    rackId: crypto.randomUUID(),
    laneId: crypto.randomUUID(),
    supplierId: crypto.randomUUID(),
    issueId: crypto.randomUUID(),
    lineId: crypto.randomUUID(),
    poId: crypto.randomUUID(),
    poLineId: crypto.randomUUID(),
    receiptId: crypto.randomUUID(),
  };
}

/**
 * The chain the product exists for: goods in against a PO, out to a lane,
 * partly returned, the rest written off as shrinkage, issue closed.
 *
 * 100 kg received (2 kg defect) → 98 available → 90 issued to Lane 1 →
 * 8 returned → 0.5 shrinkage → 81.5 consumed.
 *
 * These are the numbers PRD M2 is about, and the decimal is there on purpose:
 * `0.1 + 0.2 !== 0.3` is why quantities are strings all the way through
 * (Tech Stack §2.4).
 */
export async function factoryDay(
  operator: Builder,
  production: Builder,
  f: FactoryIds,
): Promise<AnyEvent[]> {
  const events: AnyEvent[] = [];

  events.push(
    await makeEvent(operator, 'goods_receipt.created', {
      receiptId: f.receiptId,
      supplierId: f.supplierId,
      deliveryNoteNo: 'SJ-001',
      receivedAt: new Date().toISOString(),
      photoIds: [],
      purchaseOrderId: f.poId,
    }),
  );

  events.push(
    await makeEvent(operator, 'goods_receipt.item_added', {
      receiptId: f.receiptId,
      lineId: crypto.randomUUID(),
      productId: f.productId,
      batchId: f.batchId,
      batchNo: 'LOT-2026-08',
      quantity: '100',
      unit: 'kg',
      locationId: f.rackId,
      landsIn: 'AVAILABLE',
      purchaseOrderId: f.poId,
      purchaseOrderLineId: f.poLineId,
      // Part of the 100, not on top of it (PRD F2 v1.3).
      defectQuantity: '2',
      defectReason: 'DAMAGED_IN_TRANSIT',
      defectPhotoIds: [],
      defectLocationId: f.rackId,
    }),
  );

  events.push(
    await makeEvent(production, 'material_issue.requested', {
      issueId: f.issueId,
      workOrderNo: 'WO-1',
      requestedBy: production.actorId,
      quick: false,
      destinationId: f.laneId,
      productId: f.productId,
      plannedQuantity: '100',
      bomStandard: [{ lineId: f.lineId, standardQuantity: '90' }],
      lines: [{ lineId: f.lineId, productId: f.productId, quantity: '90', unit: 'kg' }],
    }),
  );

  events.push(
    await makeEvent(operator, 'material_issue.prepared', {
      issueId: f.issueId,
      picks: [
        {
          lineId: f.lineId,
          ref: { productId: f.productId, batchId: f.batchId, locationId: f.rackId, status: 'AVAILABLE' },
          quantity: '90',
        },
      ],
    }),
  );

  events.push(
    await makeEvent(operator, 'material_issue.handed_over', {
      issueId: f.issueId,
      handedOverBy: operator.actorId,
      receivedBy: production.actorId,
      toLocationId: f.laneId,
    }),
  );

  events.push(
    await makeEvent(production, 'material_issue.returned', {
      issueId: f.issueId,
      returns: [
        {
          lineId: f.lineId,
          ref: { productId: f.productId, batchId: f.batchId, locationId: f.laneId, status: 'IN PRODUCTION' },
          quantity: '8',
          toLocationId: f.rackId,
        },
      ],
    }),
  );

  events.push(
    await makeEvent(production, 'material_issue.closed', {
      issueId: f.issueId,
      shrinkage: [{ lineId: f.lineId, quantity: '0.5', reason: 'SPILLAGE', photoIds: [] }],
      resultingStatus: 'CLOSED',
    }),
  );

  return events;
}
