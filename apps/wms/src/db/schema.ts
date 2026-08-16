import {
  fromLegacyLevel,
  type Batch,
  type Bom,
  type LegacyLocationLevel,
  type Location,
  type Partner,
  type ProductionLocation,
  type Product,
  type PurchaseOrder,
  type Role,
} from '@fv/contracts';
import Dexie, { type EntityTable } from 'dexie';

/**
 * Local database — the source of truth on the device (Tech Stack §2.1).
 *
 * Not a cache. Transactions are born here, live here for up to 7 days without
 * a server, and stay valid whether or not the server is ever reached (PRD §10).
 * The UI reads through live queries and never waits on the network.
 *
 * EVERY table carries `tenantId` and every query filters on it. Retrofitting
 * multi-tenancy after 40 screens exist means touching all 40 (UI Spec §24).
 */

/** An event as stored locally. Append-only: rows are never updated or deleted. */
export interface StoredEvent {
  id: string; // UUIDv7 — also the log order
  tenantId: string;
  type: string;
  occurredAt: string;
  actorId: string;
  actorRole: Role;
  deviceId: string;
  prevHash: string | null;
  hash: string;
  payload: unknown;
  /** Local bookkeeping, never sent: has the server acknowledged this event? */
  syncedAt: string | null;
}

/** The outbox: what still needs to reach the server. Ingest is idempotent by eventId. */
export interface OutboxEntry {
  eventId: string;
  tenantId: string;
  queuedAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** `blocked` means a conflict needs a human decision (L04), not a retry. */
  state: 'queued' | 'sending' | 'blocked';
}

/** A server-vs-device disagreement a human must resolve (F14, L04). */
export interface ConflictEntry {
  id: string;
  tenantId: string;
  eventId: string;
  detectedAt: string;
  /** Both versions kept whole — L04 shows them side by side, nothing merged silently. */
  localVersion: unknown;
  serverVersion: unknown;
  resolvedAt: string | null;
  resolution: 'keep-local' | 'keep-server' | null;
}

/** Photos are captured offline and uploaded later; blobs never block a save. */
export interface PhotoEntry {
  id: string;
  tenantId: string;
  blob: Blob;
  capturedAt: string;
  uploadedAt: string | null;
}

/** Small key/value store: device id, last sync, tenant term overrides. */
export interface MetaEntry {
  key: string;
  value: unknown;
}

export class FactoryVisionDB extends Dexie {
  events!: EntityTable<StoredEvent, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'eventId'>;
  conflicts!: EntityTable<ConflictEntry, 'id'>;
  photos!: EntityTable<PhotoEntry, 'id'>;
  meta!: EntityTable<MetaEntry, 'key'>;

  // Master data — projections of the server's master records, read constantly.
  products!: EntityTable<Product, 'id'>;
  locations!: EntityTable<Location, 'id'>;
  partners!: EntityTable<Partner, 'id'>;
  batches!: EntityTable<Batch, 'id'>;

  /* --- added in v2 with PRD v1.3 -------------------------------------- */

  /**
   * Purchase orders are precached in full, lines included. Receiving must not
   * wait for a signal (UI Spec §15.3) — an operator with a truck at the door
   * has nowhere to put the delay.
   */
  purchaseOrders!: EntityTable<PurchaseOrder, 'id'>;
  /** Recipes, precached for the same reason: L13 runs fully offline. */
  boms!: EntityTable<Bom, 'id'>;
  /**
   * Line → Machine / Area. Separate table from `locations` because the two
   * behave differently: production locations hold no permanent stock and never
   * join a warehouse stock take, but they are the mandatory destination of
   * every material request (PRD §9.3).
   */
  productionLocations!: EntityTable<ProductionLocation, 'id'>;

  constructor(name = 'factoryvision') {
    super(name);

    this.version(1).stores({
      // `[tenantId+id]` is the replay index: one tenant's log, in order.
      events: 'id, [tenantId+id], [tenantId+type], tenantId, syncedAt',
      outbox: 'eventId, [tenantId+state], queuedAt, state',
      conflicts: 'id, [tenantId+resolvedAt], tenantId',
      photos: 'id, [tenantId+uploadedAt], tenantId',
      meta: 'key',
      products: 'id, [tenantId+sku], [tenantId+itemClass], tenantId',
      locations: 'id, [tenantId+code], [tenantId+parentId], tenantId',
      partners: 'id, [tenantId+code], [tenantId+kind], tenantId',
      batches: 'id, [tenantId+productId], [tenantId+batchNo], [tenantId+expiryDate], tenantId',
    });

    /**
     * v2 — PRD v1.3. Purely additive: no existing table is touched, so an
     * upgrade cannot lose a queued transaction. The event log itself needs no
     * migration at all, which is the dividend of event sourcing: new fields
     * are absent on old events and the projections tolerate that by design.
     */
    this.version(2).stores({
      purchaseOrders: 'id, [tenantId+poNo], [tenantId+supplierId], [tenantId+eta], tenantId',
      boms: 'id, [tenantId+productId], tenantId',
      productionLocations: 'id, [tenantId+code], [tenantId+parentId], tenantId',
    });

    /**
     * v3 — flexible warehouse depth.
     *
     * `Location.level` was a fixed enum (`WAREHOUSE|ZONE|RACK|VIRTUAL`) and is
     * replaced by `depth` + `storable`, with the NAME of each depth moved into
     * tenant configuration (`locationLevels`).
     *
     * The upgrade rewrites existing rows rather than leaving both shapes
     * alive: two ways of saying where a rack is would eventually disagree.
     * No event is touched — `StockRef` only ever stored `locationId`, so the
     * whole movement log survives this untouched. That is the dividend of
     * keeping the log free of master-data shape.
     */
    this.version(3)
      .stores({
        locations: 'id, [tenantId+code], [tenantId+parentId], [tenantId+depth], tenantId',
      })
      .upgrade(async (tx) => {
        await tx
          .table<Location & { level?: LegacyLocationLevel }>('locations')
          .toCollection()
          .modify((location) => {
            if (location.depth !== undefined) return;
            const mapped = fromLegacyLevel(location.level ?? 'RACK');
            location.depth = mapped.depth;
            location.storable = mapped.storable;
            location.virtual = location.virtual ?? mapped.virtual;
            delete location.level;
          });
      });
  }
}

export const db = new FactoryVisionDB();

/** Device identity — stable per browser profile, part of the hash chain. */
export async function getDeviceId(): Promise<string> {
  const existing = await db.meta.get('deviceId');
  if (typeof existing?.value === 'string') return existing.value;
  const id = crypto.randomUUID();
  await db.meta.put({ key: 'deviceId', value: id });
  return id;
}
