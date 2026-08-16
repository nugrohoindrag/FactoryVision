import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@fv/contracts';
import { AppError } from './errors.js';

/**
 * B-007 / B-009 — who is asking, carried without being passed.
 *
 * Every query in this service is scoped to one tenant, and every log line names
 * the actor. Threading a `tenantId` parameter through 90 endpoints works right
 * up until the one place somebody forgets — and that one place is a tenant
 * reading another factory's stock. This product can survive most bugs with an
 * apology; it cannot survive that one.
 *
 * So the tenant is ambient, established once by the guard and read by the
 * Prisma layer itself (`prisma.service.ts`). Forgetting is no longer possible,
 * because there is nothing left to forget.
 */

export interface RequestContext {
  requestId: string;
  tenantId: string | null;
  actorId: string | null;
  actorRole: Role | null;
  deviceId: string | null;
  /** Needed by sign-out: revoke THIS session, not every session this user has. */
  sessionId: string | null;
  /** Trial expired → reads still work, writes do not (PRD F13.1). */
  readOnly: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Fastify hooks return before the handler runs, so `run()` cannot wrap the
 * request lifecycle from inside one. `enterWith` binds the context to the
 * current async resource instead, which is exactly the shape Fastify's
 * `onRequest` hook gives us.
 */
export function enterContext(context: RequestContext): void {
  storage.enterWith(context);
}

/** Mutates the live context — the auth guard filling in who the caller is. */
export function updateContext(patch: Partial<RequestContext>): void {
  const context = storage.getStore();
  if (context) Object.assign(context, patch);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** For code that must not run outside a request — the Prisma tenant extension. */
export function requireTenantId(): string {
  const tenantId = storage.getStore()?.tenantId;
  if (!tenantId) {
    throw new AppError(
      'UNAUTHENTICATED',
      'This operation needs a signed-in user and a tenant',
    );
  }
  return tenantId;
}

export function requireActor(): { actorId: string; actorRole: Role; tenantId: string } {
  const context = storage.getStore();
  if (!context?.actorId || !context.actorRole || !context.tenantId) {
    throw new AppError('UNAUTHENTICATED', 'This operation needs a signed-in user');
  }
  return {
    actorId: context.actorId,
    actorRole: context.actorRole,
    tenantId: context.tenantId,
  };
}

/**
 * Background work (the alert scheduler, B-067) has no request, but it still
 * acts inside exactly one tenant. It gets a context of its own rather than an
 * exemption from the rule.
 */
export function runAsSystem<T>(tenantId: string, fn: () => T): T {
  return runWithContext(
    {
      requestId: `system:${tenantId}`,
      tenantId,
      actorId: null,
      actorRole: null,
      deviceId: null,
      sessionId: null,
      readOnly: false,
    },
    fn,
  );
}
