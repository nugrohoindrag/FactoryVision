import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@fv/contracts';
import { AppError } from '../common/errors.js';
import { currentContext } from '../common/request-context.js';
import { env } from '../config/env.js';
import { toDomainEvent } from '../events/event-store.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantService } from '../tenant/tenant.service.js';

/**
 * B-039 → B-044 — the downstream feed, and the hole it closes.
 *
 * `apps/wms/src/db/sync.ts` states the contract as "the client only ever
 * appends; it never asks the server what the stock level is". That is exactly
 * right for ONE device — and PRD §10 specifies **thirty users per tenant**.
 *
 * Without a downstream feed, the warehouse head creates a purchase order at the
 * office desk and the operator's phone never hears about it. The truck arrives
 * against a PO the receiving screen cannot show. Five sprints of offline-first
 * work sit on top of a warehouse that only ever sees a third of itself.
 *
 * ## What is sent down, and what is not
 *
 * **Events**, not figures. The device applies them to its own log and
 * re-projects. Applying somebody else's event is not a merge — it is an append
 * to the same log, and the projection is deterministic, so both devices end up
 * at the same number without anything being overwritten. PRD F14's rule ("never
 * overwrite a stock balance silently") is kept intact, because nothing is
 * overwritten at all.
 *
 * A stock FIGURE would break that. It would disagree with the transactions
 * still queued in the local outbox, and the operator would watch numbers move
 * for no reason they can see.
 *
 * ## The cursor
 *
 * `receivedAt|id` — server clock plus a tie-break. Safe to repeat, safe to
 * resume, and immune to the device clock being hours out (§3.2).
 */
