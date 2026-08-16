import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { log } from '../common/logger.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertService } from './alert.service.js';

/**
 * B-067 — the background pass.
 *
 * A plain interval, not a cron library. What it has to do is "every few
 * minutes, for each factory, work out what is wrong" — a dependency for that
 * would be a dependency to keep alive, upgrade and debug in exchange for
 * scheduling expressiveness nothing here needs.
 *
 * ## What it produces beyond alerts
 *
 * Arrival tasks. A purchase order with an ETA of tomorrow becomes a task in the
 * queue today — that is the whole answer to "how does an operator know goods are
 * coming before the truck reaches the gate" (PRD F24/F25). Tasks are projected
 * rather than stored, so nothing is inserted here; the pass exists so that the
 * ALERT about an unclaimed arrival task fires without anybody opening a screen.
 *
 * ## Why it is off in tests
 *
 * A timer that fires mid-assertion produces failures that reproduce once in
 * twenty runs. `SCHEDULER_ENABLED=false` is set by the test harness, and the
 * same switch is what operations uses to quiet a server during a migration.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AlertService) private readonly alerts: AlertService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (!this.env.SCHEDULER_ENABLED) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.env.SCHEDULER_INTERVAL_SECONDS * 1000);

    // `unref` so a pending timer never holds the process open during a deploy.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over every tenant. Public so operations can force it. */
  async tick(now = new Date()): Promise<{ tenants: number; raised: number }> {
    if (this.running) {
      // A slow pass must not overlap the next one: two passes evaluating the
      // same tenant would both see an alert as new and notify twice.
      log().debug('Scheduler tick skipped — the previous one is still running');
      return { tenants: 0, raised: 0 };
    }

    this.running = true;
    try {
      const tenants = await this.prisma.raw.tenant.findMany({ select: { id: true } });
      let raised = 0;

      for (const tenant of tenants) {
        try {
          const result = await this.alerts.evaluate(tenant.id, now);
          raised += result.raised;
        } catch (error) {
          // One factory's bad data must not stop every other factory's alerts.
          log().error({ err: error, tenantId: tenant.id }, 'Alert evaluation failed');
        }
      }

      return { tenants: tenants.length, raised };
    } finally {
      this.running = false;
    }
  }
}
