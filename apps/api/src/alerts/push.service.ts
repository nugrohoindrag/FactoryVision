import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Role } from '@fv/contracts';
import webpush from 'web-push';
import { AppError } from '../common/errors.js';
import { log } from '../common/logger.js';
import { ENV, pushConfigured, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * B-064 / B-065 — Web Push.
 *
 * The alerts that matter are useless if they only exist inside an app nobody
 * has open. Push is how an owner finds out in the five minutes a day PRD F12
 * budgets them, rather than at month end.
 *
 * **Android Chrome only.** iOS is deferred at PRD §10 and this is one of the
 * places that decision has a visible cost. It is stated in the settings screen
 * rather than discovered.
 *
 * ## Who gets what
 *
 * Not everyone gets everything, and that is the difference between a system
 * people keep notifications on for and one they mute in week two. The owner
 * wants the money questions — an issue nobody closed, an adjustment waiting for
 * approval. The operator wants work. Nobody wants every putaway.
 */

const AUDIENCE: Record<string, Role[]> = {
  ISSUE_OVERDUE: ['OWNER', 'WAREHOUSE_HEAD'],
  STOCKTAKE_VARIANCE: ['OWNER', 'WAREHOUSE_HEAD'],
  BELOW_MINIMUM: ['WAREHOUSE_HEAD', 'OWNER'],
  EXPIRING_SOON: ['WAREHOUSE_HEAD'],
  QUARANTINE_AGEING: ['WAREHOUSE_HEAD', 'QC'],
  DEAD_STOCK: ['OWNER'],
  PO_OVERDUE: ['WAREHOUSE_HEAD', 'OWNER'],
  PO_PARTIAL_STALE: ['WAREHOUSE_HEAD', 'OWNER'],
  TASK_UNCLAIMED: ['WAREHOUSE_HEAD'],
  APPROVAL_PENDING: ['OWNER'],
};

@Injectable()
export class PushService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    if (pushConfigured(this.env)) {
      webpush.setVapidDetails(
        this.env.VAPID_SUBJECT,
        this.env.VAPID_PUBLIC_KEY!,
        this.env.VAPID_PRIVATE_KEY!,
      );
    }
  }

  /** The key the service worker needs to subscribe. */
  publicKey(): string {
    if (!pushConfigured(this.env)) {
      // Says so plainly rather than returning an empty string the client would
      // fail on later with something unreadable. A notification system that
      // silently does nothing is worse than one that says it is not ready.
      throw new AppError('NOT_CONFIGURED', 'Push notifications are not set up on this server');
    }
    return this.env.VAPID_PUBLIC_KEY!;
  }

  async subscribe(input: {
    tenantId: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }): Promise<void> {
    await this.prisma.raw.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        id: uuidv7(),
        tenantId: input.tenantId,
        userId: input.userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
      },
      // Re-subscribing on the same endpoint after a browser refresh must not
      // create a second row, or the owner gets everything twice.
      update: { p256dh: input.p256dh, auth: input.auth, failedAt: null, userId: input.userId },
    });
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.prisma.raw.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /** Sends one alert to the roles that care about it. Returns how many landed. */
  async notifyTenant(
    tenantId: string,
    alert: { kind: string; payload: Record<string, unknown> },
  ): Promise<number> {
    if (!pushConfigured(this.env)) return 0;

    const roles = AUDIENCE[alert.kind] ?? ['WAREHOUSE_HEAD'];
    const users = await this.prisma.raw.user.findMany({
      where: { tenantId, active: true, role: { in: roles } },
      select: { id: true },
    });
    if (users.length === 0) return 0;

    const subscriptions = await this.prisma.raw.pushSubscription.findMany({
      where: { tenantId, userId: { in: users.map((user) => user.id) }, failedAt: null },
    });

    let delivered = 0;

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            title: alert.payload.title ?? 'FactoryVision',
            body: alert.payload.detail ?? '',
            data: { kind: alert.kind, href: alert.payload.href },
          }),
        );
        delivered += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          /**
           * The subscription is dead — the browser was cleared, or the app was
           * removed from the home screen. Deleting it is the correct response;
           * retrying forever means every future alert pays for a phone that no
           * longer exists.
           */
          await this.prisma.raw.pushSubscription.deleteMany({ where: { id: subscription.id } });
          continue;
        }
        // Anything else might be transient. Flag it rather than delete it, so a
        // gateway blip does not silently unsubscribe a factory.
        await this.prisma.raw.pushSubscription.updateMany({
          where: { id: subscription.id },
          data: { failedAt: new Date() },
        });
        log().warn({ status }, 'Push delivery failed');
      }
    }

    return delivered;
  }
}
