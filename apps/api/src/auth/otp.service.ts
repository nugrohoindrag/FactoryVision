import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@fv/contracts';
import { AppError } from '../common/errors.js';
import { log } from '../common/logger.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * B-014 / B-015 — the login code, and the lockout that is counted rather than
 * hoped for.
 *
 * PRD F13.1 fixes the rule: three failures, then fifteen minutes, **with a
 * message that says fifteen minutes**. The second half matters as much as the
 * first. A lockout that says "invalid code" leaves an operator tapping the same
 * four digits at the receiving door while a truck waits, convinced the system
 * is broken. Telling them how long protects the account AND the shift.
 *
 * The code is stored as a hash. It lives for five minutes, so this is not about
 * a database leak being catastrophic — it is that there is no reason to keep a
 * credential in plaintext for five minutes either.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Creates a code for a phone number.
   *
   * Returns the code only so the caller can hand it to a sender. It is never
   * returned to an HTTP client — an endpoint that echoes the OTP is an endpoint
   * that does not need the SMS at all.
   */
  async issue(phone: string, tenantId: string | null): Promise<{ code: string; expiresAt: Date }> {
    const now = new Date();

    const locked = await this.prisma.raw.otpRequest.findFirst({
      where: { phone, lockedUntil: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (locked?.lockedUntil) {
      throw lockoutError(locked.lockedUntil, now);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + this.env.OTP_TTL_SECONDS * 1000);

    // Any earlier live code for this number is retired. Two valid codes at once
    // is two chances for a guess, and it also produces the confusing case where
    // the older SMS still works after the operator asked for a new one.
    await this.prisma.raw.otpRequest.updateMany({
      where: { phone, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });

    await this.prisma.raw.otpRequest.create({
      data: {
        id: uuidv7(),
        tenantId,
        phone,
        codeHash: hashCode(phone, code),
        expiresAt,
      },
    });

    return { code, expiresAt };
  }

  /** Consumes a code. Throws with a code the client can branch on. */
  async verify(phone: string, code: string): Promise<void> {
    const now = new Date();

    const request = await this.prisma.raw.otpRequest.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!request) {
      throw new AppError('OTP_INVALID', 'That code is not valid. Ask for a new one.');
    }
    if (request.lockedUntil && request.lockedUntil > now) {
      throw lockoutError(request.lockedUntil, now);
    }
    if (request.expiresAt <= now) {
      throw new AppError('OTP_EXPIRED', 'That code has expired. Ask for a new one.');
    }

    if (request.codeHash !== hashCode(phone, code)) {
      const attempts = request.attempts + 1;
      const exhausted = attempts >= this.env.OTP_MAX_ATTEMPTS;
      const lockedUntil = exhausted
        ? new Date(now.getTime() + this.env.OTP_LOCKOUT_MINUTES * 60_000)
        : null;

      await this.prisma.raw.otpRequest.update({
        where: { id: request.id },
        data: { attempts, lockedUntil },
      });

      // B-022: a run of failures is the signal worth keeping, not each miss.
      if (exhausted) {
        log().warn({ phone, attempts }, 'OTP lockout triggered');
        throw lockoutError(lockedUntil!, now);
      }

      const left = this.env.OTP_MAX_ATTEMPTS - attempts;
      throw new AppError(
        'OTP_INVALID',
        `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left before a ${this.env.OTP_LOCKOUT_MINUTES}-minute wait.`,
      );
    }

    await this.prisma.raw.otpRequest.update({
      where: { id: request.id },
      data: { consumedAt: now },
    });
  }
}

function lockoutError(until: Date, now: Date): AppError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return new AppError(
    'OTP_LOCKED',
    `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    { retryAfterSeconds: Math.ceil((until.getTime() - now.getTime()) / 1000) },
  );
}

/** Salted by phone so two people who get the same six digits do not collide. */
function hashCode(phone: string, code: string): string {
  return createHash('sha256').update(`${phone}:${code}`).digest('hex');
}
