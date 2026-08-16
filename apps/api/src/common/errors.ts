import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * B-006 — one error shape for the whole API.
 *
 * Two audiences, and they need different things from the same response:
 *
 * - **The operator** needs to know whether their work is safe and what to do
 *   next. So `message` is a sentence a person can act on, never a stack trace
 *   and never "Bad Request".
 * - **The client code** needs to branch. So `code` is a stable string, and it
 *   is the thing that must never change quietly — a renamed code is a broken
 *   client that still returns HTTP 200 on its own health check.
 *
 * `retryable` exists because the offline queue asks exactly one question of a
 * failed send: do I keep this in the outbox, or is it never going to succeed?
 * Getting that wrong in either direction loses work — silently retrying a
 * permanently invalid event forever, or dropping one that would have gone
 * through on the next tower.
 */

export type ErrorCode =
  /* generic */
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'NOT_CONFIGURED'
  /* tenancy & access */
  | 'TENANT_MISMATCH'
  | 'TRIAL_READ_ONLY'
  | 'ROLE_NOT_PERMITTED'
  | 'DEVICE_UNKNOWN'
  /* auth */
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_LOCKED'
  | 'SESSION_EXPIRED'
  /* sync & events */
  | 'EVENT_INVALID'
  | 'HASH_CHAIN_BROKEN'
  | 'BATCH_TOO_LARGE'
  | 'CURSOR_INVALID'
  /* master data */
  | 'IN_USE'
  | 'DEPTH_EXCEEDED'
  | 'IMMUTABLE_FIELD';

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
    /** Should the client keep this in its outbox and try again later? */
    retryable: boolean;
  };
}

const STATUS: Record<ErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
  NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  TENANT_MISMATCH: HttpStatus.FORBIDDEN,
  TRIAL_READ_ONLY: HttpStatus.PAYMENT_REQUIRED,
  ROLE_NOT_PERMITTED: HttpStatus.FORBIDDEN,
  DEVICE_UNKNOWN: HttpStatus.FORBIDDEN,
  OTP_INVALID: HttpStatus.UNAUTHORIZED,
  OTP_EXPIRED: HttpStatus.UNAUTHORIZED,
  OTP_LOCKED: HttpStatus.TOO_MANY_REQUESTS,
  SESSION_EXPIRED: HttpStatus.UNAUTHORIZED,
  EVENT_INVALID: HttpStatus.BAD_REQUEST,
  HASH_CHAIN_BROKEN: HttpStatus.BAD_REQUEST,
  BATCH_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  CURSOR_INVALID: HttpStatus.BAD_REQUEST,
  IN_USE: HttpStatus.CONFLICT,
  DEPTH_EXCEEDED: HttpStatus.BAD_REQUEST,
  IMMUTABLE_FIELD: HttpStatus.CONFLICT,
};

/** Codes where trying the exact same request later can plausibly succeed. */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'INTERNAL',
  'RATE_LIMITED',
  'NOT_CONFIGURED',
  'OTP_LOCKED',
]);

export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, STATUS[code]);
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }

  toBody(requestId?: string): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
        ...(requestId ? { requestId } : {}),
        retryable: this.retryable,
      },
    };
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`);

export const forbidden = (why: string) => new AppError('FORBIDDEN', why);

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
