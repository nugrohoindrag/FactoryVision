import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Role } from '@fv/contracts';
import { AppError } from '../common/errors.js';
import { log } from '../common/logger.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OtpService } from './otp.service.js';
import { OTP_SENDER, type OtpSender } from './otp-sender.js';
import { hashToken, TokensService } from './tokens.service.js';

/**
 * B-013 → B-022 — the whole way in.
 *
 * The device rules in PRD F13.1 are the reason `Device` is a table rather than
 * a header:
 *
 * | Situation                     | Behaviour                                  |
 * |-------------------------------|--------------------------------------------|
 * | offline + known device        | local session, `Offline — signed in locally`|
 * | offline + new device          | **blocked**, with an explanation            |
 *
 * The second row is the one worth defending. There is nothing on a brand-new
 * device to verify against, and pretending otherwise would mean any phone that
 * knows a factory's name could start writing stock movements while offline and
 * hand them over at the next sync. Refusing is honest; the explanation is what
 * keeps it from feeling like a fault.
 */

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string; role: Role; tenantId: string };
  tenant: { id: string; name: string; readOnly: boolean; trialEndsAt: string };
  deviceId: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Step one of L01. Always reports success.
   *
   * Saying "no account with that number" would turn this endpoint into a
   * directory of which factories use the product and which phone numbers work
   * there. The operator sees the same screen either way; the SMS simply does
   * not arrive for a number that has no account.
   */
  async requestOtp(phone: string): Promise<{ sent: true; expiresInSeconds: number }> {
    const user = await this.prisma.raw.user.findUnique({ where: { phone } });

    if (user && user.active) {
      const { code } = await this.otp.issue(phone, user.tenantId);
      await this.sender.send(phone, code);
    } else {
      log().info({ known: false }, 'OTP requested for an unknown or inactive number');
    }

    return { sent: true, expiresInSeconds: this.env.OTP_TTL_SECONDS };
  }

  /** Step two of L01 — verify the code, register the device, mint a session. */
  async verifyOtp(input: {
    phone: string;
    code: string;
    deviceId: string;
    deviceLabel?: string;
  }): Promise<SessionResult> {
    await this.otp.verify(input.phone, input.code);

    const user = await this.prisma.raw.user.findUnique({ where: { phone: input.phone } });
    if (!user || !user.active) {
      // Only reachable if the account was deactivated between the two steps.
      throw new AppError('UNAUTHENTICATED', 'This account is no longer active');
    }

    const device = await this.registerDevice({
      deviceId: input.deviceId,
      tenantId: user.tenantId,
      userId: user.id,
      label: input.deviceLabel ?? '',
    });

    return this.issueSession(user.id, user.tenantId, user.role, user.name, device.id);
  }

  /**
   * L01 without the code — the trial's way in, and nothing more than that.
   *
   * `verifyOtp` above minus one line: the call that proves the caller owns the
   * number. Everything after it is identical on purpose, so the session, the
   * device registration and the tokens a demo runs on are the same ones the
   * real flow produces, and switching back changes how you sign in rather than
   * what you get.
   *
   * Two guards, because this is the kind of thing that escapes:
   *
   *  - `AUTH_SKIP_OTP` must be set. Absent it, this throws rather than falling
   *    back to something friendlier — a login that quietly weakens itself is
   *    worse than one that stops.
   *  - `loadEnv` refuses the flag outright in production.
   *
   * Neither protects a public deployment running NODE_ENV=development. That is
   * a known and accepted gap for as long as the trial holds no real data; see
   * the note on AUTH_SKIP_OTP in config/env.ts.
   */
  async signInWithoutOtp(input: {
    phone: string;
    deviceId: string;
    deviceLabel?: string;
  }): Promise<SessionResult> {
    if (!this.env.AUTH_SKIP_OTP) {
      throw new AppError('UNAUTHENTICATED', 'Sign-in without a code is not enabled');
    }

    const user = await this.prisma.raw.user.findUnique({ where: { phone: input.phone } });
    if (!user || !user.active) {
      // Deliberately the same message the OTP path gives an unknown number: a
      // login that says "no such account" is a login that enumerates accounts.
      throw new AppError('UNAUTHENTICATED', 'This account is no longer active');
    }

    log().warn(
      { phone: input.phone },
      'Session issued WITHOUT a code — AUTH_SKIP_OTP is on',
    );

    const device = await this.registerDevice({
      deviceId: input.deviceId,
      tenantId: user.tenantId,
      userId: user.id,
      label: input.deviceLabel ?? '',
    });

    return this.issueSession(user.id, user.tenantId, user.role, user.name, device.id);
  }

  /**
   * B-017 — a device is remembered the first time it is used, and stays
   * remembered until somebody revokes it.
   */
  private async registerDevice(input: {
    deviceId: string;
    tenantId: string;
    userId: string;
    label: string;
  }): Promise<{ id: string; known: boolean }> {
    const existing = await this.prisma.raw.device.findUnique({ where: { id: input.deviceId } });

    if (existing) {
      if (existing.revokedAt) {
        throw new AppError(
          'DEVICE_UNKNOWN',
          'This device was signed out by your warehouse head. Ask them to allow it again.',
        );
      }
      if (existing.tenantId !== input.tenantId || existing.userId !== input.userId) {
        // A device id that belongs to another account is not a device we know.
        // Re-issuing it would hand one person's hash chain to another.
        throw new AppError('DEVICE_UNKNOWN', 'This device is registered to a different account');
      }
      await this.prisma.raw.device.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
      return { id: existing.id, known: true };
    }

    await this.prisma.raw.device.create({
      data: {
        id: input.deviceId,
        tenantId: input.tenantId,
        userId: input.userId,
        label: input.label,
      },
    });
    return { id: input.deviceId, known: false };
  }

  async issueSession(
    userId: string,
    tenantId: string,
    role: Role,
    name: string,
    deviceId: string,
  ): Promise<SessionResult> {
    const tenant = await this.prisma.raw.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError('NOT_FOUND', 'Factory not found');

    const sessionId = uuidv7();
    const refresh = this.tokens.newRefreshToken();
    const expiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    await this.prisma.raw.session.create({
      data: {
        id: sessionId,
        tenantId,
        userId,
        deviceId,
        refreshTokenHash: refresh.hash,
        expiresAt,
      },
    });

    const accessToken = await this.tokens.signAccess({
      sub: userId,
      tenantId,
      role,
      deviceId,
      sessionId,
    });

    const now = new Date();
    const readOnly = (tenant.paidUntil ?? tenant.trialEndsAt) <= now;

    return {
      accessToken,
      refreshToken: refresh.token,
      expiresIn: this.env.ACCESS_TOKEN_TTL_MINUTES * 60,
      user: { id: userId, name, role, tenantId },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        readOnly,
        trialEndsAt: tenant.trialEndsAt.toISOString(),
      },
      deviceId,
    };
  }

  /**
   * Rotation. The old token is marked replaced rather than deleted, so a replay
   * of an already-used refresh token is visible instead of merely failing.
   */
  async refresh(refreshToken: string): Promise<SessionResult> {
    const hash = hashToken(refreshToken);
    const session = await this.prisma.raw.session.findFirst({
      where: { refreshTokenHash: hash },
      include: { user: true },
    });

    if (!session) throw new AppError('SESSION_EXPIRED', 'Sign in again to continue');

    if (session.revokedAt || session.expiresAt <= new Date()) {
      if (session.replacedById) {
        // A used token coming back means either a stale client or a stolen one.
        // Both deserve the whole chain gone, not just this link.
        log().warn({ sessionId: session.id }, 'Replay of a rotated refresh token');
        await this.revokeAllForUser(session.userId);
      }
      throw new AppError('SESSION_EXPIRED', 'Sign in again to continue');
    }

    const next = await this.issueSession(
      session.userId,
      session.tenantId,
      session.user.role,
      session.user.name,
      session.deviceId,
    );

    await this.prisma.raw.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: 'rotated' },
    });

    return next;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.raw.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.raw.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
