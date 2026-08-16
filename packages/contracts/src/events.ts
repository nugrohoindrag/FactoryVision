import { z } from 'zod';
import {
  DefectReason,
  InspectionDecision,
  MaterialIssueStatus,
  Role,
  ShrinkageReason,
  StockStatus,
  TaskType,
} from './enums.js';
import { DateOnly, Quantity, TenantId, Timestamp, UnitCode, UserId, Uuid } from './primitives.js';

/**
 * The event log is the source of truth on the device (Tech Stack §2.1).
 * Events are append-only and never edited: a mistake is corrected by a new
 * event, so the audit trail stays intact (UI Spec §24).
 *
 * Stock, material-issue balances and reports are all PROJECTIONS over this
 * log, computed in @fv/domain. No screen writes a derived number directly.
 */

/** One stock line's identity: product + batch + location + status. */
export const StockRef = z.object({
  productId: Uuid,
  batchId: Uuid.nullable().default(null),
  locationId: Uuid,
  status: StockStatus,
});
export type StockRef = z.infer<typeof StockRef>;

const issueLine = z.object({
  lineId: Uuid,
  productId: Uuid,
  quantity: Quantity,
  unit: UnitCode,
});

export const EventPayloads = {
  /* --- F2 Goods Receipt ------------------------------------------------- */
  'goods_receipt.created': z.object({
    receiptId: Uuid,
    supplierId: Uuid,
    deliveryNoteNo: z.string().optional(),
    receivedAt: Timestamp,
    photoIds: z.array(Uuid).default([]),
    /**
     * Receiving without a PO stays allowed (PRD F24). It is recorded as an
     * exception and surfaces in `Receipts without PO`, but it never stops an
     * operator at the warehouse door — tidiness is pushed by reporting, not
     * by a barrier.
     */
    purchaseOrderId: Uuid.optional(),
  }),
  'goods_receipt.item_added': z.object({
    receiptId: Uuid,
    lineId: Uuid,
    productId: Uuid,
    batchId: Uuid,
    batchNo: z.string().min(1),
    /**
     * The physical count that came off the truck. `defectQuantity` is a part
     * of THIS number, not an addition to it — what enters stock is
     * `quantity − defectQuantity`.
     */
    quantity: Quantity,
    unit: UnitCode,
    expiryDate: DateOnly.optional(),
    locationId: Uuid,
    /**
     * Default path lands straight in AVAILABLE: the operator already inspected
     * the goods while unloading (PRD F3, v1.3). `AWAITING INSPECTION` only
     * appears for item classes with deep inspection switched on.
     */
    landsIn: StockStatus,
    /** Which PO line this fills, so outstanding can be computed. */
    purchaseOrderId: Uuid.optional(),
    purchaseOrderLineId: Uuid.optional(),
    /* --- defect marked by the operator at the door (F2, v1.3) ----------- */
    defectQuantity: Quantity.default('0'),
    /** Mandatory whenever `defectQuantity` is non-zero. */
    defectReason: DefectReason.optional(),
    /** Mandatory too — this is the evidence used to bill the supplier. */
    defectPhotoIds: z.array(Uuid).default([]),
    defectLocationId: Uuid.optional(),
  }),

  /* --- F3 Inspection ---------------------------------------------------- */
  'inspection.decided': z.object({
    receiptLineId: Uuid,
    ref: StockRef,
    decision: InspectionDecision,
    quantity: Quantity,
    reasonCode: z.string().optional(),
    note: z.string().optional(),
    photoIds: z.array(Uuid).default([]),
  }),

  /* --- F4 Putaway ------------------------------------------------------- */
  'putaway.completed': z.object({
    ref: StockRef,
    quantity: Quantity,
    toLocationId: Uuid,
  }),

  /* --- F5 Material Issue ------------------------------------------------ */
  'material_issue.requested': z.object({
    issueId: Uuid,
    /** Skippable (PRD §14.1): many IKM have no work-order system at all. */
    workOrderNo: z.string().default(''),
    requestedBy: UserId,
    /** `Quick issue` skips the queue; it is a mode, not a separate document. */
    quick: z.boolean().default(false),
    /**
     * MANDATORY, including on `Quick issue` — the one field quick mode may not
     * skip. Without an address, `IN PRODUCTION` collapses back into a single
     * blob and M2 stays unsolved (PRD F5).
     */
    destinationId: Uuid,
    /** What is being made, when the request came from a BOM. */
    productId: Uuid.optional(),
    plannedQuantity: Quantity.optional(),
    /**
     * Standard per line AT THE MOMENT OF REQUEST — a copy, never a live link
     * to the BOM. A live link would make last month's variance change every
     * time a recipe is corrected (Tech Stack §2.8c).
     */
    bomStandard: z
      .array(z.object({ lineId: Uuid, standardQuantity: Quantity }))
      .default([]),
    lines: z.array(issueLine).min(1),
  }),
  'material_issue.prepared': z.object({
    issueId: Uuid,
    picks: z
      .array(
        z.object({
          lineId: Uuid,
          ref: StockRef,
          quantity: Quantity,
          /** FEFO suggestion overridden → reason is mandatory (L15). */
          fefoOverrideReason: z.string().optional(),
        }),
      )
      .min(1),
  }),
  'material_issue.handed_over': z.object({
    issueId: Uuid,
    handedOverBy: UserId,
    receivedBy: UserId,
    toLocationId: Uuid,
  }),

  /* --- F6 Closing the issue -------------------------------------------- */
  'material_issue.returned': z.object({
    issueId: Uuid,
    returns: z
      .array(z.object({ lineId: Uuid, ref: StockRef, quantity: Quantity, toLocationId: Uuid }))
      .min(1),
  }),
  'material_issue.closed': z.object({
    issueId: Uuid,
    /** Shrinkage always carries a reason — without it the variance report is noise. */
    shrinkage: z
      .array(
        z.object({
          lineId: Uuid,
          quantity: Quantity,
          reason: ShrinkageReason,
          note: z.string().optional(),
          photoIds: z.array(Uuid).default([]),
        }),
      )
      .default([]),
    /** Never forced to CLOSED — unexplained remainder stays PARTIALLY CLOSED. */
    resultingStatus: MaterialIssueStatus,
  }),

  /* --- F7 Production receipt ------------------------------------------- */
  'production.output_submitted': z.object({
    productId: Uuid,
    batchId: Uuid,
    batchNo: z.string().min(1),
    quantity: Quantity,
    unit: UnitCode,
    productionDate: DateOnly,
    expiryDate: DateOnly.optional(),
    rejectQuantity: Quantity.default('0'),
    rejectLocationId: Uuid.optional(),
    linkedIssueId: Uuid.optional(),
    locationId: Uuid,
    landsIn: StockStatus,
  }),

  /* --- F8 Shipment ------------------------------------------------------ */
  'shipment.created': z.object({
    shipmentId: Uuid,
    customerId: Uuid,
    lines: z.array(issueLine).min(1),
  }),
  'shipment.picked': z.object({
    shipmentId: Uuid,
    picks: z.array(z.object({ lineId: Uuid, ref: StockRef, quantity: Quantity })).min(1),
  }),
  'shipment.loaded': z.object({ shipmentId: Uuid, photoIds: z.array(Uuid).default([]) }),
  'shipment.shipped': z.object({ shipmentId: Uuid, shippedAt: Timestamp }),

  /* --- F9 Adjustment ---------------------------------------------------- */
  'stock.adjusted': z.object({
    ref: StockRef,
    /** Signed: `-2.5` writes stock down. Approval threshold lives in K14. */
    delta: z.string().regex(/^-?\d+(\.\d+)?$/),
    reasonCode: z.string().min(1),
    note: z.string().optional(),
    approvedBy: UserId.optional(),
  }),

  /* --- F10 Stock take --------------------------------------------------- */
  'stock_take.session_created': z.object({
    sessionId: Uuid,
    scopeLocationIds: z.array(Uuid).min(1),
    countedBy: z.array(UserId).min(1),
  }),
  'stock_take.counted': z.object({
    sessionId: Uuid,
    ref: StockRef,
    /** Blind: the counter never saw the system figure (L23). */
    countedQuantity: Quantity,
    countedBy: UserId,
    round: z.number().int().min(1).default(1),
  }),
  'stock_take.approved': z.object({
    sessionId: Uuid,
    approvedBy: UserId,
    /** Approving a variance posts the adjustments; the count itself never does. */
    adjustments: z.array(z.object({ ref: StockRef, delta: z.string() })).default([]),
  }),

  /* --- F24 Purchase Order ----------------------------------------------- */
  /**
   * Closing a PO that still has outstanding quantity. This is the P0 route for
   * settling defect remainders while supplier returns (F17) are still P1 —
   * hence the mandatory reason and the audit trail (PRD §14.9).
   */
  'purchase_order.closed': z.object({
    purchaseOrderId: Uuid,
    reasonCode: z.string().min(1),
    note: z.string().optional(),
  }),

  /* --- F25 Tasks --------------------------------------------------------- */
  /**
   * Tasks are PROJECTED from the work that exists (an unreceived PO, an
   * unprepared request…), so they need no creation event. What needs
   * recording is ownership — who took what, and when.
   *
   * `taskId` is derived and deterministic (`type:refId`), which is what lets a
   * claim refer to a task nobody ever explicitly created.
   */
  'task.claimed': z.object({
    taskId: z.string().min(1),
    taskType: TaskType,
    refId: z.string().min(1),
    claimedBy: UserId,
  }),
  'task.assigned': z.object({
    taskId: z.string().min(1),
    taskType: TaskType,
    refId: z.string().min(1),
    assignedTo: UserId,
    assignedBy: UserId,
  }),
  /** Letting go of a task is legitimate; letting go silently is not. */
  'task.released': z.object({
    taskId: z.string().min(1),
    releasedBy: UserId,
    reasonCode: z.string().min(1),
    note: z.string().optional(),
  }),
} as const;

