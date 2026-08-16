import { Controller, Get, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { Requires } from '../auth/public.decorator.js';
import { requireActor } from '../common/request-context.js';
import { ZodQuery } from '../common/zod.js';
import { ProjectorService } from './projector.service.js';

/**
 * Read models over the event log.
 *
 * These exist for the OFFICE shell and for reports. The field shell does not
 * call them — a phone projects its own stock from its own log and never waits
 * on the network for a number it can already compute (Tech Stack §2.1).
 *
 * That distinction is worth keeping in mind when adding to this file: an
 * endpoint that a warehouse phone needs mid-flow is an endpoint that is in the
 * wrong place.
 */
@Controller()
export class ProjectionController {
  constructor(@Inject(ProjectorService) private readonly projector: ProjectorService) {}

  @Get('stock')
  async stock(
    @ZodQuery(z.object({ productId: z.string().uuid().optional() }))
    query: { productId?: string },
  ) {
    const actor = requireActor();
    const levels = await this.projector.stock(actor.tenantId);
    return {
      levels: query.productId
        ? levels.filter((level) => level.productId === query.productId)
        : levels,
    };
  }

  /** B-036 — open issues with age and lane, which is what the dashboard shows. */
  @Get('issues')
  async issues() {
    const actor = requireActor();
    const balances = await this.projector.issues(actor.tenantId);
    return [...balances.values()];
  }

  /** B-035 — status and outstanding, both derived, never stored. */
  @Get('purchase-orders/progress')
  async poProgress() {
    const actor = requireActor();
    return this.projector.purchaseOrders(actor.tenantId);
  }

  /** B-037 — the live queue, including arrival tasks from PO ETAs. */
  @Get('tasks')
  async tasks(
    @ZodQuery(z.object({ today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    query: { today?: string },
  ) {
    const actor = requireActor();
    return this.projector.tasks(actor.tenantId, query.today);
  }

  /**
   * B-032 — throw the materialised stock table away and rebuild it.
   *
   * The recovery command, and the standing proof that the table is only ever a
   * cache. Restricted to the warehouse head because it is a maintenance action,
   * not because it is dangerous: rebuilding cannot lose anything, since the log
   * it rebuilds from is the only thing that was ever authoritative.
   */
  @Post('stock/rebuild')
  @Requires('config.write')
  async rebuild() {
    const actor = requireActor();
    return this.projector.rebuild(actor.tenantId);
  }
}
