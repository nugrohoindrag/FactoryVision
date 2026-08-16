import type { AnyEvent, EventType } from '@fv/contracts';

/**
 * Test event builder. The envelope is noise for projection tests — only
 * `type` and `payload` matter — so it is filled in with stable placeholders.
 */
let seq = 0;

export function ev<T extends EventType>(type: T, payload: unknown): AnyEvent {
  seq += 1;
  return {
    id: `0192f000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    tenantId: 'tenant-1',
    type,
    occurredAt: new Date(Date.UTC(2026, 7, 16, 8, 0, seq)).toISOString(),
    actorId: 'user-1',
    actorRole: 'OPERATOR',
    deviceId: 'device-1',
    prevHash: null,
    hash: `hash-${seq}`,
    payload,
  } as unknown as AnyEvent;
}

export const ids = {
  flour: 'prod-flour',
  sugar: 'prod-sugar',
  batchA: 'batch-a',
  batchB: 'batch-b',
  receiving: 'loc-receiving',
  rackA1: 'loc-rack-a1',
  /** Legacy single virtual production location, kept for pre-v1.3 tests. */
  production: 'loc-in-production',
  reject: 'loc-reject',
  issue: 'issue-1',
  line1: 'line-1',
  line2: 'line-2',
  /* --- added with PRD v1.3 --------------------------------------------- */
  /** Production locations are entities now, not free text (PRD §9.3). */
  lane1: 'prodloc-line-1',
  lane2: 'prodloc-line-2',
  po: 'po-1',
  poLine1: 'po-line-1',
  poLine2: 'po-line-2',
  supplier: 'supplier-1',
} as const;
