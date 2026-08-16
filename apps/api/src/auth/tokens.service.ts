import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Role } from '@fv/contracts';
import { jwtVerify, SignJWT } from 'jose';
import { AppError } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';

/**
 * B-016 — long sessions, rotated refresh tokens.
 *
 * The product decision that shapes this file is in PRD F13.1: **the operator
 * does not sign in again every shift.** Daily login friction is the most common
 * reason a warehouse system gets abandoned, and an abandoned system is worth
 * exactly nothing regardless of how well it is secured.
 *
 * So the access token is short and the refresh window is long — sixty days by
 * default. What makes that safe is not the length, it is rotation: each refresh
 * mints a successor and marks its predecessor replaced, so a stolen refresh
 * token that is used after the real device has refreshed shows up as a replay
 * of a token that already has a successor. That is detectable, and it is the
 * signal worth having.
 */

export interface AccessClaims {
  sub: string;
  tenantId: string;
  role: Role;
  deviceId: string;
  sessionId: string;
}

@Injectable()
export class TokensService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private key(secret = this.env.JWT_SECRET): Uint8Array {
    return new TextEncoder().encode(secret);
  }

  async signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({
      tenantId: claims.tenantId,
      role: claims.role,
      deviceId: claims.deviceId,
      sessionId: claims.sessionId,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer('factoryvision')
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_MINUTES}m`)
      .sign(this.key());
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    // The previous secret stays valid during rotation. With sixty-day sessions,
    // a rotation that invalidated every token immediately would sign out every
    // operator in every factory at once — which is an outage, not a security
    // measure.
    const secrets = [this.env.JWT_SECRET, this.env.JWT_SECRET_PREVIOUS].filter(
      (value): value is string => Boolean(value),
    );

    for (const secret of secrets) {
      try {
        const { payload } = await jwtVerify(token, this.key(secret), { issuer: 'factoryvision' });
        return {
          sub: String(payload.sub),
          tenantId: String(payload.tenantId),
          role: payload.role as Role,
          deviceId: String(payload.deviceId),
          sessionId: String(payload.sessionId),
        };
      } catch {
        continue;
      }
    }

    throw new AppError('SESSION_EXPIRED', 'Sign in again to continue');
  }

  /** Opaque, high-entropy, and stored only as a hash. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashToken(token) };
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
