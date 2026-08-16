import { Controller, Get, Inject } from '@nestjs/common';
import { env, pushConfigured } from '../config/env.js';
import { Public } from '../auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * B-010 — `/health` says the process is up. `/ready` says it can do its job.
 *
 * The clock check is not padding. Event ordering across devices uses the
 * server's clock (Backend Plan §3.2); a server whose clock has drifted will
 * order Monday's receipt after Wednesday's return and produce a stock figure
 * that is wrong in a way nobody can see. If we are going to depend on that
 * clock, we should be willing to look at it.
 */
@Controller()
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  health(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<{
    status: 'ready' | 'degraded';
    checks: Record<string, { ok: boolean; detail?: string }>;
  }> {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      const [row] = await this.prisma.raw.$queryRaw<{ now: Date }[]>`SELECT now() as now`;
      const skewMs = row ? Math.abs(Date.now() - row.now.getTime()) : Number.POSITIVE_INFINITY;
      checks.database = { ok: true };
      checks.clock = {
        ok: skewMs < 5_000,
        detail: `${Math.round(skewMs)}ms between app and database clock`,
      };
    } catch (error) {
      checks.database = { ok: false, detail: error instanceof Error ? error.message : 'unreachable' };
      checks.clock = { ok: false, detail: 'not checked — database unreachable' };
    }

    const e = env();
    checks.storage = {
      ok: Boolean(e.STORAGE_BUCKET),
      detail: e.STORAGE_BUCKET ? undefined : 'object storage not configured — photo upload disabled',
    };
    checks.push = {
      ok: pushConfigured(e),
      detail: pushConfigured(e) ? undefined : 'VAPID keys absent — web push disabled',
    };

    const critical = ['database', 'clock'] as const;
    const status = critical.every((key) => checks[key]?.ok) ? 'ready' : 'degraded';
    return { status, checks };
  }
}
