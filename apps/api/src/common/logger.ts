import { pino, type Logger } from 'pino';
import { env } from '../config/env.js';
import { currentContext } from './request-context.js';

/**
 * B-009 — every line carries `requestId`, `tenantId`, `actorId`.
 *
 * Support for this product is one person reading logs while a factory is
 * standing still. A line that says "failed to close issue" without saying whose
 * issue, in which factory, on which request, costs the first ten minutes of
 * that call.
 *
 * Phone numbers and OTP codes are redacted at the logger, not at the call site.
 * Redaction that depends on remembering is redaction that has already leaked.
 */
const base = pino({
  level: env().LOG_LEVEL,
  redact: {
    paths: [
      'phone',
      '*.phone',
      'req.body.phone',
      'code',
      '*.code',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[redacted]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export function log(): Logger {
  const context = currentContext();
  if (!context) return base;
  return base.child({
    requestId: context.requestId,
    tenantId: context.tenantId,
    actorId: context.actorId,
  });
}

export const LOGGER = Symbol('LOGGER');
