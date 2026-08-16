import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { currentContext } from '../common/request-context.js';

/**
 * B-007 — tenant isolation enforced at the client, not remembered per query.
 *
 * ## What this extension does
 *
 * Every model that carries `tenantId` gets it injected from the ambient request
 * context — into `where` on reads, updates and deletes, and into `data` on
 * creates. A read can therefore never cross a tenant boundary by omission,
 * which is the failure that matters: leaking another factory's stock.
 *
 * Creates still name their tenant in the call, because Prisma's generated types
 * require the field and hiding that behind a cast would trade a real compile
 * error for a runtime one. The extension overrides whatever is passed, so the
 * two can never disagree — the value in the call is a label, not the authority.
 *
 * ## Why `findUnique`, `update` and `delete` are refused
 *
 * Those three take a *unique* where-clause — `{ id }` — and Prisma will not
 * accept an extra `tenantId` filter alongside it. That leaves two options:
 * rewrite the operation behind the caller's back, or refuse it. Rewriting is
 * the kind of cleverness that works for two years and then surprises somebody
 * at 2am; refusing is visible in the diff, visible in the error, and takes one
 * character to fix (`update` → `updateMany`).
 *
 * The exceptions are the models whose primary key IS the tenant id
 * (`tenant_config`, `projection_checkpoint`): there, a unique lookup is already
 * a tenant-scoped lookup.
 *
 * A cross-tenant read is the one bug in this product that cannot be fixed with
 * an apology. It is worth being blunt about.
 */

/** Models with a `tenantId` column that must always be filtered. */
const TENANT_MODELS = new Set([
  'User',
  'Device',
  'Session',
  'OtpRequest',
  'Event',
  'Conflict',
  'StockLine',
  'SyncCursor',
  'Product',
  'Location',
  'Partner',
  'Batch',
  'ProductionLocation',
  'PurchaseOrder',
  'PurchaseOrderLine',
  'Bom',
  'BomLine',
  'Photo',
  'PushSubscription',
  'Alert',
  'Approval',
  'AdminAudit',
]);

/** Keyed by tenant id, so a unique lookup is already scoped. */
const TENANT_KEYED_MODELS = new Set(['TenantConfig', 'ProjectionCheckpoint']);

const UNIQUE_OPERATIONS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);

const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

type AnyArgs = Record<string, unknown>;

function injectWhere(args: AnyArgs, tenantId: string): AnyArgs {
  const where = (args.where ?? {}) as AnyArgs;
  return { ...args, where: { ...where, tenantId } };
}

function injectData(args: AnyArgs, tenantId: string): AnyArgs {
  const data = args.data;
  if (Array.isArray(data)) {
    return { ...args, data: data.map((row) => ({ ...(row as AnyArgs), tenantId })) };
  }
  return { ...args, data: { ...((data ?? {}) as AnyArgs), tenantId } };
}

export function buildTenantExtension(resolveTenantId: () => string | null) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'tenant-scope',
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            if (!TENANT_MODELS.has(model)) return query(args);

            const tenantId = resolveTenantId();
            if (!tenantId) {
              throw new AppError(
                'UNAUTHENTICATED',
                `Query on ${model} ran without a tenant in scope`,
              );
            }

            if (UNIQUE_OPERATIONS.has(operation) && !TENANT_KEYED_MODELS.has(model)) {
              throw new AppError(
                'INTERNAL',
                `${model}.${operation} cannot be tenant-scoped — use ` +
                  `${operation === 'findUnique' ? 'findFirst' : `${operation}Many`} ` +
                  'with the tenant filter applied automatically',
              );
            }

            const typed = (args ?? {}) as AnyArgs;

            if (operation === 'create') return query(injectData(typed, tenantId));
            if (operation === 'createMany') return query(injectData(typed, tenantId));
            if (READ_OPERATIONS.has(operation)) return query(injectWhere(typed, tenantId));

            return query(args);
          },
        },
      },
    }),
  );
}

export type ScopedPrisma = ReturnType<PrismaService['client']>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /** Unscoped. Only registration, cross-tenant scheduling and tests use it. */
  readonly raw = new PrismaClient();

  private readonly scoped = this.raw.$extends(
    buildTenantExtension(() => currentContext()?.tenantId ?? null),
  );

  async onModuleInit(): Promise<void> {
    await this.raw.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.raw.$disconnect();
  }

  /**
   * The default handle. Reads the tenant from the ambient request context, so
   * callers never pass one and therefore never pass the wrong one.
   */
  client() {
    return this.scoped;
  }
}

export const PRISMA = Symbol('PRISMA');