@Injectable()
export class SyncDownService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  async pullEvents(
    tenantId: string,
    since: string | null,
    limit = env().SYNC_DOWN_PAGE_SIZE,
  ): Promise<{
    events: unknown[];
    cursor: string | null;
    hasMore: boolean;
  }> {
    const cursor = parseCursor(since);

    const rows = await this.prisma.raw.event.findMany({
      where: {
        tenantId,
        ...(cursor
          ? {
              OR: [
                { receivedAt: { gt: cursor.receivedAt } },
                { receivedAt: cursor.receivedAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    await this.rememberCursor(tenantId, last ?? null);

    return {
      // Whole envelopes: the device stores them in its own log unchanged, so
      // the hash chain of the originating device stays verifiable end to end.
      events: page.map((row) => toDomainEvent(row)),
      cursor: last ? formatCursor(last.receivedAt, last.id) : since,
      hasMore,
    };
  }

  /**
   * B-041 — master data as a delta.
   *
   * Master rows have no event log of their own, so "what changed" is answered
   * by comparing a config version and sending the rest whole. That is honest
   * about the size: a factory has 10,000 SKUs, not 200,000 movements, and the
   * whole master set is a few hundred kilobytes. Building a change-tracking
   * layer to save that would be building the wrong thing well.
   */
  async pullMaster(tenantId: string, _since: string | null) {
    const [products, locations, partners, batches, productionLocations, purchaseOrders, boms] =
      await Promise.all([
        this.prisma.raw.product.findMany({ where: { tenantId } }),
        this.prisma.raw.location.findMany({ where: { tenantId } }),
        this.prisma.raw.partner.findMany({ where: { tenantId } }),
        this.prisma.raw.batch.findMany({ where: { tenantId } }),
        this.prisma.raw.productionLocation.findMany({ where: { tenantId } }),
        this.prisma.raw.purchaseOrder.findMany({ where: { tenantId }, include: { lines: true } }),
        this.prisma.raw.bom.findMany({ where: { tenantId }, include: { lines: true } }),
      ]);

    const { config, version } = await this.tenants.config(tenantId);
    const canSeePrices = this.canSeePrices();

    return {
      config,
      configVersion: version,
      products: products.map((product) => ({
        id: product.id,
        tenantId: product.tenantId,
        sku: product.sku,
        name: product.name,
        itemClass: product.itemClass,
        baseUnit: product.baseUnit,
        conversions: product.conversions,
        shelfLifeDays: product.shelfLifeDays ?? undefined,
        minimumStock: product.minimumStock?.toString(),
        // B-019 — purchase prices are hidden at the serialisation layer, not in
        // a component. A field that leaves the server is a field somebody can
        // read in the network tab.
        averageCost: canSeePrices ? product.averageCost?.toString() : undefined,
        active: product.active,
      })),
      locations: locations.map((location) => ({
        id: location.id,
        tenantId: location.tenantId,
        code: location.code,
        name: location.name,
        parentId: location.parentId,
        depth: location.depth,
        storable: location.storable,
        virtual: location.virtual,
        active: location.active,
      })),
      partners,
      batches: batches.map((batch) => ({
        ...batch,
        producedOn: batch.producedOn ? iso(batch.producedOn) : undefined,
        expiryDate: batch.expiryDate ? iso(batch.expiryDate) : undefined,
      })),
      productionLocations,
      purchaseOrders: purchaseOrders.map((po) => ({
        id: po.id,
        tenantId: po.tenantId,
        poNo: po.poNo,
        supplierId: po.supplierId,
        orderDate: iso(po.orderDate),
        eta: iso(po.eta),
        note: po.note ?? undefined,
        cancelled: po.cancelled,
        lines: po.lines.map((line) => ({
          id: line.id,
          productId: line.productId,
          quantityOrdered: line.quantityOrdered.toString(),
          unit: line.unit,
          unitPrice: canSeePrices ? line.unitPrice?.toString() : undefined,
        })),
      })),
      boms: boms.map((bom) => ({
        id: bom.id,
        tenantId: bom.tenantId,
        productId: bom.productId,
        outputQuantity: bom.outputQuantity.toString(),
        outputUnit: bom.outputUnit,
        verified: bom.verified,
        lines: bom.lines.map((line) => ({
          id: line.id,
          productId: line.productId,
          standardQuantity: line.standardQuantity.toString(),
          unit: line.unit,
          standardShrinkagePct: line.standardShrinkagePct?.toString(),
        })),
      })),
    };
  }

  /**
   * B-042 — one response for a device that knows nothing yet.
   *
   * A phone that has just been signed in has an empty database and usually one
   * bar of signal. Making it discover the warehouse through a dozen paginated
   * calls is how onboarding fails in the car park.
   */
  async bootstrap(tenantId: string, userId: string) {
    const master = await this.pullMaster(tenantId, null);
    const first = await this.pullEvents(tenantId, null, env().SYNC_DOWN_PAGE_SIZE);

    return {
      ...master,
      events: first.events,
      cursor: first.cursor,
      hasMore: first.hasMore,
      me: userId,
    };
  }

  private canSeePrices(): boolean {
    const role = currentContext()?.actorRole;
    return role === 'OWNER' || role === 'WAREHOUSE_HEAD';
  }

  /**
   * Remembers where this device has read to.
   *
   * Kept server-side as well as on the device so a phone that loses its local
   * database can be told the truth about what it already had, instead of being
   * handed the whole log again over 3G.
   */
  private async rememberCursor(
    tenantId: string,
    last: { receivedAt: Date; id: string } | null,
  ): Promise<void> {
    const deviceId = currentContext()?.deviceId;
    if (!deviceId || !last) return;

    await this.prisma.raw.syncCursor.upsert({
      where: { tenantId_deviceId: { tenantId, deviceId } },
      create: {
        id: uuidv7(),
        tenantId,
        deviceId,
        lastReceived: last.receivedAt,
        lastEventId: last.id,
      },
      update: { lastReceived: last.receivedAt, lastEventId: last.id },
    });
  }
}

function parseCursor(value: string | null): { receivedAt: Date; id: string } | null {
  if (!value) return null;
  const [timestamp, id] = value.split('|');
  const receivedAt = timestamp ? new Date(timestamp) : null;

  if (!receivedAt || Number.isNaN(receivedAt.getTime()) || !id) {
    // A bad cursor is never treated as "start from the beginning". Silently
    // replaying the whole log over 3G is worse than an error the client can
    // handle by asking for a bootstrap.
    throw new AppError('CURSOR_INVALID', 'That sync cursor is not one we issued — start again');
  }

  return { receivedAt, id };
}

function formatCursor(receivedAt: Date, id: string): string {
  return `${receivedAt.toISOString()}|${id}`;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
