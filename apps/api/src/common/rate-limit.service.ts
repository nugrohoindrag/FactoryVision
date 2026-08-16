import { Injectable } from '@nestjs/common';
import { AppError } from './errors.js';

/**
 * B-023 — layered rate limiting.
 *
 * In-process and deliberately so. This is one API server in front of one
 * factory database; a Redis dependency would add an operational component whose
 * failure mode is "the whole product stops" in exchange for correctness that
 * nothing here needs yet. When the API is scaled horizontally this moves to a
 * shared store, and the interface below does not change.
 *
 * What it protects:
 *
 * - **Per phone number** — the OTP flow. Somebody guessing codes at a number.
 * - **Per IP** — the OTP flow again, from the other direction: somebody walking
 *   through numbers looking for one that exists.
 * - **Per tenant** — sync ingest, so one device with a stuck retry loop cannot
 *   crowd out the other twenty-nine phones in the same factory.
 *
 * A rate limit that stops an operator from working is worse than no rate limit,
 * so the transaction path (ingest) has a ceiling high enough that a week of
 * offline queue drains in one go without touching it.
 */

interface Bucket {
  hits: number;
  resetAt: number;
}

export interface LimitRule {
  /** Requests allowed inside the window. */
  limit: number;
  windowSeconds: number;
}

export const LIMITS = {
  otpRequest: { limit: 5, windowSeconds: 15 * 60 },
  otpVerify: { limit: 10, windowSeconds: 15 * 60 },
  register: { limit: 5, windowSeconds: 60 * 60 },
  /** 7 days offline × ~50 events per batch still fits comfortably. */
  syncIngest: { limit: 600, windowSeconds: 60 },
  syncPull: { limit: 600, windowSeconds: 60 },
  general: { limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, LimitRule>;

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  /** Throws `RATE_LIMITED` with the wait in seconds — never a bare 429. */
  hit(key: string, rule: LimitRule, now = Date.now()): void {
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { hits: 1, resetAt: now + rule.windowSeconds * 1000 });
      this.sweep(now);
      return;
    }

    bucket.hits += 1;
    if (bucket.hits > rule.limit) {
      const seconds = Math.ceil((bucket.resetAt - now) / 1000);
      throw new AppError(
        'RATE_LIMITED',
        `Too many requests. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
        { retryAfterSeconds: seconds },
      );
    }
  }

  /** Successful login clears the counter — the caller proved they are real. */
  clear(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Drops every counter.
   *
   * Used by the test harness between cases and available to operations when a
   * factory is locked out by a misconfigured limit — the alternative is
   * restarting the API to let one warehouse back in.
   */
  resetAll(): void {
    this.buckets.clear();
  }

  /** Expired buckets are dropped opportunistically; no timer to leak. */
  private sweep(now: number): void {
    if (this.buckets.size < 5_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
