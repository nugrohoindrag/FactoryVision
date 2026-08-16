import { Inject, Injectable } from '@nestjs/common';
import type { AnyEvent } from '@fv/contracts';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * B-025 — reading and writing the log.
 *
 * The log is append-only. There is no `update`, no `delete`, and no method on
 * this class that could be persuaded to write one: a mistake is corrected by a
 * new event, which is the property that keeps the audit trail whole and makes
 * offline reconciliation possible at all (PRD §8).
 *
 * In production the same rule is stated to the database itself — `REVOKE UPDATE,
 * DELETE ON event` — because "no code does it" is a promise about today's code.
 * The migration that does this is `20260816_append_only_event`.
 *
 * ## Two orders, and they are different
 *
 * - **Within a device**, order is `id` (UUIDv7, minted on the phone).
 * - **Across devices**, order is `receivedAt` (server clock, stamped here).
 *
 * A warehouse phone can be hours out, so its clock cannot order anything but
 * its own writes. Replay uses `receivedAt`; reports use `occurredAt`. Both are
 * deliberate and both are documented at the point of use (Backend Plan §3.2).
 */
@Injectable()
export class EventStoreService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Every event for a tenant, in replay order. */
  async readLog(tenantId: string): Promise<AnyEvent[]> {
    const rows = await this.prisma.raw.event.findMany({
      where: { tenantId },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomainEvent);
  }

  /** Events after a cursor — the downstream feed and incremental projection. */
  async readSince(
    tenantId: string,
    cursor: { receivedAt: Date; id: string } | null,
    limit: number,
  ): Promise<AnyEvent[]> {
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
      take: limit,
    });
    return rows.map(toDomainEvent);
  }

  /** The last event this device sent us — the head of its hash chain. */
  async chainHead(tenantId: string, deviceId: string): Promise<string | null> {
    const row = await this.prisma.raw.event.findFirst({
      where: { tenantId, deviceId },
      orderBy: { id: 'desc' },
      select: { hash: true },
    });
    return row?.hash ?? null;
  }

  async knownIds(tenantId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.raw.event.findMany({
      where: { tenantId, id: { in: [...ids] } },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  async countFor(tenantId: string): Promise<number> {
    return this.prisma.raw.event.count({ where: { tenantId } });
  }
}

/**
 * A stored row back into the shape `@fv/domain` folds over.
 *
 * The cast is safe because the payload was validated by `parseEvent` on the way
 * IN and the log is immutable — nothing can have changed it since. Validating
 * again on every read would mean parsing 200,000 events to answer one question
 * about a rack.
 */
export function toDomainEvent(row: {
  id: string;
  tenantId: string;
  type: string;
  occurredAt: Date;
  actorId: string;
  actorRole: string;
  deviceId: string;
  prevHash: string | null;
  hash: string;
  payload: unknown;
}): AnyEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    actorId: row.actorId,
    actorRole: row.actorRole,
    deviceId: row.deviceId,
    prevHash: row.prevHash,
    hash: row.hash,
    payload: row.payload,
  } as unknown as AnyEvent;
}
