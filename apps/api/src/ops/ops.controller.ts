import { Controller, Get, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { Requires } from '../auth/public.decorator.js';
import { requireActor } from '../common/request-context.js';
import { ZodQuery } from '../common/zod.js';
import { OpsService } from './ops.service.js';

/**
 * The operations endpoints a factory owner can reach.
 *
 * Deliberately small. `deleteTenant` is NOT here and never will be: an endpoint
 * that erases a factory is an endpoint somebody eventually calls by mistake, so
 * it stays a console operation performed by a person who has read the request.
 */
@Controller('ops')
export class OpsController {
  constructor(@Inject(OpsService) private readonly ops: OpsService) {}

  /**
   * B-085 — who changed what.
   *
   * Owner only. The audit trail names people, and "who deactivated my rack" is a
   * question about a colleague.
   */
  @Get('audit')
  @Requires('user.manage')
  async audit(
    @ZodQuery(
      z.object({
        subject: z.string().optional(),
        subjectId: z.string().optional(),
        limit: z.coerce.number().int().positive().max(1000).optional(),
      }),
    )
    query: { subject?: string; subjectId?: string; limit?: number },
  ) {
    const actor = requireActor();
    return this.ops.auditTrail(actor.tenantId, query);
  }

  /**
   * B-083 — verifies this factory's data is internally consistent.
   *
   * Exposed to the warehouse head because it is also the honest answer to "is
   * my data alright?" after a sync problem: every device's chain intact, and
   * the projection rebuildable to the same numbers.
   */
  @Post('verify')
  @Requires('config.write')
  async verify() {
    const actor = requireActor();
    return this.ops.verifyRestore(actor.tenantId);
  }

  /** B-088 — how long a full replay of this factory takes today. */
  @Post('replay-timing')
  @Requires('config.write')
  async replayTiming() {
    const actor = requireActor();
    return this.ops.replayTiming(actor.tenantId);
  }
}