export type EventType = keyof typeof EventPayloads;
export const EVENT_TYPES = Object.keys(EventPayloads) as EventType[];

/**
 * Envelope. `id` is UUIDv7 so events sort by creation time without a clock
 * field, and `prevHash` chains them so a tampered or dropped event is
 * detectable on ingest.
 */
export const EventEnvelope = z.object({
  id: Uuid,
  tenantId: TenantId,
  type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
  /** Device clock. Trusted for ordering within a device, not across devices. */
  occurredAt: Timestamp,
  actorId: UserId,
  actorRole: Role,
  deviceId: z.string().min(1),
  /** Hash of the previous event on THIS device, `null` for the first one. */
  prevHash: z.string().nullable(),
  hash: z.string(),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/** Envelope narrowed to one event type. */
export type Event<T extends EventType> = Omit<EventEnvelope, 'type' | 'payload'> & {
  type: T;
  payload: z.infer<(typeof EventPayloads)[T]>;
};

/**
 * Discriminated union over every event type — switching on `type` narrows
 * `payload`, which is what makes the stock projection type-safe.
 */
export type AnyEvent = { [K in EventType]: Event<K> }[EventType];

/** Validates the envelope AND the payload for its type. */
export function parseEvent(input: unknown): AnyEvent {
  const envelope = EventEnvelope.parse(input);
  const payload = EventPayloads[envelope.type].parse(envelope.payload);
  return { ...envelope, payload } as AnyEvent;
}
