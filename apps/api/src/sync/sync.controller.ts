import { Controller, Get, Inject, Post } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../common/errors.js';
import { Req } from '../common/http.js';
import { requireActor } from '../common/request-context.js';
import { LIMITS, RateLimitService } from '../common/rate-limit.service.js';
import { ZodBody, ZodQuery } from '../common/zod.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Requires, Write } from '../auth/public.decorator.js';
import { IngestService, type IngestResult } from './ingest.service.js';
import { SyncDownService } from './sync-down.service.js';

/**
 * The sync surface. Two directions, and they are not symmetrical.
 *
 * **Up** is a stream of events the device already treats as done. The server's
 * job is to take them, or to say precisely why it cannot.
 *
 * **Down** is a stream of events other devices wrote. The device applies them
 * to its own log and re-projects. It never receives a stock figure — a figure
 * pulled from the server would disagree with the transactions still sitting in
 * the local outbox, and the operator would watch their stock change for no
 * visible reason (Backend Plan §3.1).
 */

const IngestBody = z.object({
  events: z.array(z.unknown()),
});

const PullQuery = z.object({
  /** `<iso timestamp>|<event id>`. Opaque to the client, ordered on the server. */
  since: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

@Controller('sync')
export class SyncController {
  constructor(
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(SyncDownService) private readonly down: SyncDownService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  /**
   * B-026 — the endpoint `drainOutbox` has been calling into a stub since
   * Sprint 2 of the UI plan.
   */
  @Post('events')
  @Write()
  @Requires('event.append')
  async push(
    @ZodBody(IngestBody) body: z.infer<typeof IngestBody>,
    @Req() request: FastifyRequest,
  ): Promise<IngestResult> {
    const actor = requireActor();
    this.limits.hit(`sync:${actor.tenantId}`, LIMITS.syncIngest);

    const max = env().SYNC_MAX_BATCH;
    if (body.events.length > max) {
      // The client batches at 50. A larger batch is a client that has drifted
      // from the contract, and accepting it silently would hide that.
      throw new AppError(
        'BATCH_TOO_LARGE',
        `Send at most ${max} events per request — this batch had ${body.events.length}`,
      );
    }

    void request;
    return this.ingest.ingest(body.events);
  }

  /** B-040 — the downstream feed. */
  @Get('events')
  async pull(@ZodQuery(PullQuery) query: z.infer<typeof PullQuery>) {
    const actor = requireActor();
    this.limits.hit(`pull:${actor.tenantId}`, LIMITS.syncPull);
    return this.down.pullEvents(actor.tenantId, query.since ?? null, query.limit);
  }

  /** B-041 — master data, purchase orders, recipes and configuration. */
  @Get('master')
  async master(@ZodQuery(PullQuery) query: z.infer<typeof PullQuery>) {
    const actor = requireActor();
    this.limits.hit(`pull:${actor.tenantId}`, LIMITS.syncPull);
    return this.down.pullMaster(actor.tenantId, query.since ?? null);
  }

  /**
   * B-042 — everything a brand-new device needs, in one response.
   *
   * A phone that has just been signed in has an empty database and, very often,
   * one bar of signal. Making it discover the warehouse through twelve
   * paginated calls is how onboarding fails in the car park.
   */
  @Get('bootstrap')
  async bootstrap() {
    const actor = requireActor();
    return this.down.bootstrap(actor.tenantId, actor.actorId);
  }

  /** B-045 — the conflict queue behind L04, with both versions kept whole. */
  @Get('conflicts')
  async conflicts() {
    const actor = requireActor();
    const rows = await this.prisma.raw.conflict.findMany({
      where: { tenantId: actor.tenantId, resolvedAt: null },
      orderBy: { detectedAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      reason: row.reason,
      detectedAt: row.detectedAt.toISOString(),
      incomingEvent: row.incomingEvent,
      serverVersion: row.serverVersion,
    }));
  }

  @Post('conflicts/resolve')
  @Write()
  @Requires('conflict.resolve')
  async resolveConflict(
    @ZodBody(
      z.object({
        conflictId: z.string().uuid(),
        resolution: z.enum(['keep-local', 'keep-server']),
      }),
    )
    body: { conflictId: string; resolution: 'keep-local' | 'keep-server' },
  ) {
    const actor = requireActor();
    const conflict = await this.prisma.raw.conflict.findFirst({
      where: { id: body.conflictId, tenantId: actor.tenantId },
    });
    if (!conflict) throw new AppError('NOT_FOUND', 'That conflict is not on this factory');

    await this.prisma.raw.conflict.updateMany({
      where: { id: body.conflictId },
      data: { resolvedAt: new Date(), resolution: body.resolution },
    });

    /**
     * `keep-local` does NOT re-ingest here.
     *
     * The client re-queues the event and sends it again, which puts it back
     * through every check rather than around them. Re-admitting it server-side
     * would mean writing a second path into the log that skips the hash chain —
     * and a second way into an append-only log is how the first corrupt entry
     * gets in.
     */
    return { ok: true, resubmit: body.resolution === 'keep-local' };
  }
}
