import { Inject, Injectable } from '@nestjs/common';
import {
  EventEnvelope,
  EventPayloads,
  hashEvent,
  uuidv7,
  type AnyEvent,
  type EventType,
} from '@fv/contracts';
import { resolveClaims, StockProjector } from '@fv/domain';
import { canAppend } from '../auth/permissions.js';
import { log } from '../common/logger.js';
import { requireActor } from '../common/request-context.js';
import { EventStoreService } from '../events/event-store.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectorService } from '../projection/projector.service.js';
import { detectConflict, type ServerState } from './conflict-rules.js';

/**
 * B-026 → B-030 — the ingest endpoint's brain.
 *
 * The contract was written five sprints ago, in `apps/wms/src/db/sync.ts`, and
 * the client has been shipping against it since. This is the other half:
 *
 * 1. **Append only.** The client sends events; it never asks what the stock
 *    level is. A device that has not synced for a week is still correct about
 *    its own warehouse.
 * 2. **Idempotent by `eventId`.** Retrying a send that succeeded but whose
 *    response was lost must not create a second receipt. On 3G under a metal
 *    roof that is the normal case, not the edge case.
 * 3. **No silent conflict resolution.** Both versions are stored whole and the
 *    event stops being retried until a person decides (L04).
 *
 * The response shape matches the client's `IngestResult` exactly. That is not
 * a coincidence and it must not drift.
 *
 * ## Why there is no state on this class
 *
 * Nest providers are singletons. Two operators syncing at the same moment share
 * this instance, so anything held in a field would leak one factory's conflicts
 * into the other's response. Every per-request value lives in `Batch` below,
 * which is created inside the call and dies with it.
 */

export interface IngestResult {
  accepted: string[];
  conflicts: { eventId: string; serverVersion: unknown }[];
  /** Additive: the client ignores keys it does not know, so this is safe to add. */
  rejected?: { eventId: string; reason: string; message: string }[];
  claimOutcomes?: { taskId: string; winnerId: string; winnerName: string; lost: boolean }[];
}

interface Batch {
  tenantId: string;
  accepted: string[];
  conflicts: { eventId: string; serverVersion: unknown }[];
  rejected: { eventId: string; reason: string; message: string }[];
  claimOutcomes: { taskId: string; winnerId: string; winnerName: string; lost: boolean }[];
  /** Chain head per device, advanced as this batch is admitted. */
  chainHeads: Map<string, string | null>;
  /**
   * Stock lines the server has ever held a balance for. The difference between
   * "this event overdraws a real rack" and "we have not been told about that
   * rack yet" — see the negative check in `admit`.
   */
  knownKeys: Set<string>;
  state: ServerState & { mutableLog: AnyEvent[] };
  stock: StockProjector;
}

