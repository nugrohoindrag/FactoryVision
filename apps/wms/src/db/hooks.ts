import type {
  AnyEvent,
  Batch,
  Bom,
  Location,
  Partner,
  ProductionLocation,
  Product,
  PurchaseOrder,
} from '@fv/contracts';
import {
  availableStock,
  projectIssues,
  projectPurchaseOrders,
  projectStock,
  projectTasks,
  type IssueBalance,
  type PoProgress,
  type StockLevel,
  type Task,
} from '@fv/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useSession } from '@/app/session';
import { db } from './schema';

/**
 * Live data hooks.
 *
 * Dexie live queries re-run whenever the underlying table changes, so a screen
 * updates the moment an event is appended — no refetch, no invalidation, no
 * network. This is what makes "save → UI updates in <200ms" true by
 * construction rather than by optimisation (Tech Stack §2.1).
 *
 * Every hook filters by the active tenant. There is no unscoped read.
 */

/** `undefined` while the first query is in flight — that is the loading state. */
export function useProducts(): Product[] | undefined {
  const tenantId = useSession((s) => s.tenantId);
  return useLiveQuery(
    () => db.products.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );
}

export function useProduct(productId: string | undefined): Product | undefined {
  return useLiveQuery(
    async () => (productId ? await db.products.get(productId) : undefined),
    [productId],
  );
}

export function useLocations(): Location[] | undefined {
  const tenantId = useSession((s) => s.tenantId);
  return useLiveQuery(
    () => db.locations.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );
}

export function usePartners(kind?: Partner['kind']): Partner[] | undefined {
  const tenantId = useSession((s) => s.tenantId);
  return useLiveQuery(async () => {
    const all = await db.partners.where('tenantId').equals(tenantId).toArray();
    if (!kind) return all;
    return all.filter((p) => p.kind === kind || p.kind === 'BOTH');
  }, [tenantId, kind]);
}

export function useBatches(): Batch[] | undefined {
  const tenantId = useSession((s) => s.tenantId);
  return useLiveQuery(() => db.batches.where('tenantId').equals(tenantId).toArray(), [tenantId]);
}

/** The whole event log for this tenant, in order. Input to every projection. */
export function useEventLog(): AnyEvent[] | undefined {
  const tenantId = useSession((s) => s.tenantId);
  return useLiveQuery(
    async () =>
      (await db.events.where('tenantId').equals(tenantId).sortBy('id')) as unknown as AnyEvent[],
    [tenantId],
  );
}

/**
 * Stock levels, projected from the log.
 *
 * Recomputed from scratch on every change. That is fine at P0 scale (200k
 * movements/year, PRD §10) and it removes a whole class of bug: there is no
 * cached balance that can drift from the events that produced it. If it ever
 * becomes slow, the fix is a snapshot + tail replay — not a mutable balance.
 */
export function useStock(): StockLevel[] | undefined {
  const events = useEventLog();
  return useMemo(() => (events ? projectStock(events) : undefined), [events]);
}

export function useAvailableStock(productId?: string): StockLevel[] | undefined {
  const stock = useStock();
  return useMemo(
    () => (stock ? availableStock(stock, productId) : undefined),
    [stock, productId],
  );
}

export function useIssues(): Map<string, IssueBalance> | undefined {
  const events = useEventLog();
  return useMemo(() => (events ? projectIssues(events) : undefined), [events]);
}

/* --- added with PRD v1.3 ------------------------------------------------ */

export function usePurchaseOrders(): PurchaseOrder[] | undefined {
  const tenantId = useSession((s) => s.tenantId);
  return useLiveQuery(
    () => db.purchaseOrders.where('tenantId').equals(tenantId).sortBy('eta'),
    [tenantId],
  );
}

export function usePurchaseOrder(id: string | undefined): PurchaseOrder | undefined {
  return useLiveQuery(async () => (id ? await db.purchaseOrders.get(id) : undefined), [id]);
}

export function useBoms(): Bom[] | undefined {
  const tenantId = useSession((s) => s.tenantId);
  return useLiveQuery(() => db.boms.where('tenantId').equals(tenantId).toArray(), [tenantId]);
}

export function useBomFor(productId: string | undefined): Bom | undefined {
  const tenantId = useSession((s) => s.tenantId);
  return useLiveQuery(async () => {
    if (!productId) return undefined;
    return db.boms.where('[tenantId+productId]').equals([tenantId, productId]).first();
  }, [tenantId, productId]);
}

/**
 * Line → Machine / Area. A separate hook from `useLocations` on purpose: mixing
 * the two lists is how a rack ends up as the destination of a material request.
 */
export function useProductionLocations(): ProductionLocation[] | undefined {
  const tenantId = useSession((s) => s.tenantId);
  return useLiveQuery(
    () => db.productionLocations.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );
}

/**
 * PO progress — ordered/received/outstanding folded from the receipts.
 *
 * Never read from a stored column, for the same reason stock is not: a written
 * status drifts from its own receipts after an offline sync (PRD §8).
 */
export function usePoProgress(): PoProgress[] | undefined {
  const orders = usePurchaseOrders();
  const events = useEventLog();
  return useMemo(
    () => (orders && events ? projectPurchaseOrders(orders, events) : undefined),
    [orders, events],
  );
}

/** Today as `YYYY-MM-DD`. Domain code never reads a clock, so the UI supplies it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The live task list (F25).
 *
 * Tasks are projected, never stored: a task exists because work exists and
 * disappears when the work is done. That is why nothing here writes a
 * completion — a manual checkbox would create a second truth (UI Spec L27).
 */
export function useTasks(): Task[] | undefined {
  const events = useEventLog();
  const purchaseOrders = usePoProgress();
  return useMemo(
    () =>
      events && purchaseOrders
        ? projectTasks(events, { today: today(), purchaseOrders })
        : undefined,
    [events, purchaseOrders],
  );
}

/** Sync queue depth — "3 pending" is a normal state, not an error (D3). */
export function useSyncState() {
  const tenantId = useSession((s) => s.tenantId);
  return useLiveQuery(async () => {
    const pending = await db.outbox.where('[tenantId+state]').equals([tenantId, 'queued']).count();
    const conflicts = await db.conflicts
      .where('tenantId')
      .equals(tenantId)
      .filter((c) => c.resolvedAt === null)
      .count();
    return { pending, conflicts };
  }, [tenantId]);
}