@Injectable()
export class IngestService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventStoreService) private readonly store: EventStoreService,
    @Inject(ProjectorService) private readonly projector: ProjectorService,
  ) {}

  async ingest(raw: unknown[]): Promise<IngestResult> {
    const actor = requireActor();

    const rejected: Batch['rejected'] = [];
    // Sorted by id so a device's own chain is admitted in the order it was
    // written, whatever order the array happened to arrive in.
    const parsed = raw
      .map((item) => this.parseOne(item, rejected))
      .filter((event): event is AnyEvent => event !== null)
      .sort((a, b) => (a.id < b.id ? -1 : 1));

    if (parsed.length === 0) {
      return { accepted: [], conflicts: [], ...(rejected.length ? { rejected } : {}) };
    }

    const known = await this.store.knownIds(
      actor.tenantId,
      parsed.map((event) => event.id),
    );

    const batch = await this.openBatch(actor.tenantId, rejected);

    // Point 2: an id already held is ACCEPTED — not stored twice, not rejected.
    // The client's outbox row can go.
    for (const event of parsed) {
      if (known.has(event.id)) batch.accepted.push(event.id);
    }

    for (const event of parsed) {
      if (known.has(event.id)) continue;
      await this.admit(event, batch);
    }

    await this.settleClaims(parsed, batch);

    if (batch.accepted.length > 0) {
      // Projections catch up inside the same request. A dashboard that lags a
      // sync it has just acknowledged is a dashboard nobody believes.
      await this.projector.catchUp(actor.tenantId);
    }

    return {
      accepted: batch.accepted,
      conflicts: batch.conflicts,
      ...(batch.rejected.length > 0 ? { rejected: batch.rejected } : {}),
      ...(batch.claimOutcomes.length > 0 ? { claimOutcomes: batch.claimOutcomes } : {}),
    };
  }

  /** B-028 — envelope and payload, both against the shared schemas. */
  private parseOne(raw: unknown, rejected: Batch['rejected']): AnyEvent | null {
    const envelope = EventEnvelope.safeParse(raw);
    if (!envelope.success) {
      rejected.push({
        eventId: (raw as { id?: string })?.id ?? 'unknown',
        reason: 'EVENT_INVALID',
        message: issues(envelope.error.issues),
      });
      return null;
    }

    const schema = EventPayloads[envelope.data.type as EventType];
    const payload = schema.safeParse(envelope.data.payload);
    if (!payload.success) {
      rejected.push({
        eventId: envelope.data.id,
        reason: 'EVENT_INVALID',
        message: issues(payload.error.issues),
      });
      return null;
    }

    return { ...envelope.data, payload: payload.data } as AnyEvent;
  }

  private async admit(event: AnyEvent, batch: Batch): Promise<void> {
    if (event.tenantId !== batch.tenantId) {
      // A device sending another factory's tenant id is a bug or an attack.
      // Either way it never reaches the log.
      batch.rejected.push({
        eventId: event.id,
        reason: 'TENANT_MISMATCH',
        message: 'This event belongs to a different factory',
      });
      return;
    }

    if (!canAppend(event.actorRole, event.type)) {
      batch.rejected.push({
        eventId: event.id,
        reason: 'ROLE_NOT_PERMITTED',
        message: `A ${event.actorRole.toLowerCase().replace('_', ' ')} cannot record ${event.type}`,
      });
      return;
    }

    /* --- B-027 · the hash chain ---------------------------------------- */
    const expectedPrev = batch.chainHeads.has(event.deviceId)
      ? batch.chainHeads.get(event.deviceId)!
      : await this.store.chainHead(batch.tenantId, event.deviceId);

    if (event.prevHash !== expectedPrev) {
      // Specific, never a 500. A broken chain means an event went missing on
      // the way here, and the client needs to know which link so it can resend
      // the gap instead of the whole week.
      batch.rejected.push({
        eventId: event.id,
        reason: 'HASH_CHAIN_BROKEN',
        message:
          expectedPrev === null
            ? 'This event chains onto something the server has never seen — send the earlier events first'
            : 'An earlier event from this device has not arrived — send it first',
      });
      return;
    }

    if ((await hashEvent(event)) !== event.hash) {
      batch.rejected.push({
        eventId: event.id,
        reason: 'HASH_CHAIN_BROKEN',
        message: 'This event does not match its own hash — it was altered after it was written',
      });
      return;
    }

    /* --- B-029 · conflicts --------------------------------------------- */
    const typed = detectConflict(event, batch.state);
    if (typed.conflicted) {
      await this.recordConflict(event, batch, typed.reason!, typed.serverVersion);
      return;
    }

    /**
     * The negative check, run incrementally: apply the event, look only at the
     * lines it touched, and put it back if anything went below zero. Re-folding
     * the whole log per event would be ten million folds for one phone's week
     * of offline work, with a truck waiting.
     */
    batch.stock.apply(event);
    const negative = batch.stock.negativeFromLast();

    if (negative.length > 0) {
      batch.stock.revert(event);

      /**
       * Two very different situations produce a negative line, and treating
       * them the same is what would make this feature hated.
       *
       * **Events are missing.** Production returns 8 kg from a lane whose
       * handover is still sitting in the warehouse phone's outbox. The server
       * has never seen a positive balance at that location, so the return
       * looks like it came from nowhere. Nothing is wrong: the other device
       * has not reached a tower yet. This resolves itself in ten minutes, and
       * it must NOT land on the warehouse head's conflict screen — a queue
       * full of things that fix themselves is a queue nobody opens, and the
       * four cases that genuinely need a person get lost in it.
       *
       * **The stock genuinely is not there.** A −500 kg write-off against a
       * line the server knows holds 8 kg. That will still be wrong tomorrow,
       * and somebody has to look at it.
       *
       * The server can tell them apart with one cheap question: has this stock
       * line ever existed here? If it has, the event overdraws something real.
       * If it never has, we are simply early.
       */
      const unheardOf = negative.every((line) => !batch.knownKeys.has(line.key));

      if (unheardOf) {
        batch.rejected.push({
          eventId: event.id,
          reason: 'AWAITING_EARLIER_EVENTS',
          message:
            'This refers to stock the server has not been told about yet — usually a ' +
            'transaction still queued on another device. Keep it and send it again shortly.',
        });
        log().info({ eventId: event.id }, 'Ingest deferred: earlier events have not arrived');
        return;
      }

      await this.recordConflict(event, batch, 'WOULD_GO_NEGATIVE', negative);
      return;
    }

    await this.prisma.raw.event.create({
      data: {
        id: event.id,
        tenantId: batch.tenantId,
        type: event.type,
        occurredAt: new Date(event.occurredAt),
        actorId: event.actorId,
        actorRole: event.actorRole,
        deviceId: event.deviceId,
        prevHash: event.prevHash,
        hash: event.hash,
        payload: event.payload as object,
        provenance: 'device',
      },
    });

    batch.chainHeads.set(event.deviceId, event.hash);
    batch.state.mutableLog.push(event);
    for (const key of batch.stock.touchedKeys()) batch.knownKeys.add(key);
    if (event.type === 'purchase_order.closed') {
      (batch.state.closedPurchaseOrders as Set<string>).add(event.payload.purchaseOrderId);
    }
    batch.accepted.push(event.id);

    await this.prisma.raw.device.updateMany({
      where: { id: event.deviceId },
      data: { lastSeenAt: new Date(), lastEventHash: event.hash },
    });
  }

  private async recordConflict(
    event: AnyEvent,
    batch: Batch,
    reason: string,
    serverVersion: unknown,
  ): Promise<void> {
    await this.prisma.raw.conflict.create({
      data: {
        id: uuidv7(),
        tenantId: batch.tenantId,
        eventId: event.id,
        reason,
        // Both versions kept whole — L04 shows them side by side and merges
        // nothing (PRD F14).
        incomingEvent: event as unknown as object,
        serverVersion: (serverVersion ?? null) as object,
      },
    });
    batch.conflicts.push({ eventId: event.id, serverVersion });
    log().warn({ eventId: event.id, reason }, 'Ingest conflict');
  }

  /**
   * B-030 — the claim race.
   *
   * The only automatic conflict resolution in the product, and deliberately so:
   * two people claiming one task is not a data conflict, it is a race that
   * needs a winner. First claim to reach the server takes it.
   *
   * The loser is told **who won, by name**. "This task is already taken" with
   * no name cannot be acted on; the point is that the operator now knows whose
   * shoulder to tap.
   *
   * Their work is not discarded. Anything they already recorded stays in the
   * log and hangs off the task for review, because the physical work really
   * happened. Throwing it away for losing a sync race is the fastest way to
   * lose an operator's trust (Tech Stack §2.8d).
   */
  private async settleClaims(parsed: readonly AnyEvent[], batch: Batch): Promise<void> {
    const claims = parsed.filter((event) => event.type === 'task.claimed');
    if (claims.length === 0) return;

    const winners = resolveClaims(batch.state.mutableLog);
    const users = await this.prisma.raw.user.findMany({
      where: { tenantId: batch.tenantId },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((user) => [user.id, user.name]));

    for (const claim of claims) {
      if (claim.type !== 'task.claimed') continue;
      const winnerId = winners.get(claim.payload.taskId);
      if (!winnerId) continue;

      batch.claimOutcomes.push({
        taskId: claim.payload.taskId,
        winnerId,
        winnerName: names.get(winnerId) ?? 'another operator',
        lost: winnerId !== claim.payload.claimedBy,
      });
    }
  }

  private async openBatch(tenantId: string, rejected: Batch['rejected']): Promise<Batch> {
    const mutableLog = await this.store.readLog(tenantId);
    const closed = await this.prisma.raw.purchaseOrder.findMany({
      where: { tenantId, closedAt: { not: null } },
      select: { id: true },
    });

    const stock = new StockProjector();
    stock.applyAll(mutableLog);

    return {
      knownKeys: stock.allKeys(),
      tenantId,
      accepted: [],
      conflicts: [],
      rejected,
      claimOutcomes: [],
      chainHeads: new Map(),
      state: {
        log: mutableLog,
        mutableLog,
        closedPurchaseOrders: new Set(closed.map((po) => po.id)),
      },
      stock,
    };
  }
}

function issues(list: readonly { path: (string | number)[]; message: string }[]): string {
  return list.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}
